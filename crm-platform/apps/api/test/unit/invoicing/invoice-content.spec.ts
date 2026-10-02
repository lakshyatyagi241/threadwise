import { describe, expect, it } from 'vitest';
import { priceInvoice, simpleTax, totalPercent, trimPercent, type LineSpec, type TaxSpec } from '../../../src/modules/crm/invoicing/invoice-content';

const gst: TaxSpec = {
  rateId: 1,
  name: 'GST 18% (CGST + SGST)',
  type: 'gst',
  inclusive: false,
  items: [
    { code: 'CGST', name: 'CGST 9%', ratePercent: '9' },
    { code: 'SGST', name: 'SGST 9%', ratePercent: '9' },
  ],
};

const spec = (over: Partial<LineSpec> = {}): LineSpec => ({
  description: 'Item',
  sku: null,
  hsnSac: null,
  qty: '1',
  unitPrice: '100.00',
  discount: null,
  tax: null,
  ...over,
});

describe('priceInvoice (the one place an invoice is priced, through @crm/tax)', () => {
  it('a compound rate charges each component on the taxable amount and rounds each (CGST and SGST are separate taxes), keeping the parts', () => {
    const r = priceInvoice({ currency: 'INR', specs: [spec({ unitPrice: '1000.03', tax: gst })], discount: null, shipping: null, reverseCharge: false });
    const l = r.lines[0]!;
    // 9% of 1000.03 = 90.0027 -> 90.00 each
    expect(l.taxMinor).toBe(18_000n);
    expect(l.taxName).toBe('GST 18% (CGST + SGST)');
    expect(l.taxType).toBe('gst');
    expect(l.taxRatePercent).toBe('18');
    const parts = l.taxComponents as Array<{ type: string; ratePercent: string; amountMinor: string }>;
    expect(parts.map((c) => c.type)).toEqual(['CGST', 'SGST']);
    expect(parts.map((c) => c.amountMinor)).toEqual(['9000', '9000']);
    expect(r.summary.map((g) => [g.name, g.ratePercent, g.taxMinor])).toEqual([
      ['CGST 9%', '9', 9000n],
      ['SGST 9%', '9', 9000n],
    ]);
  });

  it('rates the old basis-point column could not hold: Quebec QST 9.975% is exact', () => {
    const qst = simpleTax(null, 'QST', 'qst', '9.975', false);
    const r = priceInvoice({ currency: 'CAD', specs: [spec({ unitPrice: '200.00', tax: qst })], discount: null, shipping: null, reverseCharge: false });
    expect(r.lines[0]!.taxMinor).toBe(1995n); // 19.95
    expect(r.lines[0]!.taxRatePercent).toBe('9.975');
    expect(r.summary[0]!.ratePercent).toBe('9.975');
  });

  it('GST + QST on one line add up as separate taxes (5% + 9.975%)', () => {
    const both: TaxSpec = {
      rateId: null,
      name: 'GST + QST',
      type: 'gst',
      inclusive: false,
      items: [
        { code: 'GST', name: 'GST 5%', ratePercent: '5' },
        { code: 'QST', name: 'QST 9.975%', ratePercent: '9.975' },
      ],
    };
    const r = priceInvoice({ currency: 'CAD', specs: [spec({ unitPrice: '100.00', tax: both })], discount: null, shipping: null, reverseCharge: false });
    expect(r.lines[0]!.taxMinor).toBe(500n + 998n); // 9.975 -> 9.98 half up
    expect(r.lines[0]!.taxRatePercent).toBe('14.975');
    expect(r.totals.totalMinor).toBe(10_000n + 500n + 998n);
  });

  it('the tax summary groups lines by tax and rate and its parts add up to the document tax', () => {
    const vat5 = simpleTax(2, 'VAT 5%', 'vat', '5', false);
    const r = priceInvoice({
      currency: 'USD',
      specs: [spec({ tax: gst }), spec({ tax: gst, unitPrice: '55.55' }), spec({ tax: vat5 }), spec()],
      discount: null,
      shipping: null,
      reverseCharge: false,
    });
    expect(r.summary).toHaveLength(3);
    expect(r.summary.reduce((a, g) => a + g.taxMinor, 0n)).toBe(r.totals.taxMinor);
  });

  it('inclusive tax is inside the price and not added; the summary base excludes it', () => {
    const incl = simpleTax(null, 'VAT 20%', 'vat', '20', true);
    const r = priceInvoice({ currency: 'EUR', specs: [spec({ unitPrice: '120.00', tax: incl })], discount: null, shipping: null, reverseCharge: false });
    expect(r.totals.totalMinor).toBe(12_000n);
    expect(r.totals.taxMinor).toBe(2000n);
    expect(r.totals.taxAddedMinor).toBe(0n);
    expect(r.totals.taxInclusive).toBe(true);
    expect(r.summary[0]).toMatchObject({ baseMinor: 10_000n, taxMinor: 2000n, inclusive: true });
  });

  it('reverse charge: no tax is charged, and the lines carry none', () => {
    const r = priceInvoice({ currency: 'EUR', specs: [spec({ tax: gst })], discount: null, shipping: null, reverseCharge: true });
    expect(r.totals.taxMinor).toBe(0n);
    expect(r.lines[0]!.taxRatePercent).toBe('0');
    expect(r.lines[0]!.taxName).toBeNull();
    expect(r.summary).toEqual([]);
    expect(r.totals.totalMinor).toBe(10_000n);
  });

  it('a zero-rated line carries no tax and shows in the summary as a 0% row (zero-rated supplies are printed; WaDesk dropped them)', () => {
    const r = priceInvoice({ currency: 'USD', specs: [spec({ tax: simpleTax(null, 'Zero', 'vat', '0', false) })], discount: null, shipping: null, reverseCharge: false });
    expect(r.totals.taxMinor).toBe(0n);
    expect(r.summary).toHaveLength(1);
    expect(r.summary[0]).toMatchObject({ ratePercent: '0', taxMinor: 0n, baseMinor: 10_000n });
  });

  it('the document discount reduces the amount tax is charged on, shipping is never discounted or taxed', () => {
    const r = priceInvoice({
      currency: 'USD',
      specs: [spec({ unitPrice: '100.00', tax: simpleTax(null, 'T10', 'sales_tax', '10', false) })],
      discount: { kind: 'percent', value: '50' },
      shipping: '10.00',
      reverseCharge: false,
    });
    expect(r.totals).toMatchObject({ subtotalMinor: 10_000n, discountMinor: 5000n, taxMinor: 500n, shippingMinor: 1000n, totalMinor: 6500n, discountKind: 'percent', discountValue: 5000n });
  });

  it('refuses an amount the currency cannot hold with INV_AMOUNT_INVALID and the path of the field', () => {
    try {
      priceInvoice({ currency: 'JPY', specs: [spec({ unitPrice: '10.5' })], discount: null, shipping: null, reverseCharge: false });
      expect.unreachable();
    } catch (err) {
      const e = err as { code: string; details: Array<{ path: string }> };
      expect(e.code).toBe('INV_AMOUNT_INVALID');
      expect(e.details[0]!.path).toBe('lines.0.unitPrice');
    }
  });

  it('refuses no lines, a zero quantity and a percent discount above 100', () => {
    const run = (o: Partial<Parameters<typeof priceInvoice>[0]>) =>
      priceInvoice({ currency: 'USD', specs: [spec()], discount: null, shipping: null, reverseCharge: false, ...o });
    expect(() => run({ specs: [] })).toThrow();
    expect(() => run({ specs: [spec({ qty: '0' })] })).toThrow();
    expect(() => run({ discount: { kind: 'percent', value: '101' } })).toThrow();
  });

  it('keeps the line order as positions, and the discount kind and value as entered', () => {
    const r = priceInvoice({
      currency: 'USD',
      specs: [spec({ description: 'a', discount: { kind: 'percent', value: '12.5' } }), spec({ description: 'b', discount: { kind: 'amount', value: '3.00' } })],
      discount: null,
      shipping: null,
      reverseCharge: false,
    });
    expect(r.lines.map((l) => l.position)).toEqual([0, 1]);
    expect(r.lines[0]).toMatchObject({ discountKind: 'percent', discountValue: 1250n });
    expect(r.lines[1]).toMatchObject({ discountKind: 'amount', discountValue: 300n });
  });

  it('percent helpers: trailing zeros of a fraction go, whole numbers keep theirs; additive rates sum exactly', () => {
    expect(trimPercent('9.0000')).toBe('9');
    expect(trimPercent('9.9750')).toBe('9.975');
    expect(trimPercent('10')).toBe('10');
    expect(trimPercent('100')).toBe('100');
    expect(totalPercent([{ code: 'a', name: 'a', ratePercent: '5' }, { code: 'b', name: 'b', ratePercent: '9.975' }])).toBe('14.975');
  });
});
