/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'whatsapp-throughput.nav';

/**
 * WhatsApp send limits and live performance, merged into the console menu by `auth-registration-security/platform/operator-nav.ts`
 * (not named nav.ts: the customer-menu generator imports every nav.ts). The whole `platform/waba` API is super admin only.
 */
export const WAT_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'wa-throughput',
    href: '/admin/whatsapp-throughput',
    labelKey: `${NS}.item`,
    groupKey: `${NS}.group`,
  },
];
