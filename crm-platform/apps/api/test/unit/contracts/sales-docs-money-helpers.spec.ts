import { describe, expect, it } from 'vitest';
import { formatQty, formatScaled, parseQty, parseScaled, toTaxDiscount } from '@crm/contracts';

/** Sales-document number formatting and discount mapping (QA task 5). */

describe('formatScaled', () => {
  it.each([
    [125000n, 4, '12.5'],
    [10000n, 4, '1'],
    [0n, 4, '0'],
    [5n, 4, '0.0005'],
    [12345n, 4, '1.2345'],
    [100n, 2, '1'],
    [7n, 0, '7'],
  ])('%s at scale %d is "%s" (trailing zeros dropped)', (n, scale, want) => {
    expect(formatScaled(n, scale)).toBe(want);
  });

  it.each([
    [-12345n, 4, '-1.2345'],
    [-50000n, 4, '-5'],
    [-5n, 4, '-0.0005'],
    [-1n, 2, '-0.01'],
  ])(
    'keeps the sign of %s at scale %d: "%s" (it used to give "0.00-5" for a value under one unit)',
    (n, scale, want) => {
      expect(formatScaled(n, scale)).toBe(want);
    },
  );

  it('is the inverse of parseScaled for every value parseScaled accepts', () => {
    for (const text of ['0', '1', '12.5', '0.0005', '999999999999999.9999', '3.14']) {
      const n = parseScaled(text, 4)!;
      expect(parseScaled(formatScaled(n, 4), 4)).toBe(n);
    }
  });
  it('formatQty and parseQty agree on the quantity scale', () => {
    expect(formatQty(parseQty('2.5')!)).toBe('2.5');
    expect(parseQty('abc')).toBeNull();
  });
});

describe('parseScaled', () => {
  it.each([
    ['12.5', 4, 125000n],
    ['0', 4, 0n],
    ['  7  ', 2, 700n],
    ['1.2000', 2, 120n], // a zero past the scale is harmless
  ])('reads "%s" at scale %d as %s', (text, scale, want) => {
    expect(parseScaled(text, scale)).toBe(want);
  });
  it.each([
    ['1.2345', 2],
    ['-1', 2],
    ['1e3', 2],
    ['', 2],
    ['.5', 2],
    ['1,5', 2],
    ['1.', 2],
    ['1234567890123456', 2],
  ])(
    'refuses "%s" at scale %d (a non-zero digit past the scale, a sign, an exponent, no digits, too long)',
    (text, scale) => {
      expect(parseScaled(text, scale)).toBeNull();
    },
  );
});

describe('toTaxDiscount maps a stored discount to what the tax engine takes', () => {
  it('basis points become a percent, minor units stay minor units, and none stays none', () => {
    expect(toTaxDiscount({ kind: 'percent', value: 1850n })).toEqual({
      kind: 'percent',
      percent: '18.5',
    });
    expect(toTaxDiscount({ kind: 'amount', value: 500n })).toEqual({ kind: 'amount', minor: 500n });
    expect(toTaxDiscount({ kind: 'none', value: 0n })).toEqual({ kind: 'none' });
  });
});
