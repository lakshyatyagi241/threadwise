import type { RoutingConditions, RoutingTestCondition } from '@crm/contracts';

/** What the engine knows about the conversation that just arrived, for the parts of a rule that are not contact fields. */
export interface RoutingFacts {
  channelKind: string;
  /** The customer's message text, null for a message with none (a photo, a location). */
  messageText: string | null;
  /** The language the translation reading stored on the conversation, null when unknown. */
  language: string | null;
  /** Whether the message arrived outside the workspace's business hours (no configured hours: never outside). */
  outsideHours: boolean;
  /**
   * `new` when the conversation's contact was created by this very chat, `returning` when it has another conversation or was saved earlier,
   * null when the conversation has no contact (a plan limit or an address the channel cannot turn into a contact).
   */
  contactKind: 'new' | 'returning' | null;
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
 * Every part of the conditions that does not need the database: contact kind, channel, keywords, language and business hours, each with
 * its verdict and, when it failed, a machine reason for the "Try it" box. A part that is not set does not restrict and is not listed. The
 * contact details part is decided separately (it is SQL over the contact, `RoutingEngine`); a rule matches when all parts hold.
 */
export function explainFacts(c: RoutingConditions, f: RoutingFacts): RoutingTestCondition[] {
  const out: RoutingTestCondition[] = [];
  if (c.contactKind !== 'any') {
    const matched = f.contactKind === c.contactKind;
    out.push({
      part: 'contactKind',
      matched,
      why: matched ? null : f.contactKind === null ? 'no_contact' : 'not_same_kind',
    });
  }
  if (c.channelKinds.length > 0) {
    const matched = c.channelKinds.includes(f.channelKind as never);
    out.push({ part: 'channel', matched, why: matched ? null : 'channel_differs' });
  }
  if (c.keywords) {
    const matched = keywordsMatch(c.keywords, f.messageText);
    out.push({ part: 'keywords', matched, why: matched ? null : 'no_word' });
  }
  if (c.languages.length > 0) {
    const matched = languageMatches(c.languages, f.language);
    out.push({ part: 'languages', matched, why: matched ? null : 'language_differs' });
  }
  if (c.businessHours !== 'any') {
    const matched = c.businessHours === 'outside' ? f.outsideHours : !f.outsideHours;
    out.push({ part: 'businessHours', matched, why: matched ? null : 'hours_differ' });
  }
  return out;
}

/** Every part of the conditions that does not need the database holds (see `explainFacts`). */
export function matchesFacts(c: RoutingConditions, f: RoutingFacts): boolean {
  return explainFacts(c, f).every((p) => p.matched);
}
