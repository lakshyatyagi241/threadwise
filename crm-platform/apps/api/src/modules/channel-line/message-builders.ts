/**
 * LINE message objects, built the way Reference builds them. Pure. LINE accepts at most five message objects per send; a media
 * message carries no caption, so a body is always its own bubble.
 */

export type LineMessageObject = Record<string, unknown>;

export const TEXT_LIMIT = 5000;
/** A buttons-template body without an image or title: LINE rejects longer. */
export const TEMPLATE_TEXT_LIMIT = 160;
/** An action label, in a buttons template or a quick reply. */
export const LABEL_LIMIT = 20;
export const QUICK_REPLY_LIMIT = 13;
export const MAX_MESSAGES = 5;
const MAX_ACTIONS = 4;
/** LINE needs a duration for an audio message; Reference sends one minute. */
const AUDIO_MS = 60_000;

/** Code-point safe cut (an emoji is never split). */
const cut = (s: string, n: number): string => {
  const chars = Array.from(s);
  return chars.length <= n ? s : chars.slice(0, n).join('');
};

export const textMessage = (text: string): LineMessageObject => ({
  type: 'text',
  text: cut(text, TEXT_LIMIT),
});
export const imageMessage = (url: string): LineMessageObject => ({
  type: 'image',
  originalContentUrl: url,
  previewImageUrl: url,
});
export const videoMessage = (url: string): LineMessageObject => ({
  type: 'video',
  originalContentUrl: url,
  previewImageUrl: url,
});
export const audioMessage = (url: string): LineMessageObject => ({
  type: 'audio',
  originalContentUrl: url,
  duration: AUDIO_MS,
});

/** LINE fetches media itself and only over https: an http address is upgraded. */
export const httpsUrl = (url: string): string => url.replace(/^http:\/\//i, 'https://');

const dict = (x: unknown): Record<string, unknown> =>
  typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};
const str = (x: unknown): string =>
  typeof x === 'string' || typeof x === 'number' ? String(x).trim() : '';

/** Quick-reply chips on a message: each taps back as an ordinary text message carrying its label. */
export function withQuickReplies(
  message: LineMessageObject,
  labels: readonly string[],
): LineMessageObject {
  const items = labels
    .slice(0, QUICK_REPLY_LIMIT)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((label) => ({
      type: 'action',
      action: { type: 'message', label: cut(label, LABEL_LIMIT), text: label },
    }));
  return items.length > 0 ? { ...message, quickReply: { items } } : message;
}

export interface TemplateAction {
  type: 'uri' | 'message';
  label: string;
  uri?: string;
  text?: string;
}

/** A buttons-template message: up to four tappable actions, the text cut to 160 characters. */
export function buttonsTemplate(
  text: string,
  actions: readonly TemplateAction[],
  altText = '',
): LineMessageObject {
  const acts = actions
    .slice(0, MAX_ACTIONS)
    .map((a) => ({ ...a, label: cut(a.label.trim(), LABEL_LIMIT) }))
    .filter((a) => a.label !== '')
    .map((a) =>
      a.type === 'uri' && a.uri
        ? { type: 'uri', label: a.label, uri: a.uri }
        : { type: 'message', label: a.label, text: (a.text ?? a.label).trim() || a.label },
    );
  const body = cut(text !== '' ? text : '-', TEMPLATE_TEXT_LIMIT);
  return {
    type: 'template',
    altText: cut(altText !== '' ? altText : body, 400),
    template: { type: 'buttons', text: body, actions: acts },
  };
}

const URL_TYPES = new Set(['url', 'quick_reply_url']);
const PHONE_TYPES = new Set(['phone_number', 'call', 'phone']);

/**
 * A local template (body and optional buttons) as LINE messages. A link or phone button becomes a buttons template (LINE has no plain
 * link button on a text bubble), plain reply buttons become quick-reply chips. A body longer than the template ceiling goes first as
 * its own text bubble so nothing is cut. One or two messages.
 */
export function templateToMessages(
  body: string,
  buttons: readonly unknown[] = [],
): LineMessageObject[] {
  const actions: TemplateAction[] = [];
  const chips: string[] = [];
  for (const raw of buttons) {
    const b = dict(raw);
    const type = (str(b.type) || str(b.sub_type) || 'quick_reply').toLowerCase();
    const label = str(b.text) || str(b.title);
    if (label === '') continue;
    const url = str(b.url);
    const phone = str(b.phone_number) || str(b.phone);
    if (URL_TYPES.has(type) && url !== '') actions.push({ type: 'uri', label, uri: url });
    else if (PHONE_TYPES.has(type) && phone !== '')
      actions.push({ type: 'uri', label, uri: `tel:${phone}` });
    else chips.push(label);
  }

  const messages: LineMessageObject[] = [];
  if (actions.length > 0) {
    let text = body !== '' ? body : '↓';
    if (Array.from(body).length > TEMPLATE_TEXT_LIMIT) {
      messages.push(textMessage(body));
      text = '↓';
    }
    for (const c of chips) actions.push({ type: 'message', label: c, text: c });
    messages.push(buttonsTemplate(text, actions, body));
  } else {
    const msg = textMessage(body !== '' ? body : ' ');
    messages.push(chips.length > 0 ? withQuickReplies(msg, chips) : msg);
  }
  return messages.slice(0, MAX_MESSAGES);
}

export type MediaKind = 'image' | 'video' | 'audio';

/** What one broadcast recipient receives: the media bubble first (if any), then the text or the template. At most five. */
export function broadcastMessages(
  media: { url: string; kind: MediaKind } | null,
  text: string,
  buttons: readonly unknown[],
): LineMessageObject[] {
  const messages: LineMessageObject[] = [];
  if (media) {
    const url = httpsUrl(media.url);
    messages.push(
      media.kind === 'video'
        ? videoMessage(url)
        : media.kind === 'audio'
          ? audioMessage(url)
          : imageMessage(url),
    );
  }
  if (buttons.length > 0) messages.push(...templateToMessages(text, buttons));
  else if (text.trim() !== '') messages.push(textMessage(text));
  return messages.slice(0, MAX_MESSAGES);
}

/** An inbox reply: the caption (if any) as a leading text bubble, then the file. Kinds LINE has no message for go as a link. */
export function replyMessages(
  text: string,
  media: { url: string; kind: 'image' | 'video' | 'audio' | 'document' | 'sticker' } | null,
): LineMessageObject[] {
  if (!media) return [textMessage(text !== '' ? text : ' ')];
  const url = httpsUrl(media.url);
  const file =
    media.kind === 'video'
      ? videoMessage(url)
      : media.kind === 'audio'
        ? audioMessage(url)
        : media.kind === 'image' || media.kind === 'sticker'
          ? imageMessage(url)
          : textMessage(text !== '' ? text : url);
  const messages: LineMessageObject[] = [];
  if (text !== '' && file.type !== 'text') messages.push(textMessage(text));
  messages.push(file);
  return messages;
}
