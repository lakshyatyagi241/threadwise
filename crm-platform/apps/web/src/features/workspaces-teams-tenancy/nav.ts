import type { NavItem } from '../_registry/types';

/**
 * Team Inbox > Members and Teams (TW-WSP-015, TW-WSP-022). Reference gated the Members page to Admin/Owner; here every
 * member may read the list, so neither entry carries a permission gate. The actions on the screens follow what the
 * caller may do (`me.canInvite` and friends from the members summary), and the server stays the authority.
 */
export const nav: NavItem[] = [
  {
    id: 'team-members',
    group: 'inbox',
    labelKey: 'workspaces-teams-tenancy.nav.teamMembers',
    href: '/team-members',
    order: 40,
    icon: 'team',
  },
  {
    id: 'teams',
    group: 'inbox',
    labelKey: 'workspaces-teams-tenancy.nav.teams',
    href: '/teams',
    order: 41,
    icon: 'groups',
  },
];
