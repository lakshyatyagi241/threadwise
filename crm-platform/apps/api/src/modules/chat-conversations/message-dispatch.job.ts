import { z } from 'zod';

/**
 * One job on `message-dispatch` per outbound message to send. The job carries ids only: the worker re-reads the message, so a job can
 * never send stale text and an edited or already-sent message is simply skipped.
 */
export const MESSAGE_SEND_JOB = 'message.send';

export const messageSendJobSchema = z.object({
  orgId: z.number().int().positive(),
  messageUuid: z.string().uuid(),
  /** 1 for the first dispatch of a message, +1 per manual Retry (so a retry gets a job id the first run's finished job does not hold). */
  generation: z.number().int().positive(),
});
export type MessageSendJob = z.infer<typeof messageSendJobSchema>;

/**
 * Attempts and backoff of a send. More than the queue default (5): a worker that was killed holds its message's send lock for a
 * minute, and the backoff (2 s doubling) must outlast it so the retry finds the lock free instead of failing the message.
 */
export const MESSAGE_SEND_JOB_OPTIONS = {
  attempts: 8,
  // `custom`: exponential from 2 s like before, except when the provider said how long to wait (a rate limit): then that long.
  // The strategy lives in `sendBackoffStrategy`, registered on the worker.
  backoff: { type: 'custom' as const, delay: 2_000 },
};

/** Never wait longer than this between two attempts, whatever the provider asked: a message must come back to a person. */
const MAX_BACKOFF_MS = 60 * 60_000;

/**
 * BullMQ's `settings.backoffStrategy` for `message.send` jobs. A `ChannelError` that carries `retryAfterMs` (rate limits: Meta 130429,
 * 80007, 131048, an HTTP Retry-After) sets the wait; anything else keeps the exponential rule. Jobs queued before this existed carry
 * the built-in `exponential` type and never reach it.
 */
export function sendBackoffStrategy(attemptsMade: number, _type?: string, err?: Error): number {
  const hint = (err as { retryAfterMs?: unknown } | undefined)?.retryAfterMs;
  if (typeof hint === 'number' && hint > 0) return Math.min(hint, MAX_BACKOFF_MS);
  return 2_000 * 2 ** Math.max(attemptsMade - 1, 0);
}

export const messageSendJobId = (messageUuid: string, generation: number): string =>
  `msg-${messageUuid}-${generation}`;
