import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiApp } from '../app.ts';
import { UnifiedDbClient } from '../db/index.ts';
import { createTestHarness, TestHarness } from './testHelper.ts';

describe('S09, S10, S11 & Region Config: Health, Support Lookup, Low-Stock Alert, Restart Persistence & Dynamic Regions', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await createTestHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it('passes /health and /ready probes', async () => {
    const health = await request(h.app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const ready = await request(h.app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('ready');
  });

  it('supports agent order lookup by order number, email fragment, and phone fragment', async () => {
    const supportToken = await h.login('support@demo.fulfilliq.test');

    const byOrderNum = await request(h.app)
      .get('/api/support/orders?q=FIQ-2026-1011')
      .set('Authorization', `Bearer ${supportToken}`);
    expect(byOrderNum.status).toBe(200);
    expect(byOrderNum.body.orders.length).toBe(1);
    expect(byOrderNum.body.orders[0].returnStatus).toBe('REFUND_PENDING');

    const byEmail = await request(h.app)
      .get('/api/support/orders?q=customer2@demo')
      .set('Authorization', `Bearer ${supportToken}`);
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.orders.length).toBeGreaterThanOrEqual(2);

    const byPhone = await request(h.app)
      .get('/api/support/orders?q=0102')
      .set('Authorization', `Bearer ${supportToken}`);
    expect(byPhone.status).toBe(200);
    expect(byPhone.body.orders.length).toBeGreaterThanOrEqual(2);
  });

  it('deterministic low-stock rule raises exactly one OPEN alert per item until resolved', async () => {
    const managerToken = await h.login('manager@demo.fulfilliq.test');
    const custToken = await h.login('customer@demo.fulfilliq.test');

    // prod-002 in wh-central starts at 3 (threshold=5) with 1 OPEN alert.
    // Ordering 1 unit twice drops qty_available 3 -> 2 -> 1, still must keep ONLY 1 OPEN alert!
    for (let i = 0; i < 2; i++) {
      const res = await request(h.app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${custToken}`)
        .send({
          warehouseId: 'wh-central',
          items: [{ productId: 'prod-002', quantity: 1 }],
          shippingAddress: {
            recipientName: 'Low Stock Buyer',
            line1: '100 Test Way',
            city: 'Metro City',
            postalCode: '10001',
            country: 'Synthetic Republic',
            phone: '+1-555-0101',
          },
        });
      expect(res.status).toBe(201);
    }

    const alertsRes = await request(h.app)
      .get('/api/alerts/low-stock?status=OPEN')
      .set('Authorization', `Bearer ${managerToken}`);
    const prod2Alerts = (alertsRes.body.alerts as Array<{ productId: string; warehouseId: string }>).filter(
      (a) => a.productId === 'prod-002' && a.warehouseId === 'wh-central'
    );
    expect(prod2Alerts.length).toBe(1);
  });

  it('persists orders and dynamic region configuration across API & DB restart', async () => {
    const adminToken = await h.login('admin@demo.fulfilliq.test');
    const custToken = await h.login('customer@demo.fulfilliq.test');

    // Add a brand new region + warehouse via API without code change
    const regRes = await request(h.app)
      .post('/api/admin/regions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        regionId: 'reg-highland',
        code: 'HIGHLAND',
        name: 'Highland Fulfillment Region',
        taxRate: 0.12,
        shippingRuleType: 'flat',
        shippingFlatCents: 1500,
        shippingFreeThresholdCents: 0,
        refundApprovalLimitCents: 10000,
        returnWindowDays: 10,
        reservationExpiryMinutes: 15,
        warehouseName: 'Highland Hub',
        warehouseCode: 'WH-HIGH',
        warehouseCity: 'Summit',
      });
    expect(regRes.status).toBe(201);

    const whList = await request(h.app).get('/api/warehouses');
    const highWh = (whList.body.warehouses as Array<{ id: string; code: string }>).find(
      (w) => w.code === 'WH-HIGH'
    );
    expect(highWh).toBeDefined();

    // Place an order in the new region
    const ordRes = await request(h.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${custToken}`)
      .send({
        warehouseId: highWh!.id,
        items: [{ productId: 'prod-003', quantity: 1 }], // $64.00
        shippingAddress: {
          recipientName: 'Highland Buyer',
          line1: '10 Peak Rd',
          city: 'Summit',
          postalCode: '90001',
          country: 'Synthetic Republic',
          phone: '+1-555-0199',
        },
      });
    expect(ordRes.status).toBe(201);
    expect(ordRes.body.order.taxCents).toBe(Math.round(6400 * 0.12));
    expect(ordRes.body.order.shippingCents).toBe(1500);
    const createdOrderId = ordRes.body.order.id as string;

    // Simulate full API + DB restart by closing current DB and opening a fresh client & app on same file
    await h.db.close();
    const restartedDb = new UnifiedDbClient({ dialect: 'sqlite', sqlitePath: h.dbPath });
    const restartedApp = createApiApp(restartedDb);
    h.db = restartedDb;

    const afterRestartOrder = await request(restartedApp)
      .get(`/api/orders/${createdOrderId}`)
      .set('Authorization', `Bearer ${custToken}`);
    expect(afterRestartOrder.status).toBe(200);
    expect(afterRestartOrder.body.order.regionId).toBe('reg-highland');
  });
});
