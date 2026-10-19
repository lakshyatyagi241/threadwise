import { settingsTile } from '../_registry/settings-types';

/** WeChat is a channel: it is connected and managed from Settings > Channels, not from the main menu. */
export const settings = [
  settingsTile({
    id: 'wechat',
    shortcutFrom: ['/inbox'],
    section: 'channels',
    href: '/wechat',
    icon: 'team-chat',
    order: 100,
    gates: { permission: 'wechat.channels.read', planFeature: 'extra_channels' },
  }),
];
