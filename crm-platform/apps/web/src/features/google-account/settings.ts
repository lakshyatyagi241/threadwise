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
  // Sheets, Docs and Forms are cards of their own in the Marketplace Integrations tab, like Shopify and WooCommerce, but they have no
  // connection of their own: each opens the one Google account page, where the permission for that app is allowed.
  ...(
    [
      ['google-sheets', 56],
      ['google-docs', 57],
      ['google-forms', 58],
    ] as const
  ).map(([id, order]) =>
    settingsTile({
      id,
      section: 'integrations',
      href: '/google-account',
      icon: id,
      order,
      gates: { permission: 'google.account.read' },
    }),
  ),
];
