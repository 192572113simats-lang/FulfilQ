import crypto from 'crypto';
import { OrderStatus } from '@fulfilliq/shared';
import { DbClient, DbExecutor } from '../db/index.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { writeAuditLog } from './auditService.ts';
import { transitionOrderStatus } from './orderStateMachine.ts';

export async function ensureSingleOpenLowStockAlert(
  tx: DbExecutor,
  warehouseId: string,
  productId: string,
  qtyAvailable: number,
  threshold: number
): Promise<boolean> {
  if (qtyAvailable > threshold) {
    return false;
  }

  const existing = await tx.query<{ id: string }>(
    `SELECT id FROM low_stock_alerts
     WHERE warehouse_id = $1 AND product_id = $2 AND status = 'OPEN'`,
    [warehouseId, productId]
  );
  if (existing.rowCount > 0) {
    return false;
  }

  const id = `alert-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    await tx.query(
      `INSERT INTO low_stock_alerts (id, warehouse_id, product_id, qty_at_trigger, threshold, status, created_at)
       VALUES ($1,$2,$3,$4,$5,'OPEN',$6)`,
      [id, warehouseId, productId, qtyAvailable, threshold, now]
    );
    return true;
  } catch {
    // Partial unique index guards concurrent duplicate OPEN alerts
    return false;
  }
}

export async function reserveStockForOrder(
  tx: DbExecutor,
  params: {
    orderId: string;
    warehouseId: string;
    items: Array<{ productId: string; quantity: number }>;
    expiresAt: string;
  }
): Promise<void> {
  const now = new Date().toISOString();

  for (const item of params.items) {
    const updated = await tx.query<{ qty_available: number; qty_reserved: number }>(
      `UPDATE warehouse_stock
       SET qty_available = qty_available - $1,
           qty_reserved = qty_reserved + $1,
           updated_at = $2
       WHERE warehouse_id = $3
         AND product_id = $4
         AND qty_available >= $1
       RETURNING qty_available, qty_reserved`,
      [item.quantity, now, params.warehouseId, item.productId]
    );

    if (updated.rowCount === 0) {
      throw new HttpError(
        409,
        'OUT_OF_STOCK',
        `Insufficient available stock in warehouse ${params.warehouseId} for product ${item.productId}`
      );
    }

    const resId = `res-${crypto.randomUUID()}`;
    await tx.query(
      `INSERT INTO stock_reservations (id, order_id, warehouse_id, product_id, quantity, status, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7)`,
      [resId, params.orderId, params.warehouseId, item.productId, item.quantity, params.expiresAt, now]
    );

    const prod = await tx.query<{ low_stock_threshold: number }>(
      'SELECT low_stock_threshold FROM products WHERE id = $1',
      [item.productId]
    );
    const threshold = Number(prod.rows[0]?.low_stock_threshold ?? 5);
    const newAvail = Number(updated.rows[0].qty_available);
    await ensureSingleOpenLowStockAlert(tx, params.warehouseId, item.productId, newAvail, threshold);
  }
}

export async function consumeReservationsOnPayment(tx: DbExecutor, orderId: string): Promise<void> {
  const now = new Date().toISOString();
  const rows = await tx.query<{
    id: string;
    warehouse_id: string;
    product_id: string;
    quantity: number;
  }>(
    `SELECT id, warehouse_id, product_id, quantity
     FROM stock_reservations
     WHERE order_id = $1 AND status = 'ACTIVE'`,
    [orderId]
  );

  for (const r of rows.rows) {
    await tx.query(
      `UPDATE stock_reservations SET status = 'CONSUMED', released_at = $1 WHERE id = $2`,
      [now, r.id]
    );
    await tx.query(
      `UPDATE warehouse_stock
       SET qty_reserved = qty_reserved - $1,
           qty_sold = qty_sold + $1,
           updated_at = $2
       WHERE warehouse_id = $3 AND product_id = $4 AND qty_reserved >= $1`,
      [r.quantity, now, r.warehouse_id, r.product_id]
    );
  }
}

export async function releaseExpiredReservations(db: DbClient, asOfIso?: string): Promise<number> {
  const nowIso = asOfIso ?? new Date().toISOString();
  const expired = await db.query<{
    id: string;
    order_id: string;
    warehouse_id: string;
    product_id: string;
    quantity: number;
  }>(
    `SELECT id, order_id, warehouse_id, product_id, quantity
     FROM stock_reservations
     WHERE status = 'ACTIVE' AND expires_at <= $1`,
    [nowIso]
  );

  if (expired.rowCount === 0) {
    return 0;
  }

  const byOrder = new Map<string, typeof expired.rows>();
  for (const row of expired.rows) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push(row);
    byOrder.set(row.order_id, list);
  }

  let releasedCount = 0;
  for (const [orderId, items] of byOrder.entries()) {
    await db.withTransaction(async (tx) => {
      const releaseTime = new Date().toISOString();
      let anyUpdated = false;
      for (const item of items) {
        const resUpdate = await tx.query<{ id: string }>(
          `UPDATE stock_reservations
           SET status = 'EXPIRED', released_at = $1
           WHERE id = $2 AND status = 'ACTIVE'
           RETURNING id`,
          [releaseTime, item.id]
        );
        if (resUpdate.rowCount > 0) {
          anyUpdated = true;
          releasedCount += 1;
          await tx.query(
            `UPDATE warehouse_stock
             SET qty_available = qty_available + $1,
                 qty_reserved = qty_reserved - $1,
                 updated_at = $2
             WHERE warehouse_id = $3 AND product_id = $4 AND qty_reserved >= $1`,
            [item.quantity, releaseTime, item.warehouse_id, item.product_id]
          );
        }
      }

      if (anyUpdated) {
        const ord = await tx.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
        const currentStatus = ord.rows[0]?.status as OrderStatus | undefined;
        if (currentStatus === OrderStatus.RESERVED || currentStatus === OrderStatus.PAYMENT_PENDING) {
          await transitionOrderStatus(tx, {
            orderId,
            toStatus: OrderStatus.EXPIRED,
            actor: { id: 'system-expiry-job', name: 'Reservation Expiry Job', role: 'system' },
            reason: 'Stock reservation window expired before payment confirmation',
          });
        }
      }
    });
  }

  return releasedCount;
}

export async function applyManualStockCorrection(
  db: DbClient,
  params: {
    warehouseId: string;
    productId: string;
    deltaQty: number;
    reason: string;
    actor: { id: string; name: string; role: string };
  }
): Promise<{ qtyAvailable: number; alertTriggered: boolean }> {
  return db.withTransaction(async (tx) => {
    const now = new Date().toISOString();
    const res = await tx.query<{ qty_available: number }>(
      `UPDATE warehouse_stock
       SET qty_available = qty_available + $1,
           updated_at = $2
       WHERE warehouse_id = $3
         AND product_id = $4
         AND (qty_available + $1) >= 0
       RETURNING qty_available`,
      [params.deltaQty, now, params.warehouseId, params.productId]
    );

    if (res.rowCount === 0) {
      throw new HttpError(
        409,
        'NEGATIVE_STOCK_PREVENTED',
        'Stock correction rejected: resulting available stock cannot be negative'
      );
    }

    const newQty = Number(res.rows[0].qty_available);
    const corrId = `corr-${crypto.randomUUID()}`;
    await tx.query(
      `INSERT INTO stock_corrections (id, warehouse_id, product_id, delta_qty, reason, requested_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [corrId, params.warehouseId, params.productId, params.deltaQty, params.reason, params.actor.id, now]
    );

    await writeAuditLog(tx, {
      entityType: 'stock',
      entityId: `${params.warehouseId}:${params.productId}`,
      action: 'MANUAL_STOCK_CORRECTION',
      fromState: String(newQty - params.deltaQty),
      toState: String(newQty),
      actorId: params.actor.id,
      actorName: params.actor.name,
      actorRole: params.actor.role,
      reason: params.reason,
      metadata: { deltaQty: params.deltaQty, correctionId: corrId },
      createdAt: now,
    });

    const prod = await tx.query<{ low_stock_threshold: number }>(
      'SELECT low_stock_threshold FROM products WHERE id = $1',
      [params.productId]
    );
    const threshold = Number(prod.rows[0]?.low_stock_threshold ?? 5);

    let alertTriggered = false;
    if (newQty <= threshold) {
      alertTriggered = await ensureSingleOpenLowStockAlert(
        tx,
        params.warehouseId,
        params.productId,
        newQty,
        threshold
      );
    } else {
      await tx.query(
        `UPDATE low_stock_alerts
         SET status = 'RESOLVED', resolved_at = $1, resolved_by = $2
         WHERE warehouse_id = $3 AND product_id = $4 AND status = 'OPEN'`,
        [now, params.actor.id, params.warehouseId, params.productId]
      );
    }

    return { qtyAvailable: newQty, alertTriggered };
  });
}
