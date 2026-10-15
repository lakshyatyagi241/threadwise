/**
 * What Viber's webhook sends and how it reads (TW-VIB-003, 004, 005). Pure: a payload in, plain facts out. Never throws on an
 * unknown shape; an event it does not know is `ignore`.
 */

export type ViberEvent =
  /** Viber's validation ping fired by `set_webhook`. */
  | { kind: 'ping' }
  | { kind: 'message'; message: InboundViberMessage }
  /** `subscribed` (confirmed) or `conversation_started` (the user opened the chat but has NOT subscribed yet). */
  | { kind: 'subscribe'; confirmed: boolean; user: ViberUserInfo }
  | { kind: 'unsubscribe'; userId: string }
  | {
      kind: 'receipt';
      status: 'delivered' | 'read' | 'failed';
      token: string;
      userId: string;
      desc: string;
    }
  | { kind: 'ignore'; reason: string };

export interface ViberUserInfo {
  id: string;
  name: string | null;
  avatar: string | null;
}

export type InboundBody =
  | { kind: 'text'; text: string }
  | {
      kind: 'media';
      mediaKind: 'image' | 'video' | 'document';
      url: string;
      text: string;
      name: string | null;
    }
  | { kind: 'location'; latitude: number; longitude: number }
  | { kind: 'contact'; name: string; phone: string }
  | { kind: 'unsupported'; label: string };

export interface InboundViberMessage {
  user: ViberUserInfo;
  token: string | null;
  /** Viber's own message type (`text`, `picture`, `sticker`...). */
  msgType: string;
  stickerId: string | null;
  body: InboundBody;
}

const dict = (x: unknown): Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
const str = (x: unknown): string | null =>
  typeof x === 'string' ? x : typeof x === 'number' && Number.isFinite(x) ? String(x) : null;
const num = (x: unknown): number | null => {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN;
  return Number.isFinite(n) ? n : null;
};
const nonEmpty = (x: unknown): string | null => {
  const s = str(x);
  return s !== null && s !== '' ? s : null;
};

const user = (u: unknown): ViberUserInfo | null => {
  const o = dict(u);
  const id = nonEmpty(o.id);
  return id === null ? null : { id, name: nonEmpty(o.name), avatar: nonEmpty(o.avatar) };
};

/**
 * A user's message as the inbox shows it (Reference's `extract`): a picture or video carries its caption, a file its file name, a
 * location, a contact and a sticker are noted, anything else is `[type]`.
 */
export function readBody(m: Record<string, unknown>): InboundBody {
  const type = (str(m.type) ?? '').toLowerCase();
  const media = nonEmpty(m.media);
  switch (type) {
    case 'text':
      return { kind: 'text', text: str(m.text) ?? '' };
    case 'picture':
      return media
        ? {
            kind: 'media',
            mediaKind: 'image',
            url: media,
            text: (str(m.text) ?? '').trim(),
            name: null,
          }
        : { kind: 'unsupported', label: '[image]' };
    case 'video':
      return media
        ? { kind: 'media', mediaKind: 'video', url: media, text: '', name: null }
        : { kind: 'unsupported', label: '[video]' };
    case 'file':
      return media
        ? {
            kind: 'media',
            mediaKind: 'document',
            url: media,
            text: (str(m.file_name) ?? '').trim(),
            name: nonEmpty(m.file_name),
          }
        : { kind: 'unsupported', label: (str(m.file_name) ?? '').trim() || '[file]' };
    case 'location': {
      const loc = dict(m.location);
      const latitude = num(loc.lat);
      const longitude = num(loc.lon);
      return latitude !== null && longitude !== null
        ? { kind: 'location', latitude, longitude }
        : { kind: 'unsupported', label: '[location]' };
    }
    case 'contact': {
      const c = dict(m.contact);
      return {
        kind: 'contact',
        name: (str(c.name) ?? '').trim(),
        phone: (str(c.phone_number) ?? '').trim(),
      };
    }
    case 'sticker':
      return { kind: 'unsupported', label: '[sticker]' };
    case 'url':
      return { kind: 'text', text: str(m.media) ?? '' };
    default:
      return { kind: 'unsupported', label: `[${type || 'message'}]` };
  }
}

/** Reads one webhook payload. */
export function readEvent(payload: unknown): ViberEvent {
  const p = dict(payload);
  const event = (str(p.event) ?? '').toLowerCase();
  switch (event) {
    case 'webhook':
      return { kind: 'ping' };
    case 'message': {
      const sender = user(p.sender);
      if (!sender) return { kind: 'ignore', reason: 'message without a sender' };
      const m = dict(p.message);
      return {
        kind: 'message',
        message: {
          user: sender,
          token: nonEmpty(p.message_token),
          msgType: (str(m.type) ?? '').toLowerCase(),
          stickerId: nonEmpty(m.sticker_id),
          body: readBody(m),
        },
      };
    }
    case 'subscribed':
    case 'conversation_started': {
      const u = user(p.user);
      return u
        ? { kind: 'subscribe', confirmed: event === 'subscribed', user: u }
        : { kind: 'ignore', reason: `${event} without a user` };
    }
    case 'unsubscribed': {
      const id = nonEmpty(p.user_id);
      return id
        ? { kind: 'unsubscribe', userId: id }
        : { kind: 'ignore', reason: 'unsubscribed without a user' };
    }
    case 'delivered':
    case 'seen':
    case 'failed': {
      const token = nonEmpty(p.message_token);
      if (!token) return { kind: 'ignore', reason: `${event} without a message token` };
      return {
        kind: 'receipt',
        status: event === 'seen' ? 'read' : event,
        token,
        userId: nonEmpty(p.user_id) ?? '',
        desc: str(p.desc) ?? '',
      };
    }
    default:
      return { kind: 'ignore', reason: event === '' ? 'no event' : `unhandled ${event}` };
  }
}

/** The display name Viber gave, else the placeholder a thread carries until it does. */
export const PLACEHOLDER_NAME = 'Viber';
