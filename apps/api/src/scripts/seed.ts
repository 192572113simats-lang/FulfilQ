import 'dotenv/config';
import { getDb } from '../db/index.ts';
import { seedDatabase } from '../db/seed.ts';

async function main() {
  const force = process.argv.includes('--reset');
  const db = getDb();
  await seedDatabase(db, force);
  console.log(`Database seeded successfully (${db.dialect}, reset=${force})`);
  await db.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
