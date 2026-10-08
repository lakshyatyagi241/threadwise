import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'reports',
    group: 'overview',
    labelKey: 'report-copilot.nav.title',
    href: '/reports',
    order: 15,
    icon: 'bot',
    gates: { permission: 'dash.reports.read' },
  },
];
