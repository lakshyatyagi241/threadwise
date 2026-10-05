import { settingsTile } from '../_registry/settings-types';

/** WhatsApp numbers are connected and managed from Settings > Channels, not from the main menu. */
export const settings = [
  settingsTile({
    id: 'whatsapp',
    shortcutFrom: ['/inbox', '/broadcasts', '/templates'],
    section: 'channels',
    href: '/channels/whatsapp',
    icon: 'whatsapp',
    order: 10,
    gates: { permission: 'waba.numbers.read' },
  }),
  settingsTile({
    id: 'whatsapp-customers',
    section: 'business',
    href: '/store/customers',
    icon: 'user',
    order: 40,
    gates: { permission: 'store.customers.read' },
  }),
];
