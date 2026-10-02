/**
 * Public surface of the sales-docs module (proposals and estimates). Other modules import from HERE: the invoicing module binds
 * `SALES_DOC_INVOICE_PORT`; the AI tools, flows and the public API call `SalesDocsService.create(input, source)`.
 */
export { SalesDocsService } from './sales-docs.service';
export { SalesDocsRepository } from './sales-docs.repository';
export {
  SALES_DOC_INVOICE_PORT,
  type InvoiceDraftLine,
  type InvoiceDraftResult,
  type InvoiceDraftSource,
  type SalesDocInvoicePort,
} from './sales-doc-ports';
export type { SalesDocRow } from './sales-docs.repository';
