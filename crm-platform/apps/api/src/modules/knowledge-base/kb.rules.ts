import { KB_RETRIEVAL } from '@crm/contracts';

/** Pure rules of the knowledge base search: no database, no network, so every decision here is unit-tested. */

/** How many times a passage's embedding is tried before it is marked failed (the search then reads its text directly). */
export const MAX_EMBED_ATTEMPTS = 5;
/** A single entry never makes more passages than this (200 000 characters of text is about 250). */
export const MAX_CHUNKS_PER_SOURCE = 500;
/** The customer message sent to the vendor is cut here. */
export const QUERY_MAX_CHARS = 2000;
/** Text of passages that are not indexed yet is read directly, up to this many characters, so a new entry works at once. */
export const UNINDEXED_BUDGET_CHARS = 6000;

/** Also drops NUL: Postgres text cannot hold it. */
export const tidy = (s: string): string => s.replaceAll('\u0000', '').replace(/\s+/gu, ' ').trim();

/** The text a customer's message is searched with: collapsed and cut. */
export const queryText = (raw: string): string =>
  Array.from(tidy(raw)).slice(0, QUERY_MAX_CHARS).join('');

/** A message worth a search: at least two characters and a letter or digit (an emoji, a "?" or an "ok" alone is not a question). */
export function isSearchable(text: string): boolean {
  const t = tidy(text);
  return Array.from(t).length >= 2 && /[\p{L}\p{N}]/u.test(t);
}

/** pgvector's text form of a vector, six decimals (halfvec keeps about three significant digits anyway). */
export function toVectorLiteral(v: readonly number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : 0)).join(',')}]`;
}

/** L2-normalised copy, so cosine and dot agree and a vendor that returns raw vectors still compares correctly. */
export function normalise(v: readonly number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? [...v] : v.map((x) => x / n);
}

export interface ScoredPassage {
  label: string;
  text: string;
  score: number;
}

/**
 * Which of the nearest passages the agent reads: those that reach the floor AND sit within the band of the best one, at most `topK`.
 * The band is the guard against blending: two passages that answer the question score alike, a passage far below the best one is
 * noise that would only give the model something to mix in. Input order does not matter; output is best first.
 */
export function pickPassages(
  rows: readonly ScoredPassage[],
  floor: number,
  topK: number = KB_RETRIEVAL.topK,
  band: number = KB_RETRIEVAL.band,
): ScoredPassage[] {
  const ranked = [...rows].filter((r) => r.score >= floor).sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return [];
  const best = ranked[0]!.score;
  return ranked.filter((r) => best - r.score <= band).slice(0, topK);
}

/** An entry's text: Q&A entries read as a question and its answer, every other kind is its content. */
export function sourceText(s: {
  kind: string;
  content: string | null;
  question: string | null;
  answer: string | null;
}): string {
  if (s.kind === 'qa')
    return `Q: ${(s.question ?? '').trim()}\nA: ${(s.answer ?? '').trim()}`.trim();
  return (s.content ?? '').trim();
}

/** Added to an agent's instructions whenever it reads passages instead of the whole base. */
export const GROUNDED_NOTE =
  'Answer only from the knowledge base excerpts above. If they do not contain the answer, say you do not know and offer to connect the customer with a person. Never guess or invent details such as prices, dates or policies.';
