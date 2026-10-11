/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'sms.operator.nav';

/**
 * The SMS platform switch page, merged into the console menu by `auth-registration-security/platform/operator-nav.ts` (not named
 * nav.ts: the customer-menu generator imports every nav.ts).
 */
export const SMS_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'sms-channel',
    href: '/admin/sms',
    labelKey: `${NS}.item`,
    groupKey: `${NS}.group`,
  },
];
