import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'telegram',
    group: 'channels',
    labelKey: 'telegram.nav.title',
    href: '/telegram',
    order: 10,
    icon: 'send',
    gates: { permission: 'tg.bots.read' },
  },
];
