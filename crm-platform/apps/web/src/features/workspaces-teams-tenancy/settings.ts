import { settingsTile } from '../_registry/settings-types';

/**
 * Teams (TW-WSP-022, Teams v2) is a Settings tile (Team and permissions), not a menu entry. It is gated by `team.read`, held by the
 * Owner, Admin, Manager and Agent presets (a Viewer does not see it); writing needs `team.manage`, or the older `inbox.team.manage`
 * which is kept as an alias for one release. The Members page (TW-WSP-015) has no tile of its own: the Team tile of the roles
 * domain (`/settings/team`) is the one "Team members" entry, so Settings shows it once; `/team-members` redirects there and keeps
 * its `?member=&reassign=1` links working. The label keeps the entry's own key; the help line and search words come from
 * `settings.tiles.<id>`.
 */
export const settings = [
  settingsTile({
    id: 'teams',
    section: 'people',
    labelKey: 'workspaces-teams-tenancy.nav.teams',
    href: '/teams',
    icon: 'groups',
    order: 20,
    gates: { permission: 'team.read' },
  }),
];
