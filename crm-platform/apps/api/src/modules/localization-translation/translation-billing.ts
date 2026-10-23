import { fingerprint } from '../../common/stable-usage-id';

/**
 * What a paid translation (DeepL, Google Cloud) is charged under. Pure, so the one rule that keeps a customer from paying twice has a
 * plain unit test.
 *
 * Identical text is served from the 24-hour cache, so the same words normally reach a provider once a day. The id is that same
 * sentence in data: workspace, provider, both languages, a fingerprint of the text and the UTC day. If the cache misses (Redis was down,
 * an entry was evicted) and the same text is translated again the same day, the wallet recognises it and takes nothing; the next day it
 * is a new translation and a new charge.
 */
export function translationUsageId(o: {
  orgId: number;
  providerSlug: string;
  sourceLang: string;
  targetLang: string;
  /** `fingerprint` of the text that was sent to the provider. */
  textHash: string;
  at: Date;
}): string {
  const day = o.at.toISOString().slice(0, 10);
  const key = [o.orgId, o.providerSlug, o.sourceLang, o.targetLang, o.textHash, day].join('|');
  return `${o.providerSlug}:${fingerprint(key)}`;
}
