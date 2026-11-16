import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrderStatus } from '@fulfilliq/shared';
import { releaseExpiredReservations } from '../services/inventoryService.ts';
import { createTestHarness, TestHarness } from './testHelper.ts';

describe('S02 Order Stock Concurrency & Reservation Expiry', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await createTestHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it('handles 100 concurrent orders for a 10-unit item with at most 10 reservations and never negative stock', async () => {
    const custToken = await h.login('customer@demo.fulfilliq.test');

    // prod-001 in wh-central is seeded with exactly 10 units
    const requests = Array.from({ length: 100 }, (_, i) =>
      request(h.app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${custToken}`)
        .send({
          warehouseId: 'wh-central',
          items: [{ productId: 'prod-001', quantity: 1 }],
          shippingAddress: {
            recipientName: `Concurrent Buyer ${i}`,
            line1: '100 Test Way',
            city: 'Metro City',
            postalCode: '10001',
            country: 'Synthetic Republic',
            phone: '+1-555-0101',
          },
        })
    );

    const responses = await Promise.all(requests);
    const succeeded = responses.filter((r) => r.status === 201);
    const rejected = responses.filter((r) => r.status === 409);

    expect(succeeded.length).toBe(10);
    expect(rejected.length).toBe(90);

    const stockRes = await h.db.query<{ qty_available: number; qty_reserved: number }>(
      "SELECT qty_available, qty_reserved FROM warehouse_stock WHERE warehouse_id = 'wh-central' AND product_id = 'prod-001'"
    );
    expect(Number(stockRes.rows[0].qty_available)).toBe(0);
    expect(Number(stockRes.rows[0].qty_reserved)).toBe(10);
  });

  it('releases expired reservations back to available stock and transitions order to EXPIRED', async () => {
    const custToken = await h.login('customer@demo.fulfilliq.test');

    const beforeStock = await h.db.query<{ qty_available: number }>(
      "SELECT qty_available FROM warehouse_stock WHERE warehouse_id = 'wh-central' AND product_id = 'prod-015'"
    );
    const initialAvail = Number(beforeStock.rows[0].qty_available);

    const orderRes = await request(h.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${custToken}`)
      .send({
        warehouseId: 'wh-central',
        items: [{ productId: 'prod-015', quantity: 2 }],
        shippingAddress: {
          recipientName: 'Expiry Tester',
          line1: '100 Test Way',
          city: 'Metro City',
          postalCode: '10001',
          country: 'Synthetic Republic',
          phone: '+1-555-0101',
        },
      });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.order.id as string;

    const midStock = await h.db.query<{ qty_available: number }>(
      "SELECT qty_available FROM warehouse_stock WHERE warehouse_id = 'wh-central' AND product_id = 'prod-015'"
    );
    expect(Number(midStock.rows[0].qty_available)).toBe(initialAvail - 2);

    // Simulate clock advancing past expiry window
    const futureIso = new Date(Date.now() + 30 * 60_000).toISOString();
    const released = await releaseExpiredReservations(h.db, futureIso);
    expect(released).toBeGreaterThanOrEqual(1);

    const afterStock = await h.db.query<{ qty_available: number }>(
      "SELECT qty_available FROM warehouse_stock WHERE warehouse_id = 'wh-central' AND product_id = 'prod-015'"
    );
    expect(Number(afterStock.rows[0].qty_available)).toBe(initialAvail);

    const ordCheck = await h.db.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
    expect(ordCheck.rows[0].status).toBe(OrderStatus.EXPIRED);
  });
});
