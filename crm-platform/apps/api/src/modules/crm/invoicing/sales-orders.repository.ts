import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { ListSalesOrdersQuery, RecordScope, SalesOrderStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

export interface SalesOrderRow {
  id: number;
  uuid: string;
  createdAt: Date;
  createdAtIso: string;
  number: string;
  status: SalesOrderStatus;
  quoteId: number | null;
  quoteUuid: string | null;
  quoteNumber: string | null;
  quoteKind: 'proposal' | 'estimate' | null;
  contactId: number | null;
  contactUuid: string | null;
  contactName: string | null;
  companyId: number | null;
  dealId: number | null;
  dealUuid: string | null;
  dealTitle: string | null;
  ownerId: number | null;
  ownerUuid: string | null;
  ownerName: string | null;
  createdBy: number | null;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  currency: string;
  currencyExponent: number;
  /** Net of line discounts. */
  subtotalMinor: bigint;
  shippingMinor: bigint;
  taxMinor: bigint;
  taxAddedMinor: bigint;
  totalMinor: bigint;
  shippingInvoiced: boolean;
  reference: string | null;
  expectedDate: string | null;
  notes: string | null;
  terms: string | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  rowVersion: number;
  invoiceCount: number;
  /** Sums of the lines' quantities, for the two progress statuses. */
  qtyTotal: string;
  qtyInvoiced: string;
  qtyFulfilled: string;
}

export interface SalesOrderItemRow {
  id: number;
  uuid: string;
  position: number;
  description: string;
  sku: string | null;
  hsnSac: string | null;
  qty: string;
  qtyInvoiced: string;
  qtyFulfilled: string;
  unitPriceMinor: bigint;
  discountKind: string;
  discountValue: bigint;
  discountInvoicedMinor: bigint;
  taxRateId: number | null;
  taxName: string | null;
  taxType: string | null;
  taxInclusive: boolean;
  taxItems: Array<{ code: string; name: string; ratePercent: string }> | null;
  taxRatePercent: string;
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

export interface SalesOrderItemInsert {
  position: number;
  description: string;
  sku: string | null;
  hsnSac: string | null;
  qty: string;
  unitPriceMinor: bigint;
  discountKind: string;
  discountValue: bigint;
  taxRateId: number | null;
  taxName: string | null;
  taxType: string | null;
  taxInclusive: boolean;
  taxItems: unknown[] | null;
  taxRatePercent: string;
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  currency: string;
}

export interface QuoteForOrder {
  id: number;
  uuid: string;
  number: string;
  status: string;
  docType: string;
  contactId: number | null;
  companyId: number | null;
  dealId: number | null;
  ownerId: number | null;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  currency: string;
  taxRateBp: number;
  discountMinor: bigint;
  notes: string | null;
  terms: string | null;
  items: Array<{
    description: string;
    qty: string;
    unitPriceMinor: bigint;
    discountKind: string;
    discountValue: bigint;
    taxRateBp: number | null;
    grossMinor: bigint;
    netMinor: bigint;
  }>;
}

type Raw = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const big = (v: unknown): bigint => BigInt(v as string | number);
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

/** The progress statuses, as SQL over the sums (the list filters and the counts use the same definitions as the response). */
const invoicingExpr = sql`(CASE WHEN x.qi = 0 THEN 'not_invoiced' WHEN x.qi >= x.qt THEN 'invoiced' ELSE 'partially_invoiced' END)`;
const fulfilmentExpr = sql`(CASE WHEN x.qf = 0 THEN 'unfulfilled' WHEN x.qf >= x.qt THEN 'fulfilled' ELSE 'partially_fulfilled' END)`;
const SUMS = sql`LEFT JOIN LATERAL (
    SELECT coalesce(sum(i.qty), 0) AS qt, coalesce(sum(i.qty_invoiced), 0) AS qi, coalesce(sum(i.qty_fulfilled), 0) AS qf
    FROM sales_order_items i WHERE i.org_id = o.org_id AND i.order_id = o.id) x ON true`;

const SELECT = sql`
  SELECT o.id, o.uuid, o.created_at, to_char(o.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso, o.number, o.status,
         o.quote_id, q.uuid AS quote_uuid, q.number AS quote_number, q.doc_type AS quote_kind,
         o.contact_id, c.uuid AS contact_uuid, c.name AS contact_name, o.company_id,
         o.deal_id, dl.uuid AS deal_uuid, dl.title AS deal_title,
         o.owner_id, ou.uuid AS owner_uuid, ou.full_name AS owner_name, o.created_by,
         o.buyer_name, o.buyer_email, o.buyer_phone, o.currency, o.currency_exponent,
         o.subtotal_minor::text, o.shipping_minor::text, o.tax_minor::text, o.tax_added_minor::text, o.total_minor::text,
         o.shipping_invoiced, o.reference, to_char(o.expected_date, 'YYYY-MM-DD') AS expected_date, o.notes, o.terms,
         o.confirmed_at, o.cancelled_at, o.cancel_reason, o.row_version,
         (SELECT count(*) FROM invoices i WHERE i.org_id = o.org_id AND i.sales_order_id = o.id AND i.status <> 'void')::int AS invoice_count,
         x.qt::text AS qty_total, x.qi::text AS qty_invoiced, x.qf::text AS qty_fulfilled
  FROM sales_orders o
  LEFT JOIN sales_docs q ON q.org_id = o.org_id AND q.id = o.quote_id
  LEFT JOIN contacts c ON c.org_id = o.org_id AND c.id = o.contact_id
  LEFT JOIN deals dl ON dl.org_id = o.org_id AND dl.id = o.deal_id
  LEFT JOIN users ou ON ou.org_id = o.org_id AND ou.id = o.owner_id
  ${SUMS}
`;

const toRow = (r: Raw): SalesOrderRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  createdAt: new Date(r.created_at as string),
  createdAtIso: r.created_at_iso as string,
  number: r.number as string,
  status: r.status as SalesOrderStatus,
  quoteId: n(r.quote_id),
  quoteUuid: s(r.quote_uuid),
  quoteNumber: s(r.quote_number),
  quoteKind: (s(r.quote_kind) as 'proposal' | 'estimate' | null) ?? null,
  contactId: n(r.contact_id),
  contactUuid: s(r.contact_uuid),
  contactName: s(r.contact_name),
  companyId: n(r.company_id),
  dealId: n(r.deal_id),
  dealUuid: s(r.deal_uuid),
  dealTitle: s(r.deal_title),
  ownerId: n(r.owner_id),
  ownerUuid: s(r.owner_uuid),
  ownerName: s(r.owner_name),
  createdBy: n(r.created_by),
  buyerName: s(r.buyer_name),
  buyerEmail: s(r.buyer_email),
  buyerPhone: s(r.buyer_phone),
  currency: r.currency as string,
  currencyExponent: Number(r.currency_exponent),
  subtotalMinor: big(r.subtotal_minor),
  shippingMinor: big(r.shipping_minor),
  taxMinor: big(r.tax_minor),
  taxAddedMinor: big(r.tax_added_minor),
  totalMinor: big(r.total_minor),
  shippingInvoiced: r.shipping_invoiced as boolean,
  reference: s(r.reference),
  expectedDate: s(r.expected_date),
  notes: s(r.notes),
  terms: s(r.terms),
  confirmedAt: d(r.confirmed_at),
  cancelledAt: d(r.cancelled_at),
  cancelReason: s(r.cancel_reason),
  rowVersion: Number(r.row_version),
  invoiceCount: Number(r.invoice_count),
  qtyTotal: r.qty_total as string,
  qtyInvoiced: r.qty_invoiced as string,
  qtyFulfilled: r.qty_fulfilled as string,
});

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** An order's people are its owner and creator. */
export function orderScopeCondition(
  orgId: number,
  scope: RecordScope,
  actorUserId: number | null,
): SQL | undefined {
  if (scope === 'all') return undefined;
  if (!actorUserId) return sql`false`;
  const own = sql`(o.owner_id = ${actorUserId} OR o.created_by = ${actorUserId})`;
  if (scope === 'own') return own;
  const peers = sql`(SELECT tm2.user_id FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId})`;
  return sql`(${own} OR o.owner_id IN ${peers} OR o.created_by IN ${peers})`;
}

@Injectable()
export class SalesOrdersRepository {
  async list(
    tx: Tx,
    orgId: number,
    query: ListSalesOrdersQuery,
    scope: SQL | undefined,
  ): Promise<SalesOrderRow[]> {
    const conds: SQL[] = [sql`o.org_id = ${orgId}`];
    if (scope) conds.push(scope);
    if (query.status?.length)
      conds.push(
        sql`o.status IN (${sql.join(
          query.status.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
    if (query.invoicingStatus?.length)
      conds.push(
        sql`${invoicingExpr} IN (${sql.join(
          query.invoicingStatus.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
    if (query.fulfilmentStatus?.length)
      conds.push(
        sql`${fulfilmentExpr} IN (${sql.join(
          query.fulfilmentStatus.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
    if (query.contactId)
      conds.push(
        sql`o.contact_id = (SELECT y.id FROM contacts y WHERE y.org_id = ${orgId} AND y.uuid = ${query.contactId}::uuid)`,
      );
    if (query.dealId)
      conds.push(
        sql`o.deal_id = (SELECT y.id FROM deals y WHERE y.org_id = ${orgId} AND y.uuid = ${query.dealId}::uuid)`,
      );
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      conds.push(
        sql`(o.number ILIKE ${like} OR o.buyer_name ILIKE ${like} OR o.reference ILIKE ${like})`,
      );
    }
    if (query.cursor) {
      const cur = decodeCursor(query.cursor);
      conds.push(
        sql`(o.created_at, o.id) < (${cur.createdAtIso ?? cur.createdAt.toISOString()}::timestamptz, ${cur.id})`,
      );
    }
    const res = await tx.execute(sql`
      ${SELECT} WHERE ${sql.join(conds, sql` AND `)} ORDER BY o.created_at DESC, o.id DESC LIMIT ${query.limit + 1}
    `);
    return (res.rows as Raw[]).map(toRow);
  }

  async counts(tx: Tx, orgId: number, scope: SQL | undefined) {
    const res = await tx.execute(sql`
      SELECT o.status, o.currency, count(*)::int AS cnt, sum(o.total_minor)::text AS total,
             count(*) FILTER (WHERE o.status = 'confirmed' AND x.qi < x.qt)::int AS to_invoice,
             count(*) FILTER (WHERE o.status = 'confirmed' AND x.qf < x.qt)::int AS to_fulfil
      FROM sales_orders o ${SUMS}
      WHERE o.org_id = ${orgId} ${scope ? sql`AND ${scope}` : sql``}
      GROUP BY o.status, o.currency
    `);
    return (res.rows as Raw[]).map((r) => ({
      status: r.status as string,
      currency: r.currency as string,
      count: Number(r.cnt),
      total: big(r.total),
      toInvoice: Number(r.to_invoice),
      toFulfil: Number(r.to_fulfil),
    }));
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<SalesOrderRow | undefined> {
    if (forUpdate)
      await tx.execute(
        sql`SELECT 1 FROM sales_orders WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
      );
    const res = await tx.execute(
      sql`${SELECT} WHERE o.org_id = ${orgId} AND o.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<SalesOrderRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE o.org_id = ${orgId} AND o.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async items(
    tx: Tx,
    orgId: number,
    orderId: number,
    forUpdate = false,
  ): Promise<SalesOrderItemRow[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, sort, description, sku, hsn_sac, qty::text AS qty, qty_invoiced::text AS qty_invoiced,
             qty_fulfilled::text AS qty_fulfilled, unit_price_minor::text AS unit_price_minor, discount_kind,
             discount_value::text AS discount_value, discount_invoiced_minor::text AS discount_invoiced_minor, tax_rate_id,
             tax_name, tax_type, tax_inclusive, tax_items, tax_rate_percent::text AS tax_rate_percent,
             line_subtotal_minor::text AS subtotal, line_discount_minor::text AS discount, tax_amount_minor::text AS tax,
             line_total_minor::text AS total
      FROM sales_order_items WHERE org_id = ${orgId} AND order_id = ${orderId} ORDER BY sort, id
      ${forUpdate ? sql`FOR UPDATE` : sql``}
    `);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid as string,
      position: Number(r.sort),
      description: r.description as string,
      sku: s(r.sku),
      hsnSac: s(r.hsn_sac),
      qty: r.qty as string,
      qtyInvoiced: r.qty_invoiced as string,
      qtyFulfilled: r.qty_fulfilled as string,
      unitPriceMinor: big(r.unit_price_minor),
      discountKind: r.discount_kind as string,
      discountValue: big(r.discount_value),
      discountInvoicedMinor: big(r.discount_invoiced_minor),
      taxRateId: n(r.tax_rate_id),
      taxName: s(r.tax_name),
      taxType: s(r.tax_type),
      taxInclusive: r.tax_inclusive as boolean,
      taxItems: (r.tax_items as SalesOrderItemRow['taxItems']) ?? null,
      taxRatePercent: r.tax_rate_percent as string,
      subtotalMinor: big(r.subtotal),
      discountMinor: big(r.discount),
      taxMinor: big(r.tax),
      totalMinor: big(r.total),
    }));
  }

  async invoices(tx: Tx, orgId: number, orderId: number) {
    const res = await tx.execute(sql`
      SELECT uuid, invoice_number, status, payment_status, total_minor::text AS total, currency
      FROM invoices WHERE org_id = ${orgId} AND sales_order_id = ${orderId} ORDER BY id
    `);
    return (res.rows as Raw[]).map((r) => ({
      uuid: r.uuid as string,
      number: s(r.invoice_number),
      status: r.status as string,
      paymentStatus: r.payment_status as string,
      totalMinor: big(r.total),
      currency: r.currency as string,
    }));
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      series: string;
      seq: number;
      number: string;
      quoteId: number | null;
      contactId: number | null;
      companyId: number | null;
      dealId: number | null;
      ownerId: number | null;
      createdBy: number | null;
      buyerName: string | null;
      buyerEmail: string | null;
      buyerPhone: string | null;
      currency: string;
      currencyExponent: number;
      reference: string | null;
      expectedDate: string | null;
      notes: string | null;
      terms: string | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO sales_orders (org_id, series, seq, number, quote_id, contact_id, company_id, deal_id, owner_id, created_by, buyer_name,
                                buyer_email, buyer_phone, currency, currency_exponent, reference, expected_date, notes, terms)
      VALUES (${orgId}, ${v.series}, ${v.seq}, ${v.number}, ${v.quoteId}, ${v.contactId}, ${v.companyId}, ${v.dealId}, ${v.ownerId},
              ${v.createdBy}, ${v.buyerName}, ${v.buyerEmail}, ${v.buyerPhone}, ${v.currency}, ${v.currencyExponent}, ${v.reference},
              ${v.expectedDate}::date, ${v.notes}, ${v.terms})
      RETURNING id
    `);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  async updateHeader(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number | null,
    p: Partial<{
      buyerName: string | null;
      buyerEmail: string | null;
      buyerPhone: string | null;
      contactId: number | null;
      companyId: number | null;
      dealId: number | null;
      ownerId: number | null;
      reference: string | null;
      expectedDate: string | null;
      notes: string | null;
      terms: string | null;
      totals: {
        subtotalMinor: bigint;
        shippingMinor: bigint;
        taxMinor: bigint;
        taxAddedMinor: bigint;
        totalMinor: bigint;
      };
      status: string;
      confirmedAt: boolean;
      cancelled: string;
      shippingInvoiced: boolean;
    }>,
  ): Promise<boolean> {
    const sets: SQL[] = [];
    if (p.buyerName !== undefined) sets.push(sql`buyer_name = ${p.buyerName}`);
    if (p.buyerEmail !== undefined) sets.push(sql`buyer_email = ${p.buyerEmail}`);
    if (p.buyerPhone !== undefined) sets.push(sql`buyer_phone = ${p.buyerPhone}`);
    if (p.contactId !== undefined) sets.push(sql`contact_id = ${p.contactId}`);
    if (p.companyId !== undefined) sets.push(sql`company_id = ${p.companyId}`);
    if (p.dealId !== undefined) sets.push(sql`deal_id = ${p.dealId}`);
    if (p.ownerId !== undefined) sets.push(sql`owner_id = ${p.ownerId}`);
    if (p.reference !== undefined) sets.push(sql`reference = ${p.reference}`);
    if (p.expectedDate !== undefined) sets.push(sql`expected_date = ${p.expectedDate}::date`);
    if (p.notes !== undefined) sets.push(sql`notes = ${p.notes}`);
    if (p.terms !== undefined) sets.push(sql`terms = ${p.terms}`);
    if (p.totals)
      sets.push(
        sql`subtotal_minor = ${p.totals.subtotalMinor.toString()}::bigint, shipping_minor = ${p.totals.shippingMinor.toString()}::bigint,
            tax_minor = ${p.totals.taxMinor.toString()}::bigint, tax_added_minor = ${p.totals.taxAddedMinor.toString()}::bigint,
            total_minor = ${p.totals.totalMinor.toString()}::bigint`,
      );
    if (p.status !== undefined) sets.push(sql`status = ${p.status}`);
    if (p.confirmedAt) sets.push(sql`confirmed_at = coalesce(confirmed_at, now())`);
    if (p.cancelled !== undefined)
      sets.push(sql`cancelled_at = now(), cancel_reason = ${p.cancelled}`);
    if (p.shippingInvoiced !== undefined) sets.push(sql`shipping_invoiced = ${p.shippingInvoiced}`);
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE sales_orders SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} ${rowVersion !== null ? sql`AND row_version = ${rowVersion}` : sql``}
      RETURNING id
    `);
    return res.rows.length > 0;
  }

  async replaceItems(
    tx: Tx,
    orgId: number,
    orderId: number,
    items: SalesOrderItemInsert[],
  ): Promise<void> {
    await tx.execute(
      sql`DELETE FROM sales_order_items WHERE org_id = ${orgId} AND order_id = ${orderId}`,
    );
    for (const i of items) {
      await tx.execute(sql`
        INSERT INTO sales_order_items (org_id, order_id, sort, description, sku, hsn_sac, qty, unit_price_minor, discount_kind, discount_value,
          tax_rate_id, tax_name, tax_type, tax_inclusive, tax_items, tax_rate_percent, line_subtotal_minor, line_discount_minor,
          tax_amount_minor, line_total_minor, currency)
        VALUES (${orgId}, ${orderId}, ${i.position}, ${i.description}, ${i.sku}, ${i.hsnSac}, ${i.qty}::numeric,
          ${i.unitPriceMinor.toString()}::bigint, ${i.discountKind}, ${i.discountValue.toString()}::bigint, ${i.taxRateId}, ${i.taxName},
          ${i.taxType}, ${i.taxInclusive}, ${i.taxItems ? JSON.stringify(i.taxItems) : null}::jsonb, ${i.taxRatePercent}::numeric,
          ${i.subtotalMinor.toString()}::bigint, ${i.discountMinor.toString()}::bigint, ${i.taxMinor.toString()}::bigint,
          ${i.totalMinor.toString()}::bigint, ${i.currency})
      `);
    }
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM sales_orders WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async addProgress(
    tx: Tx,
    orgId: number,
    itemId: number,
    v: { invoiced?: string; fulfilled?: string; discountInvoicedMinor?: bigint },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE sales_order_items SET
        qty_invoiced = qty_invoiced + ${v.invoiced ?? '0'}::numeric,
        qty_fulfilled = qty_fulfilled + ${v.fulfilled ?? '0'}::numeric,
        discount_invoiced_minor = least(line_discount_minor, discount_invoiced_minor + ${(v.discountInvoicedMinor ?? 0n).toString()}::bigint)
      WHERE org_id = ${orgId} AND id = ${itemId}
    `);
  }

  /** Links an order's invoice: the invoice and each of its lines name what they bill. Lines are matched by position. */
  async linkInvoice(
    tx: Tx,
    orgId: number,
    invoiceId: number,
    orderId: number,
    itemByPosition: Array<number | null>,
  ): Promise<void> {
    await tx.execute(
      sql`UPDATE invoices SET sales_order_id = ${orderId} WHERE org_id = ${orgId} AND id = ${invoiceId}`,
    );
    for (const [position, itemId] of itemByPosition.entries()) {
      if (itemId === null) continue;
      await tx.execute(sql`
        UPDATE invoice_items SET sales_order_item_id = ${itemId} WHERE org_id = ${orgId} AND invoice_id = ${invoiceId} AND sort = ${position}
      `);
    }
  }

  /** The accepted offer an order starts from, with its lines. Null when it is not in the workspace. */
  async quote(tx: Tx, orgId: number, uuid: string): Promise<QuoteForOrder | undefined> {
    const res = await tx.execute(sql`
      SELECT id, uuid, number, status, doc_type, contact_id, company_id, deal_id, owner_id, buyer_name, buyer_email, buyer_phone, currency,
             tax_rate_bp, discount_minor::text AS discount_minor, notes, terms
      FROM sales_docs WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid
    `);
    const r = (res.rows as Raw[])[0];
    if (!r) return undefined;
    const items = await tx.execute(sql`
      SELECT description, qty::text AS qty, unit_price_minor::text AS unit_price_minor, discount_kind, discount_value::text AS discount_value,
             tax_rate_bp, gross_minor::text AS gross_minor, net_minor::text AS net_minor
      FROM sales_doc_items WHERE org_id = ${orgId} AND doc_id = ${Number(r.id)} ORDER BY position
    `);
    return {
      id: Number(r.id),
      uuid: r.uuid as string,
      number: r.number as string,
      status: r.status as string,
      docType: r.doc_type as string,
      contactId: n(r.contact_id),
      companyId: n(r.company_id),
      dealId: n(r.deal_id),
      ownerId: n(r.owner_id),
      buyerName: s(r.buyer_name),
      buyerEmail: s(r.buyer_email),
      buyerPhone: s(r.buyer_phone),
      currency: r.currency as string,
      taxRateBp: Number(r.tax_rate_bp ?? 0),
      discountMinor: big(r.discount_minor),
      notes: s(r.notes),
      terms: s(r.terms),
      items: (items.rows as Raw[]).map((i) => ({
        description: i.description as string,
        qty: i.qty as string,
        unitPriceMinor: big(i.unit_price_minor),
        discountKind: i.discount_kind as string,
        discountValue: big(i.discount_value),
        taxRateBp: n(i.tax_rate_bp),
        grossMinor: big(i.gross_minor),
        netMinor: big(i.net_minor),
      })),
    };
  }

  /** Gives an invoice's billed quantities back to its order (the invoice was voided or deleted). */
  async releaseInvoice(
    tx: Tx,
    orgId: number,
    invoiceId: number,
  ): Promise<{ orderId: number | null; shippingReleased: boolean }> {
    const inv = await tx.execute(
      sql`SELECT sales_order_id, shipping_minor::text AS shipping FROM invoices WHERE org_id = ${orgId} AND id = ${invoiceId}`,
    );
    const row = (inv.rows as Raw[])[0];
    const orderId = row ? n(row.sales_order_id) : null;
    if (orderId === null) return { orderId: null, shippingReleased: false };
    await tx.execute(sql`
      UPDATE sales_order_items so SET
        qty_invoiced = greatest(0, so.qty_invoiced - r.qty),
        discount_invoiced_minor = greatest(0, so.discount_invoiced_minor - r.disc)
      FROM (SELECT sales_order_item_id AS item_id, sum(qty) AS qty, sum(line_discount_minor) AS disc
            FROM invoice_items WHERE org_id = ${orgId} AND invoice_id = ${invoiceId} AND sales_order_item_id IS NOT NULL
            GROUP BY sales_order_item_id) r
      WHERE so.org_id = ${orgId} AND so.id = r.item_id
    `);
    const shipping = big(row!.shipping) > 0n;
    if (shipping)
      await tx.execute(
        sql`UPDATE sales_orders SET shipping_invoiced = false WHERE org_id = ${orgId} AND id = ${orderId}`,
      );
    return { orderId, shippingReleased: shipping };
  }

  async orderOfInvoice(tx: Tx, orgId: number, invoiceId: number): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT sales_order_id FROM invoices WHERE org_id = ${orgId} AND id = ${invoiceId}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? n(r.sales_order_id) : null;
  }

  /** Re-derives `confirmed` / `closed` from the quantities (closed = everything billed and delivered). */
  async syncStatus(tx: Tx, orgId: number, orderId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE sales_orders o SET status = CASE
          WHEN x.qi >= x.qt AND x.qf >= x.qt AND x.qt > 0 THEN 'closed' ELSE 'confirmed' END
      FROM (SELECT coalesce(sum(qty), 0) AS qt, coalesce(sum(qty_invoiced), 0) AS qi, coalesce(sum(qty_fulfilled), 0) AS qf
            FROM sales_order_items WHERE org_id = ${orgId} AND order_id = ${orderId}) x
      WHERE o.org_id = ${orgId} AND o.id = ${orderId} AND o.status IN ('confirmed', 'closed')
    `);
  }

  async visible(tx: Tx, orgId: number, id: number, scope: SQL | undefined): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM sales_orders o WHERE o.org_id = ${orgId} AND o.id = ${id} ${scope ? sql`AND ${scope}` : sql``}`,
    );
    return res.rows.length > 0;
  }
}
