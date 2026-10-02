import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'whatsapp-numbers',
    group: 'channels',
    labelKey: 'whatsapp-cloud-api-waba.nav.title',
    href: '/channels/whatsapp',
    order: 5,
    icon: 'channels',
    gates: { permission: 'waba.numbers.read' },
  },
];
