import 'dotenv/config';
import { getDb } from '../db/index.ts';
import { runMigrations } from '../db/migrations/001_init.ts';

async function main() {
  const db = getDb();
  await runMigrations(db);
  console.log(`Migrations applied successfully (${db.dialect})`);
  await db.close();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
