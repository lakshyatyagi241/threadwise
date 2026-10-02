import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'dashboard',
    group: 'overview',
    labelKey: 'dashboards-analytics-charts.nav.title',
    href: '/dashboard',
    order: 0,
    icon: 'home',
    gates: { permission: 'dash.dashboard.read' },
  },
  {
    id: 'analytics',
    group: 'overview',
    labelKey: 'dashboards-analytics-charts.nav.analytics',
    href: '/analytics',
    order: 10,
    icon: 'analytics',
    gates: { permission: 'dash.analytics.read', planFeature: 'analytics' },
  },
];
