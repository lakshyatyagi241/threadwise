import { GROUP_SPECS } from './fields';

/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'platform-settings-branding-storage.nav';

/** Camel-cased message key of a group's menu label (`site-info` -> `siteInfo`). */
const navKey = (slug: string) => slug.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/**
 * The settings hub and one entry per settings group, merged into the console menu by
 * `auth-registration-security/platform/operator-nav.ts` (not named nav.ts: the customer-menu generator imports every nav.ts).
 */
export const SET_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'settings-hub',
    href: '/admin/settings',
    labelKey: `${NS}.hub`,
    groupKey: `${NS}.groupHeading`,
  },
  ...GROUP_SPECS.map((s) => ({
    id: `settings-${s.slug}`,
    href: `/admin/settings/${s.slug}`,
    labelKey: `${NS}.${navKey(s.slug)}`,
    groupKey: `${NS}.groupHeading`,
  })),
];
