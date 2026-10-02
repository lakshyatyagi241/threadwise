import { settingsTile } from '../_registry/settings-types';

/** Telegram is a channel: it is connected and managed from Settings > Channels, not from the main menu. */
export const settings = [
  settingsTile({
    id: 'telegram',
    section: 'channels',
    href: '/telegram',
    icon: 'send',
    order: 40,
    gates: { permission: 'tg.bots.read' },
  }),
];
