import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { Express } from 'express';
import { createApiApp } from '../app.ts';
import { UnifiedDbClient } from '../db/index.ts';
import { seedDatabase } from '../db/seed.ts';

export interface TestHarness {
  db: UnifiedDbClient;
  app: Express;
  dbPath: string;
  csvDir: string;
  cleanup: () => Promise<void>;
  login: (email: string) => Promise<string>;
}

export async function createTestHarness(): Promise<TestHarness> {
  process.env.NODE_ENV = 'test';
  const id = crypto.randomUUID();
  const dbPath = path.join(os.tmpdir(), `fulfilliq-test-${id}.db`);
  const csvDir = path.join(os.tmpdir(), `fulfilliq-csv-${id}`);
  process.env.CSV_DIR = csvDir;

  const db = new UnifiedDbClient({ dialect: 'sqlite', sqlitePath: dbPath });
  await seedDatabase(db, true);
  const app = createApiApp(db);

  return {
    db,
    app,
    dbPath,
    csvDir,
    cleanup: async () => {
      await db.close();
      for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(dbPath + suffix)) {
          fs.unlinkSync(dbPath + suffix);
        }
      }
      if (fs.existsSync(csvDir)) {
        fs.rmSync(csvDir, { recursive: true, force: true });
      }
    },
    login: async (email: string) => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'DemoPass123!' });
      if (res.status !== 200) {
        throw new Error(`Test login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
      }
      return res.body.accessToken as string;
    },
  };
}
