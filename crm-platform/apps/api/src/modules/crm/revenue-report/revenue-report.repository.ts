import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { RevenueGroup } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

/** A half-open window of instants: [from, to). */
export interface Span {
  from: Date;
  to: Date;
}

/** The same window as inclusive local dates, for the columns that are dates (`issue_date`). */
export interface DateSpan {
  from: string;
  to: string;
}

/** What every query shares. Ids are internal; scopes are conditions on the aliases each query documents. */
export interface RevenueFilter {
  orgId: number;
  ownerId?: number;
  teamId?: number;
  currency?: string;
}

/** `invoices` -> alias `i` (the invoice scope); `payments` -> aliases `p` and `i` (the payment scope). */
export interface RevenueScopes {
  invoices?: SQL;
  payments?: SQL;
}

/** One group of one currency in one window. Amounts are minor units; the SQL already allocated product shares. */
export interface CohortRow {
  win: 'cur' | 'prev';
  currency: string;
  key: string | null;
  label: string | null;
  id: string | null;
  invoices: number;
  invoiced: bigint;
  credited: bigint;
  paid: bigint;
  outstanding: bigint;
  overdue: bigint;
}

export interface CashRow {
  win: 'cur' | 'prev';
  currency: string;
  key: string | null;
  label: string | null;
  id: string | null;
  collected: bigint;
  refunded: bigint;
}

export interface LedgerRow {
  id: number;
  paidAt: Date;
  paidAtText: string;
  /** `YYYY-MM-DD HH:mm` in the zone the file is cut in. */
  paidLocal: string;
  kind: 'payment' | 'refund';
  amount: bigint;
  currency: string;
  method: string;
  source: string;
  invoiceNumber: string | null;
  contactName: string | null;
  companyName: string | null;
  reference: string | null;
  receiptNumber: string | null;
  ownerName: string | null;
}

const iso = (d: Date) => d.toISOString();
const big = (v: unknown): bigint => (v == null ? 0n : BigInt(v as string));
const int = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string | null => (v == null ? null : String(v));

const where = (conds: Array<SQL | undefined>): SQL =>
  sql.join(
    conds.filter((c): c is SQL => c !== undefined),
    sql` AND `,
  );

/** Members of a team, as a sub-select over `team_members`. */
const teamMembers = (orgId: number, teamId: number) =>
  sql`(SELECT tm.user_id FROM team_members tm WHERE tm.org_id = ${orgId} AND tm.team_id = ${teamId})`;

/** The filters of the screen on an invoice (`i.owner_id`, `i.currency`) or a payment (`p.currency`, its invoice's owner). */
function filterConds(f: RevenueFilter, currencyCol: SQL): SQL[] {
  const out: SQL[] = [];
  if (f.ownerId !== undefined) out.push(sql`i.owner_id = ${f.ownerId}`);
  if (f.teamId !== undefined) out.push(sql`i.owner_id IN ${teamMembers(f.orgId, f.teamId)}`);
  if (f.currency !== undefined) out.push(sql`${currencyCol} = ${f.currency}`);
  return out;
}

/** An issued invoice that counts as revenue: drafts and voided are not issued, a proforma is a quote of an invoice, not an invoice. */
const REVENUE_INVOICE = sql`i.status = 'issued' AND i.doc_type <> 'proforma'`;

/**
 * How one grouping reads the facts. `weight` is 1 except for products, where an invoice is spread over its lines in proportion to
 * what each line is worth (so a document discount, shipping and rounding follow the lines and the rows add up to the invoice).
 * The same fragments serve invoices (`i`) and payments (`p` with a LEFT JOINed `i`): a payment on no invoice has a NULL `i`.
 */
interface DimSql {
  joins: SQL;
  key: SQL;
  label: SQL;
  id: SQL;
  weight: SQL;
}

function dimSql(dim: RevenueGroup | 'none', side: 'invoice' | 'payment'): DimSql {
  const nulls = {
    joins: sql``,
    key: sql`NULL::text`,
    label: sql`NULL::text`,
    id: sql`NULL::text`,
    weight: sql`1::numeric`,
  };
  switch (dim) {
    case 'none':
      return nulls;
    case 'origin':
      return { ...nulls, key: sql`i.source` };
    case 'source': {
      const contact =
        side === 'payment' ? sql`coalesce(i.contact_id, p.contact_id)` : sql`i.contact_id`;
      return {
        ...nulls,
        joins: sql`LEFT JOIN contacts c ON c.org_id = ${side === 'payment' ? sql`p.org_id` : sql`i.org_id`} AND c.id = ${contact}`,
        key: sql`nullif(btrim(c.source), '')`,
        label: sql`nullif(btrim(c.source), '')`,
      };
    }
    case 'owner':
      return {
        ...nulls,
        joins: sql`LEFT JOIN users ou ON ou.org_id = i.org_id AND ou.id = i.owner_id`,
        key: sql`ou.uuid::text`,
        label: sql`ou.full_name`,
        id: sql`ou.uuid::text`,
      };
    case 'team':
      return {
        ...nulls,
        joins: sql`LEFT JOIN team_members otm ON otm.org_id = i.org_id AND otm.user_id = i.owner_id
                   LEFT JOIN teams ot ON ot.org_id = otm.org_id AND ot.id = otm.team_id`,
        key: sql`ot.uuid::text`,
        label: sql`ot.name`,
        id: sql`ot.uuid::text`,
      };
    case 'product':
      return {
        ...nulls,
        joins: sql`LEFT JOIN LATERAL (
          SELECT g.pkey, g.plabel,
                 CASE WHEN g.tw > 0 THEN g.w::numeric / g.tw ELSE 1::numeric / count(*) OVER () END AS share
          FROM (
            SELECT coalesce(nullif(btrim(li.sku), ''), lower(btrim(li.description))) AS pkey,
                   min(li.description) AS plabel,
                   sum(greatest(li.line_subtotal_minor - li.line_discount_minor
                                + CASE WHEN i.tax_inclusive THEN 0 ELSE li.tax_amount_minor END, 0)) AS w,
                   sum(sum(greatest(li.line_subtotal_minor - li.line_discount_minor
                                    + CASE WHEN i.tax_inclusive THEN 0 ELSE li.tax_amount_minor END, 0))) OVER () AS tw
            FROM invoice_items li
            WHERE li.org_id = i.org_id AND li.invoice_id = i.id
            GROUP BY 1
          ) g
        ) ps ON true`,
        key: sql`ps.pkey`,
        label: sql`ps.plabel`,
        weight: sql`coalesce(ps.share, 1::numeric)`,
      };
  }
}

/** Grouped, index-friendly reads behind the revenue report. Everything is aggregated in SQL; nothing is paged in memory. */
@Injectable()
export class RevenueReportRepository {
  /**
   * Invoices ISSUED in a window, by group and currency: what was invoiced, credited, paid so far (net of refunds), still owed now and
   * the part of that past its due date. A window is two dates, because an invoice has a day it is dated, not an instant.
   */
  async cohort(
    tx: Tx,
    f: RevenueFilter,
    scope: SQL | undefined,
    dim: RevenueGroup | 'none',
    cur: DateSpan,
    prev: DateSpan | null,
    today: string,
  ): Promise<CohortRow[]> {
    const d = dimSql(dim, 'invoice');
    const inCur = sql`i.issue_date >= ${cur.from}::date AND i.issue_date <= ${cur.to}::date`;
    const inPrev = prev
      ? sql`i.issue_date >= ${prev.from}::date AND i.issue_date <= ${prev.to}::date`
      : sql`false`;
    const owed = sql`greatest(i.total_minor - i.paid_minor - i.credited_minor, 0)`;
    const res = await tx.execute(sql`
      SELECT CASE WHEN ${inCur} THEN 'cur' ELSE 'prev' END AS win, i.currency,
             ${d.key} AS dim_key, ${d.label} AS dim_label, ${d.id} AS dim_id,
             count(DISTINCT i.id)::int AS invoices,
             round(coalesce(sum(i.total_minor * ${d.weight}), 0))::text AS invoiced,
             round(coalesce(sum(i.credited_minor * ${d.weight}), 0))::text AS credited,
             round(coalesce(sum(i.paid_minor * ${d.weight}), 0))::text AS paid,
             round(coalesce(sum(${owed} * ${d.weight}), 0))::text AS outstanding,
             round(coalesce(sum(CASE WHEN i.due_date < ${today}::date THEN ${owed} ELSE 0 END * ${d.weight}), 0))::text AS overdue
      FROM invoices i ${d.joins}
      WHERE ${where([
        sql`i.org_id = ${f.orgId}`,
        REVENUE_INVOICE,
        sql`((${inCur}) OR (${inPrev}))`,
        scope,
        ...filterConds(f, sql`i.currency`),
      ])}
      GROUP BY 1, 2, 3, 4, 5
    `);
    return (res.rows as Raw[]).map((r) => ({
      win: r.win as 'cur' | 'prev',
      currency: r.currency as string,
      key: str(r.dim_key),
      label: str(r.dim_label),
      id: str(r.dim_id),
      invoices: int(r.invoices),
      invoiced: big(r.invoiced),
      credited: big(r.credited),
      paid: big(r.paid),
      outstanding: big(r.outstanding),
      overdue: big(r.overdue),
    }));
  }

  /** Money that CAME IN during a window, by group and currency: payments, and refunds paid out (as a positive amount). */
  async cash(
    tx: Tx,
    f: RevenueFilter,
    scope: SQL | undefined,
    dim: RevenueGroup | 'none',
    cur: Span,
    prev: Span | null,
  ): Promise<CashRow[]> {
    const d = dimSql(dim, 'payment');
    const inCur = sql`p.paid_at >= ${iso(cur.from)}::timestamptz AND p.paid_at < ${iso(cur.to)}::timestamptz`;
    const inPrev = prev
      ? sql`p.paid_at >= ${iso(prev.from)}::timestamptz AND p.paid_at < ${iso(prev.to)}::timestamptz`
      : sql`false`;
    const res = await tx.execute(sql`
      SELECT CASE WHEN ${inCur} THEN 'cur' ELSE 'prev' END AS win, p.currency,
             ${d.key} AS dim_key, ${d.label} AS dim_label, ${d.id} AS dim_id,
             round(coalesce(sum(p.amount_minor * ${d.weight}) FILTER (WHERE p.kind = 'payment'), 0))::text AS collected,
             round(coalesce(-sum(p.amount_minor * ${d.weight}) FILTER (WHERE p.kind = 'refund'), 0))::text AS refunded
      FROM payments p
      LEFT JOIN invoices i ON i.org_id = p.org_id AND i.id = p.invoice_id
      ${d.joins}
      WHERE ${where([
        sql`p.org_id = ${f.orgId}`,
        sql`((${inCur}) OR (${inPrev}))`,
        scope,
        ...filterConds(f, sql`p.currency`),
      ])}
      GROUP BY 1, 2, 3, 4, 5
    `);
    return (res.rows as Raw[]).map((r) => ({
      win: r.win as 'cur' | 'prev',
      currency: r.currency as string,
      key: str(r.dim_key),
      label: str(r.dim_label),
      id: str(r.dim_id),
      collected: big(r.collected),
      refunded: big(r.refunded),
    }));
  }

  /** Invoices that became fully paid in a window: how many, and the tax on them. */
  async paidInFull(
    tx: Tx,
    f: RevenueFilter,
    scope: SQL | undefined,
    cur: Span,
    prev: Span | null,
  ): Promise<Array<{ win: 'cur' | 'prev'; currency: string; invoices: number; tax: bigint }>> {
    const inCur = sql`i.paid_at >= ${iso(cur.from)}::timestamptz AND i.paid_at < ${iso(cur.to)}::timestamptz`;
    const inPrev = prev
      ? sql`i.paid_at >= ${iso(prev.from)}::timestamptz AND i.paid_at < ${iso(prev.to)}::timestamptz`
      : sql`false`;
    const res = await tx.execute(sql`
      SELECT CASE WHEN ${inCur} THEN 'cur' ELSE 'prev' END AS win, i.currency,
             count(*)::int AS invoices, coalesce(sum(i.tax_minor), 0)::text AS tax
      FROM invoices i
      WHERE ${where([
        sql`i.org_id = ${f.orgId}`,
        REVENUE_INVOICE,
        sql`i.payment_status = 'paid'`,
        sql`((${inCur}) OR (${inPrev}))`,
        scope,
        ...filterConds(f, sql`i.currency`),
      ])}
      GROUP BY 1, 2
    `);
    return (res.rows as Raw[]).map((r) => ({
      win: r.win as 'cur' | 'prev',
      currency: r.currency as string,
      invoices: int(r.invoices),
      tax: big(r.tax),
    }));
  }

  /** Every issued invoice not fully paid, as of now: the open balance and the part past due, per currency (the period does not matter). */
  async receivables(
    tx: Tx,
    f: RevenueFilter,
    scope: SQL | undefined,
    today: string,
  ): Promise<Array<{ currency: string; outstanding: bigint; overdue: bigint; invoices: number }>> {
    const owed = sql`greatest(i.total_minor - i.paid_minor - i.credited_minor, 0)`;
    const res = await tx.execute(sql`
      SELECT i.currency, coalesce(sum(${owed}), 0)::text AS outstanding,
             coalesce(sum(${owed}) FILTER (WHERE i.due_date < ${today}::date), 0)::text AS overdue,
             count(*)::int AS invoices
      FROM invoices i
      WHERE ${where([
        sql`i.org_id = ${f.orgId}`,
        REVENUE_INVOICE,
        sql`i.payment_status <> 'paid'`,
        sql`i.total_minor > i.paid_minor + i.credited_minor`,
        scope,
        ...filterConds(f, sql`i.currency`),
      ])}
      GROUP BY i.currency
    `);
    return (res.rows as Raw[]).map((r) => ({
      currency: r.currency as string,
      outstanding: big(r.outstanding),
      overdue: big(r.overdue),
      invoices: int(r.invoices),
    }));
  }

  /** Everything ever collected inside the scope, per currency (Reference's "Collected (all)"). */
  async collectedAllTime(
    tx: Tx,
    f: RevenueFilter,
    scope: SQL | undefined,
  ): Promise<Array<{ currency: string; total: bigint }>> {
    const res = await tx.execute(sql`
      SELECT p.currency, coalesce(sum(p.amount_minor), 0)::text AS total
      FROM payments p LEFT JOIN invoices i ON i.org_id = p.org_id AND i.id = p.invoice_id
      WHERE ${where([
        sql`p.org_id = ${f.orgId}`,
        sql`p.kind = 'payment'`,
        scope,
        ...filterConds(f, sql`p.currency`),
      ])}
      GROUP BY p.currency
    `);
    return (res.rows as Raw[]).map((r) => ({
      currency: r.currency as string,
      total: big(r.total),
    }));
  }

  /** The currencies that occur in the caller's scope, whatever the period or the currency filter. */
  async currencies(
    tx: Tx,
    f: Pick<RevenueFilter, 'orgId' | 'ownerId' | 'teamId'>,
    scopes: RevenueScopes,
  ): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT currency FROM (
        SELECT i.currency FROM invoices i
        WHERE ${where([sql`i.org_id = ${f.orgId}`, REVENUE_INVOICE, scopes.invoices, ...filterConds(f, sql`i.currency`)])}
        UNION
        SELECT p.currency FROM payments p LEFT JOIN invoices i ON i.org_id = p.org_id AND i.id = p.invoice_id
        WHERE ${where([sql`p.org_id = ${f.orgId}`, scopes.payments, ...filterConds(f, sql`p.currency`)])}
      ) c ORDER BY currency
    `);
    return (res.rows as Raw[]).map((r) => r.currency as string);
  }

  /** Invoiced per bucket of the period (the invoice date is a calendar day), per currency. */
  async invoicedTrend(
    tx: Tx,
    f: RevenueFilter,
    scope: SQL | undefined,
    cur: DateSpan,
    bucket: 'day' | 'week' | 'month',
  ): Promise<Array<{ start: string; currency: string; total: bigint }>> {
    const res = await tx.execute(sql`
      SELECT to_char(date_trunc(${bucket}, i.issue_date::timestamp), 'YYYY-MM-DD') AS start, i.currency,
             coalesce(sum(i.total_minor), 0)::text AS total
      FROM invoices i
      WHERE ${where([
        sql`i.org_id = ${f.orgId}`,
        REVENUE_INVOICE,
        sql`i.issue_date >= ${cur.from}::date AND i.issue_date <= ${cur.to}::date`,
        scope,
        ...filterConds(f, sql`i.currency`),
      ])}
      GROUP BY 1, 2
    `);
    return (res.rows as Raw[]).map((r) => ({
      start: r.start as string,
      currency: r.currency as string,
      total: big(r.total),
    }));
  }

  /** Collected per bucket of the period, cut in the viewer's zone, per currency. */
  async collectedTrend(
    tx: Tx,
    f: RevenueFilter,
    scope: SQL | undefined,
    cur: Span,
    tz: string,
    bucket: 'day' | 'week' | 'month',
  ): Promise<Array<{ start: string; currency: string; total: bigint }>> {
    const res = await tx.execute(sql`
      SELECT to_char(date_trunc(${bucket}, p.paid_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS start, p.currency,
             coalesce(sum(p.amount_minor), 0)::text AS total
      FROM payments p LEFT JOIN invoices i ON i.org_id = p.org_id AND i.id = p.invoice_id
      WHERE ${where([
        sql`p.org_id = ${f.orgId}`,
        sql`p.kind = 'payment'`,
        sql`p.paid_at >= ${iso(cur.from)}::timestamptz AND p.paid_at < ${iso(cur.to)}::timestamptz`,
        scope,
        ...filterConds(f, sql`p.currency`),
      ])}
      GROUP BY 1, 2
    `);
    return (res.rows as Raw[]).map((r) => ({
      start: r.start as string,
      currency: r.currency as string,
      total: big(r.total),
    }));
  }

  /**
   * The invoice-side conditions the aging report takes as one scope: the caller's invoice scope with the owner, team, currency and
   * revenue-invoice filters ANDed (the aging query supplies `i.org_id`, status and balance itself).
   */
  invoiceWhere(f: RevenueFilter, scope: SQL | undefined): SQL {
    return where([sql`i.doc_type <> 'proforma'`, scope, ...filterConds(f, sql`i.currency`)]);
  }

  /** The viewer's own zone from their profile, else null (the caller falls back to the workspace's). */
  async profileZone(tx: Tx, orgId: number, userId: number | null): Promise<string | null> {
    if (!userId) return null;
    const res = await tx.execute(
      sql`SELECT timezone FROM user_profiles WHERE org_id = ${orgId} AND user_id = ${userId}`,
    );
    return str((res.rows[0] as Raw | undefined)?.timezone);
  }

  async teamId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM teams WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? int(r.id) : undefined;
  }

  async userId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? int(r.id) : undefined;
  }

  /**
   * The ledger lines of a window, newest first, in keyset pages: Reference's CSV (a payment per line) plus the refunds that its ledger
   * did not have. `after` is the (paid_at, id) of the last line of the previous page.
   */
  async ledgerPage(
    tx: Tx,
    f: RevenueFilter,
    scope: SQL | undefined,
    cur: Span,
    tz: string,
    after: { paidAtText: string; id: number } | null,
    limit: number,
  ): Promise<LedgerRow[]> {
    const res = await tx.execute(sql`
      SELECT p.id, p.paid_at, p.paid_at::text AS paid_at_text,
             to_char(p.paid_at AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI') AS paid_local,
             p.kind, p.amount_minor::text AS amount, p.currency, p.method, p.source,
             i.invoice_number, c.name AS contact_name, co.name AS company_name, p.reference, p.receipt_number,
             ou.full_name AS owner_name
      FROM payments p
      LEFT JOIN invoices i ON i.org_id = p.org_id AND i.id = p.invoice_id
      LEFT JOIN contacts c ON c.org_id = p.org_id AND c.id = coalesce(p.contact_id, i.contact_id)
      LEFT JOIN companies co ON co.org_id = p.org_id AND co.id = coalesce(p.company_id, i.company_id)
      LEFT JOIN users ou ON ou.org_id = i.org_id AND ou.id = i.owner_id
      WHERE ${where([
        sql`p.org_id = ${f.orgId}`,
        sql`p.paid_at >= ${iso(cur.from)}::timestamptz AND p.paid_at < ${iso(cur.to)}::timestamptz`,
        after
          ? sql`(p.paid_at, p.id) < (${after.paidAtText}::timestamptz, ${after.id})`
          : undefined,
        scope,
        ...filterConds(f, sql`p.currency`),
      ])}
      ORDER BY p.paid_at DESC, p.id DESC
      LIMIT ${limit}
    `);
    return (res.rows as Raw[]).map((r) => ({
      id: int(r.id),
      paidAt: new Date(r.paid_at as string),
      paidAtText: r.paid_at_text as string,
      paidLocal: r.paid_local as string,
      kind: r.kind as 'payment' | 'refund',
      amount: big(r.amount),
      currency: r.currency as string,
      method: r.method as string,
      source: r.source as string,
      invoiceNumber: str(r.invoice_number),
      contactName: str(r.contact_name),
      companyName: str(r.company_name),
      reference: str(r.reference),
      receiptNumber: str(r.receipt_number),
      ownerName: str(r.owner_name),
    }));
  }
}
