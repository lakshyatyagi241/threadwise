import type { WebhookEnvelope } from '@crm/contracts';
import { exponentialDelayMs, providerWaitMs } from '../../infra/queue/backoff';

/** One delivery to be made: an event for one endpoint. The envelope is built once, so every retry carries the same `id`. */
export interface WebhookDeliveryJob {
  orgId: number;
  webhookId: number;
  envelope: WebhookEnvelope;
}

/** Retries after a failed attempt: 6 attempts in all, waiting 10 s, 20 s, 40 s, 80 s, 160 s between them. */
export const DELIVERY_ATTEMPTS = 6;
export const DELIVERY_BACKOFF_MS = 10_000;

/** Never wait longer than this between two attempts, whatever the endpoint asked. */
const MAX_BACKOFF_MS = 60 * 60_000;

/** A failed attempt whose endpoint said how long to wait (`Retry-After`). The queue's backoff honours it as a minimum. */
export class RetryAfterError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = 'RetryAfterError';
  }
}

/**
 * BullMQ `settings.backoffStrategy` of the delivery queue: the endpoint's `Retry-After` when it sent one, otherwise our jittered
 * exponential schedule (10 s, 20 s, 40 s ...). Jobs queued before this existed carry the built-in `exponential` type and never reach it.
 */
export function webhookBackoffStrategy(attemptsMade: number, _type?: string, err?: Error): number {
  const hint = (err as { retryAfterMs?: unknown } | undefined)?.retryAfterMs;
  if (typeof hint === 'number' && hint > 0) return providerWaitMs(hint, MAX_BACKOFF_MS);
  return exponentialDelayMs(DELIVERY_BACKOFF_MS, attemptsMade, MAX_BACKOFF_MS);
}
