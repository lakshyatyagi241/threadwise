import type { SalesDocKind } from '@crm/contracts';
import type { Tx } from '@crm/db';

/**
 * Ports of the sales-docs module: what it needs from modules that are built elsewhere, so they plug in without sales-docs importing
 * them (arch rule: modules talk through barrels or the outbox).
 */

/** One priced line of an accepted document, handed to the invoicing module. Amounts are whole minor units of `currency`. */
export interface InvoiceDraftLine {
  position: number;
  description: string;
  /** Decimal string, up to 4 decimals ("2.5"). */
  qty: string;
  unitPriceMinor: bigint;
  /** The line discount (document discount is not spread into lines here; it is on the totals). */
  discountMinor: bigint;
  /** Gross less the line discount. */
  netMinor: bigint;
  taxRateBp: number;
  taxMinor: bigint;
}

/**
 * The frozen content of an accepted proposal or estimate. Invoicing builds a DRAFT invoice from it (it decides series, numbering,
 * seller snapshot and issuing); sales-docs only links the invoice back and marks the document converted.
 */
export interface InvoiceDraftSource {
  orgId: number;
  salesDocId: number;
  salesDocUuid: string;
  salesDocNumber: string;
  kind: SalesDocKind;
  revision: number;
  currency: string;
  exponent: number;
  buyer: { name: string | null; email: string | null; phone: string | null };
  /** Internal ids of the linked records, so the invoice can carry the same links (composite FKs are on org_id + id). */
  contactId: number | null;
  companyId: number | null;
  dealId: number | null;
  notes: string | null;
  terms: string | null;
  lines: InvoiceDraftLine[];
  /** Document-level discount; tax is computed after it, line by line. */
  totals: { subtotalMinor: bigint; discountMinor: bigint; taxMinor: bigint; totalMinor: bigint };
  /** Stable per document: calling twice with it must return the same invoice, not a second one. */
  idempotencyKey: string;
}

export interface InvoiceDraftResult {
  invoiceId: number;
  invoiceUuid: string;
  invoiceNumber?: string | null;
}

/**
 * Implemented by the invoicing module and bound to `SALES_DOC_INVOICE_PORT` (provide it in a module that CrmModule can resolve; the
 * service injects it optionally). It runs INSIDE the caller's transaction, so the invoice, the link on the document and the status
 * change commit together or not at all (Reference: no transaction, a crash left an invoice nobody pointed at and the document
 * convertible a second time).
 *
 * The invoicing module binds it (`InvoiceConversionService`). In a deployment where nothing is bound,
 * `POST /sales-docs/:id/convert/invoice` answers 501 SALESDOC_INVOICING_UNAVAILABLE.
 */
export interface SalesDocInvoicePort {
  createDraftFromSalesDoc(tx: Tx, source: InvoiceDraftSource): Promise<InvoiceDraftResult>;
}

export const SALES_DOC_INVOICE_PORT = Symbol('SALES_DOC_INVOICE_PORT');
