/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'lead-scoring-admin.nav';

/**
 * The platform AI lead scoring page. Merged into the console menu by `auth-registration-security/platform/operator-nav.ts`
 * (not named nav.ts: the customer-menu generator imports every nav.ts).
 */
export const LSC_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'lead-scoring',
    href: '/admin/lead-scoring',
    labelKey: `${NS}.scoring`,
    groupKey: `${NS}.group`,
  },
];
