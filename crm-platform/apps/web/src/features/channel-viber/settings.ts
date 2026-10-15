import { settingsTile } from '../_registry/settings-types';

/** Viber is a channel: it is connected and managed from Settings > Channels, not from the main menu. */
export const settings = [
  settingsTile({
    id: 'viber',
    shortcutFrom: ['/inbox'],
    section: 'channels',
    href: '/viber',
    icon: 'phone',
    order: 90,
    gates: { permission: 'viber.channels.read' },
  }),
];
