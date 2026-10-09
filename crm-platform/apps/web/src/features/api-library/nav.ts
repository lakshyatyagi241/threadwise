import type { NavItem } from '../_registry/types';

/**
 * One menu entry in the Automation group, right after Flows: the saved API calls a flow can run. Owner-requested (the old
 * console's "API Library"); not a Reference screen. No plan feature gates it (docs/api/api-library.md, section 2).
 */
export const nav: NavItem[] = [
  {
    id: 'api-library',
    group: 'automation',
    labelKey: 'api-library.nav.apiLibrary',
    href: '/api-library',
    order: 5,
    icon: 'plug',
    gates: { permission: 'integ.apilibrary.read' },
  },
];
