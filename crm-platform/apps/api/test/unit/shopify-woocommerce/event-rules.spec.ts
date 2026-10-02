import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyVarMap,
  bodyParams,
  renderBody,
  shopifyContext,
  shopifyRecipient,
  verifyShopifyWebhook,
  verifyWooWebhook,
  wooContext,
  wooRecipient,
  wooTracking,
} from '../../../src/modules/shopify-woocommerce/event-rules';

const store = { storeName: 'Acme', storeUrl: 'https://acme.test/', currency: 'USD' };
const sign = (body: Buffer, secret: string): string =>
  createHmac('sha256', secret).update(body).digest('base64');

describe('a store webhook signature (TW-ECOM-008, 027)', () => {
  const body = Buffer.from('{"id":1}');

  it('accepts the base64 HMAC of the raw body and nothing else', () => {
    expect(verifyShopifyWebhook(body, sign(body, 's3'), 's3')).toBe(true);
    expect(verifyWooWebhook(body, sign(body, 's3'), 's3')).toBe(true);
    expect(verifyShopifyWebhook(body, sign(body, 's3'), 'other')).toBe(false);
    expect(verifyShopifyWebhook(Buffer.from('{"id":2}'), sign(body, 's3'), 's3')).toBe(false);
  });

  it('refuses an empty header, an empty secret and a header of another length', () => {
    expect(verifyShopifyWebhook(body, '', 's3')).toBe(false);
    expect(verifyWooWebhook(body, sign(body, ''), '')).toBe(false);
    expect(verifyWooWebhook(body, 'abc', 's3')).toBe(false);
  });
});

describe('who an order message goes to', () => {
  it('Shopify: the first filled phone of customer, order, shipping, billing', () => {
    expect(
      shopifyRecipient({
        customer: { phone: '' },
        phone: '+1 555',
        shipping_address: { phone: '9' },
      }),
    ).toBe('+1 555');
    expect(shopifyRecipient({ billing_address: { phone: '7' } })).toBe('7');
    expect(shopifyRecipient({})).toBeNull();
  });
  it('WooCommerce: billing phone made international from its country', () => {
    expect(wooRecipient({ billing: { phone: '08012345678', country: 'NG' } })).toBe(
      '2348012345678',
    );
  });
});

describe('the variables of an event', () => {
  it('Shopify: name, order, total, tracking from the first fulfillment', () => {
    const c = shopifyContext(store, {
      name: '#1001',
      order_number: 1001,
      total_price: '25.00',
      currency: 'EUR',
      customer: { first_name: 'Ada', last_name: 'L', email: 'a@x.test' },
      fulfillments: [
        { tracking_number: 'T1', tracking_company: 'DHL', tracking_url: 'https://t/1' },
      ],
    });
    expect(c.positional).toEqual(['Ada L', '#1001', '25.00 EUR']);
    expect(c.vars).toMatchObject({
      tracking_number: 'T1',
      tracking_url: 'https://t/1',
      store_name: 'Acme',
    });
  });
  it('Shopify: falls back to there / store currency when the order is bare', () => {
    expect(shopifyContext(store, { id: 5 }).positional).toEqual(['there', '#5', '']);
  });
  it('WooCommerce: pay link needs the order key; invoice falls back to the order page', () => {
    const c = wooContext(store, {
      id: 9,
      number: '9',
      total: '10',
      status: 'on-hold',
      order_key: 'wc_order_k',
      billing: { first_name: 'Bo', last_name: '', email: 'b@x.test' },
    });
    expect(c.vars.order_pay_url).toBe(
      'https://acme.test/checkout/order-pay/9/?pay_for_order=true&key=wc_order_k',
    );
    expect(c.vars.invoice_url).toBe('https://acme.test/my-account/view-order/9/');
    expect(c.vars.invoice_is_pdf).toBe('0');
    expect(c.positional).toEqual(['Bo', '#9', '10 USD']);
  });
  it('WooCommerce: reads shipment tracking meta', () => {
    expect(
      wooTracking({
        meta_data: [
          {
            key: '_wc_shipment_tracking_items',
            value: [{ tracking_number: 'Z', tracking_provider: 'UPS' }],
          },
        ],
      }),
    ).toEqual({ number: 'Z', url: '', company: 'UPS' });
  });
});

describe('filling a template', () => {
  const ctx = shopifyContext(store, {
    name: '#7',
    total_price: '1',
    customer: { first_name: 'Ada' },
  });
  it('a chosen field list replaces the default positions; a missing field is empty', () => {
    expect(applyVarMap(ctx, ['order_name', 'nope']).positional).toEqual(['#7', '']);
    expect(applyVarMap(ctx, null)).toBe(ctx);
    expect(applyVarMap(ctx, [])).toBe(ctx);
  });
  it('renders named (any case) and numbered tokens and strips unknown ones', () => {
    expect(renderBody('Hi {{Name}} {{1}} {{2}} {{ x }}!', ctx)).toBe('Hi Ada Ada #7 !');
  });
  it('declares as many parameters as the highest number in the body', () => {
    expect(bodyParams('{{1}} and {{3}}', ['a', 'b'])).toEqual(['a', 'b', '']);
    expect(bodyParams('{{name}} only', ['a'])).toEqual([]);
  });
});
