import { describe, expect, it } from 'vitest';
import {
  allocateDiscount,
  lineGrossMinor,
  specsOfExternalOrder,
} from '../../../src/modules/crm/invoicing/external-order-billing.service';
import {
  itemFacts,
  parseTrigger,
  taxRatePercent,
  toExternalOrder,
  toTrueMinor,
  triggerMet,
  type StoreOrderRow,
} from '../../../src/modules/store-orders-sales/store-order.rules';

const order = (over: Partial<StoreOrderRow> = {}): StoreOrderRow => ({
  id: 12,
  uuid: '11111111-1111-4111-8111-111111111111',
  source: 'storefront',
  status: 'new',
  customerPhone: '+919876543210',
  customerName: 'Asha',
  customerEmail: 'asha@example.com',
  customerAddress: '12 Main St',
  itemsJson: [
    { product_id: 1, name: 'Tea', qty: 2, price_minor: 25000, retailer_id: 'TEA-1' },
    { product_id: 2, name: 'Mug', qty: 1, price_minor: 15000, retailer_id: null },
  ],
  totalMinor: 65000,
  shippingMinor: 0,
  taxMinor: 0,
  taxInclusive: false,
  taxLinesJson: null,
  discountMinor: 0,
  couponCode: null,
  paymentMethod: 'prepaid',
  currencyCode: 'INR',
  notes: null,
  metaJson: null,
  waPaymentTxnId: null,
  contactId: null,
  salesOrderId: null,
  invoiceId: null,
  createdAt: new Date('2026-10-05T10:00:00Z'),
  ...over,
});

const ctx = { settingsTaxLabel: null, contactId: 7 };

describe('store order -> invoice draft (Reference OwnStoreInvoiceMapper)', () => {
  it('is a RECEIPT when no tax was captured', () => {
    const d = toExternalOrder(order(), [], ctx);
    expect(d.docType).toBe('receipt');
    expect(d.tax).toBeNull();
    expect(d.reference).toBe('Store order #12');
    expect(d.contactId).toBe(7);
    expect(d.lines).toEqual([
      { description: 'Tea', sku: 'TEA-1', qty: '2', unitPriceMinor: 25000n },
      { description: 'Mug', sku: '2', qty: '1', unitPriceMinor: 15000n },
    ]);
    expect(d.orderTotalMinor).toBe(65000n);
  });

  it('is a TAX INVOICE only when a real tax amount was captured, with the rate derived from it', () => {
    const d = toExternalOrder(order({ taxMinor: 9000, totalMinor: 74000 }), [], {
      settingsTaxLabel: 'GST',
      contactId: null,
    });
    expect(d.docType).toBe('tax_invoice');
    // 9000 on 65000 goods = 13.8462 %
    expect(d.tax).toEqual({ inclusive: false, label: 'GST', ratePercent: '13.8462' });
  });

  it('takes the rate and label from the order own tax line when it has one', () => {
    const d = toExternalOrder(
      order({ taxMinor: 11700, totalMinor: 76700, taxLinesJson: [{ label: 'VAT', rate: 18 }] }),
      [],
      ctx,
    );
    expect(d.tax).toEqual({ inclusive: false, label: 'VAT', ratePercent: '18' });
  });

  it('derives an inclusive rate from the goods net of the tax', () => {
    // 118.00 gross, 18.00 tax inclusive -> 18 / 100 = 18 %
    expect(
      taxRatePercent({
        taxMinor: 1800n,
        taxableMinor: 11800n,
        inclusive: true,
        taxLinesJson: null,
      }),
    ).toBe('18');
    // nothing taxable left: no rate, so no tax invoice
    expect(
      taxRatePercent({ taxMinor: 100n, taxableMinor: 0n, inclusive: false, taxLinesJson: null }),
    ).toBeNull();
  });

  it('carries discount and shipping, clamping a discount larger than the goods', () => {
    const d = toExternalOrder(
      order({ discountMinor: 5000, shippingMinor: 4000, totalMinor: 64000 }),
      [],
      ctx,
    );
    expect(d.discountMinor).toBe(5000n);
    expect(d.shippingMinor).toBe(4000n);
    const over = toExternalOrder(order({ discountMinor: 999999 }), [], ctx);
    expect(over.discountMinor).toBe(65000n);
  });

  it('reads the WhatsApp cart shape (quantity) and falls back to wa_order_items, then to one "Order total" line', () => {
    expect(itemFacts([{ name: 'A', quantity: 3, price_minor: 100 }], [])[0]!.qty).toBe('3');
    const fromRows = itemFacts(null, [
      { name: 'Row', retailerId: 'R', quantity: 2, priceMinor: 500 },
    ]);
    expect(fromRows).toEqual([{ name: 'Row', sku: 'R', qty: '2', priceMinor: 500 }]);
    const bare = toExternalOrder(
      order({ itemsJson: [], shippingMinor: 1000, discountMinor: 2000, totalMinor: 9000 }),
      [],
      ctx,
    );
    // goods = total - shipping + discount
    expect(bare.lines).toEqual([
      { description: 'Order #12', sku: null, qty: '1', unitPriceMinor: 10000n },
    ]);
  });

  it('re-scales a zero- or three-decimal currency from the app x100 convention to true minor units', () => {
    expect(toTrueMinor(15000, 'JPY')).toBe(150n);
    expect(toTrueMinor(12345, 'INR')).toBe(12345n);
    expect(toTrueMinor(1250, 'KWD')).toBe(12500n);
  });
});

describe('invoice trigger (trigger_own)', () => {
  it('defaults to on_paid and ignores an unknown value', () => {
    expect(parseTrigger(undefined)).toBe('on_paid');
    expect(parseTrigger('whatever')).toBe('on_paid');
    expect(parseTrigger('on_fulfilled')).toBe('on_fulfilled');
    expect(parseTrigger('manual')).toBe('manual');
  });

  it('fires at the chosen state and never for a cancelled order', () => {
    expect(triggerMet('on_paid', 'new')).toBe(false);
    expect(triggerMet('on_paid', 'paid')).toBe(true);
    expect(triggerMet('on_paid', 'completed')).toBe(true);
    expect(triggerMet('on_placed', 'new')).toBe(true);
    expect(triggerMet('on_placed', 'cancelled')).toBe(false);
    expect(triggerMet('on_fulfilled', 'paid')).toBe(false);
    expect(triggerMet('on_fulfilled', 'shipped')).toBe(true);
    expect(triggerMet('manual', 'paid')).toBe(false);
  });
});

describe('discount spread and the lines the sales order is made from', () => {
  it('splits a document discount over the lines to the minor unit, the last line taking the remainder', () => {
    const shares = allocateDiscount([5000n, 3000n, 2000n], 1000n);
    expect(shares).toEqual([500n, 300n, 200n]);
    const odd = allocateDiscount([3333n, 3333n, 3334n], 100n);
    expect(odd.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(allocateDiscount([100n], 500n)).toEqual([100n]);
    expect(allocateDiscount([100n, 200n], 0n)).toEqual([0n, 0n]);
    expect(allocateDiscount([0n, 0n], 50n)).toEqual([0n, 0n]);
  });

  it('prices a line as unit x quantity, half up', () => {
    expect(lineGrossMinor({ description: 'x', sku: null, qty: '2', unitPriceMinor: 25000n })).toBe(
      50000n,
    );
    expect(lineGrossMinor({ description: 'x', sku: null, qty: '1.5', unitPriceMinor: 333n })).toBe(
      500n,
    );
  });

  it('turns the draft into engine specs: major-unit prices, discount folded into the lines, one tax on every line', () => {
    const d = toExternalOrder(
      order({ discountMinor: 6500, taxMinor: 5850, totalMinor: 64350 }),
      [],
      { settingsTaxLabel: 'Tax', contactId: null },
    );
    const specs = specsOfExternalOrder(d);
    expect(specs.map((s) => s.unitPrice)).toEqual(['250.00', '150.00']);
    // 6500 over 50000 + 15000: 5000 and 1500
    expect(specs.map((s) => s.discount)).toEqual([
      { kind: 'amount', value: '50.00' },
      { kind: 'amount', value: '15.00' },
    ]);
    expect(specs.every((s) => s.tax?.items[0]?.ratePercent === '10')).toBe(true);
  });
});
