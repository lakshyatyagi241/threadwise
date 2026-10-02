import type { NavItem } from '../_registry/types';

/**
 * Reference showed Instagram accounts among the channels on the devices screen and had no entry of its own. The port gives the channel
 * a hub where accounts are linked and unlinked (the same rows and dialog); the Channels page can embed the same components.
 */
export const nav: NavItem[] = [
  {
    id: 'instagram',
    group: 'channels',
    labelKey: 'instagram.nav.hub',
    href: '/instagram',
    order: 30,
    icon: 'channels',
    gates: { permission: 'ig.accounts.read' },
  },
  {
    id: 'instagram-broadcast',
    group: 'channels',
    labelKey: 'instagram.nav.broadcast',
    href: '/instagram/broadcast',
    order: 31,
    icon: 'broadcast',
    gates: { permission: 'ig.broadcasts.manage' },
  },
];
