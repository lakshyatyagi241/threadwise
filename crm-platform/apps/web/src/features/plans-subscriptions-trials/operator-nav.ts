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
  {
    id: 'plan-settings',
    href: '/admin/plan-settings',
    labelKey: 'plans-subscriptions-trials.nav.planSettings',
    groupKey: 'plans-subscriptions-trials.nav.group',
  },
  {
    id: 'plan-analytics',
    href: '/admin/plan-analytics',
    labelKey: 'plans-subscriptions-trials.nav.analytics',
    groupKey: 'plans-subscriptions-trials.nav.group',
  },
  {
    id: 'financial',
    href: '/admin/financial',
    labelKey: 'plans-subscriptions-trials.nav.financial',
    groupKey: 'plans-subscriptions-trials.nav.group',
  },
  {
    id: 'premium',
    href: '/admin/premium',
    labelKey: 'plans-subscriptions-trials.nav.premium',
    groupKey: 'plans-subscriptions-trials.nav.group',
  },
];
