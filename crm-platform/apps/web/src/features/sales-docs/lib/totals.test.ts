import { computeSalesDoc } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  computeTotals,
  formatQty,
  normalizeQty,
  parseQty,
  type DocDiscount,
  type LineInput,
} from './totals';

const line = (qty: string, unit: number, over: Partial<LineInput> = {}): LineInput => ({
  qty,
  unitPriceMinor: unit,
  discount: null,
  taxBp: null,
  ...over,
});
const pct = (bp: number): DocDiscount => ({ kind: 'percent', bp });
const amt = (minor: number): DocDiscount => ({ kind: 'amount', minor });

describe('quantity', () => {
  it('reads decimals exactly, up to four places', () => {
    expect(parseQty('2')).toBe(20000n);
    expect(parseQty('2.5')).toBe(25000n);
    expect(parseQty('2,5')).toBe(25000n);
    expect(parseQty('0.0001')).toBe(1n);
    expect(parseQty('1.00005')).toBe(10001n); // half rounds up
    expect(parseQty('1.00004')).toBe(10000n);
  });

  it('counts anything unreadable or negative as zero', () => {
    for (const bad of ['', 'abc', '-1', '1e3', '1.2.3']) expect(parseQty(bad), bad).toBe(0n);
  });

  it('writes the shortest exact string', () => {
    expect(formatQty(25000n)).toBe('2.5');
    expect(formatQty(10000n)).toBe('1');
    expect(formatQty(1n)).toBe('0.0001');
    expect(normalizeQty('2,50')).toBe('2.5');
    expect(normalizeQty('007')).toBe('7');
  });
});

describe('computeTotals: the WaDesk acceptance criteria (WD-PROP-006)', () => {
  it('2 x 15.50 + 1 x 9.99 at 10% tax is 4099 + 410 = 4509 (409.9 rounds up)', () => {
    const t = computeTotals({
      lines: [line('2', 1550), line('1', 999)],
      discount: null,
      defaultTaxBp: 1000,
    });
    expect(t.subtotalMinor).toBe(4099);
    expect(t.taxMinor).toBe(410);
    expect(t.totalMinor).toBe(4509);
  });

  it('a zero-decimal currency multiplies whole units (3 x 1500 JPY = 4500)', () => {
    const t = computeTotals({ lines: [line('3', 1500)], discount: null, defaultTaxBp: 0 });
    expect(t.subtotalMinor).toBe(4500);
    expect(t.totalMinor).toBe(4500);
  });

  it('a fractional quantity rounds the line once: 0.333 x 3.00 = 100', () => {
    expect(
      computeTotals({ lines: [line('0.333', 300)], discount: null, defaultTaxBp: 0 }).subtotalMinor,
    ).toBe(100);
  });

  it('no tax means no tax row', () => {
    const t = computeTotals({ lines: [line('1', 1000)], discount: null, defaultTaxBp: 0 });
    expect(t.taxMinor).toBe(0);
    expect(t.taxGroups).toEqual([]);
  });

  it('2 x 80 at 18% previews as 160 + 28.80 = 188.80', () => {
    const t = computeTotals({ lines: [line('2', 8000)], discount: null, defaultTaxBp: 1800 });
    expect([t.subtotalMinor, t.taxMinor, t.totalMinor]).toEqual([16000, 2880, 18880]);
  });

  it('rounds half up on the line and on the tax', () => {
    // 0.5 x 1.01 = 0.505 -> 51 (not 50)
    expect(
      computeTotals({ lines: [line('0.5', 101)], discount: null, defaultTaxBp: 0 }).subtotalMinor,
    ).toBe(51);
    // tax 5% of 10.10 = 0.505 -> 51
    expect(
      computeTotals({ lines: [line('1', 1010)], discount: null, defaultTaxBp: 500 }).taxMinor,
    ).toBe(51);
  });
});

describe('computeTotals: discounts and mixed rates', () => {
  it('a 10% document discount on 1000 with 10% tax: base 900, tax 90, total 990', () => {
    const t = computeTotals({
      lines: [line('1', 100000)],
      discount: pct(1000),
      defaultTaxBp: 1000,
    });
    expect(t.subtotalMinor).toBe(100000);
    expect(t.discountMinor).toBe(10000);
    expect(t.taxGroups).toEqual([{ rateBp: 1000, baseMinor: 90000, taxMinor: 9000 }]);
    expect(t.totalMinor).toBe(99000);
  });

  it('a line discount comes off the line before the tax', () => {
    const t = computeTotals({
      lines: [line('2', 5000, { discount: pct(2500) })],
      discount: null,
      defaultTaxBp: 1000,
    });
    expect(t.lines[0]).toMatchObject({
      grossMinor: 10000,
      discountMinor: 2500,
      netMinor: 7500,
      taxMinor: 750,
    });
    expect(t.totalMinor).toBe(8250);
  });

  it('a line discount can be an amount, capped at the line', () => {
    const t = computeTotals({
      lines: [line('1', 5000, { discount: amt(999999) })],
      discount: null,
      defaultTaxBp: 1000,
    });
    expect(t.lines[0]).toMatchObject({ discountMinor: 5000, netMinor: 0 });
    expect(t.totalMinor).toBe(0);
  });

  it('keeps one tax row per rate and lets a row override the document rate', () => {
    const t = computeTotals({
      lines: [line('1', 10000), line('1', 20000, { taxBp: 500 }), line('1', 10000, { taxBp: 0 })],
      discount: null,
      defaultTaxBp: 1800,
    });
    expect(t.taxGroups).toEqual([
      { rateBp: 1800, baseMinor: 10000, taxMinor: 1800 },
      { rateBp: 500, baseMinor: 20000, taxMinor: 1000 },
    ]); // the 0% row has no tax to show
    expect(t.taxMinor).toBe(2800);
    expect(t.totalMinor).toBe(40000 + 2800);
  });

  it('spreads an amount discount over the lines by net value, adding up exactly', () => {
    const t = computeTotals({
      lines: [line('1', 10000, { taxBp: 1000 }), line('1', 30000, { taxBp: 500 })],
      discount: amt(1001),
      defaultTaxBp: 0,
    });
    expect(t.discountMinor).toBe(1001);
    const bases = t.taxGroups.map((g) => g.baseMinor);
    expect(bases.reduce((a, b) => a + b, 0)).toBe(40000 - 1001);
    expect(t.totalMinor).toBe(40000 - 1001 + t.taxMinor);
  });

  it('never discounts below zero: an amount larger than the subtotal is capped', () => {
    const t = computeTotals({ lines: [line('1', 5000)], discount: amt(99999), defaultTaxBp: 1000 });
    expect(t.discountMinor).toBe(5000);
    expect(t.totalMinor).toBe(0);
    expect(t.taxMinor).toBe(0);
  });

  it('clamps nonsense inputs instead of failing', () => {
    const t = computeTotals({
      lines: [line('1', 1000, { discount: pct(99999), taxBp: -5 })],
      discount: pct(123456),
      defaultTaxBp: Number.NaN,
    });
    expect(t.subtotalMinor).toBe(0);
    expect(t.totalMinor).toBe(0);
  });

  it('an empty document totals zero', () => {
    expect(computeTotals({ lines: [], discount: null, defaultTaxBp: 1800 })).toMatchObject({
      subtotalMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
      overflow: false,
    });
  });

  it('stays exact on amounts a float would blur', () => {
    const t = computeTotals({
      lines: [line('3', 99_999_999_999)],
      discount: null,
      defaultTaxBp: 0,
    });
    expect(t.subtotalMinor).toBe(299_999_999_997);
  });

  it('says so, and prices nothing, when an amount is too large for the server to accept', () => {
    const t = computeTotals({
      lines: [line('99999999.9999', 99_999_999_999)],
      discount: null,
      defaultTaxBp: 0,
    });
    expect(t.overflow).toBe(true);
    expect(t.totalMinor).toBe(0);
  });
});

/**
 * The preview and the saved document must agree to the minor unit: the API prices with `computeSalesDoc` from the contracts, so
 * the same inputs through both must give the same figures. These cases include the ones that tripped WaDesk (a quantity with
 * decimals, many small lines, mixed rates, both discount kinds).
 */
describe('computeTotals equals the contract function (what the server saves)', () => {
  const wireOf = (
    lines: LineInput[],
    discount: DocDiscount,
    defaultTaxBp: number,
    currency: string,
  ) => ({
    currency,
    taxRate: String(defaultTaxBp / 100),
    discount: discount
      ? discount.kind === 'percent'
        ? { kind: 'percent' as const, value: String(discount.bp / 100) }
        : { kind: 'amount' as const, value: String(discount.minor / 100) }
      : null,
    lines: lines.map((l) => ({
      qty: l.qty,
      unitPrice: String(l.unitPriceMinor / 100),
      discount: l.discount
        ? l.discount.kind === 'percent'
          ? { kind: 'percent' as const, value: String(l.discount.bp / 100) }
          : { kind: 'amount' as const, value: String(l.discount.minor / 100) }
        : null,
      taxRate: l.taxBp === null ? null : String(l.taxBp / 100),
    })),
  });

  const cases: Array<[string, LineInput[], DocDiscount, number]> = [
    ['plain', [line('2', 1550), line('1', 999)], null, 1000],
    ['many small lines', Array.from({ length: 10 }, () => line('1', 5)), null, 1000],
    ['fractional quantity', [line('0.333', 300), line('2.5', 199)], null, 1850],
    [
      'mixed rates and a percent discount',
      [line('1', 10000), line('3', 3333, { taxBp: 500 })],
      pct(1250),
      1800,
    ],
    [
      'line discounts of both kinds and an amount discount',
      [line('4', 2500, { discount: pct(333) }), line('1', 7777, { discount: amt(1234) })],
      amt(555),
      700,
    ],
    ['rounding on the half', [line('0.5', 101), line('1', 1010, { taxBp: 500 })], pct(50), 500],
  ];
  for (const [name, lines, discount, tax] of cases) {
    it(name, () => {
      const mine = computeTotals({ lines, discount, defaultTaxBp: tax });
      const theirs = computeSalesDoc(wireOf(lines, discount, tax, 'USD'));
      if (!theirs.ok) throw new Error(JSON.stringify(theirs.issues));
      expect(mine.subtotalMinor).toBe(Number(theirs.value.subtotalMinor));
      expect(mine.discountMinor).toBe(Number(theirs.value.discountMinor));
      expect(mine.taxMinor).toBe(Number(theirs.value.taxMinor));
      expect(mine.totalMinor).toBe(Number(theirs.value.totalMinor));
      expect(mine.lines.map((l) => l.netMinor)).toEqual(
        theirs.value.lines.map((l) => Number(l.result.netMinor)),
      );
      expect(mine.lines.map((l) => l.taxMinor)).toEqual(
        theirs.value.lines.map((l) => Number(l.result.taxMinor)),
      );
    });
  }
});
