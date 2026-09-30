import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'contacts',
    group: 'crm',
    labelKey: 'contacts-attributes-tags.nav.title',
    href: '/contacts',
    order: 0,
    gates: { permission: 'record.contacts.read' },
  },
];
