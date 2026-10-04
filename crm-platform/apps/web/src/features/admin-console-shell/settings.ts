import { settingsTile } from '../_registry/settings-types';

/** The workspace's own Settings page (name, timezone, currency, notification matrix, data export, delete workspace). */
export const settings = [
  settingsTile({
    id: 'workspace-settings',
    section: 'business',
    href: '/workspace-settings',
    icon: 'gear',
    order: 10,
    labelKey: 'admin-console-shell.settings.workspace.label',
    descriptionKey: 'admin-console-shell.settings.workspace.description',
    keywordsKey: 'admin-console-shell.settings.workspace.keywords',
  }),
];
