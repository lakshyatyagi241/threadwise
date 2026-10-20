import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  DiscountKind,
  RecordScope,
  SalesDocEventType,
  SalesDocKind,
  SalesDocSource,
  SalesDocStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';
import { DEFAULT_NUMBERING, type NumberingSettings } from './sales-doc-rules';
import { isTeamPeer, scopeOwnerCondition } from '../../../kernel/rbac/scope';

type Raw = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const big = (v: unknown): bigint =>
  v === null || v === undefined ? 0n : BigInt(v as string | number);

/** One document as the SQL returns it, with the people and linked records joined (names and uuids, never internal ids to the wire). */
export interface SalesDocRow {
  id: number;
  uuid: string;
  createdAt: Date;
  /** created_at at microsecond precision (keyset cursor). */
  createdAtIso: string;
  updatedAt: Date;
  rowVersion: number;
  kind: SalesDocKind;
  number: string;
  seq: number;
  status: SalesDocStatus;
  source: SalesDocSource;
  title: string | null;
  /** Encrypted at rest; the service decrypts. */
  buyerNameCipher: string | null;
  buyerEmailCipher: string | null;
  buyerPhoneCipher: string | null;
  notesCipher: string | null;
  terms: string | null;
  currency: string;
  currencyExponent: number;
  subtotalMinor: bigint;
  discountKind: DiscountKind;
  discountValue: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  taxRateBp: number;
  validUntil: string | null;
  sentAt: Date | null;
  decidedAt: Date | null;
  revision: number;
  acceptedRevision: number | null;
  publicTokenHash: string | null;
  publicTokenCipher: string | null;
  tokenExpiresAt: Date | null;
  tokenRevokedAt: Date | null;
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
  viewCount: number;
  contactId: number | null;
  contactUuid: string | null;
  contactName: string | null;
  companyId: number | null;
  companyUuid: string | null;
  companyName: string | null;
  dealId: number | null;
  dealUuid: string | null;
  dealTitle: string | null;
  ownerId: number | null;
  ownerUuid: string | null;
  ownerName: string | null;
  createdById: number | null;
  createdByUuid: string | null;
  createdByName: string | null;
  invoiceId: number | null;
  invoiceUuid: string | null;
  duplicatedFromUuid: string | null;
}

const toRow = (r: Raw): SalesDocRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  createdAt: new Date(r.created_at as string),
  createdAtIso: r.created_at_iso as string,
  updatedAt: new Date(r.updated_at as string),
  rowVersion: Number(r.row_version),
  kind: r.doc_type as SalesDocKind,
  number: r.number as string,
  seq: Number(r.seq),
  status: r.status as SalesDocStatus,
  source: r.source as SalesDocSource,
  title: s(r.title),
  buyerNameCipher: s(r.buyer_name),
  buyerEmailCipher: s(r.buyer_email),
  buyerPhoneCipher: s(r.buyer_phone),
  notesCipher: s(r.notes),
  terms: s(r.terms),
  currency: r.currency as string,
  currencyExponent: Number(r.currency_exponent),
  subtotalMinor: big(r.subtotal_minor),
  discountKind: r.discount_kind as DiscountKind,
  discountValue: big(r.discount_value),
  discountMinor: big(r.discount_minor),
  taxMinor: big(r.tax_minor),
  totalMinor: big(r.total_minor),
  taxRateBp: Number(r.tax_rate_bp),
  validUntil: r.valid_until_text ? (r.valid_until_text as string) : null,
  sentAt: d(r.sent_at),
  decidedAt: d(r.decided_at),
  revision: Number(r.revision),
  acceptedRevision: n(r.accepted_revision),
  publicTokenHash: s(r.public_token_hash),
  publicTokenCipher: s(r.public_token_cipher),
  tokenExpiresAt: d(r.token_expires_at),
  tokenRevokedAt: d(r.token_revoked_at),
  firstViewedAt: d(r.first_viewed_at),
  lastViewedAt: d(r.last_viewed_at),
  viewCount: Number(r.view_count),
  contactId: n(r.contact_id),
  contactUuid: s(r.contact_uuid),
  contactName: s(r.contact_name),
  companyId: n(r.company_id),
  companyUuid: s(r.company_uuid),
  companyName: s(r.company_name),
  dealId: n(r.deal_id),
  dealUuid: s(r.deal_uuid),
  dealTitle: s(r.deal_title),
  ownerId: n(r.owner_id),
  ownerUuid: s(r.owner_uuid),
  ownerName: s(r.owner_name),
  createdById: n(r.created_by),
  createdByUuid: s(r.created_by_uuid),
  createdByName: s(r.created_by_name),
  invoiceId: n(r.invoice_id),
  invoiceUuid: s(r.invoice_uuid),
  duplicatedFromUuid: s(r.duplicated_from_uuid),
});

export interface SalesDocItemRow {
  id: number;
  position: number;
  description: string;
  /** numeric(18,4) as the driver returns it: "2.5000". */
  qty: string;
  unitPriceMinor: bigint;
  discountKind: DiscountKind;
  discountValue: bigint;
  taxRateBp: number | null;
  grossMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  taxMinor: bigint;
}

const toItem = (r: Raw): SalesDocItemRow => ({
  id: Number(r.id),
  position: Number(r.position),
  description: r.description as string,
  qty: r.qty as string,
  unitPriceMinor: big(r.unit_price_minor),
  discountKind: r.discount_kind as DiscountKind,
  discountValue: big(r.discount_value),
  taxRateBp: n(r.tax_rate_bp),
  grossMinor: big(r.gross_minor),
  discountMinor: big(r.discount_minor),
  netMinor: big(r.net_minor),
  taxMinor: big(r.tax_minor),
});

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

const SELECT = sql`
  SELECT d.*, to_char(d.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso,
         to_char(d.valid_until, 'YYYY-MM-DD') AS valid_until_text,
         ou.uuid AS owner_uuid, ou.full_name AS owner_name,
         cu.uuid AS created_by_uuid, cu.full_name AS created_by_name,
         c.uuid AS contact_uuid, c.name AS contact_name,
         co.uuid AS company_uuid, co.name AS company_name,
         dl.uuid AS deal_uuid, dl.title AS deal_title,
         inv.uuid AS invoice_uuid, src.uuid AS duplicated_from_uuid
`;
const FROM = sql`
  FROM sales_docs d
  LEFT JOIN users ou ON ou.org_id = d.org_id AND ou.id = d.owner_id
  LEFT JOIN users cu ON cu.org_id = d.org_id AND cu.id = d.created_by
  LEFT JOIN contacts c ON c.org_id = d.org_id AND c.id = d.contact_id
  LEFT JOIN companies co ON co.org_id = d.org_id AND co.id = d.company_id
  LEFT JOIN deals dl ON dl.org_id = d.org_id AND dl.id = d.deal_id
  LEFT JOIN invoices inv ON inv.org_id = d.org_id AND inv.id = d.invoice_id
  LEFT JOIN sales_docs src ON src.org_id = d.org_id AND src.id = d.duplicated_from_id
`;

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The record scope of a document is a condition on its PEOPLE: `own` is "owned by me or created by me" (so whoever hands a document
 * over keeps sight of it), `team` adds everyone who shares a team with me, `all` adds nothing.
 */
export function salesDocScopeCondition(
  orgId: number,
  scope: RecordScope,
  actorUserId: number | null,
): SQL | undefined {
  return scopeOwnerCondition({ orgId, userId: actorUserId }, scope, [
    sql`d.owner_id`,
    sql`d.created_by`,
  ]);
}

/** A filter with every uuid already resolved to the internal id the SQL needs. */
export interface SalesDocFilter {
  kind?: SalesDocKind;
  status?: SalesDocStatus[];
  q?: string;
  contactId?: number;
  companyId?: number;
  dealId?: number;
  ownerId?: number;
  currency?: string;
  validFrom?: string;
  validTo?: string;
}

function filterConds(orgId: number, f: SalesDocFilter, scope?: SQL): SQL[] {
  const conds: SQL[] = [sql`d.org_id = ${orgId}`];
  if (scope) conds.push(scope);
  if (f.kind) conds.push(sql`d.doc_type = ${f.kind}`);
  if (f.status?.length)
    conds.push(
      sql`d.status IN (${sql.join(
        f.status.map((x) => sql`${x}`),
        sql`, `,
      )})`,
    );
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    conds.push(
      sql`(d.number ILIKE ${like} OR d.title ILIKE ${like} OR c.name ILIKE ${like} OR co.name ILIKE ${like})`,
    );
  }
  if (f.contactId !== undefined) conds.push(sql`d.contact_id = ${f.contactId}`);
  if (f.companyId !== undefined) conds.push(sql`d.company_id = ${f.companyId}`);
  if (f.dealId !== undefined) conds.push(sql`d.deal_id = ${f.dealId}`);
  if (f.ownerId !== undefined) conds.push(sql`d.owner_id = ${f.ownerId}`);
  if (f.currency) conds.push(sql`d.currency = ${f.currency}`);
  if (f.validFrom) conds.push(sql`d.valid_until >= ${f.validFrom}::date`);
  if (f.validTo) conds.push(sql`d.valid_until <= ${f.validTo}::date`);
  return conds;
}

export interface SalesDocListInput {
  filter: SalesDocFilter;
  scope?: SQL;
  cursor?: string;
  limit: number;
}

export interface NewSalesDoc {
  kind: SalesDocKind;
  number: string;
  seq: number;
  source: SalesDocSource;
  title: string | null;
  contactId: number | null;
  companyId: number | null;
  dealId: number | null;
  ownerId: number | null;
  createdBy: number | null;
  buyerNameCipher: string | null;
  buyerEmailCipher: string | null;
  buyerPhoneCipher: string | null;
  notesCipher: string | null;
  terms: string | null;
  currency: string;
  currencyExponent: number;
  taxRateBp: number;
  discountKind: DiscountKind;
  discountValue: bigint;
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  validUntil: string | null;
  duplicatedFromId: number | null;
  tokenHash: string;
  tokenCipher: string;
}

export interface NewSalesDocItem {
  position: number;
  description: string;
  qty: string;
  unitPriceMinor: bigint;
  discountKind: DiscountKind;
  discountValue: bigint;
  taxRateBp: number | null;
  grossMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  taxMinor: bigint;
}

/** Column -> value; anything absent is left as it is. Column names are the table's own (the service never passes user input as one). */
export type SalesDocPatch = Record<string, unknown>;

export interface NewSalesDocEvent {
  docId: number;
  type: SalesDocEventType;
  actorKind: 'user' | 'buyer' | 'system';
  actorUserId?: number | null;
  fromStatus?: SalesDocStatus | null;
  toStatus?: SalesDocStatus | null;
  revision: number;
  channel?: string | null;
  signerNameCipher?: string | null;
  signerEmailCipher?: string | null;
  signatureCipher?: string | null;
  commentCipher?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

export interface SalesDocEventRow {
  id: number;
  uuid: string;
  createdAt: Date;
  createdAtIso: string;
  type: SalesDocEventType;
  actorKind: 'user' | 'buyer' | 'system';
  actorUserUuid: string | null;
  actorUserName: string | null;
  fromStatus: SalesDocStatus | null;
  toStatus: SalesDocStatus | null;
  revision: number;
  channel: string | null;
  signerNameCipher: string | null;
  signerEmailCipher: string | null;
  signatureCipher: string | null;
  commentCipher: string | null;
  ip: string | null;
  userAgent: string | null;
  meta: Record<string, unknown>;
}

const toEvent = (r: Raw): SalesDocEventRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  createdAt: new Date(r.created_at as string),
  createdAtIso: r.created_at_iso as string,
  type: r.type as SalesDocEventType,
  actorKind: r.actor_kind as 'user' | 'buyer' | 'system',
  actorUserUuid: s(r.actor_uuid),
  actorUserName: s(r.actor_name),
  fromStatus: s(r.from_status) as SalesDocStatus | null,
  toStatus: s(r.to_status) as SalesDocStatus | null,
  revision: Number(r.revision),
  channel: s(r.channel),
  signerNameCipher: s(r.signer_name),
  signerEmailCipher: s(r.signer_email),
  signatureCipher: s(r.signature),
  commentCipher: s(r.comment),
  ip: s(r.ip),
  userAgent: s(r.user_agent),
  meta: (r.meta as Record<string, unknown>) ?? {},
});

export interface SalesDocRevisionRow {
  uuid: string;
  revision: number;
  status: SalesDocStatus;
  snapshot: Record<string, unknown>;
  totalMinor: bigint;
  createdByUuid: string | null;
  createdByName: string | null;
  createdAt: Date;
}

export interface SalesDocSettingsRow extends NumberingSettings {
  defaultValidDays: number | null;
  linkTtlDays: number | null;
  rowVersion: number | null;
}

export interface SalesDocTemplateRow {
  id: number;
  uuid: string;
  kind: SalesDocKind;
  name: string;
  terms: string | null;
  notes: string | null;
  validDays: number | null;
  isDefault: boolean;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const toTemplate = (r: Raw): SalesDocTemplateRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  kind: r.doc_type as SalesDocKind,
  name: r.name as string,
  terms: s(r.terms),
  notes: s(r.notes),
  validDays: n(r.valid_days),
  isDefault: r.is_default as boolean,
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

/** Data access for proposals and estimates. Every query carries the org: RLS is the backstop, not the filter. */
@Injectable()
export class SalesDocsRepository {
  // --- documents ---------------------------------------------------------------------------------------------------------

  async list(tx: Tx, orgId: number, input: SalesDocListInput): Promise<SalesDocRow[]> {
    const conds = filterConds(orgId, input.filter, input.scope);
    if (input.cursor) {
      const c = decodeCursor(input.cursor);
      const bound = sql`${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz`;
      conds.push(sql`(d.created_at < ${bound} OR (d.created_at = ${bound} AND d.id < ${c.id}))`);
    }
    const res = await tx.execute(sql`
      ${SELECT} ${FROM} WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY d.created_at DESC, d.id DESC LIMIT ${input.limit + 1}
    `);
    return (res.rows as Raw[]).map(toRow);
  }

  /** One round trip: documents per status inside the filter, and the value of the open ones per currency. */
  async counts(
    tx: Tx,
    orgId: number,
    filter: SalesDocFilter,
    scope: SQL | undefined,
  ): Promise<{
    byStatus: Record<string, number>;
    open: Array<{ currency: string; minor: bigint }>;
  }> {
    const conds = filterConds(orgId, filter, scope);
    const res = await tx.execute(sql`
      SELECT d.status, d.currency, count(*)::int AS n, sum(d.total_minor)::text AS total
      ${FROM} WHERE ${sql.join(conds, sql` AND `)} GROUP BY d.status, d.currency
    `);
    const byStatus: Record<string, number> = {};
    const open = new Map<string, bigint>();
    for (const r of res.rows as Raw[]) {
      const status = r.status as string;
      byStatus[status] = (byStatus[status] ?? 0) + Number(r.n);
      if (status === 'sent' || status === 'viewed' || status === 'accepted') {
        const cur = r.currency as string;
        open.set(cur, (open.get(cur) ?? 0n) + big(r.total));
      }
    }
    return { byStatus, open: [...open].map(([currency, minor]) => ({ currency, minor })) };
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<SalesDocRow | undefined> {
    // FOR UPDATE cannot lock the outer-joined side, so lock the document row alone and read the joined shape after.
    if (forUpdate) {
      await tx.execute(
        sql`SELECT 1 FROM sales_docs WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
      );
    }
    const res = await tx.execute(
      sql`${SELECT} ${FROM} WHERE d.org_id = ${orgId} AND d.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<SalesDocRow | undefined> {
    const res = await tx.execute(sql`${SELECT} ${FROM} WHERE d.org_id = ${orgId} AND d.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** The public lookup: runs in a privileged transaction because the organization is not known yet. */
  async locateByTokenHash(
    tx: Tx,
    hash: string,
  ): Promise<{ orgId: number; uuid: string } | undefined> {
    const res = await tx.execute(
      sql`SELECT org_id, uuid FROM sales_docs WHERE public_token_hash = ${hash}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? { orgId: Number(r.org_id), uuid: r.uuid as string } : undefined;
  }

  async items(tx: Tx, orgId: number, docIds: number[]): Promise<Map<number, SalesDocItemRow[]>> {
    const out = new Map<number, SalesDocItemRow[]>();
    if (docIds.length === 0) return out;
    const res = await tx.execute(sql`
      SELECT * FROM sales_doc_items
      WHERE org_id = ${orgId} AND doc_id IN (${sql.join(
        docIds.map((x) => sql`${x}`),
        sql`, `,
      )})
      ORDER BY doc_id, position
    `);
    for (const r of res.rows as Raw[]) {
      const id = Number(r.doc_id);
      const list = out.get(id) ?? [];
      list.push(toItem(r));
      out.set(id, list);
    }
    return out;
  }

  async insert(tx: Tx, orgId: number, v: NewSalesDoc): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO sales_docs (
        org_id, doc_type, number, seq, status, source, title, contact_id, company_id, deal_id, owner_id, created_by,
        buyer_name, buyer_email, buyer_phone, notes, terms, currency, currency_exponent, tax_rate_bp,
        discount_kind, discount_value, subtotal_minor, discount_minor, tax_minor, total_minor, valid_until,
        duplicated_from_id, public_token_hash, public_token_cipher
      ) VALUES (
        ${orgId}, ${v.kind}, ${v.number}, ${v.seq}, 'draft', ${v.source}, ${v.title}, ${v.contactId}, ${v.companyId}, ${v.dealId},
        ${v.ownerId}, ${v.createdBy}, ${v.buyerNameCipher}, ${v.buyerEmailCipher}, ${v.buyerPhoneCipher}, ${v.notesCipher},
        ${v.terms}, ${v.currency}, ${v.currencyExponent}, ${v.taxRateBp}, ${v.discountKind}, ${v.discountValue.toString()}::bigint,
        ${v.subtotalMinor.toString()}::bigint, ${v.discountMinor.toString()}::bigint, ${v.taxMinor.toString()}::bigint,
        ${v.totalMinor.toString()}::bigint, ${v.validUntil}::date, ${v.duplicatedFromId}, ${v.tokenHash}, ${v.tokenCipher}
      ) RETURNING id
    `);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** The optimistic lock is the `row_version` in the WHERE: zero rows back means somebody else wrote first. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number | undefined,
    patch: SalesDocPatch,
  ): Promise<boolean> {
    const sets: SQL[] = [];
    for (const [col, value] of Object.entries(patch)) {
      sets.push(sql`${sql.raw(col)} = ${typeof value === 'bigint' ? value.toString() : value}`);
    }
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE sales_docs SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id}
      ${expectedVersion !== undefined ? sql`AND row_version = ${expectedVersion}` : sql``}
      RETURNING id
    `);
    return res.rows.length > 0;
  }

  async replaceItems(
    tx: Tx,
    orgId: number,
    docId: number,
    items: NewSalesDocItem[],
  ): Promise<void> {
    await tx.execute(
      sql`DELETE FROM sales_doc_items WHERE org_id = ${orgId} AND doc_id = ${docId}`,
    );
    if (items.length === 0) return;
    const rows = items.map(
      (
        i,
      ) => sql`(${orgId}, ${docId}, ${i.position}, ${i.description}, ${i.qty}::numeric, ${i.unitPriceMinor.toString()}::bigint,
        ${i.discountKind}, ${i.discountValue.toString()}::bigint, ${i.taxRateBp}, ${i.grossMinor.toString()}::bigint,
        ${i.discountMinor.toString()}::bigint, ${i.netMinor.toString()}::bigint, ${i.taxMinor.toString()}::bigint)`,
    );
    await tx.execute(sql`
      INSERT INTO sales_doc_items (org_id, doc_id, position, description, qty, unit_price_minor, discount_kind, discount_value,
                                   tax_rate_bp, gross_minor, discount_minor, net_minor, tax_minor)
      VALUES ${sql.join(rows, sql`, `)}
    `);
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM sales_docs WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Counts a view without a write per millisecond of reading: one UPDATE, no row_version churn that matters to an editor. */
  async recordView(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE sales_docs SET view_count = view_count + 1, last_viewed_at = now(), first_viewed_at = COALESCE(first_viewed_at, now())
      WHERE org_id = ${orgId} AND id = ${id}
    `);
  }

  // --- numbering ---------------------------------------------------------------------------------------------------------

  /**
   * The next counter value for a type. One statement: the conflict path takes the row lock, so concurrent creators queue behind the
   * one that holds it until it commits or rolls back (a rollback gives the number back, nothing ever lowers it).
   */
  async allocateSeq(tx: Tx, orgId: number, kind: SalesDocKind, start: number): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO sales_doc_counters (org_id, doc_type, last_seq) VALUES (${orgId}, ${kind}, ${start})
      ON CONFLICT (org_id, doc_type) DO UPDATE SET last_seq = sales_doc_counters.last_seq + 1
      RETURNING last_seq
    `);
    return Number((res.rows[0] as { last_seq: number | string }).last_seq);
  }

  async counters(tx: Tx, orgId: number): Promise<{ proposal: number; estimate: number }> {
    const res = await tx.execute(
      sql`SELECT doc_type, last_seq FROM sales_doc_counters WHERE org_id = ${orgId}`,
    );
    const out = { proposal: 0, estimate: 0 };
    for (const r of res.rows as Raw[]) out[r.doc_type as SalesDocKind] = Number(r.last_seq);
    return out;
  }

  // --- settings ----------------------------------------------------------------------------------------------------------

  async settings(tx: Tx, orgId: number): Promise<SalesDocSettingsRow> {
    const res = await tx.execute(sql`SELECT * FROM sales_doc_settings WHERE org_id = ${orgId}`);
    const r = (res.rows as Raw[])[0];
    if (!r)
      return { ...DEFAULT_NUMBERING, defaultValidDays: null, linkTtlDays: null, rowVersion: null };
    return {
      proposalPrefix: r.proposal_prefix as string,
      estimatePrefix: r.estimate_prefix as string,
      numberPadding: Number(r.number_padding),
      proposalStart: Number(r.proposal_start),
      estimateStart: Number(r.estimate_start),
      defaultValidDays: n(r.default_valid_days),
      linkTtlDays: n(r.link_ttl_days),
      rowVersion: Number(r.row_version),
    };
  }

  async upsertSettings(
    tx: Tx,
    orgId: number,
    expectedVersion: number | undefined,
    next: SalesDocSettingsRow,
  ): Promise<boolean> {
    if (expectedVersion === undefined) {
      const res = await tx.execute(sql`
        INSERT INTO sales_doc_settings (org_id, proposal_prefix, estimate_prefix, number_padding, proposal_start, estimate_start,
                                        default_valid_days, link_ttl_days)
        VALUES (${orgId}, ${next.proposalPrefix}, ${next.estimatePrefix}, ${next.numberPadding}, ${next.proposalStart},
                ${next.estimateStart}, ${next.defaultValidDays}, ${next.linkTtlDays})
        ON CONFLICT (org_id) DO NOTHING RETURNING org_id
      `);
      return res.rows.length > 0;
    }
    const res = await tx.execute(sql`
      UPDATE sales_doc_settings SET proposal_prefix = ${next.proposalPrefix}, estimate_prefix = ${next.estimatePrefix},
        number_padding = ${next.numberPadding}, proposal_start = ${next.proposalStart}, estimate_start = ${next.estimateStart},
        default_valid_days = ${next.defaultValidDays}, link_ttl_days = ${next.linkTtlDays}
      WHERE org_id = ${orgId} AND row_version = ${expectedVersion} RETURNING org_id
    `);
    return res.rows.length > 0;
  }

  // --- templates ---------------------------------------------------------------------------------------------------------

  async templates(tx: Tx, orgId: number, kind?: SalesDocKind): Promise<SalesDocTemplateRow[]> {
    const res = await tx.execute(sql`
      SELECT * FROM sales_doc_templates WHERE org_id = ${orgId} ${kind ? sql`AND doc_type = ${kind}` : sql``}
      ORDER BY doc_type, is_default DESC, lower(name)
    `);
    return (res.rows as Raw[]).map(toTemplate);
  }

  async templateByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<SalesDocTemplateRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM sales_doc_templates WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid ${forUpdate ? sql`FOR UPDATE` : sql``}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toTemplate(r) : undefined;
  }

  async defaultTemplate(
    tx: Tx,
    orgId: number,
    kind: SalesDocKind,
  ): Promise<SalesDocTemplateRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM sales_doc_templates WHERE org_id = ${orgId} AND doc_type = ${kind} AND is_default`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toTemplate(r) : undefined;
  }

  async clearDefaultTemplate(tx: Tx, orgId: number, kind: SalesDocKind): Promise<void> {
    await tx.execute(
      sql`UPDATE sales_doc_templates SET is_default = false WHERE org_id = ${orgId} AND doc_type = ${kind} AND is_default`,
    );
  }

  async insertTemplate(
    tx: Tx,
    orgId: number,
    v: {
      kind: SalesDocKind;
      name: string;
      terms: string | null;
      notes: string | null;
      validDays: number | null;
      isDefault: boolean;
      createdBy: number | null;
    },
  ): Promise<string> {
    const res = await tx.execute(sql`
      INSERT INTO sales_doc_templates (org_id, doc_type, name, terms, notes, valid_days, is_default, created_by)
      VALUES (${orgId}, ${v.kind}, ${v.name}, ${v.terms}, ${v.notes}, ${v.validDays}, ${v.isDefault}, ${v.createdBy})
      RETURNING uuid
    `);
    return (res.rows[0] as { uuid: string }).uuid;
  }

  async updateTemplate(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    patch: Record<string, unknown>,
  ): Promise<boolean> {
    const sets: SQL[] = Object.entries(patch).map(
      ([col, value]) => sql`${sql.raw(col)} = ${value}`,
    );
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE sales_doc_templates SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion} RETURNING id
    `);
    return res.rows.length > 0;
  }

  async deleteTemplate(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM sales_doc_templates WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // --- events and revisions ----------------------------------------------------------------------------------------------

  async insertEvent(tx: Tx, orgId: number, e: NewSalesDocEvent): Promise<void> {
    await tx.execute(sql`
      INSERT INTO sales_doc_events (org_id, doc_id, type, actor_kind, actor_user_id, from_status, to_status, revision, channel,
                                    signer_name, signer_email, signature, comment, ip, user_agent, meta)
      VALUES (${orgId}, ${e.docId}, ${e.type}, ${e.actorKind}, ${e.actorUserId ?? null}, ${e.fromStatus ?? null},
              ${e.toStatus ?? null}, ${e.revision}, ${e.channel ?? null}, ${e.signerNameCipher ?? null},
              ${e.signerEmailCipher ?? null}, ${e.signatureCipher ?? null}, ${e.commentCipher ?? null}, ${e.ip ?? null},
              ${e.userAgent ?? null}, ${JSON.stringify(e.meta ?? {})}::jsonb)
    `);
  }

  async listEvents(
    tx: Tx,
    orgId: number,
    docId: number,
    opts: { limit: number; cursor?: string },
  ): Promise<SalesDocEventRow[]> {
    const conds: SQL[] = [sql`e.org_id = ${orgId}`, sql`e.doc_id = ${docId}`];
    if (opts.cursor) {
      const c = decodeCursor(opts.cursor);
      const bound = sql`${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz`;
      conds.push(sql`(e.created_at < ${bound} OR (e.created_at = ${bound} AND e.id < ${c.id}))`);
    }
    const res = await tx.execute(sql`
      SELECT e.*, to_char(e.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso,
             u.uuid AS actor_uuid, u.full_name AS actor_name
      FROM sales_doc_events e LEFT JOIN users u ON u.org_id = e.org_id AND u.id = e.actor_user_id
      WHERE ${sql.join(conds, sql` AND `)} ORDER BY e.created_at DESC, e.id DESC LIMIT ${opts.limit + 1}
    `);
    return (res.rows as Raw[]).map(toEvent);
  }

  async eventByUuid(
    tx: Tx,
    orgId: number,
    docId: number,
    uuid: string,
  ): Promise<SalesDocEventRow | undefined> {
    const res = await tx.execute(sql`
      SELECT e.*, to_char(e.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso,
             u.uuid AS actor_uuid, u.full_name AS actor_name
      FROM sales_doc_events e LEFT JOIN users u ON u.org_id = e.org_id AND u.id = e.actor_user_id
      WHERE e.org_id = ${orgId} AND e.doc_id = ${docId} AND e.uuid = ${uuid}::uuid
    `);
    const r = (res.rows as Raw[])[0];
    return r ? toEvent(r) : undefined;
  }

  /** The decision event of a document (the latest accepted or declined one): the signer shown on the buyer's page. */
  async lastDecision(tx: Tx, orgId: number, docId: number): Promise<SalesDocEventRow | undefined> {
    const res = await tx.execute(sql`
      SELECT e.*, to_char(e.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso, NULL::uuid AS actor_uuid, NULL AS actor_name
      FROM sales_doc_events e WHERE e.org_id = ${orgId} AND e.doc_id = ${docId} AND e.type IN ('accepted', 'declined')
      ORDER BY e.created_at DESC, e.id DESC LIMIT 1
    `);
    const r = (res.rows as Raw[])[0];
    return r ? toEvent(r) : undefined;
  }

  async insertRevision(
    tx: Tx,
    orgId: number,
    v: {
      docId: number;
      revision: number;
      status: SalesDocStatus;
      snapshot: Record<string, unknown>;
      totalMinor: bigint;
      createdBy: number | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO sales_doc_revisions (org_id, doc_id, revision, status, snapshot, total_minor, created_by)
      VALUES (${orgId}, ${v.docId}, ${v.revision}, ${v.status}, ${JSON.stringify(v.snapshot)}::jsonb, ${v.totalMinor.toString()}::bigint, ${v.createdBy})
    `);
  }

  async revisions(tx: Tx, orgId: number, docId: number): Promise<SalesDocRevisionRow[]> {
    const res = await tx.execute(sql`
      SELECT r.*, u.uuid AS created_by_uuid, u.full_name AS created_by_name
      FROM sales_doc_revisions r LEFT JOIN users u ON u.org_id = r.org_id AND u.id = r.created_by
      WHERE r.org_id = ${orgId} AND r.doc_id = ${docId} ORDER BY r.revision DESC
    `);
    return (res.rows as Raw[]).map((r) => ({
      uuid: r.uuid as string,
      revision: Number(r.revision),
      status: r.status as SalesDocStatus,
      snapshot: r.snapshot as Record<string, unknown>,
      totalMinor: big(r.total_minor),
      createdByUuid: s(r.created_by_uuid),
      createdByName: s(r.created_by_name),
      createdAt: new Date(r.created_at as string),
    }));
  }

  // --- references --------------------------------------------------------------------------------------------------------

  /** An ACTIVE member of this workspace by uuid: the only kind of user a document can be owned by. */
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

  async resolveUserId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
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
        ownerId: number | null;
      }
    | undefined
  > {
    const res = await tx.execute(
      sql`SELECT id, name, email::text AS email, phone, company_id, owner_id FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r
      ? {
          id: Number(r.id),
          name: s(r.name),
          email: s(r.email),
          phone: s(r.phone),
          companyId: n(r.company_id),
          ownerId: n(r.owner_id),
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
        ownerId: number | null;
      }
    | undefined
  > {
    const res = await tx.execute(
      sql`SELECT id, name, email::text AS email, phone, company_id, owner_id FROM contacts WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = (res.rows as Raw[])[0];
    return r
      ? {
          id: Number(r.id),
          name: s(r.name),
          email: s(r.email),
          phone: s(r.phone),
          companyId: n(r.company_id),
          ownerId: n(r.owner_id),
        }
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
    const r = (res.rows as Raw[])[0];
    return r ? { id: Number(r.id), name: s(r.name) } : undefined;
  }

  async resolveDeal(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<
    | { id: number; contactId: number | null; companyId: number | null; ownerId: number | null }
    | undefined
  > {
    const res = await tx.execute(
      sql`SELECT id, contact_id, company_id, owner_user_id FROM deals WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r
      ? {
          id: Number(r.id),
          contactId: n(r.contact_id),
          companyId: n(r.company_id),
          ownerId: n(r.owner_user_id),
        }
      : undefined;
  }

  /** True if `userId` is on a team `actorUserId` is also on: the 'team' record-scope check for one document. */
  async isInActorTeam(
    tx: Tx,
    orgId: number,
    actorUserId: number,
    userId: number,
  ): Promise<boolean> {
    return isTeamPeer(tx, orgId, actorUserId, userId);
  }

  /** The workspace's name, time zone and currency (`settings.currency`, else its default pipeline's, else null). */
  async orgProfile(
    tx: Tx,
    orgId: number,
  ): Promise<{ name: string; timezone: string | null; currency: string | null }> {
    const res = await tx.execute(sql`
      SELECT o.name, o.settings ->> 'timezone' AS timezone,
             COALESCE(NULLIF(o.settings ->> 'currency', ''),
                      (SELECT p.currency FROM pipelines p WHERE p.org_id = o.id AND p.is_default LIMIT 1)) AS currency
      FROM organizations o WHERE o.id = ${orgId}
    `);
    const r = (res.rows as Raw[])[0];
    return { name: (r?.name as string) ?? '', timezone: s(r?.timezone), currency: s(r?.currency) };
  }
}
