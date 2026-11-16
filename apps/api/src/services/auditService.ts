import crypto from 'crypto';
import { DbExecutor } from '../db/index.ts';

export interface AuditEntryInput {
  entityType: 'order' | 'payment' | 'return' | 'stock' | 'region' | 'user' | 'gateway';
  entityId: string;
  action: string;
  fromState?: string | null;
  toState?: string | null;
  actorId: string;
  actorName: string;
  actorRole: string;
  amountCents?: number | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export async function writeAuditLog(db: DbExecutor, entry: AuditEntryInput): Promise<string> {
  const id = `aud-${crypto.randomUUID()}`;
  const createdAt = entry.createdAt ?? new Date().toISOString();
  await db.query(
    `INSERT INTO audit_logs (
      id, entity_type, entity_id, action, from_state, to_state,
      actor_id, actor_name, actor_role, amount_cents, reason, metadata_json, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.fromState ?? null,
      entry.toState ?? null,
      entry.actorId,
      entry.actorName,
      entry.actorRole,
      entry.amountCents ?? null,
      entry.reason ?? null,
      JSON.stringify(entry.metadata ?? {}),
      createdAt,
    ]
  );
  return id;
}
