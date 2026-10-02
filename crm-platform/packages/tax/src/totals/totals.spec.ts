import { describe, expect, it } from 'vitest';
import { cashRoundingFor } from '../money/cash';
import { currencyExponent } from '../money/currency';
import { pick, randInt, rng } from '../test-utils';
import { calculateDocument, grossFromNet, netFromGross, tryCalculateDocument } from './calculate';
import { settle } from './settle';
import {
  TaxMathError,
  type DocumentInput,
  type DocumentResult,
  type LineInput,
  type LineTaxInput,
} from './types';

const VAT = (pct: string | number, extra: Partial<LineTaxInput> = {}): LineTaxInput => ({
  code: 'VAT',
  name: `VAT ${pct}%`,
  rate: pct,
  ...extra,
});
const q = (n: number): bigint => BigInt(Math.round(n * 10000));

describe('golden fixtures: exclusive prices, per line', () => {
  it('Reference proposal fixture: 2 x 15.50 + 1 x 9.99 at 10% (TW-PROP-006)', () => {
    const r = calculateDocument({
      currency: 'USD',
      lines: [
        { qtyScaled: q(2), unitPriceMinor: 1550n, taxes: [VAT(10)] },
        { qtyScaled: q(1), unitPriceMinor: 999n, taxes: [VAT(10)] },
      ],
    });
    expect(r.subtotalMinor).toBe(4099n);
    expect(r.taxMinor).toBe(410n); // 310 + round(99.9)
    expect(r.totalMinor).toBe(4509n);
    expect(r.taxSummary).toHaveLength(1);
    expect(r.taxSummary[0]).toMatchObject({
      code: 'VAT',
      ratePercent: '10',
      baseMinor: 4099n,
      taxMinor: 410n,
      inclusive: false,
    });
  });

  it('qty 0.333 x 3.00 = 1.00 (TW-PROP-006)', () => {
    const r = calculateDocument({
      currency: 'USD',
      lines: [{ qtyScaled: 3330n, unitPriceMinor: 300n }],
    });
    expect(r.lines[0]!.grossMinor).toBe(100n);
    expect(r.totalMinor).toBe(100n);
  });

  it('Reference invoice fixture with the discount actually allocated (differs from Reference by design, D-04)', () => {
    // Reference: qty 3 x 19.99, tax 10, discount 5, shipping 2.50 -> subtotal 5997, tax 600 (on the undiscounted), total 6347.
    // Here the 5.00 discount reduces the taxable amount: tax = 5497 x 10% = 549.7 -> 550; total = 5497 + 550 + 250.
    const r = calculateDocument({
      currency: 'USD',
      discount: { kind: 'amount', minor: 500n },
      lines: [
        { qtyScaled: q(3), unitPriceMinor: 1999n, taxes: [VAT(10)] },
        { kind: 'shipping', unitPriceMinor: 250n },
      ],
    });
    expect(r.subtotalMinor).toBe(5997n);
    expect(r.discountMinor).toBe(500n);
    expect(r.shippingMinor).toBe(250n);
    expect(r.taxMinor).toBe(550n);
    expect(r.totalMinor).toBe(6297n);
  });

  it('JPY has no minor unit: 1500 + 10% = 1650 (TW-INV-006)', () => {
    const r = calculateDocument({
      currency: 'JPY',
      lines: [{ unitPriceMinor: 1500n, taxes: [VAT(10)] }],
    });
    expect(r.exponent).toBe(0);
    expect(r.taxMinor).toBe(150n);
    expect(r.totalMinor).toBe(1650n);
  });

  it('KWD has 3 decimals: 12.500 + 5% = 13.125', () => {
    const r = calculateDocument({
      currency: 'KWD',
      lines: [{ unitPriceMinor: 12500n, taxes: [VAT(5)] }],
    });
    expect(r.exponent).toBe(3);
    expect(r.taxMinor).toBe(625n);
    expect(r.totalMinor).toBe(13125n);
  });

  it('USD half-up per line: 3 lines of 0.05 at 10% charge 0.01 each', () => {
    const lines: LineInput[] = [1, 2, 3].map(() => ({ unitPriceMinor: 5n, taxes: [VAT(10)] }));
    expect(calculateDocument({ currency: 'USD', lines }).taxMinor).toBe(3n);
  });
});

describe('rounding level and mode (per line vs on total)', () => {
  const three: LineInput[] = [1, 2, 3].map(() => ({ unitPriceMinor: 5n, taxes: [VAT(10)] }));
  it('per_line half_up rounds 0.5 up on each line', () => {
    expect(calculateDocument({ currency: 'JPY', lines: three }).taxMinor).toBe(3n);
  });
  it('on_total rounds the summed tax once (Japan qualified invoice)', () => {
    const r = calculateDocument({ currency: 'JPY', rounding: { level: 'on_total' }, lines: three });
    expect(r.taxMinor).toBe(2n); // 15 x 10% = 1.5 -> 2
    expect(r.taxSummary[0]!.baseMinor).toBe(15n);
    expect(r.totalMinor).toBe(17n);
  });
  it('half_even changes the tie behaviour', () => {
    const per = calculateDocument({
      currency: 'JPY',
      rounding: { mode: 'half_even' },
      lines: three,
    });
    expect(per.taxMinor).toBe(0n); // 0.5 -> 0 on each line
    const tot = calculateDocument({
      currency: 'JPY',
      rounding: { level: 'on_total', mode: 'half_even' },
      lines: three,
    });
    expect(tot.taxMinor).toBe(2n); // 1.5 -> 2
  });
  it('the Reference 409.9 case is the same either way', () => {
    const lines: LineInput[] = [
      { qtyScaled: q(2), unitPriceMinor: 1550n, taxes: [VAT(10)] },
      { unitPriceMinor: 999n, taxes: [VAT(10)] },
    ];
    expect(calculateDocument({ currency: 'USD', lines }).taxMinor).toBe(410n);
    expect(
      calculateDocument({ currency: 'USD', rounding: { level: 'on_total' }, lines }).taxMinor,
    ).toBe(410n);
  });
  it('on_total can differ from per_line by whole minor units on many lines', () => {
    const many: LineInput[] = Array.from({ length: 40 }, () => ({
      unitPriceMinor: 33n,
      taxes: [VAT(18)],
    }));
    const a = calculateDocument({ currency: 'USD', lines: many });
    const b = calculateDocument({ currency: 'USD', rounding: { level: 'on_total' }, lines: many });
    expect(a.taxMinor).toBe(40n * 6n); // 5.94 -> 6 each
    expect(b.taxMinor).toBe(238n); // 1320 x 18% = 237.6
  });
  it('all rounding modes produce a consistent document', () => {
    for (const mode of [
      'half_up',
      'half_down',
      'half_even',
      'up',
      'down',
      'ceil',
      'floor',
    ] as const) {
      for (const level of ['per_line', 'on_total'] as const) {
        const r = calculateDocument({
          currency: 'USD',
          rounding: { mode, level },
          discount: { kind: 'percent', percent: '7.5' },
          lines: [
            { qtyScaled: q(1.5), unitPriceMinor: 333n, taxes: [VAT(18)] },
            { qtyScaled: q(2.25), unitPriceMinor: 1049n, taxes: [VAT(5)] },
          ],
        });
        expect(r.totalMinor).toBe(r.taxableMinor + r.taxAddedMinor);
      }
    }
  });
});

describe('discounts', () => {
  it('line discount percent and amount', () => {
    const r = calculateDocument({
      currency: 'USD',
      lines: [
        { unitPriceMinor: 10000n, discount: { kind: 'percent', percent: '12.5' } },
        { unitPriceMinor: 10000n, discount: { kind: 'amount', minor: 2500n } },
        { unitPriceMinor: 1000n, discount: { kind: 'amount', minor: 99999n } }, // capped at gross
      ],
    });
    expect(r.lines.map((l) => l.discountMinor)).toEqual([1250n, 2500n, 1000n]);
    expect(r.lines.map((l) => l.netMinor)).toEqual([8750n, 7500n, 0n]);
    expect(r.subtotalMinor).toBe(16250n);
  });

  it('document discount is spread pro rata and taxes follow each line', () => {
    const r = calculateDocument({
      currency: 'USD',
      discount: { kind: 'percent', percent: '10' },
      lines: [
        { unitPriceMinor: 10000n, taxes: [VAT(20)] },
        { unitPriceMinor: 30000n, taxes: [VAT(5)] },
      ],
    });
    expect(r.discountMinor).toBe(4000n);
    expect(r.lines.map((l) => l.sharedDiscountMinor)).toEqual([1000n, 3000n]);
    expect(r.lines.map((l) => l.taxableMinor)).toEqual([9000n, 27000n]);
    expect(r.lines.map((l) => l.taxMinor)).toEqual([1800n, 1350n]);
    expect(r.totalMinor).toBe(36000n + 3150n);
  });

  it('a discount larger than the subtotal is clamped (Reference stored the over-large figure)', () => {
    const r = calculateDocument({
      currency: 'USD',
      discount: { kind: 'amount', minor: 99999n },
      lines: [{ unitPriceMinor: 1000n, taxes: [VAT(10)] }],
    });
    expect(r.discountMinor).toBe(1000n);
    expect(r.totalMinor).toBe(0n);
    expect(r.taxMinor).toBe(0n);
  });

  it('shipping and adjustments do not share in the document discount unless told to', () => {
    const r = calculateDocument({
      currency: 'USD',
      discount: { kind: 'percent', percent: '50' },
      lines: [
        { unitPriceMinor: 1000n },
        { kind: 'shipping', unitPriceMinor: 400n },
        { kind: 'adjustment', unitPriceMinor: -50n },
      ],
    });
    expect(r.discountMinor).toBe(500n);
    expect(r.shippingMinor).toBe(400n);
    expect(r.adjustmentMinor).toBe(-50n);
    expect(r.totalMinor).toBe(1000n - 500n + 400n - 50n);
    const d = calculateDocument({
      currency: 'USD',
      discount: { kind: 'percent', percent: '50' },
      lines: [
        { unitPriceMinor: 1000n },
        { kind: 'shipping', unitPriceMinor: 1000n, discountable: true },
      ],
    });
    expect(d.discountMinor).toBe(1000n);
  });

  it('shares add back to the discount exactly even with awkward splits', () => {
    const r = calculateDocument({
      currency: 'USD',
      discount: { kind: 'amount', minor: 100n },
      lines: [{ unitPriceMinor: 100n }, { unitPriceMinor: 100n }, { unitPriceMinor: 100n }],
    });
    expect(r.lines.map((l) => l.sharedDiscountMinor)).toEqual([34n, 33n, 33n]);
  });
});

describe('tax-inclusive prices', () => {
  it('extracts tax from a gross price: 100.00 at 20% -> 83.33 + 16.67', () => {
    const r = calculateDocument({
      currency: 'GBP',
      pricesIncludeTax: true,
      lines: [{ unitPriceMinor: 10000n, taxes: [VAT(20)] }],
    });
    expect(r.lines[0]!.taxMinor).toBe(1667n);
    expect(r.taxSummary[0]).toMatchObject({ baseMinor: 8333n, taxMinor: 1667n, inclusive: true });
    expect(r.totalMinor).toBe(10000n); // the buyer pays the listed price
    expect(r.taxAddedMinor).toBe(0n);
    expect(r.taxMinor).toBe(1667n);
  });
  it('India: 1180.00 inclusive of 18% GST -> 1000.00 + CGST 90 + SGST 90', () => {
    const r = calculateDocument({
      currency: 'INR',
      pricesIncludeTax: true,
      lines: [
        {
          unitPriceMinor: 118000n,
          taxes: [
            { code: 'CGST', name: 'CGST 9%', rate: 9 },
            { code: 'SGST', name: 'SGST 9%', rate: 9 },
          ],
        },
      ],
    });
    expect(r.lines[0]!.taxes.map((t) => t.amountMinor)).toEqual([9000n, 9000n]);
    expect(r.lines[0]!.taxes.map((t) => t.baseMinor)).toEqual([100000n, 100000n]);
    expect(r.totalMinor).toBe(118000n);
  });
  it('a line can override the document price mode', () => {
    const r = calculateDocument({
      currency: 'EUR',
      lines: [
        { unitPriceMinor: 12000n, taxes: [VAT(20)], taxInclusive: true },
        { unitPriceMinor: 10000n, taxes: [VAT(20)] },
      ],
    });
    expect(r.lines[0]!.totalMinor).toBe(12000n);
    expect(r.lines[1]!.totalMinor).toBe(12000n);
    expect(r.taxSummary).toHaveLength(2);
    expect(r.taxAddedMinor).toBe(2000n);
    expect(r.taxMinor).toBe(4000n);
  });
  it('net + tax always equals the inclusive price (property)', () => {
    const r = rng(101);
    for (let i = 0; i < 1500; i++) {
      const gross = BigInt(randInt(r, 0, 5_000_000));
      const pct = pick(r, ['5', '7.5', '9.975', '12', '16', '18', '19', '20', '21', '25', '27']);
      const { netMinor, taxMinor } = netFromGross(gross, [VAT(pct)]);
      expect(netMinor + taxMinor).toBe(gross);
      expect(taxMinor >= 0n && netMinor >= 0n).toBe(true);
    }
  });
  it('inclusive -> exclusive -> inclusive round trip is stable within one minor unit (property)', () => {
    const r = rng(202);
    for (let i = 0; i < 1500; i++) {
      const gross = BigInt(randInt(r, 100, 2_000_000));
      const pct = pick(r, ['5', '10', '15', '18', '20', '23']);
      const { netMinor, taxMinor } = netFromGross(gross, [VAT(pct)]);
      const back = grossFromNet(netMinor, [VAT(pct)]);
      expect(back.grossMinor - gross <= 1n && gross - back.grossMinor <= 1n).toBe(true);
      expect(back.taxMinor - taxMinor <= 1n && taxMinor - back.taxMinor <= 1n).toBe(true);
    }
  });
  it('multiple additive taxes split a gross price without losing a minor unit', () => {
    const r = rng(303);
    for (let i = 0; i < 800; i++) {
      const gross = BigInt(randInt(r, 1, 3_000_000));
      const taxes = [
        { code: 'GST', name: 'GST', rate: '5' },
        { code: 'QST', name: 'QST', rate: '9.975' },
      ];
      const { netMinor, taxMinor } = netFromGross(gross, taxes);
      expect(netMinor + taxMinor).toBe(gross);
    }
  });
});

describe('multiple taxes per line', () => {
  it('additive: GST 5% + QST 9.975% on 100.00 (Quebec)', () => {
    const r = calculateDocument({
      currency: 'CAD',
      lines: [
        {
          unitPriceMinor: 10000n,
          taxes: [
            { code: 'GST', name: 'GST 5%', rate: '5' },
            { code: 'QST', name: 'QST 9.975%', rate: '9.975' },
          ],
        },
      ],
    });
    expect(r.lines[0]!.taxes.map((t) => t.amountMinor)).toEqual([500n, 998n]); // 997.5 -> 998
    expect(r.taxMinor).toBe(1498n);
    expect(r.totalMinor).toBe(11498n);
    expect(r.taxSummary.map((s) => s.code).sort()).toEqual(['GST', 'QST']);
  });
  it('compound: the second tax is charged on the price plus the first tax (pre-2013 QST)', () => {
    const r = calculateDocument({
      currency: 'CAD',
      lines: [
        {
          unitPriceMinor: 10000n,
          taxes: [
            { code: 'GST', name: 'GST 5%', rate: '5' },
            { code: 'QST', name: 'QST 9.5%', rate: '9.5', compound: true },
          ],
        },
      ],
    });
    expect(r.lines[0]!.taxes[1]!.baseMinor).toBe(10500n);
    expect(r.lines[0]!.taxes.map((t) => t.amountMinor)).toEqual([500n, 998n]); // 10500 x 9.5% = 997.5
    expect(r.totalMinor).toBe(11498n);
  });
  it('inclusive compound extraction reconciles', () => {
    const { netMinor, taxMinor } = netFromGross(11498n, [
      { code: 'GST', name: 'GST', rate: '5' },
      { code: 'QST', name: 'QST', rate: '9.5', compound: true },
    ]);
    expect(netMinor).toBe(10000n);
    expect(taxMinor).toBe(1498n);
  });
  it('zero-rated and exempt markers appear in the summary with a zero tax', () => {
    const r = calculateDocument({
      currency: 'GBP',
      lines: [
        {
          unitPriceMinor: 5000n,
          taxes: [{ code: 'VAT', name: 'VAT 0%', rate: '0', category: 'zero' }],
        },
        { unitPriceMinor: 5000n, taxes: [VAT(20)] },
      ],
    });
    expect(r.taxSummary).toHaveLength(2);
    const zero = r.taxSummary.find((s) => s.ratePercent === '0')!;
    expect(zero).toMatchObject({ baseMinor: 5000n, taxMinor: 0n, category: 'zero' });
    expect(r.totalMinor).toBe(5000n + 5000n + 1000n);
  });
  it('the summary groups equal rates across lines and sorts by rate', () => {
    const r = calculateDocument({
      currency: 'EUR',
      lines: [
        { unitPriceMinor: 1000n, taxes: [VAT(7)] },
        { unitPriceMinor: 2000n, taxes: [VAT(19)] },
        { unitPriceMinor: 3000n, taxes: [VAT(7)] },
      ],
    });
    expect(r.taxSummary.map((s) => [s.ratePercent, s.baseMinor, s.taxMinor])).toEqual([
      ['19', 2000n, 380n],
      ['7', 4000n, 280n],
    ]);
  });
});

describe('withholding (TDS-style negative taxes)', () => {
  const gst = [
    { code: 'CGST', name: 'CGST 9%', rate: '9' },
    { code: 'SGST', name: 'SGST 9%', rate: '9' },
  ];
  it('TDS reduces the amount payable, not the invoice total', () => {
    const r = calculateDocument({
      currency: 'INR',
      lines: [
        {
          unitPriceMinor: 100000n,
          taxes: [
            ...gst,
            { code: 'TDS_194J', name: 'TDS 194J 10%', rate: '10', category: 'withholding' },
          ],
        },
      ],
    });
    expect(r.taxMinor).toBe(18000n);
    expect(r.totalMinor).toBe(118000n);
    expect(r.withholdingMinor).toBe(10000n); // on the ex-GST amount
    expect(r.payableMinor).toBe(108000n);
    expect(r.amountDueMinor).toBe(108000n);
    expect(r.withholdingSummary).toEqual([
      {
        key: 'TDS_194J|10',
        code: 'TDS_194J',
        name: 'TDS 194J 10%',
        ratePercent: '10',
        baseMinor: 100000n,
        amountMinor: 10000n,
      },
    ]);
    expect(r.lines[0]!.taxes[2]!.amountMinor).toBe(-10000n);
  });
  it('a negative rate means withholding too', () => {
    const r = calculateDocument({
      currency: 'INR',
      lines: [{ unitPriceMinor: 50000n, taxes: [{ code: 'TDS', name: 'TDS', rate: '-2' }] }],
    });
    expect(r.withholdingMinor).toBe(1000n);
    expect(r.payableMinor).toBe(49000n);
  });
  it('on an inclusive price it is charged on the ex-tax amount', () => {
    const r = calculateDocument({
      currency: 'INR',
      pricesIncludeTax: true,
      lines: [
        {
          unitPriceMinor: 118000n,
          taxes: [
            { code: 'IGST', name: 'IGST 18%', rate: '18' },
            { code: 'TDS', name: 'TDS', rate: '10', category: 'withholding' },
          ],
        },
      ],
    });
    expect(r.withholdingMinor).toBe(10000n);
    expect(r.totalMinor).toBe(118000n);
  });
});

describe('cash rounding, payments and credits', () => {
  it('adds a rounding adjustment line so the document adds up (CHF)', () => {
    const r = calculateDocument({
      currency: 'CHF',
      cashRounding: cashRoundingFor('CHF'),
      lines: [{ unitPriceMinor: 12345n, taxes: [VAT('8.1')] }],
    });
    expect(r.totalBeforeRoundingMinor).toBe(12345n + 1000n); // 999.945 -> 1000
    expect(r.roundingMinor).toBe(0n);
    const r2 = calculateDocument({
      currency: 'CHF',
      cashRounding: cashRoundingFor('CHF'),
      lines: [{ unitPriceMinor: 12346n }],
    });
    expect(r2.roundingMinor).toBe(-1n);
    expect(r2.totalMinor).toBe(12345n);
    expect(r2.totalBeforeRoundingMinor + r2.roundingMinor).toBe(r2.totalMinor);
  });
  it('amount due after payments and credits, with overpayment reported', () => {
    const base: DocumentInput = {
      currency: 'USD',
      lines: [{ unitPriceMinor: 100000n, taxes: [VAT(10)] }],
    };
    expect(calculateDocument(base).paymentStatus).toBe('unpaid');
    const part = calculateDocument({ ...base, payments: [30000n, 20000n], credits: [10000n] });
    expect(part).toMatchObject({
      paidMinor: 50000n,
      creditedMinor: 10000n,
      amountDueMinor: 50000n,
      overpaidMinor: 0n,
      paymentStatus: 'partially_paid',
    });
    expect(calculateDocument({ ...base, payments: [110000n] })).toMatchObject({
      amountDueMinor: 0n,
      paymentStatus: 'paid',
    });
    expect(calculateDocument({ ...base, payments: [120000n] })).toMatchObject({
      amountDueMinor: 0n,
      overpaidMinor: 10000n,
      paymentStatus: 'overpaid',
    });
  });
  it('settle rejects negative payments', () => {
    expect(() => settle({ payableMinor: 1n, payments: [-1n] })).toThrow(RangeError);
  });
  it('a zero invoice is paid', () => {
    expect(
      calculateDocument({ currency: 'USD', lines: [{ unitPriceMinor: 0n }] }).paymentStatus,
    ).toBe('paid');
  });
});

describe('validation', () => {
  it('reports the offending path', () => {
    const bad = (input: DocumentInput) => {
      const r = tryCalculateDocument(input);
      return r.ok ? null : r.issue;
    };
    expect(
      bad({
        currency: 'USD',
        lines: [{ unitPriceMinor: 1n, taxes: [{ code: 'X', name: 'X', rate: 'abc' }] }],
      }),
    ).toMatchObject({ path: 'lines.0.taxes.0' });
    expect(bad({ currency: 'USD', lines: [{ unitPriceMinor: -1n }] })).toMatchObject({
      path: 'lines.0.unitPrice',
    });
    expect(bad({ currency: 'USD', lines: [{ unitPriceMinor: 1n, qtyScaled: -1n }] })).toMatchObject(
      { path: 'lines.0.qty' },
    );
    expect(
      bad({ currency: 'USD', discount: { kind: 'percent', percent: '101' }, lines: [] }),
    ).toMatchObject({ path: 'discount' });
    expect(bad({ currency: 'USD', lines: [{ unitPriceMinor: 10n ** 18n }] })).toMatchObject({
      path: 'lines.0.unitPrice',
    });
    expect(() => calculateDocument({ currency: 'USD', lines: [{ unitPriceMinor: -1n }] })).toThrow(
      TaxMathError,
    );
  });
  it('an empty document is zero', () => {
    const r = calculateDocument({ currency: 'USD', lines: [] });
    expect(r.totalMinor).toBe(0n);
    expect(r.taxSummary).toEqual([]);
  });
});

// ----- property-style invariants ---------------------------------------------------------------------------------------------

function randomDoc(r: () => number): DocumentInput {
  const currency = pick(r, ['USD', 'JPY', 'KWD', 'INR', 'EUR']);
  const incl = r() < 0.4;
  const lines: LineInput[] = Array.from({ length: randInt(r, 1, 9) }, () => {
    const taxes: LineTaxInput[] = [];
    const t = r();
    if (t < 0.6) taxes.push(VAT(pick(r, ['5', '7.5', '12', '18', '20', '23'])));
    else if (t < 0.8)
      taxes.push(
        { code: 'CGST', name: 'CGST', rate: '9' },
        { code: 'SGST', name: 'SGST', rate: '9' },
      );
    else if (t < 0.9)
      taxes.push(
        { code: 'GST', name: 'GST', rate: '5' },
        { code: 'QST', name: 'QST', rate: '9.975', compound: r() < 0.3 },
      );
    if (r() < 0.1) taxes.push({ code: 'TDS', name: 'TDS', rate: '10', category: 'withholding' });
    const line: LineInput = {
      qtyScaled: BigInt(randInt(r, 1, 250000)),
      unitPriceMinor: BigInt(randInt(r, 0, 500000)),
      taxes,
    };
    if (r() < 0.3)
      line.discount =
        r() < 0.5
          ? { kind: 'percent', percent: pick(r, ['5', '10', '12.5', '33.3333']) }
          : { kind: 'amount', minor: BigInt(randInt(r, 0, 100000)) };
    if (r() < 0.2) line.taxInclusive = !incl;
    if (r() < 0.1) line.kind = 'shipping';
    return line;
  });
  const input: DocumentInput = {
    currency,
    pricesIncludeTax: incl,
    lines,
    rounding: {
      level: r() < 0.5 ? 'per_line' : 'on_total',
      mode: pick(r, ['half_up', 'half_even', 'half_down', 'up', 'down'] as const),
    },
  };
  if (r() < 0.5)
    input.discount =
      r() < 0.5
        ? { kind: 'percent', percent: pick(r, ['3', '10', '17.5']) }
        : { kind: 'amount', minor: BigInt(randInt(r, 0, 300000)) };
  if (r() < 0.3) input.payments = [BigInt(randInt(r, 0, 400000))];
  return input;
}

describe('closed-form single-tax rule shared with the original proposal and invoice math (property)', () => {
  const divHalfUp = (n: bigint, d: bigint) => (2n * n + d) / (2n * d);
  it('exclusive tax = round(taxable x rate); inclusive tax = taxable - round(taxable / (1 + rate))', () => {
    const r = rng(31337);
    for (let i = 0; i < 5000; i++) {
      const unit = BigInt(randInt(r, 0, 9_999_999));
      const qtyScaled = BigInt(randInt(r, 0, 2_000_000));
      const bp = BigInt(randInt(r, 1, 10000));
      const gross = divHalfUp(qtyScaled * unit, 10000n);
      const pct = (Number(bp) / 100).toFixed(2);
      const excl = calculateDocument({
        currency: 'USD',
        lines: [{ qtyScaled, unitPriceMinor: unit, taxes: [VAT(pct)] }],
      });
      expect(excl.lines[0]!.taxMinor).toBe(divHalfUp(gross * bp, 10000n));
      const incl = calculateDocument({
        currency: 'USD',
        pricesIncludeTax: true,
        lines: [{ qtyScaled, unitPriceMinor: unit, taxes: [VAT(pct)] }],
      });
      expect(incl.lines[0]!.taxMinor).toBe(gross - divHalfUp(gross * 10000n, 10000n + bp));
    }
  });
});

describe('rounding invariants (property-style, 4000 random documents)', () => {
  const r = rng(20261002);
  const docs: Array<{ input: DocumentInput; out: DocumentResult }> = [];
  for (let i = 0; i < 4000; i++) {
    const input = randomDoc(r);
    docs.push({ input, out: calculateDocument(input) });
  }

  it('the line shares of the document discount add back to the discount exactly', () => {
    for (const { out } of docs) {
      const sum = out.lines.reduce((a, l) => a + l.sharedDiscountMinor, 0n);
      if (out.roundingLevel === 'per_line') expect(sum).toBe(out.discountMinor);
      else
        expect(
          (sum - out.discountMinor < 0n ? out.discountMinor - sum : sum - out.discountMinor) <=
            BigInt(out.lines.length),
        ).toBe(true);
    }
  });

  it('per_line: every figure is the exact sum of the line figures', () => {
    for (const { input, out } of docs) {
      if (out.roundingLevel !== 'per_line') continue;
      const sum = (f: (l: (typeof out.lines)[number]) => bigint) =>
        out.lines.reduce((a, l) => a + f(l), 0n);
      expect(sum((l) => l.taxableMinor)).toBe(out.taxableMinor);
      expect(sum((l) => l.taxMinor)).toBe(out.taxMinor);
      expect(sum((l) => l.withholdingMinor)).toBe(out.withholdingMinor);
      expect(sum((l) => l.totalMinor)).toBe(out.totalBeforeRoundingMinor);
      expect(out.taxSummary.reduce((a, s) => a + s.taxMinor, 0n)).toBe(out.taxMinor);
      expect(sum((l) => l.netMinor)).toBe(
        out.subtotalMinor + out.shippingMinor + out.adjustmentMinor,
      );
      void input;
    }
  });

  it('per_line: each line reconciles (net + shares = taxable; taxable + exclusive taxes = total)', () => {
    for (const { out } of docs) {
      if (out.roundingLevel !== 'per_line') continue;
      for (const l of out.lines) {
        expect(l.netMinor - l.sharedDiscountMinor).toBe(l.taxableMinor);
        expect(l.grossMinor - l.discountMinor).toBe(l.netMinor);
        expect(l.totalMinor).toBe(l.taxableMinor + (l.inclusive ? 0n : l.taxMinor));
      }
    }
  });

  it('inclusive lines: tax base + tax = the amount the buyer pays, never a minor unit lost', () => {
    for (const { out } of docs) {
      if (out.roundingLevel !== 'per_line') continue;
      for (const l of out.lines) {
        if (!l.inclusive || l.taxMinor === 0n) continue;
        const pos = l.taxes.filter((t) => t.amountMinor >= 0n && t.category !== 'withholding');
        const base = pos[0]!.baseMinor;
        if (pos.some((t) => t.compound)) continue;
        expect(base + l.taxMinor).toBe(l.taxableMinor);
      }
    }
  });

  it('on_total: line figures stay within one minor unit per line of the document figure', () => {
    for (const { out } of docs) {
      if (out.roundingLevel !== 'on_total') continue;
      const n = BigInt(out.lines.length + 1);
      const lineTax = out.lines.reduce((a, l) => a + l.taxMinor, 0n);
      const diff = lineTax - out.taxMinor;
      expect((diff < 0n ? -diff : diff) <= n).toBe(true);
    }
  });

  it('the document always adds up: total = taxable + added tax + rounding', () => {
    for (const { out } of docs) {
      expect(out.taxableMinor).toBe(
        out.subtotalMinor - out.discountMinor + out.shippingMinor + out.adjustmentMinor,
      );
      expect(out.totalMinor).toBe(out.totalBeforeRoundingMinor + out.roundingMinor);
      expect(out.totalBeforeRoundingMinor).toBe(out.taxableMinor + out.taxAddedMinor);
      expect(out.payableMinor).toBe(out.totalMinor - out.withholdingMinor);
    }
  });

  it('amount due + payments + credits = payable (or the overpayment is reported)', () => {
    for (const { out } of docs) {
      const applied = out.paidMinor + out.creditedMinor;
      expect(out.amountDueMinor - out.overpaidMinor).toBe(out.payableMinor - applied);
      expect(out.amountDueMinor >= 0n && out.overpaidMinor >= 0n).toBe(true);
    }
  });

  it('is exponent-agnostic: the same minor amounts give the same result in every currency', () => {
    const r2 = rng(5);
    for (let i = 0; i < 100; i++) {
      const input = randomDoc(r2);
      const a = calculateDocument({ ...input, currency: 'USD' });
      const b = calculateDocument({ ...input, currency: 'KWD' });
      const c = calculateDocument({ ...input, currency: 'JPY' });
      expect(b.totalMinor).toBe(a.totalMinor);
      expect(c.totalMinor).toBe(a.totalMinor);
      expect(currencyExponent('KWD')).toBe(3);
    }
  });

  it('is deterministic and independent of line order for the totals (per_line, no discount)', () => {
    const r3 = rng(77);
    for (let i = 0; i < 200; i++) {
      const input = randomDoc(r3);
      delete input.discount;
      input.rounding = { level: 'per_line', mode: 'half_up' };
      const a = calculateDocument(input);
      const b = calculateDocument({ ...input, lines: [...input.lines].reverse() });
      expect(b.totalMinor).toBe(a.totalMinor);
      expect(b.taxMinor).toBe(a.taxMinor);
    }
  });
});
