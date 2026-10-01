import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'contacts',
    group: 'crm',
    labelKey: 'contacts-attributes-tags.nav.contacts',
    href: '/contacts',
    order: 0,
    gates: { permission: 'record.contacts.read' },
  },
  {
    id: 'contact-groups',
    group: 'crm',
    labelKey: 'contacts-attributes-tags.nav.groups',
    href: '/contact-groups',
    order: 1,
    gates: { permission: 'record.contacts.read' },
  },
  {
    id: 'attributes',
    group: 'crm',
    labelKey: 'contacts-attributes-tags.nav.attributes',
    href: '/attributes',
    order: 2,
    gates: { permission: 'record.contact-properties.read' },
  },
];
