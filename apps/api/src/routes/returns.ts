import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { OrderStatus, Role } from '@fulfilliq/shared';
import { DbClient } from '../db/index.ts';
import { maskEmail, requireAuth, requireRole, shouldMaskCustomerContact } from '../middleware/auth.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { writeAuditLog } from '../services/auditService.ts';
import { scheduleCsvSync } from '../services/csvService.ts';
import { transitionOrderStatus } from '../services/orderStateMachine.ts';

const ReturnRequestSchema = z.object({
  reason: z.string().trim().min(5, 'Please provide a return reason (at least 5 characters)').max(400),
  requestedAmountCents: z.number().int().positive().optional(),
});

const RefundDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(4, 'Decision reason is required for audit compliance').max(400),
});

export function createReturnsRouter(db: DbClient): Router {
  const router = Router();

  // S07: Customer requests return on own delivered order within regional return_window_days
  router.post(
    '/orders/:id/return',
    requireAuth,
    requireRole(Role.CUSTOMER, Role.ADMIN),
    async (req, res, next) => {
      try {
        const body = ReturnRequestSchema.parse(req.body);
        const user = req.user!;

        const created = await db.withTransaction(async (tx) => {
          const ordRes = await tx.query<{
            id: string;
            order_number: string;
            customer_id: string;
            region_id: string;
            status: OrderStatus;
            total_cents: number;
            delivered_at: string | null;
            return_window_days: number;
          }>(
            `SELECT o.id, o.order_number, o.customer_id, o.region_id, o.status,
                    o.total_cents, o.delivered_at, r.return_window_days
             FROM orders o
             JOIN regions r ON r.region_id = o.region_id
             WHERE o.id = $1`,
            [req.params.id]
          );

          if (ordRes.rowCount === 0) {
            throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
          }
          const order = ordRes.rows[0];

          // S07: Only the order owner can request a return
          if (order.customer_id !== user.id) {
            throw new HttpError(403, 'FORBIDDEN', 'Only the order owner can request a return');
          }

          if (order.status !== OrderStatus.DELIVERED) {
            throw new HttpError(
              409,
              'INVALID_ORDER_STATE',
              `Cannot request return when order status is ${order.status}`
            );
          }

          const deliveredAtMs = order.delivered_at ? new Date(order.delivered_at).getTime() : 0;
          const windowDays = Number(order.return_window_days || 14);
          const windowMs = windowDays * 86400_000;
          if (!deliveredAtMs || Date.now() - deliveredAtMs > windowMs) {
            throw new HttpError(
              422,
              'RETURN_WINDOW_EXPIRED',
              `Return window of ${windowDays} days after delivery has expired for this region`
            );
          }

          const requestedAmount = Math.min(
            Number(order.total_cents),
            body.requestedAmountCents ?? Number(order.total_cents)
          );

          const returnId = `ret-${crypto.randomUUID()}`;
          const now = new Date().toISOString();
          await tx.query(
            `INSERT INTO returns (id, order_id, customer_id, region_id, reason, requested_amount_cents, status, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,'REQUESTED',$7)`,
            [returnId, order.id, user.id, order.region_id, body.reason, requestedAmount, now]
          );

          await transitionOrderStatus(tx, {
            orderId: order.id,
            toStatus: OrderStatus.RETURN_REQUESTED,
            actor: { id: user.id, name: user.fullName, role: user.role },
            amountCents: requestedAmount,
            reason: `Return requested: ${body.reason}`,
          });

          return {
            id: returnId,
            orderId: order.id,
            orderNumber: order.order_number,
            status: 'REQUESTED',
            requestedAmountCents: requestedAmount,
            reason: body.reason,
            createdAt: now,
          };
        });

        scheduleCsvSync(db);
        res.status(201).json({ returnRequest: created });
      } catch (err) {
        next(err);
      }
    }
  );

  // List returns scoped by role
  router.get('/returns', requireAuth, async (req, res, next) => {
    try {
      const user = req.user!;
      const params: string[] = [];
      let where = '';
      if (user.role === Role.CUSTOMER) {
        params.push(user.id);
        where = 'WHERE ret.customer_id = $1';
      } else if (user.role === Role.PICKER) {
        throw new HttpError(403, 'FORBIDDEN', 'Pickers do not have access to returns queue');
      }

      const result = await db.query<{
        id: string;
        order_id: string;
        order_number: string;
        customer_id: string;
        customer_email: string;
        region_id: string;
        region_name: string;
        refund_approval_limit_cents: number;
        reason: string;
        requested_amount_cents: number;
        status: string;
        decided_by: string | null;
        decided_by_name: string | null;
        decision_reason: string | null;
        decided_at: string | null;
        created_at: string;
      }>(
        `SELECT ret.*, o.order_number, u.email AS customer_email,
                r.name AS region_name, r.refund_approval_limit_cents,
                decider.full_name AS decided_by_name
         FROM returns ret
         JOIN orders o ON o.id = ret.order_id
         JOIN users u ON u.id = ret.customer_id
         JOIN regions r ON r.region_id = ret.region_id
         LEFT JOIN users decider ON decider.id = ret.decided_by
         ${where}
         ORDER BY ret.created_at DESC`,
        params
      );

      const mask = shouldMaskCustomerContact(user.role);
      res.json({
        returns: result.rows.map((r) => ({
          id: r.id,
          orderId: r.order_id,
          orderNumber: r.order_number,
          customerId: r.customer_id,
          customerEmail: mask ? maskEmail(r.customer_email) : r.customer_email,
          regionId: r.region_id,
          regionName: r.region_name,
          regionRefundLimitCents: Number(r.refund_approval_limit_cents),
          requiresAdminApproval:
            Number(r.requested_amount_cents) > Number(r.refund_approval_limit_cents),
          reason: r.reason,
          requestedAmountCents: Number(r.requested_amount_cents),
          status: r.status,
          decidedBy: r.decided_by,
          decidedByName: r.decided_by_name,
          decisionReason: r.decision_reason,
          decidedAt: r.decided_at,
          createdAt: r.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // Move RETURN_REQUESTED -> REFUND_PENDING for finance review
  router.post(
    '/returns/:id/queue-refund',
    requireAuth,
    requireRole(Role.SUPPORT_AGENT, Role.STORE_MANAGER, Role.FINANCE_REVIEWER, Role.ADMIN),
    async (req, res, next) => {
      try {
        const user = req.user!;
        const updated = await db.withTransaction(async (tx) => {
          const retRes = await tx.query<{ id: string; order_id: string; status: string }>(
            'SELECT id, order_id, status FROM returns WHERE id = $1',
            [req.params.id]
          );
          if (retRes.rowCount === 0) {
            throw new HttpError(404, 'RETURN_NOT_FOUND', 'Return request not found');
          }
          const ret = retRes.rows[0];
          if (ret.status !== 'REQUESTED') {
            throw new HttpError(
              409,
              'INVALID_RETURN_STATE',
              `Return is ${ret.status}, cannot queue for refund`
            );
          }

          await tx.query(`UPDATE returns SET status = 'REFUND_PENDING' WHERE id = $1`, [ret.id]);
          await transitionOrderStatus(tx, {
            orderId: ret.order_id,
            toStatus: OrderStatus.REFUND_PENDING,
            actor: { id: user.id, name: user.fullName, role: user.role },
            reason: 'Return verified and queued for human refund review',
          });

          return { id: ret.id, orderId: ret.order_id, status: 'REFUND_PENDING' };
        });

        scheduleCsvSync(db);
        res.json({ returnRequest: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  // S08: Refund approval governance (support_agent -> 403, finance_reviewer <= region limit, above limit -> admin)
  router.post(
    '/returns/:id/decision',
    requireAuth,
    requireRole(Role.FINANCE_REVIEWER, Role.ADMIN),
    async (req, res, next) => {
      try {
        const body = RefundDecisionSchema.parse(req.body);
        const user = req.user!;

        const outcome = await db.withTransaction(async (tx) => {
          const retRes = await tx.query<{
            id: string;
            order_id: string;
            region_id: string;
            requested_amount_cents: number;
            status: string;
            refund_approval_limit_cents: number;
            region_name: string;
          }>(
            `SELECT ret.*, r.refund_approval_limit_cents, r.name AS region_name
             FROM returns ret
             JOIN regions r ON r.region_id = ret.region_id
             WHERE ret.id = $1`,
            [req.params.id]
          );

          if (retRes.rowCount === 0) {
            throw new HttpError(404, 'RETURN_NOT_FOUND', 'Return request not found');
          }
          const ret = retRes.rows[0];

          if (ret.status !== 'REFUND_PENDING') {
            throw new HttpError(
              409,
              'INVALID_RETURN_STATE',
              `Return must be in REFUND_PENDING state before decision (currently ${ret.status})`
            );
          }

          const amountCents = Number(ret.requested_amount_cents);
          const limitCents = Number(ret.refund_approval_limit_cents);

          if (body.decision === 'approve' && amountCents > limitCents && user.role !== Role.ADMIN) {
            throw new HttpError(
              403,
              'REFUND_LIMIT_EXCEEDED',
              `Refund amount ($${(amountCents / 100).toFixed(2)}) exceeds ${ret.region_name} finance_reviewer limit ($${(limitCents / 100).toFixed(2)}); admin approval required`
            );
          }

          const now = new Date().toISOString();
          const newReturnStatus = body.decision === 'approve' ? 'APPROVED' : 'REJECTED';
          const newOrderStatus =
            body.decision === 'approve' ? OrderStatus.REFUNDED : OrderStatus.REFUND_REJECTED;

          await tx.query(
            `UPDATE returns
             SET status = $1, decided_by = $2, decision_reason = $3, decided_at = $4
             WHERE id = $5`,
            [newReturnStatus, user.id, body.reason, now, ret.id]
          );

          await transitionOrderStatus(tx, {
            orderId: ret.order_id,
            toStatus: newOrderStatus,
            actor: { id: user.id, name: user.fullName, role: user.role },
            amountCents,
            reason: body.reason,
          });

          await writeAuditLog(tx, {
            entityType: 'return',
            entityId: ret.id,
            action: body.decision === 'approve' ? 'REFUND_APPROVED' : 'REFUND_REJECTED',
            fromState: 'REFUND_PENDING',
            toState: newReturnStatus,
            actorId: user.id,
            actorName: user.fullName,
            actorRole: user.role,
            amountCents,
            reason: body.reason,
            metadata: {
              orderId: ret.order_id,
              regionId: ret.region_id,
              regionLimitCents: limitCents,
            },
            createdAt: now,
          });

          return {
            id: ret.id,
            orderId: ret.order_id,
            status: newReturnStatus,
            orderStatus: newOrderStatus,
            decidedBy: user.id,
            decidedByName: user.fullName,
            amountCents,
            reason: body.reason,
            decidedAt: now,
          };
        });

        scheduleCsvSync(db);
        res.json({ decision: outcome });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
