import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { MAX_PAGE_NUMBER } from '../common/pagination';
import { previousSendOptionSchema } from '../broadcasts/previous-sends';
import { sendHoldReasonSchema } from '../compliance/send-window';
import { calendarDaySchema } from '../sales-docs/input-guards';
import { senderBreakdownLineSchema } from './sender-split';
import {
  composeSenderSchema,
  composeTemplateSchema,
  senderHiddenSchema,
} from '../broadcasts/broadcast-compose';
import {
  CAMPAIGN_RECIPIENT_STATUSES,
  CAMPAIGN_TYPES,
  campaignCountsSchema,
  campaignSchema,
  type CampaignType,
} from './campaign';

/** What the campaign screens read: the list with its tiles, the builder's pickers, the detail page and its tabs. */

export const CAMPAIGN_PAGE_SIZE = 12;
export const CAMPAIGN_RANGES = ['all', '7d', '30d', '90d', 'custom'] as const;
/** Reference's sidebar types: `text` stands for text, custom, media and button. */
export const CAMPAIGN_TYPE_FILTERS = ['all', 'text', 'template', 'flow'] as const;
export const CAMPAIGN_STATUS_VIEWS = [
  'all',
  'recently_created',
  'recently_updated',
  'scheduled',
  'running',
  'completed',
  'failed',
  'draft',
  'paused',
  'cancelled',
] as const;

/** The types a `text` filter matches. */
export const TEXT_FILTER_TYPES: readonly CampaignType[] = ['text', 'custom', 'media', 'button'];
export type CampaignTypeFilter = (typeof CAMPAIGN_TYPE_FILTERS)[number];
export type CampaignStatusView = (typeof CAMPAIGN_STATUS_VIEWS)[number];
export type CampaignRange = (typeof CAMPAIGN_RANGES)[number];
export { CAMPAIGN_TYPES };

export const listCampaignsQuerySchema = z.object({
  status: z.enum(CAMPAIGN_STATUS_VIEWS).default('all'),
  type: z.enum(CAMPAIGN_TYPE_FILTERS).default('all'),
  range: z.enum(CAMPAIGN_RANGES).default('all'),
  /** `range=custom` only: the first and the last day of the window (workspace days, both included); a missing side is open. */
  from: calendarDaySchema.optional(),
  to: calendarDaySchema.optional(),
  q: z.string().trim().max(191).default(''),
  page: z.coerce.number().int().min(1).max(MAX_PAGE_NUMBER).prefault(1),
});
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;

export const campaignListResponseSchema = z.object({
  data: z.array(campaignSchema),
  page: z.object({
    page: z.int(),
    perPage: z.int(),
    total: z.int(),
  }),
  /** The tiles above the list: the campaigns created in the chosen date range (all time by default), whatever the status, type or search. */
  stats: z.object({
    total: z.int(),
    queued: z.int(),
    running: z.int(),
    completed: z.int(),
    failed: z.int(),
    sentTotal: z.int(),
    deliveredTotal: z.int(),
    readTotal: z.int(),
    failedTotal: z.int(),
    processing: z.int(),
  }),
  statusCounts: z.object({
    all: z.int(),
    recentlyCreated: z.int(),
    recentlyUpdated: z.int(),
    scheduled: z.int(),
    running: z.int(),
    completed: z.int(),
    failed: z.int(),
  }),
  messageTypes: z.object({
    text: z.int(),
    template: z.int(),
    flow: z.int(),
  }),
  deliveryHealth: z.object({
    avgDeliveryRate: z.number(),
    failingCampaigns: z.int(),
    status: z.enum(['healthy', 'warning']),
  }),
  queueHealth: z.object({
    /** Null when the library is empty: a dash is honest, 100 percent is not. */
    templateApprovalRate: z.int().nullable(),
    templateApproved: z.int(),
    templateTotal: z.int(),
    devicesReady: z.string(),
    retryBacklog: z.int(),
  }),
});
export type CampaignListResponse = z.infer<typeof campaignListResponseSchema>;

export const campaignBuilderSchema = z.object({
  senders: z.array(composeSenderSchema),
  /** The numbers the workspace has that are not in `senders`, by engine and reason (see `senderHiddenSchema`). */
  hidden: z.array(senderHiddenSchema),
  templates: z.array(composeTemplateSchema),
  groups: z.array(z.object({ id: uuidSchema, name: z.string(), members: z.int() })),
  tags: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      color: z.string().nullable(),
      members: z.int(),
    }),
  ),
  flows: z.array(z.object({ id: uuidSchema, name: z.string() })),
  /** Earlier broadcasts and campaigns that went out, newest first (the "Previous sends" source). */
  previousSends: z.array(previousSendOptionSchema).default([]),
  /** True when the default engine is WABA: only Meta-approved templates may be sent. */
  requiresApprovedTemplates: z.boolean(),
});
export type CampaignBuilder = z.infer<typeof campaignBuilderSchema>;

const pct = z.number();

export const campaignDetailSchema = z.object({
  campaign: campaignSchema,
  /** Percentages: delivered of recipients, read of delivered, replies, clicks and failed of recipients. */
  rates: z.object({ delivered: pct, read: pct, replies: pct, clicks: pct, failed: pct }),
  /** The funnel in Reference's order. */
  funnel: z.array(z.object({ key: z.string(), count: z.int() })),
  /** Sends per hour of day (campaign time zone), for the heatmap. */
  hourly: z.array(z.object({ hour: z.int(), sent: z.int(), replies: z.int() })),
  /** Messages per day: sent, delivered, read, replies. */
  daily: z.array(
    z.object({
      date: z.string(),
      sent: z.int(),
      delivered: z.int(),
      read: z.int(),
      replies: z.int(),
    }),
  ),
  /** Recipient rows by status, for the outcome chart. */
  outcomes: z.array(z.object({ status: z.enum(CAMPAIGN_RECIPIENT_STATUSES), count: z.int() })),
  /** Per variant when A/B is on: recipients, sent, delivered, read, replies, clicks. */
  variants: z.array(
    z.object({
      variant: z.string(),
      recipients: z.int(),
      sent: z.int(),
      delivered: z.int(),
      read: z.int(),
      replies: z.int(),
      clicks: z.int(),
    }),
  ),
  /** Per number: recipients, sent, delivered and failed, when the send was shared across several numbers; empty for one number. */
  senders: z.array(senderBreakdownLineSchema).default([]),
  preview: z.object({
    body: z.string(),
    header: z.string().nullable(),
    footer: z.string().nullable(),
    buttons: z.array(z.record(z.string(), z.unknown())),
    templateName: z.string().nullable(),
    category: z.string().nullable(),
    mediaUrl: z.string().nullable(),
  }),
  audience: z.object({
    uploaded: z.int(),
    manual: z.int(),
    invalid: z.int(),
    optOutSkipped: z.int(),
    finalList: z.int(),
    /** What the campaign went to: the biggest groups, "N manual", or "All contacts". */
    label: z.string(),
  }),
  senderLabel: z.string(),
  /** The real failed rows, the number "Resend to failed" works on. */
  failedCount: z.int(),
  deliveryIssueReason: z.string().nullable(),
  optOutCount: z.int(),
  optInCount: z.int(),
  /** Engagement tab: the four cards (percent of sent, opt-outs of recipients) with their counts. */
  engagement: z.object({
    openedPct: pct,
    openedCount: z.int(),
    clickedPct: pct,
    clickedCount: z.int(),
    repliedPct: pct,
    repliedCount: z.int(),
    optOutPct: pct,
    optOutCount: z.int(),
  }),
  /** Top buttons from real tracked clicks. `count` is null for a button that cannot be tracked (a quick reply). */
  buttonRows: z.array(
    z.object({
      label: z.string(),
      count: z.int().nullable(),
      trackable: z.boolean(),
      pct: z.number(),
    }),
  ),
  /** Top five contact groups by read rate. */
  segments: z.array(
    z.object({
      name: z.string(),
      recipients: z.int(),
      replies: z.int(),
      optOuts: z.int(),
      readPct: pct,
    }),
  ),
  /** Who opted out, newest first. */
  optOuts: z.array(
    z.object({ name: z.string(), phone: z.string(), at: z.iso.datetime().nullable() }),
  ),
  failures: z.array(z.object({ id: uuidSchema, error: z.string(), at: z.iso.datetime() })),
  failureSummary: z.array(z.object({ error: z.string(), count: z.int() })),
  replies: z.array(
    z.object({
      contactId: uuidSchema.nullable(),
      name: z.string(),
      phone: z.string(),
      response: z.string(),
      at: z.iso.datetime(),
    }),
  ),
});
export type CampaignDetail = z.infer<typeof campaignDetailSchema>;

export const listRecipientsQuerySchema = z.object({
  status: z.enum(CAMPAIGN_RECIPIENT_STATUSES).optional(),
  q: z.string().trim().max(191).default(''),
  page: z.coerce.number().int().min(1).max(MAX_PAGE_NUMBER).prefault(1),
});
export type ListRecipientsQuery = z.infer<typeof listRecipientsQuerySchema>;
export const RECIPIENT_PAGE_SIZE = 50;

export const campaignRecipientSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema.nullable(),
  name: z.string(),
  phone: z.string(),
  variant: z.string().nullable(),
  status: z.enum(CAMPAIGN_RECIPIENT_STATUSES),
  clicked: z.boolean(),
  clickCount: z.int(),
  sentAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  readAt: z.iso.datetime().nullable(),
  respondedAt: z.iso.datetime().nullable(),
  error: z.string().nullable(),
  /** While the recipient waits for the workspace's quiet hours to end (BL-177): when it may go and why. Null otherwise. */
  heldUntil: z.iso.datetime().nullable().optional(),
  heldReason: sendHoldReasonSchema.nullable().optional(),
});
export type CampaignRecipient = z.infer<typeof campaignRecipientSchema>;

export const campaignRecipientsResponseSchema = z.object({
  data: z.array(campaignRecipientSchema),
  page: z.object({ page: z.int(), perPage: z.int(), total: z.int() }),
});
export type CampaignRecipientsResponse = z.infer<typeof campaignRecipientsResponseSchema>;

/**
 * Live stats: the light read the detail page polls (every 12 seconds while the campaign is in flight, never when it is at rest).
 * `queued` waits to be sent and `processing` is claimed by a run right now, so `queued + processing + sent-or-further + failed + skipped
 * + opted out` is the audience.
 */
export const campaignLiveSchema = z.object({
  status: z.string(),
  /** Scheduled or running: still moving, so the page keeps asking. */
  inFlight: z.boolean(),
  counts: campaignCountsSchema,
  queued: z.int(),
  /** Of `queued`, the recipients held for the quiet hours: they go when the hours open (BL-177). */
  held: z.int().optional(),
  processing: z.int(),
  rates: z.object({ delivered: pct, read: pct, replies: pct, clicks: pct, failed: pct }),
  failures: z.array(z.object({ id: uuidSchema, error: z.string(), at: z.iso.datetime() })),
  failureSummary: z.array(z.object({ error: z.string(), count: z.int() })),
  fetchedAt: z.iso.datetime(),
});
export type CampaignLive = z.infer<typeof campaignLiveSchema>;

/**
 * Statistics: where every recipient is right now, and the campaign's own timeline. `breakdown` counts each recipient once, at the status
 * it holds (so it adds up to `total`); `counts` and `rates` are the cumulative figures of the funnel (a read message is also delivered
 * and sent). Every figure comes from the recipient rows.
 */
export const campaignStatisticsSchema = z.object({
  status: z.string(),
  inFlight: z.boolean(),
  total: z.int(),
  breakdown: z.array(z.object({ key: z.enum(CAMPAIGN_RECIPIENT_STATUSES), count: z.int(), pct })),
  counts: campaignCountsSchema,
  rates: z.object({ delivered: pct, read: pct, replies: pct, clicks: pct, failed: pct }),
  lifecycle: z.object({
    createdAt: z.iso.datetime(),
    /** The date and time the campaign was set to start, read in its own zone; null for a send-now campaign. */
    scheduledFor: z
      .object({ date: z.string(), time: z.string().nullable(), timezone: z.string().nullable() })
      .nullable(),
    firstSentAt: z.iso.datetime().nullable(),
    lastRunAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
  }),
  fetchedAt: z.iso.datetime(),
});
export type CampaignStatistics = z.infer<typeof campaignStatisticsSchema>;
