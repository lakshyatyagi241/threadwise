import { matchesHref } from '@/components/shell/nav-model';
import type { HelpIndexEntry } from './types';

/** Words must all match somewhere; where they match decides the order: title, then keywords, headings, summary. */
export function matchHelp(entries: readonly HelpIndexEntry[], query: string): HelpIndexEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];

  const scored: Array<{ entry: HelpIndexEntry; score: number; at: number }> = [];
  entries.forEach((entry, at) => {
    const title = entry.title.toLowerCase();
    const keywords = entry.keywords.join(' ').toLowerCase();
    const headings = entry.headings
      .map((h) => h.text)
      .join(' ')
      .toLowerCase();
    const summary = entry.summary.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (title.includes(word)) score += 4;
      else if (keywords.includes(word)) score += 3;
      else if (headings.includes(word)) score += 2;
      else if (summary.includes(word)) score += 1;
      else return;
    }
    scored.push({ entry, score, at });
  });
  return scored.sort((a, b) => b.score - a.score || a.at - b.at).map((s) => s.entry);
}

/** `/contacts/?x=1#top` -> `/contacts`; the root stays `/`. */
function clean(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? '';
  return bare.length > 1 && bare.endsWith('/') ? bare.slice(0, -1) : bare;
}

/**
 * The doc the page-level "?" opens: the one with the longest route that covers the address (the same rule the menu uses to
 * highlight an entry, so `/contacts` covers `/contacts/42` and never `/contacts-archive`). The help pages have no tip.
 */
export function docForPath(
  entries: readonly HelpIndexEntry[],
  pathname: string,
): HelpIndexEntry | undefined {
  const path = clean(pathname);
  if (path === '/help' || path.startsWith('/help/')) return undefined;

  let best: { entry: HelpIndexEntry; length: number } | undefined;
  for (const entry of entries) {
    for (const route of entry.routes) {
      const r = clean(route);
      if (!matchesHref(path, r)) continue;
      const better =
        !best ||
        r.length > best.length ||
        (r.length === best.length &&
          (entry.order < best.entry.order ||
            (entry.order === best.entry.order && entry.id < best.entry.id)));
      if (better) best = { entry, length: r.length };
    }
  }
  return best?.entry;
}
