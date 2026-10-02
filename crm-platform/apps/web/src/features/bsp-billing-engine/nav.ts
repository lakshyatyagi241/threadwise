import type { NavItem } from '../_registry/types';

/** The workspace's own choice of who bills its messages (WD-BSP-011); the operator pages are in the console menu. */
export const nav: NavItem[] = [
  {
    id: 'bsp-billing-mode',
    group: 'settings',
    labelKey: 'bsp-billing-engine.nav.billing',
    href: '/billing-mode',
    order: 40,
    gates: { permission: 'bsp.billing.read' },
  },
];
