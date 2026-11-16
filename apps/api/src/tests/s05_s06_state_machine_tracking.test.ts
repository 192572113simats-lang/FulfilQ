import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrderStatus } from '@fulfilliq/shared';
import { createTestHarness, TestHarness } from './testHelper.ts';

describe('S05 & S06 Strict Order State Machine & Accessible Tracking', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await createTestHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it('rejects invalid state transitions with 409 and emits audit rows for valid transitions', async () => {
    const managerToken = await h.login('manager@demo.fulfilliq.test');
    const financeToken = await h.login('finance@demo.fulfilliq.test');

    // ord-seed-06 is PACKED -> cannot jump straight to DELIVERED
    const invalidRes = await request(h.app)
      .patch('/api/orders/ord-seed-06/status')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: OrderStatus.DELIVERED });
    expect(invalidRes.status).toBe(409);

    // Valid transition: PACKED -> DISPATCHED
    const validRes = await request(h.app)
      .patch('/api/orders/ord-seed-06/status')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: OrderStatus.DISPATCHED, reason: 'Handed to regional courier' });
    expect(validRes.status).toBe(200);
    expect(validRes.body.status).toBe(OrderStatus.DISPATCHED);

    // Verify audit row created
    const auditRes = await request(h.app)
      .get('/api/audit?entityId=ord-seed-06')
      .set('Authorization', `Bearer ${financeToken}`);
    expect(auditRes.status).toBe(200);
    const logs = auditRes.body.logs as Array<{ fromState: string; toState: string; actorRole: string }>;
    expect(logs.some((l) => l.fromState === 'PACKED' && l.toState === 'DISPATCHED' && l.actorRole === 'store_manager')).toBe(true);
  });

  it('exposes only permitted customer milestones and hides internalNotes from customer', async () => {
    const custToken = await h.login('customer@demo.fulfilliq.test');

    const trackRes = await request(h.app)
      .get('/api/orders/ord-seed-08/tracking')
      .set('Authorization', `Bearer ${custToken}`);
    expect(trackRes.status).toBe(200);
    expect(trackRes.body.internalNotes).toBeUndefined();
    expect(Array.isArray(trackRes.body.milestones)).toBe(true);
    expect(trackRes.body.milestones.map((m: { key: string }) => m.key)).toEqual([
      'paid',
      'picked',
      'dispatched',
      'delivered',
    ]);

    const detailRes = await request(h.app)
      .get('/api/orders/ord-seed-08')
      .set('Authorization', `Bearer ${custToken}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.order.internalNotes).toBeUndefined();
  });
});
