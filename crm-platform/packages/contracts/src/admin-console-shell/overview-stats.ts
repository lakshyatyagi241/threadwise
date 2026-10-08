import { z } from 'zod';

/**
 * GET /v2/shell/overview-stats: the live numbers on the More hub (TW-ASHELL-020): the four-figure strip, the one-line footer on
 * each tool card, the plan card and the recent activity. Every figure is the caller's own workspace. A number that could not be
 * read is `null` and the card falls back to its plain caption (Reference wrapped each lookup in a try and showed 0).
 */
const count = z.number().int().nullable();

export const overviewActivitySchema = z.object({
  at: z.string(),
  /** The audited module, such as `contacts` or `deals`. */
  module: z.string(),
  /** What happened, such as `insert`, `update` or `delete`. */
  action: z.string(),
});
export type OverviewActivity = z.infer<typeof overviewActivitySchema>;

export const DEVICE_HEALTH = ['healthy', 'partial', 'offline', 'none'] as const;
export type DeviceHealth = (typeof DEVICE_HEALTH)[number];

/** Reference's rule: all live is healthy, some is partial, none live is offline, no device at all reads "no devices". */
export function deviceHealth(active: number, total: number): DeviceHealth {
  if (total <= 0) return 'none';
  if (active >= total) return 'healthy';
  return active > 0 ? 'partial' : 'offline';
}

export const overviewStatsResponseSchema = z.object({
  /** Live keyword replies + published and active flows + active webhooks. */
  activeRules: count,
  /** How many of those were created in the last 7 days. */
  activeRulesNew: count,
  scheduledQueued: count,
  /** When the next scheduled send runs, or null with nothing upcoming. */
  nextScheduledAt: z.string().nullable(),
  devicesActive: count,
  devicesTotal: count,
  unreadNotifications: count,
  contacts: count,
  groups: count,
  tags: count,
  attributes: count,
  broadcastsQueued: count,
  /** Delivered share of the last 30 days of outgoing messages, 0 to 100; null with no sends. */
  deliveredPct: count,
  autoReplyRules: count,
  /** Share of the last 30 days of auto-reply lookups that matched a rule; null with no lookups. */
  autoReplyMatchPct: count,
  webhookEndpoints: count,
  supportTotal: count,
  supportOpen: count,
  messageHistory: count,
  outbound7d: count,
  activity24h: count,
  seats: count,
  messagesThisMonth: count,
  widgetsBuilt: count,
  widgetsLive: count,
  bookingTypes: count,
  formsDrafted: count,
  formsLive: count,
  assistantsConfigured: count,
  assistantsLive: count,
  agentsConfigured: count,
  agentsLive: count,
  calls24h: count,
  callMinutes24h: count,
  chatLinks: count,
  chatLinkClicks: count,
  aiTokensThisMonth: count,
  flowFailedRuns: count,
  integrationsConnected: count,
  affiliateReferrals: count,
  recentActivity: z.array(overviewActivitySchema),
});
export type OverviewStatsResponse = z.infer<typeof overviewStatsResponseSchema>;

/** Reference's `humanShortNumber`: under 1,000 as is, under 10k one decimal `k`, under 1M rounded `k`, under 10M one decimal `M`. */
export function humanShortNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${trim(n / 1000)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${trim(n / 1_000_000)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}
const trim = (v: number) => v.toFixed(1).replace(/\.0$/, '');

/** Reference's active-rules caption: how many rules arrived this week, or "no new". */
export const weekDelta = (n: number | null): number => (n && n > 0 ? n : 0);
