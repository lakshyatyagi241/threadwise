import { settingsTile } from '../_registry/settings-types';

/**
 * The workspace's Google account (TW-GACC): one tile under Integrations for members whose role may view it. The page itself checks the
 * manage permission before it offers Connect and Disconnect. Copy lives in `messages/<locale>/google-account.json` under
 * `settings.tiles.google-account`.
 */
export const settings = [
  settingsTile({
    id: 'google-account',
    section: 'integrations',
    href: '/google-account',
    icon: 'globe',
    order: 55,
    gates: { permission: 'google.account.read' },
  }),
];
