import { NAV_GROUPS, type Capabilities, type NavItem, type ResolvedNavItem } from './types';

export const CAPABILITIES_UNKNOWN: Capabilities = {
  permissions: null,
  planFeatures: null,
  channels: null,
};

/**
 * Reference's rule: a missing permission or unavailable channel removes the item, a missing plan feature keeps it
 * visible but locked (so it can upsell). The server stays the authority; this only shapes the menu.
 */
export function resolveNav(items: readonly NavItem[], caps: Capabilities): ResolvedNavItem[] {
  const out: ResolvedNavItem[] = [];
  for (const item of items) {
    const g = item.gates ?? {};
    if (g.permission && caps.permissions && !caps.permissions.has(g.permission)) continue;
    if (g.channel && caps.channels && !caps.channels.has(g.channel)) continue;
    const locked = Boolean(
      g.planFeature && caps.planFeatures && !caps.planFeatures.has(g.planFeature),
    );
    out.push({ ...item, locked });
  }
  return out.sort(
    (a, b) =>
      NAV_GROUPS.indexOf(a.group) - NAV_GROUPS.indexOf(b.group) ||
      (a.order ?? 100) - (b.order ?? 100) ||
      a.id.localeCompare(b.id),
  );
}
