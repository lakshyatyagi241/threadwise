import type { RoutingConditions } from '@crm/contracts';

/** What the engine knows about the conversation that just arrived, for the parts of a rule that are not contact fields. */
export interface RoutingFacts {
  channelKind: string;
  /** The customer's message text, null for a message with none (a photo, a location). */
  messageText: string | null;
  /** The language the translation reading stored on the conversation, null when unknown. */
  language: string | null;
  /** Whether the message arrived outside the workspace's business hours (no configured hours: never outside). */
  outsideHours: boolean;
}

const fold = (s: string) => s.toLocaleLowerCase();

/** `any` of the words, or `all` of them, appear in the text (case-insensitive substring). No text matches nothing. */
export function keywordsMatch(
  keywords: NonNullable<RoutingConditions['keywords']>,
  text: string | null,
): boolean {
  if (!text) return false;
  const hay = fold(text);
  const hit = (w: string) => hay.includes(fold(w.trim()));
  return keywords.mode === 'all' ? keywords.words.every(hit) : keywords.words.some(hit);
}

/** `en` matches `en` and `en-US`; an unknown language matches no listed language. */
export function languageMatches(wanted: readonly string[], language: string | null): boolean {
  if (!language) return false;
  const have = fold(language);
  return wanted.some((w) => {
    const want = fold(w);
    return have === want || have.startsWith(`${want}-`) || have.startsWith(`${want}_`);
  });
}

/**
 * Every part of the conditions that does not need the database: channel, keywords, language and business hours. A part that is
 * not set does not restrict. The contact part is decided separately (it is SQL over the contact, `RoutingEngine`); a rule matches
 * when both hold.
 */
export function matchesFacts(c: RoutingConditions, f: RoutingFacts): boolean {
  if (c.channelKinds.length > 0 && !c.channelKinds.includes(f.channelKind as never)) return false;
  if (c.keywords && !keywordsMatch(c.keywords, f.messageText)) return false;
  if (c.languages.length > 0 && !languageMatches(c.languages, f.language)) return false;
  if (c.businessHours === 'inside' && f.outsideHours) return false;
  if (c.businessHours === 'outside' && !f.outsideHours) return false;
  return true;
}
