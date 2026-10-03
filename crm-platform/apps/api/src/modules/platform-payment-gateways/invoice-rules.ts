import type { InvoiceBadge, PaygwOrderStatus } from '@crm/contracts';
import { majorToMinor, minorToMajor } from './order-pricing';

/**
 * The invoice view of an order (TW-PAYGW-043, 046). There is no invoice table: an invoice IS an order, and everything below is
 * derived from its status and dates.
 */

const DAY = 86_400_000;

/** Payment terms. Reference's "overdue" cut-off is 15 days after creation, with no per-customer terms; its due date repeated the issue date. */
export const INVOICE_TERMS_DAYS = 15;

export function dueDate(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + INVOICE_TERMS_DAYS * DAY);
}

/**
 * paid = paid; outstanding = still open and inside the terms; overdue = still open past the due date; refunded = refunded;
 * void = failed or cancelled. Orders a buyer has not finished paying count as open too.
 */
export function invoiceBadge(
  status: PaygwOrderStatus,
  issuedAt: Date,
  now = new Date(),
): InvoiceBadge {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'refunded':
      return 'refunded';
    case 'failed':
    case 'cancelled':
      return 'void';
    default:
      return now.getTime() - issuedAt.getTime() > INVOICE_TERMS_DAYS * DAY
        ? 'overdue'
        : 'outstanding';
  }
}

/** Whole days since the due date (Reference printed days since creation as "Nd late"). */
export function daysLate(issuedAt: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - dueDate(issuedAt).getTime()) / DAY));
}

export interface InvoiceAmounts {
  subtotal: string;
  discount: string;
  taxAmount: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
}

/**
 * Totals in the currency's own exponent. The stored total wins; an order without one is `amount - discount + tax`. The amount
 * paid is the total only when the order is paid (a refunded order shows 0 paid and the full balance, as Reference did).
 */
export function invoiceAmounts(o: {
  status: PaygwOrderStatus;
  currency: string;
  amount: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
}): InvoiceAmounts {
  const cur = o.currency;
  const m = (v: string): bigint => majorToMinor(v, cur) ?? 0n;
  const discount = m(o.discountAmount);
  const tax = m(o.taxAmount);
  const stored = m(o.totalAmount);
  const total = stored > 0n ? stored : m(o.amount) - discount + tax;
  // `amount` already holds the order total for checkout orders (the discount and tax are inside it), so the subtotal is derived backwards.
  const subtotal = total + discount - tax;
  const paid = o.status === 'paid' ? total : 0n;
  const balance = total - paid > 0n ? total - paid : 0n;
  const f = (v: bigint) => minorToMajor(v, cur);
  return {
    subtotal: f(subtotal < 0n ? 0n : subtotal),
    discount: f(discount),
    taxAmount: f(tax),
    total: f(total),
    amountPaid: f(paid),
    balanceDue: f(balance),
  };
}
