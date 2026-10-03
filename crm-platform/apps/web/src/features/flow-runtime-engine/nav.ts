import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'flow-runtime',
    group: 'automation',
    labelKey: 'flr.nav.title',
    href: '/flow-runtime',
    order: 20,
    icon: 'flow',
    gates: { permission: 'flr.runs.read' },
  },
];
