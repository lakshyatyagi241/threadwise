import type { NavItem } from '../_registry/types';

/**
 * Email (Gmail) is a connection, not daily work, so the sidebar does not list it (`inMenu: false`): its tile is in Settings >
 * Channels (see `settings.ts`). The entry stays registered so the plan paywall covers `/email` (a workspace without the
 * Marketplace integration sees the upgrade screen, like Shopify and WooCommerce), Help can document it and the command palette
 * finds it. The inbox surfaces (the channel filter and tag, the composer) are not gated by this entry.
 */
export const nav: NavItem[] = [
  {
    id: 'email',
    group: 'inbox',
    labelKey: 'settings.tiles.email.label',
    href: '/email',
    order: 70,
    icon: 'mail',
    inMenu: false,
    gates: { permission: 'mail.mailboxes.read', planFeature: 'email_channel' },
  },
];
