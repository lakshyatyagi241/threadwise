/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'dpdp-register-admin.nav';

/**
 * The platform DPDP register page. Merged into the console menu by `auth-registration-security/platform/operator-nav.ts`
 * (not named nav.ts: the customer-menu generator imports every nav.ts).
 */
export const DPDP_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'dpdp-register',
    href: '/admin/dpdp-register',
    labelKey: `${NS}.register`,
    groupKey: `${NS}.group`,
  },
];
