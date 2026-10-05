import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  AgingBucket,
  ListPaymentsQuery,
  OutstandingQuery,
  PaymentKind,
  PaymentMethod,
  PaymentSource,
  RecordScope,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

export interface PaymentRow {
  id: number;
  uuid: string;
  createdAtIso: string;
  createdAt: Date;
  kind: PaymentKind;
  amountMinor: bigint;
  currency: string;
  method: PaymentMethod;
  source: PaymentSource;
  paidAt: Date;
  paidAtIso: string;
  reference: string | null;
  note: string | null;
  receiptNumber: string | null;
  invoiceId: number | null;
  invoiceUuid: string | null;
  invoiceNumber: string | null;
  contactId: number | null;
  contactUuid: string | null;
  contactName: string | null;
  refundOfId: number | null;
  refundOfUuid: string | null;
  refundOfReceipt: string | null;
  refundedMinor: bigint;
  recordedById: number | null;
  recordedByUuid: string | null;
  recordedByName: string | null;
}

type Raw = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const big = (v: unknown): bigint => BigInt(v as string | number);
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const todayExpr = (tz: string) => sql`(now() AT TIME ZONE ${tz})::date`;

const SELECT = sql`
  SELECT p.id, p.uuid, p.created_at, to_char(p.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso,
         p.kind, p.amount_minor::text, p.currency, p.method, p.source, p.paid_at,
         to_char(p.paid_at at time zone 'UTC', ${sql.raw(ISO)}) AS paid_at_iso, p.reference, p.note, p.receipt_number,
         p.invoice_id, i.uuid AS invoice_uuid, i.invoice_number,
         p.contact_id, c.uuid AS contact_uuid, c.name AS contact_name,
         p.refund_of_id, rp.uuid AS refund_of_uuid, rp.receipt_number AS refund_of_receipt,
         (SELECT coalesce(sum(-r.amount_minor), 0) FROM payments r WHERE r.org_id = p.org_id AND r.refund_of_id = p.id)::text AS refunded_minor,
         p.recorded_by, u.uuid AS recorded_by_uuid, u.full_name AS recorded_by_name
  FROM payments p
  LEFT JOIN invoices i ON i.org_id = p.org_id AND i.id = p.invoice_id
  LEFT JOIN contacts c ON c.org_id = p.org_id AND c.id = p.contact_id
  LEFT JOIN payments rp ON rp.org_id = p.org_id AND rp.id = p.refund_of_id
  LEFT JOIN users u ON u.org_id = p.org_id AND u.id = p.recorded_by
`;

const toRow = (r: Raw): PaymentRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  createdAt: new Date(r.created_at as string),
  createdAtIso: r.created_at_iso as string,
  kind: r.kind as PaymentKind,
  amountMinor: big(r.amount_minor),
  currency: r.currency as string,
  method: r.method as PaymentMethod,
  source: r.source as PaymentSource,
  paidAt: new Date(r.paid_at as string),
  paidAtIso: r.paid_at_iso as string,
  reference: s(r.reference),
  note: s(r.note),
  receiptNumber: s(r.receipt_number),
  invoiceId: n(r.invoice_id),
  invoiceUuid: s(r.invoice_uuid),
  invoiceNumber: s(r.invoice_number),
  contactId: n(r.contact_id),
  contactUuid: s(r.contact_uuid),
  contactName: s(r.contact_name),
  refundOfId: n(r.refund_of_id),
  refundOfUuid: s(r.refund_of_uuid),
  refundOfReceipt: s(r.refund_of_receipt),
  refundedMinor: big(r.refunded_minor),
  recordedById: n(r.recorded_by),
  recordedByUuid: s(r.recorded_by_uuid),
  recordedByName: s(r.recorded_by_name),
});

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * A payment's record scope is the scope of its INVOICE's people (owned or created by the caller, or by a teammate); a payment with
 * no invoice (a store order paid through a gateway) is visible to `all`, and to whoever recorded it.
 */
export function paymentScopeCondition(
  orgId: number,
  scope: RecordScope,
  actorUserId: number | null,
): SQL | undefined {
  if (scope === 'all') return undefined;
  if (!actorUserId) return sql`false`;
  const own = sql`(i.owner_id = ${actorUserId} OR i.user_id = ${actorUserId} OR p.recorded_by = ${actorUserId})`;
  if (scope === 'own') return own;
  const peers = sql`(SELECT tm2.user_id FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId})`;
  return sql`(${own} OR i.owner_id IN ${peers} OR i.user_id IN ${peers})`;
}

export interface PaymentInsert {
  invoiceId: number | null;
  kind: PaymentKind;
  amountMinor: bigint;
  currency: string;
  method: PaymentMethod;
  source: PaymentSource;
  paidAt: Date | { date: string; tz: string };
  reference: string | null;
  note: string | null;
  receiptNumber: string | null;
  refundOfId: number | null;
  gatewayPaymentId: string | null;
  attemptId: number | null;
  recordedBy: number | null;
  metaJson?: Record<string, unknown> | null;
}

/** Data access for the payment ledger and its reports. */
@Injectable()
export class PaymentsRepository {
  async list(
    tx: Tx,
    orgId: number,
    query: ListPaymentsQuery,
    scope: SQL | undefined,
    tz: string,
  ): Promise<PaymentRow[]> {
    const conds: SQL[] = [sql`p.org_id = ${orgId}`];
    if (scope) conds.push(scope);
    const ref = (table: string, col: string, uuid: string) =>
      sql`p.${sql.raw(col)} = (SELECT x.id FROM ${sql.raw(table)} x WHERE x.org_id = ${orgId} AND x.uuid = ${uuid}::uuid)`;
    if (query.invoiceId) conds.push(ref('invoices', 'invoice_id', query.invoiceId));
    if (query.contactId) conds.push(ref('contacts', 'contact_id', query.contactId));
    if (query.companyId) conds.push(ref('companies', 'company_id', query.companyId));
    if (query.dealId) conds.push(ref('deals', 'deal_id', query.dealId));
    if (query.kind) conds.push(sql`p.kind = ${query.kind}`);
    if (query.method?.length)
      conds.push(
        sql`p.method IN (${sql.join(
          query.method.map((m) => sql`${m}`),
          sql`, `,
        )})`,
      );
    if (query.currency) conds.push(sql`p.currency = ${query.currency}`);
    if (query.from) conds.push(sql`(p.paid_at AT TIME ZONE ${tz})::date >= ${query.from}::date`);
    if (query.to) conds.push(sql`(p.paid_at AT TIME ZONE ${tz})::date <= ${query.to}::date`);
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      conds.push(
        sql`(p.reference ILIKE ${like} OR p.receipt_number ILIKE ${like} OR i.invoice_number ILIKE ${like})`,
      );
    }
    const asc = query.order === 'asc';
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      const ts = c.createdAtIso ?? c.createdAt.toISOString();
      conds.push(sql`(p.created_at, p.id) ${asc ? sql`>` : sql`<`} (${ts}::timestamptz, ${c.id})`);
    }
    const dir = asc ? sql`ASC` : sql`DESC`;
    const res = await tx.execute(sql`
      ${SELECT} WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY p.created_at ${dir}, p.id ${dir} LIMIT ${query.limit + 1}
    `);
    return (res.rows as Raw[]).map(toRow);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<PaymentRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE p.org_id = ${orgId} AND p.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<PaymentRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE p.org_id = ${orgId} AND p.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async forInvoice(tx: Tx, orgId: number, invoiceId: number): Promise<PaymentRow[]> {
    const res = await tx.execute(sql`
      ${SELECT} WHERE p.org_id = ${orgId} AND p.invoice_id = ${invoiceId} ORDER BY p.paid_at, p.id
    `);
    return (res.rows as Raw[]).map(toRow);
  }

  /** Inserts a ledger entry; returns undefined when a gateway payment id was already recorded (the idempotent replay). */
  async insert(tx: Tx, orgId: number, v: PaymentInsert): Promise<number | undefined> {
    const paidAt =
      v.paidAt instanceof Date
        ? sql`${v.paidAt.toISOString()}::timestamptz`
        : sql`((${v.paidAt.date}::date)::timestamp AT TIME ZONE ${v.paidAt.tz})`;
    const res = await tx.execute(sql`
      INSERT INTO payments (org_id, invoice_id, kind, amount_minor, currency, method, source, paid_at, reference, note,
                            receipt_number, refund_of_id, gateway_payment_id, attempt_id, recorded_by, meta_json)
      VALUES (${orgId}, ${v.invoiceId}, ${v.kind}, ${v.amountMinor.toString()}::bigint, ${v.currency}, ${v.method}, ${v.source},
              ${paidAt}, ${v.reference}, ${v.note}, ${v.receiptNumber}, ${v.refundOfId}, ${v.gatewayPaymentId}, ${v.attemptId},
              ${v.recordedBy}, ${v.metaJson ? JSON.stringify(v.metaJson) : null}::jsonb)
      ON CONFLICT (org_id, source, gateway_payment_id) DO NOTHING
      RETURNING id
    `);
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }

  async gatewayPaymentExists(
    tx: Tx,
    orgId: number,
    source: string,
    gatewayPaymentId: string,
  ): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM payments WHERE org_id = ${orgId} AND source = ${source} AND gateway_payment_id = ${gatewayPaymentId} LIMIT 1`,
    );
    return res.rows.length > 0;
  }

  /** The instant a calendar day starts at in the workspace zone (a payment dated "2026-10-03" is dated at its start). */
  async dayStart(tx: Tx, date: string, tz: string): Promise<Date> {
    const res = await tx.execute(sql`SELECT ((${date}::date)::timestamp AT TIME ZONE ${tz}) AS ts`);
    return new Date((res.rows[0] as { ts: string }).ts);
  }

  // --- reports ---------------------------------------------------------------------------------------------------------------

  async summary(
    tx: Tx,
    orgId: number,
    days: number,
    scope: SQL | undefined,
    invoiceScope: SQL | undefined,
    tz: string,
  ): Promise<{
    collected: Array<{ currency: string; amount: bigint }>;
    refunded: Array<{ currency: string; amount: bigint }>;
    outstanding: Array<{ currency: string; amount: bigint; invoices: number }>;
    overdue: Array<{ currency: string; amount: bigint; invoices: number }>;
  }> {
    const pconds: SQL[] = [
      sql`p.org_id = ${orgId}`,
      sql`p.paid_at >= now() - (${days}::int * interval '1 day')`,
      sql`p.paid_at <= now()`,
    ];
    if (scope) pconds.push(scope);
    const pay = await tx.execute(sql`
      SELECT p.currency,
             coalesce(sum(p.amount_minor) FILTER (WHERE p.kind = 'payment'), 0)::text AS collected,
             coalesce(sum(-p.amount_minor) FILTER (WHERE p.kind = 'refund'), 0)::text AS refunded
      FROM payments p LEFT JOIN invoices i ON i.org_id = p.org_id AND i.id = p.invoice_id
      WHERE ${sql.join(pconds, sql` AND `)} GROUP BY p.currency ORDER BY p.currency
    `);
    const iconds: SQL[] = [
      sql`i.org_id = ${orgId}`,
      sql`i.status = 'issued'`,
      sql`i.payment_status <> 'paid'`,
    ];
    if (invoiceScope) iconds.push(invoiceScope);
    const inv = await tx.execute(sql`
      SELECT i.currency,
             coalesce(sum(greatest(i.total_minor - i.paid_minor - i.credited_minor, 0)), 0)::text AS outstanding, count(*)::int AS invoices,
             coalesce(sum(greatest(i.total_minor - i.paid_minor - i.credited_minor, 0)) FILTER (WHERE i.due_date < ${todayExpr(tz)}), 0)::text AS overdue,
             (count(*) FILTER (WHERE i.due_date < ${todayExpr(tz)}))::int AS overdue_invoices
      FROM invoices i WHERE ${sql.join(iconds, sql` AND `)} GROUP BY i.currency ORDER BY i.currency
    `);
    const pr = pay.rows as Raw[];
    const ir = inv.rows as Raw[];
    return {
      collected: pr
        .filter((r) => big(r.collected) > 0n)
        .map((r) => ({ currency: r.currency as string, amount: big(r.collected) })),
      refunded: pr
        .filter((r) => big(r.refunded) > 0n)
        .map((r) => ({ currency: r.currency as string, amount: big(r.refunded) })),
      outstanding: ir
        .filter((r) => big(r.outstanding) > 0n)
        .map((r) => ({
          currency: r.currency as string,
          amount: big(r.outstanding),
          invoices: Number(r.invoices),
        })),
      overdue: ir
        .filter((r) => big(r.overdue) > 0n)
        .map((r) => ({
          currency: r.currency as string,
          amount: big(r.overdue),
          invoices: Number(r.overdue_invoices),
        })),
    };
  }

  /**
   * Open balances bucketed by days past due (the due date, else the issue date), per currency, in SQL. The CASE is the same table as
   * `agingBucketOf` in @crm/contracts; the integration test pins them together.
   */
  async aging(
    tx: Tx,
    orgId: number,
    opts: { contactUuid?: string; currency?: string },
    scope: SQL | undefined,
    tz: string,
  ): Promise<Array<{ currency: string; bucket: AgingBucket; amount: bigint; invoices: number }>> {
    const conds: SQL[] = [
      sql`i.org_id = ${orgId}`,
      sql`i.status = 'issued'`,
      sql`i.payment_status <> 'paid'`,
      sql`i.total_minor > i.paid_minor + i.credited_minor`,
    ];
    if (scope) conds.push(scope);
    if (opts.contactUuid)
      conds.push(
        sql`i.contact_id = (SELECT x.id FROM contacts x WHERE x.org_id = ${orgId} AND x.uuid = ${opts.contactUuid}::uuid)`,
      );
    if (opts.currency) conds.push(sql`i.currency = ${opts.currency}`);
    const res = await tx.execute(sql`
      SELECT currency, bucket, sum(bal)::text AS amount, count(*)::int AS invoices FROM (
        SELECT i.currency, (i.total_minor - i.paid_minor - i.credited_minor) AS bal,
               CASE WHEN dpd <= 0 THEN 'current' WHEN dpd <= 30 THEN 'd1_30' WHEN dpd <= 60 THEN 'd31_60'
                    WHEN dpd <= 90 THEN 'd61_90' ELSE 'd90_plus' END AS bucket
        FROM (SELECT i.*, (${todayExpr(tz)} - coalesce(i.due_date, i.issue_date)) AS dpd FROM invoices i) i
        WHERE ${sql.join(conds, sql` AND `)}
      ) b GROUP BY currency, bucket
    `);
    return (res.rows as Raw[]).map((r) => ({
      currency: r.currency as string,
      bucket: r.bucket as AgingBucket,
      amount: big(r.amount),
      invoices: Number(r.invoices),
    }));
  }

  /** What each contact owes, per currency, biggest debt first; keyset on (currency, outstanding desc, contact id). */
  async outstanding(
    tx: Tx,
    orgId: number,
    query: OutstandingQuery,
    scope: SQL | undefined,
    tz: string,
  ): Promise<
    Array<{
      contactId: number | null;
      contactUuid: string | null;
      contactName: string | null;
      currency: string;
      outstanding: bigint;
      overdue: bigint;
      invoices: number;
      oldestDue: string | null;
    }>
  > {
    const conds: SQL[] = [
      sql`i.org_id = ${orgId}`,
      sql`i.status = 'issued'`,
      sql`i.payment_status <> 'paid'`,
      sql`i.total_minor > i.paid_minor + i.credited_minor`,
    ];
    if (scope) conds.push(scope);
    if (query.currency) conds.push(sql`i.currency = ${query.currency}`);
    if (query.q) conds.push(sql`c.name ILIKE ${`%${escapeLike(query.q)}%`}`);
    const having = query.onlyOverdue
      ? sql`HAVING count(*) FILTER (WHERE i.due_date < ${todayExpr(tz)}) > 0`
      : sql``;
    let outer = sql``;
    if (query.cursor) {
      const [cur, amt, cid] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
      if (cur && amt && cid)
        outer = sql`WHERE (g.currency, -g.outstanding, coalesce(g.contact_id, 0)) > (${cur}, ${`-${amt}`}::bigint, ${cid}::bigint)`;
    }
    const res = await tx.execute(sql`
      SELECT * FROM (
        SELECT i.contact_id, c.uuid AS contact_uuid, c.name AS contact_name, i.currency,
               sum(i.total_minor - i.paid_minor - i.credited_minor) AS outstanding,
               coalesce(sum(i.total_minor - i.paid_minor - i.credited_minor) FILTER (WHERE i.due_date < ${todayExpr(tz)}), 0) AS overdue,
               count(*)::int AS invoices, to_char(min(coalesce(i.due_date, i.issue_date)), 'YYYY-MM-DD') AS oldest_due
        FROM invoices i LEFT JOIN contacts c ON c.org_id = i.org_id AND c.id = i.contact_id
        WHERE ${sql.join(conds, sql` AND `)}
        GROUP BY i.contact_id, c.uuid, c.name, i.currency ${having}
      ) g ${outer}
      ORDER BY g.currency, g.outstanding DESC, coalesce(g.contact_id, 0) LIMIT ${query.limit + 1}
    `);
    return (res.rows as Raw[]).map((r) => ({
      contactId: n(r.contact_id),
      contactUuid: s(r.contact_uuid),
      contactName: s(r.contact_name),
      currency: r.currency as string,
      outstanding: big(r.outstanding),
      overdue: big(r.overdue),
      invoices: Number(r.invoices),
      oldestDue: s(r.oldest_due),
    }));
  }
}
