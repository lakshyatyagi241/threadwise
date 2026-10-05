import { describe, expect, it } from 'vitest';
import {
  MAIN_ENTRIES,
  SETTINGS_ENTRIES,
  activeKey,
  countFor,
  entryHref,
  visibleEntries,
} from './sidebar';

const find = (key: string) => [...MAIN_ENTRIES, ...SETTINGS_ENTRIES].find((e) => e.key === key)!;

describe('sidebar entries', () => {
  it('keeps Reference order', () => {
    expect(MAIN_ENTRIES.map((e) => e.key)).toEqual([
      'overview',
      'orders',
      'products',
      'groups',
      'storefront',
      'coupons',
      'reviews',
      'payments',
      'gateways',
      'customers',
      'invoices',
    ]);
  });
  it('links every store page now that the merchant screens exist', () => {
    for (const e of MAIN_ENTRIES) expect(e.state, e.key).toBe('link');
  });
  it('gates each merchant page by its own permission', () => {
    expect(find('orders').permission).toBe('store.orders.read');
    expect(find('coupons').permission).toBe('store.coupons.read');
    expect(find('customers').permission).toBe('store.customers.read');
    expect(find('groups').permission).toBe('store.groups.read');
    expect(find('gateways').permission).toBe('store.gateways.read');
    expect(find('payments').permission).toBe('store.payments.view');
    const only = (keep: string) => (p: string) => p === keep;
    expect(visibleEntries(MAIN_ENTRIES, only('store.orders.read')).map((e) => e.key)).toEqual([
      'overview',
      'orders',
      'products',
      'reviews',
    ]);
  });
  it('hides the storefront entry without the read permission', () => {
    expect(visibleEntries(MAIN_ENTRIES, () => false).some((e) => e.key === 'storefront')).toBe(
      false,
    );
    expect(visibleEntries(MAIN_ENTRIES, () => true)).toHaveLength(MAIN_ENTRIES.length);
  });
  it('carries the selected shop on the overview, storefront and merchant links', () => {
    expect(entryHref(find('overview'), 'abc')).toBe('/store?shop=abc');
    expect(entryHref(find('storefront'), 'abc')).toBe('/store/storefront?shop=abc');
    expect(entryHref(find('orders'), 'abc')).toBe('/store/orders?shop=abc');
    expect(entryHref(find('gateways'), 'abc')).toBe('/store/gateways?shop=abc');
    expect(entryHref(find('products'), 'abc')).toBe('/store/products');
    expect(entryHref(find('overview'), null)).toBe('/store');
  });
});

describe('activeKey', () => {
  it('uses the second URL segment, defaulting to the overview', () => {
    expect(activeKey('/store')).toBe('overview');
    expect(activeKey('/store/storefront')).toBe('storefront');
    expect(activeKey('/store/products/create')).toBe('products');
    expect(activeKey('/store/orders/9f1c')).toBe('orders');
    expect(activeKey('/store/gateways')).toBe('gateways');
    expect(activeKey('/store/unknown')).toBe('overview');
    expect(activeKey('/connect')).toBe('connection');
  });
});

describe('countFor', () => {
  const counts = {
    orders: 14,
    products: 8,
    groups: 2,
    coupons: 3,
    reviewsPending: 1,
    payments: 1,
    gateways: 0,
    customers: 5,
  };
  it('maps every counted entry to its number and leaves the others bare', () => {
    expect(countFor('orders', counts)).toBe(14);
    expect(countFor('products', counts)).toBe(8);
    expect(countFor('reviews', counts)).toBe(1);
    expect(countFor('gateways', counts)).toBe(0);
    expect(countFor('customers', counts)).toBe(5);
    expect(countFor('overview', counts)).toBeUndefined();
    expect(countFor('storefront', counts)).toBeUndefined();
    expect(countFor('invoices', counts)).toBeUndefined();
    expect(countFor('connection', counts)).toBeUndefined();
  });
});
