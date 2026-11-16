import http from 'http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrderStatus } from '@fulfilliq/shared';
import { createTestHarness, TestHarness } from './testHelper.ts';

describe('S03a/b Idempotent Payments & Gateway Outage Resilience', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await createTestHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it('returns original result across 10 retries with same Idempotency-Key and creates exactly 1 payment intent', async () => {
    const custToken = await h.login('customer@demo.fulfilliq.test');

    const ordRes = await request(h.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${custToken}`)
      .send({
        warehouseId: 'wh-central',
        items: [{ productId: 'prod-004', quantity: 1 }],
        shippingAddress: {
          recipientName: 'Idem Tester',
          line1: '100 Test Way',
          city: 'Metro City',
          postalCode: '10001',
          country: 'Synthetic Republic',
          phone: '+1-555-0101',
        },
      });
    expect(ordRes.status).toBe(201);
    const orderId = ordRes.body.order.id as string;

    const idemKey = 'idem-key-10x-test';
    const paymentIds = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const payRes = await request(h.app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${custToken}`)
        .set('Idempotency-Key', idemKey)
        .send({ orderId, method: 'synthetic_card', syntheticCardLast4: '4242' });
      expect(payRes.status).toBe(200);
      expect(payRes.body.orderStatus).toBe(OrderStatus.PAID);
      paymentIds.add(payRes.body.paymentIntent.id);
    }

    expect(paymentIds.size).toBe(1);

    const piCount = await h.db.query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM payment_intents WHERE order_id = $1',
      [orderId]
    );
    expect(Number(piCount.rows[0].cnt)).toBe(1);
  });

  it('saves order as PAYMENT_PENDING during gateway outage and retries safely without double charging', async () => {
    const custToken = await h.login('customer@demo.fulfilliq.test');
    const adminToken = await h.login('admin@demo.fulfilliq.test');

    // Simulate gateway outage
    const outRes = await request(h.app)
      .patch('/api/admin/gateway')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ simulateOutage: true });
    expect(outRes.status).toBe(200);

    const ordRes = await request(h.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${custToken}`)
      .send({
        warehouseId: 'wh-central',
        items: [{ productId: 'prod-005', quantity: 1 }],
        shippingAddress: {
          recipientName: 'Outage Tester',
          line1: '100 Test Way',
          city: 'Metro City',
          postalCode: '10001',
          country: 'Synthetic Republic',
          phone: '+1-555-0101',
        },
      });
    const orderId = ordRes.body.order.id as string;

    const payRes = await request(h.app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${custToken}`)
      .set('Idempotency-Key', 'idem-outage-001')
      .send({ orderId, method: 'synthetic_card', syntheticCardLast4: '4242' });
    expect(payRes.status).toBe(202);
    expect(payRes.body.orderStatus).toBe(OrderStatus.PAYMENT_PENDING);

    // Recover gateway
    await request(h.app)
      .patch('/api/admin/gateway')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ simulateOutage: false });

    // Retry safely twice
    const retry1 = await request(h.app)
      .post(`/api/payments/${orderId}/retry`)
      .set('Authorization', `Bearer ${custToken}`);
    expect(retry1.status).toBe(200);
    expect(retry1.body.orderStatus).toBe(OrderStatus.PAID);

    const retry2 = await request(h.app)
      .post(`/api/payments/${orderId}/retry`)
      .set('Authorization', `Bearer ${custToken}`);
    expect(retry2.status).toBe(200);
    expect(retry2.body.alreadySucceeded).toBe(true);

    const piCount = await h.db.query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM payment_intents WHERE order_id = $1',
      [orderId]
    );
    expect(Number(piCount.rows[0].cnt)).toBe(1);
  });

  it('supports SandboxGateway HTTP adapter configured via admin', async () => {
    const adminToken = await h.login('admin@demo.fulfilliq.test');
    const custToken = await h.login('customer@demo.fulfilliq.test');

    // Spin up a minimal local HTTP sandbox endpoint
    let receivedIdemKey = '';
    const mockServer = http.createServer((req, res) => {
      receivedIdemKey = String(req.headers['idempotency-key'] || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ chargeId: 'sbx_http_charge_99' }));
    });
    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = (mockServer.address() as { port: number }).port;

    try {
      await request(h.app)
        .patch('/api/admin/gateway')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          mode: 'sandbox_http',
          simulateOutage: false,
          sandboxUrl: `http://127.0.0.1:${port}/v1/charges`,
        });

      const ordRes = await request(h.app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${custToken}`)
        .send({
          warehouseId: 'wh-central',
          items: [{ productId: 'prod-006', quantity: 1 }],
          shippingAddress: {
            recipientName: 'Sandbox Buyer',
            line1: '100 Test Way',
            city: 'Metro City',
            postalCode: '10001',
            country: 'Synthetic Republic',
            phone: '+1-555-0101',
          },
        });

      const payRes = await request(h.app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${custToken}`)
        .set('Idempotency-Key', 'idem-sandbox-http-1')
        .send({ orderId: ordRes.body.order.id, method: 'synthetic_card', syntheticCardLast4: '4242' });

      expect(payRes.status).toBe(200);
      expect(payRes.body.paymentIntent.gatewayUsed).toBe('sandbox_http');
      expect(payRes.body.paymentIntent.gatewayRef).toBe('sbx_http_charge_99');
      expect(receivedIdemKey).toBe('idem-sandbox-http-1');
    } finally {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
  });
});
