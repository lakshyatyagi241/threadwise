import { describe, expect, it } from 'vitest';
import {
  allocateProportionally,
  calculateSalesDoc,
  computeSalesDoc,
  divRound,
  formatPercent,
  formatQty,
  parseMajor,
  parsePercentBp,
  parseQty,
  salesDocAmounts,
  type WireContent,
} from '@crm/contracts';

const price = (c: WireContent) => {
  const r = computeSalesDoc(c);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
};
const amounts = (c: WireContent) => salesDocAmounts(price(c));

describe('sales docs money: the one rounding rule (WD-PROP-006, D-03, D-10)', () => {
  it('WD-PROP-006 #1: 2 x 15.50 + 1 x 9.99 at 10% tax in USD is 4099 + 410 = 4509 (409.9 rounds up)', () => {
    const a = amounts({
      currency: 'USD',
      taxRate: '10',
      lines: [
        { qty: '2', unitPrice: '15.50' },
        { qty: '1', unitPrice: '9.99' },
      ],
    });
    expect(a).toMatchObject({
      subtotalMinor: '4099',
      taxMinor: '410',
      totalMinor: '4509',
      total: '45.09',
    });
  });

  it('WD-PROP-006 #2: a zero-decimal currency keeps whole units (JPY 1500 x 3 = 4500, exponent 0)', () => {
    const v = price({ currency: 'JPY', lines: [{ qty: '3', unitPrice: '1500' }] });
    expect(v.exponent).toBe(0);
    expect(v.lines[0]!.result.grossMinor).toBe(4500n);
    expect(salesDocAmounts(v).total).toBe('4500');
  });

  it('WD-PROP-006 #3: 0.333 x 3.00 = 99.9 minor units, rounded to 100', () => {
    expect(price({ currency: 'USD', lines: [{ qty: '0.333', unitPrice: '3' }] }).totalMinor).toBe(
      100n,
    );
  });

  it('a three-decimal currency is exact (KWD 1.234 x 3 = 3702 fils)', () => {
    const v = price({ currency: 'KWD', lines: [{ qty: '3', unitPrice: '1.234' }] });
    expect(v.exponent).toBe(3);
    expect(v.totalMinor).toBe(3702n);
    expect(salesDocAmounts(v).total).toBe('3.702');
  });

  it('half rounds up: 0.5 x 0.01 USD is half a cent and becomes 1', () => {
    expect(price({ currency: 'USD', lines: [{ qty: '0.5', unitPrice: '0.01' }] }).totalMinor).toBe(
      1n,
    );
    expect(divRound(5n, 10n)).toBe(1n);
    expect(divRound(4n, 10n)).toBe(0n);
  });

  it('tax 0 or absent adds nothing', () => {
    expect(amounts({ currency: 'USD', lines: [{ qty: '1', unitPrice: '10' }] }).tax).toBe('0.00');
  });

  it('D-03: a 10% document discount on 1000 with 10% tax taxes the discounted base: 900 + 90 = 990', () => {
    const a = amounts({
      currency: 'USD',
      taxRate: '10',
      discount: { kind: 'percent', value: '10' },
      lines: [{ qty: '1', unitPrice: '1000' }],
    });
    expect(a).toMatchObject({
      subtotal: '1000.00',
      discount: '100.00',
      tax: '90.00',
      total: '990.00',
    });
  });

  it('a per-line percent discount and an amount discount reduce the line before tax', () => {
    const v = price({
      currency: 'USD',
      taxRate: '20',
      lines: [
        { qty: '2', unitPrice: '50', discount: { kind: 'percent', value: '10' } },
        { qty: '1', unitPrice: '30', discount: { kind: 'amount', value: '5' } },
      ],
    });
    expect(v.lines.map((l) => l.result.netMinor)).toEqual([9000n, 2500n]);
    expect(v.subtotalMinor).toBe(11500n);
    expect(v.taxMinor).toBe(2300n);
    expect(v.totalMinor).toBe(13800n);
  });

  it('per-line tax rates mix: each line is taxed on its own net, the document rate is the default', () => {
    const v = price({
      currency: 'USD',
      taxRate: '5',
      lines: [
        { qty: '1', unitPrice: '100', taxRate: '18' },
        { qty: '1', unitPrice: '100', taxRate: '0' },
        { qty: '1', unitPrice: '100' },
      ],
    });
    expect(v.lines.map((l) => l.result.taxMinor)).toEqual([1800n, 0n, 500n]);
    expect(v.taxMinor).toBe(2300n);
  });

  it('the document discount is spread over the lines so mixed-rate tax is exact and the shares add back', () => {
    const v = price({
      currency: 'USD',
      discount: { kind: 'amount', value: '10' },
      lines: [
        { qty: '1', unitPrice: '60', taxRate: '10' },
        { qty: '1', unitPrice: '40', taxRate: '20' },
      ],
    });
    expect(v.lines.map((l) => l.result.sharedDiscountMinor)).toEqual([600n, 400n]);
    expect(v.taxMinor).toBe((5400n * 10n) / 100n + (3600n * 20n) / 100n);
    expect(v.totalMinor).toBe(10000n - 1000n + v.taxMinor);
  });

  it('an amount discount larger than the subtotal is clamped to it (the total never goes negative)', () => {
    const v = price({
      currency: 'USD',
      discount: { kind: 'amount', value: '999' },
      lines: [{ qty: '1', unitPrice: '10' }],
    });
    expect(v.discountMinor).toBe(1000n);
    expect(v.totalMinor).toBe(0n);
  });

  it('largest remainder: 100 over three equal weights is 34 / 33 / 33 (ties to the earlier line) and always adds back', () => {
    expect(allocateProportionally(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocateProportionally(0n, [5n, 5n])).toEqual([0n, 0n]);
    expect(allocateProportionally(7n, [0n, 0n])).toEqual([0n, 0n]);
    const cases: Array<[bigint, bigint[]]> = [
      [17n, [3n, 9n, 27n]],
      [1n, [1n, 1n]],
      [999n, [1n, 2n, 3n, 4n]],
    ];
    for (const [d, w] of cases) {
      const shares = allocateProportionally(d, w);
      expect(shares.reduce((a, b) => a + b, 0n)).toBe(d);
    }
  });

  it('invariants hold over many random documents: total = subtotal - discount + tax; line nets add to the subtotal; shares add to the discount', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 300; i++) {
      const lines = Array.from({ length: 1 + rnd(6) }, () => ({
        qty: `${rnd(20)}.${String(rnd(10000)).padStart(4, '0')}`,
        unitPrice: `${rnd(5000)}.${String(rnd(100)).padStart(2, '0')}`,
        discount:
          rnd(3) === 0
            ? ({ kind: 'percent', value: `${rnd(100)}.${rnd(100)}` } as const)
            : undefined,
        taxRate: rnd(2) === 0 ? `${rnd(30)}.${rnd(100)}` : undefined,
      }));
      const v = price({
        currency: 'USD',
        taxRate: `${rnd(25)}`,
        discount: rnd(2) === 0 ? { kind: 'percent', value: `${rnd(60)}` } : null,
        lines,
      });
      expect(v.totalMinor).toBe(v.subtotalMinor - v.discountMinor + v.taxMinor);
      expect(v.lines.reduce((a, l) => a + l.result.netMinor, 0n)).toBe(v.subtotalMinor);
      expect(v.lines.reduce((a, l) => a + l.result.sharedDiscountMinor, 0n)).toBe(v.discountMinor);
      expect(v.lines.reduce((a, l) => a + l.result.taxMinor, 0n)).toBe(v.taxMinor);
      expect(v.totalMinor >= 0n).toBe(true);
    }
  });

  it('reports every bad field with its path (the same list the form shows inline)', () => {
    const r = computeSalesDoc({
      currency: 'JPY',
      taxRate: '101',
      discount: { kind: 'percent', value: '150' },
      lines: [
        { qty: '1.00001', unitPrice: '10' },
        { qty: '1', unitPrice: '1500.5' },
        { qty: '1', unitPrice: '1', taxRate: '100.5' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => i.path).sort()).toEqual(
        ['discount', 'lines.0.qty', 'lines.1.unitPrice', 'lines.2.taxRate', 'taxRate'].sort(),
      );
    }
  });

  it('refuses an amount that would not fit (no overflow, no float surprise)', () => {
    const r = computeSalesDoc({
      currency: 'USD',
      lines: [{ qty: '99999999', unitPrice: '999999999999' }],
    });
    expect(r.ok).toBe(false);
  });

  it('calculateSalesDoc agrees with the wire function (qty scaled by 10^4)', () => {
    const r = calculateSalesDoc({
      defaultTaxRateBp: 1000,
      discount: { kind: 'none', value: 0n },
      lines: [
        {
          qtyScaled: 20000n,
          unitPriceMinor: 1550n,
          discount: { kind: 'none', value: 0n },
          taxRateBp: null,
        },
      ],
    });
    expect(r.totalMinor).toBe(3410n);
  });

  it('parsing is exact: trailing zeros past the scale are fine, a real digit past it is not', () => {
    expect(parseQty('2.50000')).toBe(25000n);
    expect(parseQty('2.00005')).toBeNull();
    expect(parseMajor('10.500', 'USD')).toBe(1050n);
    expect(parseMajor('10.501', 'USD')).toBeNull();
    expect(parsePercentBp('18.5')).toBe(1850);
    expect(formatQty(25000n)).toBe('2.5');
    expect(formatQty(20000n)).toBe('2');
    expect(formatPercent(1850)).toBe('18.5');
    expect(formatPercent(0)).toBe('0');
  });
});
