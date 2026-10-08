import { describe, expect, it } from 'vitest';
import { storeFlowEvents } from '../../../src/modules/shopify-woocommerce/flow-events';

describe('store deliveries as flow events', () => {
  it('Shopify: a checkout, an order with products, a fulfilment, a cancellation', () => {
    const order = {
      id: 77,
      name: '#1001',
      total_price: '49.00',
      currency: 'INR',
      phone: '+919800000001',
      customer: { first_name: 'Asha' },
      line_items: [{ product_id: 5 }, { product_id: 6 }],
    };
    expect(
      storeFlowEvents('shopify', 'checkouts/create', {
        ...order,
        abandoned_checkout_url: 'https://pay',
      }),
    ).toEqual([
      expect.objectContaining({
        event: 'checkout_started',
        ref: '77',
        phone: '+919800000001',
        variables: expect.objectContaining({ checkout_url: 'https://pay', order_number: '#1001' }),
      }),
    ]);
    expect(storeFlowEvents('shopify', 'orders/create', order)[0]).toMatchObject({
      event: 'ordered_product',
      productIds: ['5', '6'],
    });
    expect(storeFlowEvents('shopify', 'orders/create', { ...order, line_items: [] })).toEqual([]);
    expect(storeFlowEvents('shopify', 'orders/fulfilled', order)[0]!.event).toBe('order_fulfilled');
    expect(storeFlowEvents('shopify', 'orders/cancelled', order)[0]!.event).toBe('order_cancelled');
    expect(storeFlowEvents('shopify', 'orders/updated', order)).toEqual([]);
  });

  it('Shopify: a refund has no number of its own, only its order', () => {
    expect(storeFlowEvents('shopify', 'refunds/create', { id: 9, order_id: 77 })).toEqual([
      expect.objectContaining({
        event: 'order_refunded',
        ref: 'refund:9',
        phone: null,
        orderId: '77',
      }),
    ]);
    expect(storeFlowEvents('shopify', 'refunds/create', {})).toEqual([]);
  });

  it('WooCommerce: product orders on create, the status on create or update, a checkout', () => {
    const order = {
      id: 12,
      number: '12',
      total: '10.00',
      currency: 'INR',
      billing: { phone: '+919800000002', first_name: 'Ravi', country: 'IN' },
      line_items: [{ product_id: 3 }],
      status: 'processing',
    };
    expect(storeFlowEvents('woocommerce', 'order.created', order).map((e) => e.event)).toEqual([
      'ordered_product',
    ]);
    expect(
      storeFlowEvents('woocommerce', 'order.updated', { ...order, status: 'completed' }).map(
        (e) => e.event,
      ),
    ).toEqual(['order_fulfilled']);
    expect(
      storeFlowEvents('woocommerce', 'order.updated', { ...order, status: 'cancelled' }).map(
        (e) => e.event,
      ),
    ).toEqual(['order_cancelled']);
    expect(
      storeFlowEvents('woocommerce', 'order.updated', { ...order, status: 'refunded' }).map(
        (e) => e.event,
      ),
    ).toEqual(['order_refunded']);
    expect(storeFlowEvents('woocommerce', 'order.updated', order)).toEqual([]);
    expect(storeFlowEvents('woocommerce', 'checkout.created', order)[0]).toMatchObject({
      event: 'checkout_started',
      ref: '12',
    });
  });

  it('a delivery with no id names no occurrence', () => {
    expect(storeFlowEvents('woocommerce', 'order.updated', { status: 'completed' })).toEqual([]);
  });
});
