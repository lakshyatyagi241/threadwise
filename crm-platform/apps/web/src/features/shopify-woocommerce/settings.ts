import { settingsTile } from '../_registry/settings-types';

/**
 * The store integrations live under Settings > Integrations, with the workspace's other connections, instead of in the sidebar's Store
 * group (see `nav.ts`). The tiles carry the menu entries' gates: a missing permission hides the tile, a plan without the integration
 * keeps it visible and locked so it can upsell.
 */
export const settings = [
  settingsTile({
    id: 'shopify',
    section: 'integrations',
    href: '/shopify',
    icon: 'store',
    order: 40,
    gates: { permission: 'ecom.read', planFeature: 'shopify' },
  }),
  settingsTile({
    id: 'woocommerce',
    section: 'integrations',
    href: '/woocommerce',
    icon: 'store',
    order: 41,
    gates: { permission: 'ecom.read', planFeature: 'woocommerce' },
  }),
];
