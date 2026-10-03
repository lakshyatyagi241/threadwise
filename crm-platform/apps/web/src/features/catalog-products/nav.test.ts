import { describe, expect, it } from 'vitest';
import { resolveNav } from '../_registry/resolve';
import type { Capabilities } from '../_registry/types';
import { nav } from './nav';

const caps = (permissions: string[] | null, planFeatures: string[] | null): Capabilities => ({
  permissions: permissions && new Set(permissions),
  planFeatures: planFeatures && new Set(planFeatures),
  channels: null,
});
const ids = (c: Capabilities) => resolveNav(nav, c).map((i) => i.id);

describe('catalog-products nav', () => {
  it('declares the three Store entries with their gates', () => {
    const byId = Object.fromEntries(nav.map((n) => [n.id, n]));
    expect(byId.catalog?.gates).toEqual({
      permission: 'cat.catalog.read',
      planFeature: 'wa_storefront',
    });
    expect(byId['products-store']?.gates).toEqual({ permission: 'cat.products.read' });
    expect(byId['store-reviews']?.gates).toEqual({ permission: 'cat.reviews.read' });
    expect(nav.map((n) => n.href)).toEqual(['/catalog', '/store/products', '/store/reviews']);
  });

  it('hides an entry the role cannot read', () => {
    const shown = ids(caps(['cat.products.read'], null));
    expect(shown).toContain('products-store');
    expect(shown).not.toContain('catalog');
    expect(shown).not.toContain('store-reviews');
  });

  it('keeps the catalog entry but marks it locked on a plan without wa_storefront', () => {
    const all = resolveNav(nav, caps(['cat.catalog.read'], ['inbox_routing']));
    const flat = JSON.stringify(all);
    expect(flat).toContain('"locked":true');
    const unlocked = JSON.stringify(resolveNav(nav, caps(['cat.catalog.read'], ['wa_storefront'])));
    expect(unlocked).not.toContain('"locked":true');
  });
});
