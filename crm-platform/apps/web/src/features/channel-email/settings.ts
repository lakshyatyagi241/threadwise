import { settingsTile } from '../_registry/settings-types';

/**
 * Email (Gmail) is an integration: it is connected and managed from Settings > Integrations, with the workspace's other connections
 * (the Shopify and WooCommerce precedent). It is a paid first-party Marketplace integration that grants the plan feature
 * `email_channel`. A missing permission hides the tile; a plan or Marketplace subscription without the feature keeps it visible and
 * locked so it can upsell, and `/email` shows the plan paywall (see `nav.ts`).
 */
export const settings = [
  settingsTile({
    id: 'email',
    section: 'integrations',
    href: '/email',
    icon: 'mail',
    order: 70,
    gates: { permission: 'mail.mailboxes.read', planFeature: 'email_channel' },
  }),
];
