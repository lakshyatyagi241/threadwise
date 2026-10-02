import {
  currencyExponent,
  type InvoiceDocType,
  type InvoiceProfile,
  type InvoiceResponse,
  type InvoiceStatus,
  type InvoiceTaxSummaryRow,
  type PublicInvoice,
  type TaxRateResponse,
} from '@crm/contracts';
import { decimalOf, type DraftPricing, type InvoiceDraft } from './builder';
import { hsnRequired } from './tax-info';
import { sumPercent, taxLabel } from './totals';
import { majorToMinor, minorOf } from './wire';

/**
 * Everything the printed invoice shows, in one flat shape. The builder's live preview, the staff view of a saved invoice, the print
 * sheet and the buyer's page all draw the same paper from this model, so what a person sees while typing is what the buyer receives.
 * Money is whole minor units of the document's currency (the API sends strings; they are read exactly, never through floats).
 */
export interface PaperSeller {
  name: string;
  address: string | null;
  country: string | null;
  taxId: string | null;
  registrationNo: string | null;
  email: string | null;
  phone: string | null;
  logoUrl: string | null;
  /** Statutory fields the workspace prints (label and value). */
  extra: Array<{ label: string; value: string }>;
  /** Bank details: label to value. */
  bankDetails: Record<string, string> | null;
}

export interface PaperLine {
  description: string;
  sku: string | null;
  hsnSac: string | null;
  qty: string;
  unitPriceMinor: number;
  discount: { kind: 'percent'; percent: string } | { kind: 'amount'; amountMinor: number } | null;
  /** "GST 18%" (or "VAT 20% incl."), null for an untaxed line. */
  taxLabel: string | null;
  /** The line's amount: gross less its own discount (tax included only when the rate is inclusive). */
  amountMinor: number;
}

export interface PaperTaxRow {
  /** The row as printed: "CGST 9%". */
  label: string;
  inclusive: boolean;
  baseMinor: number;
  taxMinor: number;
}

export interface PaperPayment {
  kind: 'payment' | 'refund';
  amountMinor: number;
  method: string;
  paidAt: string;
  receiptNumber: string | null;
}

export interface PaperModel {
  /** Null while a draft has no number yet. */
  number: string | null;
  docType: InvoiceDocType;
  /** The workspace's own title for its invoices ("Tax Invoice"); null reads as the document type's title. */
  title: string | null;
  status: InvoiceStatus;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  reference: string | null;
  /** ISO 3166-2 ("IN-MH") or null. */
  placeOfSupply: string | null;
  seller: PaperSeller | null;
  buyer: {
    name: string;
    address: string | null;
    email: string | null;
    phone: string | null;
    taxId: string | null;
    country: string | null;
  };
  /** An HSN/SAC column: only where the seller's country asks for one (India). */
  showHsn: boolean;
  lines: PaperLine[];
  subtotalMinor: number;
  discountMinor: number;
  /** "10" for a percentage discount; null for an amount or none. */
  discountPercent: string | null;
  shippingMinor: number;
  taxRows: PaperTaxRow[];
  /** Tax added on top of the prices. */
  taxAddedMinor: number;
  /** Tax already inside inclusive prices. */
  includedTaxMinor: number;
  totalMinor: number;
  paidMinor: number;
  creditedMinor: number;
  balanceMinor: number;
  payments: PaperPayment[];
  reverseCharge: boolean;
  legalNotes: string | null;
  notes: string | null;
  terms: string | null;
  footerNote: string | null;
  /** The workspace's brand colour (#RRGGBB), applied as an accent line. */
  brandColor: string | null;
  voidReason: string | null;
}

const sellerOfProfile = (p: InvoiceProfile | undefined): PaperSeller | null =>
  p?.sellerName
    ? {
        name: p.sellerName,
        address: p.sellerAddress,
        country: p.sellerCountry,
        taxId: p.sellerTaxId,
        registrationNo: p.sellerRegistrationNo,
        email: p.supportEmail,
        phone: p.sellerPhone,
        logoUrl: p.logoUrl,
        extra: p.extraFields,
        bankDetails: p.bankDetails && Object.keys(p.bankDetails).length > 0 ? p.bankDetails : null,
      }
    : null;

const taxRowOf = (r: InvoiceTaxSummaryRow, exp: number): PaperTaxRow => ({
  label: taxLabel(r.name, r.rate),
  inclusive: r.inclusive,
  baseMinor: majorToMinor(r.base, exp),
  taxMinor: majorToMinor(r.tax, exp),
});

const lineDiscountOf = (
  d: { kind: 'percent' | 'amount'; value: string } | null,
  exp: number,
): PaperLine['discount'] => {
  if (!d || Number(d.value) <= 0) return null;
  return d.kind === 'percent'
    ? { kind: 'percent', percent: d.value }
    : { kind: 'amount', amountMinor: majorToMinor(d.value, exp) };
};

const lineTaxLabel = (name: string | null, rate: string, inclusive: boolean): string | null =>
  Number(rate) > 0 || name ? `${taxLabel(name, rate)}${inclusive ? ' incl.' : ''}` : null;

/** The live paper beside the builder: priced by the same function the totals card shows. */
export function paperFromDraft(
  draft: InvoiceDraft,
  pricing: DraftPricing,
  ctx: { profile: InvoiceProfile | undefined; rates: readonly TaxRateResponse[] },
): PaperModel {
  const t = pricing.result.totals;
  const currency = draft.currency.trim().toUpperCase();
  const exp = currencyExponent(currency || 'USD');
  const lines: PaperLine[] = pricing.used.map((i, k) => {
    const l = draft.lines[i]!;
    const tax = pricing.reverseCharge ? null : (pricing.taxes[k] ?? null);
    const d =
      l.discount.trim() === '' ? null : decimalOf(l.discount, l.discountKind === 'percent' ? 2 : 4);
    return {
      description: l.description,
      sku: l.sku.trim() || null,
      hsnSac: l.hsnSac.trim() || null,
      qty: decimalOf(l.qty, 4, 8) ?? '1',
      unitPriceMinor: majorToMinor(decimalOf(l.price) ?? '0', exp),
      discount: lineDiscountOf(d === null ? null : { kind: l.discountKind, value: d }, exp),
      taxLabel:
        tax && tax.items.length > 0
          ? lineTaxLabel(tax.name, sumPercent(tax.items), tax.inclusive)
          : null,
      amountMinor: pricing.result.ok ? (t.lines[k]?.netMinor ?? 0) : 0,
    };
  });
  return {
    number: null,
    docType: draft.docType,
    title: ctx.profile?.invoiceTitle ?? null,
    status: 'draft',
    currency: draft.currency.trim().toUpperCase(),
    issueDate: draft.issueDate || null,
    dueDate: draft.dueDate || null,
    reference: draft.reference.trim() || null,
    placeOfSupply: draft.placeRegion.trim()
      ? `${(draft.buyerCountry || ctx.profile?.sellerCountry || '').toUpperCase()}-${draft.placeRegion.trim().toUpperCase()}`
      : null,
    seller: sellerOfProfile(ctx.profile),
    buyer: {
      name: draft.buyerName || draft.contactLabel,
      address: draft.buyerAddress.trim() || null,
      email: draft.buyerEmail.trim() || null,
      phone: draft.buyerPhone.trim() || null,
      taxId: draft.buyerTaxId.trim() || null,
      country: draft.buyerCountry.trim().toUpperCase() || null,
    },
    showHsn: hsnRequired(ctx.profile?.sellerCountry),
    lines,
    subtotalMinor: t.subtotalMinor,
    discountMinor: t.discountMinor,
    discountPercent:
      draft.discountKind === 'percent' && t.discountMinor > 0
        ? draft.discountText.trim() || null
        : null,
    shippingMinor: t.shippingMinor,
    taxRows: t.taxRows.map((r) => ({
      label: taxLabel(r.name, r.ratePercent),
      inclusive: r.inclusive,
      baseMinor: r.baseMinor,
      taxMinor: r.taxMinor,
    })),
    taxAddedMinor: t.taxAddedMinor,
    includedTaxMinor: t.includedTaxMinor,
    totalMinor: t.totalMinor,
    paidMinor: 0,
    creditedMinor: 0,
    balanceMinor: t.totalMinor,
    payments: [],
    reverseCharge: pricing.reverseCharge,
    legalNotes: draft.legalNotes.trim() || null,
    notes: draft.notes.trim() || null,
    terms: draft.terms.trim() || null,
    footerNote: ctx.profile?.footerNote ?? null,
    brandColor: ctx.profile?.brandColor ?? null,
    voidReason: null,
  };
}

/**
 * A saved invoice as the paper. The seller block comes with the invoice (frozen at issue); a draft has none, so pass the invoicing
 * profile as `profile` to print the seller from it (optional). Payments are not part of an invoice answer: a screen that has them
 * (the ledger of the invoice) can set `payments` on the returned model.
 */
export function paperFromInvoice(inv: InvoiceResponse, profile?: InvoiceProfile): PaperModel {
  const exp = inv.currencyExponent;
  const a = inv.amountsMinor;
  // A draft has no frozen seller block yet: it prints from the invoicing profile, as it will once issued.
  const s = inv.seller;
  const fromProfile = !s ? sellerOfProfile(profile) : null;
  return {
    number: inv.number,
    docType: inv.docType,
    title: s ? null : (profile?.invoiceTitle ?? null),
    status: inv.status,
    currency: inv.currency,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    reference: inv.reference,
    placeOfSupply: inv.placeOfSupply,
    seller:
      fromProfile ??
      (s && s.name
        ? {
            name: s.name,
            address: s.address,
            country: s.country,
            taxId: s.taxId,
            registrationNo: s.registrationNo,
            email: s.email,
            phone: s.phone,
            logoUrl: null,
            extra: s.extra,
            bankDetails:
              s.bankDetails && Object.keys(s.bankDetails).length > 0 ? s.bankDetails : null,
          }
        : null),
    buyer: {
      name: inv.buyer.name || inv.contact?.name || '',
      address: inv.buyer.address,
      email: inv.buyer.email,
      phone: inv.buyer.phone,
      taxId: inv.buyer.taxId,
      country: inv.buyer.country,
    },
    showHsn: hsnRequired(s?.country ?? profile?.sellerCountry) || inv.lines.some((l) => !!l.hsnSac),
    lines: inv.lines.map((l) => ({
      description: l.description,
      sku: l.sku,
      hsnSac: l.hsnSac,
      qty: l.qty,
      unitPriceMinor: majorToMinor(l.unitPrice, exp),
      discount: lineDiscountOf(l.discount, exp),
      taxLabel: lineTaxLabel(l.taxName, l.taxRate, l.taxInclusive),
      amountMinor: majorToMinor(l.amounts.net, exp),
    })),
    subtotalMinor: minorOf(a.subtotal),
    discountMinor: minorOf(a.discount),
    discountPercent: inv.discount?.kind === 'percent' ? inv.discount.value : null,
    shippingMinor: minorOf(a.shipping),
    taxRows: inv.taxSummary.map((r) => taxRowOf(r, exp)),
    taxAddedMinor: minorOf(a.taxAdded),
    includedTaxMinor: minorOf(a.tax) - minorOf(a.taxAdded),
    totalMinor: minorOf(a.total),
    paidMinor: minorOf(a.paid),
    creditedMinor: minorOf(a.credited),
    balanceMinor: minorOf(a.balance),
    payments: [],
    reverseCharge: inv.reverseCharge,
    legalNotes: inv.legalNotes,
    notes: inv.notes,
    terms: inv.terms,
    footerNote: fromProfile ? (profile?.footerNote ?? null) : null,
    brandColor: profile?.brandColor ?? null,
    voidReason: inv.voidReason,
  };
}

/** What the buyer's page shows as the paper (amounts are major-unit strings, read exactly). */
export function paperFromPublic(p: PublicInvoice): PaperModel {
  const exp = p.currencyExponent;
  const a = p.amounts;
  const m = (s: string) => majorToMinor(s, exp);
  return {
    number: p.number,
    docType: p.docType,
    title: p.title || null,
    status: p.status,
    currency: p.currency,
    issueDate: p.issueDate,
    dueDate: p.dueDate,
    reference: p.reference,
    placeOfSupply: null,
    seller: {
      name: p.seller.name ?? '',
      address: p.seller.address,
      country: p.seller.country,
      taxId: p.seller.taxId,
      registrationNo: p.seller.registrationNo,
      email: p.seller.email,
      phone: p.seller.phone,
      logoUrl: p.logoUrl,
      extra: p.seller.extra,
      bankDetails:
        p.seller.bankDetails && Object.keys(p.seller.bankDetails).length > 0
          ? p.seller.bankDetails
          : null,
    },
    buyer: {
      name: p.buyer.name ?? '',
      address: p.buyer.address,
      email: null,
      phone: null,
      taxId: p.buyer.taxId,
      country: null,
    },
    showHsn: hsnRequired(p.seller.country) || p.lines.some((l) => !!l.hsnSac),
    lines: p.lines.map((l) => ({
      description: l.description,
      sku: l.sku,
      hsnSac: l.hsnSac,
      qty: l.qty,
      unitPriceMinor: m(l.unitPrice),
      discount: lineDiscountOf(l.discount, exp),
      taxLabel: lineTaxLabel(l.taxName, l.taxRate, l.taxInclusive),
      amountMinor: m(l.amounts.net),
    })),
    subtotalMinor: m(a.subtotal),
    discountMinor: m(a.discount),
    discountPercent: null,
    shippingMinor: m(a.shipping),
    taxRows: p.taxSummary.map((r) => taxRowOf(r, exp)),
    taxAddedMinor: m(a.taxAdded),
    includedTaxMinor: m(a.tax) - m(a.taxAdded),
    totalMinor: m(a.total),
    paidMinor: m(a.paid),
    creditedMinor: m(a.credited),
    balanceMinor: m(a.balance),
    payments: p.payments.map((x) => ({
      kind: x.kind,
      amountMinor: m(x.amount),
      method: x.method,
      paidAt: x.paidAt,
      receiptNumber: x.receiptNumber,
    })),
    reverseCharge: p.reverseCharge,
    legalNotes: p.legalNotes,
    notes: p.notes,
    terms: p.terms,
    footerNote: p.footerNote,
    brandColor: p.brandColor,
    voidReason: p.voidReason,
  };
}

/** True when the paper adds up: the lines make the subtotal, and subtotal - discount + added tax + shipping makes the total. */
export function paperAddsUp(m: PaperModel): boolean {
  const lines = m.lines.reduce((acc, l) => acc + l.amountMinor, 0);
  return (
    lines === m.subtotalMinor &&
    m.subtotalMinor - m.discountMinor + m.taxAddedMinor + m.shippingMinor === m.totalMinor
  );
}
