import type { PublicProduct } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  applyFilters,
  categoriesOf,
  discountPercent,
  mergeProducts,
  priceRange,
  type FilterState,
} from './catalog';

const mk = (n: number, over: Partial<PublicProduct> = {}): PublicProduct => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  slug: `p-${n}`,
  name: `Item ${n}`,
  sku: null,
  description: null,
  bodyHtml: null,
  priceMinor: n * 10000,
  priceDisplay: '',
  comparePriceMinor: null,
  comparePriceDisplay: null,
  onSale: false,
  currencyCode: 'INR',
  imageUrl: null,
  galleryUrls: [],
  category: null,
  stockQty: null,
  brand: null,
  ...over,
});
const f = (over: Partial<FilterState>): FilterState => ({ ...DEFAULT_FILTERS, ...over });
const names = (ps: PublicProduct[]) => ps.map((p) => p.name);

describe('filters (WD-STORE-031)', () => {
  const list = [
    mk(1, { name: 'Blue Shirt', category: 'Tops' }),
    mk(2, { name: 'Red shirt', category: 'Tops', comparePriceMinor: 30000 }),
    mk(3, { name: 'Jeans', category: 'Bottoms', stockQty: 0 }),
    mk(4, { name: 'Cap' }),
  ];

  it('searches the name by substring, case-insensitively', () => {
    expect(names(applyFilters(list, f({ term: 'SHIRT' })))).toEqual(['Blue Shirt', 'Red shirt']);
  });

  it('ORs categories', () => {
    expect(
      names(applyFilters(list, f({ categories: ['Tops', 'Bottoms'], inStockOnly: false }))),
    ).toEqual(['Blue Shirt', 'Red shirt', 'Jeans']);
  });

  it('bounds the price in major units (100 to 500 means 10000..50000 minor)', () => {
    expect(names(applyFilters(list, f({ min: '150', max: '300' })))).toEqual(['Red shirt']);
    expect(applyFilters(list, f({ min: 'abc', max: '' }))).toHaveLength(3);
  });

  it('hides sold-out products unless asked, and filters on sale', () => {
    expect(names(applyFilters(list, f({})))).not.toContain('Jeans');
    expect(names(applyFilters(list, f({ inStockOnly: false })))).toContain('Jeans');
    expect(names(applyFilters(list, f({ saleOnly: true })))).toEqual(['Red shirt']);
  });

  it('sorts, and Featured restores the server order (WaDesk left the last sort)', () => {
    expect(names(applyFilters(list, f({ sort: 'price-desc' })))).toEqual([
      'Cap',
      'Red shirt',
      'Blue Shirt',
    ]);
    expect(names(applyFilters(list, f({ sort: 'price-asc' })))[0]).toBe('Blue Shirt');
    expect(names(applyFilters(list, f({ sort: 'name-asc' })))).toEqual([
      'Blue Shirt',
      'Cap',
      'Red shirt',
    ]);
    expect(names(applyFilters(list, f({ sort: 'name-desc' })))[0]).toBe('Red shirt');
    expect(names(applyFilters(list, f({ sort: 'featured' })))).toEqual([
      'Blue Shirt',
      'Red shirt',
      'Cap',
    ]);
  });

  it('derives facets from everything loaded', () => {
    expect(categoriesOf(list)).toEqual(['Tops', 'Bottoms']);
    expect(priceRange(list)).toEqual({ min: 100, max: 400 });
    expect(priceRange([])).toEqual({ min: 0, max: 0 });
  });

  it('appends a page without duplicates', () => {
    expect(mergeProducts(list.slice(0, 2), list.slice(1))).toHaveLength(4);
  });

  it('rounds the discount badge', () => {
    expect(discountPercent({ priceMinor: 20000, comparePriceMinor: 30000 })).toBe(33);
    expect(discountPercent({ priceMinor: 30000, comparePriceMinor: 30000 })).toBe(0);
  });
});
