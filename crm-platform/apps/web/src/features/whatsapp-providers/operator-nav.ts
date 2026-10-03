/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'whatsapp-providers.nav';

/**
 * The WhatsApp provider registry's pages, merged into the console menu by
 * `auth-registration-security/platform/operator-nav.ts` (not named nav.ts: the customer-menu generator imports every nav.ts).
 * The Meta app and Interakt partner credentials are a different page, under Platform settings.
 */
export const WAP_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'wap-providers',
    href: '/admin/whatsapp-providers',
    labelKey: `${NS}.providers`,
    groupKey: `${NS}.group`,
  },
  {
    id: 'wap-assignments',
    href: '/admin/whatsapp-providers/assignments',
    labelKey: `${NS}.assignments`,
    groupKey: `${NS}.group`,
  },
  {
    id: 'wap-switch',
    href: '/admin/whatsapp-providers/switch',
    labelKey: `${NS}.switch`,
    groupKey: `${NS}.group`,
  },
];
