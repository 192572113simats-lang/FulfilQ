import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfig } from '../config.ts';
import { createTestHarness, TestHarness } from './testHelper.ts';

describe('S01 Auth & RBAC Enforcement', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await createTestHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it('rejects missing, invalid, and expired JWT tokens with 401', async () => {
    const noAuth = await request(h.app).get('/api/orders');
    expect(noAuth.status).toBe(401);

    const badAuth = await request(h.app)
      .get('/api/orders')
      .set('Authorization', 'Bearer not.a.valid.jwt');
    expect(badAuth.status).toBe(401);

    const expiredToken = jwt.sign(
      { sub: 'usr-cust-1', email: 'customer@demo.fulfilliq.test', fullName: 'Avery', role: 'customer' },
      getConfig().jwtSecret,
      { expiresIn: -10 }
    );
    const expiredRes = await request(h.app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(expiredRes.status).toBe(401);
  });

  it('prevents customer from reading another customer order (403)', async () => {
    const cust1Token = await h.login('customer@demo.fulfilliq.test');
    const cust2OrderRes = await request(h.app)
      .get('/api/orders/ord-seed-04') // belongs to usr-cust-2
      .set('Authorization', `Bearer ${cust1Token}`);
    expect(cust2OrderRes.status).toBe(403);
  });

  it('prevents picker from seeing unpaid orders in queue or detail (403)', async () => {
    const pickerToken = await h.login('picker@demo.fulfilliq.test');

    const queueRes = await request(h.app)
      .get('/api/picking/queue')
      .set('Authorization', `Bearer ${pickerToken}`);
    expect(queueRes.status).toBe(200);
    const ids = (queueRes.body.queue as Array<{ id: string }>).map((o) => o.id);
    expect(ids).not.toContain('ord-seed-01'); // RESERVED (unpaid)
    expect(ids).not.toContain('ord-seed-02'); // PAYMENT_PENDING (unpaid)
    expect(ids).toContain('ord-seed-03'); // PAID

    const unpaidDetail = await request(h.app)
      .get('/api/orders/ord-seed-01')
      .set('Authorization', `Bearer ${pickerToken}`);
    expect(unpaidDetail.status).toBe(403);
  });

  it('prevents support_agent from approving refunds or correcting stock (403)', async () => {
    const supportToken = await h.login('support@demo.fulfilliq.test');

    const refundRes = await request(h.app)
      .post('/api/returns/ret-ord-seed-11/decision')
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ decision: 'approve', reason: 'Attempted unauthorized refund' });
    expect(refundRes.status).toBe(403);

    const stockRes = await request(h.app)
      .post('/api/inventory/corrections')
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ warehouseId: 'wh-central', productId: 'prod-001', deltaQty: 5, reason: 'Unauthorized' });
    expect(stockRes.status).toBe(403);
  });
});
