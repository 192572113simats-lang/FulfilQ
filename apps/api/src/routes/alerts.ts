import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@fulfilliq/shared';
import { DbClient } from '../db/index.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { writeAuditLog } from '../services/auditService.ts';
import { applyManualStockCorrection } from '../services/inventoryService.ts';

const StockCorrectionSchema = z.object({
  warehouseId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  deltaQty: z.number().int().refine((n) => n !== 0, 'deltaQty cannot be zero'),
  reason: z.string().trim().min(4, 'Human reason is required for stock corrections').max(300),
});

export function createAlertsRouter(db: DbClient): Router {
  const router = Router();

  // S11: View deterministic low-stock alerts
  router.get(
    '/alerts/low-stock',
    requireAuth,
    requireRole(Role.STORE_MANAGER, Role.ADMIN, Role.PICKER),
    async (req, res, next) => {
      try {
        const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';
        const params: string[] = [];
        let where = '';
        if (statusFilter === 'OPEN' || statusFilter === 'RESOLVED') {
          params.push(statusFilter);
          where = 'WHERE a.status = $1';
        }

        const result = await db.query(
          `SELECT a.id, a.warehouse_id AS "warehouseId", w.name AS "warehouseName",
                  a.product_id AS "productId", p.sku, p.name AS "productName",
                  a.qty_at_trigger AS "qtyAtTrigger", a.threshold,
                  ws.qty_available AS "currentQtyAvailable",
                  a.status, a.created_at AS "createdAt", a.resolved_at AS "resolvedAt",
                  u.full_name AS "resolvedByName"
           FROM low_stock_alerts a
           JOIN warehouses w ON w.id = a.warehouse_id
           JOIN products p ON p.id = a.product_id
           JOIN warehouse_stock ws ON ws.warehouse_id = a.warehouse_id AND ws.product_id = a.product_id
           LEFT JOIN users u ON u.id = a.resolved_by
           ${where}
           ORDER BY CASE WHEN a.status = 'OPEN' THEN 0 ELSE 1 END, a.created_at DESC`,
          params
        );

        res.json({ alerts: result.rows });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    '/alerts/low-stock/:id/resolve',
    requireAuth,
    requireRole(Role.STORE_MANAGER, Role.ADMIN),
    async (req, res, next) => {
      try {
        const user = req.user!;
        const now = new Date().toISOString();

        const updated = await db.withTransaction(async (tx) => {
          const resAlert = await tx.query<{
            id: string;
            warehouse_id: string;
            product_id: string;
            status: string;
          }>('SELECT id, warehouse_id, product_id, status FROM low_stock_alerts WHERE id = $1', [
            req.params.id,
          ]);
          if (resAlert.rowCount === 0) {
            throw new HttpError(404, 'ALERT_NOT_FOUND', 'Low-stock alert not found');
          }
          const alert = resAlert.rows[0];
          if (alert.status === 'RESOLVED') {
            return alert;
          }

          await tx.query(
            `UPDATE low_stock_alerts SET status = 'RESOLVED', resolved_at = $1, resolved_by = $2 WHERE id = $3`,
            [now, user.id, alert.id]
          );

          await writeAuditLog(tx, {
            entityType: 'stock',
            entityId: `${alert.warehouse_id}:${alert.product_id}`,
            action: 'LOW_STOCK_ALERT_RESOLVED',
            fromState: 'OPEN',
            toState: 'RESOLVED',
            actorId: user.id,
            actorName: user.fullName,
            actorRole: user.role,
            reason: 'Alert manually resolved by manager/admin',
            createdAt: now,
          });

          return { ...alert, status: 'RESOLVED' };
        });

        res.json({ alert: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  // Human-only audited stock corrections (support_agent forbidden -> 403)
  router.post(
    '/inventory/corrections',
    requireAuth,
    requireRole(Role.STORE_MANAGER, Role.ADMIN),
    async (req, res, next) => {
      try {
        const body = StockCorrectionSchema.parse(req.body);
        const user = req.user!;
        const result = await applyManualStockCorrection(db, {
          warehouseId: body.warehouseId,
          productId: body.productId,
          deltaQty: body.deltaQty,
          reason: body.reason,
          actor: { id: user.id, name: user.fullName, role: user.role },
        });
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
