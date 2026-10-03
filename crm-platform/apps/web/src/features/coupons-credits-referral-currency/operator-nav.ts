/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'coupons-credits-referral-currency.nav';

/**
 * Coupons and Credit packages in WaDesk's "Billing & plans" group, and Currencies next to Languages in Localization. Merged into
 * the console menu by `auth-registration-security/platform/operator-nav.ts` (not named nav.ts: the customer-menu generator
 * imports every nav.ts).
 *
 * WaDesk leaves Credit packages and Currencies out of its sidebar (reachable by address or a Settings tile); here they are menu
 * entries so the pages can be found. Recorded as an intended difference in the parity doc.
 */
export const CPN_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'coupons',
    href: '/admin/coupons',
    labelKey: `${NS}.coupons`,
    groupKey: `${NS}.group`,
  },
  {
    id: 'credit-packages',
    href: '/admin/credit-packages',
    labelKey: `${NS}.creditPackages`,
    groupKey: `${NS}.group`,
  },
  {
    id: 'currencies',
    href: '/admin/currencies',
    labelKey: `${NS}.currencies`,
    groupKey: 'localization-translation.nav.group',
  },
];
