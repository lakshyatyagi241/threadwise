import { describe, expect, it } from 'vitest';
import { bpToInput, formatMoney, minorToInput, parseMajor, parsePercentToBp } from './money';

describe('parseMajor', () => {
  it('reads what people type, per currency', () => {
    expect(parseMajor('12', 'USD')).toBe(1200);
    expect(parseMajor('12.5', 'USD')).toBe(1250);
    expect(parseMajor('1,234.50', 'USD')).toBe(123450);
    expect(parseMajor('12,5', 'USD')).toBe(1250);
    expect(parseMajor('1,234', 'USD')).toBe(123400);
    expect(parseMajor(' 7 ', 'USD')).toBe(700);
    expect(parseMajor('1500', 'JPY')).toBe(1500);
    expect(parseMajor('1.250', 'KWD')).toBe(1250);
  });

  it('rounds extra decimals half up, like round(price x 10^exp)', () => {
    expect(parseMajor('12.345', 'USD')).toBe(1235);
    expect(parseMajor('12.344', 'USD')).toBe(1234);
    expect(parseMajor('1500.5', 'JPY')).toBe(1501);
  });

  it('rejects what is not a non-negative amount', () => {
    for (const bad of ['', '  ', 'abc', '-5', '1.2.3', '12e2'])
      expect(parseMajor(bad, 'USD'), bad).toBeNull();
    expect(parseMajor('1000000000000', 'USD')).toBeNull();
  });
});

describe('minorToInput', () => {
  it('writes the amount back the way it is typed', () => {
    expect(minorToInput(1250, 'USD')).toBe('12.50');
    expect(minorToInput(5, 'USD')).toBe('0.05');
    expect(minorToInput(1500, 'JPY')).toBe('1500');
    expect(minorToInput(1250, 'KWD')).toBe('1.250');
    expect(parseMajor(minorToInput(123456, 'USD'), 'USD')).toBe(123456);
  });
});

describe('percentages', () => {
  it('reads 18.255 as 1826 basis points (WaDesk: round(rate x 100))', () => {
    expect(parsePercentToBp('18.255')).toBe(1826);
    expect(parsePercentToBp('18')).toBe(1800);
    expect(parsePercentToBp('7,5')).toBe(750);
    expect(parsePercentToBp('100')).toBe(10000);
    expect(parsePercentToBp('150')).toBe(10000);
  });
  it('rejects text and negatives, treats blank as absent', () => {
    expect(parsePercentToBp('')).toBeNull();
    expect(parsePercentToBp('abc')).toBeNull();
    expect(parsePercentToBp('-1')).toBeNull();
  });
  it('writes basis points back', () => {
    expect(bpToInput(1850)).toBe('18.5');
    expect(bpToInput(1800)).toBe('18');
  });
});

describe('formatMoney', () => {
  it('follows the currency exponent', () => {
    expect(formatMoney(123456, 'USD', 'en')).toBe('$1,234.56');
    expect(formatMoney(1500, 'JPY', 'en')).toBe('¥1,500');
    expect(formatMoney(1250, 'KWD', 'en')).toContain('1.250');
  });
  it('falls back to the code for a currency Intl does not know', () => {
    expect(formatMoney(1250, 'ZZZ', 'en')).toContain('12.50');
  });
});
