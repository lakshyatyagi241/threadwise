import type { NavItem } from '../../_registry/types';

/**
 * Affiliate: a pane of the account hub (`/account/<name>` joins the hub menu, order below 100 = the Account group; Reference's
 * Account page has Plan, Orders, Wallet, Add-ons, Affiliate...). The full history page (`/affiliate-history`) is not a menu
 * entry: Reference reached it from its More hub, so here it is the pane's "Full history" button. No gates: every signed-in
 * user has a code (TW-CPN-035).
 */
export const nav: NavItem[] = [
  {
    id: 'affiliate',
    group: 'settings',
    labelKey: 'coupons-credits-referral-currency.affiliate.nav.pane',
    href: '/account/affiliate',
    order: 50,
  },
];
