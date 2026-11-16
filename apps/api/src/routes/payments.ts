import { Router } from 'express';
import { OrderStatus, PaymentRequestPayloadSchema, Role } from '@fulfilliq/shared';
import { DbClient } from '../db/index.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { scheduleCsvSync } from '../services/csvService.ts';
import { executeIdempotentPayment, retryPendingPayment } from '../services/paymentGateway.ts';

export function createPaymentsRouter(db: DbClient): Router {
  const router = Router();

  // S03a & S03b: Idempotent payment creation & gateway outage graceful handling
  router.post(
    '/payments',
    requireAuth,
    requireRole(Role.CUSTOMER, Role.ADMIN),
    async (req, res, next) => {
      try {
        const idempotencyKey = req.header('Idempotency-Key')?.trim();
        if (!idempotencyKey) {
          throw new HttpError(
            400,
            'MISSING_IDEMPOTENCY_KEY',
            'Idempotency-Key header is required on POST /api/payments'
          );
        }

        const payload = PaymentRequestPayloadSchema.parse(req.body);
        const user = req.user!;

        const result = await executeIdempotentPayment(db, {
          idempotencyKey,
          endpoint: '/api/payments',
          userId: user.id,
          userName: user.fullName,
          userRole: user.role,
          orderId: payload.orderId,
          syntheticCardLast4: payload.syntheticCardLast4,
          simulatedOutcome: payload.simulatedOutcome,
        });

        if (!result.replayed) {
          scheduleCsvSync(db);
        }

        res.status(result.statusCode).json({
          ...result.body,
          idempotentReplay: result.replayed,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // S03b: Safe retry for PAYMENT_PENDING orders without double charging
  router.post(
    '/payments/:orderId/retry',
    requireAuth,
    requireRole(Role.CUSTOMER, Role.FINANCE_REVIEWER, Role.ADMIN),
    async (req, res, next) => {
      try {
        const user = req.user!;
        if (user.role === Role.CUSTOMER) {
          const own = await db.query<{ customer_id: string }>(
            'SELECT customer_id FROM orders WHERE id = $1',
            [req.params.orderId]
          );
          if (own.rowCount === 0) {
            throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
          }
          if (own.rows[0].customer_id !== user.id) {
            throw new HttpError(403, 'FORBIDDEN', 'Cannot retry payment for another customer');
          }
        }

        const result = await retryPendingPayment(db, {
          orderId: req.params.orderId,
          actor: { id: user.id, name: user.fullName, role: user.role },
        });
        scheduleCsvSync(db);
        res.status(result.statusCode).json(result.body);
      } catch (err) {
        next(err);
      }
    }
  );

  // Finance reconciliation table (orders vs payments, mismatches highlighted)
  router.get(
    '/finance/reconciliation',
    requireAuth,
    requireRole(Role.FINANCE_REVIEWER, Role.ADMIN),
    async (_req, res, next) => {
      try {
        const rows = await db.query<{
          order_id: string;
          order_number: string;
          order_status: OrderStatus;
          order_total_cents: number;
          region_name: string;
          payment_id: string | null;
          payment_status: string | null;
          payment_amount_cents: number | null;
          gateway_used: string | null;
          gateway_ref: string | null;
          retry_count: number | null;
          last_error: string | null;
          created_at: string;
        }>(
          `SELECT o.id AS order_id, o.order_number, o.status AS order_status, o.total_cents AS order_total_cents,
                  r.name AS region_name,
                  pi.id AS payment_id, pi.status AS payment_status, pi.amount_cents AS payment_amount_cents,
                  pi.gateway_used, pi.gateway_ref, pi.retry_count, pi.last_error, o.created_at
           FROM orders o
           JOIN regions r ON r.region_id = o.region_id
           LEFT JOIN payment_intents pi ON pi.order_id = o.id
           ORDER BY o.created_at DESC`
        );

        const records = rows.rows.map((r) => {
          const orderTotal = Number(r.order_total_cents);
          const payAmount = r.payment_amount_cents !== null ? Number(r.payment_amount_cents) : null;
          const paidStatuses = [
            OrderStatus.PAID,
            OrderStatus.PICKING,
            OrderStatus.PACKED,
            OrderStatus.DISPATCHED,
            OrderStatus.DELIVERED,
            OrderStatus.RETURN_REQUESTED,
            OrderStatus.REFUND_PENDING,
            OrderStatus.REFUNDED,
            OrderStatus.REFUND_REJECTED,
          ];
          const isPaidOrder = paidStatuses.includes(r.order_status);
          let mismatchReason: string | null = null;
          if (isPaidOrder && r.payment_status !== 'SUCCEEDED') {
            mismatchReason = 'Order marked fulfilled/paid without SUCCEEDED payment intent';
          } else if (r.order_status === OrderStatus.PAYMENT_PENDING) {
            mismatchReason = 'Payment awaiting gateway retry (PAYMENT_PENDING)';
          } else if (payAmount !== null && payAmount !== orderTotal) {
            mismatchReason = `Amount delta: order=${orderTotal}c vs payment=${payAmount}c`;
          }

          return {
            orderId: r.order_id,
            orderNumber: r.order_number,
            orderStatus: r.order_status,
            orderTotalCents: orderTotal,
            regionName: r.region_name,
            paymentId: r.payment_id,
            paymentStatus: r.payment_status,
            paymentAmountCents: payAmount,
            gatewayUsed: r.gateway_used,
            gatewayRef: r.gateway_ref,
            retryCount: r.retry_count ?? 0,
            lastError: r.last_error,
            mismatch: Boolean(mismatchReason),
            mismatchReason,
            createdAt: r.created_at,
          };
        });

        res.json({ records });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
