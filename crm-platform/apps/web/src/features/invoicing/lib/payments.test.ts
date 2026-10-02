import { describe, expect, it } from 'vitest';
import {
  bpToInput,
  formatMoney,
  minorToInput,
  parseMajor,
  parsePercentToBp,
  sumByCurrency,
} from './money';
import { invoicingCan } from './permissions';
import { checkPayment, checkRefund } from './payments';
import { majorToMinor } from './wire';

const TODAY = '2026-10-15';
const form = (over: Partial<Parameters<typeof checkPayment>[0]> = {}) => ({
  amount: '60',
  paidAt: TODAY,
  reference: '',
  note: '',
  ...over,
});

describe('money parsing', () => {
  it("reads amounts in the currency's own decimals", () => {
    expect(parseMajor('12.5', 'USD')).toBe(1_250);
    expect(parseMajor('1,234.50', 'USD')).toBe(123_450);
    expect(parseMajor('12,5', 'USD')).toBe(1_250);
    expect(parseMajor('1500', 'JPY')).toBe(1_500);
    expect(parseMajor('1.2345', 'KWD')).toBe(1_235);
    expect(parseMajor('12.345', 'USD')).toBe(1_235);
  });
  it('rejects what is not a non-negative amount', () => {
    for (const bad of ['', 'abc', '-5', '1.2.3', '1e3'])
      expect(parseMajor(bad, 'USD'), bad).toBeNull();
  });
  it('shows minor units as an editable amount and back', () => {
    expect(minorToInput(1_250, 'USD')).toBe('12.50');
    expect(minorToInput(5, 'USD')).toBe('0.05');
    expect(minorToInput(1_500, 'JPY')).toBe('1500');
    expect(minorToInput(1_250, 'KWD')).toBe('1.250');
    expect(parseMajor(minorToInput(98_765, 'USD'), 'USD')).toBe(98_765);
  });
  it('percentages in basis points', () => {
    expect(parsePercentToBp('18')).toBe(1_800);
    expect(parsePercentToBp('7.5')).toBe(750);
    expect(parsePercentToBp('100')).toBe(10_000);
    expect(parsePercentToBp('100.01')).toBeNull();
    expect(parsePercentToBp('150')).toBeNull();
    expect(parsePercentToBp('x')).toBeNull();
    expect(bpToInput(1_850)).toBe('18.5');
  });
  it("formats with the currency's decimals", () => {
    expect(formatMoney(123_456, 'USD', 'en')).toBe('$1,234.56');
    expect(formatMoney(1_500, 'JPY', 'en')).toContain('1,500');
    expect(formatMoney(1_250, 'KWD', 'en')).toContain('1.250');
  });
  it('sums per currency, never across', () => {
    expect(
      sumByCurrency(
        [
          { c: 'USD', m: 1 },
          { c: 'EUR', m: 5 },
          { c: 'USD', m: 2 },
        ],
        (r) => ({ currency: r.c, minor: r.m }),
      ),
    ).toEqual([
      { currency: 'USD', minor: 3 },
      { currency: 'EUR', minor: 5 },
    ]);
  });
});

describe('checkPayment', () => {
  it('accepts a part payment and an exact one, and hands the API a major-units string', () => {
    expect(checkPayment(form({ amount: '40' }), 'USD', 10_000, TODAY)).toMatchObject({
      amount: '40.00',
      amountMinor: 4_000,
      overpays: false,
      problems: {},
    });
    expect(checkPayment(form({ amount: '100' }), 'USD', 10_000, TODAY).overpays).toBe(false);
  });
  it('normalises what was typed to the currency decimals', () => {
    expect(checkPayment(form({ amount: '1,234.5' }), 'USD', 999_999, TODAY).amount).toBe('1234.50');
    expect(checkPayment(form({ amount: '1500' }), 'JPY', 999_999, TODAY).amount).toBe('1500');
    expect(checkPayment(form({ amount: '1.25' }), 'KWD', 999_999, TODAY).amount).toBe('1.250');
  });
  it('warns, but does not refuse, an overpayment', () => {
    const c = checkPayment(form({ amount: '100.01' }), 'USD', 10_000, TODAY);
    expect(c.overpays).toBe(true);
    expect(c.problems).toEqual({});
    expect(c.amount).toBe('100.01');
  });
  it('refuses a missing, malformed or zero amount', () => {
    expect(checkPayment(form({ amount: '' }), 'USD', 10_000, TODAY).problems.amount).toBe(
      'amountInvalid',
    );
    expect(checkPayment(form({ amount: 'abc' }), 'USD', 10_000, TODAY).problems.amount).toBe(
      'amountInvalid',
    );
    expect(checkPayment(form({ amount: '0' }), 'USD', 10_000, TODAY).problems.amount).toBe(
      'amountZero',
    );
    expect(checkPayment(form({ amount: '0' }), 'USD', 10_000, TODAY).amount).toBeNull();
  });
  it('refuses a bad or future date, and over-long text', () => {
    expect(checkPayment(form({ paidAt: '' }), 'USD', 1, TODAY).problems.paidAt).toBe('dateInvalid');
    expect(checkPayment(form({ paidAt: '2026-10-16' }), 'USD', 1, TODAY).problems.paidAt).toBe(
      'dateFuture',
    );
    expect(checkPayment(form({ paidAt: TODAY }), 'USD', 1, TODAY).problems.paidAt).toBeUndefined();
    expect(
      checkPayment(form({ reference: 'x'.repeat(192) }), 'USD', 1, TODAY).problems.reference,
    ).toBe('referenceTooLong');
    expect(checkPayment(form({ note: 'x'.repeat(2001) }), 'USD', 1, TODAY).problems.note).toBe(
      'noteTooLong',
    );
  });
});

describe('checkRefund', () => {
  it('allows up to what is left, never more', () => {
    expect(checkRefund('30', 'USD', 3_000)).toEqual({ amount: '30.00', amountMinor: 3_000 });
    expect(checkRefund('30.01', 'USD', 3_000)).toEqual({
      amount: null,
      amountMinor: null,
      problem: 'tooMuch',
    });
    expect(checkRefund('0', 'USD', 3_000).problem).toBe('amountZero');
    expect(checkRefund('x', 'USD', 3_000).problem).toBe('amountInvalid');
  });
  it('accepts the default, all that is refundable, as the API sends it', () => {
    const refundable = majorToMinor('150.00', 2);
    expect(checkRefund('150.00', 'USD', refundable).amount).toBe('150.00');
  });
});

describe('invoicingCan', () => {
  it('denies every key the session does not carry', () => {
    const c = invoicingCan({ 'record.invoices.read': true, 'record.payments.create': true });
    expect(c).toMatchObject({
      read: true,
      create: false,
      update: false,
      remove: false,
      recordPayment: true,
      refund: false,
    });
    expect(invoicingCan({})).toMatchObject({ read: false, issue: false, void: false });
  });
  it('maps the real invoice and payment keys', () => {
    const c = invoicingCan({
      'record.invoices.issue': true,
      'record.invoices.void': true,
      'record.invoices.delete': true,
      'record.payments.refund': true,
      'record.credit-notes.create': true,
    });
    expect(c).toMatchObject({
      issue: true,
      void: true,
      remove: true,
      refund: true,
      createCreditNote: true,
      update: false,
    });
  });
});
