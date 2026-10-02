import { describe, expect, it } from 'vitest';
import {
  calculateInvoice,
  calculateSalesDoc,
  computeInvoice,
  minorToMajor,
  type InvoiceCalcLineInput,
} from '@crm/contracts';

/**
 * The money math of invoices (TW-INV-006, TW-INV-013, D-04, D-06). The rounding rule is the one proposals and estimates use: the
 * invoice calls the sales-docs function for everything they share, and the property test below pins the two together.
 */

const line = (over: Partial<InvoiceCalcLineInput> = {}): InvoiceCalcLineInput => ({
  qtyScaled: 10_000n,
  unitPriceMinor: 0n,
  discount: { kind: 'none', value: 0n },
  taxRateBp: 0,
  taxInclusive: false,
  taxName: null,
  ...over,
});

describe('invoice math: the Reference acceptance examples, with the fixes', () => {
  it('TW-INV-006 #1: 3 x 19.99 USD, 10% tax, discount 5.00, shipping 2.50 (tax is on the discounted amount, not the undiscounted one)', () => {
    const r = computeInvoice({
      currency: 'USD',
      discount: { kind: 'amount', value: '5.00' },
      shipping: '2.50',
      lines: [{ qty: '3', unitPrice: '19.99', taxRate: '10', taxName: 'Tax' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.value.result;
    expect(t.subtotalMinor).toBe(5997n);
    expect(t.discountMinor).toBe(500n);
    // 10% of 54.97 = 5.497 -> 5.50. Reference charged 5.997 -> 6.00 (tax on the undiscounted subtotal, D-06) and totalled 63.47.
    expect(t.taxMinor).toBe(550n);
    expect(t.shippingMinor).toBe(250n);
    expect(t.totalMinor).toBe(6297n);
  });

  it('TW-INV-006 #2: JPY has no decimals: 1500 at 10% is 150 tax, 1650 total', () => {
    const r = computeInvoice({ currency: 'jpy', lines: [{ qty: '1', unitPrice: '1500', taxRate: '10' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.currency).toBe('JPY');
    expect(r.value.exponent).toBe(0);
    expect(r.value.result.taxMinor).toBe(150n);
    expect(r.value.result.totalMinor).toBe(1650n);
    expect(minorToMajor(r.value.result.totalMinor, 'JPY')).toBe('1650');
  });

  it('TW-INV-006 #5 / D-04: KWD has three decimals (Reference used two): 12.500 is 12500 minor and prints 12.500', () => {
    const r = computeInvoice({ currency: 'KWD', lines: [{ qty: '1', unitPrice: '12.500' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.exponent).toBe(3);
    expect(r.value.result.totalMinor).toBe(12500n);
    expect(minorToMajor(r.value.result.totalMinor, 'KWD')).toBe('12.500');
  });

  it('a price with more decimals than the currency allows is refused with the path of the field', () => {
    const r = computeInvoice({ currency: 'JPY', lines: [{ qty: '1', unitPrice: '10.5' }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]!.path).toBe('lines.0.unitPrice');
    const kwd = computeInvoice({ currency: 'USD', lines: [{ qty: '1', unitPrice: '1.005' }] });
    expect(kwd.ok).toBe(false);
  });

  it('refuses no lines, a zero quantity and more than 100 lines', () => {
    expect(computeInvoice({ currency: 'USD', lines: [] }).ok).toBe(false);
    expect(computeInvoice({ currency: 'USD', lines: [{ qty: '0', unitPrice: '1' }] }).ok).toBe(false);
    const many = Array.from({ length: 101 }, () => ({ qty: '1', unitPrice: '1' }));
    const r = computeInvoice({ currency: 'USD', lines: many });
    expect(r.ok).toBe(false);
  });
});

describe('invoice math: the one rounding rule', () => {
  it('rounds half up at the step where the amount is produced: 0.5 x 0.05 = 0.025 -> 0.03', () => {
    const r = calculateInvoice({ discount: { kind: 'none', value: 0n }, shippingMinor: 0n, lines: [line({ qtyScaled: 5000n, unitPriceMinor: 5n })] });
    expect(r.lines[0]!.grossMinor).toBe(3n);
  });

  it('a sum is never rounded again: three lines of 0.005 tax each add up to the sum of the rounded taxes, not the rounded sum', () => {
    const lines = [1, 2, 3].map(() => line({ unitPriceMinor: 5n, taxRateBp: 1000 }));
    const r = calculateInvoice({ discount: { kind: 'none', value: 0n }, shippingMinor: 0n, lines });
    // each: 5 x 10% = 0.5 -> 1 (half up); the unrounded sum 1.5 would round to 2 if the SUM were rounded
    expect(r.lines.map((l) => l.taxMinor)).toEqual([1n, 1n, 1n]);
    expect(r.taxMinor).toBe(3n);
  });

  it('the document discount is spread by largest remainder: the shares add back to it exactly, ties go to the earlier line', () => {
    const r = calculateInvoice({
      discount: { kind: 'amount', value: 100n },
      shippingMinor: 0n,
      lines: [line({ unitPriceMinor: 100n }), line({ unitPriceMinor: 100n }), line({ unitPriceMinor: 100n })],
    });
    expect(r.lines.map((l) => l.sharedDiscountMinor)).toEqual([34n, 33n, 33n]);
    expect(r.discountMinor).toBe(100n);
    expect(r.totalMinor).toBe(200n);
  });

  it('a percent discount is rounded once on the subtotal, an amount discount never exceeds it', () => {
    const pct = calculateInvoice({ discount: { kind: 'percent', value: 1250n }, shippingMinor: 0n, lines: [line({ unitPriceMinor: 999n })] });
    expect(pct.discountMinor).toBe(125n); // 12.5% of 9.99 = 1.24875 -> 1.25
    const over = calculateInvoice({ discount: { kind: 'amount', value: 99_999n }, shippingMinor: 0n, lines: [line({ unitPriceMinor: 1000n })] });
    expect(over.discountMinor).toBe(1000n);
    expect(over.totalMinor).toBe(0n);
  });

  it('shipping is added after tax and is never discounted or taxed', () => {
    const r = calculateInvoice({
      discount: { kind: 'percent', value: 5000n },
      shippingMinor: 1000n,
      lines: [line({ unitPriceMinor: 10_000n, taxRateBp: 2000 })],
    });
    expect(r.discountMinor).toBe(5000n);
    expect(r.taxMinor).toBe(1000n); // 20% of the discounted 50.00
    expect(r.totalMinor).toBe(10_000n - 5000n + 1000n + 1000n);
  });
});

describe('invoice math: inclusive tax', () => {
  it('the entered price already contains the tax: 118.00 at 18% inclusive is 18.00 tax, base 100.00, total stays 118.00', () => {
    const r = calculateInvoice({
      discount: { kind: 'none', value: 0n },
      shippingMinor: 0n,
      lines: [line({ unitPriceMinor: 11_800n, taxRateBp: 1800, taxInclusive: true, taxName: 'GST' })],
    });
    expect(r.taxMinor).toBe(1800n);
    expect(r.taxAddedMinor).toBe(0n);
    expect(r.totalMinor).toBe(11_800n);
    expect(r.taxGroups).toEqual([{ name: 'GST', rateBp: 1800, inclusive: true, baseMinor: 10_000n, taxMinor: 1800n }]);
  });

  it('an inclusive and an exclusive line mix: only the exclusive tax is added to the total', () => {
    const r = calculateInvoice({
      discount: { kind: 'none', value: 0n },
      shippingMinor: 0n,
      lines: [
        line({ unitPriceMinor: 11_800n, taxRateBp: 1800, taxInclusive: true }),
        line({ unitPriceMinor: 10_000n, taxRateBp: 1000, taxInclusive: false }),
      ],
    });
    expect(r.taxMinor).toBe(2800n);
    expect(r.taxAddedMinor).toBe(1000n);
    expect(r.totalMinor).toBe(11_800n + 10_000n + 1000n);
    expect(r.taxGroups).toHaveLength(2);
  });

  it('the document discount reduces the amount the inclusive tax is extracted from', () => {
    const r = calculateInvoice({
      discount: { kind: 'amount', value: 1180n },
      shippingMinor: 0n,
      lines: [line({ unitPriceMinor: 11_800n, taxRateBp: 1800, taxInclusive: true })],
    });
    // pays 106.20 of which 16.20 is tax
    expect(r.totalMinor).toBe(10_620n);
    expect(r.taxMinor).toBe(1620n);
  });
});

describe('invoice math: it is the same rule as proposals and estimates', () => {
  // A small deterministic generator: the property must hold for inputs nobody hand-picked.
  let seed = 20_261_007;
  const rnd = (n: number) => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff;
    return seed % n;
  };

  it('for tax-exclusive documents the figures equal calculateSalesDoc, line by line, over 400 random documents', () => {
    for (let i = 0; i < 400; i++) {
      const n = 1 + rnd(6);
      const lines: InvoiceCalcLineInput[] = Array.from({ length: n }, () => {
        const kind = (['none', 'percent', 'amount'] as const)[rnd(3)]!;
        return line({
          qtyScaled: BigInt(1 + rnd(500_000)),
          unitPriceMinor: BigInt(rnd(2_000_000)),
          discount: kind === 'none' ? { kind, value: 0n } : { kind, value: BigInt(kind === 'percent' ? rnd(10_001) : rnd(50_000)) },
          taxRateBp: [0, 500, 1000, 1800, 2000, 725][rnd(6)]!,
        });
      });
      const dk = (['none', 'percent', 'amount'] as const)[rnd(3)]!;
      const discount = dk === 'none' ? { kind: dk, value: 0n } : { kind: dk, value: BigInt(dk === 'percent' ? rnd(10_001) : rnd(500_000)) };
      const inv = calculateInvoice({ discount, shippingMinor: 0n, lines });
      const doc = calculateSalesDoc({
        defaultTaxRateBp: 0,
        discount,
        lines: lines.map((l) => ({ qtyScaled: l.qtyScaled, unitPriceMinor: l.unitPriceMinor, discount: l.discount, taxRateBp: l.taxRateBp })),
      });
      expect(inv.subtotalMinor).toBe(doc.subtotalMinor);
      expect(inv.discountMinor).toBe(doc.discountMinor);
      expect(inv.taxMinor).toBe(doc.taxMinor);
      expect(inv.totalMinor).toBe(doc.totalMinor);
      inv.lines.forEach((l, k) => {
        expect(l.taxMinor).toBe(doc.lines[k]!.taxMinor);
        expect(l.sharedDiscountMinor).toBe(doc.lines[k]!.sharedDiscountMinor);
      });
    }
  });

  it('the invariants the database also checks hold for any document, inclusive tax and shipping included', () => {
    for (let i = 0; i < 400; i++) {
      const n = 1 + rnd(5);
      const lines = Array.from({ length: n }, () =>
        line({
          qtyScaled: BigInt(1 + rnd(300_000)),
          unitPriceMinor: BigInt(rnd(1_000_000)),
          taxRateBp: [0, 500, 1800, 2000][rnd(4)]!,
          taxInclusive: rnd(2) === 1,
        }),
      );
      const discount = rnd(2) ? { kind: 'percent' as const, value: BigInt(rnd(5000)) } : { kind: 'none' as const, value: 0n };
      const shippingMinor = BigInt(rnd(5000));
      const r = calculateInvoice({ discount, shippingMinor, lines });
      expect(r.totalMinor).toBe(r.subtotalMinor - r.discountMinor + r.taxAddedMinor + shippingMinor);
      expect(r.lines.reduce((a, l) => a + l.totalMinor, 0n) + shippingMinor).toBe(r.totalMinor);
      expect(r.lines.reduce((a, l) => a + l.sharedDiscountMinor, 0n)).toBe(r.discountMinor);
      expect(r.taxAddedMinor <= r.taxMinor).toBe(true);
      expect(r.discountMinor <= r.subtotalMinor).toBe(true);
      expect(r.taxGroups.reduce((a, g) => a + g.taxMinor, 0n)).toBe(r.taxMinor);
    }
  });
});
