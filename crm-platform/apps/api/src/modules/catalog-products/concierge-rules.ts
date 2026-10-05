/**
 * The pure half of the catalog concierge (TW-CAT-028): a free-text question into keywords and a price band, and the ranking of
 * candidate products. Deterministic on purpose, so it needs no AI service and is testable offline.
 */

const STOPWORDS = new Set([
  'show',
  'me',
  'want',
  'need',
  'looking',
  'look',
  'for',
  'do',
  'you',
  'have',
  'has',
  'any',
  'the',
  'a',
  'an',
  'is',
  'are',
  'got',
  'get',
  'some',
  'please',
  'pls',
  'hi',
  'hello',
  'hey',
  'and',
  'or',
  'to',
  'with',
  'i',
  'my',
  'we',
  'us',
  'price',
  'priced',
  'cost',
  'budget',
  'under',
  'below',
  'above',
  'over',
  'less',
  'more',
  'than',
  'between',
  'around',
  'near',
  'about',
  'upto',
  'rs',
  'inr',
  'usd',
  'send',
  'share',
  'catalog',
  'product',
  'products',
  'item',
  'items',
  'buy',
  'purchase',
  'order',
  'available',
]);

export interface Intent {
  keywords: string[];
  /** Whole major units; compare against `price_minor / 100`. */
  priceMin: number | null;
  priceMax: number | null;
}

const num = (s: string) => Number.parseInt(s.replace(/,/g, ''), 10);

/**
 * "between 1000 and 2000", "1000 to 2000", "1000-2000" give a band; "under / below / less than / upto / max / <" a ceiling;
 * "above / over / more than / from / min / >=" a floor. A bare number is in major units, whatever the currency.
 */
export function extractIntent(text: string): Intent {
  const low = text.toLowerCase();
  let priceMin: number | null = null;
  let priceMax: number | null = null;

  const range = low.match(/(\d[\d,]*)\s*(?:-|to|and)\s*(\d[\d,]*)/);
  if (range) {
    const a = num(range[1]!);
    const b = num(range[2]!);
    priceMin = Math.min(a, b);
    priceMax = Math.max(a, b);
  } else {
    const max = low.match(
      /(?:under|below|less than|upto|up to|max|<=?)\s*(?:rs\.?|₹|\$|inr|usd)?\s*(\d[\d,]*)/,
    );
    if (max) priceMax = num(max[1]!);
    const min = low.match(
      /(?:above|over|more than|from|min|>=?)\s*(?:rs\.?|₹|\$|inr|usd)?\s*(\d[\d,]*)/,
    );
    if (min) priceMin = num(min[1]!);
  }

  const keywords: string[] = [];
  for (const tok of low.split(/[^\p{L}\p{N}]+/u)) {
    if (tok === '' || Array.from(tok).length < 2) continue;
    if (/^\d+$/.test(tok)) continue;
    if (STOPWORDS.has(tok)) continue;
    if (!keywords.includes(tok)) keywords.push(tok);
  }
  return { keywords, priceMin, priceMax };
}

/** A message that is neither a keyword nor a price is not a product question: the concierge stays silent. */
export const looksLikeProductQuery = (i: Intent): boolean =>
  i.keywords.length > 0 || i.priceMin !== null || i.priceMax !== null;

export interface RankableProduct {
  name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
  updatedAt: Date;
}

/**
 * Ranks candidates: a keyword in the name, category or brand scores 3, one only in the description 1; best first, ties keep
 * the incoming order. With no keywords the newest come first.
 */
export function rankProducts<P extends RankableProduct>(
  candidates: readonly P[],
  keywords: readonly string[],
  limit: number,
): P[] {
  if (keywords.length === 0) {
    return [...candidates]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }
  return candidates
    .map((p, index) => {
      const strong = `${p.name} ${p.category ?? ''} ${p.brand ?? ''}`.toLowerCase();
      const weak = (p.description ?? '').toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (strong.includes(kw)) score += 3;
        else if (weak.includes(kw)) score += 1;
      }
      return { p, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.p);
}

/** "I found 3 matches for "red shoes under 2000":" (the query cut at 60 characters plus "...", as Laravel's `Str::limit`). */
export function conciergeBody(count: number, query: string): string {
  const chars = Array.from(query.trim());
  const q = chars.length > 60 ? `${chars.slice(0, 60).join('')}...` : chars.join('');
  return count === 1 ? `I found 1 match for "${q}":` : `I found ${count} matches for "${q}":`;
}

export const CONCIERGE_DEFAULT_HEADER = "Here's what I found";
export const CONCIERGE_DEFAULT_EMPTY =
  "Sorry, I couldn't find a match for that. Try a different keyword or budget.";
export const CONCIERGE_COOLDOWN_SECONDS = 30;
