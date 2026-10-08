import { settingsTile } from '../_registry/settings-types';

/**
 * The Google Sheets add-on page (WD-EXT-006): a tile under Integrations for members whose role may use the add-on. A plan without the
 * `marketplace` feature sees it locked. Copy lives in `messages/<locale>/chrome-extension-sheets-addon.json` under
 * `settings.tiles.google-sheets-addon`.
 */
export const settings = [
  settingsTile({
    id: 'google-sheets-addon',
    section: 'integrations',
    href: '/google-sheets-addon',
    icon: 'puzzle',
    order: 60,
    gates: { permission: 'app.google-sheets.use', planFeature: 'marketplace' },
  }),
];
