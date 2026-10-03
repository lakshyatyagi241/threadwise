import type { NavItem } from '../_registry/types';

/** The two store integrations sit with the rest of the store tools. Both read the same permission; a workspace may use either. */
export const nav: NavItem[] = [
  {
    id: 'shopify',
    group: 'store',
    labelKey: 'ecom.nav.shopify',
    href: '/shopify',
    order: 40,
    icon: 'store',
    gates: { permission: 'ecom.read', planFeature: 'integration_shopify' },
  },
  {
    id: 'woocommerce',
    group: 'store',
    labelKey: 'ecom.nav.woocommerce',
    href: '/woocommerce',
    order: 41,
    icon: 'store',
    gates: { permission: 'ecom.read', planFeature: 'integration_woocommerce' },
  },
];
