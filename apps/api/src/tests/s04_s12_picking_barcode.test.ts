import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrderStatus } from '@fulfilliq/shared';
import { createTestHarness, TestHarness } from './testHelper.ts';

describe('S04 & S12 Warehouse Pick List & Barcode Confirmation', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await createTestHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it('rejects wrong barcode/SKU scan (422), blocks packing before all units scanned (409), and supports manual SKU fallback', async () => {
    const pickerToken = await h.login('picker@demo.fulfilliq.test');

    // ord-seed-03 is PAID with prod-005 (barcode 890100000005, sku FIQ-SKU-005, qty 1)
    const packEarly = await request(h.app)
      .post('/api/picking/ord-seed-03/pack')
      .set('Authorization', `Bearer ${pickerToken}`);
    expect(packEarly.status).toBe(409);

    const wrongScan = await request(h.app)
      .post('/api/picking/ord-seed-03/scan')
      .set('Authorization', `Bearer ${pickerToken}`)
      .send({ barcodeOrSku: '999999999999' });
    expect(wrongScan.status).toBe(422);

    // Confirm via manual SKU fallback
    const goodScan = await request(h.app)
      .post('/api/picking/ord-seed-03/scan')
      .set('Authorization', `Bearer ${pickerToken}`)
      .send({ barcodeOrSku: 'FIQ-SKU-005', quantity: 1 });
    expect(goodScan.status).toBe(200);
    expect(goodScan.body.status).toBe(OrderStatus.PICKING);

    const packOk = await request(h.app)
      .post('/api/picking/ord-seed-03/pack')
      .set('Authorization', `Bearer ${pickerToken}`);
    expect(packOk.status).toBe(200);
    expect(packOk.body.status).toBe(OrderStatus.PACKED);
  });
});
