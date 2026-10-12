import { settingsTile } from '../_registry/settings-types';

/**
 * Email is a channel: it is connected and managed from Settings > Channels. It is a paid first-party Marketplace add-on (plan
 * feature `email_channel`), so the `app` gate removes the tile and closes `/email` for a workspace that has not bought it.
 */
export const settings = [
  settingsTile({
    id: 'email',
    section: 'channels',
    href: '/email',
    icon: 'mail',
    order: 70,
    gates: { permission: 'mail.mailboxes.read', app: 'email_channel' },
  }),
];
