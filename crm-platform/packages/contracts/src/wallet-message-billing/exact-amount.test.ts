import { describe, expect, it } from 'vitest';
import { isUnlimitedLimit } from '../plans-subscriptions-trials/catalogue';
import { walletExactAmount, walletExactSubtract } from './money';

describe('walletExactAmount', () => {
  it('trims trailing zeros down to two decimals', () => {
    expect(walletExactAmount('192.9990')).toBe('192.999');
    expect(walletExactAmount('7.0000')).toBe('7.00');
    expect(walletExactAmount('-0.9580')).toBe('-0.958');
    expect(walletExactAmount('5')).toBe('5.00');
    expect(walletExactAmount('0.5')).toBe('0.50');
  });
  it('never prints a negative zero and survives bad input', () => {
    expect(walletExactAmount('-0.0000')).toBe('0.00');
    expect(walletExactAmount(null)).toBe('0.00');
    expect(walletExactAmount('abc')).toBe('0.00');
  });
});

describe('walletExactSubtract', () => {
  it('keeps the ledger precision so the three figures add up', () => {
    expect(walletExactSubtract('200.00', '7.0010')).toBe('192.999');
    expect(walletExactSubtract('1.00', '1.958')).toBe('-0.958');
    expect(walletExactSubtract('3.00', '3.00')).toBe('0.00');
  });
});

describe('isUnlimitedLimit', () => {
  it('reads 0 and stand-in caps as unlimited', () => {
    expect(isUnlimitedLimit(0)).toBe(true);
    expect(isUnlimitedLimit(1_000_000)).toBe(true);
    expect(isUnlimitedLimit(100_000_000)).toBe(true);
    expect(isUnlimitedLimit(999_999)).toBe(false);
    expect(isUnlimitedLimit(10)).toBe(false);
  });
});
