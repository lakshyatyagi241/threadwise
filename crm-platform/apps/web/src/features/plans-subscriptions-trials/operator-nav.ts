import type { OperatorNavItem } from '../auth-registration-security/platform/operator-nav';

/** The console entries next to the plan catalogue (spread into OPERATOR_NAV). Per-workspace plans live on the Workspaces page. */
export const PLAN_OPERATOR_NAV: readonly OperatorNavItem[] = [
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
