/**
 * Public surface of the invoicing module (invoices, the payment ledger, tax rates, the invoicing profile). Other modules import
 * from here: sales-docs binds InvoiceConversionService to its port, the worker module runs the overdue sweep, and later consumers
 * (delivery adapters, the AI tools, the dashboard) read through the services.
 */
export { InvoicesService, INVOICE_MODULE } from './invoices.service';
export { InvoicesRepository } from './invoices.repository';
export type { InvoiceRow } from './invoices.repository';
export { PaymentsService } from './payments.service';
export { TaxRatesService } from './tax-rates.service';
export { InvoiceSettingsService } from './invoice-settings.service';
export { InvoiceConversionService } from './invoice-conversion.service';
export { InvoicePublicService } from './invoice-public.service';
export { toInvoiceSummary, toInvoiceResponse } from './invoices.mapper';
export { InvoicingWorkerModule } from './invoicing-worker.module';
export { CreditNotesService } from './credit-notes.service';
export { RecurringInvoicesService } from './recurring-invoices.service';
export { SalesOrdersService } from './sales-orders.service';
export {
  ExternalOrderBillingService,
  allocateDiscount,
  specsOfExternalOrder,
} from './external-order-billing.service';
export type {
  ExternalInvoiceOutcome,
  ExternalOrderInput,
  ExternalOrderLine,
  ExternalPaymentInput,
  ExternalSalesOrderRef,
} from './external-order-billing.service';
