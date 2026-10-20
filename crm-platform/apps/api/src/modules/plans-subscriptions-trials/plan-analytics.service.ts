import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  moneyCents,
  type Financial,
  type FinancialWindow,
  type LeaderboardRow,
  type PlanAnalytics,
  type Premium,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { PlatformSettingsService } from '../auth';
import { PlanStore } from './plan-store';

const DAY = 86_400_000;
/** Reference's hard-coded lifetime-value multiplier (months). Kept so the number means the same thing. */
export const LTV_MONTHS = 28;

export const money = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);
const pct = (num: number, den: number): string => (den > 0 ? money((num / den) * 100) : '0.00');
/** (now - prev) / prev x 100 to two decimals; 100 when prev is 0 and now is above 0 (TW-PLAN-026 rule 1). */
export const changePct = (now: number, prev: number): string =>
  prev === 0 ? (now > 0 ? '100.00' : '0.00') : money(((now - prev) / prev) * 100);

/** Converts amounts to the platform's default currency with the platform's rates (units of a currency per one base unit). */
export class Fx {
  constructor(
    readonly base: string,
    private readonly rates: ReadonlyMap<string, number>,
  ) {}
  /** An unknown currency is taken at par rather than dropped: a report must not silently lose money. */
  toBase(amount: number | string, currency: string): number {
    const a = Number(amount);
    const from = this.rates.get(currency.toUpperCase());
    const to = this.rates.get(this.base);
    return from && to ? (a / from) * to : a;
  }
}

/** A plan's price per month: offer-aware, a year is 12 months, a week 52/12, a day 30 (TW-PLAN-024 port note). */
export function monthlyPrice(p: {
  amount: string;
  offer_amount: string | null;
  billing_unit: string;
  billing_duration: number;
}): number {
  const offer =
    p.offer_amount !== null &&
    moneyCents(p.offer_amount) > 0 &&
    moneyCents(p.offer_amount) < moneyCents(p.amount);
  const price = moneyCents(offer ? p.offer_amount! : p.amount) / 100;
  const n = Math.max(1, Number(p.billing_duration));
  switch (p.billing_unit) {
    case 'years':
      return price / (12 * n);
    case 'weeks':
      return (price * 52) / 12 / n;
    case 'days':
      return (price * 30) / n;
    default:
      return price / n;
  }
}

interface PlanRow {
  slug: string;
  name: string;
  amount: string;
  offer_amount: string | null;
  currency: string;
  billing_unit: string;
  billing_duration: number;
  is_free: boolean;
  is_lifetime: boolean;
  is_custom_quote: boolean;
  is_active: boolean;
  sort_order: number;
}

const FEATURE_TABLES: ReadonlyArray<[string, string]> = [
  ['messages', 'messages'],
  ['broadcasts', 'broadcasts'],
  ['templates', 'wa_templates'],
  ['flows', 'flows'],
  ['shopify', 'shopify_integrations'],
  ['hubspot', 'hubspot_integrations'],
  ['appointments', 'appointments'],
  ['deals', 'deals'],
];

/**
 * The super admin's revenue reports (TW-PLAN-024, 026, 027) from one set of numbers, so the screens and the CSV cannot disagree.
 *
 * Deliberate differences from Reference, because its own notes call the originals proxies or bugs:
 *   - MRR is the monthly price of every ACTIVE paid workspace (Reference: the sum of paid orders in the window, and in the dashboards a join that
 *     missed every workspace whose plan was stored as a slug)
 *   - churn and cancellations are real: subscriptions cancelled in the window, and paid plans that ran out in it without being renewed
 *   - upgrade or downgrade is judged by price, not by creation order
 *   - money is converted to the default currency
 */
@Injectable()
export class PlanAnalyticsService {
  constructor(
    private readonly store: PlanStore,
    private readonly settings: PlatformSettingsService,
  ) {}

  // --- shared -------------------------------------------------------------------------------------------------------------------

  private async fx(tx: Tx): Promise<Fx> {
    const setting = await this.settings.get<unknown>('default_currency');
    const base = typeof setting === 'string' && /^[A-Z]{3}$/.test(setting) ? setting : 'USD';
    const res = await tx.execute(
      sql`SELECT code, exchange_rate::text AS rate FROM currencies WHERE is_active`,
    );
    const rates = new Map(
      (res.rows as Array<{ code: string; rate: string }>).map(
        (r) => [r.code.toUpperCase(), Number(r.rate)] as const,
      ),
    );
    return new Fx(base, rates);
  }

  private async plans(tx: Tx): Promise<PlanRow[]> {
    const res = await tx.execute(sql`
      SELECT slug, name, amount::text AS amount, offer_amount::text AS offer_amount, currency, billing_unit, billing_duration,
             is_free, is_lifetime, is_custom_quote, is_active, sort_order
      FROM plans WHERE kind = 'plan' ORDER BY sort_order, plans.amount, slug`);
    return res.rows as unknown as PlanRow[];
  }

  /** Active paid workspaces per plan slug: a paid plan, not lifetime or custom, not run out, not owned by the platform. */
  private async activeByPlan(tx: Tx): Promise<Map<string, number>> {
    const res = await tx.execute(sql`
      SELECT o.plan, count(*)::int AS n
      FROM organizations o JOIN org_plan_state s ON s.org_id = o.id JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
      WHERE NOT p.is_free AND p.amount > 0 AND NOT p.is_custom_quote AND NOT p.is_lifetime
        AND NOT s.platform_owned AND (s.plan_ends_at IS NULL OR s.plan_ends_at > now())
      GROUP BY o.plan`);
    return new Map((res.rows as Array<{ plan: string; n: number }>).map((r) => [r.plan, r.n]));
  }

  private mrrOf(
    plans: PlanRow[],
    active: Map<string, number>,
    fx: Fx,
  ): { total: number; byPlan: Map<string, number> } {
    const byPlan = new Map<string, number>();
    let total = 0;
    for (const p of plans) {
      const n = active.get(p.slug) ?? 0;
      if (n === 0) continue;
      const v = fx.toBase(monthlyPrice(p) * n, p.currency);
      byPlan.set(p.slug, v);
      total += v;
    }
    return { total, byPlan };
  }

  /** Paid order sums grouped by plan and currency in [from, to). `kinds` limits what counts as a plan sale. */
  private async paidByPlan(
    tx: Tx,
    from: Date,
    to: Date,
  ): Promise<
    Array<{ plan: string; currency: string; amount: string; orders: number; orgs: number }>
  > {
    const res = await tx.execute(sql`
      SELECT plan_slug AS plan, currency, sum(coalesce(total_amount, amount))::text AS amount, count(*)::int AS orders,
             count(DISTINCT org_id)::int AS orgs
      FROM orders
      WHERE status = 'paid' AND kind IN ('plan', 'addon') AND plan_slug IS NOT NULL
        AND paid_at >= ${from.toISOString()}::timestamptz AND paid_at < ${to.toISOString()}::timestamptz
      GROUP BY plan_slug, currency`);
    return res.rows as unknown as Array<{
      plan: string;
      currency: string;
      amount: string;
      orders: number;
      orgs: number;
    }>;
  }

  // --- plan analytics (024) --------------------------------------------------------------------------------------------------

  async overview(
    days: 30 | 90 | 365,
    packageFilter?: string,
    now = new Date(),
  ): Promise<PlanAnalytics> {
    return this.store.tx(async (tx) => {
      const fx = await this.fx(tx);
      const from = new Date(now.getTime() - days * DAY);
      const plans = await this.plans(tx);
      const active = await this.activeByPlan(tx);
      const { total: mrr, byPlan: mrrByPlan } = this.mrrOf(plans, active, fx);
      const subscribers = [...active.values()].reduce((a, b) => a + b, 0);
      const arpa = subscribers > 0 ? mrr / subscribers : 0;

      const paid = await this.paidByPlan(tx, from, new Date(now.getTime() + 1));
      const windowRevenue = paid.reduce((a, r) => a + fx.toBase(r.amount, r.currency), 0);
      const newPaidOrders = paid.reduce((a, r) => a + r.orders, 0);
      const orgsPaying = (
        await tx.execute(sql`
          SELECT count(DISTINCT org_id)::int AS n FROM orders
          WHERE status = 'paid' AND kind IN ('plan', 'addon') AND paid_at >= ${from.toISOString()}::timestamptz`)
      ).rows[0] as { n: number };

      // Cancellations: subscriptions cancelled in the window, per plan (the plan the workspace was on when it cancelled).
      const canc = await tx.execute(sql`
        SELECT coalesce(plan_id, '') AS plan, count(*)::int AS n FROM subscriptions
        WHERE status = 'canceled' AND canceled_at >= ${from.toISOString()}::timestamptz GROUP BY plan_id`);
      const cancByPlan = new Map(
        (canc.rows as Array<{ plan: string; n: number }>).map((r) => [r.plan, r.n]),
      );
      // Lapses: paid plans whose period ended inside the window and were not renewed (still on that plan, still past the end).
      const lapsed = await tx.execute(sql`
        SELECT o.plan, count(*)::int AS n
        FROM organizations o JOIN org_plan_state s ON s.org_id = o.id JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
        WHERE NOT p.is_free AND p.amount > 0 AND s.plan_ends_at >= ${from.toISOString()}::timestamptz AND s.plan_ends_at < now()
        GROUP BY o.plan`);
      const lapseByPlan = new Map(
        (lapsed.rows as Array<{ plan: string; n: number }>).map((r) => [r.plan, r.n]),
      );
      const cancellations = [...cancByPlan.values(), ...lapseByPlan.values()].reduce(
        (a, b) => a + b,
        0,
      );
      const churnBase = subscribers + cancellations;

      const trials = (
        await tx.execute(sql`
          SELECT count(*)::int AS n FROM org_plan_state s JOIN organizations o ON o.id = s.org_id JOIN plans p ON p.slug = o.plan
          WHERE s.trial_ends_at IS NOT NULL AND (p.is_free OR p.amount = 0)`)
      ).rows[0] as { n: number };

      const filter = packageFilter?.trim().toLowerCase();
      const rows: LeaderboardRow[] = plans
        .filter((p) => !filter || p.name.toLowerCase() === filter || p.slug === filter)
        .map((p) => {
          const subs = active.get(p.slug) ?? 0;
          const planMrr = mrrByPlan.get(p.slug) ?? 0;
          const planArpa = subs > 0 ? planMrr / subs : 0;
          const canceled = (cancByPlan.get(p.slug) ?? 0) + (lapseByPlan.get(p.slug) ?? 0);
          return {
            planId: p.slug,
            slug: p.slug,
            name: p.name,
            price: p.amount,
            currency: p.currency,
            subscribers: subs,
            mrr: money(planMrr),
            arpa: money(planArpa),
            ltv: money(planArpa * LTV_MONTHS),
            netNew: paid.filter((r) => r.plan === p.slug).reduce((a, r) => a + r.orgs, 0),
            cancellations: canceled,
            churnPct: pct(canceled, subs + canceled),
          };
        });

      // MRR trend: the first three plans in catalogue order, weekly buckets of paid order totals.
      const weeks = Math.max(4, Math.round(days / 7));
      const top3 = plans.filter((p) => !p.is_free).slice(0, 3);
      const trend = await tx.execute(sql`
        SELECT plan_slug AS plan, currency, floor(extract(epoch FROM (paid_at - ${from.toISOString()}::timestamptz)) / ${(days * 86400) / weeks})::int AS bucket,
               sum(coalesce(total_amount, amount))::text AS amount
        FROM orders WHERE status = 'paid' AND kind IN ('plan', 'addon') AND paid_at >= ${from.toISOString()}::timestamptz
        GROUP BY plan_slug, currency, bucket`);
      const series = top3.map((p) => {
        const values = Array.from({ length: weeks }, () => 0);
        for (const r of trend.rows as Array<{
          plan: string;
          currency: string;
          bucket: number;
          amount: string;
        }>) {
          if (r.plan === p.slug && r.bucket >= 0 && r.bucket < weeks)
            values[r.bucket]! += fx.toBase(r.amount, r.currency);
        }
        return { plan: p.name, values: values.map((v) => Math.round(v * 100) / 100) };
      });

      const share = plans
        .map((p) => ({ plan: p.name, subscribers: active.get(p.slug) ?? 0 }))
        .filter((s) => s.subscribers > 0);
      const freeCount = (
        await tx.execute(
          sql`SELECT count(*)::int AS n FROM organizations o LEFT JOIN plans p ON p.slug = o.plan WHERE p.id IS NULL OR p.is_free OR p.amount = 0`,
        )
      ).rows[0] as { n: number };
      if (freeCount.n > 0) share.push({ plan: 'Free', subscribers: freeCount.n });

      return {
        days,
        currency: fx.base,
        generatedAt: now.toISOString(),
        kpis: {
          mrr: money(mrr),
          subscribers,
          netNew: orgsPaying.n,
          arpa: money(arpa),
          ltv: money(arpa * LTV_MONTHS),
          churnPct: pct(cancellations, churnBase),
          cancellations,
          trialToPaidPct: pct(orgsPaying.n, orgsPaying.n + trials.n),
          trials: trials.n,
          windowRevenue: money(windowRevenue),
          newPaidOrders,
        },
        mrrTrend: { labels: Array.from({ length: weeks }, (_, i) => `W${i + 1}`), series },
        planShare: share,
        leaderboard: rows,
        upgradePaths: await this.upgradePaths(tx, from, plans),
        cancellationReasons: [],
        featureAdoption: await this.adoption(tx, subscribers),
      };
    });
  }

  private async upgradePaths(
    tx: Tx,
    from: Date,
    plans: PlanRow[],
  ): Promise<PlanAnalytics['upgradePaths']> {
    const res = await tx.execute(sql`
      WITH ord AS (
        SELECT org_id, plan_slug, paid_at, lag(plan_slug) OVER (PARTITION BY org_id ORDER BY paid_at, id) AS prev
        FROM orders WHERE status = 'paid' AND kind = 'plan' AND plan_slug IS NOT NULL)
      SELECT prev AS from_plan, plan_slug AS to_plan, count(*)::int AS n FROM ord
      WHERE paid_at >= ${from.toISOString()}::timestamptz AND prev IS NOT NULL AND prev <> plan_slug GROUP BY prev, plan_slug ORDER BY n DESC`);
    const price = new Map(plans.map((p) => [p.slug, monthlyPrice(p)] as const));
    const out: PlanAnalytics['upgradePaths'] = (
      res.rows as Array<{ from_plan: string; to_plan: string; n: number }>
    ).map((r) => ({
      from: r.from_plan,
      to: r.to_plan,
      kind: (price.get(r.to_plan) ?? 0) >= (price.get(r.from_plan) ?? 0) ? 'upgrade' : 'downgrade',
      count: r.n,
    }));
    const first = (
      await tx.execute(
        sql`SELECT count(DISTINCT org_id)::int AS n FROM orders WHERE status = 'paid' AND kind = 'plan' AND paid_at >= ${from.toISOString()}::timestamptz`,
      )
    ).rows[0] as { n: number };
    if (first.n > 0)
      out.push({ from: 'Trial', to: 'First paid', kind: 'first_paid', count: first.n });
    return out;
  }

  /** Distinct workspaces using each feature, as a share of the paid workspaces (the label Reference printed, over a different denominator). */
  private async adoption(
    tx: Tx,
    paidWorkspaces: number,
  ): Promise<PlanAnalytics['featureAdoption']> {
    const out: PlanAnalytics['featureAdoption'] = [];
    for (const [feature, table] of FEATURE_TABLES) {
      const exists = await tx.execute(
        sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS ok`,
      );
      if (!(exists.rows[0] as { ok: boolean }).ok) continue;
      const res = await tx.execute(
        // the paid workspaces that have at least one row, asked per workspace (an index probe) instead of by reading the whole table and
        // de-duplicating: 83 ms to under 1 ms on a million messages, same count
        sql`SELECT count(*)::int AS n FROM organizations o JOIN org_plan_state s ON s.org_id = o.id JOIN plans p ON p.slug = o.plan WHERE NOT p.is_free AND p.amount > 0 AND EXISTS (SELECT 1 FROM ${sql.identifier(table)} t WHERE t.org_id = o.id)`,
      );
      const n = (res.rows[0] as { n: number }).n;
      out.push({ feature, workspaces: n, pct: pct(n, paidWorkspaces) });
    }
    return out;
  }

  /** The CSV of TW-PLAN-025: the same numbers as the screen, as one self-describing file. */
  async csv(
    days: 30 | 90 | 365,
    packageFilter: string | undefined,
    brand: string,
    now = new Date(),
  ): Promise<{ filename: string; body: string }> {
    const a = await this.overview(days, packageFilter, now);
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const slug =
      brand
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'platform';
    const lines = [
      '# Package analytics',
      `# Window (days): ${days}`,
      `# Package filter: ${packageFilter?.trim() || 'all'}`,
      `# Generated at: ${now.toISOString()}`,
      `# Currency: ${a.currency}`,
      '',
      'Summary',
      `Total MRR,${a.kpis.mrr}`,
      `Window revenue,${a.kpis.windowRevenue}`,
      `Total subscribers,${a.kpis.subscribers}`,
      `ARPA,${a.kpis.arpa}`,
      `LTV (avg ARPA x ${LTV_MONTHS}),${a.kpis.ltv}`,
      `Churn %,${a.kpis.churnPct}`,
      `New paid orders,${a.kpis.newPaidOrders}`,
      `Cancellations,${a.kpis.cancellations}`,
      '',
      'Per-plan leaderboard',
      'plan_id,plan_slug,name,subscribers,mrr,arpa,ltv,net_new,cancellations,churn_pct',
      ...a.leaderboard.map((r) =>
        [
          r.planId,
          r.slug,
          q(r.name),
          r.subscribers,
          r.mrr,
          r.arpa,
          r.ltv,
          r.netNew,
          r.cancellations,
          r.churnPct,
        ].join(','),
      ),
    ];
    return {
      filename: `${slug}-package-analytics-${days}d-${stamp}.csv`,
      body: `${lines.join('\n')}\n`,
    };
  }

  // --- financial (026) ---------------------------------------------------------------------------------------------------------

  private windowDays(w: FinancialWindow): number {
    return w === '7d' ? 7 : w === '30d' ? 30 : w === '90d' ? 90 : 365;
  }

  async financial(window: FinancialWindow, now = new Date()): Promise<Financial> {
    return this.store.tx(async (tx) => {
      const fx = await this.fx(tx);
      const n = this.windowDays(window);
      const endDay = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
      );
      const from = new Date(endDay.getTime() - n * DAY);
      const prevFrom = new Date(from.getTime() - n * DAY);

      const sumPaid = async (a: Date, b: Date) => {
        const r = await tx.execute(sql`
          SELECT currency, sum(coalesce(total_amount, amount))::text AS s FROM orders
          WHERE status = 'paid' AND paid_at >= ${a.toISOString()}::timestamptz AND paid_at < ${b.toISOString()}::timestamptz GROUP BY currency`);
        return (r.rows as Array<{ currency: string; s: string }>).reduce(
          (acc, x) => acc + fx.toBase(x.s, x.currency),
          0,
        );
      };
      const revenue = await sumPaid(from, endDay);
      const previous = await sumPaid(prevFrom, from);

      const sumBy = async (status: string, col: 'updated_at' | 'created_at') => {
        const r = await tx.execute(
          col === 'updated_at'
            ? sql`SELECT currency, sum(coalesce(total_amount, amount))::text AS s FROM orders WHERE status = ${status} AND updated_at >= ${from.toISOString()}::timestamptz AND updated_at < ${endDay.toISOString()}::timestamptz GROUP BY currency`
            : sql`SELECT currency, sum(coalesce(total_amount, amount))::text AS s FROM orders WHERE status = ${status} AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${endDay.toISOString()}::timestamptz GROUP BY currency`,
        );
        return (r.rows as Array<{ currency: string; s: string }>).reduce(
          (acc, x) => acc + fx.toBase(x.s, x.currency),
          0,
        );
      };
      const refunds = await sumBy('refunded', 'updated_at');
      const outstanding = await sumBy('pending', 'created_at');

      const plans = await this.plans(tx);
      const mrr = this.mrrOf(plans, await this.activeByPlan(tx), fx).total;

      const dayRows = async (status: string, col: 'paid_at' | 'updated_at') => {
        const r = await tx.execute(
          col === 'paid_at'
            ? sql`SELECT to_char(paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, currency, sum(coalesce(total_amount, amount))::text AS s FROM orders WHERE status = ${status} AND paid_at >= ${from.toISOString()}::timestamptz AND paid_at < ${endDay.toISOString()}::timestamptz GROUP BY d, currency`
            : sql`SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, currency, sum(coalesce(total_amount, amount))::text AS s FROM orders WHERE status = ${status} AND updated_at >= ${from.toISOString()}::timestamptz AND updated_at < ${endDay.toISOString()}::timestamptz GROUP BY d, currency`,
        );
        const m = new Map<string, number>();
        for (const x of r.rows as Array<{ d: string; currency: string; s: string }>)
          m.set(x.d, (m.get(x.d) ?? 0) + fx.toBase(x.s, x.currency));
        return m;
      };
      const paidDays = await dayRows('paid', 'paid_at');
      const refundDays = await dayRows('refunded', 'updated_at');
      const revenueByDay = Array.from({ length: n }, (_, i) => {
        const d = new Date(from.getTime() + i * DAY).toISOString().slice(0, 10);
        return {
          date: d,
          revenue: Math.round((paidDays.get(d) ?? 0) * 100) / 100,
          refunds: Math.round((refundDays.get(d) ?? 0) * 100) / 100,
        };
      });

      const gw = await tx.execute(sql`
        SELECT coalesce(gateway_slug, 'other') AS g, currency, sum(coalesce(total_amount, amount))::text AS s FROM orders
        WHERE status = 'paid' AND paid_at >= ${from.toISOString()}::timestamptz AND paid_at < ${endDay.toISOString()}::timestamptz GROUP BY g, currency`);
      const byGw = new Map<string, number>();
      for (const x of gw.rows as Array<{ g: string; currency: string; s: string }>)
        byGw.set(x.g, (byGw.get(x.g) ?? 0) + fx.toBase(x.s, x.currency));

      const st = await tx.execute(sql`
        SELECT status, count(*)::int AS n FROM orders WHERE created_at >= ${from.toISOString()}::timestamptz AND created_at < ${endDay.toISOString()}::timestamptz GROUP BY status ORDER BY n DESC`);

      const top = await tx.execute(sql`
        SELECT o.org_id, g.slug, g.name, o.currency, count(*)::int AS n, sum(coalesce(o.total_amount, o.amount))::text AS s
        FROM orders o LEFT JOIN organizations g ON g.id = o.org_id
        WHERE o.status = 'paid' AND o.paid_at >= ${from.toISOString()}::timestamptz AND o.paid_at < ${endDay.toISOString()}::timestamptz
        GROUP BY o.org_id, g.slug, g.name, o.currency`);
      const topMap = new Map<
        number,
        { slug: string; name: string; orders: number; amount: number }
      >();
      for (const x of top.rows as Array<{
        org_id: number | string;
        slug: string | null;
        name: string | null;
        currency: string;
        n: number;
        s: string;
      }>) {
        const id = Number(x.org_id);
        const cur = topMap.get(id) ?? {
          slug: x.slug ?? '',
          name: x.name ?? `Workspace #${id}`,
          orders: 0,
          amount: 0,
        };
        cur.orders += x.n;
        cur.amount += fx.toBase(x.s, x.currency);
        topMap.set(id, cur);
      }

      const recent = await tx.execute(sql`
        SELECT o.order_number, coalesce(g.name, 'Workspace #' || o.org_id) AS ws, coalesce(p.name, CASE o.kind WHEN 'wallet_topup' THEN 'Wallet top-up' ELSE o.plan_slug END, '') AS item,
               coalesce(o.total_amount, o.amount)::text AS amt, o.currency, o.status, o.created_at
        FROM orders o LEFT JOIN organizations g ON g.id = o.org_id LEFT JOIN plans p ON p.slug = o.plan_slug
        ORDER BY o.created_at DESC, o.id DESC LIMIT 10`);

      return {
        window,
        from: from.toISOString().slice(0, 10),
        to: new Date(endDay.getTime() - DAY).toISOString().slice(0, 10),
        currency: fx.base,
        kpis: {
          revenue: {
            value: money(revenue),
            previous: money(previous),
            changePct: changePct(revenue, previous),
          },
          mrr: money(mrr),
          arr: money(mrr * 12),
          refunds: money(refunds),
          outstanding: money(outstanding),
        },
        revenueByDay,
        paymentMethods: [...byGw]
          .map(([gateway, amount]) => ({ gateway, amount: money(amount) }))
          .sort((a, b) => Number(b.amount) - Number(a.amount)),
        orderStatus: (st.rows as Array<{ status: string; n: number }>).map((r) => ({
          status: r.status,
          count: r.n,
        })),
        topWorkspaces: [...topMap.values()]
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 10)
          .map((t) => ({ ...t, amount: money(t.amount) })),
        recentOrders: (
          recent.rows as Array<{
            order_number: string;
            ws: string;
            item: string;
            amt: string;
            currency: string;
            status: string;
            created_at: string | Date;
          }>
        ).map((r) => ({
          orderNumber: r.order_number,
          workspace: r.ws,
          item: r.item,
          amount: money(fx.toBase(r.amt, r.currency)),
          status: r.status,
          createdAt: new Date(r.created_at).toISOString(),
        })),
      };
    });
  }

  // --- premium (027) ---------------------------------------------------------------------------------------------------------

  async premium(window: FinancialWindow, now = new Date()): Promise<Premium> {
    return this.store.tx(async (tx) => {
      const fx = await this.fx(tx);
      const n = this.windowDays(window);
      const endDay = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
      );
      const from = new Date(endDay.getTime() - n * DAY);
      const prevFrom = new Date(from.getTime() - n * DAY);
      const plans = await this.plans(tx);
      const active = await this.activeByPlan(tx);
      const { total: mrr, byPlan } = this.mrrOf(plans, active, fx);
      const paidWorkspaces = [...active.values()].reduce((a, b) => a + b, 0);
      const totalOrgs = (
        (await tx.execute(sql`SELECT count(*)::int AS n FROM organizations`)).rows[0] as {
          n: number;
        }
      ).n;

      const conversion = async (a: Date, b: Date) => {
        const paying = (
          (
            await tx.execute(
              sql`SELECT count(DISTINCT org_id)::int AS n FROM orders WHERE status = 'paid' AND kind IN ('plan','addon') AND paid_at >= ${a.toISOString()}::timestamptz AND paid_at < ${b.toISOString()}::timestamptz`,
            )
          ).rows[0] as { n: number }
        ).n;
        const users = (
          (
            await tx.execute(
              sql`SELECT count(*)::int AS n FROM users WHERE created_at >= ${a.toISOString()}::timestamptz AND created_at < ${b.toISOString()}::timestamptz`,
            )
          ).rows[0] as { n: number }
        ).n;
        return users > 0 ? (paying / users) * 100 : 0;
      };
      const convNow = await conversion(from, endDay);
      const convPrev = await conversion(prevFrom, from);

      const paid = await this.paidByPlan(tx, from, endDay);
      const revByPlan = new Map<string, number>();
      for (const r of paid)
        revByPlan.set(r.plan, (revByPlan.get(r.plan) ?? 0) + fx.toBase(r.amount, r.currency));
      const nameOf = new Map(plans.map((p) => [p.slug, p.name] as const));

      const signups = await tx.execute(sql`
        SELECT to_char(paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(DISTINCT org_id)::int AS n FROM orders
        WHERE status = 'paid' AND kind IN ('plan','addon') AND paid_at >= ${from.toISOString()}::timestamptz AND paid_at < ${endDay.toISOString()}::timestamptz GROUP BY d`);
      const sMap = new Map(
        (signups.rows as Array<{ d: string; n: number }>).map((r) => [r.d, r.n]),
      );

      const popular = await tx.execute(sql`
        SELECT plan_slug AS plan, count(*)::int AS n FROM orders
        WHERE status = 'paid' AND kind = 'plan' AND plan_slug IS NOT NULL AND paid_at >= ${new Date(now.getTime() - 90 * DAY).toISOString()}::timestamptz
        GROUP BY plan_slug ORDER BY n DESC, plan_slug LIMIT 5`);

      const distribution = plans
        .map((p) => ({ plan: p.name, workspaces: active.get(p.slug) ?? 0 }))
        .filter((d) => d.workspaces > 0);
      distribution.push({ plan: 'Free', workspaces: Math.max(0, totalOrgs - paidWorkspaces) });

      return {
        window,
        currency: fx.base,
        kpis: {
          paidWorkspaces,
          freeWorkspaces: Math.max(0, totalOrgs - paidWorkspaces),
          arpu: money(paidWorkspaces > 0 ? mrr / paidWorkspaces : 0),
          conversion: {
            value: money(convNow),
            previous: money(convPrev),
            changePct: changePct(convNow, convPrev),
          },
        },
        planDistribution: distribution,
        revenueByPlan: [...revByPlan]
          .map(([slug, amount]) => ({ plan: nameOf.get(slug) ?? 'Unknown', amount: money(amount) }))
          .sort((a, b) => Number(b.amount) - Number(a.amount)),
        newPaidSignups: Array.from({ length: n }, (_, i) => {
          const d = new Date(from.getTime() + i * DAY).toISOString().slice(0, 10);
          return { date: d, workspaces: sMap.get(d) ?? 0 };
        }),
        popularPlans: (popular.rows as Array<{ plan: string; n: number }>).map((r) => ({
          plan: nameOf.get(r.plan) ?? r.plan,
          orders: r.n,
        })),
        plans: [...plans]
          .sort((a, b) => moneyCents(b.amount) - moneyCents(a.amount))
          .map((p) => ({
            slug: p.slug,
            name: p.name,
            price: p.amount,
            currency: p.currency,
            duration: p.is_lifetime ? 'lifetime' : `${p.billing_duration} ${p.billing_unit}`,
            workspaces: active.get(p.slug) ?? 0,
            mrr: money(byPlan.get(p.slug) ?? 0),
            windowRevenue: money(revByPlan.get(p.slug) ?? 0),
            isActive: p.is_active,
          })),
      };
    });
  }
}
