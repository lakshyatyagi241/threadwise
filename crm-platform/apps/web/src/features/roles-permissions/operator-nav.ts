/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'roles-permissions.nav';

/**
 * Roles, Permissions and Staff roles, merged into the console menu by
 * `auth-registration-security/platform/operator-nav.ts` (not named nav.ts: the customer-menu generator imports every nav.ts).
 */
export const ROLES_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  { id: 'roles', href: '/admin/roles', labelKey: `${NS}.roles`, groupKey: `${NS}.group` },
  {
    id: 'permissions',
    href: '/admin/permissions',
    labelKey: `${NS}.permissions`,
    groupKey: `${NS}.group`,
  },
  {
    id: 'staff-roles',
    href: '/admin/roles/staff',
    labelKey: `${NS}.staff`,
    groupKey: `${NS}.group`,
  },
];
