import type { NavItem } from '../_registry/types';

/**
 * Workspace (customer) menu: Team members and Roles, under Settings. This file is named nav.ts on purpose so the
 * registry generator picks it up; the operator console entries live in `operator-nav.ts`, which it must not import.
 * `team-members` replaces the planned "coming soon" entry of the same id.
 */
export const nav: NavItem[] = [
  {
    id: 'team-members',
    group: 'settings',
    labelKey: 'roles-permissions-workspace.nav.team',
    href: '/settings/team',
    order: 20,
    icon: 'team',
    gates: { permission: 'admin.user.manage' },
  },
  {
    id: 'workspace-roles',
    group: 'settings',
    labelKey: 'roles-permissions-workspace.nav.roles',
    href: '/settings/roles',
    order: 30,
    icon: 'settings',
    gates: { permission: 'admin.role.manage' },
  },
];
