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
  backoff: { type: 'exponential' as const, delay: 2_000 },
};

export const messageSendJobId = (messageUuid: string, generation: number): string =>
  `msg-${messageUuid}-${generation}`;
