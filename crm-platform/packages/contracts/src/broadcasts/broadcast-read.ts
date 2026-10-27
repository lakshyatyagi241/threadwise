import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema, pageResponseSchema } from '../common/pagination';
import { queryBoolean } from '../contacts-attributes-tags/query-helpers';
import { sendHoldReasonSchema } from '../compliance/send-window';
import { broadcastResponseSchema } from './broadcast';

/**
 * The read side of broadcasts (TW-BCAST-001, 002, 030 to 036): the list, the summary tiles, the detail page, its recipients
 * and the live counters. Reference rendered these into one HTML page; here each is an endpoint a screen composes.
 */

export const BROADCAST_RANGES = ['all', '7d', '30d', '90d'] as const;

/** Reference listed 12 per page; a cursor page of the same size is the default. */
export const listBroadcastsQuerySchema = paginationQuerySchema.omit({ order: true }).extend({
  limit: z.coerce.number().int().min(1).max(100).prefault(12),
  /** Any status string, compared for equality (scheduled, processing, completed, completed_with_errors, failed, paused). */
  status: z.string().trim().min(1).max(40).optional(),
  range: z.enum(BROADCAST_RANGES).default('all'),
  /** Case-insensitive substring of the name. */
  q: z.string().trim().min(1).max(100).optional(),
  /** Adds `meta.total`, the count of every broadcast matching the filter ("Showing 12 of N"). */
  includeTotal: queryBoolean().default(false),
});
export type ListBroadcastsQuery = z.infer<typeof listBroadcastsQuerySchema>;

export const broadcastListItemSchema = broadcastResponseSchema.extend({
  templateName: z.string().nullable(),
});
export type BroadcastListItem = z.infer<typeof broadcastListItemSchema>;
export const listBroadcastsResponseSchema = pageResponseSchema(broadcastListItemSchema).extend({
  meta: z.object({ total: z.int() }).optional(),
});
export type ListBroadcastsResponse = z.infer<typeof listBroadcastsResponseSchema>;

/** The six tiles above the list and the counts on the status pills; workspace-wide, they ignore the list filter. */
export const broadcastSummarySchema = z.object({
  stats: z.object({
    /** Number of broadcasts. */
    total: z.int(),
    /** Sum of the audience sizes. */
    recipients: z.int(),
    sent: z.int(),
    delivered: z.int(),
    read: z.int(),
    failed: z.int(),
    clicked: z.int(),
    /** Recipients being sent or sent and not yet delivered. */
    processing: z.int(),
    /** Recipients waiting to be sent. */
    queued: z.int(),
    /** delivered / sent, read / delivered, failed / sent: one decimal, 0 when the base is 0. */
    deliveryPct: z.number(),
    readPct: z.number(),
    failedPct: z.number(),
  }),
  statusCounts: z.record(z.string(), z.int()),
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
  total: z.int(),
  sent: z.int(),
  delivered: z.int(),
  read: z.int(),
  failed: z.int(),
  queued: z.int(),
  /** Of `queued`, the recipients waiting for the end of the workspace's quiet hours (BL-177). */
  held: z.int().optional(),
  pct: pctSchema,
  inFlight: z.boolean(),
  fetchedAt: z.iso.datetime(),
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
    total: z.int(),
    sent: z.int(),
    delivered: z.int(),
    read: z.int(),
    failed: z.int(),
    queued: z.int(),
    /** Of `queued`, the recipients held for the quiet hours: not failed, not lost, they go when the hours open (BL-177). */
    held: z.int().optional(),
    /** Contacts who tapped a tracked link (TW-BCAST-042). */
    clicked: z.int(),
  }),
  /** `clicked` is the click-through rate: contacts who clicked over delivered. */
  pct: pctSchema.extend({ clicked: z.number() }),
  donut: z.object({
    labels: z.array(z.string()),
    series: z.array(z.int()),
    /** round((total - failed - queued) / total x 100). */
    successPct: z.int(),
  }),
  /** Hourly buckets in the broadcast's own time zone, at most 24, labelled `H:00`. */
  deliveryCurve: z.object({
    labels: z.array(z.string()),
    sent: z.array(z.int()),
    delivered: z.array(z.int()),
    read: z.array(z.int()),
  }),
  /** Top 8 failure reasons by count, the rest summed into `Other`. */
  failureReasons: z.array(z.object({ reason: z.string(), count: z.int() })),
  /** Why a paused broadcast stopped, and when it can resume by itself (a daily cap, the quiet hours); null when it is not paused. */
  pause: z
    .object({
      reason: z.enum(['daily_cap', 'halt', 'quiet_hours', 'manual']),
      at: z.iso.datetime(),
      resumeAfter: z.iso.datetime().nullable(),
    })
    .nullable(),
  events: z.object({
    createdAt: z.iso.datetime(),
    scheduledAt: z.iso.datetime().nullable(),
    status: z.string(),
    completedAt: z.iso.datetime().nullable(),
  }),
});
export type BroadcastDetail = z.infer<typeof broadcastDetailSchema>;

export const listBroadcastRecipientsQuerySchema = paginationQuerySchema
  .omit({ order: true })
  .extend({
    limit: z.coerce.number().int().min(1).max(200).prefault(50),
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
  queuedAt: z.iso.datetime(),
  /** While the recipient waits for the quiet hours to end (BL-177): when it may go and why. Null otherwise. */
  heldUntil: z.iso.datetime().nullable().optional(),
  heldReason: sendHoldReasonSchema.nullable().optional(),
  sentAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  readAt: z.iso.datetime().nullable(),
  clicks: z.int(),
  lastClickAt: z.iso.datetime().nullable(),
});
export type BroadcastRecipient = z.infer<typeof broadcastRecipientSchema>;
export const listBroadcastRecipientsResponseSchema = pageResponseSchema(broadcastRecipientSchema);
export type ListBroadcastRecipientsResponse = z.infer<typeof listBroadcastRecipientsResponseSchema>;

/** Statuses a broadcast can be deleted in: it has not started, or it failed. Anything else keeps its history. */
export const DELETABLE_STATUSES = ['scheduled', 'failed'] as const;

export const retryBroadcastResponseSchema = z.object({
  /** Recipients put back to `pending`. */
  retried: z.int(),
  status: z.string(),
});
export type RetryBroadcastResponse = z.infer<typeof retryBroadcastResponseSchema>;

export const resumeBroadcastResponseSchema = z.object({
  status: z.string(),
});
export type ResumeBroadcastResponse = z.infer<typeof resumeBroadcastResponseSchema>;
