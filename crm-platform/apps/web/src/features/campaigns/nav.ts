import type { NavItem } from '../_registry/types';

/**
 * Campaigns, and the three history pages of broadcasts (what has been sent, what waits for its time, what repeats). The menu has no
 * nested items: they are plain entries of the group, ordered right after Broadcasts. Same gate as the campaigns list, whose address
 * (`/campaigns`) covers them.
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
    id: 'broadcast-history',
    group: 'campaigns',
    labelKey: 'campaigns.nav.history',
    href: '/campaigns/history',
    order: 11,
    icon: 'history',
    gates: { permission: 'camp.campaigns.read' },
  },
  {
    id: 'broadcast-scheduled',
    group: 'campaigns',
    labelKey: 'campaigns.nav.scheduled',
    href: '/campaigns/scheduled',
    order: 12,
    icon: 'calendar',
    gates: { permission: 'camp.campaigns.read' },
  },
  {
    id: 'broadcast-recurring',
    group: 'campaigns',
    labelKey: 'campaigns.nav.recurring',
    href: '/campaigns/recurring',
    order: 13,
    icon: 'clock',
    gates: { permission: 'camp.campaigns.read' },
  },
];
