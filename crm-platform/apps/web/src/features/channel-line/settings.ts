import { settingsTile } from '../_registry/settings-types';

/** LINE is a channel: it is connected and managed from Settings > Channels, not from the main menu. */
export const settings = [
  settingsTile({
    id: 'line',
    shortcutFrom: ['/inbox'],
    section: 'channels',
    href: '/line',
    icon: 'chat',
    order: 80,
    gates: { permission: 'line.channels.read' },
  }),
];
