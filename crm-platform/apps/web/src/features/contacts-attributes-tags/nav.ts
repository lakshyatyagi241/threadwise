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
  // Settings & Workspace: how a contact is described (stages and statuses, then every property). The API guards both
  // with the Contact Properties permissions (status options and the field registry share them).
  {
    id: 'contact-stages',
    group: 'settings',
    labelKey: 'contacts-attributes-tags.nav.stages',
    href: '/contact-stages',
    order: 40,
    icon: 'pipelines',
    gates: { permission: 'record.contact-properties.read' },
  },
  {
    id: 'contact-properties',
    group: 'settings',
    labelKey: 'contacts-attributes-tags.nav.properties',
    href: '/contact-properties',
    order: 50,
    icon: 'catalog',
    gates: { permission: 'record.contact-properties.read' },
  },
];
