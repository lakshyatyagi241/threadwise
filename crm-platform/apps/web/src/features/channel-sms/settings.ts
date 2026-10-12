import { settingsTile } from '../_registry/settings-types';

/** SMS is a channel: it is connected and managed from Settings > Channels. Send-only, so it needs the SMS plan feature. */
export const settings = [
  settingsTile({
    id: 'sms',
    section: 'channels',
    href: '/sms',
    icon: 'sms',
    order: 60,
    gates: { permission: 'sms.senders.read', planFeature: 'sms' },
  }),
];
