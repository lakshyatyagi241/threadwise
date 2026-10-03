import type { NavItem } from '../_registry/types';

/** "Plan and usage" is a pane of the account hub (`/account/<name>` joins the hub menu, order below 100 = the Account group). */
export const nav: NavItem[] = [
  {
    id: 'plan-usage',
    group: 'settings',
    labelKey: 'plans-subscriptions-trials.nav.usage',
    href: '/account/usage',
    order: 11,
  },
];
