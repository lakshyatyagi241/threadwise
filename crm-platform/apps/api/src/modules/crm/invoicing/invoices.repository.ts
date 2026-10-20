import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  InvoiceCountsQuery,
  InvoiceDocType,
  InvoicePaymentStatus,
  InvoiceStatus,
  InvoiceStoredStatus,
  ListInvoicesQuery,
  RecordScope,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';
import { isTeamPeer, scopeOwnerCondition } from '../../../kernel/rbac/scope';

/** One invoice as the SQL returns it, with the people and linked records already joined (names only, never internal ids on the wire). */
export interface InvoiceRow {
  id: number;
  uuid: string;
  createdAtIso: string;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
  docType: InvoiceDocType;
  source: string;
  storedStatus: InvoiceStoredStatus;
  paymentStatus: InvoicePaymentStatus;
  status: InvoiceStatus;
  daysOverdue: number | null;
  currency: string;
  currencyExponent: number;
  subtotalMinor: bigint;
  discountMinor: bigint;
  shippingMinor: bigint;
  taxMinor: bigint;
  taxAddedMinor: bigint;
  totalMinor: bigint;
  paidMinor: bigint;
  creditedMinor: bigint;
  metaJson: Record<string, unknown> | null;
  refundedMinor: bigint;
  discountKind: 'none' | 'percent' | 'amount';
  discountValue: bigint;
  taxInclusive: boolean;
  number: string | null;
  series: string | null;
  seq: number | null;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  buyerAddress: string | null;
  buyerTaxId: string | null;
  buyerCountry: string | null;
  taxRegime: string;
  placeOfSupply: string | null;
  reverseCharge: boolean;
  legalNotes: string | null;
  notes: string | null;
  terms: string | null;
  reference: string | null;
  issueDate: string | null;
  dueDate: string | null;
  issuedAt: Date | null;
  paidAt: Date | null;
  sentAt: Date | null;
  deliveryChannel: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  ownerId: number | null;
  ownerUuid: string | null;
  ownerName: string | null;
  createdById: number | null;
  createdByUuid: string | null;
  createdByName: string | null;
  contactId: number | null;
  contactUuid: string | null;
  contactName: string | null;
  companyId: number | null;
  companyUuid: string | null;
  companyName: string | null;
  dealId: number | null;
  dealUuid: string | null;
  dealTitle: string | null;
  quoteId: number | null;
  quoteUuid: string | null;
  quoteNumber: string | null;
  quoteKind: 'proposal' | 'estimate' | null;
  salesOrderUuid: string | null;
  salesOrderNumber: string | null;
  recurringUuid: string | null;
  recurringName: string | null;
  publicTokenCipher: string | null;
  publicTokenHash: string | null;
  tokenExpiresAt: Date | null;
  tokenRevokedAt: Date | null;
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
  viewCount: number;
  sellerSnapshot: Record<string, unknown> | null;
}

export interface InvoiceLineRow {
  id: number;
  uuid: string;
  position: number;
  description: string;
  sku: string | null;
  hsnSac: string | null;
  qty: string;
  unitPriceMinor: bigint;
  grossMinor: bigint;
  discountKind: 'none' | 'percent' | 'amount';
  discountValue: bigint;
  discountMinor: bigint;
  docDiscountShareMinor: bigint;
  taxRateId: number | null;
  taxRateUuid: string | null;
  taxName: string | null;
  taxType: string | null;
  taxRatePercent: string;
  taxInclusive: boolean;
  taxMinor: bigint;
  totalMinor: bigint;
  taxComponents: Array<{
    type: string;
    name?: string;
    ratePercent: string;
    amountMinor: string;
  }> | null;
}

export interface TaxSummaryRow {
  name: string;
  taxType: string | null;
  ratePercent: string;
  inclusive: boolean;
  baseMinor: bigint;
  taxMinor: bigint;
  taxComponents: Array<{ type: string; ratePercent: string; amountMinor: string }> | null;
}

type Raw = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const big = (v: unknown): bigint => BigInt(v as string | number);

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

/** Today in the workspace calendar. `tz` is already a valid IANA name (the service resolves it). */
const todayExpr = (tz: string) => sql`(now() AT TIME ZONE ${tz})::date`;

/**
 * The derived status (see deriveInvoiceStatus in @crm/contracts: this is the same table in SQL). One expression is shared by the
 * select, the status filter and the counts, so a tab's number and the rows behind it can never disagree.
 */
export const statusExpr = (tz: string) => sql`(CASE
  WHEN i.status = 'draft' THEN 'draft'
  WHEN i.status = 'void' THEN 'void'
  WHEN i.payment_status = 'paid' THEN 'paid'
  WHEN i.due_date IS NOT NULL AND i.due_date < ${todayExpr(tz)} THEN 'overdue'
  WHEN i.payment_status = 'partially_paid' THEN 'partially_paid'
  ELSE 'issued' END)`;

const selectSql = (tz: string) => sql`
  SELECT i.id, i.uuid,
         to_char(i.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso,
         i.created_at, i.updated_at, i.row_version, i.doc_type, i.source,
         i.status AS stored_status, i.payment_status, ${statusExpr(tz)} AS status,
         CASE WHEN i.status = 'issued' AND i.payment_status <> 'paid' AND i.due_date < ${todayExpr(tz)}
              THEN (${todayExpr(tz)} - i.due_date) END AS days_overdue,
         i.currency, i.currency_exponent,
         i.subtotal_minor::text, i.discount_minor::text, i.shipping_minor::text, i.tax_minor::text, i.tax_added_minor::text,
         i.total_minor::text, i.paid_minor::text, i.credited_minor::text, i.meta_json, i.refunded_minor::text, i.discount_kind, i.discount_value::text, i.tax_inclusive,
         i.invoice_number, i.series, i.seq,
         i.buyer_name, i.buyer_email, i.buyer_phone, i.billing_json ->> 'address' AS buyer_address, i.buyer_tax_id, i.buyer_country,
         i.tax_regime, i.place_of_supply, i.reverse_charge, i.legal_notes, i.notes, i.terms, i.reference,
         to_char(i.issue_date, 'YYYY-MM-DD') AS issue_date, to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
         i.issued_at, i.paid_at, i.sent_at, i.delivery_channel, i.voided_at, i.void_reason,
         i.owner_id, ou.uuid AS owner_uuid, ou.full_name AS owner_name,
         i.user_id AS created_by_id, cu.uuid AS created_by_uuid, cu.full_name AS created_by_name,
         i.contact_id, c.uuid AS contact_uuid, c.name AS contact_name,
         i.company_id, co.uuid AS company_uuid, co.name AS company_name,
         i.deal_id, dl.uuid AS deal_uuid, dl.title AS deal_title,
         i.quote_id, q.uuid AS quote_uuid, q.number AS quote_number, q.doc_type AS quote_kind,
         so.uuid AS sales_order_uuid, so.number AS sales_order_number, rc.uuid AS recurring_uuid, rc.name AS recurring_name,
         i.public_token_cipher, i.public_token_hash, i.token_expires_at, i.token_revoked_at,
         i.first_viewed_at, i.last_viewed_at, i.view_count, i.seller_snapshot_json
  FROM invoices i
  LEFT JOIN users ou ON ou.org_id = i.org_id AND ou.id = i.owner_id
  LEFT JOIN users cu ON cu.org_id = i.org_id AND cu.id = i.user_id
  LEFT JOIN contacts c ON c.org_id = i.org_id AND c.id = i.contact_id
  LEFT JOIN companies co ON co.org_id = i.org_id AND co.id = i.company_id
  LEFT JOIN deals dl ON dl.org_id = i.org_id AND dl.id = i.deal_id
  LEFT JOIN sales_docs q ON q.org_id = i.org_id AND q.id = i.quote_id
  LEFT JOIN sales_orders so ON so.org_id = i.org_id AND so.id = i.sales_order_id
  LEFT JOIN recurring_invoices rc ON rc.org_id = i.org_id AND rc.id = i.recurring_id
`;

const toRow = (r: Raw): InvoiceRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  createdAtIso: r.created_at_iso as string,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: Number(r.row_version),
  docType: r.doc_type as InvoiceDocType,
  source: r.source as string,
  storedStatus: r.stored_status as InvoiceStoredStatus,
  paymentStatus: r.payment_status as InvoicePaymentStatus,
  status: r.status as InvoiceStatus,
  daysOverdue: n(r.days_overdue),
  currency: r.currency as string,
  currencyExponent: Number(r.currency_exponent),
  subtotalMinor: big(r.subtotal_minor),
  discountMinor: big(r.discount_minor),
  shippingMinor: big(r.shipping_minor),
  taxMinor: big(r.tax_minor),
  taxAddedMinor: big(r.tax_added_minor),
  totalMinor: big(r.total_minor),
  paidMinor: big(r.paid_minor),
  creditedMinor: big(r.credited_minor),
  metaJson: (r.meta_json as Record<string, unknown> | null) ?? null,
  refundedMinor: big(r.refunded_minor),
  discountKind: r.discount_kind as InvoiceRow['discountKind'],
  discountValue: big(r.discount_value),
  taxInclusive: r.tax_inclusive as boolean,
  number: s(r.invoice_number),
  series: s(r.series),
  seq: n(r.seq),
  buyerName: s(r.buyer_name),
  buyerEmail: s(r.buyer_email),
  buyerPhone: s(r.buyer_phone),
  buyerAddress: s(r.buyer_address),
  buyerTaxId: s(r.buyer_tax_id),
  buyerCountry: s(r.buyer_country),
  taxRegime: r.tax_regime as string,
  placeOfSupply: s(r.place_of_supply),
  reverseCharge: r.reverse_charge as boolean,
  legalNotes: s(r.legal_notes),
  notes: s(r.notes),
  terms: s(r.terms),
  reference: s(r.reference),
  issueDate: s(r.issue_date),
  dueDate: s(r.due_date),
  issuedAt: d(r.issued_at),
  paidAt: d(r.paid_at),
  sentAt: d(r.sent_at),
  deliveryChannel: s(r.delivery_channel),
  voidedAt: d(r.voided_at),
  voidReason: s(r.void_reason),
  ownerId: n(r.owner_id),
  ownerUuid: s(r.owner_uuid),
  ownerName: s(r.owner_name),
  createdById: n(r.created_by_id),
  createdByUuid: s(r.created_by_uuid),
  createdByName: s(r.created_by_name),
  contactId: n(r.contact_id),
  contactUuid: s(r.contact_uuid),
  contactName: s(r.contact_name),
  companyId: n(r.company_id),
  companyUuid: s(r.company_uuid),
  companyName: s(r.company_name),
  dealId: n(r.deal_id),
  dealUuid: s(r.deal_uuid),
  dealTitle: s(r.deal_title),
  quoteId: n(r.quote_id),
  quoteUuid: s(r.quote_uuid),
  quoteNumber: s(r.quote_number),
  quoteKind: (s(r.quote_kind) as 'proposal' | 'estimate' | null) ?? null,
  salesOrderUuid: s(r.sales_order_uuid),
  salesOrderNumber: s(r.sales_order_number),
  recurringUuid: s(r.recurring_uuid),
  recurringName: s(r.recurring_name),
  publicTokenCipher: s(r.public_token_cipher),
  publicTokenHash: s(r.public_token_hash),
  tokenExpiresAt: d(r.token_expires_at),
  tokenRevokedAt: d(r.token_revoked_at),
  firstViewedAt: d(r.first_viewed_at),
  lastViewedAt: d(r.last_viewed_at),
  viewCount: Number(r.view_count),
  sellerSnapshot: (r.seller_snapshot_json as Record<string, unknown> | null) ?? null,
});

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The record scope of an invoice is a condition on the PEOPLE of the invoice: `own` is "owned by me or created by me", `team`
 * adds everyone who shares a team with me, `all` adds nothing.
 */
export function invoiceScopeCondition(
  orgId: number,
  scope: RecordScope,
  actorUserId: number | null,
): SQL | undefined {
  return scopeOwnerCondition({ orgId, userId: actorUserId }, scope, [
    sql`i.owner_id`,
    sql`i.user_id`,
  ]);
}

/** What the lists and the counts share. Uuids are resolved inside the SQL; an unknown uuid matches nothing. */
type FilterInput = Pick<
  InvoiceCountsQuery,
  | 'q'
  | 'docType'
  | 'source'
  | 'contactId'
  | 'companyId'
  | 'dealId'
  | 'ownerId'
  | 'mine'
  | 'currency'
  | 'issuedFrom'
  | 'issuedTo'
  | 'dueFrom'
  | 'dueTo'
>;

function filterConds(
  orgId: number,
  f: FilterInput,
  scope: SQL | undefined,
  actorUserId: number | null,
): SQL[] {
  const conds: SQL[] = [sql`i.org_id = ${orgId}`];
  if (scope) conds.push(scope);
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    conds.push(
      sql`(i.invoice_number ILIKE ${like} OR i.buyer_name ILIKE ${like} OR i.reference ILIKE ${like})`,
    );
  }
  if (f.docType?.length)
    conds.push(
      sql`i.doc_type IN (${sql.join(
        f.docType.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    );
  if (f.source?.length)
    conds.push(
      sql`i.source IN (${sql.join(
        f.source.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    );
  const ref = (table: string, col: string, uuid: string) =>
    sql`i.${sql.raw(col)} = (SELECT x.id FROM ${sql.raw(table)} x WHERE x.org_id = ${orgId} AND x.uuid = ${uuid}::uuid)`;
  if (f.contactId) conds.push(ref('contacts', 'contact_id', f.contactId));
  if (f.companyId) conds.push(ref('companies', 'company_id', f.companyId));
  if (f.dealId) conds.push(ref('deals', 'deal_id', f.dealId));
  if (f.ownerId) conds.push(ref('users', 'owner_id', f.ownerId));
  if (f.mine) conds.push(sql`i.owner_id = ${actorUserId ?? 0}`);
  if (f.currency) conds.push(sql`i.currency = ${f.currency}`);
  if (f.issuedFrom) conds.push(sql`i.issue_date >= ${f.issuedFrom}::date`);
  if (f.issuedTo) conds.push(sql`i.issue_date <= ${f.issuedTo}::date`);
  if (f.dueFrom) conds.push(sql`i.due_date >= ${f.dueFrom}::date`);
  if (f.dueTo) conds.push(sql`i.due_date <= ${f.dueTo}::date`);
  return conds;
}

export interface InvoiceCounts {
  all: number;
  draft: number;
  issued: number;
  partiallyPaid: number;
  paid: number;
  overdue: number;
  void: number;
}

/** Everything a draft is written with. Amounts are whole minor units. */
export interface InvoiceInsert {
  userId: number | null;
  ownerId: number | null;
  source: string;
  docType: InvoiceDocType;
  currency: string;
  currencyExponent: number;
  subtotalMinor: bigint;
  discountMinor: bigint;
  shippingMinor: bigint;
  taxMinor: bigint;
  taxAddedMinor: bigint;
  totalMinor: bigint;
  taxInclusive: boolean;
  discountKind: string;
  discountValue: bigint;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  buyerAddress: string | null;
  buyerTaxId: string | null;
  buyerCountry: string | null;
  taxRegime: string;
  placeOfSupply: string | null;
  reverseCharge: boolean;
  legalNotes: string | null;
  contactId: number | null;
  companyId: number | null;
  dealId: number | null;
  quoteId: number | null;
  reference: string | null;
  notes: string | null;
  terms: string | null;
  issueDate: string | null;
  dueDate: string | null;
  metaJson?: Record<string, unknown> | null;
}

export type InvoicePatch = Partial<Omit<InvoiceInsert, 'userId' | 'source' | 'metaJson'>> & {
  metaJson?: Record<string, unknown> | null;
};

export interface LineInsert {
  position: number;
  description: string;
  sku: string | null;
  hsnSac: string | null;
  qty: string;
  unitPriceMinor: bigint;
  grossMinor: bigint;
  discountKind: string;
  discountValue: bigint;
  discountMinor: bigint;
  docDiscountShareMinor: bigint;
  taxRateId: number | null;
  taxName: string | null;
  taxType: string | null;
  taxRatePercent: string;
  taxInclusive: boolean;
  taxMinor: bigint;
  totalMinor: bigint;
  taxComponents: unknown[] | null;
  currency: string;
}

export interface SummaryInsert {
  name: string;
  taxType: string | null;
  ratePercent: string;
  inclusive: boolean;
  baseMinor: bigint;
  taxMinor: bigint;
  taxComponents: unknown[] | null;
}

/** Data access for invoices. Every query carries the org: RLS is the backstop, not the filter. */
/**
 * Components stored before the exact-rate change carry `rateBp` (900 = 9%) instead of `ratePercent`.
 * Issued invoices are frozen, so the rows are not rewritten: every reader gets the current shape here.
 */
function normalizeComponents(raw: unknown): unknown[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((c) => {
    const x = c as { ratePercent?: string; rateBp?: number };
    if (x.ratePercent !== undefined || x.rateBp === undefined) return c;
    const { rateBp, ...rest } = c as { rateBp: number };
    return { ...rest, ratePercent: String(rateBp / 100) };
  });
}

@Injectable()
export class InvoicesRepository {
  // --- reads -----------------------------------------------------------------------------------------------------------------

  async list(
    tx: Tx,
    orgId: number,
    actorUserId: number | null,
    query: ListInvoicesQuery,
    scope: SQL | undefined,
    tz: string,
    extra: SQL[] = [],
  ): Promise<InvoiceRow[]> {
    const conds = [...filterConds(orgId, query, scope, actorUserId), ...extra];
    if (query.status?.length)
      conds.push(
        sql`${statusExpr(tz)} IN (${sql.join(
          query.status.map((x) => sql`${x}`),
          sql`, `,
        )})`,
      );
    const asc = query.order === 'asc';
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      const ts = c.createdAtIso ?? c.createdAt.toISOString();
      const cmp = asc ? sql`>` : sql`<`;
      conds.push(sql`(i.created_at, i.id) ${cmp} (${ts}::timestamptz, ${c.id})`);
    }
    const dir = asc ? sql`ASC` : sql`DESC`;
    const res = await tx.execute(sql`
      ${selectSql(tz)} WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY i.created_at ${dir}, i.id ${dir} LIMIT ${query.limit + 1}
    `);
    return (res.rows as Raw[]).map(toRow);
  }

  /** One round trip for the six tab counts, inside the filter (status excluded). */
  async counts(
    tx: Tx,
    orgId: number,
    actorUserId: number | null,
    filter: InvoiceCountsQuery,
    scope: SQL | undefined,
    tz: string,
  ): Promise<InvoiceCounts> {
    const conds = filterConds(orgId, filter, scope, actorUserId);
    const st = statusExpr(tz);
    const res = await tx.execute(sql`
      SELECT count(*)::int AS "all",
        count(*) FILTER (WHERE ${st} = 'draft')::int AS draft,
        count(*) FILTER (WHERE ${st} = 'issued')::int AS issued,
        count(*) FILTER (WHERE ${st} = 'partially_paid')::int AS partially_paid,
        count(*) FILTER (WHERE ${st} = 'paid')::int AS paid,
        count(*) FILTER (WHERE ${st} = 'overdue')::int AS overdue,
        count(*) FILTER (WHERE ${st} = 'void')::int AS void
      FROM invoices i WHERE ${sql.join(conds, sql` AND `)}
    `);
    const r = res.rows[0] as Raw;
    return {
      all: Number(r.all),
      draft: Number(r.draft),
      issued: Number(r.issued),
      partiallyPaid: Number(r.partially_paid),
      paid: Number(r.paid),
      overdue: Number(r.overdue),
      void: Number(r.void),
    };
  }

  /** Open balance per currency inside the filter, and the part of it that is past due. */
  async openBalances(
    tx: Tx,
    orgId: number,
    actorUserId: number | null,
    filter: InvoiceCountsQuery,
    scope: SQL | undefined,
    tz: string,
  ): Promise<Array<{ currency: string; outstanding: bigint; overdue: bigint }>> {
    const conds = filterConds(orgId, filter, scope, actorUserId);
    conds.push(sql`i.status = 'issued'`, sql`i.payment_status <> 'paid'`);
    const res = await tx.execute(sql`
      SELECT i.currency,
             sum(greatest(i.total_minor - i.paid_minor - i.credited_minor, 0))::text AS outstanding,
             coalesce(sum(greatest(i.total_minor - i.paid_minor - i.credited_minor, 0)) FILTER (WHERE i.due_date < ${todayExpr(tz)}), 0)::text AS overdue
      FROM invoices i WHERE ${sql.join(conds, sql` AND `)}
      GROUP BY i.currency ORDER BY i.currency
    `);
    return (res.rows as Raw[]).map((r) => ({
      currency: r.currency as string,
      outstanding: big(r.outstanding),
      overdue: big(r.overdue),
    }));
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    tz: string,
    forUpdate = false,
  ): Promise<InvoiceRow | undefined> {
    // FOR UPDATE cannot lock the outer-joined side, so lock the invoice row alone and read the joined shape after.
    if (forUpdate) {
      await tx.execute(
        sql`SELECT 1 FROM invoices WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
      );
    }
    const res = await tx.execute(
      sql`${selectSql(tz)} WHERE i.org_id = ${orgId} AND i.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(
    tx: Tx,
    orgId: number,
    id: number,
    tz: string,
    forUpdate = false,
  ): Promise<InvoiceRow | undefined> {
    if (forUpdate) {
      await tx.execute(
        sql`SELECT 1 FROM invoices WHERE org_id = ${orgId} AND id = ${id} FOR UPDATE`,
      );
    }
    const res = await tx.execute(sql`${selectSql(tz)} WHERE i.org_id = ${orgId} AND i.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** The live (not void) invoice made from a commerce channel order (`wa_orders.id`), if one exists. */
  async liveIdByWaOrder(tx: Tx, orgId: number, waOrderId: number): Promise<number | undefined> {
    const res = await tx.execute(sql`
      SELECT id FROM invoices WHERE org_id = ${orgId} AND wa_order_id = ${waOrderId} AND status <> 'void' ORDER BY id LIMIT 1`);
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }

  /** Stamps the channel order a draft was made from (the unique index on org, order and document type keeps it to one). */
  async setWaOrderId(tx: Tx, orgId: number, id: number, waOrderId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE invoices SET wa_order_id = ${waOrderId} WHERE org_id = ${orgId} AND id = ${id} AND status = 'draft'`,
    );
  }

  async lines(tx: Tx, orgId: number, invoiceId: number): Promise<InvoiceLineRow[]> {
    const res = await tx.execute(sql`
      SELECT it.id, it.uuid, it.sort, it.description, it.sku, it.hsn_sac, it.qty::text AS qty,
             it.unit_price_minor::text, it.line_subtotal_minor::text AS gross_minor, it.discount_kind,
             it.discount_value::text, it.line_discount_minor::text AS discount_minor,
             it.doc_discount_share_minor::text, it.tax_rate_id, tr.uuid AS tax_rate_uuid, it.tax_name, it.tax_type,
             it.tax_rate_percent::text AS tax_rate_percent, it.tax_inclusive, it.tax_amount_minor::text AS tax_minor,
             it.line_total_minor::text AS total_minor, it.tax_components
      FROM invoice_items it
      LEFT JOIN tax_rates tr ON tr.org_id = it.org_id AND tr.id = it.tax_rate_id
      WHERE it.org_id = ${orgId} AND it.invoice_id = ${invoiceId}
      ORDER BY it.sort, it.id
    `);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid as string,
      position: Number(r.sort),
      description: r.description as string,
      sku: s(r.sku),
      hsnSac: s(r.hsn_sac),
      qty: r.qty as string,
      unitPriceMinor: big(r.unit_price_minor),
      grossMinor: big(r.gross_minor),
      discountKind: r.discount_kind as InvoiceLineRow['discountKind'],
      discountValue: big(r.discount_value),
      discountMinor: big(r.discount_minor),
      docDiscountShareMinor: big(r.doc_discount_share_minor),
      taxRateId: n(r.tax_rate_id),
      taxRateUuid: s(r.tax_rate_uuid),
      taxName: s(r.tax_name),
      taxType: s(r.tax_type),
      taxRatePercent: r.tax_rate_percent as string,
      taxInclusive: r.tax_inclusive as boolean,
      taxMinor: big(r.tax_minor),
      totalMinor: big(r.total_minor),
      taxComponents: normalizeComponents(r.tax_components) as InvoiceLineRow['taxComponents'],
    }));
  }

  async taxSummary(tx: Tx, orgId: number, invoiceId: number): Promise<TaxSummaryRow[]> {
    const res = await tx.execute(sql`
      SELECT tax_label, tax_type, rate_percent::text AS rate_percent, inclusive, base_minor::text, amount_minor::text, tax_components
      FROM invoice_tax_summary WHERE org_id = ${orgId} AND invoice_id = ${invoiceId}
      ORDER BY rate_percent, tax_label, inclusive
    `);
    return (res.rows as Raw[]).map((r) => ({
      name: r.tax_label as string,
      taxType: s(r.tax_type),
      ratePercent: r.rate_percent as string,
      inclusive: r.inclusive as boolean,
      baseMinor: big(r.base_minor),
      taxMinor: big(r.amount_minor),
      taxComponents: normalizeComponents(r.tax_components) as TaxSummaryRow['taxComponents'],
    }));
  }

  // --- writes ----------------------------------------------------------------------------------------------------------------

  async insert(tx: Tx, orgId: number, v: InvoiceInsert): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO invoices (
        org_id, user_id, owner_id, source, doc_type, status, currency, currency_exponent,
        subtotal_minor, discount_minor, shipping_minor, tax_minor, tax_added_minor, total_minor, tax_inclusive,
        discount_kind, discount_value, buyer_name, buyer_email, buyer_phone, billing_json, buyer_tax_id, buyer_country,
        tax_regime, place_of_supply, reverse_charge, legal_notes, contact_id, company_id, deal_id, quote_id,
        reference, notes, terms, issue_date, due_date, meta_json)
      VALUES (
        ${orgId}, ${v.userId}, ${v.ownerId}, ${v.source}, ${v.docType}, 'draft', ${v.currency}, ${v.currencyExponent},
        ${v.subtotalMinor.toString()}::bigint, ${v.discountMinor.toString()}::bigint, ${v.shippingMinor.toString()}::bigint,
        ${v.taxMinor.toString()}::bigint, ${v.taxAddedMinor.toString()}::bigint, ${v.totalMinor.toString()}::bigint,
        ${v.taxInclusive}, ${v.discountKind}, ${v.discountValue.toString()}::bigint,
        ${v.buyerName}, ${v.buyerEmail}, ${v.buyerPhone},
        ${v.buyerAddress ? JSON.stringify({ address: v.buyerAddress }) : null}::jsonb, ${v.buyerTaxId}, ${v.buyerCountry},
        ${v.taxRegime}, ${v.placeOfSupply}, ${v.reverseCharge}, ${v.legalNotes},
        ${v.contactId}, ${v.companyId}, ${v.dealId}, ${v.quoteId},
        ${v.reference}, ${v.notes}, ${v.terms}, ${v.issueDate}::date, ${v.dueDate}::date,
        ${v.metaJson ? JSON.stringify(v.metaJson) : null}::jsonb)
      RETURNING id
    `);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** The optimistic lock is the `row_version` in the WHERE: zero rows back means somebody else wrote first. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number | undefined,
    patch: InvoicePatch,
  ): Promise<boolean> {
    const sets: SQL[] = [];
    const add = (col: string, value: unknown) => sets.push(sql`${sql.raw(col)} = ${value}`);
    const addMinor = (col: string, v: bigint | undefined) => {
      if (v !== undefined) sets.push(sql`${sql.raw(col)} = ${v.toString()}::bigint`);
    };
    if (patch.ownerId !== undefined) add('owner_id', patch.ownerId);
    if (patch.docType !== undefined) add('doc_type', patch.docType);
    if (patch.currency !== undefined) add('currency', patch.currency);
    if (patch.currencyExponent !== undefined) add('currency_exponent', patch.currencyExponent);
    addMinor('subtotal_minor', patch.subtotalMinor);
    addMinor('discount_minor', patch.discountMinor);
    addMinor('shipping_minor', patch.shippingMinor);
    addMinor('tax_minor', patch.taxMinor);
    addMinor('tax_added_minor', patch.taxAddedMinor);
    addMinor('total_minor', patch.totalMinor);
    if (patch.taxInclusive !== undefined) add('tax_inclusive', patch.taxInclusive);
    if (patch.discountKind !== undefined) add('discount_kind', patch.discountKind);
    addMinor('discount_value', patch.discountValue);
    if (patch.buyerName !== undefined) add('buyer_name', patch.buyerName);
    if (patch.buyerEmail !== undefined) add('buyer_email', patch.buyerEmail);
    if (patch.buyerPhone !== undefined) add('buyer_phone', patch.buyerPhone);
    if (patch.buyerAddress !== undefined)
      sets.push(
        sql`billing_json = ${patch.buyerAddress ? JSON.stringify({ address: patch.buyerAddress }) : null}::jsonb`,
      );
    if (patch.buyerTaxId !== undefined) add('buyer_tax_id', patch.buyerTaxId);
    if (patch.buyerCountry !== undefined) add('buyer_country', patch.buyerCountry);
    if (patch.taxRegime !== undefined) add('tax_regime', patch.taxRegime);
    if (patch.placeOfSupply !== undefined) add('place_of_supply', patch.placeOfSupply);
    if (patch.reverseCharge !== undefined) add('reverse_charge', patch.reverseCharge);
    if (patch.legalNotes !== undefined) add('legal_notes', patch.legalNotes);
    if (patch.metaJson !== undefined)
      sets.push(sql`meta_json = ${patch.metaJson ? JSON.stringify(patch.metaJson) : null}::jsonb`);
    if (patch.contactId !== undefined) add('contact_id', patch.contactId);
    if (patch.companyId !== undefined) add('company_id', patch.companyId);
    if (patch.dealId !== undefined) add('deal_id', patch.dealId);
    if (patch.reference !== undefined) add('reference', patch.reference);
    if (patch.notes !== undefined) add('notes', patch.notes);
    if (patch.terms !== undefined) add('terms', patch.terms);
    if (patch.issueDate !== undefined) sets.push(sql`issue_date = ${patch.issueDate}::date`);
    if (patch.dueDate !== undefined) sets.push(sql`due_date = ${patch.dueDate}::date`);
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE invoices SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id}
      ${expectedVersion !== undefined ? sql`AND row_version = ${expectedVersion}` : sql``}
      RETURNING id
    `);
    return res.rows.length > 0;
  }

  async replaceLines(
    tx: Tx,
    orgId: number,
    invoiceId: number,
    lines: LineInsert[],
    summary: SummaryInsert[],
  ): Promise<void> {
    await tx.execute(
      sql`DELETE FROM invoice_tax_summary WHERE org_id = ${orgId} AND invoice_id = ${invoiceId}`,
    );
    await tx.execute(
      sql`DELETE FROM invoice_items WHERE org_id = ${orgId} AND invoice_id = ${invoiceId}`,
    );
    for (const l of lines) {
      await tx.execute(sql`
        INSERT INTO invoice_items (
          org_id, invoice_id, sort, description, sku, hsn_sac, qty, unit_price_minor, line_subtotal_minor, discount_kind,
          discount_value, line_discount_minor, doc_discount_share_minor, tax_rate_id, tax_name, tax_type, tax_rate_percent,
          tax_inclusive, tax_amount_minor, line_total_minor, tax_components, currency)
        VALUES (
          ${orgId}, ${invoiceId}, ${l.position}, ${l.description}, ${l.sku}, ${l.hsnSac}, ${l.qty}::numeric,
          ${l.unitPriceMinor.toString()}::bigint, ${l.grossMinor.toString()}::bigint, ${l.discountKind},
          ${l.discountValue.toString()}::bigint, ${l.discountMinor.toString()}::bigint,
          ${l.docDiscountShareMinor.toString()}::bigint, ${l.taxRateId}, ${l.taxName}, ${l.taxType}, ${l.taxRatePercent}::numeric,
          ${l.taxInclusive}, ${l.taxMinor.toString()}::bigint, ${l.totalMinor.toString()}::bigint,
          ${l.taxComponents ? JSON.stringify(l.taxComponents) : null}::jsonb, ${l.currency})
      `);
    }
    for (const g of summary) {
      await tx.execute(sql`
        INSERT INTO invoice_tax_summary (org_id, invoice_id, tax_label, tax_type, rate_percent, inclusive, base_minor, amount_minor, tax_components)
        VALUES (${orgId}, ${invoiceId}, ${g.name}, ${g.taxType}, ${g.ratePercent}::numeric, ${g.inclusive},
                ${g.baseMinor.toString()}::bigint, ${g.taxMinor.toString()}::bigint,
                ${g.taxComponents ? JSON.stringify(g.taxComponents) : null}::jsonb)
      `);
    }
  }

  /** Allocates the next number of a series under the series row lock, in the caller's transaction. */
  async allocateSeq(tx: Tx, orgId: number, series: string): Promise<number> {
    const res = await tx.execute(
      sql`SELECT allocate_series_seq(${orgId}::bigint, ${series}) AS seq`,
    );
    return Number((res.rows[0] as { seq: number | string }).seq);
  }

  /** Draft -> issued. The caller has locked the row; the freeze trigger lets this one transition through. */
  async markIssued(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      series: string;
      number: string;
      seq: number;
      issueDate: string;
      dueDate: string;
      tokenHash: string;
      tokenCipher: string;
      sellerSnapshot: Record<string, unknown>;
      paidAtNow: boolean;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE invoices SET status = 'issued', series = ${v.series}, invoice_number = ${v.number}, seq = ${v.seq},
        issued_at = now(), issue_date = ${v.issueDate}::date, due_date = ${v.dueDate}::date,
        public_token_hash = ${v.tokenHash}, public_token_cipher = ${v.tokenCipher},
        seller_snapshot_json = ${JSON.stringify(v.sellerSnapshot)}::jsonb,
        ${v.paidAtNow ? sql`payment_status = 'paid', paid_at = now()` : sql`payment_status = 'unpaid'`}
      WHERE org_id = ${orgId} AND id = ${id}
    `);
  }

  async markVoid(
    tx: Tx,
    orgId: number,
    id: number,
    actorUserId: number | null,
    reason: string,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE invoices SET status = 'void', voided_at = now(), voided_by = ${actorUserId}, void_reason = ${reason}
      WHERE org_id = ${orgId} AND id = ${id}
    `);
  }

  async markSent(tx: Tx, orgId: number, id: number, channel: string): Promise<void> {
    await tx.execute(sql`
      UPDATE invoices SET sent_at = now(), delivery_channel = ${channel}, send_status = 'sent', send_attempts = send_attempts + 1
      WHERE org_id = ${orgId} AND id = ${id}
    `);
  }

  async setLink(
    tx: Tx,
    orgId: number,
    id: number,
    v: { hash: string; cipher: string; expiresAt: Date | null } | { revoke: true },
  ): Promise<void> {
    if ('revoke' in v) {
      await tx.execute(
        sql`UPDATE invoices SET token_revoked_at = now() WHERE org_id = ${orgId} AND id = ${id}`,
      );
      return;
    }
    await tx.execute(sql`
      UPDATE invoices SET public_token_hash = ${v.hash}, public_token_cipher = ${v.cipher},
        token_expires_at = ${v.expiresAt}, token_revoked_at = NULL
      WHERE org_id = ${orgId} AND id = ${id}
    `);
  }

  /** Counts a buyer's view; returns true for the very first one (the only one that raises an event). */
  async recordView(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE invoices SET view_count = view_count + 1, last_viewed_at = now(), first_viewed_at = coalesce(first_viewed_at, now())
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING (view_count = 1) AS first
    `);
    return (res.rows[0] as { first: boolean } | undefined)?.first === true;
  }

  async deleteDraft(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM invoices WHERE org_id = ${orgId} AND id = ${id} AND status = 'draft' RETURNING id`,
    );
    return res.rows.length > 0;
  }

  /** Pending payment attempts stop being payable when the invoice is voided. */
  async expireAttempts(tx: Tx, orgId: number, invoiceId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE invoice_payment_attempts SET status = 'expired'
      WHERE org_id = ${orgId} AND invoice_id = ${invoiceId} AND status = 'pending'
    `);
  }

  // --- references ------------------------------------------------------------------------------------------------------------

  async resolveActiveUser(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; name: string } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, full_name FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND status = 'active'`,
    );
    const r = res.rows[0] as { id: number | string; full_name: string } | undefined;
    return r ? { id: Number(r.id), name: r.full_name } : undefined;
  }

  async resolveContact(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<
    | {
        id: number;
        name: string | null;
        email: string | null;
        phone: string | null;
        companyId: number | null;
      }
    | undefined
  > {
    const res = await tx.execute(
      sql`SELECT id, name, email, phone, company_id FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          id: Number(r.id),
          name: s(r.name),
          email: s(r.email),
          phone: s(r.phone),
          companyId: n(r.company_id),
        }
      : undefined;
  }

  async resolveContactById(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<
    | {
        id: number;
        name: string | null;
        email: string | null;
        phone: string | null;
        companyId: number | null;
      }
    | undefined
  > {
    const res = await tx.execute(
      sql`SELECT id, name, email, phone, company_id FROM contacts WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          id: Number(r.id),
          name: s(r.name),
          email: s(r.email),
          phone: s(r.phone),
          companyId: n(r.company_id),
        }
      : undefined;
  }

  async resolveDeal(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; contactId: number | null; companyId: number | null } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, contact_id, company_id FROM deals WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r
      ? { id: Number(r.id), contactId: n(r.contact_id), companyId: n(r.company_id) }
      : undefined;
  }

  async resolveCompany(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; name: string | null } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, name FROM companies WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? { id: Number(r.id), name: s(r.name) } : undefined;
  }

  async isInActorTeam(
    tx: Tx,
    orgId: number,
    actorUserId: number,
    userId: number,
    /** `team_and_below`: a person in a team under one of the actor's teams counts too. */
    below = false,
  ): Promise<boolean> {
    return isTeamPeer(tx, orgId, actorUserId, userId, below);
  }

  /** The workspace's time zone and currency (settings jsonb of the organization). */
  async orgSettings(
    tx: Tx,
    orgId: number,
  ): Promise<{ timezone: string | null; currency: string | null; name: string }> {
    const res = await tx.execute(
      sql`SELECT settings ->> 'timezone' AS timezone, settings ->> 'currency' AS currency, name FROM organizations WHERE id = ${orgId}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return { timezone: s(r?.timezone), currency: s(r?.currency), name: (r?.name as string) ?? '' };
  }

  // --- timeline --------------------------------------------------------------------------------------------------------------

  async log(
    tx: Tx,
    orgId: number,
    invoiceId: number,
    entry: {
      event: string;
      detail?: string | null;
      actorKind: 'user' | 'buyer' | 'gateway' | 'system';
      actorUserId?: number | null;
      meta?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO invoice_logs (org_id, invoice_id, event, detail, meta_json, actor_kind, actor_user_id)
      VALUES (${orgId}, ${invoiceId}, ${entry.event}, ${entry.detail ?? null},
              ${entry.meta ? JSON.stringify(entry.meta) : null}::jsonb, ${entry.actorKind}, ${entry.actorUserId ?? null})
    `);
  }

  async events(
    tx: Tx,
    orgId: number,
    invoiceId: number,
    opts: { limit: number; cursor?: string },
  ): Promise<
    Array<{
      id: number;
      createdAtIso: string;
      createdAt: Date;
      event: string;
      detail: string | null;
      actorKind: 'user' | 'buyer' | 'gateway' | 'system';
      actorUuid: string | null;
      actorName: string | null;
      meta: Record<string, unknown> | null;
    }>
  > {
    const conds: SQL[] = [sql`l.org_id = ${orgId}`, sql`l.invoice_id = ${invoiceId}`];
    if (opts.cursor) {
      const c = decodeCursor(opts.cursor);
      conds.push(
        sql`(l.created_at, l.id) < (${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz, ${c.id})`,
      );
    }
    const res = await tx.execute(sql`
      SELECT l.id, l.created_at, to_char(l.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso,
             l.event, l.detail, l.actor_kind, u.uuid AS actor_uuid, u.full_name AS actor_name, l.meta_json
      FROM invoice_logs l LEFT JOIN users u ON u.org_id = l.org_id AND u.id = l.actor_user_id
      WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY l.created_at DESC, l.id DESC LIMIT ${opts.limit + 1}
    `);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      createdAt: new Date(r.created_at as string),
      createdAtIso: r.created_at_iso as string,
      event: r.event as string,
      detail: s(r.detail),
      actorKind: r.actor_kind as 'user' | 'buyer' | 'gateway' | 'system',
      actorUuid: s(r.actor_uuid),
      actorName: s(r.actor_name),
      meta: (r.meta_json as Record<string, unknown> | null) ?? null,
    }));
  }

  // --- linked-record rollups -------------------------------------------------------------------------------------------------

  /** Money rolled up per currency over the invoices of one contact or deal (drafts and void ones excluded from every figure). */
  async rollup(
    tx: Tx,
    orgId: number,
    link: { contactId?: number; dealId?: number },
    tz: string,
  ): Promise<
    Array<{
      currency: string;
      invoiced: bigint;
      paid: bigint;
      outstanding: bigint;
      overdue: bigint;
    }>
  > {
    const cond =
      link.contactId !== undefined
        ? sql`i.contact_id = ${link.contactId}`
        : sql`i.deal_id = ${link.dealId ?? 0}`;
    const res = await tx.execute(sql`
      SELECT i.currency, sum(i.total_minor)::text AS invoiced, sum(i.paid_minor)::text AS paid,
             sum(greatest(i.total_minor - i.paid_minor - i.credited_minor, 0))::text AS outstanding,
             coalesce(sum(greatest(i.total_minor - i.paid_minor - i.credited_minor, 0)) FILTER (WHERE i.due_date < ${todayExpr(tz)}), 0)::text AS overdue
      FROM invoices i
      WHERE i.org_id = ${orgId} AND ${cond} AND i.status = 'issued'
      GROUP BY i.currency ORDER BY i.currency
    `);
    return (res.rows as Raw[]).map((r) => ({
      currency: r.currency as string,
      invoiced: big(r.invoiced),
      paid: big(r.paid),
      outstanding: big(r.outstanding),
      overdue: big(r.overdue),
    }));
  }
}
