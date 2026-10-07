import {
  OPERATOR_NAV,
  type OperatorNavItem,
} from '@/features/auth-registration-security/platform/operator-nav';
import { CONSOLE_LAYOUT, type ConsoleHub } from './console-layout';

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
  /** The same idea with several words in priority order and a tone each (the Node bridge says "Not supported", then "No workspaces"). */
  statusBadges?: readonly StatusBadge[];
}

/** A hub: one rail entry that opens on its first page, whose other pages are the tab bar. */
export interface ConsoleGroup {
  id: string;
  /** Full next-intl key of the heading. */
  labelKey: string;
  /** Icon name for `ConsoleIcon`. A group without one (an unplaced heading) gets a dot. */
  icon?: string;
  /** `index` hubs (Settings) list their pages on a landing page instead of a tab bar. */
  kind?: ConsoleHub['kind'];
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
  // Built pages that had no menu entry (the wallet overview, and WaDesk's "Flow templates" admin page).
  {
    id: 'wallet-overview',
    href: '/admin/wallet',
    labelKey: `${NS}.labels.walletOverview`,
    groupKey: `${NS}.groups.shell`,
  },
  {
    id: 'flow-templates',
    href: '/admin/flow-templates',
    labelKey: `${NS}.labels.flowTemplates`,
    groupKey: `${NS}.groups.shell`,
  },
];

/**
 * Names that clashed across hubs, said once here so no other domain's message file is touched: "Add-ons" meant two different
 * things, "Analytics" meant a report and a tracking-code page, and two "settings" pages read alike.
 */
const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  'addon-packs': `${NS}.labels.addonPacks`,
  extensions: `${NS}.labels.extensions`,
  'settings-analytics': `${NS}.labels.trackingCode`,
  'plan-settings': `${NS}.labels.planPricingSettings`,
  'checkout-settings': `${NS}.labels.checkoutSettings`,
};

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

export interface StatusBadge {
  key: string;
  labelKey: string;
  tone: 'warning' | 'neutral';
}

/** Operator-nav items that carry a status word while a platform flag is set, first match wins. */
const STATUS_BADGES: Readonly<Record<string, readonly StatusBadge[]>> = {
  // Only the official WhatsApp Business API is supported: the Node bridge (personal numbers by QR) says so while the platform switch is
  // off. With the switch on but no workspace on the allow-list yet (off for everyone by default), it says nobody can use it yet.
  'node-bridge': [
    { key: 'unofficialOff', labelKey: `${NS}.badges.notSupported`, tone: 'warning' },
    { key: 'unofficialNoWorkspaces', labelKey: `${NS}.badges.noWorkspaces`, tone: 'neutral' },
  ],
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

/** The status badge a leaf shows right now, with its tone, or null. */
export function activeStatusBadgeInfo(
  leaf: Pick<ConsoleLeaf, 'statusBadges'>,
  counts: Readonly<Partial<Record<string, number>>>,
): { labelKey: string; tone: StatusBadge['tone'] } | null {
  const hit = leaf.statusBadges?.find((b) => (counts[b.key] ?? 0) > 0);
  return hit ? { labelKey: hit.labelKey, tone: hit.tone } : null;
}

export const sectionLabelKey = (id: string): string => `${NS}.sections.${id}`;

const toLeaf = (item: OperatorNavItem): ConsoleLeaf => {
  const badgeKey = BADGE_KEYS[item.id];
  const statusBadges = STATUS_BADGES[item.id];
  const first = statusBadges?.[0];
  const statusBadge = first ? { key: first.key, labelKey: first.labelKey } : undefined;
  return {
    id: item.id,
    href: item.href,
    labelKey: LABEL_OVERRIDES[item.id] ?? item.labelKey,
    ...(badgeKey ? { badgeKey } : {}),
    ...(statusBadge ? { statusBadge } : {}),
    ...(statusBadges ? { statusBadges } : {}),
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
 * The rail: the console's own Home leaf, then one hub per entry of `layout`, in order, each holding the pages it names (a hub with
 * no page present is left out). `visible` hides the pages an operator cannot open, so a hub with none left disappears. Domains
 * still add pages through the operator nav data; a page the layout does not place is appended under its own heading, so it can
 * never go missing from the menu.
 */
export function buildConsoleNav(
  items: readonly OperatorNavItem[],
  layout: readonly ConsoleHub[] = CONSOLE_LAYOUT,
  visible: (id: string) => boolean = () => true,
): ConsoleEntry[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const placed = new Set<string>();
  const entries: ConsoleEntry[] = [
    { id: 'overview', href: CONSOLE_HOME, labelKey: `${NS}.overview` },
  ];
  for (const hub of layout) {
    const children: ConsoleLeaf[] = [];
    for (const id of hub.tabs) {
      const item = byId.get(id);
      if (!item || placed.has(id)) continue;
      placed.add(id);
      if (visible(id)) children.push(toLeaf(item));
    }
    if (children.length > 0) {
      entries.push({
        id: hub.id,
        labelKey: sectionLabelKey(hub.id),
        icon: hub.icon,
        kind: hub.kind,
        children,
      });
    }
  }
  entries.push(...groupByHeading(items.filter((item) => !placed.has(item.id) && visible(item.id))));
  return entries;
}

/** A hub with no pages yet, for code that has to create one the rail lacks (module pages). */
export function emptySection(
  id: string,
  layout: readonly ConsoleHub[] = CONSOLE_LAYOUT,
): ConsoleGroup {
  const hub = layout.find((s) => s.id === id);
  return {
    id,
    labelKey: sectionLabelKey(id),
    ...(hub ? { icon: hub.icon, kind: hub.kind } : {}),
    children: [],
  };
}

/** Where a hub's rail entry goes: its first page the operator may open. */
export const hubHref = (hub: ConsoleGroup): string => hub.children[0]?.href ?? CONSOLE_HOME;

/** The hub holding a page, or null (Home, and pages outside the menu). */
export function hubOf(
  entries: readonly ConsoleEntry[],
  leafId: string | null,
): ConsoleGroup | null {
  if (!leafId) return null;
  for (const e of entries) if (isGroup(e) && e.children.some((c) => c.id === leafId)) return e;
  return null;
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
