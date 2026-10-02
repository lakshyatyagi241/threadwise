import { describe, expect, it } from 'vitest';
import { formatMoney, minorToInput, parseMajor, parsePercent, priceBreakdown } from './money';

describe('amounts a person types', () => {
  it('turns major units into exact minor units', () => {
    expect(parseMajor('150', 'USD')).toBe(15000);
    expect(parseMajor('150.5', 'USD')).toBe(15050);
    expect(parseMajor('1,234.50', 'USD')).toBe(123450);
    expect(parseMajor('12,5', 'EUR')).toBe(1250);
    expect(parseMajor('0', 'USD')).toBe(0);
  });

  it('follows the currency decimals', () => {
    expect(parseMajor('1500', 'JPY')).toBe(1500);
    expect(parseMajor('1.5', 'KWD')).toBe(1500);
    expect(parseMajor('12.345', 'USD')).toBe(1235);
    expect(parseMajor('12.344', 'USD')).toBe(1234);
  });

  it('refuses what is not an amount', () => {
    for (const bad of ['', 'abc', '-5', '1.2.3', '1e3'])
      expect(parseMajor(bad, 'USD'), bad).toBeNull();
    expect(parseMajor('1000000000000', 'USD')).toBeNull();
  });

  it('writes minor units back as an editable amount', () => {
    expect(minorToInput(15000, 'USD')).toBe('150.00');
    expect(minorToInput(5, 'USD')).toBe('0.05');
    expect(minorToInput(1500, 'JPY')).toBe('1500');
    expect(minorToInput(1500, 'KWD')).toBe('1.500');
    expect(parseMajor(minorToInput(123456, 'USD'), 'USD')).toBe(123456);
  });

  it('reads a tax percentage', () => {
    expect(parsePercent('18')).toBe(18);
    expect(parsePercent('7,5')).toBe(7.5);
    expect(parsePercent('100')).toBe(100);
    expect(parsePercent('100.01')).toBeNull();
    expect(parsePercent('1.234')).toBeNull();
    expect(parsePercent('')).toBeNull();
    expect(parsePercent('-1')).toBeNull();
  });
});

describe('price breakdown', () => {
  it('adds tax to the fee and asks for the deposit mode', () => {
    expect(priceBreakdown(15000, 18, 'none', 0)).toEqual({
      feeMinor: 15000,
      taxMinor: 2700,
      totalMinor: 17700,
      dueNowMinor: 0,
    });
    expect(priceBreakdown(15000, 18, 'full', 0).dueNowMinor).toBe(17700);
    expect(priceBreakdown(15000, 18, 'partial', 5000).dueNowMinor).toBe(5000);
  });

  it('never asks for more than the total, and rounds tax like Reference', () => {
    expect(priceBreakdown(1000, 0, 'partial', 5000).dueNowMinor).toBe(1000);
    expect(priceBreakdown(999, 7.5, 'none', 0).taxMinor).toBe(75);
    expect(priceBreakdown(0, 18, 'full', 0)).toEqual({
      feeMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
      dueNowMinor: 0,
    });
  });

  it('clamps nonsense', () => {
    expect(priceBreakdown(-5, 150, 'full', -3)).toEqual({
      feeMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
      dueNowMinor: 0,
    });
  });
});

describe('formatMoney', () => {
  it('formats with the currency decimals', () => {
    expect(formatMoney(15000, 'USD', 'en')).toBe('$150.00');
    expect(formatMoney(1500, 'JPY', 'en')).toContain('1,500');
  });

  it('falls back to the code for a currency Intl does not know', () => {
    expect(formatMoney(1250, 'XXXX', 'en')).toBe('XXXX 12.50');
  });
});
