import type { NavItem } from '../_registry/types';

/** The Store entry of the menu. It replaces the planned `store` item (same id) and opens the dashboard. */
export const nav: NavItem[] = [
  {
    id: 'store',
    group: 'store',
    labelKey: 'storefront-builder.nav.store',
    href: '/store',
    order: 0,
    icon: 'store',
    gates: { permission: 'store.dashboard.read' },
  },
];
