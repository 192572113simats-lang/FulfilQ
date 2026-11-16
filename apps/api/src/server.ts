import 'dotenv/config';
import { getConfig } from './config.ts';
import { getDb } from './db/index.ts';
import { seedDatabase } from './db/seed.ts';
import { startReservationExpiryJob } from './jobs/reservationExpiryJob.ts';
import { createApiApp } from './app.ts';

async function start() {
  const cfg = getConfig();
  const db = getDb();
  await seedDatabase(db, false);
  startReservationExpiryJob(db, 30_000);

  const app = createApiApp(db);
  const port = Number(process.env.API_PORT || cfg.port || 4000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`FulfillIQ API listening on http://0.0.0.0:${port} (dialect=${db.dialect})`);
  });
}

start().catch((err) => {
  console.error('Failed to start API server:', err);
  process.exit(1);
});
