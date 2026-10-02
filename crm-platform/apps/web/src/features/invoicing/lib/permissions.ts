/**
 * What the signed-in person may do, from the permission keys in their session (the keys the API's controllers require). A key
 * that is absent is denied; the server stays the authority and answers 403 where it must.
 */
const KEYS = {
  read: 'record.invoices.read',
  create: 'record.invoices.create',
  update: 'record.invoices.update',
  issue: 'record.invoices.issue',
  void: 'record.invoices.void',
  remove: 'record.invoices.delete',
  settings: 'record.invoices.settings',
  readPayments: 'record.payments.read',
  recordPayment: 'record.payments.create',
  refund: 'record.payments.refund',
  readTaxRates: 'record.tax-rates.read',
  createTaxRate: 'record.tax-rates.create',
  updateTaxRate: 'record.tax-rates.update',
  deleteTaxRate: 'record.tax-rates.delete',
  readCreditNotes: 'record.credit-notes.read',
  createCreditNote: 'record.credit-notes.create',
  issueCreditNote: 'record.credit-notes.issue',
  voidCreditNote: 'record.credit-notes.void',
  deleteCreditNote: 'record.credit-notes.delete',
  readRecurring: 'record.recurring-invoices.read',
  createRecurring: 'record.recurring-invoices.create',
  updateRecurring: 'record.recurring-invoices.update',
  deleteRecurring: 'record.recurring-invoices.delete',
  readSalesOrders: 'record.sales-orders.read',
  createSalesOrder: 'record.sales-orders.create',
  updateSalesOrder: 'record.sales-orders.update',
  invoiceSalesOrder: 'record.sales-orders.invoice',
  deleteSalesOrder: 'record.sales-orders.delete',
} as const;

export type InvoicingCan = Record<keyof typeof KEYS, boolean>;

export function invoicingCan(permissions: Readonly<Record<string, unknown>>): InvoicingCan {
  const out = {} as InvoicingCan;
  for (const [name, key] of Object.entries(KEYS))
    out[name as keyof InvoicingCan] = key in permissions;
  return out;
}
