import type { NavItem } from '../_registry/types';

/**
 * The two store integrations. They are connections, not daily work, so the sidebar does not list them (`inMenu: false`): each has a
 * tile in Settings > Integrations (see `settings.ts`), which is where a workspace finds and sets up its other connections. The
 * entries stay registered so the plan paywall still covers `/shopify` and `/woocommerce`, Help can document them, and the command
 * palette still finds them. Both read the same permission; a workspace may use either.
 *
 * The plan features are the catalogue's own keys, `shopify` and `woocommerce` (what the API gates on). The keys these entries used
 * before, `integration_shopify` and `integration_woocommerce`, are not in the catalogue, so both entries always rendered locked.
 */
export const nav: NavItem[] = [
  {
    id: 'shopify',
    group: 'store',
    labelKey: 'ecom.nav.shopify',
    href: '/shopify',
    order: 40,
    icon: 'store',
    inMenu: false,
    gates: { permission: 'ecom.read', planFeature: 'shopify' },
  },
  {
    id: 'woocommerce',
    group: 'store',
    labelKey: 'ecom.nav.woocommerce',
    href: '/woocommerce',
    order: 41,
    icon: 'store',
    inMenu: false,
    gates: { permission: 'ecom.read', planFeature: 'woocommerce' },
  },
];
