import { isValidOrderTransition, OrderStatus } from '@fulfilliq/shared';
import { DbExecutor } from '../db/index.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { writeAuditLog } from './auditService.ts';

export interface TransitionActor {
  id: string;
  name: string;
  role: string;
}

export async function transitionOrderStatus(
  tx: DbExecutor,
  params: {
    orderId: string;
    toStatus: OrderStatus;
    actor: TransitionActor;
    reason?: string;
    amountCents?: number | null;
    extraSetSql?: string;
    extraParams?: Array<string | number | boolean | null>;
  }
): Promise<{ fromStatus: OrderStatus; toStatus: OrderStatus }> {
  const res = await tx.query<{ status: string }>(
    'SELECT status FROM orders WHERE id = $1',
    [params.orderId]
  );
  if (res.rowCount === 0) {
    throw new HttpError(404, 'ORDER_NOT_FOUND', `Order ${params.orderId} not found`);
  }

  const fromStatus = res.rows[0].status as OrderStatus;
  if (!isValidOrderTransition(fromStatus, params.toStatus)) {
    throw new HttpError(
      409,
      'INVALID_STATE_TRANSITION',
      `Invalid order state transition from ${fromStatus} to ${params.toStatus}`
    );
  }

  const now = new Date().toISOString();
  const baseParams: Array<string | number | boolean | null> = [
    params.toStatus,
    now,
    params.orderId,
  ];

  let sql = 'UPDATE orders SET status = $1, updated_at = $2';
  if (params.toStatus === OrderStatus.DELIVERED) {
    baseParams.push(now);
    sql += `, delivered_at = $${baseParams.length}`;
  }
  if (params.extraSetSql && params.extraParams) {
    let adjusted = params.extraSetSql;
    params.extraParams.forEach((p, idx) => {
      const targetIdx = baseParams.length + 1;
      adjusted = adjusted.replace(`__P${idx + 1}__`, `$${targetIdx}`);
      baseParams.push(p);
    });
    sql += `, ${adjusted}`;
  }
  sql += ' WHERE id = $3';

  await tx.query(sql, baseParams);

  await writeAuditLog(tx, {
    entityType: 'order',
    entityId: params.orderId,
    action: 'STATUS_TRANSITION',
    fromState: fromStatus,
    toState: params.toStatus,
    actorId: params.actor.id,
    actorName: params.actor.name,
    actorRole: params.actor.role,
    amountCents: params.amountCents ?? null,
    reason: params.reason ?? `Transitioned ${fromStatus} -> ${params.toStatus}`,
    createdAt: now,
  });

  return { fromStatus, toStatus: params.toStatus };
}
