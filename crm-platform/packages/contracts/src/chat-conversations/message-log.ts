import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { messageKindSchema, messageStatusSchema } from './enums';

/**
 * chat-conversations: the delivery log of one outbound message, and the export of the log to a file.
 *
 * Every state change of a message (queued, each send attempt, the provider accepting it, each receipt, a failure, an agent's Retry) is a
 * row in `message_events`. Rows stay in the live table for MESSAGE_LOG_HOT_DAYS, then a daily sweep moves them, compressed, to the
 * archive (one object per workspace and day), which keeps them until MESSAGE_LOG_RETENTION_DAYS after the event. The log of one message
 * reads both places; an export (CSV, by email) can reach back the whole retention.
 */

/** Days a message's events stay in the live table before they are archived. */
export const MESSAGE_LOG_HOT_DAYS = 90;
/** Days after the event that it can still be read or exported (live + archive). The archive is purged after this. */
export const MESSAGE_LOG_RETENTION_DAYS = 365;
/** Days a finished export file can be downloaded; the link in the email leads to the page that offers it. */
export const MESSAGE_LOG_EXPORT_TTL_DAYS = 7;
/** A single export is stopped past this many rows: narrow the dates or the status. */
export const MESSAGE_LOG_EXPORT_MAX_ROWS = 2_000_000;

export const messageLogEventNameSchema = z.enum([
  'queued',
  'attempt',
  'retry',
  'sent',
  'delivered',
  'read',
  'failed',
]);
export type MessageLogEventName = z.infer<typeof messageLogEventNameSchema>;

/** One line of a message's log. Everything the provider or the pipeline recorded, named; the raw `detail` is kept for support. */
export const messageLogEventSchema = z.object({
  event: messageLogEventNameSchema,
  at: z.string().datetime(),
  /** Who wrote the line: our pipeline (queued, an attempt, the provider accepting, a retry) or the provider's own receipt (sent, delivered, read, failed). */
  source: z.enum(['system', 'provider']),
  /** The provider's id of the message, on the events that carry one (`sent`, and receipts). */
  providerMessageId: z.string().nullable(),
  /** Our stable error code on a `failed` event (e.g. ECOSYSTEM_ENGAGEMENT_BLOCKED, SERVICE_WINDOW_CLOSED). */
  errorCode: z.string().nullable(),
  /** The provider's or the pipeline's sentence, with the provider's own code in it (`#131049`). */
  errorMessage: z.string().nullable(),
  /** Which send attempt an `attempt` event is. */
  attempt: z.number().int().positive().nullable(),
  /** The agent who pressed Retry, on a `retry` event. Null for the system. */
  byUserId: uuidSchema.nullable(),
  /** False when the receipt did not move the message (it arrived late, or for an earlier send): shown greyed, never hidden. */
  applied: z.boolean().nullable(),
  /** True when a send was answered from the stored result of an earlier one: nothing new went to the provider. */
  replayed: z.boolean().nullable(),
  /** The event's raw detail as recorded. */
  detail: z.record(z.string(), z.unknown()),
});
export type MessageLogEvent = z.infer<typeof messageLogEventSchema>;

export const messageLogResponseSchema = z.object({
  messageId: uuidSchema,
  kind: messageKindSchema,
  /** The message's status now. */
  status: messageStatusSchema,
  providerMessageId: z.string().nullable(),
  failureCode: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  /** Oldest first. */
  events: z.array(messageLogEventSchema),
  /** True when part of the log came from the archive (events older than MESSAGE_LOG_HOT_DAYS). */
  fromArchive: z.boolean(),
  /** True when the message is older than the retention: its events are gone. */
  expired: z.boolean(),
});
export type MessageLogResponse = z.infer<typeof messageLogResponseSchema>;

// --- export -------------------------------------------------------------------------------------------------------------

export const messageLogExportStatusSchema = z.enum([
  'queued',
  'running',
  'ready',
  'failed',
  'expired',
]);
export type MessageLogExportStatus = z.infer<typeof messageLogExportStatusSchema>;

const dayStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date as YYYY-MM-DD');

/** What to export. Days are UTC. The range reaches back at most MESSAGE_LOG_RETENTION_DAYS and never into the future. */
export const createMessageLogExportSchema = z
  .object({
    from: dayStringSchema,
    to: dayStringSchema,
    /** Only the events of messages that ended in this status ("all failed messages"); omitted = every event. */
    messageStatus: messageStatusSchema.optional(),
  })
  .strict();
export type CreateMessageLogExportInput = z.infer<typeof createMessageLogExportSchema>;

/** `events`: the delivery log (one line per event). `messages`: the Message History feed (one line per message), with the screen's filters. */
export const messageLogExportKindSchema = z.enum(['events', 'messages']);
export type MessageLogExportKind = z.infer<typeof messageLogExportKindSchema>;

export const messageLogExportSchema = z.object({
  id: uuidSchema,
  kind: messageLogExportKindSchema,
  status: messageLogExportStatusSchema,
  from: dayStringSchema,
  to: dayStringSchema,
  messageStatus: messageStatusSchema.nullable(),
  /** Rows in the file, once it is ready. */
  rowCount: z.number().int().nonnegative().nullable(),
  fileBytes: z.number().int().nonnegative().nullable(),
  /** A sentence for a failed export. */
  error: z.string().nullable(),
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  /** After this the file is deleted and the export is `expired`. */
  expiresAt: z.string().datetime().nullable(),
  /** The address the file was announced to. */
  emailedTo: z.string().nullable(),
});
export type MessageLogExport = z.infer<typeof messageLogExportSchema>;

/** `GET .../exports`: which exports to list. Omitted: the delivery log exports (`events`), which the Message logs page shows. */
export const listMessageLogExportsQuerySchema = z.object({
  kind: messageLogExportKindSchema.default('events'),
});
export type ListMessageLogExportsQuery = z.infer<typeof listMessageLogExportsQuerySchema>;

export const messageLogExportListSchema = z.object({
  data: z.array(messageLogExportSchema),
});
export type MessageLogExportList = z.infer<typeof messageLogExportListSchema>;
