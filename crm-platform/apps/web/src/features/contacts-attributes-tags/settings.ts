import { settingsTile } from '../_registry/settings-types';

/** Contact stages and Contact properties left the menu for Settings. Attributes has no tile of its own: it is the same records as Contact properties, so the page stays at /attributes (linked from the slash picker, the flow builder and Contact properties) without a second tile. */
export const settings = [
  settingsTile({
    id: 'import-export',
    section: 'security',
    href: '/import-export',
    icon: 'transfer',
    order: 10,
    gates: { permission: 'record.contacts.import' },
  }),
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
    id: 'uncontacted-leads',
    shortcutFrom: ['/contacts'],
    section: 'automation',
    href: '/uncontacted-leads',
    icon: 'user',
    order: 40,
    gates: { permission: 'admin.settings.manage' },
  }),
  settingsTile({
    id: 'follow-ups',
    shortcutFrom: ['/contacts'],
    section: 'automation',
    href: '/follow-ups',
    icon: 'clock',
    order: 41,
    gates: { permission: 'admin.settings.manage' },
  }),
];
