import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { ListWorkspaceHubQuery } from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  SUSPENDING_FLAGS,
  type HubCursor,
  type HubRawRow,
  type PageFacts,
} from './platform-workspaces.mapper';

/** What the SQL needs to know that lives outside the database (settings, exchange rates, the provider registry). */
export interface HubQueryContext {
  /** The platform wallet currency: the unit of a workspace whose own currency cannot be billed. */
  platformCurrency: string;
  /** Low-balance threshold per billable currency, in minor units (the wallet list's own rule). */
  thresholds: ReadonlyMap<string, number>;
  /** `billing.grace_days`. */
  graceDays: number;
  /** The provider a workspace without an override uses (registry default, else the platform setting). */
  fallbackProviderKey: string;
}

export interface HubKpiCounts {
  total: number;
  active: number;
  suspended: number;
  trial: number;
  newThisMonth: number;
  lowBalance: number;
  /** Paying workspaces grouped by the plan price they pay, to be converted and summed by the caller. */
  paying: Array<{
    amount: string | null;
    offer_amount: string | null;
    billing_unit: string | null;
    billing_duration: number | null;
    currency: string | null;
    is_free: boolean;
    n: number;
  }>;
}

const escapeLike = (s: string): string => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const list = (items: SQL[]): SQL => sql.join(items, sql`, `);

/** The workspace hub's reads. Every method takes the platform door's transaction (cross-tenant, behind the operator guards). */
@Injectable()
export class PlatformWorkspacesRepository {
  // --- SQL fragments, shared by the list, the single row and the KPIs -----------------------------------------------------------

  private thresholds(c: HubQueryContext): SQL {
    const rows = [...c.thresholds.entries()].map(
      ([unit, minor]) => sql`(${unit}::text, ${Math.round(minor)}::bigint)`,
    );
    // An empty VALUES is a syntax error; the platform currency is always billable, so this is only a guard.
    return sql`WITH th(unit, minor) AS (VALUES ${rows.length ? list(rows) : sql`(''::text, 0::bigint)`})`;
  }

  /** The lifecycle state of TW-PLAN-016 in SQL (the filter and the KPIs need it for every workspace, not only a page). */
  private stateExpr(c: HubQueryContext): SQL {
    return sql`(CASE
      WHEN p.id IS NULL THEN 'no_plan'
      WHEN p.is_custom_quote THEN 'custom_quote'
      WHEN p.is_free OR p.amount = 0 THEN
        (CASE WHEN s.trial_ends_at IS NULL THEN 'free' WHEN s.trial_ends_at > now() THEN 'free_trial' ELSE 'free_trial_expired' END)
      WHEN s.plan_ends_at IS NOT NULL AND s.plan_ends_at <= now() THEN
        (CASE WHEN ${c.graceDays}::int > 0
               AND s.plan_ends_at + (${c.graceDays}::int * interval '1 day') > now()
               AND EXISTS (SELECT 1 FROM subscriptions sb WHERE sb.org_id = o.id AND sb.kind = 'plan' AND sb.plan_id = o.plan
                             AND sb.status IN ('active', 'past_due'))
              THEN 'paid_grace' ELSE 'paid_lapsed' END)
      ELSE 'paid_active' END)`;
  }

  private lowExpr(): SQL {
    return sql`(COALESCE(th.minor, 0) > 0 AND COALESCE(w.balance, 0) <= th.minor::numeric / 100)`;
  }

  private baseFrom(c: HubQueryContext): SQL {
    const billable = [...c.thresholds.keys()].map((u) => sql`${u}`);
    const unit = sql`CASE WHEN upper(o.settings->>'currency') IN (${billable.length ? list(billable) : sql`''`})
                          THEN upper(o.settings->>'currency') ELSE ${c.platformCurrency}::text END`;
    return sql`
      FROM organizations o
      LEFT JOIN org_plan_state s ON s.org_id = o.id
      LEFT JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
      LEFT JOIN org_whatsapp_provider_assignment a ON a.org_id = o.id
      LEFT JOIN whatsapp_providers wp ON wp.id = a.provider_id
      LEFT JOIN workspace_settings ws ON ws.org_id = o.id
      LEFT JOIN LATERAL (SELECT ${unit} AS unit) b ON true
      LEFT JOIN wallets w ON w.org_id = o.id AND w.unit = b.unit
      LEFT JOIN th ON th.unit = b.unit`;
  }

  /** The owner: the user `organizations.settings.ownerUserId` names, else the workspace settings' owner, else an Admin-role holder. */
  private ownerJoin(): SQL {
    return sql`
      LEFT JOIN LATERAL (
        SELECT u.id, u.uuid, u.full_name, u.email::text AS email
        FROM users u
        WHERE u.org_id = o.id AND (
          u.uuid::text = o.settings->>'ownerUserId'
          OR u.id = ws.owner_user_id
          OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
                      WHERE ur.org_id = u.org_id AND ur.user_id = u.id AND r.system_key = 'admin'))
        ORDER BY (u.uuid::text = o.settings->>'ownerUserId') DESC, (u.id = ws.owner_user_id) DESC, u.id
        LIMIT 1
      ) ow ON true
      LEFT JOIN user_profiles up ON up.org_id = o.id AND up.user_id = ow.id`;
  }

  private selectColumns(c: HubQueryContext, sort: ListWorkspaceHubQuery['sort']): SQL {
    const isoOf = (e: SQL) =>
      sql`to_char(${e} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const sortValue =
      sort === 'name'
        ? sql`lower(o.name)`
        : sort === 'last_active'
          ? isoOf(sql`la.at`)
          : isoOf(sql`o.created_at`);
    return sql`
      o.id, o.uuid, o.name, o.slug, o.status, o.plan, o.created_at,
      ${isoOf(sql`o.created_at`)} AS created_at_iso,
      ${this.stateExpr(c)} AS state,
      s.trial_ends_at, s.plan_ends_at, COALESCE(s.overrides, '{}'::jsonb) AS overrides, s.platform_owned,
      (p.id IS NOT NULL) AS plan_found, p.name AS plan_name, p.limits AS plan_limits,
      p.amount::text AS amount, p.offer_amount::text AS offer_amount, p.billing_unit, p.billing_duration,
      p.currency AS plan_currency, p.is_free,
      b.unit, w.balance::text AS balance, ${this.lowExpr()} AS low,
      wp.key AS provider_key, wp.label AS provider_label,
      ow.uuid::text AS owner_uuid, ow.full_name AS owner_name, ow.email AS owner_email, up.phone_e164 AS owner_phone,
      ws.admin_note,
      ${sortValue} AS sort_value`;
  }

  // --- reads --------------------------------------------------------------------------------------------------------------------

  /** One page, `limit + 1` rows so the caller can tell whether another follows. Keyset on the sort value and the id; never OFFSET. */
  async list(
    tx: Tx,
    q: ListWorkspaceHubQuery,
    cursor: HubCursor | null,
    c: HubQueryContext,
  ): Promise<HubRawRow[]> {
    const where: SQL[] = [sql`true`];
    if (q.q) {
      const like = escapeLike(q.q);
      where.push(
        sql`(o.name ILIKE ${like} OR o.slug ILIKE ${like} OR ow.full_name ILIKE ${like} OR ow.email ILIKE ${like})`,
      );
    }
    if (q.status !== 'all') where.push(sql`o.status = ${q.status}`);
    if (q.plan) where.push(sql`o.plan = ${q.plan}`);
    if (q.state) where.push(sql`${this.stateExpr(c)} = ${q.state}`);
    if (q.provider)
      where.push(sql`COALESCE(wp.key, ${c.fallbackProviderKey}::text) = ${q.provider}`);
    if (q.lowBalanceOnly) where.push(this.lowExpr());

    // Newest first, most recently active first (never-active last), or A to Z; the id breaks every tie.
    let order: SQL;
    if (q.sort === 'name') {
      order = sql`lower(o.name) ASC, o.id ASC`;
      if (cursor)
        where.push(sql`(lower(o.name), o.id) > (${cursor.v ?? ''}::text, ${cursor.id}::bigint)`);
    } else if (q.sort === 'last_active') {
      order = sql`COALESCE(la.at, '-infinity'::timestamptz) DESC, o.id DESC`;
      if (cursor)
        where.push(
          sql`(COALESCE(la.at, '-infinity'::timestamptz), o.id) < (COALESCE(${cursor.v}::text, '-infinity')::timestamptz, ${cursor.id}::bigint)`,
        );
    } else {
      order = sql`o.created_at DESC, o.id DESC`;
      if (cursor)
        where.push(
          sql`(o.created_at, o.id) < (COALESCE(${cursor.v}::text, 'infinity')::timestamptz, ${cursor.id}::bigint)`,
        );
    }
    const lastActiveJoin =
      q.sort === 'last_active'
        ? sql`LEFT JOIN (SELECT org_id, max(created_at) AS at FROM messages GROUP BY org_id) la ON la.org_id = o.id`
        : sql``;

    const res = await tx.execute(sql`
      ${this.thresholds(c)}
      SELECT ${this.selectColumns(c, q.sort)}
      ${this.baseFrom(c)}
      ${this.ownerJoin()}
      ${lastActiveJoin}
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY ${order}
      LIMIT ${q.limit + 1}`);
    return res.rows as unknown as HubRawRow[];
  }

  async one(tx: Tx, uuid: string, c: HubQueryContext): Promise<HubRawRow | null> {
    const res = await tx.execute(sql`
      ${this.thresholds(c)}
      SELECT ${this.selectColumns(c, 'created')}
      ${this.baseFrom(c)}
      ${this.ownerJoin()}
      WHERE o.uuid = ${uuid}::uuid`);
    return (res.rows[0] as unknown as HubRawRow | undefined) ?? null;
  }

  /** The KPI strip: counts over every workspace, and the paying ones grouped by price for the MRR sum. */
  async kpis(tx: Tx, c: HubQueryContext): Promise<HubKpiCounts> {
    const counts = await tx.execute(sql`
      ${this.thresholds(c)}
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE o.status = 'active')::int AS active,
             count(*) FILTER (WHERE o.status = 'suspended')::int AS suspended,
             count(*) FILTER (WHERE ${this.stateExpr(c)} = 'free_trial')::int AS trial,
             count(*) FILTER (WHERE o.created_at >= date_trunc('month', now()))::int AS new_this_month,
             count(*) FILTER (WHERE ${this.lowExpr()})::int AS low_balance
      ${this.baseFrom(c)}`);
    const paying = await tx.execute(sql`
      ${this.thresholds(c)}
      SELECT p.amount::text AS amount, p.offer_amount::text AS offer_amount, p.billing_unit, p.billing_duration,
             p.currency, p.is_free, count(*)::int AS n
      ${this.baseFrom(c)}
      WHERE ${this.stateExpr(c)} IN ('paid_active', 'paid_grace') AND NOT COALESCE(s.platform_owned, false)
      GROUP BY p.amount, p.offer_amount, p.billing_unit, p.billing_duration, p.currency, p.is_free`);
    const k = counts.rows[0] as unknown as Record<string, number>;
    return {
      total: k.total ?? 0,
      active: k.active ?? 0,
      suspended: k.suspended ?? 0,
      trial: k.trial ?? 0,
      newThisMonth: k.new_this_month ?? 0,
      lowBalance: k.low_balance ?? 0,
      paying: paying.rows as unknown as HubKpiCounts['paying'],
    };
  }

  /**
   * Connected numbers, suspension flags, 7-day outbound messages and last activity for the page's workspaces: one grouped query each,
   * never a subquery per row.
   */
  async pageFacts(tx: Tx, ids: number[], now: Date): Promise<PageFacts> {
    const empty: PageFacts = {
      numbers: new Map(),
      flags: new Map(),
      messages7d: new Map(),
      lastActive: new Map(),
    };
    if (ids.length === 0) return empty;
    const inIds = list(ids.map((i) => sql`${i}::bigint`));
    const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const flags = list(SUSPENDING_FLAGS.map((f) => sql`${f}`));

    const [numbers, flagRows, msgs, last] = await Promise.all([
      tx.execute(sql`SELECT org_id, count(*)::int AS n FROM wa_provider_configs
                     WHERE org_id IN (${inIds}) AND provider = 'waba' AND status = 'connected' GROUP BY org_id`),
      tx.execute(sql`SELECT org_id, array_agg(DISTINCT flag ORDER BY flag) AS flags FROM workspace_flags
                     WHERE org_id IN (${inIds}) AND cleared_at IS NULL AND flag IN (${flags}) GROUP BY org_id`),
      tx.execute(sql`SELECT org_id, count(*)::int AS n FROM messages
                     WHERE org_id IN (${inIds}) AND direction = 'out' AND deleted_at IS NULL
                       AND created_at >= ${week}::timestamptz GROUP BY org_id`),
      tx.execute(
        sql`SELECT org_id, max(created_at) AS at FROM messages WHERE org_id IN (${inIds}) GROUP BY org_id`,
      ),
    ]);
    return {
      numbers: new Map(
        (numbers.rows as Array<{ org_id: string | number; n: number }>).map((r) => [
          Number(r.org_id),
          r.n,
        ]),
      ),
      flags: new Map(
        (flagRows.rows as Array<{ org_id: string | number; flags: string[] }>).map((r) => [
          Number(r.org_id),
          r.flags,
        ]),
      ),
      messages7d: new Map(
        (msgs.rows as Array<{ org_id: string | number; n: number }>).map((r) => [
          Number(r.org_id),
          r.n,
        ]),
      ),
      lastActive: new Map(
        (last.rows as Array<{ org_id: string | number; at: string | Date }>).map((r) => [
          Number(r.org_id),
          new Date(r.at),
        ]),
      ),
    };
  }

  /** The plans the filter dropdown offers (every catalogue plan, active or not: a workspace may still sit on a retired one). */
  async planOptions(tx: Tx): Promise<Array<{ slug: string; name: string }>> {
    const res = await tx.execute(
      sql`SELECT slug, name FROM plans WHERE kind = 'plan' ORDER BY sort_order, slug`,
    );
    return res.rows as unknown as Array<{ slug: string; name: string }>;
  }

  /** Limits of the first active free plan: what a lapsed paid plan falls back to (the entitlement resolver's rule). */
  async freePlanLimits(tx: Tx): Promise<unknown> {
    const res = await tx.execute(sql`
      SELECT limits FROM plans
      WHERE kind = 'plan' AND is_active AND NOT is_custom_quote AND (is_free OR amount = 0)
      ORDER BY sort_order, amount, slug LIMIT 1`);
    return (res.rows[0] as { limits?: unknown } | undefined)?.limits ?? null;
  }

  async currencyRates(tx: Tx): Promise<Map<string, number>> {
    const res = await tx.execute(
      sql`SELECT code, exchange_rate::text AS rate FROM currencies WHERE is_active`,
    );
    return new Map(
      (res.rows as Array<{ code: string; rate: string }>).map(
        (r) => [r.code.toUpperCase(), Number(r.rate)] as const,
      ),
    );
  }

  /** Figures for one workspace's dashboard. `since` is the first day of the 30-day series (UTC midnight). */
  async detailExtras(
    tx: Tx,
    orgId: number,
    since: Date,
  ): Promise<{
    members: number;
    contacts: number;
    openTickets: number;
    series: Array<{ day: string; sent: number; delivered: number }>;
  }> {
    const [members, contacts, tickets, series] = await Promise.all([
      tx.execute(
        sql`SELECT count(*)::int AS n FROM users WHERE org_id = ${orgId} AND status <> 'inactive'`,
      ),
      tx.execute(sql`SELECT count(*)::int AS n FROM contacts WHERE org_id = ${orgId}`),
      tx.execute(sql`SELECT count(*)::int AS n FROM support_tickets
                     WHERE org_id = ${orgId} AND status NOT IN ('resolved', 'closed')`),
      tx.execute(sql`
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               count(*)::int AS sent,
               count(*) FILTER (WHERE status IN ('delivered', 'read'))::int AS delivered
        FROM messages
        WHERE org_id = ${orgId} AND direction = 'out' AND deleted_at IS NULL AND created_at >= ${since.toISOString()}::timestamptz
        GROUP BY 1`),
    ]);
    const n = (r: { rows: unknown[] }) => (r.rows[0] as { n: number } | undefined)?.n ?? 0;
    return {
      members: n(members),
      contacts: n(contacts),
      openTickets: n(tickets),
      series: series.rows as unknown as Array<{ day: string; sent: number; delivered: number }>,
    };
  }
}
