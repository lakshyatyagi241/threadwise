import type { NavItem } from '../_registry/types';

/**
 * The Store group's catalog entries, after the Store entry itself (order 0): the WhatsApp catalog, the product list and the
 * review queue. The `catalog` id replaces the planned entry of the same id.
 *
 * Products and Reviews are `inMenu: false`: the Store sidebar (`storefront-builder/admin/lib/sidebar.ts`) already lists both, so the
 * main menu does not repeat them. The WhatsApp catalog is not in that sidebar, so it keeps its own entry.
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
    inMenu: false,
    gates: { permission: 'cat.products.read' },
  },
  {
    id: 'store-reviews',
    group: 'store',
    labelKey: 'catalogProducts.nav.reviews',
    href: '/store/reviews',
    order: 30,
    icon: 'help',
    inMenu: false,
    gates: { permission: 'cat.reviews.read' },
  },
];
