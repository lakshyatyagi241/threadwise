/**
 * Spam scoring of a submission (docs/specs/forms-builder-app.md 9.1 step 1). Layered with the rest of the edge checks (rate limits, the
 * origin list, the optional CAPTCHA): none of them is proof, together they are a floor.
 *
 *  - honeypot: an input a person never sees. A bot fills every input, so any text in it is a bot. The answer is a silent success and
 *    NOTHING is stored (a counter only), so the bot learns nothing.
 *  - too fast: a submit within 2 seconds of the page's `start` event. Scored, not refused: a password manager can fill a form that fast.
 *  - content: links and the stock phrases of comment spam. Over the threshold the submission is stored as `spam` (no CRM write, visible in
 *    the Spam tab with a way back), and the sender still sees a normal success.
 */

export const SPAM_THRESHOLD = 100;
export const MIN_FILL_MS = 2000;

const KEYWORDS: readonly RegExp[] = [
  /\b(viagra|cialis|casino|porn|xxx|escort)\b/i,
  /\b(seo (services|expert|packages?)|backlinks?|guest posts?|rank (your|on) (site|website)|first page of google)\b/i,
  /\b(crypto|bitcoin|forex) (giveaway|investment|trading|signals?)\b/i,
  /\b(buy now|click here|limited offer|act now|make money fast|work from home)\b/i,
  /\b(loan offer|payday loan|weight loss)\b/i,
];

export type SpamReason = 'honeypot' | 'too_fast' | 'links' | 'keywords' | 'markup' | 'shouting';

export interface SpamVerdict {
  score: number;
  reasons: SpamReason[];
  /** The honeypot was filled: drop silently, store nothing. */
  honeypot: boolean;
  /** Over the threshold: store as `spam`, write nothing to the CRM. */
  spam: boolean;
}

const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;
const MARKUP = /<\s*(a|script|iframe|img|svg|form)\b|\[url=|\[link=/i;

export function scoreSubmission(input: {
  /** The free-text answers (see `freeTexts` in form-rules): the places a spammer pastes links and pitches. */
  texts: readonly string[];
  honeypotValue?: string;
  honeypotEnabled: boolean;
  elapsedMs?: number;
}): SpamVerdict {
  const reasons: SpamReason[] = [];
  let score = 0;
  const honeypot = input.honeypotEnabled && (input.honeypotValue ?? '').trim() !== '';
  if (honeypot) reasons.push('honeypot');

  if (input.elapsedMs !== undefined && input.elapsedMs < MIN_FILL_MS) {
    score += 50;
    reasons.push('too_fast');
  }
  const text = input.texts.join(String.fromCharCode(10));
  if (text !== '') {
    const links = text.match(LINK)?.length ?? 0;
    if (links > 0) {
      score += Math.min(80, links * 30);
      reasons.push('links');
    }
    const hits = KEYWORDS.filter((k) => k.test(text)).length;
    if (hits > 0) {
      score += Math.min(90, hits * 45);
      reasons.push('keywords');
    }
    if (MARKUP.test(text)) {
      score += 60;
      reasons.push('markup');
    }
    const letters = text.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 40 && letters === letters.toUpperCase()) {
      score += 20;
      reasons.push('shouting');
    }
  }
  return { score, reasons, honeypot, spam: honeypot || score >= SPAM_THRESHOLD };
}

/** The honeypot input's name: plausible to a bot, never a field id of the form (those are lower-case with underscores). */
export const HONEYPOT_FIELD = 'website_url';
