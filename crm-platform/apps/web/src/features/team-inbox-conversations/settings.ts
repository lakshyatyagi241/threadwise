import { settingsTile } from '../_registry/settings-types';

/**
 * Message logs: ask for the delivery log of the workspace's messages, up to a year back, as a CSV that is built in the background and
 * announced by email. A tile under Data and security for roles that may export it (`inbox.logs.export`). Copy lives in
 * `messages/<locale>/settings.json` under `settings.tiles.message-logs`.
 */
export const settings = [
  settingsTile({
    id: 'message-logs',
    section: 'security',
    href: '/inbox/message-logs',
    icon: 'shield',
    order: 45,
    shortcutFrom: ['/inbox'],
    gates: { permission: 'inbox.logs.export' },
  }),
];
