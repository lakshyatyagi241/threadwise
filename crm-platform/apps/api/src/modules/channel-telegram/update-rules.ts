/**
 * Reading a Telegram update (WD-TG-003 to 006). Pure: no database, no Telegram call.
 *
 * An update is whatever Telegram pushes: a message, a button tap, a payment step. These functions say which kind it is, pull
 * the text and the media out of a message and describe a payment, exactly as WaDesk's webhook did.
 */

export type Update = Record<string, unknown>;
type Dict = Record<string, unknown>;

const dict = (x: unknown): Dict =>
  typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Dict) : {};
const str = (x: unknown): string =>
  typeof x === 'string' || typeof x === 'number' ? String(x) : '';
const at = (o: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, k) => dict(acc)[k], o);

/** The order WaDesk checks them in: a payment must be answered first, a tap second, then the quiet kinds, then messages. */
export type UpdateKind =
  | 'pre_checkout_query'
  | 'callback_query'
  | 'chat_join_request'
  | 'poll_answer'
  | 'message'
  | 'none';

export function updateKind(u: Update): UpdateKind {
  const has = (k: string) => Object.keys(dict(u[k])).length > 0;
  for (const k of [
    'pre_checkout_query',
    'callback_query',
    'chat_join_request',
    'poll_answer',
  ] as const) {
    if (has(k)) return k;
  }
  return pickMessage(u) ? 'message' : 'none';
}

/** The first of message, channel_post, edited_message, edited_channel_post that is present. */
export function pickMessage(u: Update): Dict | null {
  for (const k of ['message', 'channel_post', 'edited_message', 'edited_channel_post']) {
    const m = dict(u[k]);
    if (Object.keys(m).length > 0) return m;
  }
  return null;
}

/** A tap on one of our template quick-reply buttons carries `tqr:<label>`; the label is replayed as a typed message. */
export const QUICK_REPLY_PREFIX = 'tqr:';
export const quickReplyLabel = (data: string): string | null =>
  data.startsWith(QUICK_REPLY_PREFIX) ? data.slice(QUICK_REPLY_PREFIX.length) : null;

export type MediaKind = 'image' | 'video' | 'voice' | 'audio' | 'document';

export interface Extracted {
  text: string;
  mediaType: MediaKind | null;
  fileId: string | null;
}

const MEDIA_FIELDS: Array<[string, MediaKind]> = [
  ['video', 'video'],
  ['voice', 'voice'],
  ['audio', 'audio'],
  ['animation', 'video'],
  ['document', 'document'],
];

/** The text and the media of a message, in WaDesk's order: photo, video, voice, audio, animation, document, sticker, place, contact card, text. */
export function extract(m: Dict): Extracted {
  const photos = Array.isArray(m.photo) ? (m.photo as unknown[]) : [];
  if (photos.length > 0) {
    return {
      text: str(m.caption),
      mediaType: 'image',
      fileId: str(dict(photos.at(-1)).file_id) || null,
    };
  }
  for (const [field, kind] of MEDIA_FIELDS) {
    const fileId = str(at(m, `${field}.file_id`));
    if (fileId) return { text: str(m.caption), mediaType: kind, fileId };
  }
  const sticker = str(at(m, 'sticker.file_id'));
  if (sticker) return { text: str(at(m, 'sticker.emoji')), mediaType: 'image', fileId: sticker };

  const lat = at(m, 'location.latitude');
  if (lat !== undefined && lat !== null) {
    return {
      text: `📍 ${str(lat)}, ${str(at(m, 'location.longitude'))}`,
      mediaType: null,
      fileId: null,
    };
  }
  const phone = str(at(m, 'contact.phone_number'));
  if (phone) {
    return {
      text: `👤 ${str(at(m, 'contact.first_name'))} ${phone}`.replace(/\s+/g, ' ').trim(),
      mediaType: null,
      fileId: null,
    };
  }
  const text = str(m.text);
  if (text !== '') return { text, mediaType: null, fileId: null };
  return { text: serviceText(m), mediaType: null, fileId: null };
}

/** A service message (someone joined, the group changed) reads as a line instead of an empty bubble. */
export function serviceText(m: Dict): string {
  if (m.new_chat_members) return '👋 New member joined';
  if (m.left_chat_member) return '👋 Member left';
  if (m.group_chat_created || m.new_chat_title) return '⚙️ Group updated';
  return '[message]';
}

/** The thread title: chat title, chat username, sender username, first and last name, else "Telegram". */
export function chatTitle(m: Dict): string {
  for (const p of ['chat.title', 'chat.username', 'from.username']) {
    const v = str(at(m, p)).trim();
    if (v) return v;
  }
  const name = `${str(at(m, 'chat.first_name'))} ${str(at(m, 'chat.last_name'))}`.trim();
  return name || 'Telegram';
}

/** The thread key: the bot is part of it, so a reply leaves from the bot that carried the thread. */
export const threadKey = (botRowId: number, chatId: string): string => `tg:${botRowId}:${chatId}`;

/** The 120 characters the thread list shows. */
export const preview = (text: string): string => text.slice(0, 120);

/** Currencies Telegram reports without a minor unit: shown whole. */
const ZERO_DECIMAL = new Set([
  'JPY',
  'KRW',
  'VND',
  'CLP',
  'PYG',
  'UGX',
  'RWF',
  'XOF',
  'XAF',
  'IDR',
]);

export interface PaymentFacts {
  currency: string;
  totalAmount: number;
  amountDisplay: string;
  invoicePayload: string;
  telegramChargeId: string;
  providerChargeId: string;
  orderInfo: unknown;
  /** The line shown in the thread. */
  body: string;
}

/** A `successful_payment` as a record. The total arrives in the currency's smallest unit. */
export function paymentOf(m: Dict): PaymentFacts | null {
  const pay = dict(m.successful_payment);
  if (Object.keys(pay).length === 0) return null;
  const currency = str(pay.currency).toUpperCase();
  const raw = Number.parseInt(str(pay.total_amount) || '0', 10) || 0;
  const amountDisplay = ZERO_DECIMAL.has(currency) ? String(raw) : (raw / 100).toFixed(2);
  return {
    currency,
    totalAmount: raw,
    amountDisplay,
    invoicePayload: str(pay.invoice_payload),
    telegramChargeId: str(pay.telegram_payment_charge_id),
    providerChargeId: str(pay.provider_payment_charge_id),
    orderInfo: pay.order_info ?? null,
    body: `Payment received: ${currency} ${amountDisplay}`.trim(),
  };
}

/** The Telegram user who wrote, falling back to the chat for a channel post. */
export const senderUid = (m: Dict): string => str(at(m, 'from.id')) || str(at(m, 'chat.id'));
