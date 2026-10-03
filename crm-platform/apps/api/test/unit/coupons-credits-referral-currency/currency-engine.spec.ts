import { describe, expect, it } from 'vitest';
import {
  convertCurrency,
  currencyExponent,
  formatMoney,
  majorString,
  minorToMajor,
  parseToMinor,
  type CurrencyRow,
} from '@crm/contracts';
import { trimRate } from '../../../src/modules/coupons-credits-referral-currency/currency-admin.service';
import { trimDecimal } from '../../../src/modules/coupons-credits-referral-currency/coupon-row';

const inr: CurrencyRow = { code: 'INR', symbol: '₹', precision: 2, rate: '83.25' };
const usd: CurrencyRow = { code: 'USD', symbol: '$', precision: 2, rate: '1' };
const jpy: CurrencyRow = { code: 'JPY', symbol: '¥', precision: 0, rate: '149' };

/** WD-CPN-026: the conversion and display engine (the pure helpers the settings domain's CurrencyService wraps). */
describe('currency conversion and display (WD-CPN-026)', () => {
  it('converts through USD: 100 USD in INR at 83.25 is 8325.00', () => {
    expect(convertCurrency('100', usd.rate, inr.rate)).toBe('8325.00');
    expect(convertCurrency('8325', inr.rate, usd.rate)).toBe('100.00');
  });
  it('shows an INR amount with the symbol, grouped thousands and the currency decimals', () => {
    expect(formatMoney('16732.5', inr)).toBe('₹16,732.50');
  });
  it('rounds a zero-decimal currency to whole units: JPY 1500.4 reads ¥1,500', () => {
    expect(formatMoney('1500.4', jpy)).toBe('¥1,500');
  });
  it('with no catalogue row the amount is a plain two-decimal number', () => {
    expect(formatMoney('1234.5', null)).toBe('1,234.50');
  });
  it('a currency with no symbol is shown with its code', () => {
    expect(formatMoney('12', { ...inr, symbol: '' })).toBe('INR 12.00');
  });
  it('a rate that is zero or negative leaves the amount unchanged (no division by zero)', () => {
    expect(convertCurrency('100', '0', '83')).toBe('100.00');
  });
  it('trims stored rates the way an operator reads them', () => {
    expect(trimRate('83.250000')).toBe('83.25');
    expect(trimRate('1.000000')).toBe('1');
    expect(trimRate('0.920000')).toBe('0.92');
    expect(trimRate('15700.000000')).toBe('15700');
  });
});

/** WD-CPN-028: minor-unit helpers, one source of truth for the number of decimals. */
describe('minor-unit helpers (WD-CPN-028)', () => {
  it('parses to minor units with the currency decimals: IDR 15000, KWD 1.500, USD 19.99', () => {
    expect(parseToMinor('15000', 0)).toBe(15000n);
    expect(parseToMinor('1.500', 3)).toBe(1500n);
    expect(parseToMinor('19.99', 2)).toBe(1999n);
  });
  it('parses what a person types: thousands separators and a symbol', () => {
    expect(parseToMinor('1,500.50', 2)).toBe(150050n);
    expect(parseToMinor('$19.99', 2)).toBe(1999n);
    expect(parseToMinor('-3.5', 2)).toBe(-350n);
  });
  it('rounds half up beyond the decimals and rejects a non-number', () => {
    expect(parseToMinor('0.005', 2)).toBe(1n);
    expect(parseToMinor('0.004', 2)).toBe(0n);
    expect(parseToMinor('abc', 2)).toBeNull();
    expect(parseToMinor('', 2)).toBeNull();
  });
  it('formats the major string with the same decimals as the parse: 150,000 IDR and 1.500 KWD', () => {
    expect(majorString(150000n, 0)).toBe('150,000');
    expect(majorString(1500n, 3)).toBe('1.500');
    expect(majorString(5n, 2)).toBe('0.05');
    expect(majorString(-123456n, 2)).toBe('-1,234.56');
  });
  it('round-trips: display never divides by a fixed 100 (the WaDesk gap is not reproduced)', () => {
    for (const [value, precision] of [
      ['1500', 0],
      ['1.500', 3],
      ['19.99', 2],
    ] as const) {
      expect(majorString(parseToMinor(value, precision)!, precision).replace(/,/g, '')).toBe(value);
    }
  });
  it('the ISO exponent table agrees with the catalogue for the common currencies', () => {
    expect([currencyExponent('USD'), currencyExponent('JPY'), currencyExponent('KWD')]).toEqual([
      2, 0, 3,
    ]);
    expect(minorToMajor(1999n, 'USD')).toBe('19.99');
  });
});

describe('coupon display helpers', () => {
  it('trims a stored decimal for display', () => {
    expect(trimDecimal('10.0000')).toBe('10');
    expect(trimDecimal('12.5000')).toBe('12.5');
    expect(trimDecimal('100.0500')).toBe('100.05');
    expect(trimDecimal('0.0000')).toBe('0');
    expect(trimDecimal('150')).toBe('150');
  });
});
