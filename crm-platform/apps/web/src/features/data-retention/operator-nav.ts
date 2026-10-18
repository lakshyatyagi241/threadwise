/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'data-retention.nav';

/**
 * The retention dashboard, merged into the console menu by `auth-registration-security/platform/operator-nav.ts` (not named nav.ts:
 * the customer-menu generator imports every nav.ts).
 */
export const RETENTION_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'data-retention',
    href: '/admin/data-retention',
    labelKey: `${NS}.item`,
    groupKey: `${NS}.group`,
  },
];
