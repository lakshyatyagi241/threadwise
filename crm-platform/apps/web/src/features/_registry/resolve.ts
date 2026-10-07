import {
  NAV_GROUPS,
  type Capabilities,
  type NavGates,
  type NavItem,
  type ResolvedNavItem,
} from './types';

export const CAPABILITIES_UNKNOWN: Capabilities = {
  permissions: null,
  planFeatures: null,
  channels: null,
};

export interface ResolveOptions {
  /**
   * Screens that are not built yet (`planned.ts`). They appear as disabled "coming soon" entries, except where a
   * domain already declares the same id or the same address: the real item wins, so a domain switches its screen on
   * just by declaring it.
   */
  planned?: readonly NavItem[];
}

/** Drops the planned entries a domain has taken over (same id, or same href). Serves the menu and the Settings tiles alike. */
export function mergePlanned<T extends { id: string; href: string }>(
  items: readonly T[],
  planned: readonly T[],
): Array<{ item: T; comingSoon: boolean }> {
  const ids = new Set(items.map((i) => i.id));
  const hrefs = new Set(items.map((i) => i.href));
  return [
    ...items.map((item) => ({ item, comingSoon: false })),
    ...planned
      .filter((p) => !ids.has(p.id) && !hrefs.has(p.href))
      .map((item) => ({ item, comingSoon: true })),
  ];
}

/** Group, then `order`, then id: the one sort the menu uses. */
export function compareNav(a: NavItem, b: NavItem): number {
  return (
    NAV_GROUPS.indexOf(a.group) - NAV_GROUPS.indexOf(b.group) ||
    (a.order ?? 100) - (b.order ?? 100) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * WaDesk's rule: a missing permission or unavailable channel removes the entry, a missing plan feature keeps it
 * visible but locked (so it can upsell). Our addition: a Marketplace app the workspace does not own (`gates.app`) removes
 * the entry too, with no upsell mark. Returns `null` when the entry is removed, else whether it is locked. A planned
 * (not built) entry is never locked. Shared by the menu, the Settings tiles and the Help center.
 */
export function evaluateGates(
  gates: NavGates | undefined,
  caps: Capabilities,
  comingSoon = false,
): { locked: boolean } | null {
  const g = gates ?? {};
  if (g.permission && caps.permissions && !caps.permissions.has(g.permission)) return null;
  if (g.channel && caps.channels && !caps.channels.has(g.channel)) return null;
  if (g.app && caps.planFeatures && !caps.planFeatures.has(g.app)) return null;
  const locked =
    !comingSoon &&
    Boolean(g.planFeature && caps.planFeatures && !caps.planFeatures.has(g.planFeature));
  return { locked };
}

/**
 * `/account/<name>`, one segment: a pane of the account hub (profile, plan, wallet, ...). A domain adds one by
 * declaring it in its own `nav.ts`; the hub lists it in its own menu, so the main sidebar leaves it out.
 */
export const HUB_PANE_HREF = /^\/account\/([a-z0-9][a-z0-9-]*)$/;

export const isHubPane = (item: Pick<NavItem, 'href'>): boolean => HUB_PANE_HREF.test(item.href);

/**
 * Applies the gates to every entry, hub panes included. The server stays the authority; this only shapes the menu.
 * Planned (not yet built) screens go through the same gates, then come out marked `comingSoon`.
 */
export function resolveNavAll(
  items: readonly NavItem[],
  caps: Capabilities,
  options: ResolveOptions = {},
): ResolvedNavItem[] {
  const out: ResolvedNavItem[] = [];
  for (const { item, comingSoon } of mergePlanned(items, options.planned ?? [])) {
    const gate = evaluateGates(item.gates, caps, comingSoon);
    if (gate) out.push({ ...item, locked: gate.locked, comingSoon });
  }
  return out.sort(compareNav);
}

/**
 * The main sidebar's items. The account hub's panes are reached from the hub (the sidebar keeps the single
 * "Account" entry), so they are left out here; use `resolveNavAll` where they are wanted.
 */
export function resolveNav(
  items: readonly NavItem[],
  caps: Capabilities,
  options: ResolveOptions = {},
): ResolvedNavItem[] {
  return resolveNavAll(
    items.filter((item) => !isHubPane(item)),
    caps,
    options,
  );
}
