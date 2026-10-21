/**
 * INDEPENDENT oracle for the inbox step (chathistory -> conversations / messages / message_ledger), written for the verifier.
 * It imports nothing from transform/, inbox/ or load/ (no plan, no parser, no peer-key code): the rules of spec A are written down a
 * second time here, deliberately simpler (a plain digits rule for the phone, a body rule for the shapes that are certain), so a bug or a
 * "fix" in the loader's version makes the target disagree with this one and reconcile fails. Shared on purpose: the pure helper
 * `uuidv5` of util.ts (a hash) and this folder's date / text helpers.
 *
 * What it does NOT decide: the body and the kind of a turn whose shape is not one of the certain ones (the unverified
 * `bot_response.response[]` shapes). Those turns are counted as `unchecked` and reported, never guessed.
 */
import { createHash } from 'node:crypto';
import { uuidv5 } from '../util';
import { dateOf, hexKey, text } from './oracle';

type Doc = Record<string, unknown>;

export interface OracleOptions {
  client: string;
  /** botid -> phone number id, as given in the channel map */
  botToExt: Map<string, string>;
  keepDeletedContactChats: boolean;
  threadStatus: 'waboo' | 'closed';
  /** visitor_logs: session_id -> its current conversation_status and recency (written from the README, "Chat") */
  sessionStatus: Map<string, { status: string; ms: number }>;
  assignAgents: boolean;
  windowHours: number;
  /** the dump time: the partition window is measured from it */
  referenceAt: string;
  /** keys (ObjectId hex and string id) of the contacts soft-deleted at the source */
  deletedContacts: Set<string>;
  /** source key of a migrated contact -> contacts.id (from migration.id_map) */
  contactId(key: string): number | undefined;
  /** source key of a migrated user -> users.id */
  userId(key: string): number | undefined;
  hasUsers: boolean;
  /** digits of normalized_phone -> contacts with that number */
  contactsByDigits: Map<string, { n: number; id: number }>;
  /** `${ext}|${peer}` -> uuid of the conversation that exists in the target (any origin) */
  existingThreads: Map<string, string>;
  /**
   * Is this chathistory document already a message in the target (migration.id_map)? Needed only to read the state AFTER an append:
   * a loaded thread whose newer turns all sort after its loaded ones is expected to hold ALL of them (what a fresh load would make);
   * one that has a turn sorting BEFORE a loaded one is expected to be left as loaded, that turn quarantined APPEND_OUT_OF_ORDER.
   * Left out: nothing is loaded yet (a fresh load).
   */
  loaded?(key: string): boolean;
}

export interface OMessage {
  key: string;
  verdict: 'load' | 'exclude' | 'quarantine' | 'engine';
  code?: string;
  thread?: string;
  seq?: number;
  at?: string;
  direction?: 'in' | 'out';
  senderKind?: 'customer' | 'agent' | 'bot' | 'system';
  /** md5 of the expected body, undefined when the shape is not one of the certain ones */
  bodyMd5?: string;
  /** expected kind, only for a turn with an interactive element: the header file's kind, else 'interactive' */
  kind?: string;
  /** the body, whitespace collapsed and cut at 200 characters: the expected preview when this is the last message */
  bodyHead?: string;
  /** the provider id as the ledger would hold it (<= 512 characters), else null */
  provider?: string | null;
  /** messages.provider_message_id */
  providerCol?: string | null;
  ledger?: boolean;
  /** peer digits as the plain rule reads them, for the allowed-disagreement list */
  rawDigits?: string;
}

export interface OThread {
  key: string;
  uuid: string;
  ext: string;
  peer: string;
  rawDigits: string;
  count: number;
  firstAt: string;
  lastAt: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  windowExpiresAt: string | null;
  status: 'open' | 'closed';
  resolvedAt: string | null;
  peerName: string | null;
  title: string;
  contactId: number | null;
  contactViaPhone: boolean;
  assigneeId: number | null;
  /** how many of the thread's expected messages are already in the target (only when `loaded` was given) */
  loadedCount: number;
  lastKey: string;
  /** expected conversations.preview, or undefined when the last message's body is not certain */
  preview?: string;
  keys: string[];
}

export interface OracleResult {
  messages: Map<string, OMessage>;
  threads: Map<string, OThread>;
  unchecked: number;
  range: { min: string; max: string } | null;
  /** thread keys that already exist, hold a turn sorting before a loaded one, and are therefore expected to stay as loaded */
  outOfOrder: string[];
}

const md5 = (s: string): string => createHash('md5').update(s).digest('hex');
const isObj = (v: unknown): v is Doc =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

export const oracleKey = (d: Doc): string => hexKey(d._id) || text(d.id);

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
/** What PostgreSQL cannot store: the engine quarantines such a document before any handler runs (written again here, not imported). */
function unstorable(v: unknown): boolean {
  if (typeof v === 'string') return v.includes(String.fromCharCode(0)) || LONE_SURROGATE.test(v);
  if (Array.isArray(v)) return v.some(unstorable);
  if (isObj(v)) return Object.entries(v).some(([k, x]) => unstorable(k) || unstorable(x));
  return false;
}

const TEXT_KEYS = ['text', 'message', 'body', 'caption', 'content', 'value', 'title'];
const URL_KEYS = ['url', 'link', 'image', 'video', 'audio', 'document', 'file', 'media', 'src'];
const blank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const httpUrl = (v: unknown): boolean => typeof v === 'string' && /^https?:\/\//i.test(v.trim());

/**
 * Is there anything to show in this payload (a user `value` object / array, an element of `response[]`)? Written again here:
 * 'text' = a non-blank string, number or boolean under a text key (or a bare one), 'media' = an http(s) url under a url key
 * (directly or one object down), 'none' = neither at any depth, 'unsure' = a text key holds something nested deeper than this reads.
 */
function content(v: unknown, depth = 0): 'text' | 'media' | 'none' | 'unsure' {
  if (typeof v === 'string') return v.trim() === '' ? 'none' : 'text';
  if (typeof v === 'number' || typeof v === 'boolean') return 'text';
  if (Array.isArray(v)) {
    if (depth >= 3) return 'unsure';
    let r: ReturnType<typeof content> = 'none';
    for (const x of v) {
      const c = content(x, depth + 1);
      if (c === 'text') return 'text';
      if (c === 'unsure' || (c === 'media' && r === 'none')) r = c;
    }
    return r;
  }
  if (!isObj(v)) return 'none';
  let r: ReturnType<typeof content> = 'none';
  for (const k of TEXT_KEYS) {
    const x = v[k];
    if (typeof x === 'string' && x.trim() !== '') return 'text';
    if (isObj(x) || Array.isArray(x)) {
      const c = depth < 3 ? content(x, depth + 1) : 'unsure';
      if (c === 'text') return 'text';
      if (c !== 'none') r = c;
    }
  }
  for (const k of URL_KEYS) {
    const x = v[k];
    if (httpUrl(x) || (isObj(x) && Object.values(x).some(httpUrl))) {
      if (r === 'none') r = 'media';
    }
  }
  return r;
}

/** A string, or an object's `text` / `body` string, when it is not blank; '' otherwise. */
const shown = (v: unknown): string => {
  if (typeof v === 'string') return v.trim() === '' ? '' : v;
  if (isObj(v)) {
    const x = v.text ?? v.body;
    return typeof x === 'string' && x.trim() !== '' ? x : '';
  }
  return '';
};
/** What an `{interactive: {header, body, footer, action}}` element shows as text: the header's text, the body, the footer. Buttons are not text. */
function interactiveKind(i: Record<string, unknown>): string {
  const h = isObj(i.header) ? i.header : null;
  const t = typeof h?.type === 'string' ? h.type.toLowerCase() : '';
  const link = h ? (h.link ?? (isObj(h[t]) ? h[t].link : undefined) ?? h.url) : undefined;
  return ['image', 'video', 'document'].includes(t) && httpUrl(link) ? t : 'interactive';
}
function interactiveParts(i: Record<string, unknown>): string[] {
  const h = isObj(i.header) ? i.header : null;
  return [h ? shown(h.text) : '', shown(i.body), shown(i.footer)].filter((x) => x !== '');
}

/**
 * The certain body of a turn, or undefined. `empty` is true only when the shape is certain AND there is nothing to show (no text and
 * no media): such a turn is not a message and takes no seq. A turn whose text/media status is 'unsure' is never called empty.
 */
function certainBody(doc: Doc): {
  body?: string;
  kind?: string;
  empty?: boolean;
  dir: 'in' | 'out' | null;
  system?: boolean;
} {
  const br = doc.bot_response;
  const uqo = doc.user_query_object;
  const uq = doc.user_query;
  if (isObj(br)) {
    const raw = br.response;
    const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
    const parts: string[] = [];
    let present = false;
    let sure = true;
    let kind: string | undefined;
    for (const el of list) {
      if (blank(el)) continue;
      present = true; // anything but null or a blank string is a payload (a button list, an object with no text ...)
      if (typeof el === 'string') parts.push(el);
      else if (isObj(el) && isObj(el.interactive)) {
        parts.push(...interactiveParts(el.interactive));
        const k = interactiveKind(el.interactive);
        if (kind === undefined || kind === 'interactive') kind = k;
      } else if (isObj(el) && el.type === 'share-location' && isObj(el.value))
        parts.push(...[el.value.name, el.value.address].map(shown).filter((x) => x !== ''));
      else if (isObj(el) && typeof el.text === 'string' && el.text.trim() !== '')
        parts.push(el.text);
      else if (
        isObj(el) &&
        text(el.type).toLowerCase() === 'text' &&
        typeof el.value === 'string' &&
        el.value.trim() !== '' &&
        Object.keys(el).every((k) => k === 'id' || k === 'type' || k === 'value')
      )
        parts.push(el.value); // {id?, type: 'text', value: '...'}: 10,483 of Karma's 10,599 otherwise-unverified turns
      else sure = false; // a body is only certain for a plain string or a non-blank `text` / `value` of a text element
    }
    if (!present) return { dir: 'out', empty: true };
    // a live-chat hand-over event: {type: 'info', value} elements of a turn flagged live_chat_connected, read as a system notice
    if (br.live_chat_connected === true) {
      // the agent-side twin ("You are now Connected to <agent>", isUser false) is not a message: the thread shows the customer-side line only
      if (
        list.length > 0 &&
        list.every((el) => isObj(el) && el.type === 'info' && el.isUser === false)
      )
        return { dir: 'out', empty: true };
      const info = list
        .filter(
          (el) =>
            isObj(el) &&
            el.type === 'info' &&
            typeof el.value === 'string' &&
            el.value.trim() !== '',
        )
        .map((el) => (el as { value: string }).value);
      return info.length > 0
        ? { dir: 'out', body: info.join('\n'), system: true, kind: 'system' }
        : { dir: 'out', system: true, kind: 'system' };
    }
    return parts.length > 0 && sure ? { dir: 'out', body: parts.join('\n') } : { dir: 'out' };
  }
  const uqText = typeof uq === 'string' && uq.trim() !== '' ? uq.trim() : null;
  if (isObj(uqo)) {
    if (text(uqo.fromAgent) !== '' || text(uqo.toAgent) !== '')
      return { dir: 'in', body: 'Chat transferred', system: true };
    const v = uqo.value;
    if (typeof v === 'string' && v.trim() !== '') return { dir: 'in', body: v };
    // value is blank or absent, or an object / array: empty when nothing in it, nor a url next to it, nor a text user_query shows
    const anyUrl = Object.values(uqo).some(httpUrl);
    const c = blank(v) ? 'none' : content(v);
    if (c === 'none' && !anyUrl)
      return uqText !== null ? { dir: 'in', body: uqText } : { dir: 'in', empty: true };
    return { dir: 'in' };
  }
  if (uq !== undefined && uq !== null && uq !== '') {
    if (typeof uq === 'string')
      return uq.trim() === '' ? { dir: 'in', empty: true } : { dir: 'in', body: uq.trim() };
    return { dir: 'in' };
  }
  return { dir: null };
}

/** The plain digits rule: the part before @ and :, digits only; a leading 00 is an international prefix. */
function peerDigits(raw: unknown): { raw: string; canon: string } | null {
  const t = text(raw);
  if (t === '') return null;
  const user = (t.split('@')[0] ?? '').split(':')[0] ?? '';
  if (!/^[+\d\s().-]+$/.test(user)) return null; // a visitor id is not a phone number
  const dg = user.replace(/\D/g, '');
  if (dg === '') return null;
  const canon = dg.length > 2 && dg.startsWith('00') ? dg.slice(2) : dg;
  if (canon.length < 4 || canon.length > 20) return null;
  return { raw: dg, canon };
}

function window(referenceAt: string): { lo: number; hi: number } {
  const r = new Date(referenceAt);
  return {
    lo: Date.UTC(r.getUTCFullYear() - 10, r.getUTCMonth(), 1),
    hi: Date.UTC(r.getUTCFullYear() + 1, r.getUTCMonth() + 1, 1),
  };
}

interface Rec {
  key: string;
  ms: number;
  ext: string;
  peer: string;
  rawDigits: string;
  dir: 'in' | 'out';
  sender: 'customer' | 'agent' | 'bot' | 'system';
  dupKey: string | null;
  sig: string;
  provider: string | null;
  name: string | null;
  statusRaw: string | null;
  session: string | null;
  agentId: string | null;
  contactCands: string[];
}

/** The first n UTF-16 units, not ending in half an emoji (the rule of the loader: a lone surrogate is not valid JSON for Postgres). Own copy: the oracle shares no code with the loader. */
const head = (s: string, n: number): string => {
  if (s.length <= n) return s;
  const c = s.charCodeAt(n - 1);
  return s.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n);
};

export async function oracleChat(
  docs: AsyncIterable<Doc>,
  o: OracleOptions,
): Promise<OracleResult> {
  const messages = new Map<string, OMessage>();
  const byThread = new Map<string, Rec[]>();
  const w = window(o.referenceAt);
  const seen = new Set<string>();
  let unchecked = 0;

  for await (const doc of docs) {
    const key = oracleKey(doc);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    if (unstorable(doc)) {
      messages.set(key, { key, verdict: 'engine' });
      continue;
    }
    const q = (code: string): void => {
      messages.set(key, { key, verdict: 'quarantine', code });
    };
    const channel = (text(doc.channel) || 'whatsapp').toLowerCase();
    if (['website', 'web', 'webchat'].includes(channel)) {
      q('WEBCHAT_NO_CHANNEL');
      continue;
    }
    if (channel !== 'whatsapp' && channel !== 'wa') {
      q('UNSUPPORTED_CHANNEL');
      continue;
    }
    const botid = text(doc.botid);
    const ext = botid === '' ? undefined : o.botToExt.get(botid);
    if (ext === undefined) {
      q('NO_CHANNEL');
      continue;
    }
    const at = dateOf(doc.createdAt);
    const monthStart = at ? Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1) : NaN;
    if (!at || monthStart < w.lo || monthStart >= w.hi) {
      q('BAD_DATE');
      continue;
    }
    const user = isObj(doc.user) ? doc.user : {};
    const context = isObj(doc.context) ? doc.context : {};
    let peer: { raw: string; canon: string } | null = null;
    for (const c of [user.mobile, context.visitor_phone, context.mobile_phone_number, user.user]) {
      peer = peerDigits(c);
      if (peer) break;
    }
    if (!peer) {
      q('NO_PEER');
      continue;
    }
    let cb = certainBody(doc);
    // a customer turn with a typed query object but no content is loaded as a placeholder (inbox/parse.ts CONTENT_UNAVAILABLE)
    if (
      cb.empty &&
      cb.dir === 'in' &&
      !isObj(doc.bot_response) &&
      isObj(doc.user_query_object) &&
      Object.keys(doc.user_query_object).length > 0
    )
      cb = { dir: 'in', body: '(message content not available)', kind: 'text' };
    if (cb.dir === null || cb.empty) {
      q('EMPTY_MESSAGE');
      continue;
    }
    const ctype = text(doc.ctype).toLowerCase();
    const sender = cb.system
      ? 'system'
      : cb.dir === 'out'
        ? ctype === 'livechat'
          ? 'agent'
          : 'bot'
        : 'customer';
    const msgId = text(doc.message_id);
    const agent = isObj(doc.agent) ? doc.agent : null;
    const provider = text(doc.meta_msg_id);
    const rec: Rec = {
      key,
      ms: at.getTime(),
      ext,
      peer: peer.canon,
      rawDigits: peer.raw,
      dir: cb.dir,
      sender,
      dupKey: msgId ? `${text(doc.session_id)}\u0000${msgId}\u0000${cb.dir}` : null,
      // an unreadable body never equals another: a duplicate is only called when the shape is certain
      sig: md5(`${cb.body ?? `?${key}`}\u0000${at.getTime()}`),
      provider: provider !== '' && provider.length <= 512 ? provider : null,
      name: text(context.visitor_name) || null,
      statusRaw: text(user.conversation_status).toLowerCase() || null,
      session: text(doc.session_id) || null,
      agentId: agent ? text(agent.id) || null : null,
      contactCands: [text(user.contact_id), text(context.contact_id)].filter((x) => x !== ''),
    };
    const tk = `${ext}|${peer.canon}`;
    byThread.set(tk, [...(byThread.get(tk) ?? []), rec]);
    // the verdict is final only after the thread-level rules below
    messages.set(key, {
      key,
      verdict: 'load',
      thread: tk,
      direction: cb.dir,
      senderKind: sender,
      bodyMd5: cb.body === undefined ? undefined : md5(cb.body),
      kind: cb.kind,
      bodyHead: cb.body === undefined ? undefined : head(cb.body.replace(/\s+/g, ' ').trim(), 200),
      provider: rec.provider,
      providerCol: provider || null,
      rawDigits: peer.raw,
    });
    if (cb.body === undefined) unchecked++;
  }

  const threads = new Map<string, OThread>();
  const providerOwner = new Set<string>();
  const outOfOrder: string[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (const tk of [...byThread.keys()].sort()) {
    const all = byThread
      .get(tk)!
      .sort((a, b) => a.ms - b.ms || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const ext = all[0]!.ext;
    const peer = all[0]!.peer;
    const uuid = uuidv5(`${o.client}|chat_thread|whatsapp_cloud|${ext}|${peer}`);
    const setAll = (verdict: 'exclude' | 'quarantine', code: string): void => {
      for (const r of all) messages.set(r.key, { key: r.key, verdict, code });
    };
    // the contact: newest turn first; a migrated contact wins, a deleted one excludes the thread
    let contactId: number | null = null;
    let deleted = false;
    outer: for (let i = all.length - 1; i >= 0; i--) {
      for (const cand of all[i]!.contactCands) {
        const id = o.contactId(cand);
        if (id !== undefined) {
          contactId = id;
          break outer;
        }
        if (o.deletedContacts.has(cand)) {
          deleted = true;
          break outer;
        }
      }
    }
    if (deleted && !o.keepDeletedContactChats) {
      setAll('exclude', 'CONTACT_DELETED_AT_SOURCE');
      continue;
    }
    const have = o.existingThreads.get(tk);
    if (have !== undefined && have !== uuid) {
      setAll('quarantine', 'THREAD_HAS_LIVE_MESSAGES');
      continue;
    }
    let kept: Rec[] = [];
    const sigs = new Map<string, string[]>();
    for (const r of all) {
      if (r.dupKey !== null && (sigs.get(r.dupKey) ?? []).includes(r.sig)) {
        messages.set(r.key, { key: r.key, verdict: 'exclude', code: 'DUPLICATE_MESSAGE' });
        continue;
      }
      if (r.dupKey !== null) sigs.set(r.dupKey, [...(sigs.get(r.dupKey) ?? []), r.sig]);
      kept.push(r);
    }
    // a loaded thread with newer turns: they must all come after the loaded ones, else the thread stays as loaded (never guessed)
    let loadedCount = 0;
    if (o.loaded && have === uuid) {
      const flags = kept.map((r) => o.loaded!(r.key));
      const n = flags.filter(Boolean).length;
      loadedCount = n;
      if (n > 0 && n < kept.length && !flags.every((f, i) => f === i < n)) {
        for (const r of kept)
          if (!o.loaded(r.key))
            messages.set(r.key, { key: r.key, verdict: 'quarantine', code: 'APPEND_OUT_OF_ORDER' });
        kept = kept.filter((r) => o.loaded!(r.key));
        loadedCount = kept.length;
        outOfOrder.push(tk);
      }
    }
    let viaPhone = false;
    if (contactId === null) {
      const hit = o.contactsByDigits.get(peer);
      if (hit && hit.n === 1) {
        contactId = hit.id;
        viaPhone = true;
      }
    }
    kept.forEach((r, i) => {
      const m = messages.get(r.key)!;
      m.seq = i + 1;
      m.at = new Date(r.ms).toISOString();
      m.ledger = false;
      if (r.provider !== null) {
        const lk = `${r.ext}\u0000${r.provider}`;
        if (!providerOwner.has(lk)) {
          providerOwner.add(lk);
          m.ledger = true;
        }
      }
      min = Math.min(min, r.ms);
      max = Math.max(max, r.ms);
    });
    const last = kept[kept.length - 1]!;
    const newestWith = (f: (r: Rec) => boolean): Rec | undefined => [...kept].reverse().find(f);
    const nm = newestWith((r) => r.name !== null);
    // README "Chat": the status of the thread's newest visitor_logs session wins; the newest turn that names one is the fallback
    let live: { status: string; ms: number } | null = null;
    for (const r of kept) {
      const v = r.session !== null ? o.sessionStatus.get(r.session) : undefined;
      if (v && (live === null || v.ms > live.ms)) live = v;
    }
    const st = live?.status ?? newestWith((r) => r.statusRaw !== null)?.statusRaw ?? null;
    const status: 'open' | 'closed' =
      o.threadStatus === 'closed' || st === 'closed' ? 'closed' : 'open';
    const ag = newestWith((r) => r.agentId !== null);
    let assigneeId: number | null = null;
    if (ag && o.assignAgents && o.hasUsers) assigneeId = o.userId(ag.agentId!) ?? null;
    const cin = newestWith((r) => r.dir === 'in' && r.sender === 'customer');
    const cout = newestWith((r) => r.dir === 'out');
    const lastMsg = messages.get(last.key)!;
    threads.set(tk, {
      key: tk,
      uuid,
      ext,
      peer,
      rawDigits: all[0]!.rawDigits,
      count: kept.length,
      firstAt: new Date(kept[0]!.ms).toISOString(),
      lastAt: new Date(last.ms).toISOString(),
      lastInboundAt: cin ? new Date(cin.ms).toISOString() : null,
      lastOutboundAt: cout ? new Date(cout.ms).toISOString() : null,
      windowExpiresAt: cin ? new Date(cin.ms + o.windowHours * 3_600_000).toISOString() : null,
      status,
      resolvedAt: status === 'closed' ? new Date(last.ms).toISOString() : null,
      peerName: nm?.name ?? null,
      title: nm?.name ? head(nm.name, 200) : `+${peer}`,
      contactId,
      contactViaPhone: viaPhone,
      assigneeId,
      loadedCount,
      lastKey: last.key,
      preview:
        lastMsg.bodyHead !== undefined && lastMsg.bodyHead !== '' ? lastMsg.bodyHead : undefined,
      keys: kept.map((r) => r.key),
    });
  }
  return {
    messages,
    threads,
    unchecked,
    range: Number.isFinite(min)
      ? { min: new Date(min).toISOString(), max: new Date(max).toISOString() }
      : null,
    outOfOrder,
  };
}
