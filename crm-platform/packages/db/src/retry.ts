/**
 * Retrying a whole transaction after Postgres rolled it back for a reason that goes away on its own.
 *
 * Opt-in and explicit: a caller wraps the call that opens the transaction, `retryTransaction(() => db.tx(fn))`. The work inside `fn`
 * must have no effect outside the transaction (no provider call, no queued job), because it runs again from the start.
 */

const CONFLICT_CODES = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected
const CONNECTION_CODES = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
]);

/** The error and its causes (drizzle wraps the driver error), nearest first. */
function chain(err: unknown): Array<{ code?: unknown; message?: unknown }> {
  const out: Array<{ code?: unknown; message?: unknown }> = [];
  for (let e: unknown = err, i = 0; e && typeof e === 'object' && i < 5; i++) {
    out.push(e as { code?: unknown; message?: unknown });
    e = (e as { cause?: unknown }).cause;
  }
  return out;
}

/** Postgres rolled the transaction back because of a conflict with another one; running it again is always safe. */
export function isConflict(err: unknown): boolean {
  return chain(err).some((e) => typeof e.code === 'string' && CONFLICT_CODES.has(e.code));
}

/** The connection dropped. The transaction may or may not have committed (the loss can come after COMMIT was sent). */
export function isConnectionLoss(err: unknown): boolean {
  return chain(err).some(
    (e) =>
      (typeof e.code === 'string' && CONNECTION_CODES.has(e.code)) ||
      (typeof e.message === 'string' && /connection terminated|connection error/i.test(e.message)),
  );
}

export interface RetryOptions {
  /** Total tries including the first. Default 3. */
  attempts?: number;
  /** First backoff in ms; doubles each retry, capped at `maxMs`, then a random share of it (full jitter). Default 25. */
  baseMs?: number;
  maxMs?: number;
  /**
   * Also retry after a dropped connection. Only for a transaction that is safe to run twice even if the first run committed
   * (it carries an idempotency key or is an upsert). Default false: conflicts only.
   */
  idempotent?: boolean;
  /** Test seams. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; err: unknown }) => void;
}

export async function retryTransaction<T>(run: () => Promise<T>, o: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, o.attempts ?? 3);
  const baseMs = o.baseMs ?? 25;
  const maxMs = o.maxMs ?? 500;
  const random = o.random ?? Math.random;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      const retry = isConflict(err) || (o.idempotent === true && isConnectionLoss(err));
      if (!retry || attempt >= attempts) throw err;
      const delayMs = Math.floor(random() * Math.min(maxMs, baseMs * 2 ** (attempt - 1)));
      o.onRetry?.({ attempt, delayMs, err });
      await sleep(delayMs);
    }
  }
}
