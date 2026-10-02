import type { PaymentSummaryResponse } from '@crm/contracts';
import { minorNum } from './aging';

export interface CurrencyKpis {
  currency: string;
  collected: number;
  refunded: number;
  outstanding: number;
  outstandingInvoices: number;
  overdue: number;
  overdueInvoices: number;
}

/** One row per currency (never summed across currencies), in the order of first appearance: collected first, then the open balances. */
export function summaryByCurrency(s: PaymentSummaryResponse, only?: string): CurrencyKpis[] {
  const order: string[] = [];
  for (const list of [s.collected, s.refunded, s.outstanding, s.overdue]) {
    for (const r of list) if (!order.includes(r.currency)) order.push(r.currency);
  }
  return order
    .filter((c) => !only || c === only)
    .map((currency) => {
      const out = s.outstanding.find((r) => r.currency === currency);
      const over = s.overdue.find((r) => r.currency === currency);
      return {
        currency,
        collected: minorNum(s.collected.find((r) => r.currency === currency)?.amount, currency),
        refunded: minorNum(s.refunded.find((r) => r.currency === currency)?.amount, currency),
        outstanding: minorNum(out?.amount, currency),
        outstandingInvoices: out?.invoices ?? 0,
        overdue: minorNum(over?.amount, currency),
        overdueInvoices: over?.invoices ?? 0,
      };
    });
}

/** The currencies a screen can offer in its filter: those with any figure, plus the one already chosen. */
export function currenciesOf(s: PaymentSummaryResponse | undefined, chosen: string): string[] {
  const set = new Set<string>();
  if (s) for (const list of [s.collected, s.refunded, s.outstanding, s.overdue]) for (const r of list) set.add(r.currency);
  if (chosen) set.add(chosen);
  return [...set].sort();
}
