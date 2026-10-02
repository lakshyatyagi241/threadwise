/** Public surface of the invoicing domain. Other domains import from here, never from the folders below. */
export { LinkedInvoices, type LinkedInvoicesProps } from './components/linked-invoices';
export { InvoicesScreen } from './components/invoices-screen';
export { PaymentsScreen } from './components/payments-screen';
export { TaxRatesScreen } from './components/tax-rates-screen';
export { CreditNotesScreen } from './components/credit-notes-screen';
export { RecurringInvoicesScreen } from './components/recurring-screen';
export { SalesOrdersScreen } from './components/sales-orders-screen';
export { BusinessProfileScreen } from './components/business-profile-screen';
export { newSalesOrderHref, salesOrderHref } from './components/sales-order-parts';

/** Where a new invoice starts: from a contact, a deal, or an accepted proposal or estimate (the builder copies its lines). */
export function newInvoiceHref(from?: { contact?: string; deal?: string; document?: string }): string {
  const p = new URLSearchParams();
  if (from?.contact) p.set('contact', from.contact);
  if (from?.deal) p.set('deal', from.deal);
  if (from?.document) p.set('fromDoc', from.document);
  const s = p.toString();
  return `/invoices/new${s ? `?${s}` : ''}`;
}
