import { describe, expect, it } from 'vitest';
import {
  AUTO_PAGE_CAP,
  SCREENFUL,
  buyerLabel,
  formatCalendarDay,
  parseStatusParam,
  invoiceTone,
  invoiceTotal,
  keepStoreInvoices,
  mergeStoreInvoices,
  shouldAutoFetch,
  stoppedAtCap,
} from './store-invoices';

const row = (id: string, source: string) =>
  ({ id, source }) as never as { id: string; source: 'own' };

describe('keepStoreInvoices / mergeStoreInvoices', () => {
  it('keeps only rows created from store orders (source own)', () => {
    const kept = keepStoreInvoices([row('1', 'own'), row('2', 'manual'), row('3', 'own')]);
    expect(kept.map((r) => r.id)).toEqual(['1', '3']);
  });

  it('merges pages in order and keeps a repeated row once', () => {
    const merged = mergeStoreInvoices([
      [row('1', 'own'), row('2', 'manual')],
      [row('1', 'own'), row('3', 'own')],
      [],
    ]);
    expect(merged.map((r) => r.id)).toEqual(['1', '3']);
  });

  it('an empty list stays empty', () => {
    expect(mergeStoreInvoices([])).toEqual([]);
  });
});

describe('shouldAutoFetch', () => {
  it('fetches on while a screenful is not in hand and pages remain', () => {
    expect(shouldAutoFetch({ hasMore: true, kept: 0, pagesFetched: 1 })).toBe(true);
    expect(shouldAutoFetch({ hasMore: true, kept: SCREENFUL - 1, pagesFetched: 3 })).toBe(true);
  });
  it('stops at a screenful', () => {
    expect(shouldAutoFetch({ hasMore: true, kept: SCREENFUL, pagesFetched: 1 })).toBe(false);
  });
  it('stops when no page is left', () => {
    expect(shouldAutoFetch({ hasMore: false, kept: 0, pagesFetched: 1 })).toBe(false);
  });
  it('stops at the page cap, and then reports it', () => {
    expect(shouldAutoFetch({ hasMore: true, kept: 0, pagesFetched: AUTO_PAGE_CAP })).toBe(false);
    expect(shouldAutoFetch({ hasMore: true, kept: 0, pagesFetched: AUTO_PAGE_CAP - 1 })).toBe(true);
    expect(stoppedAtCap({ hasMore: true, pagesFetched: AUTO_PAGE_CAP })).toBe(true);
    expect(stoppedAtCap({ hasMore: false, pagesFetched: AUTO_PAGE_CAP })).toBe(false);
    expect(stoppedAtCap({ hasMore: true, pagesFetched: 2 })).toBe(false);
  });
});

describe('invoiceTone', () => {
  it('maps the derived statuses to this domain tones', () => {
    expect(invoiceTone('paid')).toBe('success');
    expect(invoiceTone('overdue')).toBe('danger');
    expect(invoiceTone('void')).toBe('danger');
    expect(invoiceTone('issued')).toBe('warning');
    expect(invoiceTone('partially_paid')).toBe('warning');
    expect(invoiceTone('draft')).toBe('neutral');
    expect(invoiceTone('something_new')).toBe('neutral');
  });
});

describe('invoiceTotal', () => {
  const base = { currency: 'INR', currencyExponent: 2, amountsMinor: { total: '299800' } } as never;
  it('formats minor units at the currency exponent', () => {
    expect(invoiceTotal(base, 'en')).toContain('2,998.00');
  });
  it('honours a zero-decimal currency', () => {
    const jpy = { currency: 'JPY', currencyExponent: 0, amountsMinor: { total: '1500' } } as never;
    expect(invoiceTotal(jpy, 'en')).toContain('1,500');
    expect(invoiceTotal(jpy, 'en')).not.toContain('.');
  });
  it('falls back to the code for an unknown currency and is empty for junk', () => {
    const odd = { currency: 'XX', currencyExponent: 2, amountsMinor: { total: '100' } } as never;
    expect(invoiceTotal(odd, 'en')).toContain('1.00');
    const junk = { currency: 'INR', currencyExponent: 2, amountsMinor: { total: 'x' } } as never;
    expect(invoiceTotal(junk, 'en')).toBe('');
  });
});

describe('buyerLabel', () => {
  it('prefers the buyer name, then the contact name', () => {
    expect(buyerLabel({ buyerName: ' Asha ', contact: { id: 'c', name: 'Other' } })).toBe('Asha');
    expect(buyerLabel({ buyerName: null, contact: { id: 'c', name: 'Other' } })).toBe('Other');
    expect(buyerLabel({ buyerName: null, contact: null })).toBe('');
  });
});

describe('formatCalendarDay', () => {
  it('shows the named day whatever the time zone', () => {
    expect(formatCalendarDay('2026-10-02', 'en')).toBe('Oct 02, 2026');
    expect(formatCalendarDay('2026-10-02T00:00:00.000Z', 'en')).toBe('Oct 02, 2026');
  });
  it('is empty for nothing or junk', () => {
    expect(formatCalendarDay(null, 'en')).toBe('');
    expect(formatCalendarDay('soon', 'en')).toBe('');
    expect(formatCalendarDay('2026-13-45', 'en')).toBe('');
  });
});

describe('parseStatusParam', () => {
  it('accepts the derived statuses and ignores anything else', () => {
    expect(parseStatusParam('partially_paid')).toBe('partially_paid');
    expect(parseStatusParam('overdue')).toBe('overdue');
    expect(parseStatusParam('nope')).toBeUndefined();
    expect(parseStatusParam(null)).toBeUndefined();
    expect(parseStatusParam('')).toBeUndefined();
  });
});
