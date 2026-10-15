import type { ViberMessage } from '../../infra/providers/channel-viber/viber.port';

/**
 * Viber message objects (TW-VIB-009, 013), ported from Reference's `ViberClient` builders. Pure.
 *
 * Viber has no template message: a template's body is a text message, and its buttons become an inline keyboard. A `reply` button's
 * ActionBody comes back as a message from the customer, so keyword rules and flows match it like typed text.
 */

export const TEXT_LIMIT = 7000;
export const PICTURE_CAPTION_LIMIT = 768;
export const FILE_NAME_LIMIT = 256;
/** Viber's keyboard holds at most 24 buttons in Reference's mapping. */
export const KEYBOARD_BUTTON_LIMIT = 24;
/** Reference's button colour (Viber purple). */
const BUTTON_COLOUR = '#7360F2';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

const dict = (x: unknown): Record<string, unknown> =>
  typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};
const text = (x: unknown): string =>
  typeof x === 'string' || typeof x === 'number' ? String(x).trim() : '';

/** PHP's `htmlspecialchars(..., ENT_QUOTES)`: Viber renders a button's text as HTML. */
export const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export const textMessage = (body: string): ViberMessage => ({
  type: 'text',
  text: clip(body, TEXT_LIMIT),
});

export const pictureMessage = (media: string, caption = ''): ViberMessage => ({
  type: 'picture',
  text: clip(caption, PICTURE_CAPTION_LIMIT),
  media,
});

/** Viber requires the file's size in bytes; an unknown size is sent as 1 (what Reference did). */
export const videoMessage = (media: string, size: number): ViberMessage => ({
  type: 'video',
  media,
  size: Math.max(1, Math.floor(size)),
});

export const fileMessage = (media: string, size: number, fileName: string): ViberMessage => ({
  type: 'file',
  media,
  size: Math.max(1, Math.floor(size)),
  file_name: clip(fileName, FILE_NAME_LIMIT),
});

export interface KeyboardButton {
  text: string;
  type: 'reply' | 'url';
  url?: string;
}

/** Adds an inline keyboard of reply and open-url buttons to any message. No usable button leaves the message as it was. */
export function withKeyboard(
  message: ViberMessage,
  buttons: readonly KeyboardButton[],
): ViberMessage {
  const rows = buttons
    .slice(0, KEYBOARD_BUTTON_LIMIT)
    .filter((b) => b.text.trim() !== '')
    .map((b) => {
      const label = b.text.trim();
      const link = b.type === 'url' && (b.url ?? '').trim() !== '';
      return {
        Columns: 6,
        Rows: 1,
        ActionType: link ? 'open-url' : 'reply',
        ActionBody: link ? (b.url ?? '').trim() : label,
        Text: escapeHtml(label),
        TextSize: 'regular',
        BgColor: BUTTON_COLOUR,
      };
    });
  if (rows.length === 0) return message;
  return {
    ...message,
    min_api_version: 3,
    keyboard: { Type: 'keyboard', DefaultHeight: false, Buttons: rows },
  };
}

/**
 * A template's buttons as keyboard buttons (Reference's rule): a real link is an open-url button, a phone button is a `tel:` link,
 * everything else is a reply button. A button without a label is dropped.
 */
export function templateButtons(buttons: readonly unknown[]): KeyboardButton[] {
  const out: KeyboardButton[] = [];
  for (const raw of buttons) {
    const b = dict(raw);
    const type = (text(b.type) || text(b.sub_type) || 'quick_reply').toLowerCase();
    const label = text(b.text) || text(b.title);
    if (label === '') continue;
    const url = text(b.url);
    const phone = text(b.phone_number) || text(b.phone);
    if ((type === 'url' || type === 'quick_reply_url') && url !== '') {
      out.push({ text: label, type: 'url', url });
    } else if ((type === 'phone_number' || type === 'call' || type === 'phone') && phone !== '') {
      out.push({ text: label, type: 'url', url: `tel:${phone}` });
    } else {
      out.push({ text: label, type: 'reply' });
    }
  }
  return out;
}

/** A template (body and buttons) as one Viber message. An empty body is a single space, which Viber accepts. */
export function templateMessage(body: string, buttons: readonly unknown[]): ViberMessage {
  const msg = textMessage(body !== '' ? body : ' ');
  const keys = templateButtons(buttons);
  return keys.length > 0 ? withKeyboard(msg, keys) : msg;
}

export interface BroadcastContent {
  body: string;
  buttons: readonly unknown[];
  mediaUrl: string | null;
  mediaKind: string | null;
  mediaSize: number | null;
}

/**
 * The one message a whole broadcast sends (Reference's `buildMessage`): a file wins (a video, else a picture with the text as its
 * caption), then a template's buttons, else plain text. A picture or video carries no keyboard, as in Reference.
 */
export function broadcastMessage(c: BroadcastContent): ViberMessage {
  if (c.mediaUrl) {
    return c.mediaKind === 'video'
      ? videoMessage(c.mediaUrl, c.mediaSize ?? 1)
      : pictureMessage(c.mediaUrl, c.body);
  }
  if (c.buttons.length > 0) return templateMessage(c.body, c.buttons);
  return textMessage(c.body !== '' ? c.body : ' ');
}

/** Reference's mapping of an attachment to a Viber message type: `.mp4` is a video, anything else is sent as a picture. */
export function mediaKindFor(url: string): 'image' | 'video' {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep the raw text */
  }
  return (path.split('.').pop() ?? '').toLowerCase() === 'mp4' ? 'video' : 'image';
}
