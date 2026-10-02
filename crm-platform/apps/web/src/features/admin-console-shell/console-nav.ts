import {
  OPERATOR_NAV,
  type OperatorNavItem,
} from '@/features/auth-registration-security/platform/operator-nav';

/** One link in the console rail. `badgeKey` names a count the layout may supply; no count means no badge. */
export interface ConsoleLeaf {
  id: string;
  href: string;
  /** Full next-intl key. */
  labelKey: string;
  /** A literal label, for entries that come from data (a module's manifest) and have no message key. */
  label?: string;
  badgeKey?: string;
}

/** A collapsible block of leaves. */
export interface ConsoleGroup {
  id: string;
  /** Full next-intl key of the heading. */
  labelKey: string;
  children: ConsoleLeaf[];
}

export type ConsoleEntry = ConsoleLeaf | ConsoleGroup;

export const isGroup = (e: ConsoleEntry): e is ConsoleGroup => 'children' in e;

const NS = 'admin-console-shell.nav';

export const CONSOLE_HOME = '/admin';

/** This domain's own pages, merged after the other domains' entries (their nav data stays untouched). */
const ASHELL_ITEMS: readonly OperatorNavItem[] = [
  {
    id: 'menu-order',
    href: '/admin/settings/menu-order',
    labelKey: `${NS}.menuOrder`,
    groupKey: `${NS}.groups.shell`,
  },
];

/** Everything the rail lists. */
export const CONSOLE_NAV_ITEMS: readonly OperatorNavItem[] = [...OPERATOR_NAV, ...ASHELL_ITEMS];

/** Which operator-nav items carry a live count, and under which count name. */
const BADGE_KEYS: Readonly<Record<string, string>> = {
  plans: 'plans',
  roles: 'roles',
  permissions: 'permissions',
};

/**
 * The rail: the console's own Overview leaf, then one group per heading the other
 * domains contribute. Domains add pages through the operator nav data, so this file
 * never lists another domain's screens by hand.
 */
export function buildConsoleNav(items: readonly OperatorNavItem[]): ConsoleEntry[] {
  const entries: ConsoleEntry[] = [
    { id: 'overview', href: CONSOLE_HOME, labelKey: `${NS}.overview` },
  ];
  for (const item of items) {
    const badgeKey = BADGE_KEYS[item.id];
    const leaf: ConsoleLeaf = {
      id: item.id,
      href: item.href,
      labelKey: item.labelKey,
      ...(badgeKey ? { badgeKey } : {}),
    };
    const group = entries.find((e): e is ConsoleGroup => isGroup(e) && e.id === item.groupKey);
    if (group) group.children.push(leaf);
    else entries.push({ id: item.groupKey, labelKey: item.groupKey, children: [leaf] });
  }
  return entries;
}

/** Every leaf, in rail order. */
export function leaves(entries: readonly ConsoleEntry[]): ConsoleLeaf[] {
  return entries.flatMap((e) => (isGroup(e) ? e.children : [e]));
}

/**
 * The leaf whose href is the longest prefix of the path, so `/admin/security/events`
 * does not also light up `/admin/security`. `/admin` itself only matches exactly:
 * as a prefix it would claim every console page.
 */
export function activeLeafId(pathname: string, entries: readonly ConsoleEntry[]): string | null {
  let best: ConsoleLeaf | null = null;
  for (const leaf of leaves(entries)) {
    const hit =
      pathname === leaf.href ||
      (leaf.href !== CONSOLE_HOME && pathname.startsWith(`${leaf.href}/`));
    if (hit && (!best || leaf.href.length > best.href.length)) best = leaf;
  }
  return best?.id ?? null;
}

/** The group holding the active leaf is the only one open on first paint. */
export function initiallyOpenGroups(
  entries: readonly ConsoleEntry[],
  activeId: string | null,
): Set<string> {
  const open = new Set<string>();
  for (const e of entries) {
    if (isGroup(e) && e.children.some((c) => c.id === activeId)) open.add(e.id);
  }
  return open;
}

const fixed = (value: number, maxDecimals: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals });

/**
 * The badge text for a count: nothing for zero or an unknown count, then
 * `999`, `1.2k`, `13k`, `1.2M`, `12M`. Matches Reference's rule (one decimal below ten
 * thousand, none from there), so 12,500 reads `13k`, not `12.5k`.
 */
export function formatCount(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  const whole = Math.trunc(n);
  // 999,500 and up already rounds to "1000k"; promote it to "1M" so no comma ever shows.
  if (whole >= 999_500) return `${fixed(whole / 1_000_000, whole >= 10_000_000 ? 0 : 1)}M`;
  if (whole >= 1000) return `${fixed(whole / 1000, whole >= 10_000 ? 0 : 1)}k`;
  return String(whole);
}
