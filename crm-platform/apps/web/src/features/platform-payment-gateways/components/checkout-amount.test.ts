import { describe, expect, it } from 'vitest';
import { isWalletAmount } from './checkout-page';

describe('isWalletAmount', () => {
  it('accepts a plain amount above zero', () => {
    for (const v of ['1', '500', '250.5', '250.505']) expect(isWalletAmount(v)).toBe(true);
  });
  it('rejects empty, zero, signed, over-precise and non-numeric input, so no quote is requested', () => {
    for (const v of ['', '0', '0.00', '-5', '1.2345', 'abc', '1e3', '12,5', ' 5'])
      expect(isWalletAmount(v)).toBe(false);
  });
});
