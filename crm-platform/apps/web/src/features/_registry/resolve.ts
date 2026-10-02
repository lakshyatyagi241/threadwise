import { NAV_GROUPS, type Capabilities, type NavItem, type ResolvedNavItem } from './types';

export const CAPABILITIES_UNKNOWN: Capabilities = {
  permissions: null,
  planFeatures: null,
  channels: null,
};

/**
 * `/account/<name>`, one segment: a pane of the account hub (profile, plan, wallet, ...). A domain adds one by
 * declaring it in its own `nav.ts`; the hub lists it in its own menu, so the main sidebar leaves it out.
 */
export const HUB_PANE_HREF = /^\/account\/([a-z0-9][a-z0-9-]*)$/;

export const isHubPane = (item: Pick<NavItem, 'href'>): boolean => HUB_PANE_HREF.test(item.href);

/**
 * The main sidebar's items. The account hub's panes are reached from the hub (the sidebar keeps the single
 * "Account" entry), so they are left out here; use `resolveNavAll` where they are wanted.
 */
export function resolveNav(items: readonly NavItem[], caps: Capabilities): ResolvedNavItem[] {
  return resolveNavAll(
    items.filter((item) => !isHubPane(item)),
    caps,
  );
}

/**
 * Every entry, hub panes included (what the account hub builds its own menu from).
 *
 * WaDesk's rule: a missing permission or unavailable channel removes the item, a missing plan feature keeps it
 * visible but locked (so it can upsell). The server stays the authority; this only shapes the menu.
 */
export function resolveNavAll(items: readonly NavItem[], caps: Capabilities): ResolvedNavItem[] {
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
