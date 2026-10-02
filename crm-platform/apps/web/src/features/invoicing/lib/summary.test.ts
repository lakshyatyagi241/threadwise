import type { PaymentSummaryResponse } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { currenciesOf, summaryByCurrency } from './summary';

const s: PaymentSummaryResponse = {
  days: 30,
  collected: [
    { currency: 'INR', amount: '6309.98' },
    { currency: 'USD', amount: '600.00' },
  ],
  refunded: [{ currency: 'INR', amount: '200.00' }],
  outstanding: [
    { currency: 'INR', amount: '200.00', invoices: 2 },
    { currency: 'EUR', amount: '5.50', invoices: 1 },
  ],
  overdue: [{ currency: 'EUR', amount: '5.50', invoices: 1 }],
};

describe('summaryByCurrency', () => {
  it('keeps every currency apart', () => {
    const rows = summaryByCurrency(s);
    expect(rows.map((r) => r.currency)).toEqual(['INR', 'USD', 'EUR']);
    expect(rows[0]).toMatchObject({
      collected: 630998,
      refunded: 20000,
      outstanding: 20000,
      outstandingInvoices: 2,
      overdue: 0,
    });
    expect(rows[1]).toMatchObject({ collected: 60000, refunded: 0, outstanding: 0 });
    expect(rows[2]).toMatchObject({
      collected: 0,
      outstanding: 550,
      overdue: 550,
      overdueInvoices: 1,
    });
  });
  it('can be narrowed to one currency', () => {
    expect(summaryByCurrency(s, 'USD').map((r) => r.currency)).toEqual(['USD']);
  });
  it('lists the currencies for the filter', () => {
    expect(currenciesOf(s, 'JPY')).toEqual(['EUR', 'INR', 'JPY', 'USD']);
    expect(currenciesOf(undefined, '')).toEqual([]);
  });
});
