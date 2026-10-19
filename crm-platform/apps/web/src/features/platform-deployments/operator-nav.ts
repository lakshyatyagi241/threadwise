/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'platform-deployments.nav';

/**
 * Flow publishes to the Geta console and their state, merged into the console menu by `auth-registration-security/platform/operator-nav.ts`
 * (not named nav.ts: the customer-menu generator imports every nav.ts). Sits in the System hub with the Updater.
 */
export const DEP_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'deployments',
    href: '/admin/deployments',
    labelKey: `${NS}.item`,
    groupKey: 'install-update-licensing.system.nav.group',
  },
];
