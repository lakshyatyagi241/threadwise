import { describe, expect, it } from 'vitest';
import { formatAmount, formatMovement, formatNet } from './money';

describe('exact ledger precision', () => {
  it('shows the third decimal instead of truncating it', () => {
    expect(formatAmount(95, '0.958', 'USD', 'en')).toBe('$0.958');
    expect(formatAmount(19299, '192.999', 'USD', 'en')).toBe('$192.999');
    expect(formatAmount(700, '7.00', 'USD', 'en')).toBe('$7.00');
  });
  it('falls back to hundredths without the exact text', () => {
    expect(formatAmount(700, undefined, 'USD', 'en')).toBe('$7.00');
  });
  it('signs a movement and a net from the exact figure', () => {
    expect(formatMovement(-95, 'out', 'USD', 'en', '-0.958')).toBe('-$0.958');
    expect(formatNet(19299, 'USD', 'en', '192.999')).toBe('+$192.999');
    expect(formatNet(0, 'USD', 'en', '0.00')).toBe('$0.00');
  });
});
