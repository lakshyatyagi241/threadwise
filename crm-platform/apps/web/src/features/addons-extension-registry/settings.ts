import { settingsTile } from '../_registry/settings-types';

/** The workspace's add-ons left the menu for Settings (Integrations and developer). */
export const settings = [
  settingsTile({ id: 'addons', section: 'integrations', href: '/addons', icon: 'puzzle', order: 30 }),
];
