import { DbClient } from '../db/index.ts';
import { releaseExpiredReservations } from '../services/inventoryService.ts';

export function startReservationExpiryJob(db: DbClient, intervalMs = 30_000): () => void {
  const timer = setInterval(() => {
    releaseExpiredReservations(db).catch((err) => {
      console.error('[ReservationExpiryJob] Error:', err);
    });
  }, intervalMs);

  // Allow Node process to exit cleanly if only this timer remains
  timer.unref?.();

  return () => clearInterval(timer);
}
