import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AdminAnalytics, AdminOverview, AdminOverviewWindow } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AuthAuditService, PlatformSettingsService, PlatformStore } from '../auth';
import {
  Fx,
  changePct,
  dateSpine,
  healthOf,
  money2,
  overviewWindow,
  regionCounts,
  revenueBuckets,
  revenueTargets,
  spikeRatio,
} from './platform-rules';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString();

interface PlanPrice {
  amount: string | null;
  offer_amount: string | null;
  billing_unit: string | null;
  billing_duration: number | null;
  is_free: boolean;
}

/** A plan's monthly price: offer-aware, a year is 12 months, a week 52/12, a day 30 (WaDesk showed the raw list price). */
export function monthlyOf(p: PlanPrice): number {
  if (p.is_free || p.amount === null) return 0;
  const offer = Number(p.offer_amount);
  const amount = Number(p.amount);
  const price = offer > 0 && offer < amount ? offer : amount;
  if (!(price > 0)) return 0;
  const n = Math.max(1, p.billing_duration ?? 1);
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

/**
 * The operator dashboards' numbers (WD-DASH-034..044), defined once so the overview, the analytics page and the CSV agree.
 * Read-only and cross-tenant: it runs its own SQL through PlatformStore (the sanctioned door, never a `.privileged(` of its own)
 * behind OperatorGuard. Deliberate differences from WaDesk are listed in docs/wadesk-port/parity/dashboards-analytics-charts.md.
 */
@Injectable()
export class PlatformMetricsService {
  constructor(
    private readonly store: PlatformStore,
    private readonly settings: PlatformSettingsService,
    private readonly audit: AuthAuditService,
  ) {}

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

  /** Paid revenue (`COALESCE(total_amount, amount)`, by `paid_at`) in [a, b), converted to the platform currency. */
  private async paid(tx: Tx, fx: Fx, a: Date, b: Date): Promise<number> {
    const r = await tx.execute(sql`
      SELECT currency, sum(coalesce(total_amount, amount))::text AS s FROM orders
      WHERE status = 'paid' AND paid_at >= ${iso(a)}::timestamptz AND paid_at < ${iso(b)}::timestamptz GROUP BY currency`);
    return (r.rows as Array<{ currency: string; s: string }>).reduce(
      (acc, x) => acc + fx.toBase(x.s, x.currency),
      0,
    );
  }

  private async n(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
    const r = await tx.execute(query);
    return Number((r.rows[0] as { n: number | string }).n);
  }

  private outMessages(tx: Tx, a: Date, b: Date): Promise<number> {
    return this.n(
      tx,
      sql`SELECT count(*)::int AS n FROM messages WHERE direction = 'out' AND deleted_at IS NULL
          AND created_at >= ${iso(a)}::timestamptz AND created_at < ${iso(b)}::timestamptz`,
    );
  }

  // --- overview (WD-DASH-034..040) -------------------------------------------------------------------------------------------

  async overview(window: AdminOverviewWindow, now = new Date()): Promise<AdminOverview> {
    const win = overviewWindow(window, now);
    return this.store.tx(async (tx) => {
      const fx = await this.fx(tx);

      const income = await this.paid(tx, fx, win.from, win.to);
      const incomePrev = await this.paid(tx, fx, win.prevFrom, win.from);
      const views = await this.outMessages(tx, win.from, win.to);
      const viewsPrev = await this.outMessages(tx, win.prevFrom, win.from);
      const conv = async (a: Date, b: Date): Promise<number> => {
        const signups = await this.n(
          tx,
          sql`SELECT count(*)::int AS n FROM users WHERE created_at >= ${iso(a)}::timestamptz AND created_at < ${iso(b)}::timestamptz`,
        );
        const payers = await this.n(
          tx,
          sql`SELECT count(DISTINCT org_id)::int AS n FROM orders WHERE status = 'paid'
              AND paid_at >= ${iso(a)}::timestamptz AND paid_at < ${iso(b)}::timestamptz`,
        );
        return signups > 0 ? (payers / signups) * 100 : 0;
      };
      const conversion = await conv(win.from, win.to);
      const conversionPrev = await conv(win.prevFrom, win.from);

      // Revenue over time: buckets that cover the whole window, so the header total equals the Total income card.
      const buckets = revenueBuckets(win);
      const step = Math.max(1, Math.ceil(win.days / 12));
      const rows = await tx.execute(sql`
        SELECT currency, floor(extract(epoch FROM (paid_at - ${iso(win.from)}::timestamptz)) / ${step * 86400})::int AS bucket,
               sum(coalesce(total_amount, amount))::text AS s
        FROM orders WHERE status = 'paid' AND paid_at >= ${iso(win.from)}::timestamptz AND paid_at < ${iso(win.to)}::timestamptz
        GROUP BY currency, bucket`);
      const series = buckets.map(() => 0);
      for (const r of rows.rows as Array<{ currency: string; bucket: number; s: string }>) {
        if (r.bucket >= 0 && r.bucket < series.length) {
          series[r.bucket]! += fx.toBase(r.s, r.currency);
        }
      }
      const rounded = series.map((v) => Math.round(v * 100) / 100);
      const target = revenueTargets(rounded);

      // Sales by payment gateway: the top three by revenue, the rest folded into "Other" (WaDesk dropped them).
      const gw = await tx.execute(sql`
        SELECT gateway_slug AS slug, currency, sum(coalesce(total_amount, amount))::text AS s FROM orders
        WHERE status = 'paid' AND gateway_slug IS NOT NULL
          AND paid_at >= ${iso(win.from)}::timestamptz AND paid_at < ${iso(win.to)}::timestamptz GROUP BY gateway_slug, currency`);
      const byGateway = new Map<string, number>();
      for (const r of gw.rows as Array<{ slug: string; currency: string; s: string }>) {
        byGateway.set(r.slug, (byGateway.get(r.slug) ?? 0) + fx.toBase(r.s, r.currency));
      }
      const ranked = [...byGateway.entries()].sort((a, b) => b[1] - a[1]);
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      const gateways =
        ranked.length === 0
          ? ['Stripe', 'Razorpay', 'PayPal'].map((gateway) => ({ gateway, amount: '0.00' }))
          : ranked.slice(0, 3).map(([s, v]) => ({ gateway: cap(s), amount: money2(v) }));
      const rest = ranked.slice(3).reduce((a, [, v]) => a + v, 0);
      if (rest > 0) gateways.push({ gateway: 'Other', amount: money2(rest) });

      // Registered users: premium = distinct owners of a workspace on a paid plan (by plan slug, not a numeric id).
      const total = await this.n(tx, sql`SELECT count(*)::int AS n FROM users`);
      const premium = await this.n(
        tx,
        sql`SELECT count(DISTINCT ws.owner_user_id)::int AS n
            FROM workspace_settings ws JOIN organizations o ON o.id = ws.org_id
            JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
            WHERE ws.owner_user_id IS NOT NULL AND NOT p.is_free AND p.amount > 0`,
      );

      const week = iso(new Date(now.getTime() - 7 * DAY));
      const ws = await tx.execute(sql`
        SELECT o.slug, o.name, u.full_name AS owner, coalesce(p.name, 'Free') AS plan,
               p.amount::text AS amount, p.offer_amount::text AS offer_amount, p.billing_unit, p.billing_duration, p.currency,
               coalesce(p.is_free, true) AS is_free,
               (SELECT count(*)::int FROM messages m WHERE m.org_id = o.id AND m.direction = 'out' AND m.deleted_at IS NULL
                  AND m.created_at >= ${week}::timestamptz) AS messages,
               (SELECT max(m.created_at) FROM messages m WHERE m.org_id = o.id) AS last_active
        FROM organizations o
        LEFT JOIN workspace_settings ws ON ws.org_id = o.id
        LEFT JOIN users u ON u.org_id = o.id AND u.id = ws.owner_user_id
        LEFT JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
        ORDER BY last_active DESC NULLS LAST, o.created_at DESC LIMIT 5`);
      const workspaces = (
        ws.rows as unknown as Array<
          PlanPrice & {
            slug: string;
            name: string;
            owner: string | null;
            plan: string;
            currency: string | null;
            messages: number;
          }
        >
      ).map((r) => ({
        slug: r.slug,
        name: r.name,
        owner: r.owner,
        plan: r.plan,
        messages: r.messages,
        health: healthOf(r.messages),
        mrr: money2(fx.toBase(monthlyOf(r), r.currency ?? fx.base)),
      }));

      return {
        window,
        from: iso(win.from),
        to: iso(win.to),
        currency: fx.base,
        kpis: {
          income: {
            value: money2(income),
            previous: money2(incomePrev),
            changePct: changePct(income, incomePrev),
          },
          profit: {
            value: money2(income * 0.32),
            previous: money2(incomePrev * 0.32),
            changePct: changePct(income, incomePrev),
          },
          views: {
            value: String(views),
            previous: String(viewsPrev),
            changePct: changePct(views, viewsPrev),
          },
          conversion: {
            value: money2(conversion),
            previous: money2(conversionPrev),
            changePct: changePct(conversion, conversionPrev),
          },
        },
        revenue: {
          labels: buckets.map((b) => b.label),
          series: rounded,
          target,
          total: money2(rounded.reduce((a, b) => a + b, 0)),
          totalTarget: money2(target.reduce((a, b) => a + b, 0)),
        },
        // ponytail: the users table keeps no country, so the WaDesk panels show their empty state; fill in when signup stores it.
        countries: [],
        regions: regionCounts(new Map()),
        gateways,
        users: {
          total,
          premium,
          basic: Math.max(0, total - premium),
          pct: total > 0 ? Math.round((premium / total) * 100) : 0,
        },
        workspaces,
        alerts: await this.alerts(tx, now),
      };
    });
  }

  /** Up to three alerts; the header still counts every one generated (WaDesk's quirk, kept). */
  private async alerts(tx: Tx, now: Date): Promise<AdminOverview['alerts']> {
    const all: AdminOverview['alerts']['items'] = [];
    const failed = await tx.execute(sql`
      SELECT o.name AS workspace, ord.failure_reason FROM orders ord JOIN organizations o ON o.id = ord.org_id
      WHERE ord.status = 'failed' AND ord.created_at >= ${iso(new Date(now.getTime() - DAY))}::timestamptz
      ORDER BY ord.created_at DESC LIMIT 2`);
    for (const r of failed.rows as Array<{ workspace: string; failure_reason: string | null }>) {
      all.push({
        severity: 'high',
        title: `${r.workspace} payment failed`,
        detail: `${(r.failure_reason ?? 'Gateway returned failed status').replace(/\.$/, '')}.`,
      });
    }
    const top = await tx.execute(sql`
      SELECT m.org_id, o.name, count(*)::int AS n FROM messages m JOIN organizations o ON o.id = m.org_id
      WHERE m.direction = 'out' AND m.created_at >= ${iso(new Date(now.getTime() - 3_600_000))}::timestamptz
      GROUP BY m.org_id, o.name ORDER BY n DESC LIMIT 1`);
    const lead = top.rows[0] as { org_id: number; name: string; n: number } | undefined;
    if (lead) {
      const week = await this.n(
        tx,
        sql`SELECT count(*)::int AS n FROM messages WHERE org_id = ${lead.org_id} AND direction = 'out'
            AND created_at >= ${iso(new Date(now.getTime() - 7 * DAY))}::timestamptz`,
      );
      const ratio = spikeRatio(lead.n, week);
      if (ratio !== null) {
        all.push({
          severity: 'medium',
          title: `${lead.name} message spike`,
          detail: `${ratio.toFixed(1)}x normal hourly volume.`,
        });
      }
    }
    const pending = await this.n(
      tx,
      sql`SELECT count(*)::int AS n FROM organizations WHERE status = 'pending'`,
    );
    if (pending > 0) {
      all.push({
        severity: 'low',
        title: `${pending} workspace review${pending === 1 ? '' : 's'} pending`,
        detail: 'Newest signup awaiting admin approval.',
      });
    }
    return { open: all.length, items: all.slice(0, 3) };
  }

  // --- analytics (WD-DASH-041..044) ------------------------------------------------------------------------------------------

  async analytics(days: number, now = new Date()): Promise<AdminAnalytics> {
    const since = new Date(now.getTime() - days * DAY);
    const s = iso(since);
    return this.store.tx(async (tx) => {
      const fx = await this.fx(tx);
      const end = new Date(now.getTime() + 1);
      const revenue = await this.paid(tx, fx, since, end);
      const users = await this.n(tx, sql`SELECT count(*)::int AS n FROM users`);
      const newUsers = await this.n(
        tx,
        sql`SELECT count(*)::int AS n FROM users WHERE created_at >= ${s}::timestamptz`,
      );
      const workspaces = await this.n(tx, sql`SELECT count(*)::int AS n FROM organizations`);
      const newWorkspaces = await this.n(
        tx,
        sql`SELECT count(*)::int AS n FROM organizations WHERE created_at >= ${s}::timestamptz`,
      );
      const messages = await this.outMessages(tx, since, end);
      const devicesTotal = await this.n(tx, sql`SELECT count(*)::int AS n FROM devices`);
      const devicesOnline = await this.n(
        tx,
        sql`SELECT count(*)::int AS n FROM devices WHERE status = 'connected' AND active`,
      );
      const openTickets = await this.n(
        tx,
        sql`SELECT count(*)::int AS n FROM support_tickets WHERE status IN ('open', 'in_progress', 'pending')`,
      );

      const signupRows = await this.signupRows(tx, since);
      const start = new Date(
        Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()),
      );
      const spineDays = Math.floor((now.getTime() - start.getTime()) / DAY) + 1;
      const signups = dateSpine(start, spineDays).map((date) => ({
        date,
        count: signupRows.get(date) ?? 0,
      }));

      const mix = await tx.execute(sql`
        SELECT coalesce(p.name, NULLIF(o.plan, ''), 'Free') AS plan, count(*)::int AS count
        FROM organizations o LEFT JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
        GROUP BY 1 ORDER BY count DESC, plan`);
      const dev = await tx.execute(sql`
        SELECT device_name, country_code, phone_number, sent_24h FROM devices ORDER BY active DESC, id DESC LIMIT 8`);
      const deviceSends = await this.n(
        tx,
        sql`SELECT coalesce(sum(sent_24h), 0)::int AS n FROM devices`,
      );
      const board = await tx.execute(sql`
        SELECT o.slug, o.name, ord.currency, count(*)::int AS orders, sum(coalesce(ord.total_amount, ord.amount))::text AS s
        FROM orders ord JOIN organizations o ON o.id = ord.org_id
        WHERE ord.status = 'paid' AND ord.paid_at >= ${s}::timestamptz GROUP BY o.slug, o.name, ord.currency`);
      const merged = new Map<
        string,
        { slug: string; name: string; orders: number; amount: number }
      >();
      for (const r of board.rows as Array<{
        slug: string;
        name: string;
        currency: string;
        orders: number;
        s: string;
      }>) {
        const e = merged.get(r.slug) ?? { slug: r.slug, name: r.name, orders: 0, amount: 0 };
        e.orders += r.orders;
        e.amount += fx.toBase(r.s, r.currency);
        merged.set(r.slug, e);
      }
      const tickets = await tx.execute(
        sql`SELECT status, count(*)::int AS count FROM support_tickets GROUP BY status ORDER BY count DESC, status`,
      );

      return {
        days,
        since: s,
        currency: fx.base,
        kpis: {
          revenue: money2(revenue),
          workspaces,
          newWorkspaces,
          users,
          newUsers,
          messages,
          messagesPerDay: Math.round(messages / days),
          devicesOnline,
          devicesTotal,
          openTickets,
        },
        signups,
        planMix: mix.rows as unknown as Array<{ plan: string; count: number }>,
        topDevices: (
          dev.rows as unknown as Array<{
            device_name: string;
            country_code: string | null;
            phone_number: string | null;
            sent_24h: number;
          }>
        ).map((d) => ({
          label: `${d.device_name} · +${d.country_code ?? ''} ${(d.phone_number ?? '').slice(0, 4)}xx`,
          sent24h: d.sent_24h,
        })),
        deviceSends24h: deviceSends,
        leaderboard: [...merged.values()]
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 8)
          .map((e) => ({ ...e, amount: money2(e.amount) })),
        tickets: tickets.rows as unknown as Array<{ status: string; count: number }>,
      };
    });
  }

  private async signupRows(tx: Tx, since: Date): Promise<Map<string, number>> {
    const r = await tx.execute(sql`
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n FROM users
      WHERE created_at >= ${iso(since)}::timestamptz GROUP BY 1`);
    return new Map((r.rows as Array<{ d: string; n: number }>).map((x) => [x.d, x.n]));
  }

  /** WD-DASH-044: `date,signups`, one row per date that had a signup, oldest first. Audited (WaDesk did not). */
  async signupsCsv(days: number, now = new Date()): Promise<{ filename: string; body: string }> {
    const since = new Date(now.getTime() - days * DAY);
    const rows = await this.store.tx((tx) => this.signupRows(tx, since));
    const lines = ['date,signups', ...[...rows.entries()].sort().map(([d, n]) => `${d},${n}`)];
    const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    await this.audit.recordStandalone({
      event: 'platform.analytics.exported',
      status: 'success',
      payload: { days, rows: rows.size },
    });
    return { filename: `analytics-signups-${days}d-${stamp}.csv`, body: `${lines.join('\n')}\n` };
  }
}
