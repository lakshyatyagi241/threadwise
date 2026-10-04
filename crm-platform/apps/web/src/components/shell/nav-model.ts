import { tileForPath } from '@/features/_registry/settings-resolve';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { NavGroup, ResolvedNavItem } from '@/features/_registry/types';

export interface NavSection {
  group: NavGroup;
  items: ResolvedNavItem[];
}

/** Consecutive items of the same group become one section. The input is already sorted by `resolveNav`. */
export function toSections(items: readonly ResolvedNavItem[]): NavSection[] {
  const out: NavSection[] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (last && last.group === item.group) last.items.push(item);
    else out.push({ group: item.group, items: [item] });
  }
  return out;
}

/** The icon rail lists only screens that exist; coming-soon entries live in the labelled panel. */
export function railSections(sections: readonly NavSection[]): NavSection[] {
  return sections
    .map((s) => ({ group: s.group, items: s.items.filter((i) => !i.comingSoon) }))
    .filter((s) => s.items.length > 0);
}

/** `/contacts` matches `/contacts` and `/contacts/42`, never `/contacts-archive`. */
export function matchesHref(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The one active entry: the longest matching address among real screens (so `/account/security` is Account). */
export function activeItemId(
  items: readonly ResolvedNavItem[],
  pathname: string,
): string | undefined {
  let best: ResolvedNavItem | undefined;
  for (const item of items) {
    if (item.comingSoon || !matchesHref(pathname, item.href)) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best?.id;
}

/** The id of the shell's own Settings entry (declared in `features/settings-hub/nav.ts`). */
export const SETTINGS_NAV_ID = 'settings';

/** Menu groups that are not drawn in the rail or the panel: the Help links live in the user menu. */
export const USER_MENU_GROUPS: readonly NavGroup[] = ['help'];

/** The entries drawn in the rail, the panel and the drawer. */
export function menuItems(items: readonly ResolvedNavItem[]): ResolvedNavItem[] {
  return items.filter((i) => !USER_MENU_GROUPS.includes(i.group));
}

/** The entries of the user menu's Help block (Support, Guidebook). */
export function helpItems(items: readonly ResolvedNavItem[]): ResolvedNavItem[] {
  return items.filter((i) => USER_MENU_GROUPS.includes(i.group));
}

/**
 * The entry to highlight, counting Settings tiles as part of Settings: a screen a tile points at (Tax rates, Contact stages...)
 * is no longer in the menu, so it lights up Settings. The longest matching address wins across both lists, so
 * `/appointments/types` (a tile) beats `/appointments` (a menu entry); on a tie the menu entry wins.
 */
export function activeNavId(
  items: readonly ResolvedNavItem[],
  tiles: readonly ResolvedSettingsTile[],
  pathname: string,
): string | undefined {
  const entry = activeItemId(items, pathname);
  const tile = tileForPath(tiles, pathname);
  if (!tile) return entry;
  const entryHref = items.find((i) => i.id === entry)?.href;
  if (entry && entryHref && entryHref.length >= tile.href.length) return entry;
  return items.some((i) => i.id === SETTINGS_NAV_ID) ? SETTINGS_NAV_ID : entry;
}

/** Whether the screen at `pathname` asked for the full width (`fullWidth` on its menu entry), so the menu should slim down. */
export function isFullWidthScreen(
  items: readonly ResolvedNavItem[],
  tiles: readonly ResolvedSettingsTile[],
  pathname: string,
): boolean {
  const id = activeNavId(items, tiles, pathname);
  return id !== undefined && items.some((i) => i.id === id && i.fullWidth === true);
}
