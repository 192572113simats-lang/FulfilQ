import bcrypt from 'bcryptjs';
import { OrderStatus, Role } from '@fulfilliq/shared';
import { DbClient } from './index.ts';
import { runMigrations } from './migrations/001_init.ts';

const SYNTHETIC_PRODUCTS = [
  { id: 'prod-001', sku: 'FIQ-SKU-001', barcode: '890100000001', name: 'ArcScan Wireless Barcode Reader', category: 'Hardware', description: 'Synthetic ergonomic 2D handheld scanner with USB cradle for warehouse stations.', priceCents: 8900, threshold: 4 },
  { id: 'prod-002', sku: 'FIQ-SKU-002', barcode: '890100000002', name: 'ThermoLabel 4x6 Direct Printer', category: 'Hardware', description: 'High-speed thermal shipping label printer with auto-peel cutter.', priceCents: 14900, threshold: 5 },
  { id: 'prod-003', sku: 'FIQ-SKU-003', barcode: '890100000003', name: 'Nordic Stoneware Pour-Over Kettle', category: 'Kitchen', description: 'Matte ceramic gooseneck kettle engineered for steady pour-over extraction.', priceCents: 6400, threshold: 6 },
  { id: 'prod-004', sku: 'FIQ-SKU-004', barcode: '890100000004', name: 'Tactile Mechanical Desk Keypad', category: 'Workspace', description: 'Compact 65% anodized aluminum keypad with hot-swappable switches.', priceCents: 11800, threshold: 5 },
  { id: 'prod-005', sku: 'FIQ-SKU-005', barcode: '890100000005', name: 'Brushed Brass Task Lamp', category: 'Lighting', description: 'Articulated architectural desk lamp with warm-dimming LED array.', priceCents: 13500, threshold: 4 },
  { id: 'prod-006', sku: 'FIQ-SKU-006', barcode: '890100000006', name: 'Canvas Modular Tool Tote', category: 'Storage', description: 'Heavy 18oz waxed canvas carrier with 12 reinforced exterior pockets.', priceCents: 4800, threshold: 8 },
  { id: 'prod-007', sku: 'FIQ-SKU-007', barcode: '890100000007', name: 'Precision Digital Postal Scale', category: 'Hardware', description: 'Stainless-platform parcel scale rated up to 50kg in 5g increments.', priceCents: 5200, threshold: 5 },
  { id: 'prod-008', sku: 'FIQ-SKU-008', barcode: '890100000008', name: 'Anodized Aluminum Laptop Riser', category: 'Workspace', description: 'Machined single-piece stand elevating displays by 14cm.', priceCents: 5900, threshold: 6 },
  { id: 'prod-009', sku: 'FIQ-SKU-009', barcode: '890100000009', name: 'Insulated Field Flask 750ml', category: 'Lifestyle', description: 'Double-wall vacuum stainless bottle with powder-coat finish.', priceCents: 3200, threshold: 10 },
  { id: 'prod-010', sku: 'FIQ-SKU-010', barcode: '890100000010', name: 'Walnut Valet Desk Tray', category: 'Workspace', description: 'Milled solid walnut organizer for keys, pens, and cards.', priceCents: 3800, threshold: 6 },
  { id: 'prod-011', sku: 'FIQ-SKU-011', barcode: '890100000011', name: 'Studio Monitor Acoustic Pads', category: 'Audio', description: 'High-density isolation wedges reducing desk resonance.', priceCents: 2900, threshold: 8 },
  { id: 'prod-012', sku: 'FIQ-SKU-012', barcode: '890100000012', name: 'Recycled Kraft Packing Tape (6-Pack)', category: 'Packaging', description: 'Water-activated reinforced paper tape rolls for zero-plastic sealing.', priceCents: 2400, threshold: 12 },
  { id: 'prod-013', sku: 'FIQ-SKU-013', barcode: '890100000013', name: 'Merino Wool Felt Desk Mat', category: 'Workspace', description: '900x400mm breathable acoustic mat with natural rubber backing.', priceCents: 4400, threshold: 7 },
  { id: 'prod-014', sku: 'FIQ-SKU-014', barcode: '890100000014', name: 'Compact USB-C 100W GaN Charger', category: 'Electronics', description: 'Dual-port compact power brick with braided 2m cable.', priceCents: 6800, threshold: 6 },
  { id: 'prod-015', sku: 'FIQ-SKU-015', barcode: '890100000015', name: 'Stackable Polypropylene Crate 32L', category: 'Storage', description: 'Collapsible ventilated warehouse and studio picking bin.', priceCents: 3400, threshold: 10 },
  { id: 'prod-016', sku: 'FIQ-SKU-016', barcode: '890100000016', name: 'Ceramic Espresso Cup Set (4pc)', category: 'Kitchen', description: 'Hand-glazed stoneware demitasse cups with matching saucers.', priceCents: 4200, threshold: 6 },
  { id: 'prod-017', sku: 'FIQ-SKU-017', barcode: '890100000017', name: 'Noise-Isolating Studio Headphones', category: 'Audio', description: 'Closed-back reference headphones with replaceable ear cushions.', priceCents: 16500, threshold: 4 },
  { id: 'prod-018', sku: 'FIQ-SKU-018', barcode: '890100000018', name: 'Braided Thunderbolt 4 Cable 1.5m', category: 'Electronics', description: '40Gbps certified data and 100W power delivery cable.', priceCents: 3600, threshold: 8 },
  { id: 'prod-019', sku: 'FIQ-SKU-019', barcode: '890100000019', name: 'Cast Iron Skillet 26cm', category: 'Kitchen', description: 'Pre-seasoned heirloom pan with dual pour spouts.', priceCents: 5800, threshold: 5 },
  { id: 'prod-020', sku: 'FIQ-SKU-020', barcode: '890100000020', name: 'Portable LED Work Light', category: 'Lighting', description: 'Rechargeable magnetic inspection lamp with 3 brightness modes.', priceCents: 4100, threshold: 6 },
  { id: 'prod-021', sku: 'FIQ-SKU-021', barcode: '890100000021', name: 'Grid Dot Hardcover Notebook A5', category: 'Stationery', description: '192-page 120gsm fountain-pen friendly archival notebook.', priceCents: 1900, threshold: 15 },
  { id: 'prod-022', sku: 'FIQ-SKU-022', barcode: '890100000022', name: 'Machined Brass Rollerball Pen', category: 'Stationery', description: 'Weighted solid brass barrel with ceramic roller refill.', priceCents: 4900, threshold: 7 },
  { id: 'prod-023', sku: 'FIQ-SKU-023', barcode: '890100000023', name: 'Linen Apron in Slate', category: 'Kitchen', description: 'Cross-back European flax work apron with deep utility pockets.', priceCents: 4600, threshold: 6 },
  { id: 'prod-024', sku: 'FIQ-SKU-024', barcode: '890100000024', name: 'Smart Hygrometer & Temp Sensor', category: 'Electronics', description: 'E-ink display ambient monitor for storage rooms and offices.', priceCents: 2800, threshold: 8 },
  { id: 'prod-025', sku: 'FIQ-SKU-025', barcode: '890100000025', name: 'Ergonomic Anti-Fatigue Floor Mat', category: 'Workspace', description: 'Beveled polyurethane standing mat for packing benches.', priceCents: 7400, threshold: 4 },
  { id: 'prod-026', sku: 'FIQ-SKU-026', barcode: '890100000026', name: 'Carbon Steel Utility Knife', category: 'Hardware', description: 'Quick-change safety blade cutter with textured grip.', priceCents: 2200, threshold: 10 },
  { id: 'prod-027', sku: 'FIQ-SKU-027', barcode: '890100000027', name: 'Glass Olive Oil Cruet 500ml', category: 'Kitchen', description: 'UV-tinted borosilicate bottle with weighted stainless spout.', priceCents: 2700, threshold: 7 },
  { id: 'prod-028', sku: 'FIQ-SKU-028', barcode: '890100000028', name: 'Compact Desk Air Purifier', category: 'Electronics', description: 'True HEPA H13 personal unit with quiet 22dB night mode.', priceCents: 9400, threshold: 4 },
  { id: 'prod-029', sku: 'FIQ-SKU-029', barcode: '890100000029', name: 'Modular Cable Management Spine', category: 'Workspace', description: 'Weighted floor-to-desk magnetic cable channel.', priceCents: 3900, threshold: 6 },
  { id: 'prod-030', sku: 'FIQ-SKU-030', barcode: '890100000030', name: 'Heavy-Duty Parcel Strapping Kit', category: 'Packaging', description: 'Manual tensioner with 200m woven cord and buckles.', priceCents: 11200, threshold: 3 },
];

export async function seedDatabase(db: DbClient, forceReset = false): Promise<void> {
  await runMigrations(db);

  if (forceReset) {
    const tables = [
      'audit_logs',
      'stock_corrections',
      'low_stock_alerts',
      'returns',
      'idempotency_keys',
      'payment_intents',
      'stock_reservations',
      'order_items',
      'orders',
      'warehouse_stock',
      'products',
      'users',
      'warehouses',
      'regions',
      'gateway_config',
      'delivery_stories',
    ];
    for (const t of tables) {
      await db.query(`DELETE FROM ${t}`);
    }
  }

  const existing = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM regions');
  if (!forceReset && Number(existing.rows[0]?.cnt ?? 0) > 0) {
    return;
  }

  const now = new Date();
  const isoNow = now.toISOString();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();
  const minsFromNow = (m: number) => new Date(now.getTime() + m * 60_000).toISOString();

  // 1. Regions (3 regions: 1 original + 2 new regional hubs)
  const regions = [
    ['reg-central', 'CENTRAL', 'Central Metro Hub', 0.08, 'threshold', 800, 7500, 25000, 14, 15],
    ['reg-north', 'NORTH', 'Northern Valley Region', 0.10, 'flat', 1200, 0, 15000, 21, 15],
    ['reg-coast', 'COAST', 'Coastal Logistics Region', 0.06, 'threshold', 1000, 10000, 30000, 14, 20],
  ] as const;

  for (const r of regions) {
    await db.query(
      `INSERT INTO regions (
        region_id, code, name, tax_rate, shipping_rule_type, shipping_flat_cents,
        shipping_free_threshold_cents, refund_approval_limit_cents, return_window_days,
        reservation_expiry_minutes, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [...r, isoNow, isoNow]
    );
  }

  // 2. Warehouses (3 warehouses linked to regions)
  const warehouses = [
    ['wh-central', 'WH-CENTRAL', 'Central Metro Fulfillment Center', 'reg-central', 'Metro City'],
    ['wh-north', 'WH-NORTH', 'Northern Regional Warehouse', 'reg-north', 'Northgate'],
    ['wh-coast', 'WH-COAST', 'Coastal Regional Warehouse', 'reg-coast', 'Bayport'],
  ] as const;

  for (const w of warehouses) {
    await db.query(
      `INSERT INTO warehouses (id, code, name, region_id, city, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,1,$6)`,
      [...w, isoNow]
    );
  }

  // 3. Users (Demo only synthetic accounts — one for every role + second customer)
  const passwordHash = await bcrypt.hash('DemoPass123!', 10);
  const users = [
    ['usr-cust-1', 'customer@demo.fulfilliq.test', 'Avery Chen (Demo Customer)', '+1-555-0101', Role.CUSTOMER, null],
    ['usr-cust-2', 'customer2@demo.fulfilliq.test', 'Jordan Patel (Demo Customer 2)', '+1-555-0102', Role.CUSTOMER, null],
    ['usr-picker-1', 'picker@demo.fulfilliq.test', 'Sam Rivera (Demo Picker)', '+1-555-0103', Role.PICKER, 'wh-central'],
    ['usr-support-1', 'support@demo.fulfilliq.test', 'Morgan Blake (Demo Support)', '+1-555-0104', Role.SUPPORT_AGENT, null],
    ['usr-manager-1', 'manager@demo.fulfilliq.test', 'Riley Brooks (Demo Store Manager)', '+1-555-0105', Role.STORE_MANAGER, 'wh-central'],
    ['usr-finance-1', 'finance@demo.fulfilliq.test', 'Dana Vance (Demo Finance Reviewer)', '+1-555-0106', Role.FINANCE_REVIEWER, null],
    ['usr-admin-1', 'admin@demo.fulfilliq.test', 'Taylor Kim (Demo Admin)', '+1-555-0107', Role.ADMIN, null],
  ] as const;

  for (const u of users) {
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, phone, role, warehouse_id, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)`,
      [u[0], u[1], passwordHash, u[2], u[3], u[4], u[5], isoNow]
    );
  }

  // 4. Products (30 synthetic products) + Warehouse Stock
  for (let i = 0; i < SYNTHETIC_PRODUCTS.length; i++) {
    const p = SYNTHETIC_PRODUCTS[i];
    await db.query(
      `INSERT INTO products (id, sku, barcode, name, category, description, price_cents, low_stock_threshold, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, p.sku, p.barcode, p.name, p.category, p.description, p.priceCents, p.threshold, isoNow]
    );

    for (const wh of warehouses) {
      let qtyAvailable = 25 + ((i * 7) % 20);
      if (wh[0] === 'wh-central' && p.id === 'prod-001') {
        qtyAvailable = 10; // Exact 10 units for concurrency test
      } else if (wh[0] === 'wh-central' && p.id === 'prod-002') {
        qtyAvailable = 3; // Below threshold=5 -> triggers seeded low-stock alert
      }
      await db.query(
        `INSERT INTO warehouse_stock (warehouse_id, product_id, qty_available, qty_reserved, qty_sold, updated_at)
         VALUES ($1,$2,$3,0,0,$4)`,
        [wh[0], p.id, qtyAvailable, isoNow]
      );
    }
  }

  // Seed one deterministic low-stock alert for prod-002 in wh-central
  await db.query(
    `INSERT INTO low_stock_alerts (id, warehouse_id, product_id, qty_at_trigger, threshold, status, created_at)
     VALUES ($1,$2,$3,$4,$5,'OPEN',$6)`,
    ['alert-seed-001', 'wh-central', 'prod-002', 3, 5, daysAgo(1)]
  );

  // 5. Gateway config
  await db.query(
    `INSERT INTO gateway_config (id, mode, simulate_outage, sandbox_url, updated_at, updated_by)
     VALUES ('default', 'local_stub', 0, 'http://localhost:4010/v1/charges', $1, 'usr-admin-1')`,
    [isoNow]
  );

  // 6. 12 Synthetic Sample Orders across states
  const addr1 = JSON.stringify({
    recipientName: 'Avery Chen',
    line1: '100 Synthetic Way',
    line2: 'Suite 4B',
    city: 'Metro City',
    postalCode: '10001',
    country: 'Synthetic Republic',
    phone: '+1-555-0101',
  });
  const addr2 = JSON.stringify({
    recipientName: 'Jordan Patel',
    line1: '240 Northgate Blvd',
    line2: '',
    city: 'Northgate',
    postalCode: '20410',
    country: 'Synthetic Republic',
    phone: '+1-555-0102',
  });

  interface SeedOrderDef {
    id: string;
    num: string;
    custId: string;
    whId: string;
    regId: string;
    status: OrderStatus;
    prodIdx: number;
    qty: number;
    addr: string;
    createdAt: string;
    deliveredAt?: string | null;
    reservedUntil?: string | null;
    assignedPickerId?: string | null;
    pickedQty?: number;
    paymentStatus?: 'SUCCEEDED' | 'PENDING_RETRY';
    returnStatus?: 'REQUESTED' | 'REFUND_PENDING' | 'APPROVED' | 'REJECTED';
    returnReason?: string;
    decidedBy?: string | null;
    decisionReason?: string | null;
    internalNote?: string;
  }

  const seedOrders: SeedOrderDef[] = [
    {
      id: 'ord-seed-01', num: 'FIQ-2026-1001', custId: 'usr-cust-1', whId: 'wh-central', regId: 'reg-central',
      status: OrderStatus.RESERVED, prodIdx: 2, qty: 1, addr: addr1, createdAt: minsFromNow(-2), reservedUntil: minsFromNow(13),
    },
    {
      id: 'ord-seed-02', num: 'FIQ-2026-1002', custId: 'usr-cust-1', whId: 'wh-central', regId: 'reg-central',
      status: OrderStatus.PAYMENT_PENDING, prodIdx: 3, qty: 1, addr: addr1, createdAt: minsFromNow(-10), reservedUntil: minsFromNow(20),
      paymentStatus: 'PENDING_RETRY',
    },
    {
      id: 'ord-seed-03', num: 'FIQ-2026-1003', custId: 'usr-cust-1', whId: 'wh-central', regId: 'reg-central',
      status: OrderStatus.PAID, prodIdx: 4, qty: 1, addr: addr1, createdAt: daysAgo(1), assignedPickerId: 'usr-picker-1',
      paymentStatus: 'SUCCEEDED', internalNote: 'Internal bin check: Aisle 4B',
    },
    {
      id: 'ord-seed-04', num: 'FIQ-2026-1004', custId: 'usr-cust-2', whId: 'wh-central', regId: 'reg-central',
      status: OrderStatus.PAID, prodIdx: 5, qty: 2, addr: addr2, createdAt: daysAgo(1), assignedPickerId: 'usr-picker-1',
      paymentStatus: 'SUCCEEDED',
    },
    {
      id: 'ord-seed-05', num: 'FIQ-2026-1005', custId: 'usr-cust-1', whId: 'wh-central', regId: 'reg-central',
      status: OrderStatus.PICKING, prodIdx: 6, qty: 2, addr: addr1, createdAt: daysAgo(1), assignedPickerId: 'usr-picker-1',
      pickedQty: 1, paymentStatus: 'SUCCEEDED',
    },
    {
      id: 'ord-seed-06', num: 'FIQ-2026-1006', custId: 'usr-cust-1', whId: 'wh-central', regId: 'reg-central',
      status: OrderStatus.PACKED, prodIdx: 7, qty: 1, addr: addr1, createdAt: daysAgo(2), assignedPickerId: 'usr-picker-1',
      pickedQty: 1, paymentStatus: 'SUCCEEDED',
    },
    {
      id: 'ord-seed-07', num: 'FIQ-2026-1007', custId: 'usr-cust-2', whId: 'wh-north', regId: 'reg-north',
      status: OrderStatus.DISPATCHED, prodIdx: 8, qty: 2, addr: addr2, createdAt: daysAgo(2),
      pickedQty: 2, paymentStatus: 'SUCCEEDED',
    },
    {
      id: 'ord-seed-08', num: 'FIQ-2026-1008', custId: 'usr-cust-1', whId: 'wh-central', regId: 'reg-central',
      status: OrderStatus.DELIVERED, prodIdx: 9, qty: 2, addr: addr1, createdAt: daysAgo(4), deliveredAt: daysAgo(2),
      pickedQty: 2, paymentStatus: 'SUCCEEDED', internalNote: 'Carrier dropoff verified',
    },
    {
      id: 'ord-seed-09', num: 'FIQ-2026-1009', custId: 'usr-cust-1', whId: 'wh-coast', regId: 'reg-coast',
      status: OrderStatus.DELIVERED, prodIdx: 10, qty: 1, addr: addr1, createdAt: daysAgo(28), deliveredAt: daysAgo(25),
      pickedQty: 1, paymentStatus: 'SUCCEEDED',
    },
    {
      id: 'ord-seed-10', num: 'FIQ-2026-1010', custId: 'usr-cust-1', whId: 'wh-central', regId: 'reg-central',
      status: OrderStatus.RETURN_REQUESTED, prodIdx: 12, qty: 2, addr: addr1, createdAt: daysAgo(6), deliveredAt: daysAgo(4),
      pickedQty: 2, paymentStatus: 'SUCCEEDED', returnStatus: 'REQUESTED', returnReason: 'Desk mat size does not fit workstation',
    },
    {
      id: 'ord-seed-11', num: 'FIQ-2026-1011', custId: 'usr-cust-1', whId: 'wh-central', regId: 'reg-central',
      status: OrderStatus.REFUND_PENDING, prodIdx: 16, qty: 2, addr: addr1, createdAt: daysAgo(7), deliveredAt: daysAgo(5),
      pickedQty: 2, paymentStatus: 'SUCCEEDED', returnStatus: 'REFUND_PENDING', returnReason: 'Headphones headband cracked on arrival (over $250 limit -> requires admin)',
    },
    {
      id: 'ord-seed-12', num: 'FIQ-2026-1012', custId: 'usr-cust-2', whId: 'wh-north', regId: 'reg-north',
      status: OrderStatus.REFUNDED, prodIdx: 13, qty: 1, addr: addr2, createdAt: daysAgo(9), deliveredAt: daysAgo(7),
      pickedQty: 1, paymentStatus: 'SUCCEEDED', returnStatus: 'APPROVED', returnReason: 'Duplicate charger ordered',
      decidedBy: 'usr-finance-1', decisionReason: 'Within Northern region $150 limit; item received intact',
    },
  ];

  for (const so of seedOrders) {
    const prod = SYNTHETIC_PRODUCTS[so.prodIdx];
    const subtotal = prod.priceCents * so.qty;
    const taxRate = so.regId === 'reg-north' ? 0.1 : so.regId === 'reg-coast' ? 0.06 : 0.08;
    const tax = Math.round(subtotal * taxRate);
    const shipping = so.regId === 'reg-north' ? 1200 : subtotal >= 7500 ? 0 : 800;
    const total = subtotal + tax + shipping;

    await db.query(
      `INSERT INTO orders (
        id, order_number, customer_id, warehouse_id, region_id, status,
        subtotal_cents, tax_cents, shipping_cents, total_cents,
        shipping_address_json, customer_note, internal_notes, reserved_until,
        assigned_picker_id, delivered_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        so.id, so.num, so.custId, so.whId, so.regId, so.status,
        subtotal, tax, shipping, total,
        so.addr, '', so.internalNote ?? '', so.reservedUntil ?? null,
        so.assignedPickerId ?? null, so.deliveredAt ?? null, so.createdAt, isoNow,
      ]
    );

    await db.query(
      `INSERT INTO order_items (id, order_id, product_id, sku, name, barcode, quantity, picked_quantity, unit_price_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [`oi-${so.id}`, so.id, prod.id, prod.sku, prod.name, prod.barcode, so.qty, so.pickedQty ?? 0, prod.priceCents]
    );

    if (so.status === OrderStatus.RESERVED || so.status === OrderStatus.PAYMENT_PENDING) {
      await db.query(
        `INSERT INTO stock_reservations (id, order_id, warehouse_id, product_id, quantity, status, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7)`,
        [`res-${so.id}`, so.id, so.whId, prod.id, so.qty, so.reservedUntil ?? minsFromNow(15), so.createdAt]
      );
      await db.query(
        `UPDATE warehouse_stock SET qty_reserved = qty_reserved + $1 WHERE warehouse_id = $2 AND product_id = $3`,
        [so.qty, so.whId, prod.id]
      );
    } else if (so.paymentStatus === 'SUCCEEDED') {
      await db.query(
        `INSERT INTO stock_reservations (id, order_id, warehouse_id, product_id, quantity, status, expires_at, created_at, released_at)
         VALUES ($1,$2,$3,$4,$5,'CONSUMED',$6,$7,$8)`,
        [`res-${so.id}`, so.id, so.whId, prod.id, so.qty, so.createdAt, so.createdAt, so.createdAt]
      );
    }

    if (so.paymentStatus) {
      await db.query(
        `INSERT INTO payment_intents (
          id, order_id, idempotency_key, amount_cents, status, gateway_used, gateway_ref,
          synthetic_card_last4, retry_count, next_retry_at, last_error, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,'local_stub',$6,'4242',$7,$8,$9,$10,$11)`,
        [
          `pi-${so.id}`,
          so.id,
          `seed-idem-${so.id}`,
          total,
          so.paymentStatus,
          so.paymentStatus === 'SUCCEEDED' ? `stub_ch_${so.id}` : null,
          so.paymentStatus === 'PENDING_RETRY' ? 1 : 0,
          so.paymentStatus === 'PENDING_RETRY' ? minsFromNow(5) : null,
          so.paymentStatus === 'PENDING_RETRY' ? 'Simulated sandbox outage during seed' : null,
          so.createdAt,
          isoNow,
        ]
      );
    }

    if (so.returnStatus) {
      await db.query(
        `INSERT INTO returns (id, order_id, customer_id, region_id, reason, requested_amount_cents, status, decided_by, decision_reason, decided_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          `ret-${so.id}`,
          so.id,
          so.custId,
          so.regId,
          so.returnReason ?? 'Customer return request',
          total,
          so.returnStatus,
          so.decidedBy ?? null,
          so.decisionReason ?? null,
          so.decidedBy ? daysAgo(1) : null,
          daysAgo(3),
        ]
      );
    }

    // Seed audit history trail matching status
    const trailMap: Record<string, OrderStatus[]> = {
      [OrderStatus.RESERVED]: [OrderStatus.PLACED, OrderStatus.RESERVED],
      [OrderStatus.PAYMENT_PENDING]: [OrderStatus.PLACED, OrderStatus.RESERVED, OrderStatus.PAYMENT_PENDING],
      [OrderStatus.PAID]: [OrderStatus.PLACED, OrderStatus.RESERVED, OrderStatus.PAID],
      [OrderStatus.PICKING]: [OrderStatus.PLACED, OrderStatus.RESERVED, OrderStatus.PAID, OrderStatus.PICKING],
      [OrderStatus.PACKED]: [OrderStatus.PLACED, OrderStatus.RESERVED, OrderStatus.PAID, OrderStatus.PICKING, OrderStatus.PACKED],
      [OrderStatus.DISPATCHED]: [OrderStatus.PLACED, OrderStatus.RESERVED, OrderStatus.PAID, OrderStatus.PICKING, OrderStatus.PACKED, OrderStatus.DISPATCHED],
      [OrderStatus.DELIVERED]: [OrderStatus.PLACED, OrderStatus.RESERVED, OrderStatus.PAID, OrderStatus.PICKING, OrderStatus.PACKED, OrderStatus.DISPATCHED, OrderStatus.DELIVERED],
      [OrderStatus.RETURN_REQUESTED]: [OrderStatus.PLACED, OrderStatus.RESERVED, OrderStatus.PAID, OrderStatus.PICKING, OrderStatus.PACKED, OrderStatus.DISPATCHED, OrderStatus.DELIVERED, OrderStatus.RETURN_REQUESTED],
      [OrderStatus.REFUND_PENDING]: [OrderStatus.PLACED, OrderStatus.RESERVED, OrderStatus.PAID, OrderStatus.PICKING, OrderStatus.PACKED, OrderStatus.DISPATCHED, OrderStatus.DELIVERED, OrderStatus.RETURN_REQUESTED, OrderStatus.REFUND_PENDING],
      [OrderStatus.REFUNDED]: [OrderStatus.PLACED, OrderStatus.RESERVED, OrderStatus.PAID, OrderStatus.PICKING, OrderStatus.PACKED, OrderStatus.DISPATCHED, OrderStatus.DELIVERED, OrderStatus.RETURN_REQUESTED, OrderStatus.REFUND_PENDING, OrderStatus.REFUNDED],
    };

    const steps = trailMap[so.status] || [so.status];
    for (let s = 0; s < steps.length; s++) {
      const from = s === 0 ? null : steps[s - 1];
      const to = steps[s];
      await db.query(
        `INSERT INTO audit_logs (id, entity_type, entity_id, action, from_state, to_state, actor_id, actor_name, actor_role, amount_cents, reason, metadata_json, created_at)
         VALUES ($1,'order',$2,'STATUS_TRANSITION',$3,$4,'usr-admin-1','Seed System','admin',$5,$6,'{}',$7)`,
        [
          `aud-${so.id}-${s}`,
          so.id,
          from,
          to,
          to === OrderStatus.REFUNDED ? total : null,
          to === OrderStatus.REFUNDED ? (so.decisionReason ?? 'Seeded refund') : 'Seeded order lifecycle transition',
          new Date(new Date(so.createdAt).getTime() + s * 60_000).toISOString(),
        ]
      );
    }
  }

  // 7. Seed Delivery Board (S01-S13) — clearly marked SIMULATED PLANNING DATA
  const stories = [
    ['S01', 'Order & Stock Core', 'Login & Role-Based Permissions', 'M', 3, 1, 'Security', 'Done', '[]', 'Valid identity receives only its assigned permissions; invalid tokens rejected.', null, 0],
    ['S02', 'Order & Stock Core', 'Place Order with Atomic Stock Reservation', 'M', 5, 1, 'API', 'Done', '["S01"]', 'Stock reserved at checkout with expiry; out-of-stock rejected; stock never negative.', null, 0],
    ['S03a', 'Payments & Refunds', 'Idempotency Key & Payment Stub', 'M', 2, 1, 'Payments', 'Done', '["S02"]', 'Repeated Idempotency-Key returns original result and creates 1 payment intent.', null, 0],
    ['S03b', 'Payments & Refunds', 'Sandbox Gateway Adapter & Safe Retry', 'M', 3, 3, 'Payments', 'Done', '["S03a"]', 'Gateway outage preserves order as PAYMENT_PENDING and retries without double charge.', null, 0],
    ['S04', 'Warehouse & Tracking', 'Warehouse Pick List (Paid & Reserved Only)', 'M', 3, 1, 'Inventory', 'Done', '["S02"]', 'Picker sees only reserved AND paid items for assigned orders.', null, 0],
    ['S05', 'Warehouse & Tracking', 'Strict Order State Machine & Dispatch', 'M', 5, 2, 'API', 'Done', '["S03a","S04"]', 'Only valid status transitions succeed (409 otherwise) with audit history.', null, 0],
    ['S06', 'Warehouse & Tracking', 'Accessible Customer Tracking Page', 'M', 3, 2, 'Frontend', 'Done', '["S05"]', 'Customer sees permitted milestones only; text is screen-reader readable.', null, 0],
    ['S07', 'Payments & Refunds', 'Return Request & Regional Window Check', 'M', 3, 3, 'API', 'Done', '["S05"]', 'Only order owner can request; regional return-window rule enforced.', null, 0],
    ['S08', 'Payments & Refunds', 'Role & Amount-Limit Refund Approval', 'M', 5, 3, 'Security', 'Done', '["S03a","S07"]', 'Support agent gets 403; finance reviewer within limit; above limit requires admin; audit logged.', null, 0],
    ['S09', 'Delivery & Support', 'Docker Build, Health/Ready & Persistence', 'M', 5, 1, 'DevOps', 'Done', '["S01","S02"]', 'Tagged source builds, /health & /ready pass, data survives restart.', null, 0],
    ['S10', 'Delivery & Support', 'Support Order Lookup Console', 'S', 3, 4, 'Frontend', 'Review', '["S05"]', 'Agent finds order by ID, email, or phone fragment and views return/refund status.', null, 0],
    ['S11', 'Warehouse & Tracking', 'Deterministic Low-Stock Alert Rule', 'S', 3, 2, 'Inventory', 'Test', '["S04"]', 'Fixed-threshold rule raises exactly one alert per item until resolved.', null, 0],
    ['S12', 'Warehouse & Tracking', 'Barcode Pick Confirmation & Text Fallback', 'S', 3, 3, 'Inventory', 'In Progress', '["S04"]', 'Valid scan confirms item; wrong item rejected; manual entry fallback supported.', null, 0],
    ['S13', 'Deferred Analytics', 'Sales Analytics & ML Forecasting (DEFERRED)', 'C', 3, 4, 'Frontend', 'Ready', '["S05"]', 'Deferred outside initial release; roadmap placeholder only.', 'Deferred per Release Plan & Task 6 scope protection', 1],
  ] as const;

  for (const st of stories) {
    await db.query(
      `INSERT INTO delivery_stories (
        id, epic, title, priority, points, sprint, owner_role, column_status,
        dependencies_json, acceptance_criteria, blocked_reason, is_deferred, simulated_note, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        st[0], st[1], st[2], st[3], st[4], st[5], st[6], st[7],
        st[8], st[9], st[10], st[11],
        'SIMULATED PLANNING DATA, not actual team delivery.',
        isoNow,
      ]
    );
  }
}
