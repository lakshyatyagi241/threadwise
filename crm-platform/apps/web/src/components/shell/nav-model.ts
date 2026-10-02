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
