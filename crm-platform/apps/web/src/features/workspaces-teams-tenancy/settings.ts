import { settingsTile } from '../_registry/settings-types';

/**
 * Teams (TW-WSP-022) is a Settings tile (Team and permissions), not a menu entry. The Members page (TW-WSP-015) has no tile of its
 * own: the Team tile of the roles domain (`/settings/team`) is the one "Team members" entry, so Settings shows it once; `/team-members`
 * still opens by address and from links. Reference gated the
 * Members page to Admin/Owner; here every member may read the list, so neither tile carries a permission gate. The actions on
 * the screens follow what the caller may do (`me.canInvite` and friends from the members summary), and the server stays the
 * authority. The label keeps the entry's own key; the help line and search words come from `settings.tiles.<id>`.
 */
export const settings = [
  settingsTile({
    id: 'teams',
    section: 'people',
    labelKey: 'workspaces-teams-tenancy.nav.teams',
    href: '/teams',
    icon: 'groups',
    order: 20,
  }),
];
