import { describe, expect, it } from 'vitest';
import {
  AGING_BUCKETS,
  agingBucketOf,
  canTransitionInvoice,
  daysBetween,
  deriveInvoiceStatus,
  INVOICE_STATUSES,
} from '@crm/contracts';
import {
  DEFAULT_NUMBERING,
  addDays,
  daysPastDue,
  decidePayment,
  formatNumber,
  hashPublicToken,
  isPlausibleToken,
  newPublicToken,
  numberFormatProblem,
  numberingYear,
  resolveDueDate,
  seriesKey,
  type NumberingSettings,
} from '../../../src/modules/crm/invoicing/invoice-rules';

const n = (over: Partial<NumberingSettings> = {}): NumberingSettings => ({ ...DEFAULT_NUMBERING, ...over });

describe('numbering (TW-INV-008, D-08, D-13)', () => {
  it('TW-INV-008 #1: the default format is INV-<year>-<6 digits>', () => {
    expect(formatNumber('tax_invoice', n(), '2026-10-05', 123)).toBe('INV-2026-000123');
    expect(formatNumber('tax_invoice', n(), '2026-10-05', 1_234_567)).toBe('INV-2026-1234567');
  });

  it('TW-INV-008 #3 / D-08: a proforma and a receipt have a series of their own (Reference shared one counter between receipts and tax invoices)', () => {
    expect(seriesKey('tax_invoice', n(), '2026-10-05')).toBe('INV-2026');
    expect(seriesKey('proforma', n(), '2026-10-05')).toBe('PRO-2026');
    expect(seriesKey('receipt', n(), '2026-10-05')).toBe('RCT-2026');
    expect(formatNumber('proforma', n(), '2026-10-05', 4)).toBe('PRO-2026-000004');
  });

  it('TW-INV-008 #2 / D-09: the year follows the workspace fiscal year; January is the calendar year, April restarts on 1 April only when asked', () => {
    expect(numberingYear('2026-03-31', 1)).toBe(2026);
    expect(numberingYear('2026-03-31', 4)).toBe(2025);
    expect(numberingYear('2026-04-01', 4)).toBe(2026);
    expect(seriesKey('tax_invoice', n({ fiscalYearStartMonth: 4 }), '2026-03-31')).toBe('INV-2025');
    expect(seriesKey('tax_invoice', n({ fiscalYearStartMonth: 4 }), '2026-04-01')).toBe('INV-2026');
  });

  it('without a yearly reset all documents of a type share one counter for ever', () => {
    const s = n({ yearlyReset: false, numberFormat: '{PREFIX}-{SEQ}' });
    expect(seriesKey('tax_invoice', s, '2026-10-05')).toBe('INV');
    expect(seriesKey('tax_invoice', s, '2031-01-01')).toBe('INV');
    expect(formatNumber('tax_invoice', s, '2031-01-01', 9)).toBe('INV-000009');
  });

  it('custom formats: {YY}, padding and a prefix change', () => {
    const s = n({ numberFormat: '{PREFIX}/{YY}/{SEQ}', numberPadding: 4, numberingPrefix: 'ACME' });
    expect(formatNumber('tax_invoice', s, '2026-02-02', 7)).toBe('ACME/26/0007');
  });

  it('a format must carry {SEQ}, and one that restarts every year must carry the year or its numbers would repeat', () => {
    expect(numberFormatProblem('{PREFIX}-{YEAR}', true)).toMatch(/SEQ/);
    expect(numberFormatProblem('{PREFIX}-{SEQ}', true)).toMatch(/YEAR/);
    expect(numberFormatProblem('{PREFIX}-{SEQ}', false)).toBeNull();
    expect(numberFormatProblem('{PREFIX}-{YY}-{SEQ}', true)).toBeNull();
  });
});

describe('dates and due dates (TW-INV-030, D-02)', () => {
  it('adds days across month ends and leap years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-12-31', 30)).toBe('2027-01-30');
  });

  it('TW-INV-030: with due_days=14 an invoice issued on day 0 is due on day 14', () => {
    expect(resolveDueDate({ issueDate: '2026-10-01', defaultDueDays: 14 })).toBe('2026-10-15');
  });

  it('an explicit due date wins over terms, terms win over the default, and nothing at all means due on issue', () => {
    expect(resolveDueDate({ issueDate: '2026-10-01', dueDate: '2026-10-09', termsDays: 30, defaultDueDays: 14 })).toBe('2026-10-09');
    expect(resolveDueDate({ issueDate: '2026-10-01', termsDays: 30, defaultDueDays: 14 })).toBe('2026-10-31');
    expect(resolveDueDate({ issueDate: '2026-10-01' })).toBe('2026-10-01');
  });

  it('a due date before the issue date is lifted to the issue date', () => {
    expect(resolveDueDate({ issueDate: '2026-10-10', dueDate: '2026-10-01' })).toBe('2026-10-10');
  });

  it('days past due use the due date, and the issue date when there is none', () => {
    expect(daysPastDue('2026-10-01', '2026-09-01', '2026-10-11')).toBe(10);
    expect(daysPastDue(null, '2026-09-01', '2026-10-01')).toBe(30);
    expect(daysPastDue('2026-10-20', null, '2026-10-11')).toBe(-9);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('status model (TW-INV-025, D-01)', () => {
  const today = '2026-10-10';
  const st = (status: 'draft' | 'issued' | 'void', paymentStatus: 'unpaid' | 'partially_paid' | 'paid', dueDate: string | null) =>
    deriveInvoiceStatus({ status, paymentStatus, dueDate, today });

  it('derives the six statuses', () => {
    expect(st('draft', 'unpaid', null)).toBe('draft');
    expect(st('void', 'unpaid', '2026-01-01')).toBe('void');
    expect(st('issued', 'unpaid', '2026-10-20')).toBe('issued');
    expect(st('issued', 'partially_paid', '2026-10-20')).toBe('partially_paid');
    expect(st('issued', 'paid', '2026-01-01')).toBe('paid');
    expect(st('issued', 'unpaid', '2026-10-01')).toBe('overdue');
    expect(st('issued', 'partially_paid', '2026-10-01')).toBe('overdue');
  });

  it('due today is NOT overdue; it is overdue from the next day', () => {
    expect(st('issued', 'unpaid', today)).toBe('issued');
    expect(st('issued', 'unpaid', '2026-10-09')).toBe('overdue');
  });

  it('a paid invoice is never overdue, a void one never anything else', () => {
    expect(st('issued', 'paid', '2020-01-01')).toBe('paid');
    expect(st('void', 'paid', null)).toBe('void');
  });

  it('every combination maps to exactly one known status (the tab counts partition the invoices)', () => {
    for (const status of ['draft', 'issued', 'void'] as const)
      for (const ps of ['unpaid', 'partially_paid', 'paid'] as const)
        for (const due of [null, '2026-10-01', '2026-10-10', '2026-10-30'])
          expect(INVOICE_STATUSES).toContain(st(status, ps, due));
  });

  it('transitions: draft -> issued -> void, nothing reopens', () => {
    expect(canTransitionInvoice('draft', 'issued')).toBe(true);
    expect(canTransitionInvoice('issued', 'void')).toBe(true);
    expect(canTransitionInvoice('issued', 'draft')).toBe(false);
    expect(canTransitionInvoice('void', 'issued')).toBe(false);
    expect(canTransitionInvoice('draft', 'void')).toBe(false);
  });
});

describe('aging (TW-PAY-004, D-22)', () => {
  it('TW-PAY-004 #1: invoices 5, 45 and 100 days past due land in 1-30, 31-60 and 90+ (Reference put every invoice in the first bucket)', () => {
    expect(agingBucketOf(5)).toBe('d1_30');
    expect(agingBucketOf(45)).toBe('d31_60');
    expect(agingBucketOf(100)).toBe('d90_plus');
  });

  it('the bucket edges', () => {
    const edges: Array<[number, string]> = [
      [-5, 'current'], [0, 'current'], [1, 'd1_30'], [30, 'd1_30'], [31, 'd31_60'], [60, 'd31_60'], [61, 'd61_90'], [90, 'd61_90'], [91, 'd90_plus'],
    ];
    for (const [d, b] of edges) expect(agingBucketOf(d), `${d} days`).toBe(b);
    expect(AGING_BUCKETS).toHaveLength(5);
  });
});

describe('payment decisions (TW-PAY-002, D-11)', () => {
  it('an amount up to the balance is fine; more is refused unless allowed, then the excess is the credit', () => {
    expect(decidePayment(10_000n, 4_000n, false)).toEqual({ ok: true, creditMinor: 0n });
    expect(decidePayment(10_000n, 10_000n, false)).toEqual({ ok: true, creditMinor: 0n });
    expect(decidePayment(10_000n, 10_001n, false)).toEqual({ ok: false, reason: 'overpayment', balanceMinor: 10_000n });
    expect(decidePayment(10_000n, 12_500n, true)).toEqual({ ok: true, creditMinor: 2_500n });
  });

  it('with nothing left to pay any amount is an over-payment', () => {
    expect(decidePayment(0n, 1n, false)).toMatchObject({ ok: false });
    expect(decidePayment(-500n, 100n, true)).toEqual({ ok: true, creditMinor: 100n });
  });
});

describe('public token (TW-INV-016, D-15)', () => {
  it('is 256 bits, URL safe, unique, and recognisable without a database round trip', () => {
    const a = newPublicToken();
    const b = newPublicToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isPlausibleToken(a)).toBe(true);
    for (const junk of ['', 'short', `${a}x`, `${a.slice(0, 42)}!`, "a' OR '1'='1", '../../etc/passwd'])
      expect(isPlausibleToken(junk)).toBe(false);
  });

  it('only the SHA-256 is searchable: the lookup hash is stable and not the token', () => {
    const t = newPublicToken();
    expect(hashPublicToken(t)).toBe(hashPublicToken(t));
    expect(hashPublicToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPublicToken(t)).not.toContain(t);
  });
});
