import type { NavItem } from '../_registry/types';

/**
 * Campaigns, and its three history pages (what has been sent, what waits for its time, what repeats). The menu has no nested items:
 * they are plain entries of the group, right after Campaigns. Same gate as the campaigns list, whose address (`/campaigns`) covers
 * them. Creating is one entry, `/campaigns/create`; the broadcast screens are gone from the menu.
 */
export const nav: NavItem[] = [
  {
    id: 'campaigns',
    group: 'campaigns',
    labelKey: 'campaigns.nav.title',
    href: '/campaigns',
    order: 0,
    icon: 'campaign',
    gates: { permission: 'camp.campaigns.read' },
  },
  {
    id: 'campaign-history',
    group: 'campaigns',
    labelKey: 'campaigns.nav.history',
    href: '/campaigns/history',
    order: 1,
    icon: 'history',
    gates: { permission: 'camp.campaigns.read' },
  },
  {
    id: 'campaign-scheduled',
    group: 'campaigns',
    labelKey: 'campaigns.nav.scheduled',
    href: '/campaigns/scheduled',
    order: 2,
    icon: 'calendar',
    gates: { permission: 'camp.campaigns.read' },
  },
  {
    id: 'campaign-recurring',
    group: 'campaigns',
    labelKey: 'campaigns.nav.recurring',
    href: '/campaigns/recurring',
    order: 3,
    icon: 'clock',
    gates: { permission: 'camp.campaigns.read' },
  },
];
