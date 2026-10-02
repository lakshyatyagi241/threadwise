import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';

/** A tile with the words the person can see in the current language: what the search looks through. */
export interface SearchableTile {
  tile: ResolvedSettingsTile;
  label: string;
  description: string;
  /** Extra words from the tile's keywords message ("vat, gst, sales tax"), already split. */
  keywords: string[];
  sectionTitle: string;
}

export interface SearchHit {
  entry: SearchableTile;
  score: number;
  /** Half-open ranges `[start, end)` of the label to highlight, in the label's own characters. */
  ranges: Array<[number, number]>;
}

/** Splits a keywords message ("vat, gst; sales tax") into trimmed words. An untranslated or empty message gives none. */
export function splitKeywords(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n،؛]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Lower-cases and removes accents and Arabic marks one character at a time, so `map[i]` is the index in the original
 * text of folded character `i` (a highlight range can then be mapped back).
 */
export function fold(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const out = ch.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    for (const c of out) {
      folded += c;
      map.push(i);
    }
    i += ch.length;
  }
  return { folded, map };
}

/** The words typed in the box, folded; empty for a blank query. */
export function queryTokens(query: string): string[] {
  return fold(query).folded.split(/\s+/).filter(Boolean);
}

function isWordStart(text: string, at: number): boolean {
  return at === 0 || /[^\p{L}\p{N}]/u.test(text[at - 1] ?? ' ');
}

/** Best position of `token` in `text`: a word start beats a match inside a word. */
function find(text: string, token: string): { at: number; wordStart: boolean } | null {
  let first = -1;
  for (let at = text.indexOf(token); at !== -1; at = text.indexOf(token, at + 1)) {
    if (isWordStart(text, at)) return { at, wordStart: true };
    if (first === -1) first = at;
  }
  return first === -1 ? null : { at: first, wordStart: false };
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * Scores one tile for the tokens, or `null` when any token matches nothing (every word typed must hit something).
 * A token counts for its best field: the label (a label that starts with it most), then the keywords, then the help
 * line, then the section's title.
 */
function scoreEntry(entry: SearchableTile, tokens: string[]): SearchHit | null {
  const label = fold(entry.label);
  const keywords = entry.keywords.map((k) => fold(k).folded);
  const description = fold(entry.description).folded;
  const section = fold(entry.sectionTitle).folded;

  let score = 0;
  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    let best = 0;
    const inLabel = find(label.folded, token);
    if (inLabel) {
      best = inLabel.at === 0 ? 100 : inLabel.wordStart ? 80 : 60;
      if (label.folded === token) best = 120;
      const end = inLabel.at + token.length;
      ranges.push([label.map[inLabel.at]!, (label.map[end - 1] ?? 0) + 1]);
    }
    for (const k of keywords) {
      const hit = find(k, token);
      if (hit) best = Math.max(best, k === token ? 55 : hit.wordStart ? 50 : 35);
    }
    const inDescription = find(description, token);
    if (inDescription) best = Math.max(best, inDescription.wordStart ? 25 : 15);
    if (find(section, token)) best = Math.max(best, 10);
    if (best === 0) return null;
    score += best;
  }
  return { entry, score, ranges: mergeRanges(ranges) };
}

/**
 * Filters the tiles of every section by what was typed and ranks them: label matches first (exact, then a label that starts
 * with the word, then a word start, then anywhere), then keywords, the help line and the section title. Equal scores keep
 * built screens ahead of "Soon" ones, then the tile order. A blank query matches nothing (the caller shows the section).
 */
export function searchTiles(entries: readonly SearchableTile[], query: string): SearchHit[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const entry of entries) {
    const hit = scoreEntry(entry, tokens);
    if (hit) hits.push(hit);
  }
  return hits.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.entry.tile.comingSoon) - Number(b.entry.tile.comingSoon) ||
      (a.entry.tile.order ?? 100) - (b.entry.tile.order ?? 100) ||
      a.entry.tile.id.localeCompare(b.entry.tile.id),
  );
}
