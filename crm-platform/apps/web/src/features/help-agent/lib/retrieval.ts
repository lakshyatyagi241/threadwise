import type { HelpIndexEntry } from '@/features/help-center';

/**
 * Answers a "how do I..." question from the Help guides before the assistant touches the page (docs/specs/help-agent-assistant.md
 * section 9). Retrieval runs on the help index the layout already holds (titles, summaries, keywords and headings of the guides the
 * person may see), so it needs no request and can never surface a guide the person's plan or role hides.
 */

const STOP_EN = new Set(
  'a an and are as at be by can could do does for from get go has have how i if in into is it its me my of on or our please show shall should so that the their then there this to us want was we what when where which who why will with would you your need help tell find make let lets'.split(
    ' ',
  ),
);
const STOP_AR = new Set(
  'كيف اين ماذا ما هل من في على الى عن مع او ان انا اريد اود ارغب لي لو يمكن يمكنني ممكن هذا هذه ذلك التي الذي و ثم اذا كل بعد قبل عند يجب اعرف ساعدني وضح اظهر لماذا متى'.split(
    ' ',
  ),
);

const strip = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا');

/** The words of a question that carry meaning. */
export function questionWords(question: string): string[] {
  const words = strip(question)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP_EN.has(w) && !STOP_AR.has(w));
  return [...new Set(words)];
}

/** A light stem so "connecting" finds "connect" and "templates" finds "template". */
const stem = (w: string): string =>
  w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w.replace(/s$/, '');

export interface RankedGuide {
  entry: HelpIndexEntry;
  score: number;
}

/**
 * The best guides for a question, best first. A guide scores for each question word found in its title (4), keywords (3), headings
 * (2) or summary (1); a guide that matches none is left out. Unlike the Help search (every word must match) a natural question
 * rarely has every word in a guide, so any matching word counts and the number of words matched leads.
 */
export function rankGuides(
  entries: readonly HelpIndexEntry[],
  question: string,
  limit = 3,
): RankedGuide[] {
  const words = questionWords(question).map(stem);
  if (words.length === 0) return [];
  const ranked: Array<RankedGuide & { at: number; matched: number }> = [];
  entries.forEach((entry, at) => {
    const title = strip(entry.title);
    const keywords = strip(entry.keywords.join(' '));
    const headings = strip(entry.headings.map((h) => h.text).join(' '));
    const summary = strip(entry.summary);
    let score = 0;
    let matched = 0;
    for (const w of words) {
      const s = title.includes(w)
        ? 4
        : keywords.includes(w)
          ? 3
          : headings.includes(w)
            ? 2
            : summary.includes(w)
              ? 1
              : 0;
      if (s > 0) matched += 1;
      score += s;
    }
    if (matched > 0) ranked.push({ entry, score: score + matched * 2, at, matched });
  });
  return ranked
    .sort((a, b) => b.matched - a.matched || b.score - a.score || a.at - b.at)
    .slice(0, limit)
    .map(({ entry, score }) => ({ entry, score }));
}
