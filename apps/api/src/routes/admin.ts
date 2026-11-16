import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { RegionPolicySchema, Role } from '@fulfilliq/shared';
import { DbClient } from '../db/index.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { writeAuditLog } from '../services/auditService.ts';
import { getActivePaymentGateway } from '../services/paymentGateway.ts';

const CreateRegionSchema = RegionPolicySchema.extend({
  warehouseName: z.string().trim().min(2).max(100).optional(),
  warehouseCode: z.string().trim().min(2).max(24).optional(),
  warehouseCity: z.string().trim().min(2).max(80).optional(),
});

const UpdateRegionSchema = RegionPolicySchema.omit({ regionId: true, code: true }).partial();

const UpdateUserRoleSchema = z.object({
  role: z.nativeEnum(Role),
  warehouseId: z.string().trim().nullable().optional(),
  isActive: z.boolean().optional(),
});

const UpdateGatewaySchema = z.object({
  mode: z.enum(['local_stub', 'sandbox_http']).optional(),
  simulateOutage: z.boolean().optional(),
  sandboxUrl: z.string().trim().url().optional(),
});

const UpdateThresholdSchema = z.object({
  lowStockThreshold: z.number().int().min(0).max(500),
});

export function createAdminRouter(db: DbClient): Router {
  const router = Router();

  router.get(
    '/admin/users',
    requireAuth,
    requireRole(Role.ADMIN),
    async (_req, res, next) => {
      try {
        const result = await db.query(
          `SELECT u.id, u.email, u.full_name AS "fullName", u.phone, u.role,
                  u.warehouse_id AS "warehouseId", w.name AS "warehouseName",
                  u.is_active AS "isActive", u.created_at AS "createdAt"
           FROM users u
           LEFT JOIN warehouses w ON w.id = u.warehouse_id
           ORDER BY u.role ASC, u.full_name ASC`
        );
        res.json({ users: result.rows });
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    '/admin/users/:id/role',
    requireAuth,
    requireRole(Role.ADMIN),
    async (req, res, next) => {
      try {
        const body = UpdateUserRoleSchema.parse(req.body);
        const actor = req.user!;
        const existing = await db.query<{ id: string; role: string }>(
          'SELECT id, role FROM users WHERE id = $1',
          [req.params.id]
        );
        if (existing.rowCount === 0) {
          throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
        }
        const prevRole = existing.rows[0].role;

        await db.withTransaction(async (tx) => {
          await tx.query(
            `UPDATE users SET role = $1, warehouse_id = $2, is_active = $3 WHERE id = $4`,
            [
              body.role,
              body.warehouseId !== undefined ? body.warehouseId : null,
              body.isActive === false ? 0 : 1,
              req.params.id,
            ]
          );

          await writeAuditLog(tx, {
            entityType: 'user',
            entityId: req.params.id,
            action: 'USER_ROLE_UPDATED',
            fromState: prevRole,
            toState: body.role,
            actorId: actor.id,
            actorName: actor.fullName,
            actorRole: actor.role,
            reason: `Role updated to ${body.role}`,
          });
        });

        res.json({ id: req.params.id, role: body.role });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    '/admin/regions',
    requireAuth,
    requireRole(Role.ADMIN),
    async (req, res, next) => {
      try {
        const body = CreateRegionSchema.parse(req.body);
        const actor = req.user!;
        const now = new Date().toISOString();

        await db.withTransaction(async (tx) => {
          await tx.query(
            `INSERT INTO regions (
              region_id, code, name, tax_rate, shipping_rule_type, shipping_flat_cents,
              shipping_free_threshold_cents, refund_approval_limit_cents, return_window_days,
              reservation_expiry_minutes, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              body.regionId,
              body.code.toUpperCase(),
              body.name,
              body.taxRate,
              body.shippingRuleType,
              body.shippingFlatCents,
              body.shippingFreeThresholdCents,
              body.refundApprovalLimitCents,
              body.returnWindowDays,
              body.reservationExpiryMinutes,
              now,
              now,
            ]
          );

          if (body.warehouseName && body.warehouseCode) {
            const whId = `wh-${body.code.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}`;
            await tx.query(
              `INSERT INTO warehouses (id, code, name, region_id, city, is_active, created_at)
               VALUES ($1,$2,$3,$4,$5,1,$6)`,
              [
                whId,
                body.warehouseCode.toUpperCase(),
                body.warehouseName,
                body.regionId,
                body.warehouseCity || body.name,
                now,
              ]
            );
            const prods = await tx.query<{ id: string }>('SELECT id FROM products');
            for (const p of prods.rows) {
              await tx.query(
                `INSERT INTO warehouse_stock (warehouse_id, product_id, qty_available, qty_reserved, qty_sold, updated_at)
                 VALUES ($1,$2,20,0,0,$3)`,
                [whId, p.id, now]
              );
            }
          }

          await writeAuditLog(tx, {
            entityType: 'region',
            entityId: body.regionId,
            action: 'REGION_CREATED',
            toState: body.code.toUpperCase(),
            actorId: actor.id,
            actorName: actor.fullName,
            actorRole: actor.role,
            reason: `Created region policy ${body.name}`,
            createdAt: now,
          });
        });

        res.status(201).json({ region: body });
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    '/admin/regions/:regionId',
    requireAuth,
    requireRole(Role.ADMIN),
    async (req, res, next) => {
      try {
        const body = UpdateRegionSchema.parse(req.body);
        const actor = req.user!;
        const now = new Date().toISOString();

        const existingRes = await db.query<{
          region_id: string;
          name: string;
          tax_rate: number;
          shipping_rule_type: string;
          shipping_flat_cents: number;
          shipping_free_threshold_cents: number;
          refund_approval_limit_cents: number;
          return_window_days: number;
          reservation_expiry_minutes: number;
        }>('SELECT * FROM regions WHERE region_id = $1', [req.params.regionId]);

        if (existingRes.rowCount === 0) {
          throw new HttpError(404, 'REGION_NOT_FOUND', 'Region not found');
        }
        const cur = existingRes.rows[0];

        const nextName = body.name ?? cur.name;
        const nextTaxRate = body.taxRate ?? Number(cur.tax_rate);
        const nextShipType = body.shippingRuleType ?? cur.shipping_rule_type;
        const nextShipFlat = body.shippingFlatCents ?? Number(cur.shipping_flat_cents);
        const nextShipThresh =
          body.shippingFreeThresholdCents ?? Number(cur.shipping_free_threshold_cents);
        const nextRefundLimit =
          body.refundApprovalLimitCents ?? Number(cur.refund_approval_limit_cents);
        const nextReturnDays = body.returnWindowDays ?? Number(cur.return_window_days);
        const nextResMins =
          body.reservationExpiryMinutes ?? Number(cur.reservation_expiry_minutes);

        await db.withTransaction(async (tx) => {
          await tx.query(
            `UPDATE regions
             SET name = $1, tax_rate = $2, shipping_rule_type = $3, shipping_flat_cents = $4,
                 shipping_free_threshold_cents = $5, refund_approval_limit_cents = $6,
                 return_window_days = $7, reservation_expiry_minutes = $8, updated_at = $9
             WHERE region_id = $10`,
            [
              nextName,
              nextTaxRate,
              nextShipType,
              nextShipFlat,
              nextShipThresh,
              nextRefundLimit,
              nextReturnDays,
              nextResMins,
              now,
              req.params.regionId,
            ]
          );

          await writeAuditLog(tx, {
            entityType: 'region',
            entityId: req.params.regionId,
            action: 'REGION_POLICY_UPDATED',
            actorId: actor.id,
            actorName: actor.fullName,
            actorRole: actor.role,
            reason: 'Updated configurable region policies',
            metadata: body as Record<string, unknown>,
            createdAt: now,
          });
        });

        res.json({
          region: {
            regionId: req.params.regionId,
            name: nextName,
            taxRate: nextTaxRate,
            shippingRuleType: nextShipType,
            shippingFlatCents: nextShipFlat,
            shippingFreeThresholdCents: nextShipThresh,
            refundApprovalLimitCents: nextRefundLimit,
            returnWindowDays: nextReturnDays,
            reservationExpiryMinutes: nextResMins,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    '/admin/products/:id/threshold',
    requireAuth,
    requireRole(Role.ADMIN, Role.STORE_MANAGER),
    async (req, res, next) => {
      try {
        const body = UpdateThresholdSchema.parse(req.body);
        const upd = await db.query(
          'UPDATE products SET low_stock_threshold = $1 WHERE id = $2',
          [body.lowStockThreshold, req.params.id]
        );
        if (upd.rowCount === 0) {
          throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
        }
        res.json({ productId: req.params.id, lowStockThreshold: body.lowStockThreshold });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    '/admin/gateway',
    requireAuth,
    requireRole(Role.ADMIN, Role.FINANCE_REVIEWER),
    async (_req, res, next) => {
      try {
        const info = await getActivePaymentGateway(db);
        const pendingRes = await db.query<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM payment_intents WHERE status = 'PENDING_RETRY'"
        );
        res.json({
          mode: info.mode,
          simulateOutage: info.simulateOutage,
          sandboxUrl: info.sandboxUrl,
          status: info.simulateOutage ? 'UNAVAILABLE_SIMULATED' : 'HEALTHY',
          pendingRetryCount: Number(pendingRes.rows[0]?.cnt ?? 0),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    '/admin/gateway',
    requireAuth,
    requireRole(Role.ADMIN),
    async (req, res, next) => {
      try {
        const body = UpdateGatewaySchema.parse(req.body);
        const actor = req.user!;
        const now = new Date().toISOString();

        const current = await getActivePaymentGateway(db);
        const nextMode = body.mode ?? current.mode;
        const nextOutage = body.simulateOutage ?? current.simulateOutage;
        const nextUrl = body.sandboxUrl ?? current.sandboxUrl;

        await db.withTransaction(async (tx) => {
          await tx.query(
            `UPDATE gateway_config
             SET mode = $1, simulate_outage = $2, sandbox_url = $3, updated_at = $4, updated_by = $5
             WHERE id = 'default'`,
            [nextMode, nextOutage ? 1 : 0, nextUrl, now, actor.id]
          );
          await writeAuditLog(tx, {
            entityType: 'gateway',
            entityId: 'default',
            action: 'GATEWAY_CONFIG_UPDATED',
            actorId: actor.id,
            actorName: actor.fullName,
            actorRole: actor.role,
            reason: `Mode=${nextMode}, simulateOutage=${nextOutage}`,
            createdAt: now,
          });
        });

        res.json({
          mode: nextMode,
          simulateOutage: nextOutage,
          sandboxUrl: nextUrl,
          status: nextOutage ? 'UNAVAILABLE_SIMULATED' : 'HEALTHY',
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
