import type { NavItem } from '../_registry/types';

/**
 * The Store group's catalog entries, after the Store entry itself (order 0): the WhatsApp catalog, the product list and the
 * review queue. The `catalog` id replaces the planned entry of the same id.
 */
export const nav: NavItem[] = [
  {
    id: 'catalog',
    group: 'store',
    labelKey: 'catalogProducts.nav.catalog',
    href: '/catalog',
    order: 10,
    icon: 'catalog',
    gates: { permission: 'cat.catalog.read', planFeature: 'wa_storefront' },
  },
  {
    id: 'products-store',
    group: 'store',
    labelKey: 'catalogProducts.nav.products',
    href: '/store/products',
    order: 20,
    icon: 'store',
    gates: { permission: 'cat.products.read' },
  },
  {
    id: 'store-reviews',
    group: 'store',
    labelKey: 'catalogProducts.nav.reviews',
    href: '/store/reviews',
    order: 30,
    icon: 'help',
    gates: { permission: 'cat.reviews.read' },
  },
];
