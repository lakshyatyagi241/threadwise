import type { NavItem } from '../_registry/types';

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
