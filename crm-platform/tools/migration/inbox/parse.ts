import { Oid, plain, scrub, str, toDate, type Doc } from '../util';
import type { Soft } from '../transform/types';

/**
 * One chathistory document is ONE TURN. This reads the turn tolerantly: the shapes of `bot_response.response[]`, `user_query_object.value`
 * and the rich `user_query` object were NOT visible in the masked pilot profiles ([VERIFY ON DUMP], spec A 2.3). Anything unexpected
 * becomes a field-level soft issue and the whole payload stays in `meta.legacy`; nothing here throws.
 */
export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'template'
  | 'reaction'
  | 'interactive'
  | 'system';

export interface ParsedTurn {
  /** null when the document holds neither a bot turn nor a user turn. */
  direction: 'in' | 'out' | null;
  kind: MessageKind;
  senderKind: 'customer' | 'agent' | 'bot' | 'system';
  body: string | null;
  mediaUrl: string | null;
  /** Everything that goes to messages.meta.legacy besides the document ids (response, query, transfer, mediaUrl). */
  legacy: Record<string, unknown>;
  soft: Soft[];
  /** No body, no media and no recognisable payload: EMPTY_MESSAGE. */
  empty: boolean;
}

export const obj = (v: unknown): Doc | null =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  !(v instanceof Oid) &&
  !(v instanceof Date)
    ? (v as Doc)
    : null;

const TYPE_KIND: Record<string, MessageKind> = {
  text: 'text',
  image: 'image',
  photo: 'image',
  video: 'video',
  audio: 'audio',
  voice: 'voice',
  document: 'document',
  file: 'document',
  pdf: 'document',
  sticker: 'sticker',
  location: 'location',
  contact: 'contact',
  contacts: 'contact',
  template: 'template',
  reaction: 'reaction',
  button: 'interactive',
  buttons: 'interactive',
  button_reply: 'interactive',
  list: 'interactive',
  list_reply: 'interactive',
  quick_reply: 'interactive',
  quick_replies: 'interactive',
  quickreply: 'interactive',
  interactive: 'interactive',
  carousel: 'interactive',
  cards: 'interactive',
  options: 'interactive',
};

export const kindOfType = (t: unknown): MessageKind | null => {
  const s = str(t)?.toLowerCase();
  return s ? (TYPE_KIND[s] ?? null) : null;
};

const EXT_KIND: Array<[RegExp, MessageKind]> = [
  [/\.(jpe?g|png|gif|webp|bmp|heic)$/i, 'image'],
  [/\.(mp4|mov|3gp|webm|mkv|avi)$/i, 'video'],
  [/\.(mp3|ogg|opus|m4a|wav|aac|amr)$/i, 'audio'],
];
export function kindOfUrl(url: string): MessageKind {
  const path = url.split(/[?#]/)[0] ?? '';
  return EXT_KIND.find(([re]) => re.test(path))?.[1] ?? 'document';
}

const TEXT_KEYS = ['text', 'message', 'body', 'caption', 'content', 'value', 'title'];
const URL_KEYS = ['url', 'link', 'image', 'video', 'audio', 'document', 'file', 'media', 'src'];
const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v.trim());

/** Text parts and the first media url of one element of `response[]` (strings, objects, nested arrays). */
function collect(el: unknown, parts: string[], media: { url: string | null }, depth = 0): boolean {
  if (typeof el === 'string') {
    if (el.trim() !== '') parts.push(el);
    return true;
  }
  if (typeof el === 'number' || typeof el === 'boolean') {
    parts.push(String(el));
    return true;
  }
  if (Array.isArray(el)) {
    if (depth >= 3) return false;
    let ok = true;
    for (const x of el) ok = collect(x, parts, media, depth + 1) && ok;
    return ok;
  }
  const o = obj(el);
  if (!o) return el === null || el === undefined;
  let found = false;
  for (const k of TEXT_KEYS) {
    const v = o[k];
    if (typeof v === 'string' && v.trim() !== '') {
      parts.push(v);
      found = true;
      break;
    }
    if (obj(v) || Array.isArray(v)) {
      // {text: {body: "..."}} (the Cloud API shape)
      if (depth < 3 && collect(v, parts, media, depth + 1)) {
        found = true;
        break;
      }
    }
  }
  for (const k of URL_KEYS) {
    const v = o[k];
    if (isUrl(v) && media.url === null) media.url = v.trim();
    else if (obj(v) && media.url === null) {
      const inner = Object.values(v!).find(isUrl);
      if (inner) media.url = inner.trim();
    }
  }
  return found || media.url !== null || Object.keys(o).length > 0;
}

/** Labels of WHERE a bot reply came from (`bot_response.type`), not of what it is. They never raise UNKNOWN_KIND; the kind comes from the elements. */
const ORIGIN_TYPES = new Set([
  'flow',
  'faq',
  'ai',
  'bot',
  'chatbot',
  'automation',
  'broadcast',
  'agent',
  'livechat',
  'kb',
]);
const HEADER_MEDIA = new Set(['image', 'video', 'document']);

const textOf = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  const o = obj(v);
  const inner = o ? (o.text ?? o.body) : null;
  return typeof inner === 'string' && inner.trim() !== '' ? inner : null;
};

export interface InteractiveRead {
  /** header text, body, footer, in that order (only the ones present). */
  parts: string[];
  mediaUrl: string | null;
  mediaKind: MessageKind | null;
  /** header, footer, action (buttons / sections) and the type: what the app has no column for; goes to meta.legacy.interactive. */
  keep: Record<string, unknown>;
}

/** One `{interactive: {type, header, body, footer, action}}` element of a bot reply (button, list, cta_url, flow). */
export function readInteractive(i: Doc): InteractiveRead {
  const parts: string[] = [];
  let mediaUrl: string | null = null;
  let mediaKind: MessageKind | null = null;
  const h = obj(i.header);
  const ht = str(h?.type)?.toLowerCase() ?? null;
  const headerText = h ? textOf(h.text) : null;
  if (headerText) parts.push(headerText);
  if (h && ht && HEADER_MEDIA.has(ht)) {
    const link = h.link ?? obj(h[ht])?.link ?? h.url;
    if (isUrl(link)) {
      mediaUrl = link.trim();
      mediaKind = ht as MessageKind;
    }
  }
  const body = textOf(i.body);
  if (body) parts.push(body);
  const footer = textOf(i.footer);
  if (footer) parts.push(footer);
  const { body: _b, footer: _f, ...keep } = i;
  return { parts, mediaUrl, mediaKind, keep };
}

/**
 * The buttons of a bot reply in the shape the inbox draws under a sent interactive message (`meta.sentInteractive`: type
 * `buttons` | `cta_url`, see the message mapper). `interactive` is what `readInteractive` kept (`meta.legacy.interactive`: one object or
 * an array), `body` the message text, which already holds header, body and footer. Waboo's buttons are `action.buttons[]`, each
 * `{type: link | mobile | flow | live_agent, value: {text, url}}`; the text is the title. One link button alone is a `cta_url`
 * (with its link icon); anything else is a plain list of titles (WaDesk draws no phone / flow button of its own). null: no buttons.
 */
export function sentInteractiveFrom(
  interactive: unknown,
  body: string | null,
): Record<string, unknown> | null {
  const list = Array.isArray(interactive) ? interactive : [interactive];
  for (const el of list) {
    const raw = obj(obj(el)?.action)?.buttons;
    if (!Array.isArray(raw)) continue;
    const buttons = raw
      .map((b) => ({
        type: str(obj(b)?.type),
        // Waboo's own shape is value.text; the Cloud API's is reply.title (a button saved as sent to Meta)
        title: str(obj(obj(b)?.value)?.text) ?? str(obj(obj(b)?.reply)?.title) ?? str(obj(b)?.title),
        url: str(obj(obj(b)?.value)?.url),
      }))
      .filter((b): b is { type: string | null; title: string; url: string | null } => b.title !== null);
    if (buttons.length === 0 || !body) continue;
    const only = buttons[0]!;
    if (buttons.length === 1 && only.type === 'link' && only.url && isUrl(only.url))
      return { type: 'cta_url', body, text: only.title, url: only.url };
    return { type: 'buttons', body, buttons: buttons.map((b) => ({ title: b.title })) };
  }
  return null;
}

/** A `share-location` element: `{type, value: {name, address, latitude, longitude, url}}`. The maps url is NOT a file. */
function readLocation(el: Doc): { parts: string[]; keep: Record<string, unknown> } | null {
  if (str(el.type)?.toLowerCase() !== 'share-location') return null;
  const v = obj(el.value);
  if (!v) return null;
  const parts = [textOf(v.name), textOf(v.address)].filter((x): x is string => x !== null);
  return { parts, keep: { latitude: v.latitude ?? null, longitude: v.longitude ?? null } };
}

const jsonSafe = (v: unknown): unknown => JSON.parse(JSON.stringify(scrub(plain(v)).value ?? null));

/**
 * The title of a tapped button or list row, in the shapes a customer's reply arrives in: `{button_reply: {id, title}}`,
 * `{list_reply: {id, title, description}}`, the same inside `{interactive: ...}`, or `{type: 'button_reply', title}`. null: not a reply.
 */
export function replyTitle(v: unknown, depth = 0): string | null {
  const o = obj(v);
  if (!o || depth > 3) return null;
  for (const k of ['button_reply', 'list_reply']) {
    const r = obj(o[k]);
    const t = r ? (textOf(r.title) ?? textOf(r.text) ?? textOf(r.id)) : null;
    if (t) return t;
  }
  for (const k of ['interactive', 'value', 'message']) {
    const t = replyTitle(o[k], depth + 1);
    if (t) return t;
  }
  const ty = str(o.type)?.toLowerCase();
  if (ty && kindOfType(ty) === 'interactive') return textOf(o.title) ?? textOf(o.payload);
  return null;
}

/** The text of a user `value` that is not a plain string (a button reply object, a number, a list). */
function valueText(v: unknown, soft: Soft[]): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return null;
  const parts: string[] = [];
  collect(v, parts, { url: null });
  if (parts.length === 0) {
    const tapped = replyTitle(v);
    if (tapped) parts.push(tapped);
  }
  soft.push({
    code: 'SHAPE_UNEXPECTED',
    reason: 'user_query_object.value is not a string; its text was read from the nested object',
    detail: { type: Array.isArray(v) ? 'array' : typeof v },
  });
  return parts.length > 0 ? parts.join('\n') : null;
}

export const TOP_KEYS = new Set([
  '_id',
  'botid',
  'session_id',
  'conversation_id',
  'message_id',
  'meta_msg_id',
  'ctype',
  'channel',
  'user',
  'context',
  'createdAt',
  'agent',
  'bot_response',
  'user_query_object',
  'user_query',
  'whatsapp_window',
  'whatapp_start_time',
  'intent',
  'entity',
  'question',
  'qid',
  'session_created_time',
]);

export function parseTurn(doc: Doc): ParsedTurn {
  const soft: Soft[] = [];
  const br = obj(doc.bot_response);
  const uqo = obj(doc.user_query_object);
  const uq = doc.user_query;
  const legacy: Record<string, unknown> = {};
  const hasUq = uq !== undefined && uq !== null && uq !== '';
  const none = (): ParsedTurn => ({
    direction: null,
    kind: 'text',
    senderKind: 'customer',
    body: null,
    mediaUrl: null,
    legacy,
    soft,
    empty: true,
  });
  if (!br && !uqo && !hasUq) return none();

  if (br) {
    if (uqo)
      soft.push({
        code: 'BOTH_DIRECTIONS',
        reason: 'the document has both bot_response and user_query_object; read as the bot turn',
      });
    const ctype = str(doc.ctype)?.toLowerCase();
    const senderKind = ctype === 'livechat' ? 'agent' : 'bot';
    const raw = br.response;
    const parts: string[] = [];
    const media = { url: null as string | null };
    let elements = 0;
    let payload = 0;
    let unexpected = false;
    let hasInteractive = false;
    let iaMediaKind: MessageKind | null = null;
    let elKind: MessageKind | null = null;
    const interactives: Array<Record<string, unknown>> = [];
    const locations: Array<Record<string, unknown>> = [];
    if (raw === undefined || raw === null) unexpected = true;
    else {
      const list = Array.isArray(raw) ? raw : [raw];
      elements = list.length;
      for (const el of list) {
        const eo = obj(el);
        const inter = eo ? obj(eo.interactive) : null;
        const loc = eo ? readLocation(eo) : null;
        if (inter) {
          const r = readInteractive(inter);
          parts.push(...r.parts);
          if (media.url === null && r.mediaUrl) media.url = r.mediaUrl;
          if (r.mediaKind && !iaMediaKind) iaMediaKind = r.mediaKind;
          interactives.push(r.keep);
          hasInteractive = true;
        } else if (loc) {
          parts.push(...loc.parts);
          locations.push(loc.keep);
        } else if (!collect(el, parts, media)) unexpected = true;
        const ek = eo ? kindOfType(eo.type) : null;
        if (ek && ek !== 'text' && !elKind) elKind = ek;
        // a blank string or a null is not a payload; anything else (an object with no text, a button list ...) is
        if (!(el === null || el === undefined || (typeof el === 'string' && el.trim() === '')))
          payload++;
      }
      if (!Array.isArray(raw))
        soft.push({
          code: 'SHAPE_UNEXPECTED',
          reason: 'bot_response.response is not an array; read as a single element',
          detail: { type: typeof raw },
        });
    }
    if (unexpected && raw !== undefined && raw !== null)
      soft.push({
        code: 'SHAPE_UNEXPECTED',
        reason:
          'an element of bot_response.response could not be read; the payload stays in meta.legacy.response',
      });
    const body = parts.length > 0 ? parts.join('\n') : null;
    const typeRaw = str(br.type);
    let kind: MessageKind = 'text';
    const known = kindOfType(typeRaw);
    if (hasInteractive) {
      // a header file makes it that file's message (the text is its caption); no file: an interactive message
      kind = iaMediaKind ?? 'interactive';
    } else if (known) kind = known;
    else {
      if (typeRaw && !ORIGIN_TYPES.has(typeRaw.toLowerCase()))
        soft.push({
          code: 'UNKNOWN_KIND',
          reason: 'bot_response.type is not a kind this tool knows; stored as text',
          detail: typeRaw,
        });
      kind = elKind ?? (media.url ? kindOfUrl(media.url) : 'text');
    }
    if (br.subType !== undefined && br.subType !== null) legacy.subType = plain(br.subType);
    legacy.response = jsonSafe(br);
    if (media.url) legacy.mediaUrl = media.url;
    if (interactives.length > 0)
      legacy.interactive = jsonSafe(interactives.length === 1 ? interactives[0] : interactives);
    if (locations.length > 0) legacy.location = jsonSafe(locations[0]);
    const hasPayload = elements > 0 && payload > 0;
    const empty = body === null && media.url === null && !hasPayload;
    if (!empty && body === null && media.url === null)
      soft.push({
        code: 'NO_TEXT',
        reason: 'the bot turn has a response payload but no text; body left empty',
      });
    return { direction: 'out', kind, senderKind, body, mediaUrl: media.url, legacy, soft, empty };
  }

  // a user turn
  let body: string | null = null;
  let kind: MessageKind = 'text';
  let senderKind: ParsedTurn['senderKind'] = 'customer';
  let mediaUrl: string | null = null;
  const rich = uqo ?? (obj(uq) && ('value' in obj(uq)! || 'type' in obj(uq)!) ? obj(uq) : null);
  if (rich) {
    body = valueText(rich.value, soft);
    const known = kindOfType(rich.type);
    if (known) kind = known;
    else if (str(rich.type)) {
      soft.push({
        code: 'UNKNOWN_KIND',
        reason: 'user_query_object.type is not a kind this tool knows; stored as text',
        detail: str(rich.type),
      });
    }
    const { value: _v, ...restQuery } = rich;
    const q =
      typeof rich.value === 'string' || rich.value === undefined
        ? restQuery
        : { ...restQuery, value: rich.value };
    if (Object.keys(q).length > 0) legacy.query = jsonSafe(q);
    if (str(rich.fromAgent) || str(rich.toAgent)) {
      senderKind = 'system';
      kind = 'system';
      body = 'Chat transferred';
      legacy.transfer = jsonSafe({
        from: rich.fromAgent ?? null,
        to: rich.toAgent ?? null,
        username: rich.username ?? null,
      });
    }
    if (uqo && obj(uq)) legacy.userQuery = jsonSafe(uq);
    else if (uqo && typeof uq === 'string' && body === null)
      body = uq.trim() === '' ? null : uq.trim();
  } else if (typeof uq === 'string') {
    body = uq.trim() === '' ? null : uq.trim();
  } else if (obj(uq)) {
    const u = obj(uq)!;
    const text = typeof u.text === 'string' && u.text.trim() !== '' ? u.text : null;
    body = text ?? replyTitle(u);
    if (body !== null && text === null) kind = 'interactive';
    if (isUrl(u.url)) {
      mediaUrl = u.url.trim();
      kind = kindOfUrl(mediaUrl);
      legacy.mediaUrl = mediaUrl;
    } else if (u.url !== undefined && u.url !== null && u.url !== '') {
      soft.push({
        code: 'SHAPE_UNEXPECTED',
        reason: 'user_query.url is not an http(s) url; kept in meta.legacy.query',
      });
      legacy.query = jsonSafe(u);
    }
  } else if (uq !== undefined && uq !== null) {
    body = String(uq);
    soft.push({
      code: 'SHAPE_UNEXPECTED',
      reason: 'user_query is neither a string nor an object; read as text',
      detail: { type: typeof uq },
    });
  }
  if (rich && !mediaUrl) {
    const u = obj(rich.value) ?? rich;
    const url = Object.entries(u).find(([k, v]) => URL_KEYS.includes(k) && isUrl(v))?.[1];
    if (typeof url === 'string') {
      mediaUrl = url.trim();
      legacy.mediaUrl = mediaUrl;
      if (kind === 'text') kind = kindOfUrl(mediaUrl);
    }
  }
  const empty =
    (body === null || body.trim() === '') && mediaUrl === null && senderKind !== 'system';
  return { direction: 'in', kind, senderKind, body, mediaUrl, legacy, soft, empty };
}

/** The first of these that is a readable Date, as written in the dump. */
export const createdAtOf = (doc: Doc): Date | null => toDate(doc.createdAt);
