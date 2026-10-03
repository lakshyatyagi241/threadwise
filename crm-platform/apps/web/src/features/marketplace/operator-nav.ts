/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'marketplace.operator.nav';

/**
 * The Marketplace catalogue's console pages, merged into the console menu by
 * `auth-registration-security/platform/operator-nav.ts` (not named nav.ts: the customer-menu generator imports every nav.ts).
 * Each page checks its own platform permission (`platform.market.manage` edits and operates the catalogue,
 * `platform.market.review` approves, rejects and publishes; either one reads) and shows a no-access page naming the missing key.
 */
export const MARKET_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'market-catalogue',
    href: '/admin/marketplace',
    labelKey: `${NS}.catalogue`,
    groupKey: `${NS}.group`,
  },
  {
    id: 'market-categories',
    href: '/admin/marketplace/categories',
    labelKey: `${NS}.categories`,
    groupKey: `${NS}.group`,
  },
  {
    id: 'market-requests',
    href: '/admin/marketplace/requests',
    labelKey: `${NS}.requests`,
    groupKey: `${NS}.group`,
  },
  {
    id: 'market-usage',
    href: '/admin/marketplace/usage',
    labelKey: `${NS}.usage`,
    groupKey: `${NS}.group`,
  },
];
