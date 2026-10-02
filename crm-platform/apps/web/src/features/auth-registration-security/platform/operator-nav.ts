/**
 * The console menu. Kept as plain data so the admin-console domain can merge
 * its own entries into the same list without touching the shell component.
 */
export interface OperatorNavItem {
  id: string;
  href: string;
  /** Full next-intl key, resolved by the shell. */
  labelKey: string;
  /** Full next-intl key of the group heading. Items of one group sit together. */
  groupKey: string;
}

import { SET_OPERATOR_NAV } from '../../platform-settings-branding-storage/operator-nav';

const NS = 'auth-registration-security.platform.nav';

export const OPERATOR_NAV: readonly OperatorNavItem[] = [
  {
    id: 'security',
    href: '/admin/security',
    labelKey: `${NS}.securityCenter`,
    groupKey: `${NS}.groups.security`,
  },
  {
    id: 'security-events',
    href: '/admin/security/events',
    labelKey: `${NS}.securityEvents`,
    groupKey: `${NS}.groups.security`,
  },
  {
    id: 'registration',
    href: '/admin/settings/registration',
    labelKey: `${NS}.registration`,
    groupKey: `${NS}.groups.guestPages`,
  },
  {
    id: 'social-login',
    href: '/admin/settings/social-login',
    labelKey: `${NS}.socialLogin`,
    groupKey: `${NS}.groups.guestPages`,
  },
  {
    id: 'auth-pages',
    href: '/admin/settings/auth-pages',
    labelKey: `${NS}.authPages`,
    groupKey: `${NS}.groups.guestPages`,
  },
  {
    id: 'plans',
    href: '/admin/plans',
    labelKey: `${NS}.plans`,
    groupKey: `${NS}.groups.plans`,
  },
  // platform settings, branding and storage (SET domain)
  ...SET_OPERATOR_NAV,
  {
    id: 'i18n-languages',
    href: '/admin/i18n/languages',
    labelKey: 'localization-translation.nav.languages',
    groupKey: 'localization-translation.nav.group',
  },
  {
    id: 'i18n-providers',
    href: '/admin/i18n/providers',
    labelKey: 'localization-translation.nav.providers',
    groupKey: 'localization-translation.nav.group',
  },
  {
    id: 'i18n-usage',
    href: '/admin/i18n/usage',
    labelKey: 'localization-translation.nav.usage',
    groupKey: 'localization-translation.nav.group',
  },
];

/** The page a signed-in operator lands on and the brand link points to. */
export const OPERATOR_HOME = '/admin/security';

/** Where the account (MFA) page lives; the only page a super admin without MFA may open. */
export const OPERATOR_ACCOUNT_PATH = '/admin/account/security';

/** The item whose href is the longest prefix of the path, so `/admin/security/events` does not light up `/admin/security`. */
export function activeNavId(pathname: string, items: readonly OperatorNavItem[]): string | null {
  let best: OperatorNavItem | null = null;
  for (const item of items) {
    const hit = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.id ?? null;
}

/** Items grouped in first-seen order. */
export function groupNav(
  items: readonly OperatorNavItem[],
): Array<{ groupKey: string; items: OperatorNavItem[] }> {
  const groups: Array<{ groupKey: string; items: OperatorNavItem[] }> = [];
  for (const item of items) {
    const g = groups.find((x) => x.groupKey === item.groupKey);
    if (g) g.items.push(item);
    else groups.push({ groupKey: item.groupKey, items: [item] });
  }
  return groups;
}
