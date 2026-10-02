import {
  formatPercent,
  formatQty,
  minorToMajor,
  parseQty,
  type InvoiceAmounts,
  type InvoiceLineResponse,
  type InvoiceLinkState,
  type InvoiceResponse,
  type InvoiceSeller,
  type InvoiceSummary,
  type InvoiceTaxSummaryRow,
  type TaxType,
} from '@crm/contracts';
import type { InvoiceLineRow, InvoiceRow, TaxSummaryRow } from './invoices.repository';

/** The mapper is the only place an internal id becomes a uuid and a minor-unit amount becomes the wire's strings. */

const major = (minor: bigint, currency: string) => minorToMajor(minor, currency);

export function amountsOf(row: InvoiceRow, minor = false): InvoiceAmounts {
  const f = (v: bigint) => (minor ? v.toString() : major(v, row.currency));
  const settled = row.paidMinor + row.creditedMinor;
  const balance = row.totalMinor > settled ? row.totalMinor - settled : 0n;
  const credit = settled > row.totalMinor ? settled - row.totalMinor : 0n;
  return {
    subtotal: f(row.subtotalMinor),
    discount: f(row.discountMinor),
    shipping: f(row.shippingMinor),
    tax: f(row.taxMinor),
    taxAdded: f(row.taxAddedMinor),
    total: f(row.totalMinor),
    paid: f(row.paidMinor),
    refunded: f(row.refundedMinor),
    // Only an ISSUED invoice has a balance to collect: a draft owes nothing yet and a void one owes nothing any more.
    balance: row.storedStatus === 'issued' ? f(balance) : f(0n),
    credit: f(credit),
    credited: f(row.creditedMinor),
  };
}

export function toInvoiceSummary(row: InvoiceRow): InvoiceSummary {
  return {
    id: row.uuid,
    number: row.number,
    docType: row.docType,
    source: row.source as InvoiceSummary['source'],
    status: row.status,
    storedStatus: row.storedStatus,
    paymentStatus: row.paymentStatus,
    overdue: row.status === 'overdue',
    daysOverdue: row.status === 'overdue' ? row.daysOverdue : null,
    currency: row.currency,
    currencyExponent: row.currencyExponent,
    amounts: amountsOf(row),
    amountsMinor: amountsOf(row, true),
    buyerName: row.buyerName,
    buyerEmail: row.buyerEmail,
    contact: row.contactUuid ? { id: row.contactUuid, name: row.contactName } : null,
    company: row.companyUuid ? { id: row.companyUuid, name: row.companyName } : null,
    deal: row.dealUuid ? { id: row.dealUuid, title: row.dealTitle ?? '' } : null,
    owner: row.ownerUuid ? { id: row.ownerUuid, name: row.ownerName ?? '' } : null,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    viewCount: row.viewCount,
    reference: row.reference,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const trimPercent = (p: string): string =>
  p.includes('.') ? p.replace(/0+$/, '').replace(/\.$/, '') : p;

/** Rows written before the exact-rate change stored `rateBp` (900 = 9%); read both shapes. */
const percentOf = (x: { ratePercent?: string; rateBp?: number }): string =>
  x.ratePercent ?? (x.rateBp !== undefined ? String(x.rateBp / 100) : '0');

const components = (
  c: Array<{ type: string; ratePercent?: string; rateBp?: number; amountMinor: string }> | null,
  currency: string,
) =>
  c
    ? c.map((x) => ({
        type: x.type,
        rate: trimPercent(percentOf(x)),
        amount: major(BigInt(x.amountMinor), currency),
      }))
    : null;

export function toLineResponse(l: InvoiceLineRow, currency: string): InvoiceLineResponse {
  return {
    id: l.uuid,
    position: l.position,
    description: l.description,
    sku: l.sku,
    hsnSac: l.hsnSac,
    qty: formatQty(parseQty(l.qty) ?? 0n),
    unitPrice: major(l.unitPriceMinor, currency),
    discount:
      l.discountKind === 'percent'
        ? { kind: 'percent', value: formatPercent(l.discountValue) }
        : l.discountKind === 'amount'
          ? { kind: 'amount', value: major(l.discountValue, currency) }
          : null,
    taxRateId: l.taxRateUuid,
    taxName: l.taxName,
    taxType: (l.taxType as TaxType | null) ?? null,
    taxRate: trimPercent(l.taxRatePercent),
    taxInclusive: l.taxInclusive,
    taxComponents: components(l.taxComponents, currency),
    amounts: {
      gross: major(l.grossMinor, currency),
      discount: major(l.discountMinor, currency),
      net: major(l.grossMinor - l.discountMinor, currency),
      docDiscountShare: major(l.docDiscountShareMinor, currency),
      tax: major(l.taxMinor, currency),
      total: major(l.totalMinor, currency),
    },
  };
}

export function toTaxSummaryResponse(t: TaxSummaryRow, currency: string): InvoiceTaxSummaryRow {
  return {
    name: t.name,
    type: (t.taxType as TaxType | null) ?? null,
    rate: trimPercent(t.ratePercent),
    inclusive: t.inclusive,
    base: major(t.baseMinor, currency),
    tax: major(t.taxMinor, currency),
    components: components(t.taxComponents, currency),
  };
}

/** The frozen seller block as the wire carries it; `null` for a draft (nothing was snapshotted yet). */
export function toSeller(snapshot: Record<string, unknown> | null): InvoiceSeller | null {
  if (!snapshot) return null;
  const str = (k: string): string | null =>
    typeof snapshot[k] === 'string' ? (snapshot[k] as string) : null;
  return {
    name: str('name'),
    address: str('address'),
    country: str('country'),
    state: str('state'),
    taxId: str('taxId'),
    registrationNo: str('registrationNo'),
    phone: str('phone'),
    email: str('email'),
    extra: Array.isArray(snapshot.extra)
      ? (snapshot.extra as Array<{ label: string; value: string }>)
      : [],
    bankDetails: (snapshot.bankDetails as Record<string, string> | null) ?? null,
  };
}

export function toLinkState(
  row: InvoiceRow,
  token: string | null,
  now = new Date(),
): InvoiceLinkState | null {
  if (!row.publicTokenHash || !token) return null;
  const expired = row.tokenExpiresAt !== null && row.tokenExpiresAt <= now;
  const revoked = row.tokenRevokedAt !== null;
  return {
    token,
    path: `/i/${token}`,
    expiresAt: row.tokenExpiresAt ? row.tokenExpiresAt.toISOString() : null,
    revokedAt: row.tokenRevokedAt ? row.tokenRevokedAt.toISOString() : null,
    active: !expired && !revoked,
  };
}

function explanationOf(row: InvoiceRow): InvoiceResponse['taxExplanation'] {
  const r = row.metaJson?.taxResolution as
    | { reasons?: string[]; warnings?: string[]; documentNotes?: string[]; taxFree?: boolean }
    | null
    | undefined;
  if (!r) return null;
  return {
    reasons: r.reasons ?? [],
    warnings: r.warnings ?? [],
    documentNotes: r.documentNotes ?? [],
    taxFree: r.taxFree === true,
  };
}

export function toInvoiceResponse(
  row: InvoiceRow,
  lines: InvoiceLineRow[],
  summary: TaxSummaryRow[],
  token: string | null,
): InvoiceResponse {
  return {
    ...toInvoiceSummary(row),
    buyer: {
      name: row.buyerName,
      email: row.buyerEmail,
      phone: row.buyerPhone,
      address: row.buyerAddress,
      taxId: row.buyerTaxId,
      country: row.buyerCountry,
    },
    seller: toSeller(row.sellerSnapshot),
    taxRegime: row.taxRegime,
    placeOfSupply: row.placeOfSupply,
    reverseCharge: row.reverseCharge,
    legalNotes: row.legalNotes,
    taxExplanation: explanationOf(row),
    discount:
      row.discountKind === 'percent'
        ? { kind: 'percent', value: formatPercent(row.discountValue) }
        : row.discountKind === 'amount'
          ? { kind: 'amount', value: major(row.discountValue, row.currency) }
          : null,
    notes: row.notes,
    terms: row.terms,
    lines: lines.map((l) => toLineResponse(l, row.currency)),
    taxSummary: summary.map((t) => toTaxSummaryResponse(t, row.currency)),
    quote: row.quoteUuid ? { id: row.quoteUuid, number: row.quoteNumber ?? '', kind: row.quoteKind ?? 'proposal' } : null,
    salesOrder: row.salesOrderUuid ? { id: row.salesOrderUuid, number: row.salesOrderNumber ?? '' } : null,
    recurring: row.recurringUuid ? { id: row.recurringUuid, name: row.recurringName ?? '' } : null,
    createdBy: row.createdByUuid ? { id: row.createdByUuid, name: row.createdByName ?? '' } : null,
    publicLink: toLinkState(row, token),
    deliveryChannel: row.deliveryChannel,
    firstViewedAt: row.firstViewedAt ? row.firstViewedAt.toISOString() : null,
    lastViewedAt: row.lastViewedAt ? row.lastViewedAt.toISOString() : null,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    voidReason: row.voidReason,
  };
}

/** The few fields an outbox event carries: identifiers and what a consumer decides on (never the public token, never the lines). */
export function invoiceEventPayload(row: InvoiceRow): Record<string, unknown> {
  return {
    uuid: row.uuid,
    number: row.number,
    docType: row.docType,
    status: row.status,
    storedStatus: row.storedStatus,
    paymentStatus: row.paymentStatus,
    currency: row.currency,
    total: major(row.totalMinor, row.currency),
    paid: major(row.paidMinor, row.currency),
    balance: major(
      row.totalMinor > row.paidMinor + row.creditedMinor
        ? row.totalMinor - row.paidMinor - row.creditedMinor
        : 0n,
      row.currency,
    ),
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    contactId: row.contactUuid,
    companyId: row.companyUuid,
    dealId: row.dealUuid,
    ownerId: row.ownerUuid,
    source: row.source,
  };
}
