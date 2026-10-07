import { describe, expect, it } from 'vitest';
import {
  orderFacts,
  paidAtOf,
  parseEcomTrigger,
  shopifyExternalOrder,
  taxRate,
  toTrueMinor,
  triggerMet,
  wooExternalOrder,
} from '../../../src/modules/shopify-woocommerce/invoice-order-rules';

const ctx = {
  waOrderId: 5,
  contactId: 9,
  settingsTaxLabel: null,
  deliveryId: 'd1',
  topic: 'orders/paid',
  fallbackCurrency: 'USD',
};

describe('what a delivery says about its order', () => {
  it('Shopify: paid by topic or by financial status; cancelled and refunded never', () => {
    expect(orderFacts('shopify', 'orders/paid', { id: 1 }).paid).toBe(true);
    expect(orderFacts('shopify', 'orders/updated', { id: 1, financial_status: 'paid' }).paid).toBe(
      true,
    );
    expect(
      orderFacts('shopify', 'orders/create', { id: 1, financial_status: 'pending' }).paid,
    ).toBe(false);
    expect(orderFacts('shopify', 'orders/paid', { id: 1, cancelled_at: 'x' })).toMatchObject({
      paid: false,
      cancelled: true,
    });
    expect(
      orderFacts('shopify', 'orders/updated', { id: 1, financial_status: 'refunded' }).cancelled,
    ).toBe(true);
    expect(orderFacts('shopify', 'products/update', { id: 1 }).orderEvent).toBe(false);
    expect(orderFacts('shopify', 'orders/fulfilled', { id: 1 }).fulfilled).toBe(true);
  });

  it('WooCommerce: processing, completed or a paid date; failed and refunded never', () => {
    expect(orderFacts('woocommerce', 'order.updated', { id: 1, status: 'processing' }).paid).toBe(
      true,
    );
    expect(
      orderFacts('woocommerce', 'order.updated', { id: 1, status: 'completed' }),
    ).toMatchObject({
      paid: true,
      fulfilled: true,
    });
    expect(
      orderFacts('woocommerce', 'order.created', {
        id: 1,
        status: 'on-hold',
        date_paid: '2026-01-01T00:00:00',
      }).paid,
    ).toBe(true);
    expect(
      orderFacts('woocommerce', 'order.created', { id: 1, status: 'pending', date_paid: null })
        .paid,
    ).toBe(false);
    expect(
      orderFacts('woocommerce', 'order.updated', { id: 1, status: 'refunded', date_paid: 'x' })
        .paid,
    ).toBe(false);
    expect(orderFacts('woocommerce', 'order.deleted', { id: 1 }).orderEvent).toBe(false);
  });

  it('the trigger decides which delivery counts', () => {
    const pending = orderFacts('shopify', 'orders/create', { id: 1, financial_status: 'pending' });
    const paid = orderFacts('shopify', 'orders/paid', { id: 1 });
    expect(triggerMet('on_paid', pending)).toBe(false);
    expect(triggerMet('on_paid', paid)).toBe(true);
    expect(triggerMet('on_placed', pending)).toBe(true);
    expect(triggerMet('on_fulfilled', paid)).toBe(false);
    expect(parseEcomTrigger('nonsense')).toBe('on_paid');
  });
});

describe('money in the currency true minor units', () => {
  it('reads decimals by the currency exponent, half-up, and never throws', () => {
    expect(toTrueMinor('19.99', 'USD')).toBe(1999n);
    expect(toTrueMinor(19.9, 'USD')).toBe(1990n);
    expect(toTrueMinor('12.345', 'USD')).toBe(1235n);
    expect(toTrueMinor('1500', 'JPY')).toBe(1500n);
    expect(toTrueMinor('1.234', 'KWD')).toBe(1234n);
    expect(toTrueMinor('abc', 'USD')).toBe(0n);
    expect(toTrueMinor(null, 'USD')).toBe(0n);
  });

  it('adds printed rates, else derives the rate from the amount', () => {
    expect(
      taxRate({ taxMinor: 300n, taxableMinor: 3000n, inclusive: false, printedRates: [] }),
    ).toBe('10');
    expect(
      taxRate({ taxMinor: 300n, taxableMinor: 3300n, inclusive: true, printedRates: [] }),
    ).toBe('10');
    expect(
      taxRate({ taxMinor: 300n, taxableMinor: 3000n, inclusive: false, printedRates: [6, 4] }),
    ).toBe('10');
    expect(
      taxRate({ taxMinor: 0n, taxableMinor: 3000n, inclusive: false, printedRates: [] }),
    ).toBeNull();
  });
});

describe('a Shopify body as an order to invoice', () => {
  const body = {
    id: 77,
    name: '#1077',
    currency: 'JPY',
    total_price: '3300',
    total_discounts: '0',
    taxes_included: false,
    email: 'a@b.co',
    customer: { first_name: 'Ada', last_name: 'L', phone: '+81 90 1234 5678' },
    shipping_address: { address1: '1 Main', city: 'Tokyo', country: 'Japan' },
    line_items: [{ title: 'Tea', quantity: 2, price: '1500', sku: 'T' }],
    shipping_lines: [{ price: '0' }],
    tax_lines: [{ title: 'VAT', price: '300', rate: 0.1 }],
  };

  it('keeps the currency exponent, the printed rate and the label; a tax makes it a tax invoice', () => {
    const o = shopifyExternalOrder(body, ctx);
    expect(o).toMatchObject({
      source: 'shopify',
      waOrderId: 5,
      contactId: 9,
      currency: 'JPY',
      docType: 'tax_invoice',
      orderTotalMinor: 3300n,
      tax: { inclusive: false, label: 'VAT', ratePercent: '10' },
      buyer: { name: 'Ada L', phone: '819012345678', email: 'a@b.co' },
    });
    expect(o.lines).toEqual([{ description: 'Tea', sku: 'T', qty: '2', unitPriceMinor: 1500n }]);
    expect(o.meta).toMatchObject({ deliveryId: 'd1', storeOrderId: '77' });
  });

  it('without tax it is a receipt, with the discount clamped to the goods', () => {
    const o = shopifyExternalOrder({ ...body, tax_lines: [], total_discounts: '99999' }, ctx);
    expect(o.docType).toBe('receipt');
    expect(o.tax).toBeNull();
    expect(o.discountMinor).toBe(3000n);
  });

  it('prefers the shopper currency amount when the body carries one', () => {
    const o = shopifyExternalOrder(
      {
        ...body,
        currency: 'USD',
        presentment_currency: 'EUR',
        line_items: [
          {
            title: 'Tea',
            quantity: 1,
            price: '10.00',
            price_set: { presentment_money: { amount: '9.00' } },
          },
        ],
      },
      ctx,
    );
    expect(o.currency).toBe('EUR');
    expect(o.lines[0]!.unitPriceMinor).toBe(900n);
  });
});

describe('a WooCommerce body as an order to invoice', () => {
  it('takes goods before discount, shipping and tax added on top', () => {
    const o = wooExternalOrder(
      {
        id: 12,
        number: '12',
        currency: 'USD',
        total: '23.10',
        total_tax: '2.10',
        shipping_tax: '0.00',
        discount_total: '1.00',
        shipping_total: '2.00',
        billing: { first_name: 'G', last_name: 'H', email: 'g@h.io', phone: '+1 555 020 1111' },
        line_items: [{ name: 'Cup', quantity: 2, subtotal: '20.00', total: '19.00', sku: 'C' }],
        tax_lines: [{ label: 'Sales tax', rate_percent: 10.5 }],
        customer_note: 'leave at door',
      },
      ctx,
    );
    expect(o).toMatchObject({
      source: 'woocommerce',
      docType: 'tax_invoice',
      discountMinor: 100n,
      shippingMinor: 200n,
      notes: 'leave at door',
      tax: { inclusive: false, label: 'Sales tax', ratePercent: '10.5' },
    });
    expect(o.lines[0]).toMatchObject({ qty: '2', unitPriceMinor: 1000n });
  });
});

describe('when the buyer paid', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  it('uses the store stamp when it can be read, else now', () => {
    expect(
      paidAtOf('shopify', { processed_at: '2026-05-01T10:00:00+02:00' }, now).toISOString(),
    ).toBe('2026-05-01T08:00:00.000Z');
    expect(
      paidAtOf('woocommerce', { date_paid_gmt: '2026-05-01T08:00:00' }, now).toISOString(),
    ).toBe('2026-05-01T08:00:00.000Z');
    expect(paidAtOf('woocommerce', { date_paid_gmt: null }, now)).toBe(now);
    expect(paidAtOf('shopify', { processed_at: 'garbage' }, now)).toBe(now);
  });
});
