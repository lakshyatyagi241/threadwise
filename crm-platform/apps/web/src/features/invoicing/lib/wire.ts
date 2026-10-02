import type { InvoiceAmounts, InvoiceSummary } from '@crm/contracts';

/**
 * The API sends money as strings: `amounts` in major units ("1250.00"), `amountsMinor` as whole minor units ("125000"). Screens
 * that format or compare money want a number of minor units; every amount is below 10^15, so a number holds it exactly.
 */
export const minorOf = (s: string | null | undefined): number => (s ? Number(s) : 0);

/** The invoice's money as numbers of minor units. */
export interface InvoiceMinor {
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  taxAdded: number;
  total: number;
  paid: number;
  refunded: number;
  balance: number;
  credit: number;
  credited: number;
}

export const invoiceMinor = (inv: Pick<InvoiceSummary, 'amountsMinor'>): InvoiceMinor => {
  const a: InvoiceAmounts = inv.amountsMinor;
  return {
    subtotal: minorOf(a.subtotal),
    discount: minorOf(a.discount),
    shipping: minorOf(a.shipping),
    tax: minorOf(a.tax),
    taxAdded: minorOf(a.taxAdded),
    total: minorOf(a.total),
    paid: minorOf(a.paid),
    refunded: minorOf(a.refunded),
    balance: minorOf(a.balance),
    credit: minorOf(a.credit),
    credited: minorOf(a.credited),
  };
};

/** A major-units string ("1250.00") as minor units, for a currency with `exponent` decimals. Exact: no float is involved. */
export function majorToMinor(major: string | null | undefined, exponent: number): number {
  if (!major) return 0;
  const neg = major.startsWith('-');
  const [i = '0', f = ''] = major.replace('-', '').split('.');
  const minor = Number(i + f.padEnd(exponent, '0').slice(0, exponent));
  return neg ? -minor : minor;
}

/** A percent string ("18", "9.975") for display: trailing zeros trimmed. */
export const percentLabel = (rate: string): string => (rate.includes('.') ? rate.replace(/0+$/, '').replace(/\.$/, '') : rate);
