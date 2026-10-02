import { z } from 'zod';

/**
 * Plan analytics, the financial dashboard and the premium dashboard (WD-PLAN-024..027), super admin only.
 *
 * Money in these reports is converted to the platform's default currency with the platform's exchange rates (WaDesk added amounts
 * in different currencies together and printed one symbol). Every report names the currency it is in.
 */

export const ANALYTICS_DAYS = [30, 90, 365] as const;
/** 30, 90 or 365; anything else is 90 (WD-PLAN-024). */
export const analyticsDaysSchema = z.preprocess(
  (v) => {
    const n = Number(v);
    return (ANALYTICS_DAYS as readonly number[]).includes(n) ? n : 90;
  },
  z.union([z.literal(30), z.literal(90), z.literal(365)]),
);

export const FINANCIAL_WINDOWS = ['7d', '30d', '90d', '1y'] as const;
export type FinancialWindow = (typeof FINANCIAL_WINDOWS)[number];
/** An unknown window is 30 days (WD-PLAN-026 acceptance). */
export const financialWindowSchema = z.preprocess(
  (v) => ((FINANCIAL_WINDOWS as readonly unknown[]).includes(v) ? v : '30d'),
  z.enum(FINANCIAL_WINDOWS),
);

const money = z.string();

export const planAnalyticsQuerySchema = z.object({
  days: analyticsDaysSchema.default(90),
  /** A plan name or slug; only the leaderboard (and the CSV rows) follow it. */
  package: z.string().trim().max(120).optional(),
});
export type PlanAnalyticsQuery = z.input<typeof planAnalyticsQuerySchema>;

export const leaderboardRowSchema = z.object({
  planId: z.string(),
  slug: z.string(),
  name: z.string(),
  price: money,
  currency: z.string(),
  subscribers: z.number().int(),
  mrr: money,
  arpa: money,
  ltv: money,
  netNew: z.number().int(),
  cancellations: z.number().int(),
  churnPct: z.string(),
});
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

export const planAnalyticsSchema = z.object({
  days: z.number().int(),
  currency: z.string(),
  generatedAt: z.string().datetime(),
  kpis: z.object({
    /** Active recurring revenue per month, normalised to one month (not the sum of paid orders, which WaDesk called MRR). */
    mrr: money,
    subscribers: z.number().int(),
    netNew: z.number().int(),
    arpa: money,
    /** ARPA x 28 months, WaDesk's constant. */
    ltv: money,
    churnPct: z.string(),
    cancellations: z.number().int(),
    trialToPaidPct: z.string(),
    trials: z.number().int(),
    windowRevenue: money,
    newPaidOrders: z.number().int(),
  }),
  mrrTrend: z.object({
    labels: z.array(z.string()),
    series: z.array(z.object({ plan: z.string(), values: z.array(z.number()) })),
  }),
  planShare: z.array(z.object({ plan: z.string(), subscribers: z.number().int() })),
  leaderboard: z.array(leaderboardRowSchema),
  upgradePaths: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      kind: z.enum(['upgrade', 'downgrade', 'first_paid']),
      count: z.number().int(),
    }),
  ),
  /** Reasons are not collected on cancellation, so this is empty until they are (WaDesk's list was always empty too). */
  cancellationReasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
  featureAdoption: z.array(
    z.object({ feature: z.string(), workspaces: z.number().int(), pct: z.string() }),
  ),
});
export type PlanAnalytics = z.infer<typeof planAnalyticsSchema>;

const delta = z.object({ value: money, previous: money, changePct: z.string() });

export const financialSchema = z.object({
  window: z.enum(FINANCIAL_WINDOWS),
  from: z.string(),
  to: z.string(),
  currency: z.string(),
  kpis: z.object({ revenue: delta, mrr: money, arr: money, refunds: money, outstanding: money }),
  revenueByDay: z.array(z.object({ date: z.string(), revenue: z.number(), refunds: z.number() })),
  paymentMethods: z.array(z.object({ gateway: z.string(), amount: money })),
  orderStatus: z.array(z.object({ status: z.string(), count: z.number().int() })),
  topWorkspaces: z.array(
    z.object({ slug: z.string(), name: z.string(), orders: z.number().int(), amount: money }),
  ),
  recentOrders: z.array(
    z.object({
      orderNumber: z.string(),
      workspace: z.string(),
      item: z.string(),
      amount: money,
      status: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export type Financial = z.infer<typeof financialSchema>;

export const premiumSchema = z.object({
  window: z.enum(FINANCIAL_WINDOWS),
  currency: z.string(),
  kpis: z.object({
    paidWorkspaces: z.number().int(),
    freeWorkspaces: z.number().int(),
    arpu: money,
    conversion: delta,
  }),
  planDistribution: z.array(z.object({ plan: z.string(), workspaces: z.number().int() })),
  revenueByPlan: z.array(z.object({ plan: z.string(), amount: money })),
  newPaidSignups: z.array(z.object({ date: z.string(), workspaces: z.number().int() })),
  /** Top five by paid orders in the last 90 days, whatever the window (WaDesk rule 7). */
  popularPlans: z.array(z.object({ plan: z.string(), orders: z.number().int() })),
  plans: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      price: money,
      currency: z.string(),
      duration: z.string(),
      workspaces: z.number().int(),
      mrr: money,
      windowRevenue: money,
      isActive: z.boolean(),
    }),
  ),
});
export type Premium = z.infer<typeof premiumSchema>;
