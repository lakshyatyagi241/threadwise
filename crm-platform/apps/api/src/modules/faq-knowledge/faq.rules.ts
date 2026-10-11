import { createHash } from 'node:crypto';
import { FAQ_LIMITS, type FaqCandidate, type FaqMatchOutcome } from '@crm/contracts';

/** Pure rules of the FAQ engine: no database, no network, so every decision here is unit-tested. */

/** Trigram similarity the fallback tier needs. Its scale is not the vectors' (it only sees spelling), so it has its own bar. */
export const TRIGRAM_MIN = 0.6;
/** How many times a variation's embedding is tried before it is marked failed (the person sees it and can retry). */
export const MAX_EMBED_ATTEMPTS = 5;
/** What a log keeps of the customer's text. */
export const LOG_QUERY_MAX = 500;
/** How many candidates the screens show. */
export const CANDIDATES_SHOWN = 5;
/** How many variations the vector query reads; enough to find five different FAQs when each has many phrasings. */
export const VECTOR_FETCH = 60;
/** The match log is kept this long. */
export const LOG_RETENTION_DAYS = 90;

/** One whitespace-collapsed, trimmed copy: what is stored and compared. */
/** Also drops NUL: Postgres text cannot hold it, and a customer's message does not pass through the API's validation pipe. */
export const tidy = (s: string): string => s.replaceAll('\u0000', '').replace(/\s+/gu, ' ').trim();

/** The key two phrasings are the same under (the unique index uses lower(btrim(...))). */
export const sameKey = (s: string): string => tidy(s).toLowerCase();

/** A message worth matching: at least two characters and a letter or digit (an emoji, a "?" or an "ok" alone is not a question). */
export function isMatchable(text: string): boolean {
  const t = tidy(text);
  return Array.from(t).length >= 2 && /[\p{L}\p{N}]/u.test(t);
}

/** The text that goes to the vendor and to the log: collapsed, and cut at the cap. */
export const queryText = (raw: string): string =>
  Array.from(tidy(raw)).slice(0, FAQ_LIMITS.queryMax).join('');

/** pgvector's text form of a vector, six decimals (halfvec keeps about three significant digits anyway). */
export function toVectorLiteral(v: readonly number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : 0)).join(',')}]`;
}

/** L2-normalised copy, so cosine and dot agree and a vendor that returns raw vectors still compares correctly. */
export function normalise(v: readonly number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? [...v] : v.map((x) => x / n);
}

export const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export interface Scored {
  faqId: number;
  faqUuid: string;
  question: string;
  status: 'active' | 'paused';
  thresholdOverride: number | null;
  text: string;
  score: number;
}

/** One entry per FAQ (its best variation), best first. */
export function bestPerFaq(rows: readonly Scored[]): Scored[] {
  const best = new Map<number, Scored>();
  for (const r of rows) {
    const cur = best.get(r.faqId);
    if (!cur || r.score > cur.score) best.set(r.faqId, r);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.faqId - b.faqId);
}

export interface Decision {
  outcome: Extract<FaqMatchOutcome, 'answered' | 'below_threshold' | 'low_margin' | 'no_faqs'>;
  winner: Scored | null;
  secondScore: number | null;
  /** The bar the winner was held to (its own override, else the workspace's). */
  threshold: number;
}

/**
 * Does the best FAQ answer? An exact match (score 1) always does. Otherwise the best score must reach the FAQ's bar (its override,
 * else the workspace's) and, when a margin is set, lead the runner-up FAQ by at least that much: two FAQs that score alike mean the
 * message is ambiguous, and asking is better than a wrong answer.
 */
export function decide(
  ranked: readonly Scored[],
  opts: { threshold: number; minMargin: number; exact: boolean },
): Decision {
  const winner = ranked[0] ?? null;
  if (!winner)
    return { outcome: 'no_faqs', winner: null, secondScore: null, threshold: opts.threshold };
  const secondScore = ranked[1]?.score ?? null;
  const threshold = winner.thresholdOverride ?? opts.threshold;
  if (opts.exact) return { outcome: 'answered', winner, secondScore, threshold };
  // Compared at the four decimals the screens show: 0.7 - 0.6 is 0.09999999999999998 in floating point, and a lead of exactly the
  // margin (or a score that reads 0.4500 against a 0.45 bar) must pass, or the number on screen would contradict the decision.
  if (round4(winner.score) < round4(threshold)) {
    return { outcome: 'below_threshold', winner, secondScore, threshold };
  }
  if (
    opts.minMargin > 0 &&
    secondScore !== null &&
    round4(winner.score - secondScore) < round4(opts.minMargin)
  ) {
    return { outcome: 'low_margin', winner, secondScore, threshold };
  }
  return { outcome: 'answered', winner, secondScore, threshold };
}

export const toCandidates = (ranked: readonly Scored[]): FaqCandidate[] =>
  ranked.slice(0, CANDIDATES_SHOWN).map((r) => ({
    faqId: r.faqUuid,
    question: r.question,
    score: round4(r.score),
    matchedText: r.text,
    status: r.status,
  }));

// --- variation generation ------------------------------------------------------------------------------------------

export function suggestionPrompt(
  question: string,
  existing: readonly string[],
  count: number,
): { system: string; user: string } {
  return {
    system:
      'You write the different ways real customers phrase one support question in a chat. Reply with JSON only: ' +
      '{"variations": ["...", "..."]}. Each variation is a short, natural customer message that asks for the same thing. ' +
      "Mix registers: formal, casual, one-word keyword, with a typo, with extra context. Keep the question's language, " +
      'and also add romanised versions when the language is commonly typed that way (Hinglish, for example). ' +
      'Never answer the question. Never add numbering, quotes or commentary.',
    user:
      `Question: ${question}\nAlready covered (do not repeat): ${JSON.stringify(existing.slice(0, 40))}\n` +
      `Write ${count} new variations.`,
  };
}

/** The model's answer to a list of clean, new phrasings: JSON first, lines as a fallback, never more than `count`. */
export function parseSuggestions(text: string, known: readonly string[], count: number): string[] {
  let raw: unknown[] = [];
  try {
    const parsed = JSON.parse(text) as { variations?: unknown };
    if (Array.isArray(parsed.variations)) raw = parsed.variations;
  } catch {
    raw = text.split('\n').map((l) => l.replace(/^[\s\-*\d.)"']+|["',\s]+$/gu, ''));
  }
  const seen = new Set(known.map(sameKey));
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== 'string') continue;
    const t = tidy(r);
    if (t === '' || Array.from(t).length > FAQ_LIMITS.variation || seen.has(sameKey(t))) continue;
    seen.add(sameKey(t));
    out.push(t);
    if (out.length >= count) break;
  }
  return out;
}

/**
 * A UUID that is the same every time for the same seed (version 5 layout, SHA-1 of a fixed namespace and the seed). The inbox takes the
 * sender's own message id as the idempotency key and wants a uuid; the answer to customer message X is always `answerId(X)`, so a
 * retried job queues one reply, not two.
 */
export function answerId(seed: string): string {
  const h = createHash('sha1').update(`faq-answer:${seed}`).digest('hex').slice(0, 32).split('');
  h[12] = '5';
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const x = h.join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
