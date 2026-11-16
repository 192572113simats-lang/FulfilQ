import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  CONTRACT_VERSION,
  CreateOrderPayloadSchema,
  deriveCustomerMilestones,
  OrderStatus,
  Role,
} from '@fulfilliq/shared';
import { DbClient } from '../db/index.ts';
import {
  maskEmail,
  maskPhone,
  requireAuth,
  requireRole,
  shouldMaskCustomerContact,
} from '../middleware/auth.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { writeAuditLog } from '../services/auditService.ts';
import { scheduleCsvSync } from '../services/csvService.ts';
import { reserveStockForOrder } from '../services/inventoryService.ts';
import { transitionOrderStatus } from '../services/orderStateMachine.ts';

const UpdateStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus),
  reason: z.string().trim().max(300).optional(),
});

export function createOrdersRouter(db: DbClient): Router {
  const router = Router();

  // S02: Place order with atomic stock reservation & regional policy calculation
  router.post(
    '/orders',
    requireAuth,
    requireRole(Role.CUSTOMER, Role.ADMIN),
    async (req, res, next) => {
      try {
        const payload = CreateOrderPayloadSchema.parse(req.body);
        const user = req.user!;

        // Merge duplicate productIds if submitted
        const mergedMap = new Map<string, number>();
        for (const item of payload.items) {
          mergedMap.set(item.productId, (mergedMap.get(item.productId) ?? 0) + item.quantity);
        }
        const mergedItems = Array.from(mergedMap.entries()).map(([productId, quantity]) => ({
          productId,
          quantity,
        }));

        // Load warehouse + region policy (no hardcoded region rules!)
        const whRes = await db.query<{
          warehouse_id: string;
          warehouse_name: string;
          region_id: string;
          region_name: string;
          tax_rate: number;
          shipping_rule_type: string;
          shipping_flat_cents: number;
          shipping_free_threshold_cents: number;
          reservation_expiry_minutes: number;
        }>(
          `SELECT w.id AS warehouse_id, w.name AS warehouse_name,
                  r.region_id, r.name AS region_name, r.tax_rate,
                  r.shipping_rule_type, r.shipping_flat_cents,
                  r.shipping_free_threshold_cents, r.reservation_expiry_minutes
           FROM warehouses w
           JOIN regions r ON r.region_id = w.region_id
           WHERE w.id = $1 AND w.is_active = 1`,
          [payload.warehouseId]
        );

        if (whRes.rowCount === 0) {
          throw new HttpError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found or inactive');
        }
        const wh = whRes.rows[0];

        // Validate products & prices
        const productRows: Array<{
          id: string;
          sku: string;
          barcode: string;
          name: string;
          price_cents: number;
          quantity: number;
        }> = [];
        let subtotalCents = 0;

        for (const item of mergedItems) {
          const pRes = await db.query<{
            id: string;
            sku: string;
            barcode: string;
            name: string;
            price_cents: number;
          }>('SELECT id, sku, barcode, name, price_cents FROM products WHERE id = $1', [
            item.productId,
          ]);
          if (pRes.rowCount === 0) {
            throw new HttpError(404, 'PRODUCT_NOT_FOUND', `Product ${item.productId} not found`);
          }
          const prod = pRes.rows[0];
          subtotalCents += Number(prod.price_cents) * item.quantity;
          productRows.push({ ...prod, quantity: item.quantity });
        }

        const taxCents = Math.round(subtotalCents * Number(wh.tax_rate));
        const shippingCents =
          wh.shipping_rule_type === 'threshold' &&
          subtotalCents >= Number(wh.shipping_free_threshold_cents)
            ? 0
            : Number(wh.shipping_flat_cents);
        const totalCents = subtotalCents + taxCents + shippingCents;

        const orderId = `ord-${crypto.randomUUID()}`;
        const orderNumber = `FIQ-${new Date().getUTCFullYear()}-${Math.floor(100000 + Math.random() * 899999)}`;
        const now = new Date();
        const expiryMinutes = Number(wh.reservation_expiry_minutes || 15);
        const reservedUntil = new Date(now.getTime() + expiryMinutes * 60_000).toISOString();
        const nowIso = now.toISOString();

        await db.withTransaction(async (tx) => {
          // 1. Insert order initially as PLACED
          await tx.query(
            `INSERT INTO orders (
              id, order_number, customer_id, warehouse_id, region_id, status,
              subtotal_cents, tax_cents, shipping_cents, total_cents,
              shipping_address_json, customer_note, internal_notes, reserved_until,
              created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'',$13,$14,$15)`,
            [
              orderId,
              orderNumber,
              user.id,
              wh.warehouse_id,
              wh.region_id,
              OrderStatus.PLACED,
              subtotalCents,
              taxCents,
              shippingCents,
              totalCents,
              JSON.stringify(payload.shippingAddress),
              payload.customerNote ?? '',
              reservedUntil,
              nowIso,
              nowIso,
            ]
          );

          for (const pr of productRows) {
            await tx.query(
              `INSERT INTO order_items (id, order_id, product_id, sku, name, barcode, quantity, picked_quantity, unit_price_cents)
               VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8)`,
              [
                `oi-${crypto.randomUUID()}`,
                orderId,
                pr.id,
                pr.sku,
                pr.name,
                pr.barcode,
                pr.quantity,
                pr.price_cents,
              ]
            );
          }

          await writeAuditLog(tx, {
            entityType: 'order',
            entityId: orderId,
            action: 'ORDER_PLACED',
            fromState: null,
            toState: OrderStatus.PLACED,
            actorId: user.id,
            actorName: user.fullName,
            actorRole: user.role,
            amountCents: totalCents,
            reason: 'Customer submitted checkout order',
            createdAt: nowIso,
          });

          // 2. Atomically reserve stock (throws 409 OUT_OF_STOCK & rolls back if insufficient)
          await reserveStockForOrder(tx, {
            orderId,
            warehouseId: wh.warehouse_id,
            items: mergedItems,
            expiresAt: reservedUntil,
          });

          // 3. Transition PLACED -> RESERVED
          await transitionOrderStatus(tx, {
            orderId,
            toStatus: OrderStatus.RESERVED,
            actor: { id: user.id, name: user.fullName, role: user.role },
            reason: `Stock reserved for ${expiryMinutes} minutes`,
          });
        });

        scheduleCsvSync(db);

        res.status(201).json({
          contractVersion: CONTRACT_VERSION,
          order: {
            id: orderId,
            orderNumber,
            customerId: user.id,
            warehouseId: wh.warehouse_id,
            warehouseName: wh.warehouse_name,
            regionId: wh.region_id,
            regionName: wh.region_name,
            status: OrderStatus.RESERVED,
            subtotalCents,
            taxCents,
            shippingCents,
            totalCents,
            shippingAddress: payload.shippingAddress,
            reservedUntil,
            createdAt: nowIso,
            updatedAt: nowIso,
            items: productRows.map((p) => ({
              productId: p.id,
              sku: p.sku,
              name: p.name,
              barcode: p.barcode,
              quantity: p.quantity,
              pickedQuantity: 0,
              unitPriceCents: p.price_cents,
            })),
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // List orders scoped strictly by role
  router.get('/orders', requireAuth, async (req, res, next) => {
    try {
      const user = req.user!;
      const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';
      const warehouseFilter = typeof req.query.warehouseId === 'string' ? req.query.warehouseId : '';

      const params: Array<string> = [];
      let where = 'WHERE 1=1';

      if (user.role === Role.CUSTOMER) {
        params.push(user.id);
        where += ` AND o.customer_id = $${params.length}`;
      } else if (user.role === Role.PICKER) {
        // Pickers NEVER see unpaid orders
        where += ` AND o.status IN ('PAID','PICKING','PACKED')`;
      }

      if (statusFilter) {
        params.push(statusFilter);
        where += ` AND o.status = $${params.length}`;
      }
      if (warehouseFilter) {
        params.push(warehouseFilter);
        where += ` AND o.warehouse_id = $${params.length}`;
      }

      const result = await db.query<{
        id: string;
        order_number: string;
        customer_id: string;
        customer_email: string;
        customer_phone: string;
        warehouse_id: string;
        warehouse_name: string;
        region_id: string;
        region_name: string;
        status: OrderStatus;
        subtotal_cents: number;
        tax_cents: number;
        shipping_cents: number;
        total_cents: number;
        reserved_until: string | null;
        assigned_picker_id: string | null;
        delivered_at: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT o.id, o.order_number, o.customer_id, u.email AS customer_email, u.phone AS customer_phone,
                o.warehouse_id, w.name AS warehouse_name, o.region_id, r.name AS region_name,
                o.status, o.subtotal_cents, o.tax_cents, o.shipping_cents, o.total_cents,
                o.reserved_until, o.assigned_picker_id, o.delivered_at, o.created_at, o.updated_at
         FROM orders o
         JOIN users u ON u.id = o.customer_id
         JOIN warehouses w ON w.id = o.warehouse_id
         JOIN regions r ON r.region_id = o.region_id
         ${where}
         ORDER BY o.created_at DESC`,
        params
      );

      const mask = shouldMaskCustomerContact(user.role);
      const orders = result.rows.map((o) => ({
        contractVersion: CONTRACT_VERSION,
        id: o.id,
        orderNumber: o.order_number,
        customerId: o.customer_id,
        customerEmail: mask ? maskEmail(o.customer_email) : o.customer_email,
        customerPhone: mask ? maskPhone(o.customer_phone) : o.customer_phone,
        warehouseId: o.warehouse_id,
        warehouseName: o.warehouse_name,
        regionId: o.region_id,
        regionName: o.region_name,
        status: o.status,
        subtotalCents: Number(o.subtotal_cents),
        taxCents: Number(o.tax_cents),
        shippingCents: Number(o.shipping_cents),
        totalCents: Number(o.total_cents),
        reservedUntil: o.reserved_until,
        assignedPickerId: o.assigned_picker_id,
        deliveredAt: o.delivered_at,
        createdAt: o.created_at,
        updatedAt: o.updated_at,
      }));

      res.json({ orders });
    } catch (err) {
      next(err);
    }
  });

  // Get single order detail (RBAC + privacy enforced)
  router.get('/orders/:id', requireAuth, async (req, res, next) => {
    try {
      const user = req.user!;
      const orderRes = await db.query<{
        id: string;
        order_number: string;
        customer_id: string;
        customer_email: string;
        customer_phone: string;
        warehouse_id: string;
        warehouse_name: string;
        region_id: string;
        region_name: string;
        return_window_days: number;
        status: OrderStatus;
        subtotal_cents: number;
        tax_cents: number;
        shipping_cents: number;
        total_cents: number;
        shipping_address_json: string;
        customer_note: string;
        internal_notes: string;
        reserved_until: string | null;
        assigned_picker_id: string | null;
        delivered_at: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT o.*, u.email AS customer_email, u.phone AS customer_phone,
                w.name AS warehouse_name, r.name AS region_name, r.return_window_days
         FROM orders o
         JOIN users u ON u.id = o.customer_id
         JOIN warehouses w ON w.id = o.warehouse_id
         JOIN regions r ON r.region_id = o.region_id
         WHERE o.id = $1 OR o.order_number = $1`,
        [req.params.id]
      );

      if (orderRes.rowCount === 0) {
        throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      }
      const o = orderRes.rows[0];

      if (user.role === Role.CUSTOMER && o.customer_id !== user.id) {
        throw new HttpError(403, 'FORBIDDEN', 'Customers can only view their own orders');
      }

      if (
        user.role === Role.PICKER &&
        ![OrderStatus.PAID, OrderStatus.PICKING, OrderStatus.PACKED].includes(o.status)
      ) {
        throw new HttpError(403, 'FORBIDDEN', 'Pickers cannot view unpaid or non-pickable orders');
      }

      const itemsRes = await db.query(
        `SELECT id, product_id AS "productId", sku, name, barcode, quantity,
                picked_quantity AS "pickedQuantity", unit_price_cents AS "unitPriceCents"
         FROM order_items WHERE order_id = $1`,
        [o.id]
      );

      const historyRes = await db.query<{
        id: string;
        action: string;
        from_state: string | null;
        to_state: string | null;
        actor_name: string;
        actor_role: string;
        reason: string | null;
        created_at: string;
      }>(
        `SELECT id, action, from_state, to_state, actor_name, actor_role, reason, created_at
         FROM audit_logs
         WHERE entity_type = 'order' AND entity_id = $1
         ORDER BY created_at ASC`,
        [o.id]
      );

      const returnRes = await db.query(
        `SELECT id, status, reason, requested_amount_cents AS "requestedAmountCents",
                decision_reason AS "decisionReason", decided_at AS "decidedAt", created_at AS "createdAt"
         FROM returns WHERE order_id = $1`,
        [o.id]
      );

      const paymentRes = await db.query(
        `SELECT id, status, gateway_used AS "gatewayUsed", gateway_ref AS "gatewayRef",
                amount_cents AS "amountCents", synthetic_card_last4 AS "syntheticCardLast4",
                retry_count AS "retryCount", next_retry_at AS "nextRetryAt", last_error AS "lastError"
         FROM payment_intents WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [o.id]
      );

      const mask = shouldMaskCustomerContact(user.role);
      const rawAddr = JSON.parse(o.shipping_address_json) as Record<string, string>;
      const shippingAddress = mask
        ? { ...rawAddr, phone: maskPhone(rawAddr.phone || '') }
        : rawAddr;

      res.json({
        contractVersion: CONTRACT_VERSION,
        order: {
          id: o.id,
          orderNumber: o.order_number,
          customerId: o.customer_id,
          customerEmail: mask ? maskEmail(o.customer_email) : o.customer_email,
          customerPhone: mask ? maskPhone(o.customer_phone) : o.customer_phone,
          warehouseId: o.warehouse_id,
          warehouseName: o.warehouse_name,
          regionId: o.region_id,
          regionName: o.region_name,
          returnWindowDays: Number(o.return_window_days),
          status: o.status,
          subtotalCents: Number(o.subtotal_cents),
          taxCents: Number(o.tax_cents),
          shippingCents: Number(o.shipping_cents),
          totalCents: Number(o.total_cents),
          shippingAddress,
          customerNote: o.customer_note,
          // Customers never see internal_notes
          ...(user.role !== Role.CUSTOMER ? { internalNotes: o.internal_notes } : {}),
          reservedUntil: o.reserved_until,
          assignedPickerId: o.assigned_picker_id,
          deliveredAt: o.delivered_at,
          createdAt: o.created_at,
          updatedAt: o.updated_at,
          items: itemsRes.rows,
          returnRequest: returnRes.rows[0] ?? null,
          paymentIntent: paymentRes.rows[0] ?? null,
          history:
            user.role === Role.CUSTOMER
              ? historyRes.rows.map((h) => ({
                  toStatus: h.to_state,
                  createdAt: h.created_at,
                }))
              : historyRes.rows.map((h) => ({
                  id: h.id,
                  action: h.action,
                  fromStatus: h.from_state,
                  toStatus: h.to_state,
                  actorName: h.actor_name,
                  actorRole: h.actor_role,
                  reason: h.reason,
                  createdAt: h.created_at,
                })),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // S05: Dispatch & strict status transition
  router.patch(
    '/orders/:id/status',
    requireAuth,
    requireRole(Role.STORE_MANAGER, Role.ADMIN),
    async (req, res, next) => {
      try {
        const body = UpdateStatusSchema.parse(req.body);
        const user = req.user!;

        // Disallow bypassing refund approval via generic status patch
        if (
          body.status === OrderStatus.REFUNDED ||
          body.status === OrderStatus.REFUND_REJECTED
        ) {
          throw new HttpError(
            403,
            'FORBIDDEN',
            'Refund decisions must be executed via /api/returns/:id/decision by finance_reviewer or admin'
          );
        }

        const result = await db.withTransaction(async (tx) => {
          return transitionOrderStatus(tx, {
            orderId: req.params.id,
            toStatus: body.status,
            actor: { id: user.id, name: user.fullName, role: user.role },
            reason: body.reason,
          });
        });

        scheduleCsvSync(db);

        res.json({
          orderId: req.params.id,
          fromStatus: result.fromStatus,
          status: result.toStatus,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // S06: Customer-facing accessible tracking timeline (permitted milestones only, no internal notes)
  router.get('/orders/:id/tracking', requireAuth, async (req, res, next) => {
    try {
      const user = req.user!;
      const ordRes = await db.query<{
        id: string;
        order_number: string;
        customer_id: string;
        status: OrderStatus;
        warehouse_name: string;
        region_name: string;
        delivered_at: string | null;
        created_at: string;
      }>(
        `SELECT o.id, o.order_number, o.customer_id, o.status,
                w.name AS warehouse_name, r.name AS region_name,
                o.delivered_at, o.created_at
         FROM orders o
         JOIN warehouses w ON w.id = o.warehouse_id
         JOIN regions r ON r.region_id = o.region_id
         WHERE o.id = $1 OR o.order_number = $1`,
        [req.params.id]
      );

      if (ordRes.rowCount === 0) {
        throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      }
      const order = ordRes.rows[0];
      if (user.role === Role.CUSTOMER && order.customer_id !== user.id) {
        throw new HttpError(403, 'FORBIDDEN', 'Customers can only track their own orders');
      }

      const histRes = await db.query<{ to_state: string; created_at: string }>(
        `SELECT to_state, created_at FROM audit_logs
         WHERE entity_type = 'order' AND entity_id = $1 AND to_state IS NOT NULL
         ORDER BY created_at ASC`,
        [order.id]
      );

      const milestones = deriveCustomerMilestones(
        order.status,
        histRes.rows.map((r) => ({ toStatus: r.to_state, createdAt: r.created_at }))
      );

      res.json({
        orderId: order.id,
        orderNumber: order.order_number,
        status: order.status,
        warehouseName: order.warehouse_name,
        regionName: order.region_name,
        deliveredAt: order.delivered_at,
        createdAt: order.created_at,
        milestones,
      });
    } catch (err) {
      next(err);
    }
  });

  // S10: Support order lookup by order ID, order number, email, or phone fragment
  router.get(
    '/support/orders',
    requireAuth,
    requireRole(Role.SUPPORT_AGENT, Role.ADMIN),
    async (req, res, next) => {
      try {
        const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
        const params: string[] = [];
        let where = '';
        if (q) {
          params.push(`%${q}%`);
          where = `WHERE (
            LOWER(o.id) LIKE $1 OR
            LOWER(o.order_number) LIKE $1 OR
            LOWER(u.email) LIKE $1 OR
            LOWER(u.phone) LIKE $1 OR
            LOWER(u.full_name) LIKE $1
          )`;
        }

        const result = await db.query<{
          id: string;
          order_number: string;
          status: OrderStatus;
          total_cents: number;
          warehouse_name: string;
          region_name: string;
          customer_email: string;
          customer_phone: string;
          customer_name: string;
          created_at: string;
          return_status: string | null;
          return_reason: string | null;
          decision_reason: string | null;
          payment_status: string | null;
        }>(
          `SELECT o.id, o.order_number, o.status, o.total_cents,
                  w.name AS warehouse_name, r.name AS region_name,
                  u.email AS customer_email, u.phone AS customer_phone, u.full_name AS customer_name,
                  o.created_at,
                  ret.status AS return_status, ret.reason AS return_reason, ret.decision_reason,
                  pi.status AS payment_status
           FROM orders o
           JOIN users u ON u.id = o.customer_id
           JOIN warehouses w ON w.id = o.warehouse_id
           JOIN regions r ON r.region_id = o.region_id
           LEFT JOIN returns ret ON ret.order_id = o.id
           LEFT JOIN payment_intents pi ON pi.order_id = o.id
           ${where}
           ORDER BY o.created_at DESC
           LIMIT 50`,
          params
        );

        res.json({
          orders: result.rows.map((r) => ({
            id: r.id,
            orderNumber: r.order_number,
            status: r.status,
            totalCents: Number(r.total_cents),
            warehouseName: r.warehouse_name,
            regionName: r.region_name,
            customerName: r.customer_name,
            customerEmail: r.customer_email,
            customerPhone: r.customer_phone,
            createdAt: r.created_at,
            paymentStatus: r.payment_status,
            returnStatus: r.return_status,
            returnReason: r.return_reason,
            refundDecisionReason: r.decision_reason,
          })),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
