/** Pure reading of a Meta Page webhook payload (TW-FB-006 to 009). Nothing here touches the database or Meta. */

type Dict = Record<string, unknown>;

const dict = (x: unknown): Dict => (typeof x === 'object' && x !== null ? (x as Dict) : {});
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string =>
  typeof x === 'string' || typeof x === 'number' ? String(x) : '';

/** One `entry` of the payload: the Page it is for and its events. */
export interface PageEntry {
  pageId: string;
  messaging: Dict[];
  /** The `value` of every `feed` change (other fields are not ours). */
  feed: Dict[];
}

/** Only `object = page` is ours; everything else is acknowledged and ignored. Delivery is batched: every entry is read. */
export function readEntries(payload: unknown): PageEntry[] {
  const p = dict(payload);
  if (p.object !== 'page') return [];
  const out: PageEntry[] = [];
  for (const raw of list(p.entry)) {
    const e = dict(raw);
    const pageId = str(e.id);
    if (pageId === '') continue;
    out.push({
      pageId,
      messaging: list(e.messaging).map(dict),
      feed: list(e.changes)
        .map(dict)
        .filter((c) => c.field === 'feed')
        .map((c) => dict(c.value)),
    });
  }
  return out;
}

export interface Attachment {
  type: string;
  url: string;
}

/** A customer's Messenger message, ready to be written. */
export interface DmInput {
  psid: string;
  mid: string;
  text: string;
  mediaType: string | null;
  mediaUrl: string | null;
  /** Meta's timestamp in milliseconds, when it sent one. */
  timestamp: number | null;
}

/** A tap on a button, Get Started or an ice breaker: no `message`, only a payload. */
export interface PostbackInput {
  psid: string;
  /** The button payload, else its visible title. */
  payload: string;
}

export type MessagingKind =
  { kind: 'dm'; dm: DmInput } | { kind: 'postback'; postback: PostbackInput } | { kind: 'ignore' };

/**
 * A `messaging` event is a postback (a tap), a customer message, or noise. Receipts, reactions and our own echoes carry no
 * message to store. A message needs a sender and a message id; the first attachment sets the media.
 */
export function readMessaging(ev: Dict): MessagingKind {
  const psid = str(dict(ev.sender).id);
  if (ev.postback !== undefined && psid !== '') {
    const pb = dict(ev.postback);
    const payload = str(pb.payload) || str(pb.title);
    return payload === '' ? { kind: 'ignore' } : { kind: 'postback', postback: { psid, payload } };
  }
  const m = dict(ev.message);
  if (ev.message === undefined || m.is_echo === true) return { kind: 'ignore' };
  const mid = str(m.mid);
  if (psid === '' || mid === '') return { kind: 'ignore' };
  const first = list(m.attachments).map(dict)[0];
  const ts = typeof ev.timestamp === 'number' ? ev.timestamp : null;
  return {
    kind: 'dm',
    dm: {
      psid,
      mid,
      text: str(m.text),
      mediaType: first ? str(first.type) || 'file' : null,
      mediaUrl: first ? str(dict(first.payload).url) || null : null,
      timestamp: ts,
    },
  };
}

/** A new comment on a post of the Page. */
export interface CommentInput {
  commentId: string;
  postId: string;
  fromId: string;
  fromName: string;
  parentId: string;
  /** Empty when Meta sent only a notification: the text is then fetched. */
  message: string;
}

/**
 * A `feed` change that is a new comment. A reply to the Page's own comments, and the Page's own replies, are not conversations to
 * answer (TW-FB-009 rule 2), so a comment by the Page itself is dropped here.
 */
export function readComment(pageId: string, value: Dict): CommentInput | null {
  if (value.item !== 'comment' || value.verb !== 'add') return null;
  const commentId = str(value.comment_id);
  const postId = str(value.post_id) || str(value.parent_id);
  if (commentId === '' || postId === '') return null;
  const from = dict(value.from);
  const fromId = str(from.id);
  if (fromId !== '' && fromId === pageId) return null;
  return {
    commentId,
    postId,
    fromId,
    fromName: str(from.name),
    parentId: str(value.parent_id),
    message: str(value.message),
  };
}

/** Words that start a flow for any message. */
const CATCH_ALL = new Set(['any', '*', '.*', '.+']);

/**
 * Does the text start a flow? `triggerKeywords` is a comma list; any token may match. A catch-all token matches every message,
 * otherwise a token matches when the text contains it, ignoring case. An empty text or empty list never matches.
 */
export function keywordMatches(text: string, triggerKeywords: string | null | undefined): boolean {
  const t = text.trim().toLowerCase();
  if (t === '' || !triggerKeywords) return false;
  for (const raw of triggerKeywords.toLowerCase().split(/\s*,\s*/)) {
    const kw = raw.trim();
    if (kw === '') continue;
    if (CATCH_ALL.has(kw) || t.includes(kw)) return true;
  }
  return false;
}

/** One historical message from Meta's conversation listing, read for the backfill (TW-FB-010). */
export interface HistoryMessage {
  mid: string;
  text: string;
  mediaType: string | null;
  mediaUrl: string | null;
  fromId: string;
  /** Epoch milliseconds, or null when Meta's time did not parse. */
  timestamp: number | null;
}

interface RawHistory {
  id?: string;
  message?: string;
  created_time?: string;
  from?: { id?: string };
  attachments?: {
    data?: Array<{
      mime_type?: string;
      file_url?: string;
      image_data?: { url?: string };
      video_data?: { url?: string };
    }>;
  };
}

/** Only the customer's messages with something in them are imported; the Page's own past replies are not (TW-FB-010 rule 1). */
export function readHistory(pageId: string, m: RawHistory): HistoryMessage | null {
  const mid = m.id ?? '';
  const fromId = m.from?.id ?? '';
  if (mid === '' || fromId === '' || fromId === pageId) return null;
  const att = m.attachments?.data?.[0];
  const url = (att?.image_data?.url || att?.video_data?.url || att?.file_url || '').trim();
  const mime = att?.mime_type ?? '';
  const mediaType =
    url === ''
      ? null
      : mime.startsWith('image')
        ? 'image'
        : mime.startsWith('video')
          ? 'video'
          : 'file';
  const text = m.message ?? '';
  if (text === '' && url === '') return null;
  const t = m.created_time ? Date.parse(m.created_time) : NaN;
  return {
    mid,
    text,
    mediaType,
    mediaUrl: url || null,
    fromId,
    timestamp: Number.isNaN(t) ? null : t,
  };
}
