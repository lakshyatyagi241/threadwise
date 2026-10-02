import type { NavItem } from '../_registry/types';

/** Contacts and Contact groups are daily work and stay in the menu; Attributes, Contact stages and Contact properties are Settings tiles (see `settings.ts`). */
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
];
