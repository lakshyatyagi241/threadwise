import {
  formatPercent,
  formatQty,
  minorToMajor,
  parseQty,
  salesDocAmounts,
  type PublicSalesDoc,
  type SalesDocDiscount,
  type SalesDocEvent,
  type SalesDocLine,
  type SalesDocResponse,
  type SalesDocSummary,
  type SalesDocTotals,
} from '@crm/contracts';
import { actionsOf, isOverdue } from './sales-doc-rules';
import type { SalesDocEventRow, SalesDocItemRow, SalesDocRow } from './sales-docs.repository';

/** The mapper is the only place an internal id becomes a uuid. Encrypted fields arrive decrypted (the service owns the key). */

export interface Decrypted {
  buyerName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  notes: string | null;
}

export function discountOf(
  kind: SalesDocRow['discountKind'],
  value: bigint,
  currency: string,
): SalesDocDiscount | null {
  if (kind === 'none') return null;
  return {
    kind,
    value: kind === 'percent' ? formatPercent(value) : minorToMajor(value, currency),
  };
}

export function totalsOf(
  row: Pick<
    SalesDocRow,
    'currency' | 'subtotalMinor' | 'discountMinor' | 'taxMinor' | 'totalMinor'
  >,
): SalesDocTotals {
  return salesDocAmounts(row);
}

export function toLine(it: SalesDocItemRow, currency: string, defaultRateBp: number): SalesDocLine {
  return {
    position: it.position,
    description: it.description,
    qty: formatQty(parseQty(it.qty) ?? 0n),
    unitPrice: minorToMajor(it.unitPriceMinor, currency),
    unitPriceMinor: it.unitPriceMinor.toString(),
    discount: discountOf(it.discountKind, it.discountValue, currency),
    taxRate: it.taxRateBp === null ? null : formatPercent(it.taxRateBp),
    effectiveTaxRate: formatPercent(it.taxRateBp ?? defaultRateBp),
    grossMinor: it.grossMinor.toString(),
    discountMinor: it.discountMinor.toString(),
    netMinor: it.netMinor.toString(),
    taxMinor: it.taxMinor.toString(),
  };
}

export function toSummary(
  row: SalesDocRow,
  buyerName: string | null,
  tz: string | null,
  now: Date,
): SalesDocSummary {
  return {
    id: row.uuid,
    kind: row.kind,
    number: row.number,
    status: row.status,
    title: row.title,
    buyerName,
    contact: row.contactUuid ? { id: row.contactUuid, name: row.contactName } : null,
    company: row.companyUuid ? { id: row.companyUuid, name: row.companyName ?? '' } : null,
    deal: row.dealUuid ? { id: row.dealUuid, title: row.dealTitle ?? '' } : null,
    owner: row.ownerUuid ? { id: row.ownerUuid, name: row.ownerName ?? '' } : null,
    currency: row.currency,
    totals: totalsOf(row),
    validUntil: row.validUntil,
    overdue: isOverdue(row.status, row.validUntil, tz, now),
    sentAt: row.sentAt?.toISOString() ?? null,
    firstViewedAt: row.firstViewedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    revision: row.revision,
    source: row.source,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Reachable by the buyer: out of draft, not revoked, not past the link's own expiry. */
export function linkActive(row: SalesDocRow, now: Date): boolean {
  return (
    row.status !== 'draft' &&
    row.publicTokenHash !== null &&
    row.tokenRevokedAt === null &&
    (row.tokenExpiresAt === null || row.tokenExpiresAt.getTime() > now.getTime())
  );
}

export function toSalesDocResponse(
  row: SalesDocRow,
  items: SalesDocItemRow[],
  plain: Decrypted,
  tz: string | null,
  now: Date = new Date(),
): SalesDocResponse {
  return {
    ...toSummary(row, plain.buyerName, tz, now),
    buyer: { name: plain.buyerName, email: plain.buyerEmail, phone: plain.buyerPhone },
    exponent: row.currencyExponent,
    taxRate: formatPercent(row.taxRateBp),
    discount: discountOf(row.discountKind, row.discountValue, row.currency),
    lines: items.map((i) => toLine(i, row.currency, row.taxRateBp)),
    notes: plain.notes,
    terms: row.terms,
    acceptedRevision: row.acceptedRevision,
    duplicatedFromId: row.duplicatedFromUuid,
    invoice: row.invoiceUuid ? { id: row.invoiceUuid } : null,
    createdBy: row.createdByUuid ? { id: row.createdByUuid, name: row.createdByName ?? '' } : null,
    link: {
      active: linkActive(row, now),
      expiresAt: row.tokenExpiresAt?.toISOString() ?? null,
      revokedAt: row.tokenRevokedAt?.toISOString() ?? null,
      viewCount: row.viewCount,
      lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
    },
    actions: actionsOf(row.status, row.dealId !== null),
  };
}

/** What the buyer sees: no email, no phone, nothing internal. `status` is what to show (a lapsed open document reads `expired`). */
export function toPublicResponse(
  row: SalesDocRow,
  items: SalesDocItemRow[],
  plain: Decrypted,
  sellerName: string,
  tz: string | null,
  decision: { signerName: string | null } | null,
  now: Date = new Date(),
): PublicSalesDoc {
  const overdue = isOverdue(row.status, row.validUntil, tz, now);
  const status = overdue ? 'expired' : row.status;
  const open = row.status === 'sent' || row.status === 'viewed';
  return {
    kind: row.kind,
    number: row.number,
    title: row.title,
    status,
    seller: { name: sellerName },
    buyer: { name: plain.buyerName, company: row.companyName },
    currency: row.currency,
    exponent: row.currencyExponent,
    taxRate: formatPercent(row.taxRateBp),
    discount: discountOf(row.discountKind, row.discountValue, row.currency),
    lines: items.map((i) => toLine(i, row.currency, row.taxRateBp)),
    totals: totalsOf(row),
    notes: plain.notes,
    terms: row.terms,
    validUntil: row.validUntil,
    sentAt: row.sentAt?.toISOString() ?? null,
    canDecide: open && !overdue,
    blockedReason: open && overdue ? 'expired' : null,
    decision:
      (row.status === 'accepted' || row.status === 'declined' || row.status === 'converted') &&
      row.decidedAt
        ? {
            status: row.status === 'declined' ? 'declined' : 'accepted',
            decidedAt: row.decidedAt.toISOString(),
            signerName: decision?.signerName ?? null,
          }
        : null,
    revision: row.revision,
  };
}

export function toEventResponse(
  e: SalesDocEventRow,
  plain: { signerName: string | null; signerEmail: string | null; comment: string | null },
): SalesDocEvent {
  return {
    id: e.uuid,
    type: e.type,
    actor: {
      kind: e.actorKind,
      user: e.actorUserUuid ? { id: e.actorUserUuid, name: e.actorUserName ?? '' } : null,
    },
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    revision: e.revision,
    channel: e.channel,
    signerName: plain.signerName,
    signerEmail: plain.signerEmail,
    hasSignature: e.signatureCipher !== null,
    comment: plain.comment,
    ip: e.ip,
    userAgent: e.userAgent,
    meta: e.meta,
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * The few fields an outbox event carries: identifiers and what a consumer decides on, never the buyer's name, email, phone, notes
 * or the link (those are PII or a bearer secret; a consumer that needs them reads the document through the service).
 */
export function salesDocEventPayload(row: SalesDocRow): Record<string, unknown> {
  return {
    uuid: row.uuid,
    kind: row.kind,
    number: row.number,
    status: row.status,
    currency: row.currency,
    totalMinor: row.totalMinor.toString(),
    revision: row.revision,
    contactId: row.contactUuid,
    companyId: row.companyUuid,
    dealId: row.dealUuid,
    ownerId: row.ownerUuid,
    createdById: row.createdByUuid,
    source: row.source,
  };
}
