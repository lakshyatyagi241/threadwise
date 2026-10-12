import { settingsTile } from '../_registry/settings-types';

/**
 * Saved replies (TW-TIB1-024): the workspace library of reusable replies the composer's `/` picker inserts. A tile under Data and
 * customization for roles that may manage them (`inbox.savedreply.manage`); the plan only caps how many (`saved_replies`), so it is
 * never locked. Copy lives in `messages/<locale>/settings.json` under `settings.tiles.saved-replies`.
 *
 * Message logs: ask for the delivery log of the workspace's messages, up to a year back, as a CSV that is built in the background and
 * announced by email. A tile under Data and security for roles that may export it (`inbox.logs.export`). Copy lives in
 * `messages/<locale>/settings.json` under `settings.tiles.message-logs`.
 */
export const settings = [
  settingsTile({
    id: 'saved-replies',
    section: 'data',
    href: '/inbox/saved-replies',
    icon: 'reply',
    order: 50,
    shortcutFrom: ['/inbox'],
    gates: { permission: 'inbox.savedreply.manage' },
  }),
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
