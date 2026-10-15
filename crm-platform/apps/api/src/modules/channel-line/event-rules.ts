/**
 * Pure reading of a LINE webhook delivery (`{ destination, events: [...] }`). Never throws on an unknown shape: an event this does
 * not understand reads as `ignore`.
 */

export type LineEvent = Record<string, unknown>;

const dict = (x: unknown): Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
const str = (x: unknown): string | null =>
  typeof x === 'string' ? (x === '' ? null : x) : typeof x === 'number' ? String(x) : null;

/** The events of a delivery; anything that is not a list of objects yields none. */
export function eventsOf(body: unknown): LineEvent[] {
  const events = dict(body).events;
  return Array.isArray(events) ? events.filter((e) => typeof e === 'object' && e !== null) : [];
}

export interface Source {
  /** `user`, `group` or `room`. */
  type: string;
  /** The thread key: the user id of a 1:1 chat, the group id of a group, the room id of a room. */
  id: string;
  /** The person who wrote (present in a group too, when LINE says who). */
  userId: string | null;
}

/**
 * Where an event came from. A group or a room is one thread of its own, keyed by its id, whoever wrote in it. (Reference keyed a group
 * message by the writer's user id when LINE gave one, which mixed it into that person's 1:1 thread; here the thread is the group.)
 */
export function sourceOf(event: LineEvent): Source | null {
  const s = dict(event.source);
  const type = str(s.type) ?? 'user';
  const userId = str(s.userId);
  const id = type === 'group' ? str(s.groupId) : type === 'room' ? str(s.roomId) : userId;
  return id === null ? null : { type, id, userId };
}

export interface Extracted {
  text: string;
  mediaType: 'image' | 'video' | 'audio' | 'document' | null;
  /** LINE's message id, which is also what the file is downloaded with. */
  messageId: string | null;
  fileName: string | null;
}

/** Text and file of a message event, as Reference reads them (a sticker or location becomes a line of text). */
export function extractMessage(event: LineEvent): Extracted {
  const m = dict(event.message);
  const id = str(m.id);
  switch (str(m.type) ?? '') {
    case 'text':
      return { text: str(m.text) ?? '', mediaType: null, messageId: null, fileName: null };
    case 'image':
      return { text: '', mediaType: 'image', messageId: id, fileName: null };
    case 'video':
      return { text: '', mediaType: 'video', messageId: id, fileName: null };
    case 'audio':
      return { text: '', mediaType: 'audio', messageId: id, fileName: null };
    case 'file': {
      const name = str(m.fileName);
      return { text: name ?? '[file]', mediaType: 'document', messageId: id, fileName: name };
    }
    case 'location':
      return {
        text: `📍 ${str(m.latitude) ?? ''}, ${str(m.longitude) ?? ''}`,
        mediaType: null,
        messageId: null,
        fileName: null,
      };
    case 'sticker':
      return { text: str(m.text) ?? '[sticker]', mediaType: null, messageId: null, fileName: null };
    default:
      return { text: '[message]', mediaType: null, messageId: null, fileName: null };
  }
}

export type Reading =
  | { kind: 'message'; source: Source; extracted: Extracted; meta: EventMeta }
  | { kind: 'postback'; source: Source; data: string; meta: EventMeta }
  | { kind: 'ignore'; type: string };

export interface EventMeta {
  messageId: string | null;
  replyToken: string | null;
  webhookEventId: string | null;
}

/**
 * Message and postback events become inbox rows. A postback (a button or flow answer) is replayed as a typed message, so keyword and
 * flow automation fire as for a typed one. Follow, unfollow, join, leave and the rest are acknowledged and ignored (Reference).
 */
export function readEvent(event: LineEvent): Reading {
  const type = str(event.type) ?? '';
  const source = sourceOf(event);
  const meta: EventMeta = {
    messageId: str(dict(event.message).id),
    replyToken: str(event.replyToken),
    webhookEventId: str(event.webhookEventId),
  };
  if (type === 'postback') {
    const data = str(dict(event.postback).data);
    return source && data ? { kind: 'postback', source, data, meta } : { kind: 'ignore', type };
  }
  if (type === 'message' && source) {
    return { kind: 'message', source, extracted: extractMessage(event), meta };
  }
  return { kind: 'ignore', type };
}
