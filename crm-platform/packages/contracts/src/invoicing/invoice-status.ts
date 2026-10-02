import { z } from 'zod';

/**
 * The invoice status model (WD-INV-025, D-01). WaDesk only ever had `issued` and `paid`.
 *
 * Three things are STORED: `status` (draft, issued, void), `paymentStatus` (unpaid, partially_paid, paid; a cache of the payment
 * ledger the database keeps in step with it) and `dueDate`. What a person reads as "the status" is DERIVED from them and the
 * calendar, so an invoice can never be "overdue" in a column that nothing updated:
 *
 *   draft           being written; no number, no public link
 *   void            cancelled after issue; keeps its number
 *   paid            the ledger covers the total (an invoice of 0 is paid when issued)
 *   overdue         issued, a balance is left and the due date is before today (partly paid invoices included)
 *   partially_paid  issued, some money received, not past due
 *   issued          issued, nothing received, not past due
 *
 * The statuses partition the invoices: every invoice has exactly one, which is what lets the tab counts add up.
 */
export const INVOICE_STORED_STATUSES = ['draft', 'issued', 'void'] as const;
export const invoiceStoredStatusSchema = z.enum(INVOICE_STORED_STATUSES);
export type InvoiceStoredStatus = z.infer<typeof invoiceStoredStatusSchema>;

export const INVOICE_PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid'] as const;
export const invoicePaymentStatusSchema = z.enum(INVOICE_PAYMENT_STATUSES);
export type InvoicePaymentStatus = z.infer<typeof invoicePaymentStatusSchema>;

export const INVOICE_STATUSES = [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'overdue',
  'void',
] as const;
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/**
 * `today` and `dueDate` are `YYYY-MM-DD` in the WORKSPACE's calendar (an invoice due on the 10th is still due on the evening of the
 * 10th and is overdue from the 11th). String comparison is date comparison for this format.
 */
export function deriveInvoiceStatus(input: {
  status: InvoiceStoredStatus;
  paymentStatus: InvoicePaymentStatus;
  dueDate: string | null;
  today: string;
}): InvoiceStatus {
  if (input.status === 'draft') return 'draft';
  if (input.status === 'void') return 'void';
  if (input.paymentStatus === 'paid') return 'paid';
  if (input.dueDate !== null && input.dueDate < input.today) return 'overdue';
  return input.paymentStatus === 'partially_paid' ? 'partially_paid' : 'issued';
}

/** The moves the API allows on the STORED status. Payment status moves only through the ledger. */
export const INVOICE_TRANSITIONS: Record<InvoiceStoredStatus, readonly InvoiceStoredStatus[]> = {
  draft: ['issued'],
  issued: ['void'],
  void: [],
};

export const canTransitionInvoice = (from: InvoiceStoredStatus, to: InvoiceStoredStatus): boolean =>
  INVOICE_TRANSITIONS[from].includes(to);

// --- aging (WD-PAY-004, D-22) -----------------------------------------------------------------------------------------------

/**
 * Aging buckets by how many days an open balance is PAST DUE (the due date, or the issue date when there is none). WaDesk counted
 * days since creation and, through a signed-difference slip, put every invoice in the first bucket.
 *
 *   current   not yet due (zero or fewer days past due)
 *   1-30 / 31-60 / 61-90 / 90+   days past due
 */
export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export const agingBucketSchema = z.enum(AGING_BUCKETS);
export type AgingBucket = z.infer<typeof agingBucketSchema>;

export function agingBucketOf(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return 'd1_30';
  if (daysPastDue <= 60) return 'd31_60';
  if (daysPastDue <= 90) return 'd61_90';
  return 'd90_plus';
}

/** Whole days from `from` to `to` (`YYYY-MM-DD`), negative when `to` is earlier. Calendar days, no time zone involved. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}
