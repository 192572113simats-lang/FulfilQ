import crypto from 'crypto';
import { OrderStatus } from '@fulfilliq/shared';
import { getConfig } from '../config.ts';
import { DbClient } from '../db/index.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { writeAuditLog } from './auditService.ts';
import { consumeReservationsOnPayment } from './inventoryService.ts';
import { transitionOrderStatus } from './orderStateMachine.ts';

export class GatewayUnavailableError extends Error {
  constructor(message = 'Payment gateway is temporarily unavailable') {
    super(message);
  }
}

export class GatewayDeclinedError extends Error {
  constructor(message = 'Payment declined by synthetic gateway') {
    super(message);
  }
}

export interface GatewayChargeInput {
  orderId: string;
  amountCents: number;
  idempotencyKey: string;
  syntheticCardLast4: string;
  simulatedOutcome?: 'succeed' | 'gateway_down' | 'decline';
}

export interface GatewayChargeResult {
  gatewayUsed: 'local_stub' | 'sandbox_http';
  gatewayRef: string;
}

export interface PaymentGateway {
  readonly mode: 'local_stub' | 'sandbox_http';
  charge(input: GatewayChargeInput): Promise<GatewayChargeResult>;
}

export class LocalStubGateway implements PaymentGateway {
  public readonly mode = 'local_stub' as const;
  private readonly simulateOutage: boolean;

  constructor(simulateOutage: boolean) {
    this.simulateOutage = simulateOutage;
  }

  async charge(input: GatewayChargeInput): Promise<GatewayChargeResult> {
    if (this.simulateOutage || input.simulatedOutcome === 'gateway_down') {
      throw new GatewayUnavailableError('LocalStubGateway simulated outage active');
    }
    if (input.simulatedOutcome === 'decline') {
      throw new GatewayDeclinedError('Synthetic card declined (test decline flow)');
    }
    return {
      gatewayUsed: 'local_stub',
      gatewayRef: `stub_ch_${crypto.createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 16)}`,
    };
  }
}

export class SandboxGateway implements PaymentGateway {
  public readonly mode = 'sandbox_http' as const;
  private readonly url: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly simulateOutage: boolean;

  constructor(opts: { url: string; apiKey: string; timeoutMs: number; simulateOutage: boolean }) {
    this.url = opts.url;
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs;
    this.simulateOutage = opts.simulateOutage;
  }

  async charge(input: GatewayChargeInput): Promise<GatewayChargeResult> {
    if (this.simulateOutage || input.simulatedOutcome === 'gateway_down') {
      throw new GatewayUnavailableError('SandboxGateway outage simulation active');
    }
    if (input.simulatedOutcome === 'decline') {
      throw new GatewayDeclinedError('Sandbox card declined');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const resp = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          orderId: input.orderId,
          amountCents: input.amountCents,
          syntheticCardLast4: input.syntheticCardLast4,
        }),
        signal: controller.signal,
      });

      if (resp.status >= 500) {
        throw new GatewayUnavailableError(`Sandbox gateway responded with HTTP ${resp.status}`);
      }
      if (!resp.ok) {
        throw new GatewayDeclinedError(`Sandbox gateway rejected charge (HTTP ${resp.status})`);
      }

      const data = (await resp.json()) as { id?: string; chargeId?: string };
      return {
        gatewayUsed: 'sandbox_http',
        gatewayRef: data.chargeId || data.id || `sbx_ch_${Date.now()}`,
      };
    } catch (err) {
      if (err instanceof GatewayDeclinedError) {
        throw err;
      }
      throw new GatewayUnavailableError(
        err instanceof Error ? `Sandbox gateway unreachable: ${err.message}` : 'Sandbox gateway unreachable'
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function getActivePaymentGateway(db: DbClient): Promise<{
  gateway: PaymentGateway;
  mode: 'local_stub' | 'sandbox_http';
  simulateOutage: boolean;
  sandboxUrl: string;
}> {
  const cfg = getConfig();
  const res = await db.query<{
    mode: string;
    simulate_outage: number;
    sandbox_url: string;
  }>("SELECT mode, simulate_outage, sandbox_url FROM gateway_config WHERE id = 'default'");

  const row = res.rows[0];
  const mode: 'local_stub' | 'sandbox_http' =
    row?.mode === 'sandbox_http' || cfg.paymentGatewayMode === 'sandbox_http'
      ? 'sandbox_http'
      : 'local_stub';
  const simulateOutage = Boolean(row?.simulate_outage);
  const sandboxUrl = row?.sandbox_url || cfg.sandboxGatewayUrl;

  if (mode === 'sandbox_http') {
    return {
      gateway: new SandboxGateway({
        url: sandboxUrl,
        apiKey: cfg.sandboxGatewayApiKey,
        timeoutMs: cfg.sandboxGatewayTimeoutMs,
        simulateOutage,
      }),
      mode,
      simulateOutage,
      sandboxUrl,
    };
  }

  return {
    gateway: new LocalStubGateway(simulateOutage),
    mode,
    simulateOutage,
    sandboxUrl,
  };
}

function computeNextRetryIso(retryCount: number): string {
  const backoffSeconds = Math.min(3600, Math.pow(2, retryCount) * 30);
  return new Date(Date.now() + backoffSeconds * 1000).toISOString();
}

export async function executeIdempotentPayment(
  db: DbClient,
  params: {
    idempotencyKey: string;
    endpoint: string;
    userId: string;
    userName: string;
    userRole: string;
    orderId: string;
    syntheticCardLast4: string;
    simulatedOutcome?: 'succeed' | 'gateway_down' | 'decline';
  }
): Promise<{ statusCode: number; body: Record<string, unknown>; replayed: boolean }> {
  // 1. Check idempotency store first
  const cached = await db.query<{ status_code: number; response_json: string; user_id: string }>(
    'SELECT status_code, response_json, user_id FROM idempotency_keys WHERE idempotency_key = $1',
    [params.idempotencyKey]
  );

  if (cached.rowCount > 0) {
    if (cached.rows[0].user_id !== params.userId) {
      throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key already used by another principal');
    }
    return {
      statusCode: Number(cached.rows[0].status_code),
      body: JSON.parse(cached.rows[0].response_json) as Record<string, unknown>,
      replayed: true,
    };
  }

  // 2. Load order & validate ownership / state
  const ordRes = await db.query<{
    id: string;
    order_number: string;
    customer_id: string;
    status: string;
    total_cents: number;
    reserved_until: string | null;
  }>(
    'SELECT id, order_number, customer_id, status, total_cents, reserved_until FROM orders WHERE id = $1',
    [params.orderId]
  );

  if (ordRes.rowCount === 0) {
    throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }

  const order = ordRes.rows[0];
  if (order.customer_id !== params.userId && params.userRole !== 'admin') {
    throw new HttpError(403, 'FORBIDDEN', 'You can only pay for your own orders');
  }

  if (order.status !== OrderStatus.RESERVED && order.status !== OrderStatus.PAYMENT_PENDING) {
    throw new HttpError(
      409,
      'INVALID_ORDER_STATE',
      `Order is in state ${order.status} and cannot accept payment`
    );
  }

  if (
    order.status === OrderStatus.RESERVED &&
    order.reserved_until &&
    new Date(order.reserved_until).getTime() <= Date.now()
  ) {
    throw new HttpError(409, 'RESERVATION_EXPIRED', 'Order stock reservation has expired');
  }

  // Check if a SUCCEEDED payment already exists for this order (double-charge prevention)
  const existingPaid = await db.query<{ id: string }>(
    "SELECT id FROM payment_intents WHERE order_id = $1 AND status = 'SUCCEEDED'",
    [params.orderId]
  );
  if (existingPaid.rowCount > 0) {
    throw new HttpError(409, 'ALREADY_PAID', 'Order already has a succeeded payment intent');
  }

  // 3. Call PaymentGateway outside long DB locks
  const { gateway, mode } = await getActivePaymentGateway(db);
  const paymentId = `pi-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  try {
    const result = await gateway.charge({
      orderId: order.id,
      amountCents: Number(order.total_cents),
      idempotencyKey: params.idempotencyKey,
      syntheticCardLast4: params.syntheticCardLast4,
      simulatedOutcome: params.simulatedOutcome,
    });

    const responseBody: Record<string, unknown> = {
      paymentIntent: {
        id: paymentId,
        orderId: order.id,
        idempotencyKey: params.idempotencyKey,
        amountCents: Number(order.total_cents),
        status: 'SUCCEEDED',
        gatewayUsed: result.gatewayUsed,
        gatewayRef: result.gatewayRef,
        retryCount: 0,
      },
      orderStatus: OrderStatus.PAID,
    };

    await db.withTransaction(async (tx) => {
      // Re-check idempotency key inside tx for concurrent duplicate retries
      const dup = await tx.query<{ status_code: number; response_json: string }>(
        'SELECT status_code, response_json FROM idempotency_keys WHERE idempotency_key = $1',
        [params.idempotencyKey]
      );
      if (dup.rowCount > 0) {
        return;
      }

      await tx.query(
        `INSERT INTO payment_intents (
          id, order_id, idempotency_key, amount_cents, status, gateway_used, gateway_ref,
          synthetic_card_last4, retry_count, next_retry_at, last_error, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,'SUCCEEDED',$5,$6,$7,0,NULL,NULL,$8,$9)`,
        [
          paymentId,
          order.id,
          params.idempotencyKey,
          Number(order.total_cents),
          result.gatewayUsed,
          result.gatewayRef,
          params.syntheticCardLast4,
          now,
          now,
        ]
      );

      await consumeReservationsOnPayment(tx, order.id);

      await transitionOrderStatus(tx, {
        orderId: order.id,
        toStatus: OrderStatus.PAID,
        actor: { id: params.userId, name: params.userName, role: params.userRole },
        amountCents: Number(order.total_cents),
        reason: `Payment confirmed via ${result.gatewayUsed} (${result.gatewayRef})`,
      });

      await tx.query(
        `INSERT INTO idempotency_keys (idempotency_key, endpoint, user_id, status_code, response_json, created_at)
         VALUES ($1,$2,$3,200,$4,$5)`,
        [params.idempotencyKey, params.endpoint, params.userId, JSON.stringify(responseBody), now]
      );
    });

    // If concurrent duplicate inserted first, return stored result
    const finalStored = await db.query<{ status_code: number; response_json: string }>(
      'SELECT status_code, response_json FROM idempotency_keys WHERE idempotency_key = $1',
      [params.idempotencyKey]
    );
    if (finalStored.rowCount > 0) {
      return {
        statusCode: Number(finalStored.rows[0].status_code),
        body: JSON.parse(finalStored.rows[0].response_json) as Record<string, unknown>,
        replayed: false,
      };
    }

    return { statusCode: 200, body: responseBody, replayed: false };
  } catch (err) {
    if (err instanceof GatewayUnavailableError) {
      const nextRetryAt = computeNextRetryIso(1);
      const extendedExpiry = new Date(Date.now() + 60 * 60_000).toISOString();
      const responseBody: Record<string, unknown> = {
        paymentIntent: {
          id: paymentId,
          orderId: order.id,
          idempotencyKey: params.idempotencyKey,
          amountCents: Number(order.total_cents),
          status: 'PENDING_RETRY',
          gatewayUsed: mode,
          gatewayRef: null,
          retryCount: 1,
          nextRetryAt,
          lastError: err.message,
        },
        orderStatus: OrderStatus.PAYMENT_PENDING,
        retryable: true,
        message: 'Payment gateway unavailable; order saved as PAYMENT_PENDING for safe retry.',
      };

      await db.withTransaction(async (tx) => {
        const dup = await tx.query<{ idempotency_key: string }>(
          'SELECT idempotency_key FROM idempotency_keys WHERE idempotency_key = $1',
          [params.idempotencyKey]
        );
        if (dup.rowCount > 0) return;

        await tx.query(
          `INSERT INTO payment_intents (
            id, order_id, idempotency_key, amount_cents, status, gateway_used, gateway_ref,
            synthetic_card_last4, retry_count, next_retry_at, last_error, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,'PENDING_RETRY',$5,NULL,$6,1,$7,$8,$9,$10)`,
          [
            paymentId,
            order.id,
            params.idempotencyKey,
            Number(order.total_cents),
            mode,
            params.syntheticCardLast4,
            nextRetryAt,
            err.message,
            now,
            now,
          ]
        );

        // Extend active reservation window while awaiting gateway recovery
        await tx.query(
          `UPDATE stock_reservations SET expires_at = $1 WHERE order_id = $2 AND status = 'ACTIVE'`,
          [extendedExpiry, order.id]
        );

        if (order.status === OrderStatus.RESERVED) {
          await transitionOrderStatus(tx, {
            orderId: order.id,
            toStatus: OrderStatus.PAYMENT_PENDING,
            actor: { id: params.userId, name: params.userName, role: params.userRole },
            amountCents: Number(order.total_cents),
            reason: `Gateway unavailable (${err.message}); queued for safe retry`,
            extraSetSql: 'reserved_until = __P1__',
            extraParams: [extendedExpiry],
          });
        }

        await tx.query(
          `INSERT INTO idempotency_keys (idempotency_key, endpoint, user_id, status_code, response_json, created_at)
           VALUES ($1,$2,$3,202,$4,$5)`,
          [params.idempotencyKey, params.endpoint, params.userId, JSON.stringify(responseBody), now]
        );
      });

      return { statusCode: 202, body: responseBody, replayed: false };
    }

    if (err instanceof GatewayDeclinedError) {
      throw new HttpError(402, 'PAYMENT_DECLINED', err.message);
    }

    throw err;
  }
}

export async function retryPendingPayment(
  db: DbClient,
  params: {
    orderId: string;
    actor: { id: string; name: string; role: string };
  }
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const piRes = await db.query<{
    id: string;
    order_id: string;
    idempotency_key: string;
    amount_cents: number;
    status: string;
    synthetic_card_last4: string;
    retry_count: number;
  }>(
    `SELECT id, order_id, idempotency_key, amount_cents, status, synthetic_card_last4, retry_count
     FROM payment_intents
     WHERE order_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [params.orderId]
  );

  if (piRes.rowCount === 0) {
    throw new HttpError(404, 'PAYMENT_INTENT_NOT_FOUND', 'No payment intent found for order');
  }

  const pi = piRes.rows[0];
  if (pi.status === 'SUCCEEDED') {
    // Idempotent safe return: never double charge!
    return {
      statusCode: 200,
      body: {
        paymentIntent: {
          id: pi.id,
          orderId: pi.order_id,
          idempotencyKey: pi.idempotency_key,
          amountCents: Number(pi.amount_cents),
          status: 'SUCCEEDED',
        },
        orderStatus: OrderStatus.PAID,
        alreadySucceeded: true,
      },
    };
  }

  const { gateway, mode } = await getActivePaymentGateway(db);
  const now = new Date().toISOString();

  try {
    const result = await gateway.charge({
      orderId: pi.order_id,
      amountCents: Number(pi.amount_cents),
      idempotencyKey: pi.idempotency_key,
      syntheticCardLast4: pi.synthetic_card_last4,
    });

    await db.withTransaction(async (tx) => {
      const updated = await tx.query<{ id: string }>(
        `UPDATE payment_intents
         SET status = 'SUCCEEDED',
             gateway_used = $1,
             gateway_ref = $2,
             last_error = NULL,
             next_retry_at = NULL,
             updated_at = $3
         WHERE id = $4 AND status != 'SUCCEEDED'
         RETURNING id`,
        [result.gatewayUsed, result.gatewayRef, now, pi.id]
      );

      if (updated.rowCount === 0) {
        return;
      }

      await consumeReservationsOnPayment(tx, pi.order_id);

      await transitionOrderStatus(tx, {
        orderId: pi.order_id,
        toStatus: OrderStatus.PAID,
        actor: params.actor,
        amountCents: Number(pi.amount_cents),
        reason: `Retry succeeded via ${result.gatewayUsed} (${result.gatewayRef}) with original idempotency key`,
      });

      await writeAuditLog(tx, {
        entityType: 'payment',
        entityId: pi.id,
        action: 'PAYMENT_RETRY_SUCCEEDED',
        fromState: 'PENDING_RETRY',
        toState: 'SUCCEEDED',
        actorId: params.actor.id,
        actorName: params.actor.name,
        actorRole: params.actor.role,
        amountCents: Number(pi.amount_cents),
        reason: `Reused idempotency key ${pi.idempotency_key}`,
        createdAt: now,
      });
    });

    return {
      statusCode: 200,
      body: {
        paymentIntent: {
          id: pi.id,
          orderId: pi.order_id,
          idempotencyKey: pi.idempotency_key,
          amountCents: Number(pi.amount_cents),
          status: 'SUCCEEDED',
          gatewayUsed: result.gatewayUsed,
          gatewayRef: result.gatewayRef,
        },
        orderStatus: OrderStatus.PAID,
      },
    };
  } catch (err) {
    if (err instanceof GatewayUnavailableError) {
      const nextCount = Number(pi.retry_count) + 1;
      const nextRetryAt = computeNextRetryIso(nextCount);
      await db.query(
        `UPDATE payment_intents
         SET retry_count = $1, next_retry_at = $2, last_error = $3, gateway_used = $4, updated_at = $5
         WHERE id = $6`,
        [nextCount, nextRetryAt, err.message, mode, now, pi.id]
      );
      return {
        statusCode: 202,
        body: {
          paymentIntent: {
            id: pi.id,
            orderId: pi.order_id,
            status: 'PENDING_RETRY',
            retryCount: nextCount,
            nextRetryAt,
            lastError: err.message,
          },
          orderStatus: OrderStatus.PAYMENT_PENDING,
          retryable: true,
        },
      };
    }
    throw err;
  }
}
