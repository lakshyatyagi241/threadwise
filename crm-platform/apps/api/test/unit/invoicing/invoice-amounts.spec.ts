import { describe, expect, it } from 'vitest';
import { amountsOf } from '../../../src/modules/crm/invoicing/invoices.mapper';
import type { InvoiceRow } from '../../../src/modules/crm/invoicing/invoices.repository';

/**
 * What an invoice shows as owed or in credit (QA task 5). The mapper is the one place stored minor units become the wire's amounts, so
 * a mistake here shows a customer the wrong balance. Worked in rupees: 100000 minor units is Rs 1,000.00.
 */
const invoice = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    currency: 'INR',
    storedStatus: 'issued',
    subtotalMinor: 90_000n,
    discountMinor: 0n,
    shippingMinor: 0n,
    taxMinor: 10_000n,
    taxAddedMinor: 10_000n,
    totalMinor: 100_000n,
    paidMinor: 0n,
    refundedMinor: 0n,
    creditedMinor: 0n,
    ...over,
  }) as unknown as InvoiceRow;

describe('amountsOf: the balance and the credit', () => {
  it('an issued invoice owes the total less what was paid and what was credited', () => {
    const a = amountsOf(invoice({ paidMinor: 30_000n, creditedMinor: 10_000n }));
    expect(a.total).toBe('1000.00');
    expect(a.paid).toBe('300.00');
    expect(a.credited).toBe('100.00');
    expect(a.balance).toBe('600.00');
    expect(a.credit).toBe('0.00');
  });
  it('an invoice paid in full owes nothing and holds no credit', () => {
    const a = amountsOf(invoice({ paidMinor: 100_000n }));
    expect(a.balance).toBe('0.00');
    expect(a.credit).toBe('0.00');
  });
  it('an overpaid invoice owes nothing and shows the overpayment as credit', () => {
    const a = amountsOf(invoice({ paidMinor: 120_000n }));
    expect(a.balance).toBe('0.00');
    expect(a.credit).toBe('200.00');
  });
  it('a credit note counts as settling the invoice, so credit plus payment beyond the total is credit', () => {
    const a = amountsOf(invoice({ paidMinor: 50_000n, creditedMinor: 100_000n }));
    expect(a.balance).toBe('0.00');
    expect(a.credit).toBe('500.00');
  });
  it('only an issued invoice has a balance: a draft and a void one owe nothing', () => {
    expect(amountsOf(invoice({ storedStatus: 'draft' })).balance).toBe('0.00');
    expect(amountsOf(invoice({ storedStatus: 'void' })).balance).toBe('0.00');
    expect(amountsOf(invoice({ storedStatus: 'issued' })).balance).toBe('1000.00');
  });
});

describe('amountsOf: the form of the amounts', () => {
  it('gives major units by default and raw minor units as text when asked', () => {
    const row = invoice({ paidMinor: 30_000n });
    expect(amountsOf(row).subtotal).toBe('900.00');
    expect(amountsOf(row, true)).toMatchObject({
      subtotal: '90000',
      tax: '10000',
      total: '100000',
      paid: '30000',
      balance: '70000',
      credit: '0',
    });
  });
  it("uses the currency's own number of decimals: a zero-decimal currency has none", () => {
    const a = amountsOf(
      invoice({
        currency: 'JPY',
        totalMinor: 5_000n,
        subtotalMinor: 5_000n,
        taxMinor: 0n,
        taxAddedMinor: 0n,
        paidMinor: 1_000n,
      }),
    );
    expect(a.total).toBe('5000');
    expect(a.balance).toBe('4000');
  });
  it('every amount is present, so the screen never has to guess a missing one', () => {
    expect(Object.keys(amountsOf(invoice())).sort()).toEqual([
      'balance',
      'credit',
      'credited',
      'discount',
      'paid',
      'refunded',
      'shipping',
      'subtotal',
      'tax',
      'taxAdded',
      'total',
    ]);
  });
});
