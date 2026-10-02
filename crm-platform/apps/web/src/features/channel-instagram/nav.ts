import type { NavItem } from '../_registry/types';

/** The reply-only broadcast is work, so it is in the menu; linking accounts is a channel setting (see `settings.ts`). */
export const nav: NavItem[] = [
  {
    id: 'instagram-broadcast',
    group: 'campaigns',
    labelKey: 'instagram.nav.broadcast',
    href: '/instagram/broadcast',
    order: 42,
    icon: 'broadcast',
    gates: { permission: 'ig.broadcasts.manage' },
  },
];
