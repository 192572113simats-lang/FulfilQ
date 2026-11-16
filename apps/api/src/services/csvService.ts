import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { OrderStatus, Role } from '@fulfilliq/shared';
import { getConfig } from '../config.ts';
import { DbClient } from '../db/index.ts';
import { AuthUser, maskEmail, maskPhone, shouldMaskCustomerContact } from '../middleware/auth.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { writeAuditLog } from './auditService.ts';
import {
  consumeReservationsOnPayment,
  ensureSingleOpenLowStockAlert,
  reserveStockForOrder,
} from './inventoryService.ts';
import { transitionOrderStatus } from './orderStateMachine.ts';

export type CsvDataset = 'users' | 'inventory' | 'orders' | 'returns' | 'audit';

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsvString(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * RFC-4180 compliant CSV parser handling quoted commas, escaped quotes (""), and CRLF/LF.
 */
export function parseCsvRecords(csvText: string): Array<Record<string, string>> {
  const input = csvText.replace(/^\uFEFF/, '').trim();
  if (!input) return [];

  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r') {
        if (input[i + 1] === '\n') i += 1;
        row.push(field);
        matrix.push(row);
        row = [];
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        matrix.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  row.push(field);
  if (row.some((cell) => cell.length > 0)) {
    matrix.push(row);
  }

  if (matrix.length < 2) return [];
  const headers = matrix[0].map((h) => h.trim());
  const records: Array<Record<string, string>> = [];

  for (let r = 1; r < matrix.length; r++) {
    const values = matrix[r];
    if (values.every((v) => v.trim() === '')) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (values[c] ?? '').trim();
    }
    records.push(obj);
  }

  return records;
}

export function getCsvFileMap(): Record<CsvDataset, string> {
  const dir = path.resolve(getConfig().csvDir);
  return {
    users: path.join(dir, 'users.csv'),
    inventory: path.join(dir, 'inventory.csv'),
    orders: path.join(dir, 'orders_sales.csv'),
    returns: path.join(dir, 'returns.csv'),
    audit: path.join(dir, 'audit_logs.csv'),
  };
}

export async function exportDatasetCsv(
  db: DbClient,
  dataset: CsvDataset,
  viewerRole: Role
): Promise<{ filename: string; csv: string; rowCount: number }> {
  const mask = shouldMaskCustomerContact(viewerRole);

  if (dataset === 'users') {
    const res = await db.query<{
      id: string;
      email: string;
      full_name: string;
      phone: string;
      role: string;
      warehouse_id: string | null;
      is_active: number;
      created_at: string;
    }>('SELECT id, email, full_name, phone, role, warehouse_id, is_active, created_at FROM users ORDER BY created_at ASC');
    const headers = ['id', 'email', 'full_name', 'phone', 'role', 'warehouse_id', 'is_active', 'created_at'];
    return {
      filename: 'users.csv',
      csv: toCsvString(headers, res.rows),
      rowCount: res.rowCount,
    };
  }

  if (dataset === 'inventory') {
    const res = await db.query(
      `SELECT ws.warehouse_id, w.code AS warehouse_code, p.id AS product_id, p.sku, p.barcode,
              p.name, p.category, p.description, p.price_cents, p.low_stock_threshold,
              ws.qty_available, ws.qty_reserved, ws.qty_sold, ws.updated_at
       FROM warehouse_stock ws
       JOIN warehouses w ON w.id = ws.warehouse_id
       JOIN products p ON p.id = ws.product_id
       ORDER BY w.code ASC, p.sku ASC`
    );
    const headers = [
      'warehouse_id',
      'warehouse_code',
      'product_id',
      'sku',
      'barcode',
      'name',
      'category',
      'description',
      'price_cents',
      'low_stock_threshold',
      'qty_available',
      'qty_reserved',
      'qty_sold',
      'updated_at',
    ];
    return {
      filename: 'inventory.csv',
      csv: toCsvString(headers, res.rows),
      rowCount: res.rowCount,
    };
  }

  if (dataset === 'orders') {
    const res = await db.query<{
      order_id: string;
      order_number: string;
      customer_email: string;
      customer_phone: string;
      warehouse_id: string;
      region_id: string;
      status: string;
      subtotal_cents: number;
      tax_cents: number;
      shipping_cents: number;
      total_cents: number;
      created_at: string;
      delivered_at: string | null;
    }>(
      `SELECT o.id AS order_id, o.order_number, u.email AS customer_email, u.phone AS customer_phone,
              o.warehouse_id, o.region_id, o.status, o.subtotal_cents, o.tax_cents,
              o.shipping_cents, o.total_cents, o.created_at, o.delivered_at
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       ORDER BY o.created_at DESC`
    );
    const rows = res.rows.map((r) => ({
      ...r,
      customer_email: mask ? maskEmail(r.customer_email) : r.customer_email,
      customer_phone: mask ? maskPhone(r.customer_phone) : r.customer_phone,
    }));
    const headers = [
      'order_id',
      'order_number',
      'customer_email',
      'customer_phone',
      'warehouse_id',
      'region_id',
      'status',
      'subtotal_cents',
      'tax_cents',
      'shipping_cents',
      'total_cents',
      'created_at',
      'delivered_at',
    ];
    return {
      filename: 'orders_sales.csv',
      csv: toCsvString(headers, rows),
      rowCount: rows.length,
    };
  }

  if (dataset === 'returns') {
    const res = await db.query<{
      id: string;
      order_id: string;
      order_number: string;
      customer_email: string;
      region_id: string;
      status: string;
      requested_amount_cents: number;
      reason: string;
      decision_reason: string | null;
      decided_at: string | null;
      created_at: string;
    }>(
      `SELECT ret.id, ret.order_id, o.order_number, u.email AS customer_email, ret.region_id,
              ret.status, ret.requested_amount_cents, ret.reason, ret.decision_reason,
              ret.decided_at, ret.created_at
       FROM returns ret
       JOIN orders o ON o.id = ret.order_id
       JOIN users u ON u.id = ret.customer_id
       ORDER BY ret.created_at DESC`
    );
    const rows = res.rows.map((r) => ({
      ...r,
      customer_email: mask ? maskEmail(r.customer_email) : r.customer_email,
    }));
    const headers = [
      'id',
      'order_id',
      'order_number',
      'customer_email',
      'region_id',
      'status',
      'requested_amount_cents',
      'reason',
      'decision_reason',
      'decided_at',
      'created_at',
    ];
    return {
      filename: 'returns.csv',
      csv: toCsvString(headers, rows),
      rowCount: rows.length,
    };
  }

  const res = await db.query(
    `SELECT id, entity_type, entity_id, action, from_state, to_state,
            actor_id, actor_name, actor_role, amount_cents, reason, created_at
     FROM audit_logs ORDER BY created_at DESC LIMIT 1000`
  );
  const headers = [
    'id',
    'entity_type',
    'entity_id',
    'action',
    'from_state',
    'to_state',
    'actor_id',
    'actor_name',
    'actor_role',
    'amount_cents',
    'reason',
    'created_at',
  ];
  return {
    filename: 'audit_logs.csv',
    csv: toCsvString(headers, res.rows),
    rowCount: res.rowCount,
  };
}

/**
 * Persists full local CSV mirrors on disk under CSV_DIR (default ./data/csv).
 */
export async function syncLocalCsvFiles(db: DbClient): Promise<Array<{ dataset: CsvDataset; path: string; rows: number }>> {
  const dir = path.resolve(getConfig().csvDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const map = getCsvFileMap();
  const datasets: CsvDataset[] = ['users', 'inventory', 'orders', 'returns', 'audit'];
  const summary: Array<{ dataset: CsvDataset; path: string; rows: number }> = [];

  for (const ds of datasets) {
    const exp = await exportDatasetCsv(db, ds, Role.ADMIN);
    fs.writeFileSync(map[ds], exp.csv, 'utf8');
    summary.push({ dataset: ds, path: map[ds], rows: exp.rowCount });
  }
  return summary;
}

const pendingSyncTimers = new WeakMap<DbClient, NodeJS.Timeout>();

/**
 * Debounced background local CSV mirror sync after operational mutations.
 * Skipped in test env to avoid dangling handles across ephemeral SQLite tear-downs.
 */
export function scheduleCsvSync(db: DbClient): void {
  if (process.env.NODE_ENV === 'test') return;
  const existing = pendingSyncTimers.get(db);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingSyncTimers.delete(db);
    syncLocalCsvFiles(db).catch(() => {
      // Non-fatal background sync error
    });
  }, 100);
  timer.unref?.();
  pendingSyncTimers.set(db, timer);
}

const CsvUserRowSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).default('DemoPass123!'),
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(5).max(30).default('+1-555-0190'),
  role: z.nativeEnum(Role).default(Role.CUSTOMER),
  warehouse_id: z.string().trim().optional().default(''),
});

const CsvInventoryRowSchema = z.object({
  sku: z.string().trim().min(2).max(40),
  barcode: z.string().trim().min(4).max(40),
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60).default('General'),
  description: z.string().trim().max(400).default('Synthetic catalog item imported via CSV'),
  price_cents: z.coerce.number().int().min(1),
  low_stock_threshold: z.coerce.number().int().min(0).max(1000).default(5),
  warehouse_id: z.string().trim().min(1).default('wh-central'),
  qty_available: z.coerce.number().int().min(0),
});

const CsvOrderRowSchema = z.object({
  customer_email: z.string().trim().email(),
  warehouse_id: z.string().trim().min(1).default('wh-central'),
  product_sku: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1).max(100),
  recipient_name: z.string().trim().min(2).max(120),
  line1: z.string().trim().min(3).max(160),
  city: z.string().trim().min(2).max(80),
  postal_code: z.string().trim().min(3).max(20),
  phone: z.string().trim().min(6).max(30),
  mark_paid: z.string().optional().default('false'),
});

export interface CsvImportReport {
  dataset: 'users' | 'inventory' | 'orders';
  createdCount: number;
  updatedCount: number;
  errors: Array<{ row: number; message: string }>;
}

export async function importCsvDataset(
  db: DbClient,
  dataset: 'users' | 'inventory' | 'orders',
  csvText: string,
  actor: AuthUser
): Promise<CsvImportReport> {
  const rows = parseCsvRecords(csvText);
  if (rows.length === 0) {
    throw new HttpError(400, 'EMPTY_CSV', 'CSV file has no data rows (header + at least 1 row required)');
  }

  let createdCount = 0;
  let updatedCount = 0;
  const errors: Array<{ row: number; message: string }> = [];
  const now = new Date().toISOString();

  if (dataset === 'users') {
    for (let i = 0; i < rows.length; i++) {
      try {
        const parsed = CsvUserRowSchema.parse({
          ...rows[i],
          password: rows[i].password || 'DemoPass123!',
          role: (rows[i].role || Role.CUSTOMER) as Role,
        });
        const existing = await db.query<{ id: string }>(
          'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
          [parsed.email]
        );
        const passwordHash = await bcrypt.hash(parsed.password, 10);
        const whId = parsed.warehouse_id ? parsed.warehouse_id : null;

        if (existing.rowCount > 0) {
          await db.query(
            `UPDATE users SET full_name = $1, phone = $2, role = $3, warehouse_id = $4, password_hash = $5 WHERE id = $6`,
            [parsed.full_name, parsed.phone, parsed.role, whId, passwordHash, existing.rows[0].id]
          );
          updatedCount += 1;
        } else {
          const userId = `usr-${crypto.randomUUID()}`;
          await db.query(
            `INSERT INTO users (id, email, password_hash, full_name, phone, role, warehouse_id, is_active, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)`,
            [userId, parsed.email.toLowerCase(), passwordHash, parsed.full_name, parsed.phone, parsed.role, whId, now]
          );
          await writeAuditLog(db, {
            entityType: 'user',
            entityId: userId,
            action: 'CSV_USER_CREATED',
            toState: parsed.role,
            actorId: actor.id,
            actorName: actor.fullName,
            actorRole: actor.role,
            reason: `Imported user ${parsed.email} from CSV`,
            createdAt: now,
          });
          createdCount += 1;
        }
      } catch (err) {
        errors.push({
          row: i + 2,
          message: err instanceof Error ? err.message : 'Invalid user CSV row',
        });
      }
    }
  } else if (dataset === 'inventory') {
    for (let i = 0; i < rows.length; i++) {
      try {
        const parsed = CsvInventoryRowSchema.parse(rows[i]);
        const whRes = await db.query<{ id: string }>('SELECT id FROM warehouses WHERE id = $1', [
          parsed.warehouse_id,
        ]);
        if (whRes.rowCount === 0) {
          throw new Error(`Warehouse '${parsed.warehouse_id}' not found`);
        }

        await db.withTransaction(async (tx) => {
          const prodRes = await tx.query<{ id: string }>('SELECT id FROM products WHERE sku = $1', [
            parsed.sku,
          ]);
          let productId: string;
          if (prodRes.rowCount > 0) {
            productId = prodRes.rows[0].id;
            await tx.query(
              `UPDATE products SET name = $1, category = $2, description = $3, price_cents = $4, low_stock_threshold = $5 WHERE id = $6`,
              [
                parsed.name,
                parsed.category,
                parsed.description,
                parsed.price_cents,
                parsed.low_stock_threshold,
                productId,
              ]
            );
            updatedCount += 1;
          } else {
            productId = `prod-${crypto.randomUUID().slice(0, 8)}`;
            await tx.query(
              `INSERT INTO products (id, sku, barcode, name, category, description, price_cents, low_stock_threshold, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                productId,
                parsed.sku,
                parsed.barcode,
                parsed.name,
                parsed.category,
                parsed.description,
                parsed.price_cents,
                parsed.low_stock_threshold,
                now,
              ]
            );
            // Initialize stock=0 on other warehouses
            const allWh = await tx.query<{ id: string }>('SELECT id FROM warehouses');
            for (const w of allWh.rows) {
              if (w.id !== parsed.warehouse_id) {
                await tx.query(
                  `INSERT INTO warehouse_stock (warehouse_id, product_id, qty_available, qty_reserved, qty_sold, updated_at)
                   VALUES ($1,$2,0,0,0,$3)`,
                  [w.id, productId, now]
                );
              }
            }
            createdCount += 1;
          }

          const wsRes = await tx.query<{ qty_available: number }>(
            'SELECT qty_available FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2',
            [parsed.warehouse_id, productId]
          );
          if (wsRes.rowCount > 0) {
            await tx.query(
              `UPDATE warehouse_stock SET qty_available = $1, updated_at = $2 WHERE warehouse_id = $3 AND product_id = $4`,
              [parsed.qty_available, now, parsed.warehouse_id, productId]
            );
          } else {
            await tx.query(
              `INSERT INTO warehouse_stock (warehouse_id, product_id, qty_available, qty_reserved, qty_sold, updated_at)
               VALUES ($1,$2,$3,0,0,$4)`,
              [parsed.warehouse_id, productId, parsed.qty_available, now]
            );
          }

          if (parsed.qty_available <= parsed.low_stock_threshold) {
            await ensureSingleOpenLowStockAlert(
              tx,
              parsed.warehouse_id,
              productId,
              parsed.qty_available,
              parsed.low_stock_threshold
            );
          } else {
            await tx.query(
              `UPDATE low_stock_alerts SET status = 'RESOLVED', resolved_at = $1, resolved_by = $2
               WHERE warehouse_id = $3 AND product_id = $4 AND status = 'OPEN'`,
              [now, actor.id, parsed.warehouse_id, productId]
            );
          }

          await writeAuditLog(tx, {
            entityType: 'stock',
            entityId: `${parsed.warehouse_id}:${productId}`,
            action: 'CSV_INVENTORY_UPSERT',
            toState: String(parsed.qty_available),
            actorId: actor.id,
            actorName: actor.fullName,
            actorRole: actor.role,
            reason: `CSV import for SKU ${parsed.sku}`,
            createdAt: now,
          });
        });
      } catch (err) {
        errors.push({
          row: i + 2,
          message: err instanceof Error ? err.message : 'Invalid inventory CSV row',
        });
      }
    }
  } else if (dataset === 'orders') {
    for (let i = 0; i < rows.length; i++) {
      try {
        const parsed = CsvOrderRowSchema.parse(rows[i]);
        if (
          actor.role === Role.CUSTOMER &&
          parsed.customer_email.toLowerCase() !== actor.email.toLowerCase()
        ) {
          throw new Error('Customers can only import orders for their own email address');
        }

        const custRes = await db.query<{ id: string; full_name: string; role: string }>(
          'SELECT id, full_name, role FROM users WHERE LOWER(email) = LOWER($1)',
          [parsed.customer_email]
        );
        if (custRes.rowCount === 0) {
          throw new Error(`Customer '${parsed.customer_email}' does not exist`);
        }
        const customer = custRes.rows[0];

        const whRes = await db.query<{
          warehouse_id: string;
          region_id: string;
          tax_rate: number;
          shipping_rule_type: string;
          shipping_flat_cents: number;
          shipping_free_threshold_cents: number;
          reservation_expiry_minutes: number;
        }>(
          `SELECT w.id AS warehouse_id, r.region_id, r.tax_rate, r.shipping_rule_type,
                  r.shipping_flat_cents, r.shipping_free_threshold_cents, r.reservation_expiry_minutes
           FROM warehouses w JOIN regions r ON r.region_id = w.region_id
           WHERE w.id = $1 AND w.is_active = 1`,
          [parsed.warehouse_id]
        );
        if (whRes.rowCount === 0) {
          throw new Error(`Warehouse '${parsed.warehouse_id}' not found`);
        }
        const wh = whRes.rows[0];

        const prodRes = await db.query<{
          id: string;
          sku: string;
          barcode: string;
          name: string;
          price_cents: number;
        }>('SELECT id, sku, barcode, name, price_cents FROM products WHERE sku = $1', [
          parsed.product_sku,
        ]);
        if (prodRes.rowCount === 0) {
          throw new Error(`Product SKU '${parsed.product_sku}' not found`);
        }
        const prod = prodRes.rows[0];

        const subtotalCents = Number(prod.price_cents) * parsed.quantity;
        const taxCents = Math.round(subtotalCents * Number(wh.tax_rate));
        const shippingCents =
          wh.shipping_rule_type === 'threshold' &&
          subtotalCents >= Number(wh.shipping_free_threshold_cents)
            ? 0
            : Number(wh.shipping_flat_cents);
        const totalCents = subtotalCents + taxCents + shippingCents;

        const orderId = `ord-${crypto.randomUUID()}`;
        const orderNumber = `FIQ-${new Date().getUTCFullYear()}-${Math.floor(100000 + Math.random() * 899999)}`;
        const reservedUntil = new Date(
          Date.now() + Number(wh.reservation_expiry_minutes || 15) * 60_000
        ).toISOString();
        const addressJson = JSON.stringify({
          recipientName: parsed.recipient_name,
          line1: parsed.line1,
          line2: '',
          city: parsed.city,
          postalCode: parsed.postal_code,
          country: 'Synthetic Republic',
          phone: parsed.phone,
        });
        const shouldPay = ['true', '1', 'yes'].includes(parsed.mark_paid.toLowerCase());

        await db.withTransaction(async (tx) => {
          await tx.query(
            `INSERT INTO orders (
              id, order_number, customer_id, warehouse_id, region_id, status,
              subtotal_cents, tax_cents, shipping_cents, total_cents,
              shipping_address_json, customer_note, internal_notes, reserved_until,
              created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Imported via CSV','',$12,$13,$14)`,
            [
              orderId,
              orderNumber,
              customer.id,
              wh.warehouse_id,
              wh.region_id,
              OrderStatus.PLACED,
              subtotalCents,
              taxCents,
              shippingCents,
              totalCents,
              addressJson,
              reservedUntil,
              now,
              now,
            ]
          );

          await tx.query(
            `INSERT INTO order_items (id, order_id, product_id, sku, name, barcode, quantity, picked_quantity, unit_price_cents)
             VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8)`,
            [
              `oi-${crypto.randomUUID()}`,
              orderId,
              prod.id,
              prod.sku,
              prod.name,
              prod.barcode,
              parsed.quantity,
              prod.price_cents,
            ]
          );

          await writeAuditLog(tx, {
            entityType: 'order',
            entityId: orderId,
            action: 'CSV_ORDER_PLACED',
            toState: OrderStatus.PLACED,
            actorId: actor.id,
            actorName: actor.fullName,
            actorRole: actor.role,
            amountCents: totalCents,
            reason: `Imported sale/order for ${parsed.customer_email} via CSV`,
            createdAt: now,
          });

          await reserveStockForOrder(tx, {
            orderId,
            warehouseId: wh.warehouse_id,
            items: [{ productId: prod.id, quantity: parsed.quantity }],
            expiresAt: reservedUntil,
          });

          await transitionOrderStatus(tx, {
            orderId,
            toStatus: OrderStatus.RESERVED,
            actor: { id: actor.id, name: actor.fullName, role: actor.role },
            reason: 'Reserved stock for CSV order import',
          });

          if (shouldPay) {
            const piId = `pi-${crypto.randomUUID()}`;
            const idemKey = `csv-idem-${orderId}`;
            await tx.query(
              `INSERT INTO payment_intents (
                id, order_id, idempotency_key, amount_cents, status, gateway_used, gateway_ref,
                synthetic_card_last4, retry_count, created_at, updated_at
              ) VALUES ($1,$2,$3,$4,'SUCCEEDED','local_stub',$5,'4242',0,$6,$7)`,
              [piId, orderId, idemKey, totalCents, `stub_csv_${orderId.slice(0, 12)}`, now, now]
            );
            await consumeReservationsOnPayment(tx, orderId);
            await transitionOrderStatus(tx, {
              orderId,
              toStatus: OrderStatus.PAID,
              actor: { id: actor.id, name: actor.fullName, role: actor.role },
              amountCents: totalCents,
              reason: 'Settled via LocalStubGateway during CSV sales import',
            });
          }
        });

        createdCount += 1;
      } catch (err) {
        errors.push({
          row: i + 2,
          message: err instanceof Error ? err.message : 'Invalid order CSV row',
        });
      }
    }
  }

  await syncLocalCsvFiles(db);

  return {
    dataset,
    createdCount,
    updatedCount,
    errors,
  };
}

export function getSampleCsvTemplate(dataset: 'users' | 'inventory' | 'orders'): string {
  if (dataset === 'users') {
    return [
      'email,password,full_name,phone,role,warehouse_id',
      'alex.buyer@demo.fulfilliq.test,DemoPass123!,Alex Buyer,+1-555-0188,customer,',
      'new.picker@demo.fulfilliq.test,DemoPass123!,Casey Warehouse,+1-555-0189,picker,wh-central',
    ].join('\n');
  }
  if (dataset === 'inventory') {
    return [
      'sku,barcode,name,category,description,price_cents,low_stock_threshold,warehouse_id,qty_available',
      'FIQ-SKU-031,890100000031,Heavy Duty Label Dispenser,Packaging,Synthetic benchtop dispenser for shipping labels,4500,5,wh-central,18',
      'FIQ-SKU-032,890100000032,USB-C Barcode Cradle Dock,Hardware,Weighted desk dock for wireless scanners,3200,4,wh-north,12',
    ].join('\n');
  }
  return [
    'customer_email,warehouse_id,product_sku,quantity,recipient_name,line1,city,postal_code,phone,mark_paid',
    'customer@demo.fulfilliq.test,wh-central,FIQ-SKU-003,1,Avery Chen,100 Synthetic Way,Metro City,10001,+1-555-0101,true',
  ].join('\n');
}
