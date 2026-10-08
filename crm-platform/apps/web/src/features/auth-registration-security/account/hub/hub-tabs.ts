import { HUB_PANE_HREF } from '@/features/_registry/resolve';
import type { NavItem, ResolvedNavItem } from '@/features/_registry/types';

/**
 * The account hub's panes (TW-AUTH-024) as data, so the menu, the breadcrumb,
 * the page header and the `?tab=` deep links all read one list.
 *
 * A pane lives in one of two places:
 *
 *  - this domain's own (`OWN_TABS`): profile, password and security,
 *    delete, plus the plan pane that the plan domain fills in;
 *  - another domain's, declared in THAT domain's `nav.ts` and nowhere here: an
 *    entry whose `href` is `/account/<name>` becomes a menu item of the hub
 *    (`tabsFromNav`). The entry's `order` places it: below 100 it joins the
 *    "Account" group (Reference puts Plan, Orders, Wallet, Add-ons, Affiliate,
 *    Support and Translation there), 100 or more joins "Security". Own panes sit
 *    at 0 (profile), 10 (plan), 100 (password and security) and
 *    110 (delete), so a new pane picks a number between them.
 *
 * The page itself is a normal route (`app/(app)/(<domain>)/account/<name>/page.tsx`)
 * that wraps its content in `AccountFrame` (exported from `../../shared/account-hub`),
 * which draws the same rail around it.
 */

export type HubGroup = 'account' | 'security';
export const HUB_GROUPS: readonly HubGroup[] = ['account', 'security'];

export type HubIcon = 'user' | 'plan' | 'key' | 'trash' | 'generic';

export interface HubTab {
  /** Stable id; the `?tab=` value. */
  id: string;
  href: string;
  group: HubGroup;
  order: number;
  /** Absolute next-intl key of the menu label and breadcrumb. */
  labelKey: string;
  /**
   * Page title and description keys. Only the panes this domain draws set them;
   * another domain's pane renders its own heading inside the frame.
   */
  titleKey?: string;
  descriptionKey?: string;
  icon: HubIcon;
  danger?: boolean;
  /** Plan-gated panes stay in the menu with a lock badge. */
  locked?: boolean;
  /** Other `?tab=` names that land here (Reference called the password pane `password`). */
  aliases: readonly string[];
}

const HUB = 'auth-registration-security.account.hub';

export const OWN_TABS: readonly HubTab[] = [
  {
    id: 'profile',
    href: '/account/profile',
    group: 'account',
    order: 0,
    labelKey: `${HUB}.tabs.profile`,
    titleKey: `${HUB}.pages.profile.title`,
    descriptionKey: `${HUB}.pages.profile.description`,
    icon: 'user',
    aliases: [],
  },
  {
    // Drawn by the plan domain (a placeholder until billing lands); the rail only links to it.
    id: 'plan',
    href: '/account/plans',
    group: 'account',
    order: 10,
    labelKey: `${HUB}.tabs.plan`,
    icon: 'plan',
    aliases: ['plans'],
  },
  {
    id: 'security',
    href: '/account/security',
    group: 'security',
    order: 100,
    labelKey: `${HUB}.tabs.security`,
    titleKey: `${HUB}.pages.security.title`,
    descriptionKey: `${HUB}.pages.security.description`,
    icon: 'key',
    aliases: ['password'],
  },
  {
    id: 'delete',
    href: '/account/delete',
    group: 'security',
    order: 110,
    labelKey: `${HUB}.tabs.delete`,
    titleKey: `${HUB}.pages.delete.title`,
    descriptionKey: `${HUB}.pages.delete.description`,
    icon: 'trash',
    danger: true,
    aliases: [],
  },
];

/** Order from which a pane joins the "Security" group instead of "Account". */
export const SECURITY_GROUP_FROM = 100;

/** The panes other domains declared in their `nav.ts`, in hub form. Own panes win on a clash. */
export function tabsFromNav(items: ReadonlyArray<NavItem | ResolvedNavItem>): HubTab[] {
  const taken = new Set(OWN_TABS.flatMap((t) => [t.id, t.href, ...t.aliases]));
  const out: HubTab[] = [];
  for (const item of items) {
    const match = HUB_PANE_HREF.exec(item.href);
    if (!match) continue;
    if (taken.has(item.href) || taken.has(item.id)) continue;
    taken.add(item.href);
    taken.add(item.id);
    const order = item.order ?? 50;
    out.push({
      id: item.id,
      href: item.href,
      group: order >= SECURITY_GROUP_FROM ? 'security' : 'account',
      order,
      labelKey: item.labelKey,
      icon: 'generic',
      locked: 'locked' in item ? item.locked : false,
      aliases: [match[1] as string],
    });
  }
  return out;
}

/** Every pane in menu order: group, then `order`, then id. */
export function buildHubTabs(extra: readonly HubTab[]): HubTab[] {
  return [...OWN_TABS, ...extra].sort(
    (a, b) =>
      HUB_GROUPS.indexOf(a.group) - HUB_GROUPS.indexOf(b.group) ||
      a.order - b.order ||
      a.id.localeCompare(b.id),
  );
}

/** The pane whose route `pathname` is on (the longest matching `href` wins). */
export function currentTab(pathname: string, tabs: readonly HubTab[]): HubTab | undefined {
  let best: HubTab | undefined;
  for (const tab of tabs) {
    if (pathname !== tab.href && !pathname.startsWith(`${tab.href}/`)) continue;
    if (!best || tab.href.length > best.href.length) best = tab;
  }
  return best;
}

/**
 * Where a `?tab=<name>` deep link goes (Reference's account page is one page with
 * `?tab=`). Names are matched case-insensitively against pane ids and aliases;
 * anything unknown, missing or repeated falls back to the profile, as Reference does.
 */
export function resolveTabParam(
  raw: string | readonly string[] | null | undefined,
  tabs: readonly HubTab[],
): HubTab {
  const fallback = tabs.find((t) => t.id === 'profile') ?? (OWN_TABS[0] as HubTab);
  const value = typeof raw === 'string' ? raw : raw?.[0];
  if (typeof value !== 'string') return fallback;
  const name = value.trim().toLowerCase();
  if (!name) return fallback;
  return tabs.find((t) => t.id.toLowerCase() === name || t.aliases.includes(name)) ?? fallback;
}

/**
 * `?tab=` names of panes that moved out of the account hub, with the page they live on now
 * (Branding is the "Message footer" Settings page).
 */
export const MOVED_TABS: Readonly<Record<string, string>> = {
  branding: '/settings/message-footer',
};

/** The URL `/account?...` redirects to: the pane's route plus every other query parameter. */
export function tabRedirect(
  params: Record<string, string | readonly string[] | undefined>,
  tabs: readonly HubTab[],
): string {
  const raw = typeof params.tab === 'string' ? params.tab : params.tab?.[0];
  const moved = typeof raw === 'string' ? MOVED_TABS[raw.trim().toLowerCase()] : undefined;
  const target = moved ? { href: moved } : resolveTabParam(params.tab, tabs);
  const rest = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'tab' || value === undefined) continue;
    for (const v of typeof value === 'string' ? [value] : value) rest.append(key, v);
  }
  const qs = rest.toString();
  return qs ? `${target.href}?${qs}` : target.href;
}
