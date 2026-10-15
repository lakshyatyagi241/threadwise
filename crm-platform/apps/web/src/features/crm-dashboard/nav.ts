import type { NavItem } from '../_registry/types';

/**
 * Reference's CRM home (`/crm`, plan feature `access_sales_pipeline`) takes over its planned "Soon" entry (same id, so `planned.ts`
 * drops it). Gated like Deals: the capability to read deals, and the plan's sales pipeline (a plan without it sees the entry locked,
 * with the upgrade note, as the API answers 422 PLAN_FEATURE_LOCKED).
 */
export const nav: NavItem[] = [
  {
    id: 'crm-dashboard',
    group: 'sales',
    labelKey: 'crm-dashboard.nav.title',
    href: '/crm',
    order: 0,
    icon: 'crm',
    gates: { permission: 'record.deals.read', planFeature: 'sales_pipeline' },
  },
];
