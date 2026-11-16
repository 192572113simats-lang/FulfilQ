import { DbClient } from '../index.ts';

const COMMON_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS regions (
  region_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0.08,
  shipping_rule_type TEXT NOT NULL DEFAULT 'threshold',
  shipping_flat_cents INTEGER NOT NULL DEFAULT 800,
  shipping_free_threshold_cents INTEGER NOT NULL DEFAULT 7500,
  refund_approval_limit_cents INTEGER NOT NULL DEFAULT 25000,
  return_window_days INTEGER NOT NULL DEFAULT 14,
  reservation_expiry_minutes INTEGER NOT NULL DEFAULT 15,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  city TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL,
  warehouse_id TEXT REFERENCES warehouses(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS warehouse_stock (
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  qty_available INTEGER NOT NULL DEFAULT 0 CHECK (qty_available >= 0),
  qty_reserved INTEGER NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  qty_sold INTEGER NOT NULL DEFAULT 0 CHECK (qty_sold >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (warehouse_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES users(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  status TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  shipping_address_json TEXT NOT NULL,
  customer_note TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  reserved_until TEXT,
  assigned_picker_id TEXT REFERENCES users(id),
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  barcode TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  picked_quantity INTEGER NOT NULL DEFAULT 0 CHECK (picked_quantity >= 0),
  unit_price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  released_at TEXT
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  gateway_used TEXT NOT NULL,
  gateway_ref TEXT,
  synthetic_card_last4 TEXT NOT NULL DEFAULT '4242',
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  reason TEXT NOT NULL,
  requested_amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  decided_by TEXT REFERENCES users(id),
  decision_reason TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS low_stock_alerts (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  qty_at_trigger INTEGER NOT NULL,
  threshold INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_low_stock_one_open
  ON low_stock_alerts (warehouse_id, product_id)
  WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS stock_corrections (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  delta_qty INTEGER NOT NULL,
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  amount_cents INTEGER,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gateway_config (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  simulate_outage INTEGER NOT NULL DEFAULT 0,
  sandbox_url TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS delivery_stories (
  id TEXT PRIMARY KEY,
  epic TEXT NOT NULL,
  title TEXT NOT NULL,
  priority TEXT NOT NULL,
  points INTEGER NOT NULL,
  sprint INTEGER NOT NULL,
  owner_role TEXT NOT NULL,
  column_status TEXT NOT NULL,
  dependencies_json TEXT NOT NULL,
  acceptance_criteria TEXT NOT NULL,
  blocked_reason TEXT,
  is_deferred INTEGER NOT NULL DEFAULT 0,
  simulated_note TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_warehouse ON orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_reservations_expiry ON stock_reservations(status, expires_at);
`;

export async function runMigrations(db: DbClient): Promise<void> {
  if (db.dialect === 'sqlite') {
    await db.exec(COMMON_SCHEMA_SQL);
    return;
  }
  // Postgres executes statements separated cleanly
  const statements = COMMON_SCHEMA_SQL.split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await db.exec(stmt);
  }
}
