import { settingsTile } from '../_registry/settings-types';

/**
 * Members and Teams (WD-WSP-015, WD-WSP-022) are Settings tiles (Team and permissions), not menu entries. WaDesk gated the
 * Members page to Admin/Owner; here every member may read the list, so neither tile carries a permission gate. The actions on
 * the screens follow what the caller may do (`me.canInvite` and friends from the members summary), and the server stays the
 * authority. The label keeps the entry's own key; the help line and search words come from `settings.tiles.<id>`.
 */
export const settings = [
  settingsTile({
    id: 'team-members',
    section: 'people',
    labelKey: 'workspaces-teams-tenancy.nav.teamMembers',
    href: '/team-members',
    icon: 'team',
    order: 0,
  }),
  settingsTile({
    id: 'teams',
    section: 'people',
    labelKey: 'workspaces-teams-tenancy.nav.teams',
    href: '/teams',
    icon: 'groups',
    order: 20,
  }),
];
