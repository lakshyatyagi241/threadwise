import type { NavLayoutKey } from '@crm/contracts';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { matchesHref } from './nav-model';

/**
 * Where each catalogue key of the top bar lives in this app (TW-ASHELL-013). The catalogue is Reference's; a key points at a menu
 * entry (`nav`) or a Settings tile (`tile`) by id. A key with no target yet is simply not drawn, never a dead link: the
 * team switches one on by building the screen and declaring it, as for the menu.
 */
export const BAR_TARGETS: Partial<Record<NavLayoutKey, { nav?: string; tile?: string }>> = {
  dashboard: { nav: 'dashboard' },
  'team-inbox': { nav: 'inbox' },
  'wa-campaigns': { nav: 'campaigns' },
  flows: { nav: 'flows' },
  templates: { nav: 'templates' },
  devices: { tile: 'whatsapp' },
  broadcasts: { nav: 'broadcasts' },
  contacts: { nav: 'contacts' },
  deals: { nav: 'deals' },
  chat: { nav: 'quick-chat' },
  analytics: { nav: 'analytics' },
  scheduled: { nav: 'scheduled' },
  'message-history': { nav: 'history' },
  'ai-assistants': { nav: 'ai-assistants' },
  'ai-training': { tile: 'ai-training' },
  'chatbot-widgets': { tile: 'chat-widget' },
  'call-logs': { nav: 'call-logs' },
  support: { nav: 'support' },
};

export const MORE_HREF = '/more';

export interface BarItem {
  key: NavLayoutKey;
  href: string;
  /** Full message key of the label (a menu entry's or a tile's own). `more` has none: the bar draws its own word. */
  labelKey: string | null;
  icon?: string;
  /** The plan lacks the feature: a crown shows, the link still works (TW-ASHELL-027). */
  locked: boolean;
}

/**
 * The top bar for this person: the saved keys in the saved order, each resolved to a real, reachable screen the person's
 * permissions allow (a screen they cannot open was already dropped from `nav` and `tiles`), with `more` last. Reference
 * hid every item from an agent because of a tier bug; here a person's menu is whatever they may open.
 */
export function resolveTopBar(
  bar: readonly NavLayoutKey[],
  nav: readonly ResolvedNavItem[],
  tiles: readonly ResolvedSettingsTile[],
): BarItem[] {
  const out: BarItem[] = [];
  for (const key of bar) {
    if (key === 'more') continue;
    const target = BAR_TARGETS[key];
    if (!target) continue;
    const entry = target.nav
      ? nav.find((n) => n.id === target.nav && !n.comingSoon)
      : tiles.find((t) => t.id === target.tile && !t.comingSoon);
    if (!entry) continue;
    out.push({
      key,
      href: entry.href,
      labelKey: entry.labelKey,
      icon: entry.icon,
      locked: entry.locked,
    });
  }
  out.push({ key: 'more', href: MORE_HREF, labelKey: null, icon: 'grid', locked: false });
  return out;
}

/** The bar's active entry: the longest address that matches the path; the More page and the hubs under it count as More. */
export function activeBarKey(
  items: readonly BarItem[],
  pathname: string,
): NavLayoutKey | undefined {
  let best: BarItem | undefined;
  for (const item of items) {
    if (!matchesHref(pathname, item.href)) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best?.key;
}

/**
 * Entries the saved bar demoted that Reference still shows as cards in the More page's "Navigation" strip (TW-ASHELL-020):
 * Dashboard, Campaigns, Flows and Templates. They appear only when the bar does not contain them.
 */
export const DEMOTABLE_KEYS: readonly NavLayoutKey[] = [
  'dashboard',
  'wa-campaigns',
  'flows',
  'templates',
];

export function demotedBarItems(
  bar: readonly NavLayoutKey[],
  nav: readonly ResolvedNavItem[],
  tiles: readonly ResolvedSettingsTile[],
): BarItem[] {
  const all = resolveTopBar([...DEMOTABLE_KEYS], nav, tiles).filter((i) => i.key !== 'more');
  return all.filter((i) => !bar.includes(i.key));
}
