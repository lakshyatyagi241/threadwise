import { z } from 'zod';

/**
 * dashboards-analytics-charts (DASH): the workspace dashboard and analytics numbers. The domain owns no table; every
 * figure is a live aggregate over the message streams of the caller's workspace (TW-DASH-002).
 */

/** Dashboard window (TW-DASH-003). An unknown value falls back to 7d, as Reference does; `custom` takes inclusive From/To dates. */
export const DASH_RANGES = ['24h', '7d', '30d', 'qtd', 'custom'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const dashRangeSchema = z.enum(DASH_RANGES);
export type DashRange = z.infer<typeof dashRangeSchema>;

export const dashSummaryQuerySchema = z.object({
  range: z
    .string()
    .optional()
    .transform((v): DashRange => {
      const p = dashRangeSchema.safeParse(v);
      return p.success ? p.data : '7d';
    }),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
});
export type DashSummaryQuery = z.infer<typeof dashSummaryQuerySchema>;

/** Counts of one window under the Reference definitions: delivered includes `sent`; read is `read_at` or status read. */
export const dashTotalsSchema = z.object({
  sent: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
  read: z.number().int(),
  /** sent - delivered - failed, never below 0. */
  queued: z.number().int(),
  /** Inbound messages. */
  replies: z.number().int(),
  /** Distinct conversations with an inbound message (the "engaged" funnel stage). */
  repliers: z.number().int(),
  /** Distinct conversations (the contact proxy) with an outbound message in the window. */
  contactsMessaged: z.number().int(),
  /** Distinct conversations with an outbound message in the delivered set (delivered, read, sent). */
  contactsDelivered: z.number().int(),
  /** Distinct conversations with an inbound message; equals `repliers`. May exceed `contactsMessaged` (replied without being messaged in this window). */
  contactsReplied: z.number().int(),
  /** Distinct conversations with at least one flow run that finished (`flow_runs.status = 'completed'`) with `ended_at` in the window. */
  contactsGoalCompleted: z.number().int(),
  /** Percent, one decimal. */
  deliverability: z.number(),
  readRate: z.number(),
  replyRate: z.number(),
});
export type DashTotals = z.infer<typeof dashTotalsSchema>;

export const dashWindowSchema = z.object({
  /** ISO instants; `to` is exclusive. */
  from: z.string(),
  to: z.string(),
  prevFrom: z.string(),
  prevTo: z.string(),
  timezone: z.string(),
});
export type DashWindow = z.infer<typeof dashWindowSchema>;

export const dashFunnelSchema = z.object({
  stages: z.array(
    z.object({
      key: z.enum(['sent', 'delivered', 'replied', 'engaged']),
      count: z.number().int(),
      /** Share of the first stage, percent, one decimal (may pass 100 for replied). */
      pct: z.number(),
      /** Lost against the stage before it (replied is measured from delivered, engaged from replied). */
      drop: z.number().int(),
    }),
  ),
  /** The last stage's share. */
  endToEnd: z.number(),
  /** Contact-based funnel (the Engagement funnel card): contacts messaged, delivered to, replied, and goal completed (a flow finished). Percentages are of `messaged`. */
  contacts: z.object({
    messaged: z.number().int(),
    delivered: z.number().int(),
    replied: z.number().int(),
    /** Contacts whose flow finished in the window (a completed flow run). */
    goalCompleted: z.number().int(),
  }),
  /** Conversation activity under the funnel; `repliesPerContact` is replies / responding contacts, one decimal, null when nobody replied. */
  activity: z.object({
    inbound: z.number().int(),
    respondingContacts: z.number().int(),
    repliesPerContact: z.number().nullable(),
  }),
  /** Contacts replied / contacts messaged, percent, one decimal, capped at 100. */
  replyRate: z.number(),
  /** Reply rate against the previous window; null when that window messaged no contacts. */
  comparison: z.object({ previousReplyRate: z.number(), replyRatePp: z.number() }).nullable(),
});
export type DashFunnel = z.infer<typeof dashFunnelSchema>;

export const dashSummaryResponseSchema = z.object({
  range: dashRangeSchema,
  window: dashWindowSchema,
  current: dashTotalsSchema,
  previous: dashTotalsSchema,
  /** Percent change of sent against the previous window of equal length (+100 when it was 0 and now is not). */
  sentDeltaPct: z.number(),
  /** Percentage points. */
  readRateDeltaPp: z.number(),
  /** 20 hourly outbound counts, oldest first. */
  sparkline: z.array(z.number().int()).length(20),
  funnel: dashFunnelSchema,
});
export type DashSummaryResponse = z.infer<typeof dashSummaryResponseSchema>;

export const dashThroughputResponseSchema = z.object({
  range: dashRangeSchema,
  timezone: z.string(),
  bucket: z.enum(['hour', 'day']),
  /** ISO instant of each bucket's start. */
  starts: z.array(z.string()),
  sent: z.array(z.number().int()),
  delivered: z.array(z.number().int()),
  failed: z.array(z.number().int()),
  /** Busiest of the 24 hourly slots before now. */
  peak: z.object({ start: z.string(), count: z.number().int() }).nullable(),
  avgPerHour: z.number().int(),
});
export type DashThroughputResponse = z.infer<typeof dashThroughputResponseSchema>;

/** Analytics window (TW-DASH-022): 30d is the default and the fallback for anything unknown. */
export const ANALYTICS_RANGES = ['7d', '30d', '90d', 'custom'] as const;
export const analyticsQuerySchema = z.object({
  range: z
    .string()
    .optional()
    .transform((v) =>
      (ANALYTICS_RANGES as readonly string[]).includes(v ?? '')
        ? (v as (typeof ANALYTICS_RANGES)[number])
        : '30d',
    ),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const ANALYTICS_MAX_DAYS = 366;

export const analyticsResponseSchema = z.object({
  range: z.enum(ANALYTICS_RANGES),
  window: dashWindowSchema.extend({
    days: z.number().int(),
    fromDate: z.string(),
    toDate: z.string(),
  }),
  current: dashTotalsSchema,
  previous: dashTotalsSchema,
  /** Percent change per metric (inverted polarity for failed and queued is a display matter). */
  trends: z.object({
    sentPct: z.number(),
    deliveredPct: z.number(),
    failedPct: z.number(),
    queuedPct: z.number(),
    repliesPct: z.number(),
    /** Percentage points. */
    replyRatePp: z.number(),
    /** Contact-based reply rate change (contacts replied / contacts messaged) in percentage points, one decimal. */
    replyRateContactPp: z.number(),
    endToEndPp: z.number(),
  }),
  daily: z.object({
    dates: z.array(z.string()),
    sent: z.array(z.number().int()),
    delivered: z.array(z.number().int()),
    failed: z.array(z.number().int()),
    queued: z.array(z.number().int()),
  }),
  funnel: dashFunnelSchema,
  /** Outbound by type (sent = count, and how many of those were delivered); zero buckets omitted. */
  types: z.array(
    z.object({
      key: z.enum(['text', 'template', 'media', 'interactive', 'location']),
      count: z.number().int(),
      delivered: z.number().int(),
    }),
  ),
  /** 7 rows (Sunday = 0) of 24 hourly message counts, both directions, in the workspace zone. */
  heatmap: z.array(z.array(z.number().int()).length(24)).length(7),
  /** Conversations with activity in the window, by state: the old analytics' "Conversation Status" tiles. */
  conversations: z
    .object({
      total: z.number().int(),
      open: z.number().int(),
      closed: z.number().int(),
      assigned: z.number().int(),
      unassigned: z.number().int(),
    })
    .optional(),
});
export type AnalyticsResponse = z.infer<typeof analyticsResponseSchema>;
export * from './health';
export * from './admin';
export * from './widgets';
export * from './panels';
export * from './quick-access';
