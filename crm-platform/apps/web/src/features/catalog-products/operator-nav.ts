/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

/**
 * WaDesk's `admin/settings/catalog` sits among the platform settings, so the entry joins that group. Merged into the console
 * menu by `auth-registration-security/platform/operator-nav.ts` (not named nav.ts: the customer-menu generator imports every nav.ts).
 */
export const CAT_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'settings-catalog',
    href: '/admin/settings/catalog',
    labelKey: 'catalogProducts.admin.nav',
    groupKey: 'platform-settings-branding-storage.nav.groupHeading',
  },
];
