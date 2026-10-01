import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema, pageResponseSchema } from '../common/pagination';
import { broadcastResponseSchema } from './broadcast';

/**
 * The read side of broadcasts (WD-BCAST-001, 002, 030 to 036): the list, the summary tiles, the detail page, its recipients
 * and the live counters. WaDesk rendered these into one HTML page; here each is an endpoint a screen composes.
 */

export const BROADCAST_RANGES = ['all', '7d', '30d', '90d'] as const;

/** WaDesk listed 12 per page; a cursor page of the same size is the default. */
export const listBroadcastsQuerySchema = paginationQuerySchema.omit({ order: true }).extend({
  limit: z.coerce.number().int().min(1).max(100).default(12),
  /** Any status string, compared for equality (scheduled, processing, completed, completed_with_errors, failed, paused). */
  status: z.string().trim().min(1).max(40).optional(),
  range: z.enum(BROADCAST_RANGES).default('all'),
  /** Case-insensitive substring of the name. */
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListBroadcastsQuery = z.infer<typeof listBroadcastsQuerySchema>;

export const broadcastListItemSchema = broadcastResponseSchema.extend({
  templateName: z.string().nullable(),
});
export type BroadcastListItem = z.infer<typeof broadcastListItemSchema>;
export const listBroadcastsResponseSchema = pageResponseSchema(broadcastListItemSchema);
export type ListBroadcastsResponse = z.infer<typeof listBroadcastsResponseSchema>;

/** The six tiles above the list and the counts on the status pills; workspace-wide, they ignore the list filter. */
export const broadcastSummarySchema = z.object({
  stats: z.object({
    /** Number of broadcasts. */
    total: z.number().int(),
    /** Sum of the audience sizes. */
    recipients: z.number().int(),
    sent: z.number().int(),
    delivered: z.number().int(),
    read: z.number().int(),
    failed: z.number().int(),
    clicked: z.number().int(),
    /** Recipients being sent or sent and not yet delivered. */
    processing: z.number().int(),
    /** Recipients waiting to be sent. */
    queued: z.number().int(),
    /** delivered / sent, read / delivered, failed / sent: one decimal, 0 when the base is 0. */
    deliveryPct: z.number(),
    readPct: z.number(),
    failedPct: z.number(),
  }),
  statusCounts: z.record(z.number().int()),
});
export type BroadcastSummary = z.infer<typeof broadcastSummarySchema>;

const pctSchema = z.object({
  sent: z.number(),
  delivered: z.number(),
  read: z.number(),
  failed: z.number(),
});

/** Statuses in which the broadcast is still moving; the screen stops polling when it is not. */
export const IN_FLIGHT_STATUSES = [
  'processing',
  'sending',
  'scheduled',
  'pending',
  'queued',
] as const;

export const broadcastLiveStatsSchema = z.object({
  status: z.string(),
  total: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  failed: z.number().int(),
  queued: z.number().int(),
  pct: pctSchema,
  inFlight: z.boolean(),
  fetchedAt: z.string().datetime(),
});
export type BroadcastLiveStats = z.infer<typeof broadcastLiveStatsSchema>;

export const broadcastDetailSchema = z.object({
  broadcast: broadcastResponseSchema,
  template: z
    .object({
      id: uuidSchema,
      name: z.string(),
      /** meta_category, else category, else utility. */
      category: z.string(),
      type: z.string(),
      language: z.string(),
      header: z.string().nullable(),
      body: z.string(),
      footer: z.string().nullable(),
      buttons: z.unknown(),
    })
    .nullable(),
  sender: z.object({ engine: z.string(), label: z.string(), phone: z.string() }).nullable(),
  /** From the recipient rows: total is the number of rows, sent includes delivered and read, delivered includes read. */
  counts: z.object({
    total: z.number().int(),
    sent: z.number().int(),
    delivered: z.number().int(),
    read: z.number().int(),
    failed: z.number().int(),
    queued: z.number().int(),
  }),
  pct: pctSchema,
  donut: z.object({
    labels: z.array(z.string()),
    series: z.array(z.number().int()),
    /** round((total - failed - queued) / total x 100). */
    successPct: z.number().int(),
  }),
  /** Hourly buckets in the broadcast's own time zone, at most 24, labelled `H:00`. */
  deliveryCurve: z.object({
    labels: z.array(z.string()),
    sent: z.array(z.number().int()),
    delivered: z.array(z.number().int()),
    read: z.array(z.number().int()),
  }),
  /** Top 8 failure reasons by count, the rest summed into `Other`. */
  failureReasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
  events: z.object({
    createdAt: z.string().datetime(),
    scheduledAt: z.string().datetime().nullable(),
    status: z.string(),
    completedAt: z.string().datetime().nullable(),
  }),
});
export type BroadcastDetail = z.infer<typeof broadcastDetailSchema>;

export const listBroadcastRecipientsQuerySchema = paginationQuerySchema
  .omit({ order: true })
  .extend({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    status: z.string().trim().min(1).max(40).optional(),
    /** Name or phone, case-insensitive substring. */
    q: z.string().trim().min(1).max(100).optional(),
  });
export type ListBroadcastRecipientsQuery = z.infer<typeof listBroadcastRecipientsQuerySchema>;

export const broadcastRecipientSchema = z.object({
  /** The contact's uuid. */
  contactId: uuidSchema,
  name: z.string(),
  phone: z.string(),
  status: z.string(),
  error: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  queuedAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
  readAt: z.string().datetime().nullable(),
  clicks: z.number().int(),
  lastClickAt: z.string().datetime().nullable(),
});
export type BroadcastRecipient = z.infer<typeof broadcastRecipientSchema>;
export const listBroadcastRecipientsResponseSchema = pageResponseSchema(broadcastRecipientSchema);
export type ListBroadcastRecipientsResponse = z.infer<typeof listBroadcastRecipientsResponseSchema>;
