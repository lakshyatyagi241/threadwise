import type { NavItem } from '../_registry/types';

/**
 * Deals is one menu entry; Reports and Pipeline settings are reached from the board's toolbar.
 *
 * The API refuses every deals read with PLAN_FEATURE_LOCKED when the plan has no `sales_pipeline` (SalesPipelineGuard), so the entry
 * declares the same feature (BL-380, gap 17), like the Companies and CRM dashboard entries beside it: it stays in the menu, locked, and
 * the paywall explains. Hidden would be wrong: a plan without the feature should see what it could have.
 */
export const nav: NavItem[] = [
  {
    id: 'deals',
    group: 'audience',
    labelKey: 'deals-pipelines.nav.deals',
    href: '/deals',
    order: 40,
    icon: 'deal',
    gates: { permission: 'record.deals.read', planFeature: 'sales_pipeline' },
  },
];
