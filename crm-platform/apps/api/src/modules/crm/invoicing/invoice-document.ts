import { minorToMajor, type PublicInvoice } from '@crm/contracts';
import { amountsOf, toLineResponse, toSeller, toTaxSummaryResponse } from './invoices.mapper';
import type { InvoiceLineRow, InvoiceRow, TaxSummaryRow } from './invoices.repository';
import type { PaymentRow } from './payments.repository';

/**
 * The invoice as a buyer (or a PDF) reads it. One builder feeds the public JSON, the printable page and the PDF, so the three can
 * never show different figures. It reads the FROZEN seller block (branding and wording were snapshotted at issue), never the live
 * settings, and leaves out everything internal: ids, the owner, the creator, the buyer's email and phone, other documents.
 */
export function buildPublicInvoice(input: {
  row: InvoiceRow;
  lines: InvoiceLineRow[];
  taxSummary: TaxSummaryRow[];
  payments: PaymentRow[];
  online: boolean;
}): PublicInvoice {
  const { row } = input;
  const snap = row.sellerSnapshot ?? {};
  const str = (k: string): string | null => (typeof snap[k] === 'string' && snap[k] !== '' ? (snap[k] as string) : null);
  const seller = toSeller(row.sellerSnapshot) ?? {
    name: null,
    address: null,
    country: null,
    state: null,
    taxId: null,
    registrationNo: null,
    phone: null,
    email: null,
    extra: [],
    bankDetails: null,
  };
  const bankDetails = seller.bankDetails && Object.keys(seller.bankDetails).length > 0 ? seller.bankDetails : null;
  const instructions = str('paymentInstructions');
  const bankTransfer = instructions || bankDetails ? { instructions, details: bankDetails } : null;
  const settled = row.paidMinor + row.creditedMinor;
  const balance = row.totalMinor > settled ? row.totalMinor - settled : 0n;
  const open = row.storedStatus === 'issued' && balance > 0n;
  return {
    number: row.number ?? 'DRAFT',
    docType: row.docType,
    status: row.status,
    currency: row.currency,
    currencyExponent: row.currencyExponent,
    issueDate: row.issueDate ?? row.createdAt.toISOString().slice(0, 10),
    dueDate: row.dueDate,
    seller,
    buyer: { name: row.buyerName, address: row.buyerAddress, taxId: row.buyerTaxId },
    reference: row.reference,
    lines: input.lines.map((l) => {
      const { id: _id, taxRateId: _t, ...rest } = toLineResponse(l, row.currency);
      return rest;
    }),
    taxSummary: input.taxSummary.map((t) => toTaxSummaryResponse(t, row.currency)),
    amounts: amountsOf(row),
    reverseCharge: row.reverseCharge,
    legalNotes: row.legalNotes,
    notes: row.notes,
    terms: row.terms,
    footerNote: str('footerNote'),
    title: str('invoiceTitle') ?? '',
    brandColor: str('brandColor'),
    logoUrl: str('logoUrl'),
    payments: input.payments.map((p) => ({
      kind: p.kind,
      amount: minorToMajor(p.amountMinor, p.currency),
      method: p.method,
      paidAt: p.paidAt.toISOString(),
      receiptNumber: p.receiptNumber,
    })),
    payable: open && (bankTransfer !== null || input.online),
    paymentOptions: { bankTransfer, online: input.online },
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    voidReason: row.voidReason,
  };
}
