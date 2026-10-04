import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { NavGroup, ResolvedNavItem } from '@/features/_registry/types';

/** The More page's tool grid (TW-ASHELL-020): every reachable screen that is not already in the top bar. */
export interface ToolCard {
  id: string;
  /** Full message key. */
  labelKey: string;
  descriptionKey?: string;
  href: string;
  icon?: string;
  locked: boolean;
  category: ToolCategory;
  /** Set for Reference's curated cards (see more-catalogue.ts); a registry screen without one is drawn as a plain card. */
  catalogueId?: string;
  tone?: Tone;
  badge?: boolean;
}

/** The tint of a card's icon tile (Reference drew each tool in its own colour). */
export type Tone =
  | 'mint'
  | 'blue'
  | 'insta'
  | 'line'
  | 'wechat'
  | 'viber'
  | 'dark'
  | 'teal'
  | 'amber'
  | 'amber2'
  | 'violet'
  | 'sky'
  | 'bubble'
  | 'neutral'
  | 'green'
  | 'google';

export interface CatalogueCard {
  id: string;
  /** This app's screens for the tool, tried in order. */
  hrefs: readonly string[];
  cat: ToolCategory;
  tone: Tone;
  icon: string;
  badge: boolean;
}

export const TOOL_CATEGORIES = ['all', 'automation', 'data', 'help'] as const;
export type ToolCategory = Exclude<(typeof TOOL_CATEGORIES)[number], 'all'> | 'other';

/** Reference derived the tab from the first URL segment through a static map; here it follows the menu group. */
const GROUP_CATEGORY: Partial<Record<NavGroup, ToolCategory>> = {
  automation: 'automation',
  campaigns: 'automation',
  audience: 'data',
  overview: 'data',
  sales: 'data',
  help: 'help',
};

export function toolCards(
  nav: readonly ResolvedNavItem[],
  tiles: readonly ResolvedSettingsTile[],
  barHrefs: ReadonlySet<string>,
): ToolCard[] {
  const seen = new Set<string>(barHrefs);
  const cards: ToolCard[] = [];
  const add = (c: ToolCard) => {
    if (seen.has(c.href)) return;
    seen.add(c.href);
    cards.push(c);
  };
  for (const n of nav) {
    if (n.comingSoon || n.group === 'settings') continue;
    add({
      id: `nav:${n.id}`,
      labelKey: n.labelKey,
      href: n.href,
      icon: n.icon,
      locked: n.locked,
      category: GROUP_CATEGORY[n.group] ?? 'other',
    });
  }
  for (const tile of tiles) {
    if (tile.comingSoon) continue;
    add({
      id: `tile:${tile.id}`,
      labelKey: tile.labelKey,
      descriptionKey: tile.descriptionKey,
      href: tile.href,
      icon: tile.icon,
      locked: tile.locked,
      category:
        tile.section === 'automation' || tile.section === 'integrations' ? 'automation' : 'other',
    });
  }
  return cards;
}

const sameScreen = (href: string, screen: string) =>
  href === screen || href.startsWith(`${screen}/`);

/**
 * Reference's curated grid (TW-ASHELL-020): each catalogue card whose screen exists here and is not already in the top bar, in
 * Reference's order, then a plain card for every other reachable screen so nothing is lost. A card takes the crown of the menu
 * entry or Settings tile it points at.
 */
export function allToolCards(
  catalogue: readonly CatalogueCard[],
  nav: readonly ResolvedNavItem[],
  tiles: readonly ResolvedSettingsTile[],
  barHrefs: ReadonlySet<string>,
): ToolCard[] {
  const screens = [
    ...nav.filter((n) => !n.comingSoon && n.group !== 'settings'),
    ...tiles.filter((t) => !t.comingSoon),
  ];
  const claimed = new Set<string>();
  const curated: ToolCard[] = [];
  for (const c of catalogue) {
    for (const want of c.hrefs) {
      const hit = screens.find((x) => sameScreen(x.href, want));
      if (!hit) continue;
      if (barHrefs.has(hit.href)) break;
      claimed.add(hit.href);
      curated.push({
        id: `cat:${c.id}`,
        labelKey: `admin-console-shell.more.cards.${c.id}.title`,
        descriptionKey: `admin-console-shell.more.cards.${c.id}.desc`,
        href: hit.href,
        icon: c.icon,
        locked: hit.locked,
        category: c.cat,
        catalogueId: c.id,
        tone: c.tone,
        badge: c.badge,
      });
      break;
    }
  }
  const rest = toolCards(nav, tiles, barHrefs).filter((c) => !claimed.has(c.href));
  return [...curated, ...rest];
}

/** "All" shows everything; a tab shows only its category (unmapped screens appear under All only, like Reference). */
export const filterCards = (cards: readonly ToolCard[], tab: (typeof TOOL_CATEGORIES)[number]) =>
  tab === 'all' ? [...cards] : cards.filter((c) => c.category === tab);

// --- Shortcut strip (TW-ASHELL-021): browser-local, per workspace ----------------------------------------------------

export interface Shortcut {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon: string;
  custom?: boolean;
}

export const SHORTCUT_TITLE_MAX = 40;
export const SHORTCUT_SUBTITLE_MAX = 64;
export const SHORTCUT_URL_MAX = 160;

/** The five a fresh browser shows. Copy comes from messages by `id`, so the subtitle is always true. */
export const DEFAULT_SHORTCUT_IDS = [
  'new-auto-reply',
  'schedule-send',
  'test-webhook',
  'export-history',
  'contact-support',
] as const;

/** Presets that can be added back. Addresses are this app's screens. */
export const SHORTCUT_PRESETS: Record<string, { href: string; icon: string }> = {
  'new-auto-reply': { href: '/auto-reply', icon: 'reply' },
  'schedule-send': { href: '/scheduled', icon: 'clock' },
  'test-webhook': { href: '/webhooks', icon: 'webhook' },
  'export-history': { href: '/message-history', icon: 'history' },
  'contact-support': { href: '/support', icon: 'help' },
  'new-broadcast': { href: '/broadcasts', icon: 'broadcast' },
  'open-contacts': { href: '/contacts', icon: 'contacts' },
  'pair-device': { href: '/channels/whatsapp', icon: 'phone' },
  'team-inbox': { href: '/inbox', icon: 'inbox' },
  'create-flow': { href: '/flows', icon: 'flow' },
  'new-template': { href: '/templates', icon: 'template' },
};

export const storageKey = (workspaceId: string | number) =>
  `threadwise:more-page-shortcuts:v1:ws${workspaceId}`;

/**
 * Reference's `normaliseHref`: empty becomes `#`; `//x` collapses to `/x`; http(s), mailto, tel, `/` and `#` addresses are kept;
 * anything else is an in-app path and gets a leading slash.
 */
export function normaliseHref(raw: string): string {
  const v = raw.trim();
  if (!v) return '#';
  if (/^(https?:|mailto:|tel:)/i.test(v) || v.startsWith('#')) return v;
  if (v.startsWith('/')) return `/${v.replace(/^\/+/, '')}`;
  return `/${v}`;
}

/** Reads the stored list: bad JSON, a non-list, or no usable entry means the defaults; custom entries that normalise to `#` are dropped. */
export function loadShortcuts(raw: string | null, defaults: readonly Shortcut[]): Shortcut[] {
  if (!raw) return [...defaults];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [...defaults];
  }
  if (!Array.isArray(parsed)) return [...defaults];
  const out: Shortcut[] = [];
  for (const e of parsed) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.title !== 'string') continue;
    const href = normaliseHref(typeof r.href === 'string' ? r.href : '');
    if (r.custom === true && href === '#') continue;
    out.push({
      id: r.id,
      title: r.title.slice(0, SHORTCUT_TITLE_MAX),
      subtitle: typeof r.subtitle === 'string' ? r.subtitle.slice(0, SHORTCUT_SUBTITLE_MAX) : '',
      href,
      icon: typeof r.icon === 'string' ? r.icon : 'link',
      custom: r.custom === true,
    });
  }
  return out;
}

/** A custom shortcut needs a title and an address; a preset cannot be added twice. */
export function addShortcut(list: readonly Shortcut[], s: Shortcut): Shortcut[] | null {
  if (!s.title.trim()) return null;
  if (s.custom) {
    const href = normaliseHref(s.href);
    if (href === '#') return null;
    return [
      ...list,
      {
        ...s,
        title: s.title.trim().slice(0, SHORTCUT_TITLE_MAX),
        subtitle: s.subtitle.trim().slice(0, SHORTCUT_SUBTITLE_MAX),
        href: normaliseHref(s.href.slice(0, SHORTCUT_URL_MAX)),
      },
    ];
  }
  if (list.some((x) => x.id === s.id)) return null;
  return [...list, s];
}

export function moveShortcut(list: readonly Shortcut[], id: string, dir: -1 | 1): Shortcut[] {
  const i = list.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

// --- Recent activity (TW-ASHELL-020 rule 1) ---------------------------------------------------------------------------

/** Reference's two-letter category badges and their colours; anything else gets dots. */
const BADGES: Record<string, { code: string; tone: Tone }> = {
  auth: { code: 'AU', tone: 'violet' },
  inbox: { code: 'IN', tone: 'sky' },
  conversations: { code: 'IN', tone: 'sky' },
  notes: { code: 'NT', tone: 'amber' },
  teams: { code: 'TM', tone: 'violet' },
  broadcasts: { code: 'BC', tone: 'mint' },
  webhooks: { code: 'WH', tone: 'green' },
  workspaces: { code: 'WS', tone: 'sky' },
};

export const activityBadge = (module: string) =>
  BADGES[module.toLowerCase()] ?? { code: '\u2022\u2022\u2022', tone: 'neutral' as Tone };

const title = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** "<Category> <rest>" in title case (Reference): `contacts` + `insert` reads "Contacts insert". */
export function activityLabel(module: string, action: string): string {
  const words = `${module} ${action}`.replace(/[._]+/g, ' ').split(/\s+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? title(w) : w.toLowerCase())).join(' ');
}
