import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { ResolvedNavItem } from '@/features/_registry/types';

/** Dispatched on `window` by the header's search button; the palette listens for it. */
export const SEARCH_EVENT = 'shell:open-search';

export type PaletteTag = 'page' | 'account' | 'plan' | 'help' | 'system';

export interface PaletteEntry {
  id: string;
  title: string;
  description: string;
  href: string;
  tag: PaletteTag;
  /** Hidden words that also match ("roas" finds Analytics). */
  keywords: string;
}

/** Words that find a screen without being in its name. Ids that are not listed match by title and description only. */
const KEYWORDS: Record<string, string> = {
  analytics: 'roas reports stats metrics charts',
  inbox: 'conversations chat messages replies',
  contacts: 'people audience leads customers',
  campaigns: 'whatsapp marketing send',
  broadcasts: 'bulk blast send',
  templates: 'message templates approved',
  flows: 'automation builder chatbot',
  deals: 'pipeline sales crm',
  'workspace-settings': 'workspace name timezone currency export delete notifications slack',
  whatsapp: 'devices connect qr number channels',
  'ai-keys': 'api keys openai byok',
  plans: 'pricing upgrade billing subscription',
  wallet: 'balance credits top up',
  'billing-orders': 'orders invoices receipts payments history',
};

/**
 * What the palette can open: every menu entry and Settings tile this person can reach (the same lists that draw the menu, so
 * it never offers a page the person has no permission for; WaDesk's did, and answered with a 403), plus the account
 * entries that live in the user menu. Screens that are not built yet are left out.
 */
export function buildPalette(
  nav: readonly ResolvedNavItem[],
  tiles: readonly ResolvedSettingsTile[],
  label: (key: string) => string,
  account: readonly PaletteEntry[],
): PaletteEntry[] {
  const seen = new Set<string>();
  const out: PaletteEntry[] = [];
  const add = (e: PaletteEntry) => {
    if (seen.has(e.href)) return;
    seen.add(e.href);
    out.push(e);
  };
  for (const n of nav) {
    if (n.comingSoon) continue;
    add({
      id: `nav:${n.id}`,
      title: label(n.labelKey),
      description: '',
      href: n.href,
      tag: n.group === 'help' ? 'help' : 'page',
      keywords: KEYWORDS[n.id] ?? '',
    });
  }
  for (const tile of tiles) {
    if (tile.comingSoon) continue;
    add({
      id: `tile:${tile.id}`,
      title: label(tile.labelKey),
      description: tile.descriptionKey ? label(tile.descriptionKey) : '',
      href: tile.href,
      tag: tile.id === 'plans' ? 'plan' : 'page',
      keywords:
        `${KEYWORDS[tile.id] ?? ''} ${tile.keywordsKey ? label(tile.keywordsKey) : ''}`.trim(),
    });
  }
  for (const e of account) add(e);
  return out;
}

/** An empty query lists the first eight; otherwise a case-insensitive match on title, description and keywords, twelve at most. */
export function searchPalette(
  entries: readonly PaletteEntry[],
  query: string,
  defaults = 8,
  max = 12,
): PaletteEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice(0, defaults);
  return entries
    .filter((e) => `${e.title} ${e.description} ${e.keywords}`.toLowerCase().includes(q))
    .slice(0, max);
}

/**
 * Jump box of the sidebar strip (WD-ASHELL-016): case-insensitive substring on label and group, eight results at most.
 * Locked items are listed with their own address, so choosing one lands on the page where the paywall sheet explains.
 */
export function jumpSearch<T extends { label: string; group: string }>(
  index: readonly T[],
  query: string,
  max = 8,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return index.filter((i) => `${i.label} ${i.group}`.toLowerCase().includes(q)).slice(0, max);
}
