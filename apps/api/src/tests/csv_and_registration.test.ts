import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, TestHarness } from './testHelper.ts';

describe('Local CSV Database & Self-Service Registration', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await createTestHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it('registers a new customer account locally, forces customer role, writes users.csv, and allows login', async () => {
    const regRes = await request(h.app).post('/api/auth/register').send({
      email: 'new.shopper@demo.fulfilliq.test',
      password: 'StrongPassword9!',
      fullName: 'Jordan Patel',
      phone: '+1-555-0144',
      role: 'admin', // Must be ignored server-side
    });

    expect(regRes.status).toBe(201);
    expect(regRes.body.user.role).toBe('customer');
    expect(regRes.body.accessToken).toBeTruthy();

    // Duplicate email rejected with 409
    const dupRes = await request(h.app).post('/api/auth/register').send({
      email: 'new.shopper@demo.fulfilliq.test',
      password: 'StrongPassword9!',
      fullName: 'Jordan Patel',
      phone: '+1-555-0144',
    });
    expect(dupRes.status).toBe(409);

    // Verify local users.csv mirror exists and contains the registered user without password hash
    const usersCsvPath = path.join(h.csvDir, 'users.csv');
    expect(fs.existsSync(usersCsvPath)).toBe(true);
    const csvContent = fs.readFileSync(usersCsvPath, 'utf8');
    expect(csvContent).toContain('new.shopper@demo.fulfilliq.test');
    expect(csvContent).not.toContain('password_hash');
    expect(csvContent).not.toContain('$2a$');
    expect(csvContent).not.toContain('$2b$');

    // Verify login works with newly registered local credentials
    const loginRes = await request(h.app).post('/api/auth/login').send({
      email: 'new.shopper@demo.fulfilliq.test',
      password: 'StrongPassword9!',
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.role).toBe('customer');
  });

  it('allows admin to import users CSV and enforces RBAC on user/inventory imports', async () => {
    const customerToken = await h.login('customer@demo.fulfilliq.test');
    const adminToken = await h.login('admin@demo.fulfilliq.test');

    const userCsv = [
      'email,password,full_name,phone,role,warehouse_id',
      'csv.picker@demo.fulfilliq.test,DemoPass123!,Taylor Picker,+1-555-0177,picker,wh-central',
    ].join('\n');

    // Customer cannot import users
    const forbiddenUserImport = await request(h.app)
      .post('/api/csv/import/users')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ csvText: userCsv });
    expect(forbiddenUserImport.status).toBe(403);

    // Admin imports users CSV
    const okUserImport = await request(h.app)
      .post('/api/csv/import/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ csvText: userCsv });
    expect(okUserImport.status).toBe(200);
    expect(okUserImport.body.report.createdCount).toBe(1);
    expect(okUserImport.body.report.errors).toHaveLength(0);

    // Imported picker can log in and receive picker role
    const pickerLogin = await request(h.app).post('/api/auth/login').send({
      email: 'csv.picker@demo.fulfilliq.test',
      password: 'DemoPass123!',
    });
    expect(pickerLogin.status).toBe(200);
    expect(pickerLogin.body.user.role).toBe('picker');
  });

  it('allows store_manager to import inventory CSV, triggers/prevents negative stock, and imports sales orders CSV', async () => {
    const managerToken = await h.login('manager@demo.fulfilliq.test');

    const invCsv = [
      'sku,barcode,name,category,description,price_cents,low_stock_threshold,warehouse_id,qty_available',
      'FIQ-SKU-099,890100000099,Thermal Shipping Scale,Hardware,Synthetic digital parcel scale,5400,5,wh-central,20',
      'FIQ-SKU-BAD,890100000098,Invalid Negative Item,Hardware,Should fail validation,1000,5,wh-central,-3',
    ].join('\n');

    const invRes = await request(h.app)
      .post('/api/csv/import/inventory')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ csvText: invCsv });

    expect(invRes.status).toBe(200);
    expect(invRes.body.report.createdCount).toBe(1);
    expect(invRes.body.report.errors).toHaveLength(1);

    // Import an order/sale against newly imported SKU and mark paid
    const orderCsv = [
      'customer_email,warehouse_id,product_sku,quantity,recipient_name,line1,city,postal_code,phone,mark_paid',
      'customer@demo.fulfilliq.test,wh-central,FIQ-SKU-099,3,Avery Chen,100 Synthetic Way,Metro City,10001,+1-555-0101,true',
    ].join('\n');

    const ordRes = await request(h.app)
      .post('/api/csv/import/orders')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ csvText: orderCsv });

    expect(ordRes.status).toBe(200);
    expect(ordRes.body.report.createdCount).toBe(1);
    expect(ordRes.body.report.errors).toHaveLength(0);

    // Check inventory.csv & orders_sales.csv exist on disk and reflect updated counts
    const invExport = await request(h.app)
      .get('/api/csv/export/inventory')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(invExport.status).toBe(200);
    expect(invExport.text).toContain('FIQ-SKU-099');
    expect(invExport.text).toContain('17'); // 20 - 3 sold

    const ordersCsvDisk = fs.readFileSync(path.join(h.csvDir, 'orders_sales.csv'), 'utf8');
    expect(ordersCsvDisk).toContain('PAID');

    // Finance reviewer export masks customer PII per shouldMaskCustomerContact
    const financeToken = await h.login('finance@demo.fulfilliq.test');
    const financeExport = await request(h.app)
      .get('/api/csv/export/orders')
      .set('Authorization', `Bearer ${financeToken}`);
    expect(financeExport.status).toBe(200);
    expect(financeExport.text).not.toContain('customer@demo.fulfilliq.test');
    expect(financeExport.text).toContain('cu***@demo.fulfilliq.test');
  });
});
