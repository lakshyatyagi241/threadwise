import type { NavItem } from '../_registry/types';

/**
 * Campaigns is one menu entry. Creating is one screen (`/campaigns/create`); what has been sent, what waits and what repeats are read
 * on the Campaigns list itself, so there are no separate history, scheduled or recurring entries.
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
];
