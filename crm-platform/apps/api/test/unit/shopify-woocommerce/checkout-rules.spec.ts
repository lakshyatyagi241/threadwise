import { describe, expect, it } from 'vitest';
import {
  clampQty,
  isStoreUuid,
  productFor,
  sellableNow,
  storefrontTokenOf,
  wooReference,
} from '../../../src/modules/shopify-woocommerce/checkout-rules';
import type { ShopProductRow } from '../../../src/modules/shopify-woocommerce/shop-products.repository';

const row = (o: Partial<ShopProductRow> = {}): ShopProductRow => ({
  id: 7,
  sku: 'TEE-1',
  metaRetailerId: null,
  storeProductId: '900',
  inStock: true,
  availability: 'in stock',
  status: 'active',
  stockQty: null,
  reservedQty: 0,
  ...o,
});

describe('checkout rules (TW-ECOM-036)', () => {
  it('sells a product that is active, in stock and has stock left after holds', () => {
    expect(sellableNow(row())).toBe(true);
    expect(sellableNow(row({ stockQty: 3, reservedQty: 2 }))).toBe(true);
    expect(sellableNow(row({ stockQty: 2, reservedQty: 2 }))).toBe(false);
    expect(sellableNow(row({ inStock: false }))).toBe(false);
    expect(sellableNow(row({ status: 'draft' }))).toBe(false);
    expect(sellableNow(row({ availability: 'out of stock' }))).toBe(false);
    expect(sellableNow(row({ availability: 'discontinued' }))).toBe(false);
    expect(sellableNow(row({ availability: 'available for order' }))).toBe(true);
  });

  it('finds the product a retailer id names: retailer id, then sku, then wsn-<id>', () => {
    const a = row({ id: 1, sku: 'A', metaRetailerId: 'RID' });
    const b = row({ id: 2, sku: 'RID', metaRetailerId: null });
    const c = row({ id: 3, sku: null });
    expect(productFor('RID', [b, a])).toBe(a);
    expect(productFor('RID', [b])).toBe(b);
    expect(productFor('wsn-3', [a, b, c])).toBe(c);
    expect(productFor('nope', [a, b, c])).toBeUndefined();
  });

  it('tells WooCommerce the sku, else its product id, else the id as given', () => {
    expect(wooReference('wsn-7', row())).toBe('TEE-1');
    expect(wooReference('wsn-7', row({ sku: null }))).toBe('900');
    expect(wooReference('555', undefined)).toBe('555');
  });

  it('reads the Storefront token only from metadata, trimmed', () => {
    expect(storefrontTokenOf({ storefrontAccessToken: ' tok ' })).toBe('tok');
    expect(storefrontTokenOf({ storefrontAccessToken: '  ' })).toBeNull();
    expect(storefrontTokenOf({ storefrontAccessToken: 5 })).toBeNull();
    expect(storefrontTokenOf(null)).toBeNull();
    expect(storefrontTokenOf('x')).toBeNull();
  });

  it('keeps a quantity between 1 and 99', () => {
    expect(clampQty(0)).toBe(1);
    expect(clampQty(-4)).toBe(1);
    expect(clampQty(2.9)).toBe(2);
    expect(clampQty(1000)).toBe(99);
    expect(clampQty(Number.NaN)).toBe(1);
  });

  it('accepts only a uuid as a store id', () => {
    expect(isStoreUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isStoreUuid('12')).toBe(false);
    expect(isStoreUuid("1' OR 1=1")).toBe(false);
  });
});
