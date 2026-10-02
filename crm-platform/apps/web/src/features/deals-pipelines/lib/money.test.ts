import { describe, expect, it } from 'vitest';
import {
  currencyChoices,
  formatMoney,
  minorExponent,
  sumMinor,
  toMajorInput,
  toMinor,
  weighted,
} from './money';

describe('money', () => {
  it('knows how many minor digits a currency has', () => {
    expect(minorExponent('USD')).toBe(2);
    expect(minorExponent('JPY')).toBe(0);
    expect(minorExponent('KWD')).toBe(3);
    expect(minorExponent('???')).toBe(2);
  });

  it('turns typed amounts into minor units', () => {
    expect(toMinor('250.5', 'USD')).toBe(25050);
    expect(toMinor('1,250.00', 'USD')).toBe(125000);
    expect(toMinor('', 'USD')).toBe(0);
    expect(toMinor('0.1', 'USD')).toBe(10);
    expect(toMinor('500', 'JPY')).toBe(500);
    expect(toMinor('19.99', 'USD')).toBe(1999);
  });

  it('never rounds: more decimals than the currency has is refused, trailing zeros are fine', () => {
    expect(toMinor('1.005', 'USD')).toBeNaN();
    expect(toMinor('5000.5', 'JPY')).toBeNaN();
    expect(toMinor('12.3456', 'KWD')).toBeNaN();
    expect(toMinor('5000.00', 'JPY')).toBe(5000);
    expect(toMinor('1.230', 'USD')).toBe(123);
    expect(toMinor('12.345', 'KWD')).toBe(12345);
  });

  it('rejects text, negatives and a lone dot', () => {
    expect(toMinor('abc', 'USD')).toBeNaN();
    expect(toMinor('-5', 'USD')).toBeNaN();
    expect(toMinor('.', 'USD')).toBeNaN();
    expect(toMinor('1.2.3', 'USD')).toBeNaN();
  });

  it('writes minor units back for an input', () => {
    expect(toMajorInput(25050, 'USD')).toBe('250.50');
    expect(toMajorInput(500, 'JPY')).toBe('500');
  });

  it('formats for display, with a fallback for unknown codes', () => {
    expect(formatMoney(125000, 'USD', 'en')).toBe('$1,250.00');
    expect(formatMoney(125000, 'USD', 'en', { compact: true })).toBe('$1.3K');
    expect(formatMoney(5, '???', 'en')).toContain('0.05');
  });

  it('weights by probability, rounding half away from zero', () => {
    expect(weighted(30000, 25)).toBe(7500);
    expect(weighted(1, 50)).toBe(1);
    expect(weighted(3, 50)).toBe(2);
    expect(weighted(-3, 50)).toBe(-2);
    expect(weighted(12345, 0)).toBe(0);
    expect(weighted(12345, 100)).toBe(12345);
  });

  it('sums and lists currencies without duplicates', () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(sumMinor([])).toBe(0);
    const list = currencyChoices('EUR');
    expect(list[0]).toBe('EUR');
    expect(new Set(list).size).toBe(list.length);
  });
});
