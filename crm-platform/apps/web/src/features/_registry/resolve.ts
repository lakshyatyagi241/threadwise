import { NAV_GROUPS, type Capabilities, type NavItem, type ResolvedNavItem } from './types';

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

/** Drops the planned entries a domain has taken over (same id, or same href). */
export function mergePlanned(
  items: readonly NavItem[],
  planned: readonly NavItem[],
): Array<{ item: NavItem; comingSoon: boolean }> {
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
 * WaDesk's rule: a missing permission or unavailable channel removes the item, a missing plan feature keeps it
 * visible but locked (so it can upsell). The server stays the authority; this only shapes the menu.
 * Planned (not yet built) screens go through the same gates, then come out marked `comingSoon`.
 */
export function resolveNav(
  items: readonly NavItem[],
  caps: Capabilities,
  options: ResolveOptions = {},
): ResolvedNavItem[] {
  const out: ResolvedNavItem[] = [];
  for (const { item, comingSoon } of mergePlanned(items, options.planned ?? [])) {
    const g = item.gates ?? {};
    if (g.permission && caps.permissions && !caps.permissions.has(g.permission)) continue;
    if (g.channel && caps.channels && !caps.channels.has(g.channel)) continue;
    const locked =
      !comingSoon &&
      Boolean(g.planFeature && caps.planFeatures && !caps.planFeatures.has(g.planFeature));
    out.push({ ...item, locked, comingSoon });
  }
  return out.sort(compareNav);
}
