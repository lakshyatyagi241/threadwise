import type { NavItem } from '../_registry/types';

/** "Affiliate" is a pane of the account hub (`/account/<name>` joins the hub menu; order 60 sits between Plan and Branding). */
export const nav: NavItem[] = [
  {
    id: 'affiliate',
    group: 'settings',
    labelKey: 'coupons-credits-referral-currency.nav.affiliate',
    href: '/account/affiliate',
    order: 60,
  },
];
