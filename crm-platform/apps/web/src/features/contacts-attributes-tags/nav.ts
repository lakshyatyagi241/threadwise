import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'contacts',
    group: 'audience',
    labelKey: 'contacts-attributes-tags.nav.contacts',
    href: '/contacts',
    order: 0,
    icon: 'contacts',
    gates: { permission: 'record.contacts.read' },
  },
  {
    id: 'contact-groups',
    group: 'audience',
    labelKey: 'contacts-attributes-tags.nav.groups',
    href: '/contact-groups',
    order: 2,
    icon: 'groups',
    gates: { permission: 'record.contacts.read' },
  },
  {
    id: 'attributes',
    group: 'audience',
    labelKey: 'contacts-attributes-tags.nav.attributes',
    href: '/attributes',
    order: 1,
    icon: 'attributes',
    gates: { permission: 'record.contact-properties.read' },
  },
];
