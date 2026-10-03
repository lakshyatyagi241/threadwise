import { settingsTile } from '../_registry/settings-types';

/** Contact stages, Contact properties and Attributes left the menu for Settings (the screens and their routes are unchanged). */
export const settings = [
  settingsTile({
    id: 'contact-stages',
    shortcutFrom: ['/contacts', '/contact-groups', '/segments'],
    section: 'data',
    href: '/contact-stages',
    icon: 'pipelines',
    order: 0,
    gates: { permission: 'record.contact-properties.read' },
  }),
  settingsTile({
    id: 'contact-properties',
    shortcutFrom: ['/contacts', '/contact-groups', '/segments'],
    section: 'data',
    href: '/contact-properties',
    icon: 'catalog',
    order: 10,
    gates: { permission: 'record.contact-properties.read' },
  }),
  settingsTile({
    id: 'attributes',
    shortcutFrom: ['/contacts', '/contact-groups'],
    section: 'data',
    href: '/attributes',
    icon: 'attributes',
    order: 20,
    gates: { permission: 'record.contact-properties.read' },
  }),
];
