import type { NavItem } from '../_registry/types';

/**
 * Its own menu entry (the `apps` group, after Store): one icon on the rail, no panel. The Marketplace is where an
 * admin browses, installs and manages mini apps and integrations. A plan without the `marketplace` feature keeps the entry
 * visible but locked (upgrade mark, and the paywall sheet over every `/marketplace/*` page).
 */
export const nav: NavItem[] = [
  {
    id: 'marketplace',
    group: 'apps',
    labelKey: 'marketplace.nav.marketplace',
    href: '/marketplace',
    order: 0,
    icon: 'apps',
    gates: { permission: 'market.apps.read', planFeature: 'marketplace' },
  },
];
