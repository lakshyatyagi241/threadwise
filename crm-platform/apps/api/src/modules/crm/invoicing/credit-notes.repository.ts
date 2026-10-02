import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { CreditNoteReason, CreditNoteSettlement, CreditNoteStatus, ListCreditNotesQuery, RecordScope } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

export interface CreditNoteRow {
  id: number;
  uuid: string;
  createdAtIso: string;
  createdAt: Date;
  invoiceId: number;
  invoiceUuid: string;
  invoiceNumber: string | null;
  number: string | null;
  series: string | null;
  seq: number | null;
  status: CreditNoteStatus;
  reason: CreditNoteReason;
  note: string | null;
  settlement: CreditNoteSettlement;
  currency: string;
  currencyExponent: number;
  subtotalMinor: bigint;
  taxMinor: bigint;
  taxAddedMinor: bigint;
  totalMinor: bigint;
  refundedMinor: bigint;
  taxSummary: Array<{ name: string; type: string | null; ratePercent: string; inclusive: boolean; baseMinor: string; taxMinor: string }> | null;
  issueDate: string | null;
  issuedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  buyerName: string | null;
  invoiceOwnerId: number | null;
  invoiceCreatedBy: number | null;
  rowVersion: number;
}

export interface CreditNoteItemRow {
  id: number;
  uuid: string;
  position: number;
  invoiceItemId: number | null;
  invoiceItemUuid: string | null;
  description: string;
  hsnSac: string | null;
  qty: string;
  amountMinor: bigint;
  taxName: string | null;
  taxRatePercent: string;
  taxInclusive: boolean;
  taxMinor: bigint;
  totalMinor: bigint;
}

export interface CreditNoteItemInsert {
  position: number;
  invoiceItemId: number | null;
  description: string;
  hsnSac: string | null;
  qty: string;
  amountMinor: bigint;
  taxName: string | null;
  taxType: string | null;
  taxRatePercent: string;
  taxInclusive: boolean;
  taxMinor: bigint;
  totalMinor: bigint;
  taxComponents: unknown[] | null;
  currency: string;
}

type Raw = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const big = (v: unknown): bigint => BigInt(v as string | number);
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

const SELECT = sql`
  SELECT c.id, c.uuid, c.created_at, to_char(c.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso,
         c.invoice_id, i.uuid AS invoice_uuid, i.invoice_number, c.credit_number, c.series, c.seq, c.status, c.reason, c.note,
         c.settlement, c.currency, c.currency_exponent, c.subtotal_minor::text, c.tax_minor::text, c.tax_added_minor::text,
         c.total_minor::text, c.refunded_minor::text, c.tax_summary, to_char(c.issue_date, 'YYYY-MM-DD') AS issue_date,
         c.issued_at, c.voided_at, c.void_reason, i.buyer_name, i.owner_id AS invoice_owner_id, i.user_id AS invoice_created_by,
         c.row_version
  FROM credit_notes c
  JOIN invoices i ON i.org_id = c.org_id AND i.id = c.invoice_id
`;

const toRow = (r: Raw): CreditNoteRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  createdAt: new Date(r.created_at as string),
  createdAtIso: r.created_at_iso as string,
  invoiceId: Number(r.invoice_id),
  invoiceUuid: r.invoice_uuid as string,
  invoiceNumber: s(r.invoice_number),
  number: s(r.credit_number),
  series: s(r.series),
  seq: n(r.seq),
  status: r.status as CreditNoteStatus,
  reason: r.reason as CreditNoteReason,
  note: s(r.note),
  settlement: r.settlement as CreditNoteSettlement,
  currency: r.currency as string,
  currencyExponent: Number(r.currency_exponent),
  subtotalMinor: big(r.subtotal_minor),
  taxMinor: big(r.tax_minor),
  taxAddedMinor: big(r.tax_added_minor),
  totalMinor: big(r.total_minor),
  refundedMinor: big(r.refunded_minor),
  taxSummary: (r.tax_summary as CreditNoteRow['taxSummary']) ?? null,
  issueDate: s(r.issue_date),
  issuedAt: d(r.issued_at),
  voidedAt: d(r.voided_at),
  voidReason: s(r.void_reason),
  buyerName: s(r.buyer_name),
  invoiceOwnerId: n(r.invoice_owner_id),
  invoiceCreatedBy: n(r.invoice_created_by),
  rowVersion: Number(r.row_version),
});

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A credit note's people are its invoice's: owned or created by the caller (or a teammate). */
export function creditNoteScopeCondition(orgId: number, scope: RecordScope, actorUserId: number | null): SQL | undefined {
  if (scope === 'all') return undefined;
  if (!actorUserId) return sql`false`;
  const own = sql`(i.owner_id = ${actorUserId} OR i.user_id = ${actorUserId})`;
  if (scope === 'own') return own;
  const peers = sql`(SELECT tm2.user_id FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId})`;
  return sql`(${own} OR i.owner_id IN ${peers} OR i.user_id IN ${peers})`;
}

@Injectable()
export class CreditNotesRepository {
  async list(tx: Tx, orgId: number, query: ListCreditNotesQuery, scope: SQL | undefined): Promise<CreditNoteRow[]> {
    const conds: SQL[] = [sql`c.org_id = ${orgId}`];
    if (scope) conds.push(scope);
    if (query.status?.length)
      conds.push(sql`c.status IN (${sql.join(query.status.map((x) => sql`${x}`), sql`, `)})`);
    if (query.invoiceId)
      conds.push(sql`c.invoice_id = (SELECT x.id FROM invoices x WHERE x.org_id = ${orgId} AND x.uuid = ${query.invoiceId}::uuid)`);
    if (query.contactId)
      conds.push(sql`i.contact_id = (SELECT x.id FROM contacts x WHERE x.org_id = ${orgId} AND x.uuid = ${query.contactId}::uuid)`);
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      conds.push(sql`(c.credit_number ILIKE ${like} OR i.invoice_number ILIKE ${like} OR i.buyer_name ILIKE ${like})`);
    }
    if (query.cursor) {
      const cur = decodeCursor(query.cursor);
      conds.push(sql`(c.created_at, c.id) < (${cur.createdAtIso ?? cur.createdAt.toISOString()}::timestamptz, ${cur.id})`);
    }
    const res = await tx.execute(sql`
      ${SELECT} WHERE ${sql.join(conds, sql` AND `)} ORDER BY c.created_at DESC, c.id DESC LIMIT ${query.limit + 1}
    `);
    return (res.rows as Raw[]).map(toRow);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string, forUpdate = false): Promise<CreditNoteRow | undefined> {
    if (forUpdate)
      await tx.execute(sql`SELECT 1 FROM credit_notes WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`);
    const res = await tx.execute(sql`${SELECT} WHERE c.org_id = ${orgId} AND c.uuid = ${uuid}::uuid`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<CreditNoteRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE c.org_id = ${orgId} AND c.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async items(tx: Tx, orgId: number, creditNoteId: number): Promise<CreditNoteItemRow[]> {
    const res = await tx.execute(sql`
      SELECT ci.id, ci.uuid, ci.sort, ci.invoice_item_id, ii.uuid AS invoice_item_uuid, ci.description, ci.hsn_sac, ci.qty::text AS qty,
             ci.unit_price_minor::text AS amount_minor, ci.tax_name, ci.tax_rate_percent::text AS tax_rate_percent, ci.tax_inclusive,
             ci.tax_amount_minor::text AS tax_minor, ci.line_total_minor::text AS total_minor
      FROM credit_note_items ci LEFT JOIN invoice_items ii ON ii.org_id = ci.org_id AND ii.id = ci.invoice_item_id
      WHERE ci.org_id = ${orgId} AND ci.credit_note_id = ${creditNoteId} ORDER BY ci.sort, ci.id
    `);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid as string,
      position: Number(r.sort),
      invoiceItemId: n(r.invoice_item_id),
      invoiceItemUuid: s(r.invoice_item_uuid),
      description: r.description as string,
      hsnSac: s(r.hsn_sac),
      qty: r.qty as string,
      amountMinor: big(r.amount_minor),
      taxName: s(r.tax_name),
      taxRatePercent: r.tax_rate_percent as string,
      taxInclusive: r.tax_inclusive as boolean,
      taxMinor: big(r.tax_minor),
      totalMinor: big(r.total_minor),
    }));
  }

  /** What each invoice line already has credited by ISSUED credit notes: the creditable quantity and amount shrink with it. */
  async creditedPerLine(
    tx: Tx,
    orgId: number,
    invoiceId: number,
    exceptCreditNoteId?: number,
  ): Promise<Map<number, { qty: string; amountMinor: bigint }>> {
    const res = await tx.execute(sql`
      SELECT ci.invoice_item_id, sum(ci.qty)::text AS qty, sum(ci.line_subtotal_minor)::text AS amount
      FROM credit_note_items ci JOIN credit_notes c ON c.org_id = ci.org_id AND c.id = ci.credit_note_id
      WHERE ci.org_id = ${orgId} AND c.invoice_id = ${invoiceId} AND c.status = 'issued' AND ci.invoice_item_id IS NOT NULL
        ${exceptCreditNoteId !== undefined ? sql`AND c.id <> ${exceptCreditNoteId}` : sql``}
      GROUP BY ci.invoice_item_id
    `);
    return new Map((res.rows as Raw[]).map((r) => [Number(r.invoice_item_id), { qty: r.qty as string, amountMinor: big(r.amount) }]));
  }

  /** True when an issued credit note already exists against the invoice (shipping is credited with the first one only). */
  async hasIssued(tx: Tx, orgId: number, invoiceId: number): Promise<boolean> {
    const res = await tx.execute(sql`SELECT 1 FROM credit_notes WHERE org_id = ${orgId} AND invoice_id = ${invoiceId} AND status = 'issued' LIMIT 1`);
    return res.rows.length > 0;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      invoiceId: number;
      reason: string;
      note: string | null;
      settlement: string;
      currency: string;
      currencyExponent: number;
      subtotalMinor: bigint;
      taxMinor: bigint;
      taxAddedMinor: bigint;
      totalMinor: bigint;
      taxSummary: unknown[];
      issueDate: string | null;
      createdBy: number | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO credit_notes (org_id, invoice_id, reason, note, settlement, currency, currency_exponent, subtotal_minor, tax_minor,
                                tax_added_minor, total_minor, tax_summary, issue_date, created_by)
      VALUES (${orgId}, ${v.invoiceId}, ${v.reason}, ${v.note}, ${v.settlement}, ${v.currency}, ${v.currencyExponent},
              ${v.subtotalMinor.toString()}::bigint, ${v.taxMinor.toString()}::bigint, ${v.taxAddedMinor.toString()}::bigint,
              ${v.totalMinor.toString()}::bigint, ${JSON.stringify(v.taxSummary)}::jsonb, ${v.issueDate}::date, ${v.createdBy})
      RETURNING id
    `);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  async updateDraft(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    v: Partial<{
      reason: string;
      note: string | null;
      settlement: string;
      issueDate: string | null;
      subtotalMinor: bigint;
      taxMinor: bigint;
      taxAddedMinor: bigint;
      totalMinor: bigint;
      taxSummary: unknown[];
    }>,
  ): Promise<boolean> {
    const sets: SQL[] = [];
    if (v.reason !== undefined) sets.push(sql`reason = ${v.reason}`);
    if (v.note !== undefined) sets.push(sql`note = ${v.note}`);
    if (v.settlement !== undefined) sets.push(sql`settlement = ${v.settlement}`);
    if (v.issueDate !== undefined) sets.push(sql`issue_date = ${v.issueDate}::date`);
    if (v.subtotalMinor !== undefined) sets.push(sql`subtotal_minor = ${v.subtotalMinor.toString()}::bigint`);
    if (v.taxMinor !== undefined) sets.push(sql`tax_minor = ${v.taxMinor.toString()}::bigint`);
    if (v.taxAddedMinor !== undefined) sets.push(sql`tax_added_minor = ${v.taxAddedMinor.toString()}::bigint`);
    if (v.totalMinor !== undefined) sets.push(sql`total_minor = ${v.totalMinor.toString()}::bigint`);
    if (v.taxSummary !== undefined) sets.push(sql`tax_summary = ${JSON.stringify(v.taxSummary)}::jsonb`);
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE credit_notes SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion} RETURNING id
    `);
    return res.rows.length > 0;
  }

  async replaceItems(tx: Tx, orgId: number, creditNoteId: number, items: CreditNoteItemInsert[]): Promise<void> {
    await tx.execute(sql`DELETE FROM credit_note_items WHERE org_id = ${orgId} AND credit_note_id = ${creditNoteId}`);
    for (const it of items) {
      await tx.execute(sql`
        INSERT INTO credit_note_items (org_id, credit_note_id, sort, invoice_item_id, description, hsn_sac, qty, unit_price_minor,
                                       line_subtotal_minor, tax_name, tax_type, tax_rate_percent, tax_inclusive, tax_amount_minor,
                                       line_total_minor, tax_components, currency)
        VALUES (${orgId}, ${creditNoteId}, ${it.position}, ${it.invoiceItemId}, ${it.description}, ${it.hsnSac}, ${it.qty}::numeric,
                ${it.amountMinor.toString()}::bigint, ${it.amountMinor.toString()}::bigint, ${it.taxName}, ${it.taxType},
                ${it.taxRatePercent}::numeric, ${it.taxInclusive}, ${it.taxMinor.toString()}::bigint, ${it.totalMinor.toString()}::bigint,
                ${it.taxComponents ? JSON.stringify(it.taxComponents) : null}::jsonb, ${it.currency})
      `);
    }
  }

  async markIssued(
    tx: Tx,
    orgId: number,
    id: number,
    v: { series: string; number: string; seq: number; issueDate: string; refundedMinor: bigint },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE credit_notes SET status = 'issued', series = ${v.series}, credit_number = ${v.number}, seq = ${v.seq},
             issue_date = ${v.issueDate}::date, issued_at = now(), refunded_minor = ${v.refundedMinor.toString()}::bigint
      WHERE org_id = ${orgId} AND id = ${id}
    `);
  }

  async markVoid(tx: Tx, orgId: number, id: number, reason: string): Promise<void> {
    await tx.execute(sql`
      UPDATE credit_notes SET status = 'void', voided_at = now(), void_reason = ${reason} WHERE org_id = ${orgId} AND id = ${id}
    `);
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM credit_notes WHERE org_id = ${orgId} AND id = ${id} AND status = 'draft'`);
  }

  /** Payments of an invoice with something left to refund, newest first: where a cash settlement takes its money from. */
  async refundablePayments(tx: Tx, orgId: number, invoiceId: number): Promise<Array<{ id: number; uuid: string; refundableMinor: bigint }>> {
    const res = await tx.execute(sql`
      SELECT p.id, p.uuid, (p.amount_minor - coalesce((SELECT sum(-r.amount_minor) FROM payments r WHERE r.org_id = p.org_id AND r.refund_of_id = p.id), 0))::text AS refundable
      FROM payments p WHERE p.org_id = ${orgId} AND p.invoice_id = ${invoiceId} AND p.kind = 'payment'
      ORDER BY p.paid_at DESC, p.id DESC
    `);
    return (res.rows as Raw[]).map((r) => ({ id: Number(r.id), uuid: r.uuid as string, refundableMinor: big(r.refundable) })).filter((p) => p.refundableMinor > 0n);
  }
}
