import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { getConfig } from './apps/api/src/config.ts';
import { getDb } from './apps/api/src/db/index.ts';
import { seedDatabase } from './apps/api/src/db/seed.ts';
import { startReservationExpiryJob } from './apps/api/src/jobs/reservationExpiryJob.ts';
import { createApiApp } from './apps/api/src/app.ts';

async function bootstrap() {
  const cfg = getConfig();
  const db = getDb();
  await seedDatabase(db, false);
  startReservationExpiryJob(db, 30_000);

  const app = createApiApp(db);

  if (cfg.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || cfg.port || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`FulfillIQ running on http://0.0.0.0:${port} (db=${db.dialect}, env=${cfg.nodeEnv})`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
