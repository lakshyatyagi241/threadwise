import type { NavItem } from '../_registry/types';

/** Deals is one menu entry; Reports and Pipeline settings are reached from the board's toolbar. */
export const nav: NavItem[] = [
  {
    id: 'deals',
    group: 'audience',
    labelKey: 'deals-pipelines.nav.deals',
    href: '/deals',
    order: 40,
    icon: 'deal',
    gates: { permission: 'record.deals.read' },
  },
];
