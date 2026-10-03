import { describe, expect, it } from 'vitest';
import {
  csvCell,
  csvLine,
  foldDays,
} from '../../../src/modules/platform-payment-gateways/admin-billing.service';
import {
  billingRange,
  buckets,
  deltaPct,
  invoiceRange,
  orderRange,
} from '../../../src/modules/platform-payment-gateways/billing-windows';
import {
  INVOICE_TERMS_DAYS,
  daysLate,
  dueDate,
  invoiceAmounts,
  invoiceBadge,
} from '../../../src/modules/platform-payment-gateways/invoice-rules';

const NOW = new Date('2026-10-15T10:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('windows (TW-PAYGW-037, 041, 043)', () => {
  it('order windows: 90 days by default and for an unknown value, this year since 1 January, all = 5 years; the previous window sits right before', () => {
    const d = orderRange('90d', NOW);
    expect(d.to.toISOString()).toBe('2026-10-15T23:59:59.999Z');
    expect(d.from.toISOString()).toBe('2026-07-17T00:00:00.000Z');
    expect(orderRange('nonsense', NOW)).toEqual(d);
    expect(d.prevTo.getTime()).toBe(d.from.getTime() - 1000);
    expect(d.prevFrom.toISOString()).toBe('2026-04-17T00:00:00.000Z');
    const y = orderRange('this_year', NOW);
    // 287 days since 1 January, counted back from the end of today (Reference's rule): the window starts on 1 January.
    expect(y.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(orderRange('all', NOW).from.getUTCFullYear()).toBe(2021);
    expect(orderRange('this_year', new Date('2026-01-01T05:00:00Z')).from.toISOString()).toBe(
      '2025-12-31T00:00:00.000Z',
    );
  });

  it('billing windows: 7d, 30d, 90d, 1y, all', () => {
    expect(billingRange('7d', NOW).from.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(billingRange('30d', NOW).from.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(billingRange('1y', NOW).from.toISOString()).toBe('2025-10-15T00:00:00.000Z');
    expect(billingRange('x', NOW)).toEqual(billingRange('90d', NOW));
  });

  it('invoice windows', () => {
    expect(invoiceRange('this_month', NOW).from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(invoiceRange('last_month', NOW)).toEqual({
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-30T23:59:59.999Z'),
    });
    expect(invoiceRange('this_quarter', NOW).from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(invoiceRange('this_quarter', new Date('2026-08-20T00:00:00Z')).from.toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
    expect(invoiceRange('this_year', NOW).from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(invoiceRange('all', NOW).from.getUTCFullYear()).toBe(1976);
  });

  it('percent change: one decimal, no previous value gives 100 or 0', () => {
    expect(deltaPct(130, 100)).toBe(30);
    expect(deltaPct(1, 3)).toBe(-66.7);
    expect(deltaPct(5, 0)).toBe(100);
    expect(deltaPct(0, 0)).toBe(0);
  });

  it('buckets: daily up to 31 days, Monday weeks up to 100, months up to 400, quarters beyond; they tile the window', () => {
    const r30 = billingRange('30d', NOW);
    const daily = buckets(r30.from, r30.to);
    expect(daily).toHaveLength(31);
    expect(daily[0]!.label).toBe('Sep 15');
    const r90 = billingRange('90d', NOW);
    const weekly = buckets(r90.from, r90.to);
    expect(weekly[0]!.label.startsWith('wk ')).toBe(true);
    expect(weekly[0]!.start.getUTCDay()).toBe(1);
    const r1y = billingRange('1y', NOW);
    expect(buckets(r1y.from, r1y.to)[0]!.label).toBe('Oct 2025');
    const all = billingRange('all', NOW);
    const q = buckets(all.from, all.to);
    expect(q[0]!.label).toMatch(/^Q[1-4] 2021$/);
    expect(q.at(-1)!.end.getTime()).toBe(all.to.getTime());
    for (const set of [daily, weekly, q]) {
      for (let i = 1; i < set.length; i++) {
        expect(set[i]!.start.getTime() - set[i - 1]!.end.getTime()).toBeLessThanOrEqual(1);
      }
    }
  });

  it('folds per-day figures into buckets and drops days outside the window', () => {
    const r = billingRange('7d', NOW);
    const bs = buckets(r.from, r.to);
    const out = foldDays(
      bs,
      new Map([
        ['2026-10-15', 5],
        ['2026-10-14', 2],
        ['2020-01-01', 99],
      ]),
    );
    expect(out.at(-1)).toBe(5);
    expect(out.at(-2)).toBe(2);
    expect(out.reduce((a, b) => a + b, 0)).toBe(7);
  });
});

describe('invoice rules (TW-PAYGW-043, 046)', () => {
  it('badge: open orders turn overdue after 15 days; failed and cancelled are void', () => {
    expect(invoiceBadge('paid', day(100), NOW)).toBe('paid');
    expect(invoiceBadge('pending', day(15), NOW)).toBe('outstanding');
    expect(invoiceBadge('pending', day(16), NOW)).toBe('overdue');
    expect(invoiceBadge('awaiting_approval', day(20), NOW)).toBe('overdue');
    expect(invoiceBadge('refunded', day(1), NOW)).toBe('refunded');
    expect(invoiceBadge('failed', day(1), NOW)).toBe('void');
    expect(invoiceBadge('cancelled', day(1), NOW)).toBe('void');
  });

  it('due date is the issue date plus the terms and the late days count from it', () => {
    expect(dueDate(day(20)).getTime() - day(20).getTime()).toBe(INVOICE_TERMS_DAYS * 86_400_000);
    expect(daysLate(day(20), NOW)).toBe(5);
    expect(daysLate(day(10), NOW)).toBe(0);
  });

  it('amounts: paid pays the total, anything else owes it; the subtotal is worked back from discount and tax; zero-decimal currencies stay whole', () => {
    const base = {
      currency: 'USD',
      amount: '70.80',
      discountAmount: '10.0000',
      taxAmount: '10.8000',
      totalAmount: '70.8000',
    };
    expect(invoiceAmounts({ ...base, status: 'paid' })).toEqual({
      subtotal: '70.00',
      discount: '10.00',
      taxAmount: '10.80',
      total: '70.80',
      amountPaid: '70.80',
      balanceDue: '0.00',
    });
    expect(invoiceAmounts({ ...base, status: 'pending' })).toMatchObject({
      amountPaid: '0.00',
      balanceDue: '70.80',
    });
    expect(invoiceAmounts({ ...base, status: 'refunded' })).toMatchObject({
      amountPaid: '0.00',
      balanceDue: '70.80',
    });
    expect(
      invoiceAmounts({
        currency: 'JPY',
        amount: '1500',
        discountAmount: '0',
        taxAmount: '0',
        totalAmount: '0',
        status: 'paid',
      }),
    ).toMatchObject({ total: '1500', amountPaid: '1500' });
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and newlines and neutralises formulas, but leaves plain numbers alone', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('-5.25')).toBe('-5.25');
    expect(csvCell(null)).toBe('');
    expect(csvLine(['a', 1, undefined])).toBe('a,1,');
  });
});
