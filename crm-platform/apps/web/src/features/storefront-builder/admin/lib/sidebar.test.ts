import { describe, expect, it } from 'vitest';
import {
  MAIN_ENTRIES,
  SETTINGS_ENTRIES,
  activeKey,
  entryHref,
  visibleEntries,
} from './sidebar';

const find = (key: string) => [...MAIN_ENTRIES, ...SETTINGS_ENTRIES].find((e) => e.key === key)!;

describe('sidebar entries', () => {
  it('keeps WaDesk order', () => {
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
  it('links Products and Reviews and disables the sibling-domain pages', () => {
    for (const k of ['overview', 'products', 'storefront', 'reviews'])
      expect(find(k).state).toBe('link');
    for (const k of [
      'orders',
      'groups',
      'coupons',
      'payments',
      'gateways',
      'customers',
      'invoices',
    ]) {
      expect(find(k).state).toBe('soon');
    }
  });
  it('hides the storefront entry without the read permission', () => {
    expect(visibleEntries(MAIN_ENTRIES, () => false).some((e) => e.key === 'storefront')).toBe(
      false,
    );
    expect(visibleEntries(MAIN_ENTRIES, () => true)).toHaveLength(MAIN_ENTRIES.length);
  });
  it('carries the selected shop on the overview and storefront links only', () => {
    expect(entryHref(find('overview'), 'abc')).toBe('/store?shop=abc');
    expect(entryHref(find('storefront'), 'abc')).toBe('/store/storefront?shop=abc');
    expect(entryHref(find('products'), 'abc')).toBe('/store/products');
    expect(entryHref(find('overview'), null)).toBe('/store');
  });
});

describe('activeKey', () => {
  it('uses the second URL segment, defaulting to the overview', () => {
    expect(activeKey('/store')).toBe('overview');
    expect(activeKey('/store/storefront')).toBe('storefront');
    expect(activeKey('/store/products/create')).toBe('products');
    expect(activeKey('/store/unknown')).toBe('overview');
    expect(activeKey('/connect')).toBe('connection');
  });
});
