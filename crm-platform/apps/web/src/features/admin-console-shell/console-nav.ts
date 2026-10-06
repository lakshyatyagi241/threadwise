import {
  OPERATOR_NAV,
  type OperatorNavItem,
} from '@/features/auth-registration-security/platform/operator-nav';
import { CONSOLE_LAYOUT, type ConsoleSection } from './console-layout';

/** One link in the console rail. `badgeKey` names a count the layout may supply; no count means no badge. */
export interface ConsoleLeaf {
  id: string;
  href: string;
  /** Full next-intl key. */
  labelKey: string;
  /** A literal label, for entries that come from data (a module's manifest) and have no message key. */
  label?: string;
  badgeKey?: string;
  /**
   * A word badge (not a count) for a page whose feature is switched off or unsupported: shown while the named flag in the layout's
   * counts is set (greater than zero). `labelKey` is the full next-intl key of the word.
   */
  statusBadge?: { key: string; labelKey: string };
  /** Full next-intl key of the small heading drawn above this link: it opens a block of related pages. */
  captionKey?: string;
}

/** A collapsible section of leaves. */
export interface ConsoleGroup {
  id: string;
  /** Full next-intl key of the heading. */
  labelKey: string;
  /** Icon name for `ConsoleIcon`. A group without one (an unplaced heading) gets a dot. */
  icon?: string;
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
  coupons: 'coupons',
  roles: 'roles',
  permissions: 'permissions',
  'cms-announcements': 'announcements',
  'cms-guidebook': 'guidebook',
};

/** Operator-nav items that carry a status word while a platform flag is set. */
const STATUS_BADGES: Readonly<Record<string, { key: string; labelKey: string }>> = {
  // Only the official WhatsApp Business API is supported: the Node bridge (personal numbers by QR) says so while the platform switch is off.
  'node-bridge': { key: 'unofficialOff', labelKey: `${NS}.badges.notSupported` },
};

/** The label key of the status badge a leaf shows right now, or null: the flag must be set in `counts`. */
export function activeStatusBadge(
  leaf: Pick<ConsoleLeaf, 'statusBadge'>,
  counts: Readonly<Partial<Record<string, number>>>,
): string | null {
  const badge = leaf.statusBadge;
  if (!badge) return null;
  return (counts[badge.key] ?? 0) > 0 ? badge.labelKey : null;
}

export const sectionLabelKey = (id: string): string => `${NS}.sections.${id}`;
export const captionLabelKey = (caption: string): string => `${NS}.captions.${caption}`;

const toLeaf = (item: OperatorNavItem, captionKey?: string): ConsoleLeaf => {
  const badgeKey = BADGE_KEYS[item.id];
  const statusBadge = STATUS_BADGES[item.id];
  return {
    id: item.id,
    href: item.href,
    labelKey: item.labelKey,
    ...(badgeKey ? { badgeKey } : {}),
    ...(statusBadge ? { statusBadge } : {}),
    ...(captionKey ? { captionKey } : {}),
  };
};

/** Items under the heading they name themselves, in first-seen order. This is how an unplaced page is still shown. */
export function groupByHeading(items: readonly OperatorNavItem[]): ConsoleGroup[] {
  const groups: ConsoleGroup[] = [];
  for (const item of items) {
    const group = groups.find((g) => g.id === item.groupKey);
    if (group) group.children.push(toLeaf(item));
    else groups.push({ id: item.groupKey, labelKey: item.groupKey, children: [toLeaf(item)] });
  }
  return groups;
}

/**
 * The rail: the console's own Overview leaf, then the sections of `layout` in order, each holding the
 * pages it names (a section with no page present is left out). Domains still add pages through the
 * operator nav data; a page the layout does not place is appended under its own heading, so it can
 * never go missing from the menu.
 */
export function buildConsoleNav(
  items: readonly OperatorNavItem[],
  layout: readonly ConsoleSection[] = CONSOLE_LAYOUT,
): ConsoleEntry[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const placed = new Set<string>();
  const entries: ConsoleEntry[] = [
    { id: 'overview', href: CONSOLE_HOME, labelKey: `${NS}.overview` },
  ];
  for (const section of layout) {
    const children: ConsoleLeaf[] = [];
    for (const block of section.blocks) {
      let captionKey = block.caption ? captionLabelKey(block.caption) : undefined;
      for (const id of block.items) {
        const item = byId.get(id);
        if (!item || placed.has(id)) continue;
        placed.add(id);
        children.push(toLeaf(item, captionKey));
        captionKey = undefined;
      }
    }
    if (children.length > 0) {
      entries.push({
        id: section.id,
        labelKey: sectionLabelKey(section.id),
        icon: section.icon,
        children,
      });
    }
  }
  entries.push(...groupByHeading(items.filter((item) => !placed.has(item.id))));
  return entries;
}

/** A section with no pages yet, for code that has to create one the rail lacks (module pages). */
export function emptySection(
  id: string,
  layout: readonly ConsoleSection[] = CONSOLE_LAYOUT,
): ConsoleGroup {
  const icon = layout.find((s) => s.id === id)?.icon;
  return { id, labelKey: sectionLabelKey(id), ...(icon ? { icon } : {}), children: [] };
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
 * `999`, `1.2k`, `13k`, `1.2M`, `12M`. Matches WaDesk's rule (one decimal below ten
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
