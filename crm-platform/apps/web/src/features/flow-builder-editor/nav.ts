import type { NavItem } from '../_registry/types';

/** One menu entry, in WaDesk's Automation group (it replaces the planned placeholder with the same id). */
export const nav: NavItem[] = [
  {
    id: 'flows',
    group: 'automation',
    labelKey: 'flb.nav.flows',
    href: '/flows',
    order: 0,
    icon: 'flow',
    gates: { permission: 'flb.flows.read', planFeature: 'automation' },
  },
];
