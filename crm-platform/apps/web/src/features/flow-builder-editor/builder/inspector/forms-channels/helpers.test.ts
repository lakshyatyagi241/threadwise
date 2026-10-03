import { describe, expect, it } from 'vitest';
import {
  MAX_PRODUCT_ITEMS,
  extractGoogleId,
  formatPrice,
  mergePicked,
  readProductItems,
  toProductItem,
  withSavedOption,
  type ProductItem,
} from './helpers';

const item = (id: string): ProductItem => ({ retailer_id: id, name: id, image: null, price_minor: null, currency: null });

describe('product items', () => {
  it('maps a catalog product to the Reference shape', () => {
    expect(toProductItem({ retailerId: 'sku1', name: 'Mug', image: 'u', priceMinor: 1250, currency: 'USD' })).toEqual({
      retailer_id: 'sku1',
      name: 'Mug',
      image: 'u',
      price_minor: 1250,
      currency: 'USD',
    });
  });
  it('merges without duplicates and caps at 30', () => {
    expect(mergePicked([item('a')], [item('a'), item('b')]).map((p) => p.retailer_id)).toEqual(['a', 'b']);
    const many = Array.from({ length: 40 }, (_, i) => item(`p${i}`));
    expect(mergePicked([], many)).toHaveLength(MAX_PRODUCT_ITEMS);
  });
  it('reads garbage safely', () => {
    expect(readProductItems(null)).toEqual([]);
    expect(readProductItems([1, { retailer_id: 5, name: 'x' }])).toEqual([
      { retailer_id: '5', name: 'x', image: null, price_minor: null, currency: null },
    ]);
  });
  it('formats prices', () => {
    expect(formatPrice('USD', 999)).toBe('USD 9.99');
    expect(formatPrice(null, null)).toBe('—');
  });
});

describe('google ids', () => {
  it('extracts the id from a url and keeps a bare id', () => {
    expect(extractGoogleId(' https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUv/edit#gid=0 ')).toBe(
      '1AbCdEfGhIjKlMnOpQrStUv',
    );
    expect(extractGoogleId('short')).toBe('short');
  });
});

describe('withSavedOption', () => {
  const base = [
    { v: '', l: 'pick' },
    { v: 'a', l: 'A' },
  ];
  it('adds a missing saved id', () => {
    expect(withSavedOption(base, 'z', (id) => `#${id}`)).toEqual([...base, { v: 'z', l: '#z' }]);
  });
  it('leaves a known or empty value alone', () => {
    expect(withSavedOption(base, 'a', () => 'x')).toBe(base);
    expect(withSavedOption(base, '', () => 'x')).toBe(base);
    expect(withSavedOption(base, undefined, () => 'x')).toBe(base);
  });
});
