import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  AdminOrderType,
  BillingStatusFilter,
  OrderTypeFilter,
  PaygwOrderStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';

/**
 * Every SQL statement of the operator billing screens (WD-PAYGW-037..046). Read through PaygwStore's privileged transaction, the
 * one sanctioned door for cross-workspace order reads. Money leaves here already converted into the reporting currency by the
 * platform's exchange rates (each rate = units of that currency per one base unit): `amount / rate(order) * rate(reporting)`.
 * Nothing here builds SQL from caller text: filters are bound parameters, and the only dynamic pieces are fixed fragments.
 */

type Raw = Record<string, unknown>;
const s = (v: unknown): string => String(v);
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Escapes % and _ so a search for "50%" matches the text, not everything. */
export const likeOf = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const iso = (d: Date): string => d.toISOString();

/** An order's money in the reporting currency. `cr` is the join on the order's currency. */
const baseAmount = (rate: string): SQL =>
  sql`(COALESCE(NULLIF(o.total_amount, 0), o.amount) / COALESCE(NULLIF(cr.exchange_rate, 0), 1) * ${rate}::numeric)`;

const FROM_ORDERS = sql`
  FROM orders o
  LEFT JOIN organizations org ON org.id = o.org_id
  LEFT JOIN currencies cr ON cr.code = o.currency`;

/**
 * The same plus the plan and the workspace's previous paid plan order, from which the real order type comes: new (no earlier
 * paid plan), renewal (same plan), upgrade or downgrade (by converted price). Add-ons, wallet top-ups and manual invoices keep
 * their own kind.
 */
const FROM_TYPED = sql`
  ${FROM_ORDERS}
  LEFT JOIN plans p ON p.slug = o.plan_slug
  LEFT JOIN currencies pcr ON pcr.code = p.currency
  LEFT JOIN LATERAL (
    SELECT pp.plan_slug, (pl.amount / COALESCE(NULLIF(pc.exchange_rate, 0), 1)) AS price_base
    FROM orders pp
    LEFT JOIN plans pl ON pl.slug = pp.plan_slug
    LEFT JOIN currencies pc ON pc.code = pl.currency
    WHERE pp.org_id = o.org_id AND pp.kind = 'plan' AND pp.status = 'paid' AND pp.id <> o.id
      AND pp.paid_at < COALESCE(o.paid_at, o.created_at)
    ORDER BY pp.paid_at DESC, pp.id DESC
    LIMIT 1
  ) prev ON o.kind = 'plan'`;

const TYPE_EXPR = sql`CASE
    WHEN o.kind <> 'plan' THEN o.kind
    WHEN prev.plan_slug IS NULL THEN 'new'
    WHEN prev.plan_slug = o.plan_slug THEN 'renewal'
    WHEN COALESCE(p.amount / COALESCE(NULLIF(pcr.exchange_rate, 0), 1), 0) >= COALESCE(prev.price_base, 0) THEN 'upgrade'
    ELSE 'downgrade'
  END`;

const OPEN = sql`('pending', 'awaiting_approval')`;
const LOST = sql`('failed', 'cancelled', 'refunded')`;

export interface OrderListRow {
  uuid: string;
  orderNumber: string;
  createdAt: Date;
  type: AdminOrderType;
  kind: string;
  planSlug: string | null;
  planName: string | null;
  description: string | null;
  billingPeriod: 'monthly' | 'yearly' | null;
  status: PaygwOrderStatus;
  currency: string;
  total: string;
  gatewaySlug: string | null;
  customerEmail: string | null;
  proofSubmittedAt: Date | null;
  workspace: { id: string; name: string; slug: string } | null;
}

const ws = (r: Raw) =>
  r.ws_uuid ? { id: s(r.ws_uuid), name: s(r.ws_name), slug: s(r.ws_slug) } : null;

function toListRow(r: Raw): OrderListRow {
  return {
    uuid: s(r.uuid),
    orderNumber: s(r.order_number),
    createdAt: new Date(s(r.created_at)),
    type: r.otype as AdminOrderType,
    kind: s(r.kind),
    planSlug: sn(r.plan_slug),
    planName: sn(r.plan_name),
    description: sn(r.description),
    billingPeriod: (sn(r.billing_period) as 'monthly' | 'yearly' | null) ?? null,
    status: r.status as PaygwOrderStatus,
    currency: s(r.currency),
    total: s(r.total),
    gatewaySlug: sn(r.gateway_slug),
    customerEmail: sn(r.customer_email),
    proofSubmittedAt: r.proof_submitted_at ? new Date(s(r.proof_submitted_at)) : null,
    workspace: ws(r),
  };
}

const LIST_COLS = sql`
  o.id AS oid, o.uuid, o.order_number, o.created_at, o.kind, o.plan_slug, o.description, o.billing_period, o.status, o.currency,
  COALESCE(NULLIF(o.total_amount, 0), o.amount)::text AS total, o.gateway_slug, o.customer_email, o.proof_submitted_at,
  org.uuid AS ws_uuid, org.name AS ws_name, org.slug AS ws_slug, p.name AS plan_name, ${TYPE_EXPR} AS otype`;

export interface Money {
  count: number;
  sum: string;
}

@Injectable()
export class AdminBillingRepository {
  /** Units of the reporting currency per one base unit (1 when the currency has no row). */
  async rateOf(tx: Tx, currency: string): Promise<string> {
    const res = await tx.execute(
      sql`SELECT exchange_rate::text AS r FROM currencies WHERE code = ${currency}`,
    );
    const r = (res.rows[0] as Raw | undefined)?.r;
    return r && Number(r) > 0 ? s(r) : '1';
  }

  async rateMap(tx: Tx): Promise<Map<string, string>> {
    const res = await tx.execute(sql`SELECT code, exchange_rate::text AS r FROM currencies`);
    return new Map((res.rows as Raw[]).map((r) => [s(r.code), s(r.r)]));
  }

  // ---- order history ---------------------------------------------------------------------------------------------------

  async listOrders(
    tx: Tx,
    f: { from: Date; to: Date; type: OrderTypeFilter; q?: string; limit: number; offset: number },
  ): Promise<{ rows: OrderListRow[]; total: number }> {
    const where: SQL[] = [];
    if (f.type === 'new' || f.type === 'upgrade' || f.type === 'downgrade')
      where.push(sql`t.otype = ${f.type}`);
    if (f.type === 'addon') where.push(sql`t.otype IN ('addon', 'wallet_topup')`);
    if (f.type === 'cancel') where.push(sql`t.status IN ${LOST}`);
    if (f.q) {
      const like = likeOf(f.q);
      where.push(
        sql`(t.order_number ILIKE ${like} OR t.customer_email ILIKE ${like} OR t.ws_name ILIKE ${like} OR t.plan_name ILIKE ${like})`,
      );
    }
    const res = await tx.execute(sql`
      WITH t AS (
        SELECT ${LIST_COLS} ${FROM_TYPED}
        WHERE o.created_at BETWEEN ${iso(f.from)}::timestamptz AND ${iso(f.to)}::timestamptz
      )
      SELECT t.*, count(*) OVER () AS total_rows FROM t
      ${where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``}
      ORDER BY t.created_at DESC, t.oid DESC
      LIMIT ${f.limit} OFFSET ${f.offset}`);
    const rows = res.rows as Raw[];
    return { rows: rows.map(toListRow), total: rows[0] ? Number(rows[0].total_rows) : 0 };
  }

  /** One page past the end still needs the total: the count with the same filters and no paging. */
  async countOrders(
    tx: Tx,
    f: { from: Date; to: Date; type: OrderTypeFilter; q?: string },
  ): Promise<number> {
    const r = await this.listOrders(tx, { ...f, limit: 1, offset: 0 });
    return r.total;
  }

  async orderKpis(
    tx: Tx,
    r: { from: Date; to: Date; prevFrom: Date; prevTo: Date },
    rate: string,
  ): Promise<{
    total: number;
    prevTotal: number;
    upgrades: Money;
    downgrades: Money;
    addons: Money;
    cancellations: Money;
  }> {
    const money = baseAmount(rate);
    const counts = await tx.execute(sql`
      SELECT
        count(*) FILTER (WHERE created_at BETWEEN ${iso(r.from)}::timestamptz AND ${iso(r.to)}::timestamptz)::int AS total,
        count(*) FILTER (WHERE created_at BETWEEN ${iso(r.prevFrom)}::timestamptz AND ${iso(r.prevTo)}::timestamptz)::int AS prev_total
      FROM orders
      WHERE created_at BETWEEN ${iso(r.prevFrom)}::timestamptz AND ${iso(r.to)}::timestamptz`);
    const c = (counts.rows[0] ?? {}) as Raw;
    const res = await tx.execute(sql`
      WITH x AS (
        SELECT o.status, o.kind, o.paid_at, o.updated_at, ${TYPE_EXPR} AS otype, ${money} AS amt
        ${FROM_TYPED}
        WHERE (o.status = 'paid' AND o.paid_at BETWEEN ${iso(r.from)}::timestamptz AND ${iso(r.to)}::timestamptz)
           OR (o.status IN ${LOST} AND o.updated_at BETWEEN ${iso(r.from)}::timestamptz AND ${iso(r.to)}::timestamptz)
      )
      SELECT
        count(*) FILTER (WHERE status = 'paid' AND otype IN ('new', 'upgrade'))::int AS up_n,
        COALESCE(sum(amt) FILTER (WHERE status = 'paid' AND otype IN ('new', 'upgrade')), 0)::text AS up_s,
        count(*) FILTER (WHERE status = 'paid' AND otype = 'downgrade')::int AS down_n,
        COALESCE(sum(amt) FILTER (WHERE status = 'paid' AND otype = 'downgrade'), 0)::text AS down_s,
        count(*) FILTER (WHERE status = 'paid' AND otype IN ('addon', 'wallet_topup'))::int AS add_n,
        COALESCE(sum(amt) FILTER (WHERE status = 'paid' AND otype IN ('addon', 'wallet_topup')), 0)::text AS add_s,
        count(*) FILTER (WHERE status IN ${LOST})::int AS can_n,
        COALESCE(sum(amt) FILTER (WHERE status IN ${LOST}), 0)::text AS can_s
      FROM x`);
    const k = (res.rows[0] ?? {}) as Raw;
    return {
      total: Number(c.total ?? 0),
      prevTotal: Number(c.prev_total ?? 0),
      upgrades: { count: Number(k.up_n ?? 0), sum: s(k.up_s ?? '0') },
      downgrades: { count: Number(k.down_n ?? 0), sum: s(k.down_s ?? '0') },
      addons: { count: Number(k.add_n ?? 0), sum: s(k.add_s ?? '0') },
      cancellations: { count: Number(k.can_n ?? 0), sum: s(k.can_s ?? '0') },
    };
  }

  async awaitingApproval(tx: Tx): Promise<
    Array<{
      uuid: string;
      orderNumber: string;
      workspaceName: string | null;
      gatewaySlug: string | null;
      currency: string;
      total: string;
      paymentReference: string | null;
      proofNote: string | null;
      hasProof: boolean;
      proofSubmittedAt: Date | null;
    }>
  > {
    const res = await tx.execute(sql`
      SELECT o.uuid, o.order_number, org.name AS ws_name, o.gateway_slug, o.currency,
             COALESCE(NULLIF(o.total_amount, 0), o.amount)::text AS total, o.payment_reference, o.proof_note,
             (o.payment_proof_path IS NOT NULL) AS has_proof, o.proof_submitted_at
      FROM orders o LEFT JOIN organizations org ON org.id = o.org_id
      WHERE o.status IN ${OPEN} AND o.proof_submitted_at IS NOT NULL
      ORDER BY o.proof_submitted_at DESC
      LIMIT 50`);
    return (res.rows as Raw[]).map((r) => ({
      uuid: s(r.uuid),
      orderNumber: s(r.order_number),
      workspaceName: sn(r.ws_name),
      gatewaySlug: sn(r.gateway_slug),
      currency: s(r.currency),
      total: s(r.total),
      paymentReference: sn(r.payment_reference),
      proofNote: sn(r.proof_note),
      hasProof: r.has_proof === true,
      proofSubmittedAt: r.proof_submitted_at ? new Date(s(r.proof_submitted_at)) : null,
    }));
  }

  async orderAnalytics(
    tx: Tx,
    r: { from: Date; to: Date; prevFrom: Date; prevTo: Date },
    rate: string,
  ) {
    const money = baseAmount(rate);
    const between = (col: SQL, a: Date, b: Date) =>
      sql`${col} BETWEEN ${iso(a)}::timestamptz AND ${iso(b)}::timestamptz`;
    const head = await tx.execute(sql`
      SELECT
        count(*) FILTER (WHERE ${between(sql`o.created_at`, r.from, r.to)})::int AS total,
        count(*) FILTER (WHERE ${between(sql`o.created_at`, r.prevFrom, r.prevTo)})::int AS prev_total,
        count(*) FILTER (WHERE o.status = 'paid' AND ${between(sql`o.paid_at`, r.from, r.to)})::int AS paid_n,
        COALESCE(sum(${money}) FILTER (WHERE o.status = 'paid' AND ${between(sql`o.paid_at`, r.from, r.to)}), 0)::text AS paid_s,
        count(*) FILTER (WHERE o.status IN ${LOST} AND ${between(sql`o.updated_at`, r.from, r.to)})::int AS lost_n,
        COALESCE(sum(${money}) FILTER (WHERE o.status IN ${LOST} AND ${between(sql`o.updated_at`, r.from, r.to)}), 0)::text AS lost_s,
        count(*) FILTER (WHERE o.status = 'paid' AND o.kind IN ('addon', 'wallet_topup') AND ${between(sql`o.paid_at`, r.from, r.to)})::int AS addon_n,
        count(DISTINCT o.org_id) FILTER (WHERE o.status = 'paid' AND ${between(sql`o.paid_at`, r.from, r.to)})::int AS payers
      ${FROM_ORDERS}
      WHERE o.created_at >= ${iso(r.prevFrom)}::timestamptz OR o.paid_at >= ${iso(r.from)}::timestamptz OR o.updated_at >= ${iso(r.from)}::timestamptz`);
    const h = (head.rows[0] ?? {}) as Raw;

    const mix = await tx.execute(sql`
      WITH x AS (
        SELECT o.status, o.kind, ${TYPE_EXPR} AS otype
        ${FROM_TYPED}
        WHERE (o.status = 'paid' AND ${between(sql`o.paid_at`, r.from, r.to)})
           OR (o.status IN ${LOST} AND ${between(sql`o.updated_at`, r.from, r.to)})
      )
      SELECT
        count(*) FILTER (WHERE status = 'paid' AND otype IN ('new', 'renewal', 'upgrade', 'downgrade'))::int AS renewal,
        count(*) FILTER (WHERE status = 'paid' AND otype IN ('addon', 'wallet_topup', 'manual'))::int AS addon,
        count(*) FILTER (WHERE status IN ${LOST})::int AS cancel
      FROM x`);
    const m = (mix.rows[0] ?? {}) as Raw;

    const addons = await tx.execute(sql`
      SELECT COALESCE(NULLIF(o.gateway_slug, ''), 'unknown') AS sku, count(*)::int AS n, sum(${money})::text AS total
      ${FROM_ORDERS}
      WHERE o.status = 'paid' AND o.kind IN ('addon', 'wallet_topup', 'manual') AND ${between(sql`o.paid_at`, r.from, r.to)}
      GROUP BY 1 ORDER BY sum(${money}) DESC LIMIT 5`);

    const signups = await tx.execute(
      sql`SELECT count(*)::int AS n FROM users WHERE ${between(sql`created_at`, r.from, r.to)}`,
    );

    const countries = await tx.execute(sql`
      SELECT btrim(o.billing_country) AS country, count(*)::int AS n
      FROM orders o
      WHERE o.status = 'paid' AND ${between(sql`o.paid_at`, r.from, r.to)} AND btrim(COALESCE(o.billing_country, '')) <> ''
      GROUP BY 1 ORDER BY n DESC, 1 LIMIT 6`);

    return {
      total: Number(h.total ?? 0),
      prevTotal: Number(h.prev_total ?? 0),
      paidCount: Number(h.paid_n ?? 0),
      paidSum: s(h.paid_s ?? '0'),
      lostCount: Number(h.lost_n ?? 0),
      lostSum: s(h.lost_s ?? '0'),
      addonCount: Number(h.addon_n ?? 0),
      payers: Number(h.payers ?? 0),
      mix: {
        renewal: Number(m.renewal ?? 0),
        addon: Number(m.addon ?? 0),
        cancel: Number(m.cancel ?? 0),
      },
      addons: (addons.rows as Raw[]).map((x) => ({
        sku: s(x.sku),
        count: Number(x.n),
        total: s(x.total),
      })),
      signups: Number((signups.rows[0] as Raw | undefined)?.n ?? 0),
      countries: (countries.rows as Raw[]).map((x) => ({
        country: s(x.country),
        count: Number(x.n),
      })),
    };
  }

  /** Paid and lost order counts per day, for the motion chart; the service folds the days into the window's buckets. */
  async motionByDay(
    tx: Tx,
    from: Date,
    to: Date,
  ): Promise<{ paid: Map<string, number>; lost: Map<string, number> }> {
    const res = await tx.execute(sql`
      SELECT 'paid' AS k, to_char(o.paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n
      FROM orders o WHERE o.status = 'paid' AND o.paid_at BETWEEN ${iso(from)}::timestamptz AND ${iso(to)}::timestamptz GROUP BY 2
      UNION ALL
      SELECT 'lost', to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), count(*)::int
      FROM orders o WHERE o.status IN ${LOST} AND o.updated_at BETWEEN ${iso(from)}::timestamptz AND ${iso(to)}::timestamptz GROUP BY 2`);
    const paid = new Map<string, number>();
    const lost = new Map<string, number>();
    for (const r of res.rows as Raw[]) (r.k === 'paid' ? paid : lost).set(s(r.d), Number(r.n));
    return { paid, lost };
  }

  /** Workspaces created per month and how many are still active at each offset (the retention proxy of WaDesk's cohort map). */
  async cohorts(tx: Tx, now: Date, months: number) {
    const out: Array<{ label: string; size: number; cells: Array<number | null> }> = [];
    for (let m = months - 1; m >= 0; m--) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m + 1, 1) - 1);
      const cells: Array<number | null> = [];
      const sizeRes = await tx.execute(
        sql`SELECT count(*)::int AS n FROM organizations WHERE created_at BETWEEN ${iso(start)}::timestamptz AND ${iso(end)}::timestamptz`,
      );
      const size = Number((sizeRes.rows[0] as Raw | undefined)?.n ?? 0);
      for (let k = 0; k < months; k++) {
        const at = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1 + k, 1) - 1);
        if (k > m || at.getTime() > now.getTime()) {
          cells.push(null);
          continue;
        }
        if (size === 0) {
          cells.push(0);
          continue;
        }
        // An organization with no end date is alive; a closed one counts as alive until the moment it was last changed.
        const alive = await tx.execute(sql`
          SELECT count(*)::int AS n FROM organizations
          WHERE created_at BETWEEN ${iso(start)}::timestamptz AND ${iso(end)}::timestamptz
            AND (status NOT IN ('deleted', 'closed') OR updated_at > ${iso(at)}::timestamptz)`);
        cells.push(Math.round((Number((alive.rows[0] as Raw | undefined)?.n ?? 0) / size) * 100));
      }
      out.push({
        label: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][start.getUTCMonth()]} ${start.getUTCFullYear()}`,
        size,
        cells,
      });
    }
    return out;
  }

  // ---- billing history -------------------------------------------------------------------------------------------------

  private statusSql(status: BillingStatusFilter): SQL | null {
    if (status === 'all') return null;
    if (status === 'paid') return sql`o.status = 'paid'`;
    if (status === 'refunded') return sql`o.status = 'refunded'`;
    // WaDesk's admin "cancel" wrote status failed, so a cancelled order stays in the Failed bucket here too.
    if (status === 'failed') return sql`o.status IN ('failed', 'cancelled')`;
    return sql`o.status IN ${OPEN}`;
  }

  async listEvents(
    tx: Tx,
    f: {
      from: Date;
      to: Date;
      status: BillingStatusFilter;
      gateway?: string;
      q?: string;
      limit: number;
      offset: number;
    },
  ) {
    const where: SQL[] = [
      sql`o.created_at BETWEEN ${iso(f.from)}::timestamptz AND ${iso(f.to)}::timestamptz`,
    ];
    const st = this.statusSql(f.status);
    if (st) where.push(st);
    if (f.gateway) where.push(sql`o.gateway_slug = ${f.gateway}`);
    if (f.q) {
      const like = likeOf(f.q);
      where.push(
        sql`(o.order_number ILIKE ${like} OR o.customer_name ILIKE ${like} OR o.customer_email ILIKE ${like} OR org.name ILIKE ${like} OR org.slug ILIKE ${like})`,
      );
    }
    const res = await tx.execute(sql`
      SELECT o.id AS oid, o.uuid, o.order_number, o.created_at, o.customer_email, o.customer_name, o.gateway_slug, o.status,
             o.currency, COALESCE(NULLIF(o.total_amount, 0), o.amount)::text AS total,
             org.uuid AS ws_uuid, org.name AS ws_name, org.slug AS ws_slug, p.name AS plan_name,
             count(*) OVER () AS total_rows
      FROM orders o
      LEFT JOIN organizations org ON org.id = o.org_id
      LEFT JOIN plans p ON p.slug = o.plan_slug
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${f.limit} OFFSET ${f.offset}`);
    const rows = res.rows as Raw[];
    return {
      total: rows[0] ? Number(rows[0].total_rows) : 0,
      rows: rows.map((r) => ({
        uuid: s(r.uuid),
        orderNumber: s(r.order_number),
        createdAt: new Date(s(r.created_at)),
        customerEmail: sn(r.customer_email),
        customerName: sn(r.customer_name),
        gatewaySlug: sn(r.gateway_slug),
        planName: sn(r.plan_name),
        status: r.status as PaygwOrderStatus,
        currency: s(r.currency),
        total: s(r.total),
        workspace: ws(r),
      })),
    };
  }

  async gatewaySlugs(tx: Tx): Promise<string[]> {
    const res = await tx.execute(
      sql`SELECT DISTINCT gateway_slug FROM orders WHERE gateway_slug IS NOT NULL ORDER BY 1`,
    );
    return (res.rows as Raw[]).map((r) => s(r.gateway_slug));
  }

  /** Money and counts by outcome for a window: paid by paid_at, failed and refunded by updated_at (WaDesk's columns). */
  async outcomeTotals(
    tx: Tx,
    r: { from: Date; to: Date },
    rate: string,
  ): Promise<{ paid: Money; failed: Money; refunded: Money }> {
    const money = baseAmount(rate);
    const res = await tx.execute(sql`
      SELECT
        count(*) FILTER (WHERE o.status = 'paid' AND o.paid_at BETWEEN ${iso(r.from)}::timestamptz AND ${iso(r.to)}::timestamptz)::int AS paid_n,
        COALESCE(sum(${money}) FILTER (WHERE o.status = 'paid' AND o.paid_at BETWEEN ${iso(r.from)}::timestamptz AND ${iso(r.to)}::timestamptz), 0)::text AS paid_s,
        count(*) FILTER (WHERE o.status IN ('failed', 'cancelled') AND o.updated_at BETWEEN ${iso(r.from)}::timestamptz AND ${iso(r.to)}::timestamptz)::int AS failed_n,
        COALESCE(sum(${money}) FILTER (WHERE o.status IN ('failed', 'cancelled') AND o.updated_at BETWEEN ${iso(r.from)}::timestamptz AND ${iso(r.to)}::timestamptz), 0)::text AS failed_s,
        count(*) FILTER (WHERE o.status = 'refunded' AND o.updated_at BETWEEN ${iso(r.from)}::timestamptz AND ${iso(r.to)}::timestamptz)::int AS ref_n,
        COALESCE(sum(${money}) FILTER (WHERE o.status = 'refunded' AND o.updated_at BETWEEN ${iso(r.from)}::timestamptz AND ${iso(r.to)}::timestamptz), 0)::text AS ref_s
      ${FROM_ORDERS}
      WHERE o.paid_at >= ${iso(r.from)}::timestamptz OR o.updated_at >= ${iso(r.from)}::timestamptz`);
    const k = (res.rows[0] ?? {}) as Raw;
    return {
      paid: { count: Number(k.paid_n ?? 0), sum: s(k.paid_s ?? '0') },
      failed: { count: Number(k.failed_n ?? 0), sum: s(k.failed_s ?? '0') },
      refunded: { count: Number(k.ref_n ?? 0), sum: s(k.ref_s ?? '0') },
    };
  }

  async grossOf(tx: Tx, r: { from: Date; to: Date }, rate: string): Promise<number> {
    const t = await this.outcomeTotals(tx, r, rate);
    return Number(t.paid.sum);
  }

  /** Per-day sums of charges (paid_at), refunds and failures (updated_at), folded into the window's buckets by the caller. */
  async trendByDay(tx: Tx, from: Date, to: Date, rate: string) {
    const money = baseAmount(rate);
    const res = await tx.execute(sql`
      SELECT 'charges' AS k, to_char(o.paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, sum(${money})::text AS v
      ${FROM_ORDERS} WHERE o.status = 'paid' AND o.paid_at BETWEEN ${iso(from)}::timestamptz AND ${iso(to)}::timestamptz GROUP BY 2
      UNION ALL
      SELECT 'refunds', to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), sum(${money})::text
      ${FROM_ORDERS} WHERE o.status = 'refunded' AND o.updated_at BETWEEN ${iso(from)}::timestamptz AND ${iso(to)}::timestamptz GROUP BY 2
      UNION ALL
      SELECT 'failed', to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), sum(${money})::text
      ${FROM_ORDERS} WHERE o.status IN ('failed', 'cancelled') AND o.updated_at BETWEEN ${iso(from)}::timestamptz AND ${iso(to)}::timestamptz GROUP BY 2`);
    const out = {
      charges: new Map<string, number>(),
      refunds: new Map<string, number>(),
      failed: new Map<string, number>(),
    };
    for (const r of res.rows as Raw[])
      out[r.k as 'charges' | 'refunds' | 'failed'].set(s(r.d), Number(r.v));
    return out;
  }

  async gatewayMix(tx: Tx, r: { from: Date; to: Date }, rate: string) {
    const money = baseAmount(rate);
    const res = await tx.execute(sql`
      SELECT o.gateway_slug AS slug, sum(${money})::text AS v
      ${FROM_ORDERS}
      WHERE o.status = 'paid' AND o.gateway_slug IS NOT NULL AND o.paid_at BETWEEN ${iso(r.from)}::timestamptz AND ${iso(r.to)}::timestamptz
      GROUP BY 1 ORDER BY sum(${money}) DESC`);
    return (res.rows as Raw[]).map((x) => ({ slug: s(x.slug), value: Number(x.v) }));
  }

  async statusMix(tx: Tx, r: { from: Date; to: Date }) {
    const res = await tx.execute(sql`
      SELECT status, count(*)::int AS n FROM orders
      WHERE created_at BETWEEN ${iso(r.from)}::timestamptz AND ${iso(r.to)}::timestamptz GROUP BY 1 ORDER BY 2 DESC`);
    return (res.rows as Raw[]).map((x) => ({ status: s(x.status), value: Number(x.n) }));
  }

  async topPayers(tx: Tx, r: { from: Date; to: Date }, rate: string) {
    const money = baseAmount(rate);
    const res = await tx.execute(sql`
      SELECT org.uuid AS ws_uuid, org.name AS ws_name, org.slug AS ws_slug, count(*)::int AS n, sum(${money})::text AS v
      ${FROM_ORDERS}
      WHERE o.status = 'paid' AND o.paid_at BETWEEN ${iso(r.from)}::timestamptz AND ${iso(r.to)}::timestamptz
      GROUP BY org.uuid, org.name, org.slug ORDER BY sum(${money}) DESC LIMIT 10`);
    return (res.rows as Raw[]).map((x) => ({
      workspace: ws(x),
      orders: Number(x.n),
      total: s(x.v),
    }));
  }

  // ---- invoices --------------------------------------------------------------------------------------------------------

  async listInvoices(
    tx: Tx,
    f: {
      from: Date;
      to: Date;
      status: string;
      overdueBefore: Date;
      q?: string;
      limit: number;
      offset: number;
    },
  ) {
    const where: SQL[] = [
      sql`o.created_at BETWEEN ${iso(f.from)}::timestamptz AND ${iso(f.to)}::timestamptz`,
    ];
    if (f.status === 'paid') where.push(sql`o.status = 'paid'`);
    if (f.status === 'outstanding') where.push(sql`o.status IN ${OPEN}`);
    if (f.status === 'overdue') {
      where.push(
        sql`o.status IN ${OPEN}`,
        sql`o.created_at < ${iso(f.overdueBefore)}::timestamptz`,
      );
    }
    if (f.status === 'refunded') where.push(sql`o.status = 'refunded'`);
    if (f.status === 'void') where.push(sql`o.status IN ('failed', 'cancelled')`);
    if (f.q) {
      const like = likeOf(f.q);
      where.push(
        sql`(o.order_number ILIKE ${like} OR o.customer_email ILIKE ${like} OR org.name ILIKE ${like})`,
      );
    }
    const res = await tx.execute(sql`
      SELECT o.id AS oid, o.uuid, o.order_number, o.created_at, o.kind, o.description, o.status, o.currency, o.billing_period,
             COALESCE(NULLIF(o.total_amount, 0), o.amount)::text AS total,
             org.uuid AS ws_uuid, org.name AS ws_name, org.slug AS ws_slug, p.name AS plan_name, p.billing_unit AS plan_unit,
             ow.full_name AS owner_name, ow.email::text AS owner_email, count(*) OVER () AS total_rows
      FROM orders o
      LEFT JOIN organizations org ON org.id = o.org_id
      LEFT JOIN plans p ON p.slug = o.plan_slug
      LEFT JOIN users ow ON ow.org_id = o.org_id AND ow.id = o.user_id
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${f.limit} OFFSET ${f.offset}`);
    const rows = res.rows as Raw[];
    return {
      total: rows[0] ? Number(rows[0].total_rows) : 0,
      rows: rows.map((r) => ({
        uuid: s(r.uuid),
        number: s(r.order_number),
        createdAt: new Date(s(r.created_at)),
        kind: s(r.kind),
        description: sn(r.description),
        status: r.status as PaygwOrderStatus,
        currency: s(r.currency),
        total: s(r.total),
        planName: sn(r.plan_name),
        planUnit: sn(r.plan_unit),
        billingPeriod: (sn(r.billing_period) as 'monthly' | 'yearly' | null) ?? null,
        ownerName: sn(r.owner_name),
        ownerEmail: sn(r.owner_email),
        workspace: ws(r),
      })),
    };
  }

  async invoiceKpis(tx: Tx, now: Date, overdueBefore: Date, rate: string) {
    const money = baseAmount(rate);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevEnd = new Date(monthStart.getTime() - 1);
    const res = await tx.execute(sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE o.status = 'paid')::int AS paid,
        count(*) FILTER (WHERE o.status IN ${OPEN})::int AS pending,
        count(*) FILTER (WHERE o.status IN ${OPEN} AND o.created_at < ${iso(overdueBefore)}::timestamptz)::int AS overdue,
        COALESCE(sum(${money}) FILTER (WHERE o.status IN ${OPEN}), 0)::text AS pending_sum,
        COALESCE(sum(${money}) FILTER (WHERE o.status = 'paid' AND o.paid_at BETWEEN ${iso(monthStart)}::timestamptz AND ${iso(endOfDayUtc(now))}::timestamptz), 0)::text AS month_sum,
        COALESCE(sum(${money}) FILTER (WHERE o.status = 'paid' AND o.paid_at BETWEEN ${iso(prevStart)}::timestamptz AND ${iso(prevEnd)}::timestamptz), 0)::text AS prev_sum
      ${FROM_ORDERS}`);
    const k = (res.rows[0] ?? {}) as Raw;
    return {
      total: Number(k.total ?? 0),
      paid: Number(k.paid ?? 0),
      pending: Number(k.pending ?? 0),
      overdue: Number(k.overdue ?? 0),
      pendingSum: s(k.pending_sum ?? '0'),
      monthSum: s(k.month_sum ?? '0'),
      prevSum: s(k.prev_sum ?? '0'),
    };
  }

  async workspaceChoices(tx: Tx): Promise<Array<{ id: string; name: string; slug: string }>> {
    const res = await tx.execute(
      sql`SELECT uuid, name, slug FROM organizations ORDER BY name LIMIT 1000`,
    );
    return (res.rows as Raw[]).map((r) => ({ id: s(r.uuid), name: s(r.name), slug: s(r.slug) }));
  }

  /** The organization and its owner user (settings.ownerUserId holds the user's uuid) for a manual invoice. */
  async workspaceForInvoice(tx: Tx, uuid: string) {
    const res = await tx.execute(sql`
      SELECT o.id, o.name, u.id AS owner_id, u.email::text AS owner_email, u.full_name AS owner_name
      FROM organizations o
      LEFT JOIN users u ON u.org_id = o.id AND u.uuid::text = o.settings ->> 'ownerUserId'
      WHERE o.uuid = ${uuid}`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          orgId: Number(r.id),
          name: s(r.name),
          ownerId: r.owner_id === null ? null : Number(r.owner_id),
          ownerEmail: sn(r.owner_email),
          ownerName: sn(r.owner_name),
        }
      : null;
  }

  async insertManual(
    tx: Tx,
    o: {
      orgId: number;
      userId: number | null;
      orderNumber: string;
      currency: string;
      amount: string;
      status: 'pending' | 'paid';
      issuedAt: Date;
      customerName: string | null;
      customerEmail: string | null;
      description: string;
      issuedBy: number;
    },
  ): Promise<{ id: number; uuid: string }> {
    const paid = o.status === 'paid';
    const res = await tx.execute(sql`
      INSERT INTO orders (org_id, user_id, order_number, kind, plan_slug, billing_period, auto_renew, gateway_slug, currency, amount,
        discount_amount, tax_rate, tax_amount, total_amount, customer_name, customer_email, status, paid_at, description,
        gateway_payload, created_at)
      VALUES (${o.orgId}, ${o.userId}, ${o.orderNumber}, 'manual', NULL, 'monthly', false, 'manual', ${o.currency}, ${o.amount},
        0, 0, 0, ${o.amount}, ${o.customerName}, ${o.customerEmail}, ${o.status},
        ${paid ? iso(o.issuedAt) : null}::timestamptz, ${o.description},
        ${JSON.stringify({ manual: true, issuedBy: o.issuedBy })}::jsonb, ${iso(o.issuedAt)}::timestamptz)
      RETURNING id, uuid`);
    const r = res.rows[0] as Raw;
    return { id: Number(r.id), uuid: s(r.uuid) };
  }

  // ---- one order for the actions and the invoice view ------------------------------------------------------------------

  async lockByUuid(tx: Tx, uuid: string) {
    const res = await tx.execute(sql`
      SELECT o.id, o.org_id, o.uuid, o.order_number, o.status, o.kind, o.currency,
             COALESCE(NULLIF(o.total_amount, 0), o.amount)::text AS total, o.gateway_slug, o.payment_reference,
             o.total_amount::text AS total_amount_raw, o.paid_at
      FROM orders o WHERE o.uuid = ${uuid} FOR UPDATE`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          id: Number(r.id),
          orgId: Number(r.org_id),
          uuid: s(r.uuid),
          orderNumber: s(r.order_number),
          status: r.status as PaygwOrderStatus,
          kind: s(r.kind) as 'plan' | 'addon' | 'wallet_topup' | 'manual',
          currency: s(r.currency),
          total: s(r.total),
          gatewaySlug: sn(r.gateway_slug),
          paymentReference: sn(r.payment_reference),
          paidAt: r.paid_at ? new Date(s(r.paid_at)) : null,
        }
      : null;
  }

  async setStatus(
    tx: Tx,
    id: number,
    status: PaygwOrderStatus,
    fields: { failureReason?: string | null; reviewNote?: string | null; paidAt?: boolean },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE orders SET status = ${status},
        failure_reason = ${fields.failureReason ?? null},
        review_note = COALESCE(${fields.reviewNote ?? null}, review_note),
        reviewed_at = now(),
        paid_at = CASE WHEN ${fields.paidAt === true} THEN COALESCE(paid_at, now()) ELSE paid_at END
      WHERE id = ${id}`);
  }

  async deleteOrder(tx: Tx, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM orders WHERE id = ${id}`);
  }

  async invoiceDetail(tx: Tx, uuid: string) {
    const res = await tx.execute(sql`
      SELECT o.uuid, o.order_number, o.created_at, o.paid_at, o.status, o.kind, o.plan_slug, o.billing_period, o.currency,
             o.amount::text AS amount, o.discount_amount::text AS discount_amount, o.tax_rate::text AS tax_rate,
             o.tax_amount::text AS tax_amount, o.total_amount::text AS total_amount, o.coupon_code, o.gateway_slug,
             o.gateway_payment_id, o.payment_reference, o.customer_name, o.customer_email, o.billing_company, o.billing_address,
             o.billing_city, o.billing_postal, o.billing_country, o.billing_tax_id, o.description,
             org.uuid AS ws_uuid, org.name AS ws_name, org.slug AS ws_slug,
             p.name AS plan_name, p.billing_unit AS plan_unit,
             ow.full_name AS owner_name, ow.email::text AS owner_email
      FROM orders o
      LEFT JOIN organizations org ON org.id = o.org_id
      LEFT JOIN plans p ON p.slug = o.plan_slug
      LEFT JOIN users ow ON ow.org_id = o.org_id AND ow.id = o.user_id
      WHERE o.uuid = ${uuid}`);
    return (res.rows[0] as Raw | undefined) ?? null;
  }

  // ---- CSV export (capped) ---------------------------------------------------------------------------------------------

  async exportOrders(
    tx: Tx,
    f: { from: Date; to: Date; type: OrderTypeFilter; q?: string },
    cap: number,
  ): Promise<OrderListRow[]> {
    const r = await this.listOrders(tx, { ...f, limit: cap, offset: 0 });
    return r.rows;
  }
}

function endOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 86_399_999);
}
