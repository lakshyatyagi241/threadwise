import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'broadcasts',
    group: 'campaigns',
    labelKey: 'broadcasts.nav.title',
    href: '/broadcasts',
    order: 10,
    icon: 'broadcast',
    gates: { permission: 'bcast.broadcasts.read' },
  },
];
