import { Router } from 'express';
import { DbClient } from '../db/index.ts';

export function createCatalogRouter(db: DbClient): Router {
  const router = Router();

  router.get('/regions', async (_req, res, next) => {
    try {
      const result = await db.query(
        `SELECT region_id AS "regionId", code, name, tax_rate AS "taxRate",
                shipping_rule_type AS "shippingRuleType",
                shipping_flat_cents AS "shippingFlatCents",
                shipping_free_threshold_cents AS "shippingFreeThresholdCents",
                refund_approval_limit_cents AS "refundApprovalLimitCents",
                return_window_days AS "returnWindowDays",
                reservation_expiry_minutes AS "reservationExpiryMinutes"
         FROM regions ORDER BY name ASC`
      );
      res.json({ regions: result.rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/warehouses', async (_req, res, next) => {
    try {
      const result = await db.query(
        `SELECT w.id, w.code, w.name, w.region_id AS "regionId", w.city, w.is_active AS "isActive",
                r.name AS "regionName", r.code AS "regionCode", r.tax_rate AS "taxRate",
                r.shipping_rule_type AS "shippingRuleType",
                r.shipping_flat_cents AS "shippingFlatCents",
                r.shipping_free_threshold_cents AS "shippingFreeThresholdCents",
                r.return_window_days AS "returnWindowDays",
                r.reservation_expiry_minutes AS "reservationExpiryMinutes"
         FROM warehouses w
         JOIN regions r ON r.region_id = w.region_id
         WHERE w.is_active = 1
         ORDER BY w.code ASC`
      );
      res.json({ warehouses: result.rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/products', async (req, res, next) => {
    try {
      const warehouseId = typeof req.query.warehouseId === 'string' && req.query.warehouseId
        ? req.query.warehouseId
        : 'wh-central';
      const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
      const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';

      const params: Array<string> = [warehouseId];
      let where = 'WHERE 1=1';
      if (search) {
        params.push(`%${search}%`);
        where += ` AND (LOWER(p.name) LIKE $${params.length} OR LOWER(p.sku) LIKE $${params.length} OR LOWER(p.category) LIKE $${params.length})`;
      }
      if (category && category !== 'All') {
        params.push(category);
        where += ` AND p.category = $${params.length}`;
      }

      const result = await db.query(
        `SELECT p.id, p.sku, p.barcode, p.name, p.category, p.description,
                p.price_cents AS "priceCents", p.low_stock_threshold AS "lowStockThreshold",
                COALESCE(ws.qty_available, 0) AS "qtyAvailable",
                COALESCE(ws.qty_reserved, 0) AS "qtyReserved",
                COALESCE(ws.qty_sold, 0) AS "qtySold",
                $1 AS "warehouseId"
         FROM products p
         LEFT JOIN warehouse_stock ws ON ws.product_id = p.id AND ws.warehouse_id = $1
         ${where}
         ORDER BY p.sku ASC`,
        params
      );
      res.json({ products: result.rows, warehouseId });
    } catch (err) {
      next(err);
    }
  });

  router.get('/products/:id', async (req, res, next) => {
    try {
      const warehouseId = typeof req.query.warehouseId === 'string' && req.query.warehouseId
        ? req.query.warehouseId
        : 'wh-central';
      const result = await db.query(
        `SELECT p.id, p.sku, p.barcode, p.name, p.category, p.description,
                p.price_cents AS "priceCents", p.low_stock_threshold AS "lowStockThreshold",
                COALESCE(ws.qty_available, 0) AS "qtyAvailable",
                COALESCE(ws.qty_reserved, 0) AS "qtyReserved",
                $2 AS "warehouseId"
         FROM products p
         LEFT JOIN warehouse_stock ws ON ws.product_id = p.id AND ws.warehouse_id = $2
         WHERE p.id = $1`,
        [req.params.id, warehouseId]
      );
      if (result.rowCount === 0) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found' });
        return;
      }
      res.json({ product: result.rows[0] });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
