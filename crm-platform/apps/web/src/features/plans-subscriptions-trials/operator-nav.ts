import type { OperatorNavItem } from '../auth-registration-security/platform/operator-nav';

/** The console entry next to the plan catalogue (spread into OPERATOR_NAV). */
export const PLAN_OPERATOR_NAV: readonly OperatorNavItem[] = [
  {
    id: 'workspace-plans',
    href: '/admin/workspace-plans',
    labelKey: 'plans-subscriptions-trials.nav.workspacePlans',
    groupKey: 'plans-subscriptions-trials.nav.group',
  },
  {
    id: 'pricing-faqs',
    href: '/admin/pricing-faqs',
    labelKey: 'plans-subscriptions-trials.nav.pricingFaqs',
    groupKey: 'plans-subscriptions-trials.nav.group',
  },
];
