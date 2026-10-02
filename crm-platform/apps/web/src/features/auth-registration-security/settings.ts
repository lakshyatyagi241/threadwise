import { settingsTile } from '../_registry/settings-types';

/**
 * The account hub's panes. The "Account" menu entry is gone (the user menu still links to it); the panes that are
 * configuration are Settings tiles. The danger pane (delete account) is reached from the hub itself.
 */
export const settings = [
  settingsTile({ id: 'account', section: 'business', href: '/account/profile', icon: 'user', order: 40 }),
  settingsTile({ id: 'branding', section: 'business', href: '/account/branding', icon: 'brush', order: 50 }),
  settingsTile({ id: 'plans', section: 'business', href: '/account/plans', icon: 'plan', order: 20 }),
  settingsTile({ id: 'account-security', section: 'security', href: '/account/security', icon: 'key', order: 0 }),
];
