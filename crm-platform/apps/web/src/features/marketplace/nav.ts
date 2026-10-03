import type { NavItem } from '../_registry/types';

/**
 * One menu entry in the Automation group, after Appointments (see `planned.ts` for the sequence). The Marketplace is where an
 * admin browses, installs and manages mini apps and integrations. A plan without the `marketplace` feature keeps the entry
 * visible but locked (upgrade mark, and the paywall sheet over every `/marketplace/*` page).
 */
export const nav: NavItem[] = [
  {
    id: 'marketplace',
    group: 'automation',
    labelKey: 'marketplace.nav.marketplace',
    href: '/marketplace',
    order: 40,
    icon: 'plug',
    gates: { permission: 'market.apps.read', planFeature: 'marketplace' },
  },
];
