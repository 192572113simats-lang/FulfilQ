import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { OrderStatus } from '@fulfilliq/shared';
import { UnifiedDbClient } from '../db/index.ts';
import { seedDatabase } from '../db/seed.ts';
import { createApiApp } from '../app.ts';

async function runDemoJourney() {
  const dbPath = path.resolve('./data/demo-journey.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new UnifiedDbClient({ dialect: 'sqlite', sqlitePath: dbPath });
  await seedDatabase(db, true);
  const app = createApiApp(db);

  const login = async (email: string) => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'DemoPass123!' });
    if (res.status !== 200) throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
    return res.body.accessToken as string;
  };

  console.log('=== FulfillIQ End-to-End Synthetic Journey (Order -> Delivered & Return -> Refunded) ===');
  const custToken = await login('customer@demo.fulfilliq.test');
  const pickerToken = await login('picker@demo.fulfilliq.test');
  const managerToken = await login('manager@demo.fulfilliq.test');
  const supportToken = await login('support@demo.fulfilliq.test');
  const financeToken = await login('finance@demo.fulfilliq.test');

  // 1. Place Order #1 (Drive to DELIVERED)
  const ord1Res = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${custToken}`)
    .send({
      warehouseId: 'wh-central',
      items: [{ productId: 'prod-003', quantity: 1 }],
      shippingAddress: {
        recipientName: 'Avery Chen',
        line1: '100 Synthetic Way',
        city: 'Metro City',
        postalCode: '10001',
        country: 'Synthetic Republic',
        phone: '+1-555-0101',
      },
    });
  if (ord1Res.status !== 201) throw new Error(`Order 1 failed: ${JSON.stringify(ord1Res.body)}`);
  const ord1 = ord1Res.body.order;
  console.log(`1. Placed & Reserved Order ${ord1.orderNumber} (${ord1.id}), total=$${(ord1.totalCents / 100).toFixed(2)}`);

  // 2. Pay Order #1 with Idempotency-Key
  const pay1Res = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${custToken}`)
    .set('Idempotency-Key', `demo-pay-1-${Date.now()}`)
    .send({ orderId: ord1.id, method: 'synthetic_card', syntheticCardLast4: '4242' });
  if (pay1Res.status !== 200) throw new Error(`Pay 1 failed: ${JSON.stringify(pay1Res.body)}`);
  console.log(`2. Payment Confirmed (${pay1Res.body.paymentIntent.gatewayRef}) -> status=${pay1Res.body.orderStatus}`);

  // 3. Picker scans barcode & packs
  const scanRes = await request(app)
    .post(`/api/picking/${ord1.id}/scan`)
    .set('Authorization', `Bearer ${pickerToken}`)
    .send({ barcodeOrSku: '890100000003', quantity: 1 });
  if (scanRes.status !== 200) throw new Error(`Scan failed: ${JSON.stringify(scanRes.body)}`);
  const packRes = await request(app)
    .post(`/api/picking/${ord1.id}/pack`)
    .set('Authorization', `Bearer ${pickerToken}`);
  if (packRes.status !== 200) throw new Error(`Pack failed: ${JSON.stringify(packRes.body)}`);
  console.log(`3. Picker scanned barcode 890100000003 and packed -> status=${packRes.body.status}`);

  // 4. Store Manager dispatches & marks delivered
  const dispRes = await request(app)
    .patch(`/api/orders/${ord1.id}/status`)
    .set('Authorization', `Bearer ${managerToken}`)
    .send({ status: OrderStatus.DISPATCHED, reason: 'Handed to synthetic courier' });
  if (dispRes.status !== 200) throw new Error(`Dispatch failed: ${JSON.stringify(dispRes.body)}`);
  const delivRes = await request(app)
    .patch(`/api/orders/${ord1.id}/status`)
    .set('Authorization', `Bearer ${managerToken}`)
    .send({ status: OrderStatus.DELIVERED, reason: 'Synthetic delivery confirmed' });
  if (delivRes.status !== 200) throw new Error(`Deliver failed: ${JSON.stringify(delivRes.body)}`);
  console.log(`4. Store Manager dispatched & delivered -> status=${delivRes.body.status}`);

  // 5. Drive Return -> Refunded on Order #1
  const retRes = await request(app)
    .post(`/api/orders/${ord1.id}/return`)
    .set('Authorization', `Bearer ${custToken}`)
    .send({ reason: 'Synthetic demo return: color mismatch' });
  if (retRes.status !== 201) throw new Error(`Return request failed: ${JSON.stringify(retRes.body)}`);
  const returnId = retRes.body.returnRequest.id;
  console.log(`5. Customer requested return (${returnId}) -> RETURN_REQUESTED`);

  const queueRes = await request(app)
    .post(`/api/returns/${returnId}/queue-refund`)
    .set('Authorization', `Bearer ${supportToken}`);
  if (queueRes.status !== 200) throw new Error(`Queue refund failed: ${JSON.stringify(queueRes.body)}`);
  console.log(`6. Support agent verified return & queued -> REFUND_PENDING`);

  const decRes = await request(app)
    .post(`/api/returns/${returnId}/decision`)
    .set('Authorization', `Bearer ${financeToken}`)
    .send({ decision: 'approve', reason: 'Within Central Hub limit; item inspected' });
  if (decRes.status !== 200) throw new Error(`Refund decision failed: ${JSON.stringify(decRes.body)}`);
  console.log(`7. Finance Reviewer approved refund ($${(decRes.body.decision.amountCents / 100).toFixed(2)}) -> ${decRes.body.decision.orderStatus}`);

  // 6. Print full audit trail
  const auditRes = await request(app)
    .get(`/api/audit?entityId=${ord1.id}`)
    .set('Authorization', `Bearer ${financeToken}`);

  console.log('\n--- Immutable Audit Trail for Order ---');
  for (const row of [...auditRes.body.logs].reverse()) {
    console.log(
      `[${row.createdAt}] ${row.action} | ${row.fromState ?? 'NULL'} -> ${row.toState ?? '-'} | actor=${row.actorName} (${row.actorRole}) | reason=${row.reason}`
    );
  }

  await db.close();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  console.log('\nDemo journey completed cleanly.');
}

runDemoJourney().catch((err) => {
  console.error(err);
  process.exit(1);
});
