import { z } from 'zod';

/**
 * The operator's platform dashboards (TW-DASH-034..044): the overview at `/admin` and the analytics page. Money is a string in the
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
    z.object({ code: z.string(), name: z.string(), count: z.int(), pct: z.string() }),
  ),
  regions: z.array(z.object({ region: z.string(), count: z.int() })),
  gateways: z.array(z.object({ gateway: z.string(), amount: z.string() })),
  users: z.object({
    total: z.int(),
    premium: z.int(),
    basic: z.int(),
    pct: z.int(),
  }),
  workspaces: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      owner: z.string().nullable(),
      plan: z.string(),
      messages: z.int(),
      health: z.enum(['good', 'active', 'low', 'idle']),
      mrr: z.string(),
    }),
  ),
  alerts: z.object({
    open: z.int(),
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
  }, z.int().min(1).max(365)),
});
export type AdminAnalyticsQuery = z.infer<typeof adminAnalyticsQuerySchema>;

export const adminAnalyticsSchema = z.object({
  days: z.int(),
  since: z.string(),
  currency: z.string(),
  kpis: z.object({
    revenue: z.string(),
    workspaces: z.int(),
    newWorkspaces: z.int(),
    users: z.int(),
    newUsers: z.int(),
    messages: z.int(),
    messagesPerDay: z.int(),
    devicesOnline: z.int(),
    devicesTotal: z.int(),
    openTickets: z.int(),
  }),
  signups: z.array(z.object({ date: z.string(), count: z.int() })),
  planMix: z.array(z.object({ plan: z.string(), count: z.int() })),
  topDevices: z.array(z.object({ label: z.string(), sent24h: z.int() })),
  deviceSends24h: z.int(),
  leaderboard: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      orders: z.int(),
      amount: z.string(),
    }),
  ),
  tickets: z.array(z.object({ status: z.string(), count: z.int() })),
});
export type AdminAnalytics = z.infer<typeof adminAnalyticsSchema>;
