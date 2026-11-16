import { Router } from 'express';
import { z } from 'zod';
import { OrderStatus, Role } from '@fulfilliq/shared';
import { DbClient } from '../db/index.ts';
import { maskPhone, requireAuth, requireRole } from '../middleware/auth.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { writeAuditLog } from '../services/auditService.ts';
import { transitionOrderStatus } from '../services/orderStateMachine.ts';

const ScanSchema = z.object({
  barcodeOrSku: z.string().trim().min(1, 'Enter or scan a barcode or SKU'),
  quantity: z.number().int().min(1).max(50).optional().default(1),
});

export function createPickingRouter(db: DbClient): Router {
  const router = Router();

  // S04: Picker sees ONLY reserved/consumed AND paid items for assigned/warehouse orders
  router.get(
    '/picking/queue',
    requireAuth,
    requireRole(Role.PICKER, Role.ADMIN),
    async (req, res, next) => {
      try {
        const user = req.user!;
        const params: string[] = [];
        let whClause = '';
        if (user.role === Role.PICKER && user.warehouseId) {
          params.push(user.warehouseId);
          whClause = `AND o.warehouse_id = $1`;
        }

        // Strict guarantee: ONLY PAID, PICKING, or PACKED orders that have an active or consumed reservation AND a SUCCEEDED payment
        const ordersRes = await db.query<{
          id: string;
          order_number: string;
          status: OrderStatus;
          warehouse_id: string;
          warehouse_name: string;
          assigned_picker_id: string | null;
          shipping_address_json: string;
          created_at: string;
        }>(
          `SELECT DISTINCT o.id, o.order_number, o.status, o.warehouse_id, w.name AS warehouse_name,
                  o.assigned_picker_id, o.shipping_address_json, o.created_at
           FROM orders o
           JOIN warehouses w ON w.id = o.warehouse_id
           JOIN payment_intents pi ON pi.order_id = o.id AND pi.status = 'SUCCEEDED'
           JOIN stock_reservations sr ON sr.order_id = o.id AND sr.status IN ('ACTIVE','CONSUMED')
           WHERE o.status IN ('PAID','PICKING','PACKED')
           ${whClause}
           ORDER BY o.created_at ASC`,
          params
        );

        const queue = [];
        for (const o of ordersRes.rows) {
          const itemsRes = await db.query(
            `SELECT id, product_id AS "productId", sku, name, barcode, quantity,
                    picked_quantity AS "pickedQuantity"
             FROM order_items WHERE order_id = $1`,
            [o.id]
          );
          const addr = JSON.parse(o.shipping_address_json) as Record<string, string>;
          queue.push({
            id: o.id,
            orderNumber: o.order_number,
            status: o.status,
            warehouseId: o.warehouse_id,
            warehouseName: o.warehouse_name,
            assignedPickerId: o.assigned_picker_id,
            recipientName: addr.recipientName,
            city: addr.city,
            maskedPhone: maskPhone(addr.phone || ''),
            createdAt: o.created_at,
            items: itemsRes.rows,
          });
        }

        res.json({ queue });
      } catch (err) {
        next(err);
      }
    }
  );

  // S12: Barcode pick confirmation (keyboard-wedge scanner or manual text fallback)
  router.post(
    '/picking/:orderId/scan',
    requireAuth,
    requireRole(Role.PICKER, Role.ADMIN),
    async (req, res, next) => {
      try {
        const body = ScanSchema.parse(req.body);
        const user = req.user!;
        const code = body.barcodeOrSku.trim().toLowerCase();

        const updatedResult = await db.withTransaction(async (tx) => {
          const ordRes = await tx.query<{ id: string; status: OrderStatus; assigned_picker_id: string | null }>(
            'SELECT id, status, assigned_picker_id FROM orders WHERE id = $1',
            [req.params.orderId]
          );
          if (ordRes.rowCount === 0) {
            throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
          }
          const order = ordRes.rows[0];

          if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.PICKING) {
            throw new HttpError(
              409,
              'INVALID_ORDER_STATE',
              `Order is ${order.status}; only PAID or PICKING orders can be scanned`
            );
          }

          // Verify SUCCEEDED payment
          const paidCheck = await tx.query(
            "SELECT id FROM payment_intents WHERE order_id = $1 AND status = 'SUCCEEDED'",
            [order.id]
          );
          if (paidCheck.rowCount === 0) {
            throw new HttpError(403, 'UNPAID_ORDER', 'Cannot pick an unpaid order');
          }

          const itemsRes = await tx.query<{
            id: string;
            sku: string;
            barcode: string;
            name: string;
            quantity: number;
            picked_quantity: number;
          }>(
            'SELECT id, sku, barcode, name, quantity, picked_quantity FROM order_items WHERE order_id = $1',
            [order.id]
          );

          const matched = itemsRes.rows.find(
            (i) => i.barcode.toLowerCase() === code || i.sku.toLowerCase() === code
          );

          if (!matched) {
            await writeAuditLog(tx, {
              entityType: 'order',
              entityId: order.id,
              action: 'BARCODE_SCAN_REJECTED',
              actorId: user.id,
              actorName: user.fullName,
              actorRole: user.role,
              reason: `Scanned wrong item code '${body.barcodeOrSku}' not in order`,
            });
            throw new HttpError(
              422,
              'WRONG_ITEM_SCANNED',
              `Scanned code '${body.barcodeOrSku}' does not match any item in this pick list`
            );
          }

          if (Number(matched.picked_quantity) >= Number(matched.quantity)) {
            throw new HttpError(
              409,
              'ITEM_ALREADY_PICKED',
              `All ${matched.quantity} unit(s) of ${matched.name} are already confirmed picked`
            );
          }

          const newPickedQty = Math.min(
            Number(matched.quantity),
            Number(matched.picked_quantity) + body.quantity
          );

          await tx.query(
            'UPDATE order_items SET picked_quantity = $1 WHERE id = $2',
            [newPickedQty, matched.id]
          );

          if (order.status === OrderStatus.PAID) {
            await transitionOrderStatus(tx, {
              orderId: order.id,
              toStatus: OrderStatus.PICKING,
              actor: { id: user.id, name: user.fullName, role: user.role },
              reason: `Picker started picking with scan ${matched.sku}`,
              extraSetSql: 'assigned_picker_id = __P1__',
              extraParams: [user.id],
            });
          }

          await writeAuditLog(tx, {
            entityType: 'order',
            entityId: order.id,
            action: 'BARCODE_SCAN_CONFIRMED',
            actorId: user.id,
            actorName: user.fullName,
            actorRole: user.role,
            reason: `Confirmed ${matched.sku} (${newPickedQty}/${matched.quantity})`,
          });

          const refreshedItems = await tx.query(
            `SELECT id, product_id AS "productId", sku, name, barcode, quantity,
                    picked_quantity AS "pickedQuantity"
             FROM order_items WHERE order_id = $1`,
            [order.id]
          );

          return {
            orderId: order.id,
            status: order.status === OrderStatus.PAID ? OrderStatus.PICKING : order.status,
            scannedSku: matched.sku,
            items: refreshedItems.rows,
          };
        });

        res.json(updatedResult);
      } catch (err) {
        next(err);
      }
    }
  );

  // Mark order PACKED after all items confirmed picked
  router.post(
    '/picking/:orderId/pack',
    requireAuth,
    requireRole(Role.PICKER, Role.ADMIN),
    async (req, res, next) => {
      try {
        const user = req.user!;
        const result = await db.withTransaction(async (tx) => {
          const itemsRes = await tx.query<{ quantity: number; picked_quantity: number; sku: string }>(
            'SELECT quantity, picked_quantity, sku FROM order_items WHERE order_id = $1',
            [req.params.orderId]
          );
          if (itemsRes.rowCount === 0) {
            throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
          }

          const unpicked = itemsRes.rows.filter(
            (i) => Number(i.picked_quantity) < Number(i.quantity)
          );
          if (unpicked.length > 0) {
            throw new HttpError(
              409,
              'UNPICKED_ITEMS_REMAIN',
              `Cannot pack order: ${unpicked.map((u) => u.sku).join(', ')} still require pick confirmation`
            );
          }

          return transitionOrderStatus(tx, {
            orderId: req.params.orderId,
            toStatus: OrderStatus.PACKED,
            actor: { id: user.id, name: user.fullName, role: user.role },
            reason: 'All items verified by scan/SKU and packed for dispatch',
          });
        });

        res.json({
          orderId: req.params.orderId,
          status: result.toStatus,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
