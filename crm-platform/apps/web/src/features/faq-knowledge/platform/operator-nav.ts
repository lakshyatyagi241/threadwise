/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'faq-knowledge-admin.nav';

/**
 * The platform FAQ engine page. Merged into the console menu by `auth-registration-security/platform/operator-nav.ts`
 * (not named nav.ts: the customer-menu generator imports every nav.ts).
 */
export const FAQ_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  { id: 'faq-engine', href: '/admin/faq', labelKey: `${NS}.engine`, groupKey: `${NS}.group` },
];
