import { computeInvoice } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  priceInvoice,
  qtyText,
  sumPercent,
  taxLabel,
  type PricingLine,
  type LineTax,
} from './totals';

const vat = (rate: string, inclusive = false): LineTax => ({
  name: 'VAT',
  inclusive,
  items: [{ code: 'VAT', name: 'VAT', rate }],
});
const gst: LineTax = {
  name: 'GST 18%',
  inclusive: false,
  items: [
    { code: 'CGST', name: 'CGST 9%', rate: '9' },
    { code: 'SGST', name: 'SGST 9%', rate: '9' },
  ],
};
const ln = (over: Partial<PricingLine> = {}): PricingLine => ({
  qty: '1',
  unitPrice: '100',
  discount: null,
  tax: null,
  ...over,
});

/** The figures `computeInvoice` gives, the single pricing function of the API. */
function direct(
  currency: string,
  lines: PricingLine[],
  discount: PricingLine['discount'],
  shipping: string | null,
) {
  const r = computeInvoice({
    currency,
    discount,
    shipping,
    lines: lines.map((l) => ({
      qty: l.qty,
      unitPrice: l.unitPrice,
      discount: l.discount,
      taxRate: l.tax?.items[0]?.rate ?? '0',
      taxInclusive: l.tax?.inclusive ?? false,
      taxName: l.tax?.items[0]?.code ?? null,
    })),
  });
  if (!r.ok) throw new Error('fixture must be valid');
  return r.value.result;
}

describe('priceInvoice matches computeInvoice for single-rate documents', () => {
  const fixtures: Array<{
    name: string;
    currency: string;
    lines: PricingLine[];
    discount: PricingLine['discount'];
    shipping: string | null;
  }> = [
    { name: 'plain', currency: 'USD', lines: [ln()], discount: null, shipping: null },
    {
      name: 'exclusive tax and shipping',
      currency: 'USD',
      lines: [ln({ qty: '3', unitPrice: '19.99', tax: vat('20') })],
      discount: null,
      shipping: '4.99',
    },
    {
      name: 'inclusive tax with a line and a document discount',
      currency: 'EUR',
      lines: [
        ln({
          qty: '2.5',
          unitPrice: '33.33',
          discount: { kind: 'percent', value: '15' },
          tax: vat('21', true),
        }),
        ln({ unitPrice: '10', tax: vat('9') }),
      ],
      discount: { kind: 'amount', value: '7.77' },
      shipping: null,
    },
    {
      name: 'a 3-decimal currency',
      currency: 'KWD',
      lines: [ln({ unitPrice: '12.345', qty: '3', tax: vat('5') })],
      discount: { kind: 'percent', value: '10' },
      shipping: '1.5',
    },
    {
      name: 'a 0-decimal currency',
      currency: 'JPY',
      lines: [ln({ unitPrice: '1999', qty: '4', tax: vat('10') })],
      discount: { kind: 'percent', value: '12.5' },
      shipping: '300',
    },
  ];
  for (const f of fixtures) {
    it(f.name, () => {
      const out = priceInvoice({
        currency: f.currency,
        discount: f.discount,
        shipping: f.shipping,
        lines: f.lines,
      });
      expect(out.ok).toBe(true);
      const r = direct(f.currency, f.lines, f.discount, f.shipping);
      const t = out.totals;
      expect(t.subtotalMinor).toBe(Number(r.subtotalMinor));
      expect(t.discountMinor).toBe(Number(r.discountMinor));
      expect(t.taxMinor).toBe(Number(r.taxMinor));
      expect(t.taxAddedMinor).toBe(Number(r.taxAddedMinor));
      expect(t.shippingMinor).toBe(Number(r.shippingMinor));
      expect(t.totalMinor).toBe(Number(r.totalMinor));
      // total = subtotal - discount + tax added + shipping
      expect(t.totalMinor).toBe(
        t.subtotalMinor - t.discountMinor + t.taxAddedMinor + t.shippingMinor,
      );
      expect(t.includedTaxMinor).toBe(t.taxMinor - t.taxAddedMinor);
      expect(t.lines).toHaveLength(f.lines.length);
    });
  }
});

describe('priceInvoice with several taxes on a line', () => {
  it("CGST + SGST: one summary row per part, the total is the engine's", () => {
    const out = priceInvoice({
      currency: 'INR',
      discount: null,
      shipping: null,
      lines: [ln({ unitPrice: '1000', tax: gst })],
    });
    expect(out.ok).toBe(true);
    expect(out.totals.taxRows.map((r) => [r.name, r.ratePercent, r.baseMinor, r.taxMinor])).toEqual(
      [
        ['CGST 9%', '9', 100000, 9000],
        ['SGST 9%', '9', 100000, 9000],
      ],
    );
    expect(out.totals.totalMinor).toBe(118000);
  });
  it('a rate finer than two decimals (9.975%) is held exactly', () => {
    const qst: LineTax = {
      name: 'QST',
      inclusive: false,
      items: [{ code: 'QST', name: 'QST 9.975%', rate: '9.975' }],
    };
    const out = priceInvoice({
      currency: 'CAD',
      discount: null,
      shipping: null,
      lines: [ln({ unitPrice: '100', tax: qst })],
    });
    expect(out.ok).toBe(true);
    expect(out.totals.taxMinor).toBe(998);
  });
  it('the document discount and shipping work the same way', () => {
    const out = priceInvoice({
      currency: 'INR',
      discount: { kind: 'percent', value: '10' },
      shipping: '50',
      lines: [ln({ unitPrice: '1000', tax: gst })],
    });
    expect(out.ok).toBe(true);
    // 1000 - 100 = 900; tax 18% = 162; shipping 50 untaxed
    expect(out.totals.totalMinor).toBe(90000 + 16200 + 5000);
    expect(out.totals.shippingMinor).toBe(5000);
  });
});

describe('priceInvoice rules', () => {
  it('reverse charge charges no tax', () => {
    const out = priceInvoice({
      currency: 'EUR',
      discount: null,
      shipping: null,
      reverseCharge: true,
      lines: [ln({ tax: vat('21') }), ln({ tax: gst })],
    });
    expect(out.ok).toBe(true);
    expect(out.totals.taxMinor).toBe(0);
    expect(out.totals.totalMinor).toBe(20000);
    expect(out.totals.taxRows).toEqual([]);
  });
  it('reports every problem by path, with zero figures', () => {
    const out = priceInvoice({
      currency: 'USD',
      discount: { kind: 'percent', value: '101' },
      shipping: '1.234',
      lines: [ln({ qty: '0' }), ln({ unitPrice: '1.999' })],
    });
    expect(out.ok).toBe(false);
    expect(out.issues.map((i) => i.path).sort()).toEqual([
      'discount',
      'lines.0.qty',
      'lines.1.unitPrice',
      'shipping',
    ]);
    expect(out.totals.totalMinor).toBe(0);
  });
  it('an invoice needs a line', () => {
    const out = priceInvoice({ currency: 'USD', discount: null, shipping: null, lines: [] });
    expect(out.issues[0]?.path).toBe('lines');
  });
});

describe('labels', () => {
  it('prints a tax once with its percent', () => {
    expect(taxLabel('GST', '18')).toBe('GST 18%');
    expect(taxLabel('GST 18%', '18')).toBe('GST 18%');
    expect(taxLabel('CGST 9%', '9')).toBe('CGST 9%');
    expect(taxLabel(null, '5')).toBe('5%');
  });
  it('sums the parts exactly', () => {
    expect(sumPercent(gst.items)).toBe('18');
    expect(
      sumPercent([
        { code: 'a', name: 'a', rate: '5' },
        { code: 'b', name: 'b', rate: '9.975' },
      ]),
    ).toBe('14.975');
  });
  it('formats a quantity', () => {
    expect(qtyText('2.5000', 'en')).toBe('2.5');
    expect(qtyText('3', 'en')).toBe('3');
  });
});
