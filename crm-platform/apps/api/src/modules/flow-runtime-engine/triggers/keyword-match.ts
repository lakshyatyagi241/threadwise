import { FLOW_CATCH_ALL_KEYWORDS } from '@crm/contracts';

export interface KeywordFlow {
  id: number;
  /** The comma-separated keywords the author typed in the trigger node, or one of the catch-all spellings. */
  keywords: string;
  /** The channel the flow is bound to; null listens on every channel of its engine. */
  channelId: number | null;
}

/** `*`, `.*`, `.+` and `any`, compared exactly after trimming (TW-FLR-004 rule 6): the "any message" default route. */
export function isCatchAll(keywords: string): boolean {
  return (FLOW_CATCH_ALL_KEYWORDS as readonly string[]).includes(keywords.trim());
}

export function keywordsOf(csv: string): string[] {
  return csv
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k !== '');
}

const order = (channelId: number) => (a: KeywordFlow, b: KeywordFlow) => {
  const bound = (f: KeywordFlow) => (f.channelId === channelId ? 0 : 1);
  return bound(a) - bound(b) || a.id - b.id;
};

/**
 * The flow a typed message starts (TW-FLR-004 rule 10): a flow whose keyword the message contains, with the flow bound to this
 * channel first and the lowest id after; only when none matches, the default-route flow by the same order. So a default route can
 * never outrank a keyword flow. Fuzzy and translated matching belong to the Auto reply domain's matcher, which calls this for the
 * flow tiers.
 */
export function matchKeywordFlow(
  flows: readonly KeywordFlow[],
  text: string,
  channelId: number,
): KeywordFlow | null {
  const t = text.trim().toLowerCase();
  if (t === '') return null;
  const eligible = flows.filter((f) => f.channelId === null || f.channelId === channelId);
  const hit = eligible
    .filter((f) => !isCatchAll(f.keywords) && keywordsOf(f.keywords).some((k) => t.includes(k)))
    .sort(order(channelId))[0];
  if (hit) return hit;
  return eligible.filter((f) => isCatchAll(f.keywords)).sort(order(channelId))[0] ?? null;
}
