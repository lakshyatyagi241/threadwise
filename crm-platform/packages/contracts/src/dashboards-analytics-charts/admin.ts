import { z } from 'zod';

/**
 * The operator's platform dashboards (WD-DASH-034..044): the overview at `/admin` and the analytics page. Money is a string in the
 * platform's default currency; every count is an integer.
 */
export const ADMIN_OVERVIEW_WINDOWS = ['24h', '7d', '30d', '90d', '1y'] as const;
export const adminOverviewWindowSchema = z.preprocess(
  (v) => ((ADMIN_OVERVIEW_WINDOWS as readonly unknown[]).includes(v) ? v : '7d'),
  z.enum(ADMIN_OVERVIEW_WINDOWS),
);
export type AdminOverviewWindow = (typeof ADMIN_OVERVIEW_WINDOWS)[number];

const delta = z.object({ value: z.string(), previous: z.string(), changePct: z.string() });

export const adminOverviewSchema = z.object({
  window: z.enum(ADMIN_OVERVIEW_WINDOWS),
  from: z.string(),
  to: z.string(),
  currency: z.string(),
  kpis: z.object({ income: delta, profit: delta, views: delta, conversion: delta }),
  revenue: z.object({
    labels: z.array(z.string()),
    series: z.array(z.number()),
    target: z.array(z.number()),
    total: z.string(),
    totalTarget: z.string(),
  }),
  countries: z.array(
    z.object({ code: z.string(), name: z.string(), count: z.number().int(), pct: z.string() }),
  ),
  regions: z.array(z.object({ region: z.string(), count: z.number().int() })),
  gateways: z.array(z.object({ gateway: z.string(), amount: z.string() })),
  users: z.object({
    total: z.number().int(),
    premium: z.number().int(),
    basic: z.number().int(),
    pct: z.number().int(),
  }),
  workspaces: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      owner: z.string().nullable(),
      plan: z.string(),
      messages: z.number().int(),
      health: z.enum(['good', 'active', 'low', 'idle']),
      mrr: z.string(),
    }),
  ),
  alerts: z.object({
    open: z.number().int(),
    items: z.array(
      z.object({
        severity: z.enum(['high', 'medium', 'low']),
        title: z.string(),
        detail: z.string(),
      }),
    ),
  }),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const adminAnalyticsQuerySchema = z.object({
  days: z.preprocess((v) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 365) : 30;
  }, z.number().int().min(1).max(365)),
});
export type AdminAnalyticsQuery = z.infer<typeof adminAnalyticsQuerySchema>;

export const adminAnalyticsSchema = z.object({
  days: z.number().int(),
  since: z.string(),
  currency: z.string(),
  kpis: z.object({
    revenue: z.string(),
    workspaces: z.number().int(),
    newWorkspaces: z.number().int(),
    users: z.number().int(),
    newUsers: z.number().int(),
    messages: z.number().int(),
    messagesPerDay: z.number().int(),
    devicesOnline: z.number().int(),
    devicesTotal: z.number().int(),
    openTickets: z.number().int(),
  }),
  signups: z.array(z.object({ date: z.string(), count: z.number().int() })),
  planMix: z.array(z.object({ plan: z.string(), count: z.number().int() })),
  topDevices: z.array(z.object({ label: z.string(), sent24h: z.number().int() })),
  deviceSends24h: z.number().int(),
  leaderboard: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      orders: z.number().int(),
      amount: z.string(),
    }),
  ),
  tickets: z.array(z.object({ status: z.string(), count: z.number().int() })),
});
export type AdminAnalytics = z.infer<typeof adminAnalyticsSchema>;
