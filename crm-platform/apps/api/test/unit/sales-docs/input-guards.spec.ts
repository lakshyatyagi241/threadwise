import { describe, expect, it } from 'vitest';
import {
  calendarDaySchema,
  createInvoiceSchema,
  createSalesDocSchema,
  createTaxRateSchema,
  extendSalesDocSchema,
  isCalendarDay,
  isoCurrencySchema,
  issueInvoiceSchema,
  listInvoicesQuerySchema,
  listPaymentsQuerySchema,
  listSalesDocsQuerySchema,
  recordPaymentSchema,
} from '@crm/contracts';

const line = { description: 'x', qty: '1', unitPrice: '1' };

describe('calendar days (a date that matches the shape but does not exist used to be a 500)', () => {
  it('accepts real days, leap days included', () => {
    for (const d of [
      '2026-10-02',
      '2024-02-29',
      '2000-02-29',
      '2026-12-31',
      '1900-01-01',
      '9999-12-31',
    ]) {
      expect(isCalendarDay(d), d).toBe(true);
    }
  });

  it('refuses days that do not exist', () => {
    for (const d of [
      '2026-02-31',
      '2026-02-29',
      '1900-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-04-31',
      '0000-00-00',
      '2026-1-1',
      '',
    ]) {
      expect(isCalendarDay(d), d).toBe(false);
      expect(calendarDaySchema.safeParse(d).success, d).toBe(false);
    }
  });

  it('is applied by every date field of proposals, estimates and invoicing', () => {
    const bad = '2026-02-31';
    expect(
      createSalesDocSchema.safeParse({ kind: 'proposal', lines: [line], validUntil: bad }).success,
    ).toBe(false);
    expect(extendSalesDocSchema.safeParse({ validUntil: bad }).success).toBe(false);
    expect(listSalesDocsQuerySchema.safeParse({ validFrom: bad }).success).toBe(false);
    expect(listSalesDocsQuerySchema.safeParse({ validTo: bad }).success).toBe(false);
    const inv = { buyerName: 'x', lines: [line] };
    expect(createInvoiceSchema.safeParse({ ...inv, issueDate: bad }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...inv, dueDate: bad }).success).toBe(false);
    expect(issueInvoiceSchema.safeParse({ dueDate: bad }).success).toBe(false);
    for (const key of ['issuedFrom', 'issuedTo', 'dueFrom', 'dueTo']) {
      expect(listInvoicesQuerySchema.safeParse({ [key]: bad }).success, key).toBe(false);
    }
    expect(listPaymentsQuerySchema.safeParse({ from: bad }).success).toBe(false);
    expect(listPaymentsQuerySchema.safeParse({ to: bad }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: '1', paidAt: bad }).success).toBe(false);
    expect(
      createTaxRateSchema.safeParse({ name: 'x', rate: '5', effectiveFrom: bad }).success,
    ).toBe(false);
  });

  it('still takes a real day', () => {
    const ok = '2026-10-02';
    expect(
      createSalesDocSchema.safeParse({ kind: 'proposal', lines: [line], validUntil: ok }).success,
    ).toBe(true);
    expect(
      createInvoiceSchema.safeParse({ buyerName: 'x', lines: [line], issueDate: ok, dueDate: ok })
        .success,
    ).toBe(true);
    expect(listPaymentsQuerySchema.safeParse({ from: ok, to: ok }).success).toBe(true);
  });
});

describe('document currencies are ISO 4217 codes, not any three letters', () => {
  it('upper-cases a known code and refuses an unknown one', () => {
    expect(isoCurrencySchema.parse('usd')).toBe('USD');
    expect(isoCurrencySchema.parse(' kwd ')).toBe('KWD');
    for (const c of ['ZZZ', 'XXX', 'BTC', 'US', 'USDD', '123']) {
      expect(isoCurrencySchema.safeParse(c).success, c).toBe(false);
    }
  });

  it('is applied when a proposal or an invoice is created', () => {
    expect(
      createSalesDocSchema.safeParse({ kind: 'estimate', lines: [line], currency: 'ZZZ' }).success,
    ).toBe(false);
    expect(
      createSalesDocSchema.safeParse({ kind: 'estimate', lines: [line], currency: 'jpy' }).success,
    ).toBe(true);
    expect(
      createInvoiceSchema.safeParse({ buyerName: 'x', lines: [line], currency: 'BTC' }).success,
    ).toBe(false);
    expect(
      createInvoiceSchema.safeParse({ buyerName: 'x', lines: [line], currency: 'kwd' }).success,
    ).toBe(true);
  });
});
