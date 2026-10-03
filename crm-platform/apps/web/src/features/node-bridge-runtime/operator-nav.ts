/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'node-bridge-runtime.nav';

/**
 * The Node bridge panel, merged into the console menu by `auth-registration-security/platform/operator-nav.ts` (not named
 * nav.ts: the customer-menu generator imports every nav.ts).
 */
export const NODE_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'node-bridge',
    href: '/admin/node-bridge',
    labelKey: `${NS}.item`,
    groupKey: `${NS}.group`,
  },
];
