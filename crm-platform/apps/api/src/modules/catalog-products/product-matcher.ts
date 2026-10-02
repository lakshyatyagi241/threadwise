/**
 * Resolve a free-text item name (from the order parser) to a catalog product (TW-CAT-032). The ladder, best first:
 * exact SKU, exact name, exact alias (any language), then fuzzy: containment, then a similarity score over a threshold.
 * Catalogs per workspace are small, so the caller loads the active products once and matches here in memory.
 */

export const FUZZY_THRESHOLD = 0.62;

export interface MatchableProduct {
  sku: string | null;
  name: string;
  /** The stored `aliases_json`: strings, or objects with an `alias` or `name` key. */
  aliases: unknown;
}

export type MatchedOn = 'empty' | 'sku' | 'name' | 'alias' | 'contains' | 'fuzzy' | 'none';

export interface MatchResult<P> {
  product: P | null;
  matchedOn: MatchedOn;
  confidence: number;
}

export const normalizeText = (s: string): string =>
  s.trim().toLowerCase().replace(/\s+/gu, ' ').trim();

/** All aliases of a product, lower-cased and trimmed, blanks dropped. */
export function aliasStrings(aliases: unknown): string[] {
  const out: string[] = [];
  const list = Array.isArray(aliases) ? aliases : [];
  for (const a of list) {
    const raw =
      a && typeof a === 'object'
        ? ((a as Record<string, unknown>).alias ?? (a as Record<string, unknown>).name ?? '')
        : a;
    const val = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (val !== '') out.push(val);
  }
  return out;
}

/**
 * PHP's `similar_text` percentage: twice the length of the common substrings found by the longest-common-substring recursion,
 * over the sum of both lengths. Reproduced because the threshold was tuned against it.
 */
function similarChars(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let max = 0;
  let posA = 0;
  let posB = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > max) {
        max = k;
        posA = i;
        posB = j;
      }
    }
  }
  if (max === 0) return 0;
  return (
    max +
    similarChars(a.slice(0, posA), b.slice(0, posB)) +
    similarChars(a.slice(posA + max), b.slice(posB + max))
  );
}

export function similarity(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const total = ca.length + cb.length;
  if (total === 0) return 0;
  return (similarChars(ca, cb) * 2) / total;
}

export function matchProduct<P extends MatchableProduct>(
  products: readonly P[],
  text: string,
): MatchResult<P> {
  const needle = normalizeText(text);
  if (needle === '') return { product: null, matchedOn: 'empty', confidence: 0 };

  for (const p of products) {
    if (p.sku && normalizeText(p.sku) === needle)
      return { product: p, matchedOn: 'sku', confidence: 1 };
  }
  for (const p of products) {
    if (normalizeText(p.name) === needle) return { product: p, matchedOn: 'name', confidence: 1 };
  }
  for (const p of products) {
    if (aliasStrings(p.aliases).includes(needle)) {
      return { product: p, matchedOn: 'alias', confidence: 0.98 };
    }
  }

  let best: P | null = null;
  let bestScore = 0;
  let bestOn: MatchedOn = 'fuzzy';
  for (const p of products) {
    for (const cand of [normalizeText(p.name), ...aliasStrings(p.aliases)]) {
      if (cand === '') continue;
      if (needle.includes(cand) || cand.includes(needle)) {
        if (0.85 > bestScore) {
          bestScore = 0.85;
          best = p;
          bestOn = 'contains';
        }
        continue;
      }
      const ratio = similarity(needle, cand);
      if (ratio > bestScore) {
        bestScore = ratio;
        best = p;
        bestOn = 'fuzzy';
      }
    }
  }
  if (best && bestScore >= FUZZY_THRESHOLD) {
    return { product: best, matchedOn: bestOn, confidence: Math.round(bestScore * 100) / 100 };
  }
  return { product: null, matchedOn: 'none', confidence: 0 };
}
