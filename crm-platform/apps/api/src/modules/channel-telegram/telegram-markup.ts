import { QUICK_REPLY_PREFIX } from './update-rules';

/**
 * A template's buttons as a Telegram keyboard (WD-TG-009). Pure.
 *
 * Telegram allows one markup per message, so the choice is made once: any real link means an inline keyboard (links as link
 * buttons, quick replies as callback buttons that come back as a tap); only quick replies mean a one-time reply keyboard whose
 * taps send the label back as a message. A phone button cannot be a button at all: its number is appended to the text.
 */

export interface Markup {
  replyMarkup: object | null;
  /** Text to add under the message (the phone lines), starting with a line break; empty when none. */
  append: string;
}

const dict = (x: unknown): Record<string, unknown> =>
  typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};
const text = (x: unknown): string =>
  typeof x === 'string' || typeof x === 'number' ? String(x).trim() : '';

const URL_TYPES = new Set(['url', 'quick_reply_url']);
const PHONE_TYPES = new Set(['phone_number', 'call', 'phone']);

export function templateButtonsMarkup(buttons: readonly unknown[]): Markup {
  const links: Array<{ text: string; url: string }> = [];
  const quick: string[] = [];
  const phones: string[] = [];

  for (const raw of buttons) {
    const b = dict(raw);
    const type = (text(b.type) || text(b.sub_type) || 'quick_reply').toLowerCase();
    const label = text(b.text) || text(b.title);
    if (label === '') continue;
    const url = text(b.url);
    const phone = text(b.phone_number) || text(b.phone);
    if (URL_TYPES.has(type) && url !== '') links.push({ text: label.slice(0, 64), url });
    else if (PHONE_TYPES.has(type) && phone !== '') phones.push(`${label}: ${phone}`);
    else quick.push(label.slice(0, 64));
  }

  const append = phones.length > 0 ? `\n${phones.map((p) => `📞 ${p}`).join('\n')}` : '';

  if (links.length > 0) {
    const rows: object[][] = links.map((l) => [l]);
    for (const q of quick)
      rows.push([{ text: q, callback_data: `${QUICK_REPLY_PREFIX}${q.slice(0, 60)}` }]);
    return { replyMarkup: { inline_keyboard: rows }, append };
  }
  if (quick.length > 0) {
    return {
      replyMarkup: {
        keyboard: quick.map((q) => [{ text: q }]),
        one_time_keyboard: true,
        resize_keyboard: true,
      },
      append,
    };
  }
  return { replyMarkup: null, append };
}
