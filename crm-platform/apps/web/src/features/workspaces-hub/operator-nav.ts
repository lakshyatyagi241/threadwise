/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'workspaces-hub.nav';

/**
 * The one Workspaces page, merged into the console menu by `auth-registration-security/platform/operator-nav.ts` (not named nav.ts:
 * the customer-menu generator imports every nav.ts). It replaces the four separate lists the console used to have (workspace plans,
 * workspace wallets, support customers, provider assignments); their old addresses redirect here.
 */
export const WSHUB_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'workspaces',
    href: '/admin/workspaces',
    labelKey: `${NS}.workspaces`,
    groupKey: `${NS}.group`,
  },
];
