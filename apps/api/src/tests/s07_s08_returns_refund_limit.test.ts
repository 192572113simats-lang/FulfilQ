import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrderStatus } from '@fulfilliq/shared';
import { createTestHarness, TestHarness } from './testHelper.ts';

describe('S07 & S08 Returns Window & Regional Refund Approval Limits', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await createTestHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it('enforces order ownership and regional return window on return requests', async () => {
    const cust2Token = await h.login('customer2@demo.fulfilliq.test');
    const cust1Token = await h.login('customer@demo.fulfilliq.test');

    // ord-seed-08 belongs to cust1, delivered 2 days ago
    const wrongOwner = await request(h.app)
      .post('/api/orders/ord-seed-08/return')
      .set('Authorization', `Bearer ${cust2Token}`)
      .send({ reason: 'Not my order' });
    expect(wrongOwner.status).toBe(403);

    // ord-seed-09 belongs to cust1 in COAST (14d window), delivered 25 days ago -> expired
    const expiredWindow = await request(h.app)
      .post('/api/orders/ord-seed-09/return')
      .set('Authorization', `Bearer ${cust1Token}`)
      .send({ reason: 'Too late return request' });
    expect(expiredWindow.status).toBe(422);

    // Within window succeeds
    const okReturn = await request(h.app)
      .post('/api/orders/ord-seed-08/return')
      .set('Authorization', `Bearer ${cust1Token}`)
      .send({ reason: 'Item slightly scratched on unboxing' });
    expect(okReturn.status).toBe(201);
  });

  it('enforces regional refund approval limit: finance_reviewer blocked above limit (403), admin succeeds with audit log', async () => {
    const financeToken = await h.login('finance@demo.fulfilliq.test');
    const adminToken = await h.login('admin@demo.fulfilliq.test');

    // ret-ord-seed-11 is ~$356 in reg-central (limit $250)
    const finAttempt = await request(h.app)
      .post('/api/returns/ret-ord-seed-11/decision')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ decision: 'approve', reason: 'Attempt over region limit' });
    expect(finAttempt.status).toBe(403);

    const adminApprove = await request(h.app)
      .post('/api/returns/ret-ord-seed-11/decision')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'approve', reason: 'Admin verified high-value damage claim' });
    expect(adminApprove.status).toBe(200);
    expect(adminApprove.body.decision.orderStatus).toBe(OrderStatus.REFUNDED);

    const auditRes = await request(h.app)
      .get('/api/audit?entityId=ret-ord-seed-11')
      .set('Authorization', `Bearer ${financeToken}`);
    const logs = auditRes.body.logs as Array<{ action: string; actorRole: string; amountCents: number; reason: string }>;
    expect(
      logs.some(
        (l) =>
          l.action === 'REFUND_APPROVED' &&
          l.actorRole === 'admin' &&
          l.amountCents > 25000 &&
          l.reason.includes('Admin verified')
      )
    ).toBe(true);
  });
});
