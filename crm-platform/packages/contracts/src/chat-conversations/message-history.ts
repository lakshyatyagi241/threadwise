import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { messageLogEventSchema } from './message-log';

/**
 * chat-conversations: the Message History screen (Reference `/message-history`, TW-CHAT-039 to -042): one feed over every message the
 * workspace sent or received, whatever sent it.
 *
 * Reference merged six tables in PHP (newest 200 rows of each, so its numbers were wrong past 100 rows). Here the feed is one query:
 * the message stream (`messages`, which holds the inbox, flows, auto replies, AI and API sends and every inbound message) plus the
 * recipient tables of broadcasts, campaigns and scheduled messages (a recipient who never had a thread, or whose send failed, has no
 * message row). Counts are real counts, pages are cursors, the window is at most MESSAGE_HISTORY_MAX_DAYS back.
 *
 * Who sees what: a row that belongs to a conversation is visible exactly when the conversation is (the caller's scope for
 * `inbox.conversation.read`); a broadcast, campaign or scheduled recipient row has no conversation, so it is visible only to a caller
 * who reads ALL conversations. Recipient numbers are masked unless the caller may read the contact (`maskRecipient` in the API).
 */

/** The window of the feed reaches at most this many days back (the same year the delivery log is kept). */
export const MESSAGE_HISTORY_MAX_DAYS = 365;
/** Characters of a message the table shows; the full text is in the detail, for a caller who may read the conversation. */
export const MESSAGE_HISTORY_PREVIEW_CHARS = 40;
export const MESSAGE_HISTORY_PAGE_LIMIT = { default: 25, max: 100 } as const;

export const MESSAGE_HISTORY_RANGES = ['24h', '7d', '30d', '90d'] as const;
export const messageHistoryRangeSchema = z.enum(MESSAGE_HISTORY_RANGES);
export type MessageHistoryRange = z.infer<typeof messageHistoryRangeSchema>;
export const MESSAGE_HISTORY_RANGE_DAYS: Record<MessageHistoryRange, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** What sent or received the message. `inbox` is a person in the inbox and every inbound message. */
export const MESSAGE_HISTORY_SOURCES = [
  'inbox',
  'flow',
  'auto_reply',
  'ai',
  'api',
  'broadcast',
  'campaign',
  'scheduled',
  'other',
] as const;
export const messageHistorySourceSchema = z.enum(MESSAGE_HISTORY_SOURCES);
export type MessageHistorySource = z.infer<typeof messageHistorySourceSchema>;

/** The status filter: outbound statuses. A recipient that is pending or processing is `queued`. */
export const MESSAGE_HISTORY_STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed'] as const;
export const messageHistoryStatusSchema = z.enum(MESSAGE_HISTORY_STATUSES);
export type MessageHistoryStatus = z.infer<typeof messageHistoryStatusSchema>;
/** A row's status: the above, or `received` for an inbound message. */
export const messageHistoryRowStatusSchema = z.enum([...MESSAGE_HISTORY_STATUSES, 'received']);
export type MessageHistoryRowStatus = z.infer<typeof messageHistoryRowStatusSchema>;

/** Reference's direction tabs: all, Sent (outgoing), Received (incoming), Failed (outgoing and failed). */
export const MESSAGE_HISTORY_DIRECTIONS = ['all', 'out', 'in', 'fail'] as const;
export const messageHistoryDirectionSchema = z.enum(MESSAGE_HISTORY_DIRECTIONS);
export type MessageHistoryDirection = z.infer<typeof messageHistoryDirectionSchema>;

/** Reference's "Type" filter: the four automated sources, or what the message is made of. */
export const MESSAGE_HISTORY_TYPES = [
  'text',
  'template',
  'auto_reply',
  'campaign',
  'broadcast',
  'scheduled',
  'image',
  'video',
  'audio',
  'document',
  'location',
] as const;
export const messageHistoryTypeSchema = z.enum(MESSAGE_HISTORY_TYPES);
export type MessageHistoryType = z.infer<typeof messageHistoryTypeSchema>;

/** Where a row came from: a message row, or the recipient row of a broadcast, a campaign or a scheduled message. */
export const MESSAGE_HISTORY_ENTITY_KINDS = [
  'message',
  'broadcast',
  'campaign',
  'scheduled',
] as const;
export const messageHistoryEntityKindSchema = z.enum(MESSAGE_HISTORY_ENTITY_KINDS);
export type MessageHistoryEntityKind = z.infer<typeof messageHistoryEntityKindSchema>;

/** `m:<uuid>`, `b:<uuid>`, `c:<uuid>`, `s:<uuid>`: the entity kind and the uuid of the message or recipient row. */
export const messageHistoryIdSchema = z
  .string()
  .regex(
    /^[mbcs]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'Not a history id',
  );

const dayStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date as YYYY-MM-DD');

const csv = <T extends z.ZodTypeAny>(item: T) =>
  z
    .union([z.array(item), z.string()])
    .transform((v) => (Array.isArray(v) ? v : v.split(',').filter((s) => s !== '')))
    .pipe(z.array(item).max(12));

/**
 * The filters, in the URL of the screen and in the body of an export. A preset `range` or a `from`/`to` pair of UTC days (the pair
 * wins). `source` is a comma list.
 */
export const messageHistoryFiltersSchema = z
  .object({
    range: messageHistoryRangeSchema.optional(),
    from: dayStringSchema.optional(),
    to: dayStringSchema.optional(),
    dir: messageHistoryDirectionSchema.optional(),
    type: messageHistoryTypeSchema.optional(),
    source: csv(messageHistorySourceSchema).optional(),
    status: messageHistoryStatusSchema.optional(),
    channelId: uuidSchema.optional(),
    templateId: uuidSchema.optional(),
    campaignId: uuidSchema.optional(),
    broadcastId: uuidSchema.optional(),
    scheduledId: uuidSchema.optional(),
    /** A contact name, part of a phone number (digits), part of the text, or a message id. */
    q: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export type MessageHistoryFilters = z.infer<typeof messageHistoryFiltersSchema>;

export const listMessageHistoryQuerySchema = messageHistoryFiltersSchema.extend({
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MESSAGE_HISTORY_PAGE_LIMIT.max)
    .default(MESSAGE_HISTORY_PAGE_LIMIT.default),
});
export type ListMessageHistoryQuery = z.infer<typeof listMessageHistoryQuerySchema>;

/** The summary and the insights read the same window and the same scoping filters; the narrowing ones (dir, type, source, status, q) are ignored. */
export const messageHistorySummaryQuerySchema = messageHistoryFiltersSchema.extend({
  /** IANA zone for the buckets of the volume chart (insights only). */
  tz: z.string().min(1).max(64).optional(),
  bucket: z.enum(['hourly', 'daily', 'weekly']).default('daily'),
});
export type MessageHistorySummaryQuery = z.infer<typeof messageHistorySummaryQuerySchema>;

// --- rows --------------------------------------------------------------------------------------------------------------------

export const messageHistoryRowSchema = z.object({
  id: messageHistoryIdSchema,
  entityKind: messageHistoryEntityKindSchema,
  source: messageHistorySourceSchema,
  direction: z.enum(['in', 'out']),
  status: messageHistoryRowStatusSchema,
  /** The type pill: an automated source, or what the message is made of (Reference's `classifyType`). */
  type: messageHistoryTypeSchema,
  at: z.string().datetime(),
  contact: z.object({ id: uuidSchema.nullable(), name: z.string().nullable() }),
  /** The number (or channel id) of the other side. Masked ("•••••••8988") unless the caller may read the contact. */
  recipient: z.object({ value: z.string().nullable(), masked: z.boolean() }),
  channel: z.object({ id: uuidSchema, kind: z.string(), name: z.string() }).nullable(),
  /** First MESSAGE_HISTORY_PREVIEW_CHARS characters; null for a recipient row with no text of its own. Customer-written text. */
  preview: z.string().nullable(),
  mediaName: z.string().nullable(),
  template: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  failure: z.object({ code: z.string().nullable(), reason: z.string().nullable() }).nullable(),
  /** What it cost, for a caller who may read the wallet statement; null for everyone else and for a message that was not charged. */
  cost: z
    .object({
      minor: z.number().int().nonnegative(),
      currency: z.string().nullable(),
      status: z.string(),
    })
    .nullable(),
  /** The broadcast, campaign or scheduled message a recipient row belongs to. */
  entity: z
    .object({
      kind: z.enum(['broadcast', 'campaign', 'scheduled']),
      id: uuidSchema,
      name: z.string(),
    })
    .nullable(),
  /** The conversation to open (null for a recipient row that has none). */
  conversationId: uuidSchema.nullable(),
});
export type MessageHistoryRow = z.infer<typeof messageHistoryRowSchema>;

export const messageHistoryPageSchema = z.object({
  data: z.array(messageHistoryRowSchema),
  page: pageInfoSchema,
  window: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
});
export type MessageHistoryPage = z.infer<typeof messageHistoryPageSchema>;

// --- the detail --------------------------------------------------------------------------------------------------------------

export const messageHistoryDetailSchema = messageHistoryRowSchema.extend({
  /** The whole text, for a caller who may read the conversation (every message row they can open); null for a recipient row. */
  body: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  sender: z.object({ kind: z.string(), name: z.string().nullable() }).nullable(),
  /** The `Language` row of Reference's metadata (auto replies). */
  language: z.string().nullable(),
  /** Oldest first. A message: its delivery log (live and archived days). A recipient row: the moments the row recorded. */
  timeline: z.array(messageLogEventSchema),
  fromArchive: z.boolean(),
  /** The message is older than the delivery log is kept: its status is known, its steps are gone. */
  logExpired: z.boolean(),
});
export type MessageHistoryDetail = z.infer<typeof messageHistoryDetailSchema>;

// --- summary and insights ----------------------------------------------------------------------------------------------------

export const messageHistorySummarySchema = z.object({
  window: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
  total: z.number().int().nonnegative(),
  /** Outbound and not failed (Reference's "Sent": includes messages still queued). */
  sent: z.number().int().nonnegative(),
  received: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  /** Outbound that reached `delivered` or `read`. */
  delivered: z.number().int().nonnegative(),
  read: z.number().int().nonnegative(),
  sentPct: z.number(),
  receivedPct: z.number(),
  /** failed / sent x 100, one decimal, 0 when nothing was sent (Reference's definition; it can pass 100). */
  failPct: z.number(),
  /** delivered / (outbound that is not queued) x 100, one decimal; null when nothing left the queue. */
  deliveryRate: z.number().nullable(),
  /** Change of `total` against the equal period just before the window, in percent (100 when it was 0 and now is not). */
  deltaPct: z.number().int(),
  /** Average seconds from a customer's first message to the first reply, over conversations that had both; null when none. */
  avgFirstResponseSeconds: z.number().int().nullable(),
  dirCounts: z.object({
    all: z.number().int().nonnegative(),
    out: z.number().int().nonnegative(),
    in: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
  }),
  /** Charged amounts by currency, for a caller who may read the wallet statement; null for everyone else. */
  cost: z
    .array(
      z.object({
        currency: z.string().nullable(),
        minor: z.number().int().nonnegative(),
        messages: z.number().int().nonnegative(),
      }),
    )
    .nullable(),
});
export type MessageHistorySummary = z.infer<typeof messageHistorySummarySchema>;

export const messageHistoryInsightsSchema = z.object({
  bucket: z.enum(['hourly', 'daily', 'weekly']),
  tz: z.string(),
  /** One point per bucket, oldest first, empty buckets included. `at` is the start of the bucket. */
  volume: z.array(
    z.object({
      at: z.string().datetime(),
      sent: z.number().int().nonnegative(),
      received: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
  ),
  /** Reference's "By message type" buckets. */
  typeMix: z.object({
    text: z.number().int().nonnegative(),
    autoReply: z.number().int().nonnegative(),
    campaign: z.number().int().nonnegative(),
    broadcast: z.number().int().nonnegative(),
    scheduled: z.number().int().nonnegative(),
    media: z.number().int().nonnegative(),
  }),
  /** The four most active conversations of the window (rows the caller may see). */
  topConversations: z.array(
    z.object({
      conversationId: uuidSchema,
      name: z.string(),
      messages: z.number().int().nonnegative(),
      lastAt: z.string().datetime(),
    }),
  ),
});
export type MessageHistoryInsights = z.infer<typeof messageHistoryInsightsSchema>;

/** The body of an export of the history: the filters of the screen (the window is resolved on the day of the request). */
export const createMessageHistoryExportSchema = messageHistoryFiltersSchema;
export type CreateMessageHistoryExportInput = z.infer<typeof createMessageHistoryExportSchema>;
