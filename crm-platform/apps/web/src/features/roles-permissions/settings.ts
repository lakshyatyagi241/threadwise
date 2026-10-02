import { settingsTile } from '../_registry/settings-types';

/**
 * Workspace (customer) Settings tiles, Team and permissions: the role-based Team screen and Roles. This file is named
 * settings.ts on purpose so the registry generator picks it up; the operator console entries live in `operator-nav.ts`,
 * which it must not import. The Team tile shares the Team members copy; the Roles tile
 * reads `settings.tiles.roles` (English and Arabic live in the Settings namespace, the workspace namespace is English only).
 */
export const settings = [
  settingsTile({
    id: 'workspace-team',
    section: 'people',
    labelKey: 'settings.tiles.team-members.label',
    descriptionKey: 'settings.tiles.team-members.description',
    keywordsKey: 'settings.tiles.team-members.keywords',
    href: '/settings/team',
    icon: 'team',
    order: 5,
    gates: { permission: 'admin.user.manage' },
  }),
  settingsTile({
    id: 'roles',
    section: 'people',
    href: '/settings/roles',
    icon: 'shield',
    order: 10,
    gates: { permission: 'admin.role.manage' },
  }),
];
