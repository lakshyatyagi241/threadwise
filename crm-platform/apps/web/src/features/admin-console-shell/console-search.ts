import { isGroup, type ConsoleEntry, type ConsoleLeaf } from './console-nav';

/** One page the console search can open. */
export interface SearchEntry {
  id: string;
  href: string;
  label: string;
  /** Heading of the section the page sits in; empty for a link outside the sections (Overview, Your account). */
  section: string;
  /** Heading of the block inside that section, when the page has one. */
  caption: string;
  /** Normalised words the query may also hit: section, block, hidden keywords, and the words of the address (`api-keys` finds "AI provider keys"). */
  context: string;
}

/** What the palette shows before anything is typed (Reference: the first 8 entries of its index). */
export const DEFAULT_RESULTS = 8;
/** The most matches it lists for a query (Reference: 12). */
export const MAX_RESULTS = 12;

/** Combining accents (U+0300 to U+036F) and Arabic vowel marks (U+064B to U+065F, U+0670). */
const MARKS = /[\u0300-\u036f\u064b-\u065f\u0670]/g;

/** Lower case, with accents and Arabic vowel marks removed, so "Cafe" finds "Café" and a marked word finds its bare form. */
export const normalize = (text: string): string =>
  text.normalize('NFKD').replace(MARKS, '').toLowerCase().trim();

const words = (text: string): string[] =>
  normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const addressWords = (href: string): string =>
  href.replace(/^\/admin\/?/, '').replace(/[/-]+/g, ' ');

export function makeSearchEntry(
  id: string,
  href: string,
  label: string,
  section = '',
  caption = '',
  keywords = '',
): SearchEntry {
  return {
    id,
    href,
    label,
    section,
    caption,
    context: normalize(`${section} ${caption} ${keywords} ${addressWords(href)}`),
  };
}

/**
 * Every page of the console as a search entry, in menu order, labelled with the hub it sits in and the group inside it
 * (`Settings > Branding`; a page keeps the heading of the group it follows). Module pages added at run time are included.
 */
export function buildSearchIndex(
  entries: readonly ConsoleEntry[],
  text: (key: string) => string,
  keywordsOf: (id: string) => string = () => '',
): SearchEntry[] {
  const labelOf = (leaf: ConsoleLeaf) => leaf.label ?? text(leaf.labelKey);
  const out: SearchEntry[] = [];
  for (const entry of entries) {
    if (!isGroup(entry)) {
      out.push(makeSearchEntry(entry.id, entry.href, labelOf(entry), '', '', keywordsOf(entry.id)));
      continue;
    }
    const section = text(entry.labelKey);
    let caption = '';
    for (const leaf of entry.children) {
      if (leaf.captionKey) caption = text(leaf.captionKey);
      out.push(
        makeSearchEntry(leaf.id, leaf.href, labelOf(leaf), section, caption, keywordsOf(leaf.id)),
      );
    }
  }
  return out;
}

/** The pages listed before anything is typed: the first few of the menu, in order. */
export const defaultEntries = (index: readonly SearchEntry[]): SearchEntry[] =>
  index.slice(0, DEFAULT_RESULTS);

/**
 * Pages matching every word of the query, best first. A word that starts a word of the page name beats one found
 * inside it, which beats one found only in the section, block, keywords or address; an exact name beats everything.
 * Ties keep menu order. An empty query matches nothing (the caller shows its own browse list).
 */
export function searchEntries(
  index: readonly SearchEntry[],
  query: string,
  limit = MAX_RESULTS,
): SearchEntry[] {
  const tokens = words(query);
  if (tokens.length === 0) return [];
  const phrase = tokens.join(' ');
  const scored: Array<{ entry: SearchEntry; score: number; order: number }> = [];
  index.forEach((entry, order) => {
    const label = normalize(entry.label);
    const labelWords = words(entry.label);
    let score = 0;
    for (const token of tokens) {
      if (labelWords.some((w) => w.startsWith(token))) score += 4;
      else if (label.includes(token)) score += 3;
      else if (entry.context.includes(token)) score += 1;
      else return; // every word has to match somewhere
    }
    if (label === phrase) score += 10;
    else if (label.startsWith(phrase)) score += 5;
    scored.push({ entry, score, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, limit).map((s) => s.entry);
}
