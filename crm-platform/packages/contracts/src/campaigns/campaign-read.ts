import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { composeSenderSchema, composeTemplateSchema } from '../broadcasts/broadcast-compose';
import {
  CAMPAIGN_RECIPIENT_STATUSES,
  CAMPAIGN_TYPES,
  campaignCountsSchema,
  campaignSchema,
  type CampaignType,
} from './campaign';

/** What the campaign screens read: the list with its tiles, the builder's pickers, the detail page and its tabs. */

export const CAMPAIGN_PAGE_SIZE = 12;
export const CAMPAIGN_RANGES = ['all', '7d', '30d', '90d'] as const;
/** WaDesk's sidebar types: `text` stands for text, custom, media and button. */
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
  q: z.string().trim().max(191).default(''),
  page: z.coerce.number().int().min(1).default(1),
});
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;

export const campaignListResponseSchema = z.object({
  data: z.array(campaignSchema),
  page: z.object({
    page: z.number().int(),
    perPage: z.number().int(),
    total: z.number().int(),
  }),
  /** Workspace-wide, not filtered. */
  stats: z.object({
    total: z.number().int(),
    queued: z.number().int(),
    running: z.number().int(),
    completed: z.number().int(),
    failed: z.number().int(),
    sentTotal: z.number().int(),
    deliveredTotal: z.number().int(),
    readTotal: z.number().int(),
    failedTotal: z.number().int(),
    processing: z.number().int(),
  }),
  statusCounts: z.object({
    all: z.number().int(),
    recentlyCreated: z.number().int(),
    recentlyUpdated: z.number().int(),
    scheduled: z.number().int(),
    running: z.number().int(),
    completed: z.number().int(),
    failed: z.number().int(),
  }),
  messageTypes: z.object({
    text: z.number().int(),
    template: z.number().int(),
    flow: z.number().int(),
  }),
  deliveryHealth: z.object({
    avgDeliveryRate: z.number(),
    failingCampaigns: z.number().int(),
    status: z.enum(['healthy', 'warning']),
  }),
  queueHealth: z.object({
    /** Null when the library is empty: a dash is honest, 100 percent is not. */
    templateApprovalRate: z.number().int().nullable(),
    templateApproved: z.number().int(),
    templateTotal: z.number().int(),
    devicesReady: z.string(),
    retryBacklog: z.number().int(),
  }),
});
export type CampaignListResponse = z.infer<typeof campaignListResponseSchema>;

export const campaignBuilderSchema = z.object({
  senders: z.array(composeSenderSchema),
  templates: z.array(composeTemplateSchema),
  groups: z.array(z.object({ id: uuidSchema, name: z.string(), members: z.number().int() })),
  tags: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      color: z.string().nullable(),
      members: z.number().int(),
    }),
  ),
  flows: z.array(z.object({ id: uuidSchema, name: z.string() })),
  /** True when the default engine is WABA: only Meta-approved templates may be sent. */
  requiresApprovedTemplates: z.boolean(),
});
export type CampaignBuilder = z.infer<typeof campaignBuilderSchema>;

const pct = z.number();

export const campaignDetailSchema = z.object({
  campaign: campaignSchema,
  /** Percentages: delivered of recipients, read of delivered, replies, clicks and failed of recipients. */
  rates: z.object({ delivered: pct, read: pct, replies: pct, clicks: pct, failed: pct }),
  /** The funnel in WaDesk's order. */
  funnel: z.array(z.object({ key: z.string(), count: z.number().int() })),
  /** Sends per hour of day (campaign time zone), for the heatmap. */
  hourly: z.array(
    z.object({ hour: z.number().int(), sent: z.number().int(), replies: z.number().int() }),
  ),
  /** Messages per day: sent, delivered, read, replies. */
  daily: z.array(
    z.object({
      date: z.string(),
      sent: z.number().int(),
      delivered: z.number().int(),
      read: z.number().int(),
      replies: z.number().int(),
    }),
  ),
  /** Recipient rows by status, for the outcome chart. */
  outcomes: z.array(
    z.object({ status: z.enum(CAMPAIGN_RECIPIENT_STATUSES), count: z.number().int() }),
  ),
  /** Per variant when A/B is on: recipients, sent, delivered, read, replies, clicks. */
  variants: z.array(
    z.object({
      variant: z.string(),
      recipients: z.number().int(),
      sent: z.number().int(),
      delivered: z.number().int(),
      read: z.number().int(),
      replies: z.number().int(),
      clicks: z.number().int(),
    }),
  ),
  preview: z.object({
    body: z.string(),
    header: z.string().nullable(),
    footer: z.string().nullable(),
    buttons: z.array(z.record(z.unknown())),
    templateName: z.string().nullable(),
    category: z.string().nullable(),
    mediaUrl: z.string().nullable(),
  }),
  audience: z.object({
    uploaded: z.number().int(),
    manual: z.number().int(),
    invalid: z.number().int(),
    optOutSkipped: z.number().int(),
    finalList: z.number().int(),
    /** What the campaign went to: the biggest groups, "N manual", or "All contacts". */
    label: z.string(),
  }),
  senderLabel: z.string(),
  /** The real failed rows, the number "Resend to failed" works on. */
  failedCount: z.number().int(),
  deliveryIssueReason: z.string().nullable(),
  optOutCount: z.number().int(),
  optInCount: z.number().int(),
  /** Engagement tab: the four cards (percent of sent, opt-outs of recipients) with their counts. */
  engagement: z.object({
    openedPct: pct,
    openedCount: z.number().int(),
    clickedPct: pct,
    clickedCount: z.number().int(),
    repliedPct: pct,
    repliedCount: z.number().int(),
    optOutPct: pct,
    optOutCount: z.number().int(),
  }),
  /** Top buttons from real tracked clicks. `count` is null for a button that cannot be tracked (a quick reply). */
  buttonRows: z.array(
    z.object({
      label: z.string(),
      count: z.number().int().nullable(),
      trackable: z.boolean(),
      pct: z.number(),
    }),
  ),
  /** Top five contact groups by read rate. */
  segments: z.array(
    z.object({
      name: z.string(),
      recipients: z.number().int(),
      replies: z.number().int(),
      optOuts: z.number().int(),
      readPct: pct,
    }),
  ),
  /** Who opted out, newest first. */
  optOuts: z.array(
    z.object({ name: z.string(), phone: z.string(), at: z.string().datetime().nullable() }),
  ),
  failures: z.array(z.object({ id: uuidSchema, error: z.string(), at: z.string().datetime() })),
  failureSummary: z.array(z.object({ error: z.string(), count: z.number().int() })),
  replies: z.array(
    z.object({
      contactId: uuidSchema.nullable(),
      name: z.string(),
      phone: z.string(),
      response: z.string(),
      at: z.string().datetime(),
    }),
  ),
});
export type CampaignDetail = z.infer<typeof campaignDetailSchema>;

export const listRecipientsQuerySchema = z.object({
  status: z.enum(CAMPAIGN_RECIPIENT_STATUSES).optional(),
  q: z.string().trim().max(191).default(''),
  page: z.coerce.number().int().min(1).default(1),
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
  clickCount: z.number().int(),
  sentAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
  readAt: z.string().datetime().nullable(),
  respondedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
});
export type CampaignRecipient = z.infer<typeof campaignRecipientSchema>;

export const campaignRecipientsResponseSchema = z.object({
  data: z.array(campaignRecipientSchema),
  page: z.object({ page: z.number().int(), perPage: z.number().int(), total: z.number().int() }),
});
export type CampaignRecipientsResponse = z.infer<typeof campaignRecipientsResponseSchema>;

/** The numbers the detail page repaints every 15 seconds. */
export const campaignLiveSchema = z.object({
  status: z.string(),
  counts: campaignCountsSchema,
  rates: z.object({ delivered: pct, read: pct, replies: pct, clicks: pct, failed: pct }),
  failures: z.array(z.object({ id: uuidSchema, error: z.string(), at: z.string().datetime() })),
  failureSummary: z.array(z.object({ error: z.string(), count: z.number().int() })),
});
export type CampaignLive = z.infer<typeof campaignLiveSchema>;
