import { z } from 'zod';

/**
 * Operator tools for work that ran out of retries (ASYNC-041, 044, 045, 046, 050): list what is stuck and replay it.
 * Replay never takes a payload from the caller: it re-queues what is already stored, so it cannot be used to inject work.
 */

/** Outbox events that ran out of retries, grouped by type. No payload is ever returned: it can hold personal data. */
export const deadOutboxGroupSchema = z.object({
  eventType: z.string(),
  count: z.number().int().nonnegative(),
  oldestAt: z.string(),
  /** The most recent failure reason of one event of the group, cut to 300 characters. */
  lastError: z.string().nullable(),
});
export type DeadOutboxGroup = z.infer<typeof deadOutboxGroupSchema>;

export const outboxReplayRequestSchema = z.object({
  eventType: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.:-]+$/),
  limit: z.number().int().min(1).max(1000).default(200),
});
export type OutboxReplayRequest = z.infer<typeof outboxReplayRequestSchema>;

export const outboxReplayResultSchema = z.object({
  replayed: z.number().int().nonnegative(),
  /** Dead events of this type left alone because their workspace is no longer active. */
  skippedInactiveWorkspace: z.number().int().nonnegative(),
});
export type OutboxReplayResult = z.infer<typeof outboxReplayResultSchema>;

/** A WhatsApp webhook payload job that failed for good. The payload itself (message text, phone numbers) is never returned. */
export const failedIngestJobSchema = z.object({
  jobId: z.string(),
  attemptsMade: z.number().int().nonnegative(),
  failedReason: z.string().nullable(),
  failedAt: z.string().nullable(),
});
export type FailedIngestJob = z.infer<typeof failedIngestJobSchema>;

export const wabaReplayRequestSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
});
export type WabaReplayRequest = z.infer<typeof wabaReplayRequestSchema>;

export const wabaReplayResultSchema = z.object({
  replayed: z.number().int().nonnegative(),
  /** Jobs that were no longer failed by the time they were retried (another operator got there first). */
  skipped: z.number().int().nonnegative(),
});
export type WabaReplayResult = z.infer<typeof wabaReplayResultSchema>;
