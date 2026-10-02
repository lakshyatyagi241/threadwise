import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, formatPercent, minorToMajor } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { resolveTimezone } from '../deals/deal-calendar';
import type { InvoiceDraftResult, InvoiceDraftSource, SalesDocInvoicePort } from '../sales-docs/sales-doc-ports';
import type { LineSpec } from './invoice-content';
import { priceInvoice, simpleTax } from './invoice-content';
import { InvoiceSettingsService } from './invoice-settings.service';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';

/**
 * "Create an invoice draft from an accepted proposal or estimate" (TW-INV-027), the implementation of the port sales-docs defines.
 * It runs INSIDE the caller's transaction, so the invoice, the link on the document and the document's status change commit
 * together or not at all (Reference: no transaction, a crash left an invoice nobody pointed at).
 *
 * It builds a DRAFT: invoicing decides numbering, the seller block and issuing. The line, discount and tax figures are carried
 * over exactly (the quote's amounts become fixed line amounts and a fixed document discount), and the result is re-priced with the
 * same function and compared with the quote's own totals: the two can only differ if the shared math has been broken, and then
 * the conversion refuses instead of writing an invoice that disagrees with the offer the buyer accepted.
 */
@Injectable()
export class InvoiceConversionService implements SalesDocInvoicePort {
  constructor(
    private readonly repo: InvoicesRepository,
    private readonly invoices: InvoicesService,
    private readonly settings: InvoiceSettingsService,
  ) {}

  async createDraftFromSalesDoc(tx: Tx, source: InvoiceDraftSource): Promise<InvoiceDraftResult> {
    // Idempotent per document: a second call returns the invoice the first one made (the unique index on quote_id backs this).
    const existing = await tx.execute(sql`
      SELECT id, uuid, invoice_number FROM invoices
      WHERE org_id = ${source.orgId} AND quote_id = ${source.salesDocId} AND status <> 'void' ORDER BY id LIMIT 1
    `);
    const e = existing.rows[0] as { id: number | string; uuid: string; invoice_number: string | null } | undefined;
    if (e) return { invoiceId: Number(e.id), invoiceUuid: e.uuid, invoiceNumber: e.invoice_number };

    const currency = source.currency;
    const specs: LineSpec[] = source.lines.map((l) => ({
      description: l.description,
      sku: null,
      hsnSac: null,
      qty: l.qty,
      unitPrice: minorToMajor(l.unitPriceMinor, currency),
      discount: l.discountMinor > 0n ? { kind: 'amount', value: minorToMajor(l.discountMinor, currency) } : null,
      tax: l.taxRateBp > 0 ? simpleTax(null, 'Tax', null, formatPercent(l.taxRateBp), false) : null,
    }));
    const discount =
      source.totals.discountMinor > 0n ? { kind: 'amount' as const, value: minorToMajor(source.totals.discountMinor, currency) } : null;

    const priced = priceInvoice({ currency, specs, discount, shipping: null, reverseCharge: false });
    const r = priced.totals;
    if (
      r.subtotalMinor !== source.totals.subtotalMinor ||
      r.discountMinor !== source.totals.discountMinor ||
      r.taxMinor !== source.totals.taxMinor ||
      r.totalMinor !== source.totals.totalMinor
    ) {
      throw new AppError(
        ERROR_CODES.INV_AMOUNT_INVALID,
        'The invoice does not add up to the accepted document; nothing was converted',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'totals', message: `invoice ${r.totalMinor} vs document ${source.totals.totalMinor}` }],
      );
    }

    const ctx = RequestContextStore.peek();
    const profile = await this.settings.load(tx, source.orgId);
    const row = await this.invoices.createDraftIn(tx, source.orgId, ctx?.userId ?? null, {
      source: 'quote',
      docType: 'tax_invoice',
      currency,
      buyer: {
        name: source.buyer.name,
        email: source.buyer.email,
        phone: source.buyer.phone,
        address: null,
        taxId: null,
        country: null,
      },
      contactId: source.contactId,
      companyId: source.companyId,
      dealId: source.dealId,
      quoteId: source.salesDocId,
      ownerId: ctx?.userId ?? null,
      taxRegime: profile.row.defaultTaxRegime,
      placeOfSupply: null,
      reverseCharge: false,
      issueDate: null,
      dueDate: null,
      reference: source.salesDocNumber,
      notes: source.notes,
      terms: source.terms ?? profile.row.terms,
      legalNotes: null,
      discount,
      shipping: null,
      lines: specs,
      metaJson: { fromSalesDoc: source.salesDocNumber, revision: source.revision },
    });
    void resolveTimezone;
    return { invoiceId: row.id, invoiceUuid: row.uuid, invoiceNumber: row.number };
  }
}
