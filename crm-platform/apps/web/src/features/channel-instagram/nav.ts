import type { NavItem } from '../_registry/types';

/** The reply-only broadcast is work, so it is in the menu; linking accounts is a channel setting (see `settings.ts`). */
export const nav: NavItem[] = [
  {
    id: 'instagram',
    group: 'inbox',
    labelKey: 'settings.tiles.instagram.label',
    href: '/instagram',
    order: 72,
    icon: 'instagram',
    inMenu: false,
    gates: { permission: 'ig.accounts.read', planFeature: 'extra_channels', closeWhenLocked: true },
  },
  {
    id: 'instagram-broadcast',
    group: 'campaigns',
    labelKey: 'instagram.nav.broadcast',
    href: '/instagram/broadcast',
    order: 42,
    icon: 'broadcast',
    gates: { planFeature: 'extra_channels', closeWhenLocked: true, permission: 'ig.broadcasts.manage' },
  },
];
