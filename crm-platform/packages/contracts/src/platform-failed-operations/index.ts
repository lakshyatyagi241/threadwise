import { z } from 'zod';

/**
 * Operator tools for background work that ran out of retries or failed for good: look at the durable record, redrive one operation,
 * or close it. A record never exposes the stored payload (message text, phone numbers, raw webhook bodies) or an internal id, and a
 * redrive takes nothing from the caller except the record id: the payload, workspace and eligibility all come from the stored record.
 */

export const failedOperationStatusSchema = z.enum([
  'OPEN',
  'BLOCKED',
  'RECONCILIATION_REQUIRED',
  'READY_FOR_REDRIVE',
  'REDRIVING',
  'RESOLVED',
  'TERMINAL',
  'ESCALATED',
]);
export type FailedOperationStatus = z.infer<typeof failedOperationStatusSchema>;

export const failureCategorySchema = z.enum([
  'TRANSIENT',
  'PERMANENT',
  'RATE_LIMITED',
  'AMBIGUOUS',
  'INFRASTRUCTURE',
  'VALIDATION',
  'AUTHORIZATION',
  'POISON_MESSAGE',
]);
export type FailureCategory = z.infer<typeof failureCategorySchema>;

export const failedOperationSchema = z.object({
  uuid: z.string().uuid(),
  sourceQueue: z.string(),
  jobName: z.string(),
  originalJobId: z.string(),
  /** The workspace, when the job named it; null when the worker finds it later (a WhatsApp number). */
  orgId: z.number().int().positive().nullable(),
  status: failedOperationStatusSchema,
  failureCategory: failureCategorySchema,
  /** A stable name for the cause; dashboards and the runbook use it. */
  errorCode: z.string(),
  /** One scrubbed line, at most 300 characters. A hint, not an identifier. */
  errorSummary: z.string().nullable(),
  attemptsMade: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  hasPayload: z.boolean(),
  replayCount: z.number().int().nonnegative(),
  lastReplayAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolutionReason: z.string().nullable(),
  firstFailedAt: z.string(),
  lastFailedAt: z.string(),
});
export type FailedOperation = z.infer<typeof failedOperationSchema>;

export const failedOperationEventSchema = z.object({
  eventType: z.string(),
  actorType: z.string(),
  actorId: z.number().int().nullable(),
  detail: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type FailedOperationEvent = z.infer<typeof failedOperationEventSchema>;

export const failedOperationDetailSchema = failedOperationSchema.extend({
  events: z.array(failedOperationEventSchema),
});
export type FailedOperationDetail = z.infer<typeof failedOperationDetailSchema>;

export const failedOperationsQuerySchema = z.object({
  status: failedOperationStatusSchema.optional(),
  queue: z.string().min(1).max(60).optional(),
  openOnly: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type FailedOperationsQuery = z.infer<typeof failedOperationsQuerySchema>;

export const redriveRequestSchema = z.object({
  /** The operator states the cause of a BLOCKED operation is repaired (a credential renewed, a fix deployed). Required for BLOCKED. */
  acknowledgeRepair: z.boolean().default(false),
});
export type RedriveRequest = z.infer<typeof redriveRequestSchema>;

export const redriveResultSchema = z.object({
  redriven: z.boolean(),
  code: z.string(),
  reason: z.string(),
  replay: z.number().int().positive().optional(),
});
export type RedriveResult = z.infer<typeof redriveResultSchema>;

export const terminateRequestSchema = z.object({
  reason: z.string().trim().min(3).max(200),
});
export type TerminateRequest = z.infer<typeof terminateRequestSchema>;

export const terminateResultSchema = z.object({ closed: z.boolean() });
export type TerminateResult = z.infer<typeof terminateResultSchema>;
