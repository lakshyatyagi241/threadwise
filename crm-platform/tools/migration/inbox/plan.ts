import { createHash } from 'node:crypto';
import type { Source } from '../extract/source';
import type { Soft, TargetRef } from '../transform/types';
import { badText, docKeys, plain, primaryKey, scrub, str, uuidv5, type Doc } from '../util';
import type { InboxSettings } from './config';
import { createdAtOf, obj, parseTurn } from './parse';
import { defaultTitle, normalizePeerKey, previewOf } from './peer';

/**
 * Pass 1 of the inbox step (spec A 2.5): every chathistory document is classified once, from the dump alone plus a few lookups the caller
 * reads from the target (contacts by phone, threads that already exist). The result is a plain, deterministic plan:
 *   - which documents are quarantined or excluded and why,
 *   - which thread (channel number + peer) each remaining document belongs to, and its `seq`,
 *   - everything a conversation row needs (counters, last_message_*, window, preview ...), computed BEFORE any insert so no UPDATE is
 *     ever needed (touch_row would stamp updated_at / row_version).
 * The loader and the verifier both build it, the verifier's independent oracle (reconcile/oracle-chat.ts) recomputes it a second time.
 */
export const CHANNEL_KIND = 'whatsapp_cloud';

export interface DocPlan {
  key: string;
  state: 'thread' | 'exclude' | 'quarantine';
  code?: string;
  reason?: string;
  thread?: string;
  seq?: number;
  /** messages.created_at (ISO, ms). */
  at?: string;
  /** message_ledger key (channel-scoped provider id) when this message owns one. */
  ledgerKey?: string | null;
  /** Soft issues decided by the plan (thread-level ones sit on the thread's first document). */
  softs: Soft[];
  offset: number;
  length: number;
}

export interface ThreadRec {
  key: string;
  uuid: string;
  ext: string;
  peerKey: string;
  peerName: string | null;
  title: string;
  contactId: number | null;
  contactVia: 'ref' | 'phone' | 'none';
  status: 'open' | 'closed';
  assigneeId: number | null;
  routingMeta: Record<string, unknown>;
  preview: string;
  createdAt: string;
  lastMessageAt: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  windowExpiresAt: string | null;
  resolvedAt: string | null;
  msgSeq: number;
  /**
   * How many of the thread's messages are already in the target (the first `loaded` of the docs, a prefix by the seq rule): 0 for a
   * thread that is loaded whole by this run, msgSeq for a thread with nothing to do, in between for an APPEND (only the docs after
   * the loaded prefix are inserted; the conversation row is then updated with the counters of the whole thread).
   */
  loaded: number;
  /** doc keys in seq order */
  docs: string[];
  lastDoc: string;
  botids: string[];
}

export interface ChatPlan {
  settings: InboxSettings;
  docs: Map<string, DocPlan>;
  threads: Map<string, ThreadRec>;
  /** Sorted thread keys: the load order. */
  order: string[];
  /** Filled in by the loader once the channels exist: phone number id -> channels.id. */
  channelIds: Map<string, number>;
  unmapped: Map<string, number>;
  /** Threads whose rows are half there (never loaded, the run aborts). */
  partial: string[];
  /**
   * Threads that already exist in the target and now hold a turn that sorts BEFORE a loaded one (appending it would break the seq
   * rule). They are left exactly as loaded; their unloaded turns are quarantined APPEND_OUT_OF_ORDER. Entries are thread keys.
   */
  outOfOrder: string[];
  range: { min: string; max: string } | null;
  fingerprint: string;
  /** Source docs by plan state, for the log. */
  tally: Record<string, number>;
}

export interface PlanInput {
  source: Source;
  client: string;
  settings: InboxSettings;
  /** Reference time for the partition window (the dump's generatedAt: stable across runs). */
  referenceAt: string;
  ref(collection: string, key: unknown): TargetRef | undefined;
  contactDeleted: Set<string>;
  hasUsers: boolean;
  /** digits of normalized_phone -> how many contacts, and the id of one. */
  contactsByDigits: Map<string, { n: number; id: number }>;
  /** `${externalId}|${peerKey}` -> uuid of the conversation that exists in the target. */
  existingThreads: Map<string, string>;
  /** Whether this chathistory document is already in migration.id_map. */
  migrated(key: string): boolean;
  /**
   * `${externalId}\u0000${provider id}` of the message_ledger rows that exist in the target. A turn added to a loaded thread whose
   * provider id is already owned there gets no ledger row (soft DUP_PROVIDER_ID), as in a load where the owner came first.
   * Left out (a fresh load, tests): ids are only compared among the documents of this run.
   */
  ledgerOwned?: Set<string>;
}

interface Cand {
  key: string;
  ms: number;
  ext: string;
  peerKey: string;
  direction: 'in' | 'out';
  senderKind: string;
  kind: string;
  hash: string;
  dupKey: string | null;
  providerId: string | null;
  peerName: string | null;
  statusRaw: string | null;
  stateRaw: string | null;
  agentId: string | null;
  agentName: string | null;
  contactCands: string[];
  botid: string;
  sessionId: string | null;
  preview: string;
  offset: number;
  length: number;
}

const md5 = (s: string): string => createHash('md5').update(s).digest('hex');
const monthStart = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);

/** The window ensure_monthly_partition accepts (10 years back to 1 year ahead), measured from the dump time. */
export function partitionWindow(referenceAt: string): { lo: number; hi: number } {
  const ref = new Date(referenceAt);
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  return { lo: Date.UTC(y - 10, m, 1), hi: Date.UTC(y + 1, m + 1, 1) };
}

export const threadUuid = (client: string, ext: string, peerKey: string): string =>
  uuidv5(`${client}|chat_thread|${CHANNEL_KIND}|${ext}|${peerKey}`);

export const channelUuid = (client: string, ext: string): string =>
  uuidv5(`${client}|chat_channel|${CHANNEL_KIND}|${ext}`);

function peerOf(doc: Doc): string | null {
  const user = obj(doc.user);
  const ctx = obj(doc.context);
  for (const raw of [user?.mobile, ctx?.visitor_phone, ctx?.mobile_phone_number, user?.user]) {
    const s = str(raw);
    if (!s) continue;
    // a visitor id with a few digits in it ("visitor-1f3a...") is not a phone number: only phone-looking text is a peer
    if (!/^[+\d\s().-]+$/.test((s.split('@')[0] ?? '').split(':')[0] ?? '')) continue;
    const k = normalizePeerKey(CHANNEL_KIND, s);
    if (k) return k;
  }
  return null;
}

export async function buildChatPlan(a: PlanInput): Promise<ChatPlan> {
  const { settings } = a;
  const docs = new Map<string, DocPlan>();
  const unmapped = new Map<string, number>();
  const tally: Record<string, number> = {};
  const cands = new Map<string, Cand[]>(); // thread key -> candidates (file order)
  const win = partitionWindow(a.referenceAt);
  const seenKeys = new Set<string>();
  const hash = createHash('sha256');

  const reject = (
    key: string,
    state: 'exclude' | 'quarantine',
    code: string,
    reason: string,
    pos: { offset: number; length: number },
  ): void => {
    docs.set(key, { key, state, code, reason, softs: [], ...pos });
  };

  // ---- pass 1: classify every document, keep a small record for the eligible ones ----------------------------------------------
  const stream = a.source.readIndexed;
  if (!stream)
    throw new Error('INBOX: this source cannot read documents by position (readIndexed)');
  for await (const { doc, offset, length } of stream.call(a.source, a.client, 'chathistory')) {
    const keys = docKeys(doc);
    if (keys.length === 0) continue; // NO_KEY: the engine handles it before the transform
    const key = primaryKey(doc);
    if (seenKeys.has(key)) continue; // a repeated primary key: the engine quarantines the later one (DUPLICATE_KEY)
    seenKeys.add(key);
    const pos = { offset, length };
    if (badText(doc)) continue; // NUL / lone surrogate: transformDoc quarantines it before any handler

    const channel = (str(doc.channel) ?? 'whatsapp').toLowerCase();
    if (channel === 'website' || channel === 'web' || channel === 'webchat') {
      reject(
        key,
        'quarantine',
        'WEBCHAT_NO_CHANNEL',
        'website chat needs a webchat channel (a widget) that does not exist yet (Q6)',
        pos,
      );
      continue;
    }
    if (channel !== 'whatsapp' && channel !== 'wa') {
      reject(
        key,
        'quarantine',
        'UNSUPPORTED_CHANNEL',
        `channel "${channel.slice(0, 40)}" is not whatsapp`,
        pos,
      );
      continue;
    }
    const botid = str(doc.botid);
    const entry = botid ? settings.map[botid] : undefined;
    if (!entry) {
      unmapped.set(botid ?? '(none)', (unmapped.get(botid ?? '(none)') ?? 0) + 1);
      reject(key, 'quarantine', 'NO_CHANNEL', 'the botid is not in the channel map', pos);
      continue;
    }
    const at = createdAtOf(doc);
    if (!at || monthStart(at) < win.lo || monthStart(at) >= win.hi) {
      reject(
        key,
        'quarantine',
        'BAD_DATE',
        at
          ? 'createdAt is outside the partition window (10 years back, 1 year ahead)'
          : 'createdAt is missing or not a readable date',
        pos,
      );
      continue;
    }
    const peerKey = peerOf(doc);
    if (!peerKey) {
      reject(key, 'quarantine', 'NO_PEER', 'no usable phone number for the turn', pos);
      continue;
    }
    const turn = parseTurn(doc);
    if (turn.direction === null || turn.empty) {
      reject(key, 'quarantine', 'EMPTY_MESSAGE', 'no text, media or recognisable payload', pos);
      continue;
    }

    const user = obj(doc.user);
    const context = obj(doc.context);
    const agent = obj(doc.agent);
    const sessionId = str(doc.session_id);
    const messageId = str(doc.message_id);
    const body = turn.body ?? '';
    const provider = str(doc.meta_msg_id);
    const contactCands = [str(user?.contact_id), str(context?.contact_id)].filter(
      (x): x is string => x !== null,
    );
    const cand: Cand = {
      key,
      ms: at.getTime(),
      ext: entry.externalId,
      peerKey,
      direction: turn.direction,
      senderKind: turn.senderKind,
      kind: turn.kind,
      hash: md5(`${turn.kind}\u0000${body}\u0000${turn.mediaUrl ?? ''}`),
      dupKey: messageId ? `${sessionId ?? ''}\u0000${messageId}\u0000${turn.direction}` : null,
      providerId: provider && provider.length <= 512 ? provider : null,
      peerName: str(context?.visitor_name),
      statusRaw: str(user?.conversation_status),
      stateRaw: str(user?.conversation_state),
      agentId: str(agent?.id),
      agentName: str(agent?.name),
      contactCands,
      botid: botid!,
      sessionId,
      preview: previewOf({ kind: turn.kind, body: turn.body }),
      offset,
      length,
    };
    const tk = `${cand.ext}|${peerKey}`;
    const list = cands.get(tk);
    if (list) list.push(cand);
    else cands.set(tk, [cand]);
    docs.set(key, { key, state: 'thread', thread: tk, softs: [], ...pos });
  }

  // ---- pass 2: threads ----------------------------------------------------------------------------------------------------------
  const threads = new Map<string, ThreadRec>();
  const partial: string[] = [];
  const outOfOrder: string[] = [];
  const order = [...cands.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const byCmp = (x: Cand, y: Cand): number =>
    x.ms - y.ms || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
  const providerOwner = new Set<string>();
  let min = Infinity;
  let max = -Infinity;

  for (const tk of order) {
    const all = cands.get(tk)!.sort(byCmp);
    const first = all[0]!;
    const uuid = threadUuid(a.client, first.ext, first.peerKey);

    // contact: newest turn first; a reference that resolves wins, a reference to a contact deleted at the source excludes the thread
    let contact: { id: number } | null = null;
    let deleted = false;
    let sawCandidate = false;
    scan: for (let i = all.length - 1; i >= 0; i--) {
      for (const cand of all[i]!.contactCands) {
        sawCandidate = true;
        const ref = a.ref('contact_list', cand);
        if (ref && ref.table === 'contacts') {
          contact = { id: ref.id };
          break scan;
        }
        if (a.contactDeleted.has(cand)) {
          deleted = true;
          break scan;
        }
      }
    }

    const reject2 = (state: 'exclude' | 'quarantine', code: string, reason: string): void => {
      for (const c of all) {
        const d = docs.get(c.key)!;
        d.state = state;
        d.code = code;
        d.reason = reason;
        delete d.thread;
      }
    };
    if (deleted && !settings.keepDeletedContactChats) {
      reject2(
        'exclude',
        'CONTACT_DELETED_AT_SOURCE',
        'the contact of this chat was deleted at the source (Q3: --keep-deleted-contact-chats loads it)',
      );
      continue;
    }
    // the same thread already exists in the target: ours (all documents mapped = done, anything else = half done) or a live one
    const existing = a.existingThreads.get(tk);
    if (existing !== undefined && existing !== uuid) {
      reject2(
        'quarantine',
        'THREAD_HAS_LIVE_MESSAGES',
        'a conversation with this number already exists in the target and was not created by this migration',
      );
      continue;
    }
    // ---- duplicates: the same (session, message id, direction) with the same content and time is one turn -------------------------
    const seenDup = new Map<string, Array<{ hash: string; ms: number }>>();
    let keep: Cand[] = [];
    const dupSoft = new Map<string, Soft>();
    for (const c of all) {
      if (c.dupKey === null) {
        keep.push(c);
        continue;
      }
      const prev = seenDup.get(c.dupKey) ?? [];
      if (prev.some((p) => p.hash === c.hash && p.ms === c.ms)) {
        const d = docs.get(c.key)!;
        d.state = 'exclude';
        d.code = 'DUPLICATE_MESSAGE';
        d.reason = 'the same session, message id, direction, content and time as an earlier turn';
        delete d.thread;
        continue;
      }
      if (prev.length > 0)
        dupSoft.set(c.key, {
          code: 'DUP_ID_DIFFERENT_BODY',
          reason:
            'another turn has the same session, message id and direction but different content or time; both kept',
        });
      prev.push({ hash: c.hash, ms: c.ms });
      seenDup.set(c.dupKey, prev);
      keep.push(c);
    }
    // nothing mapped and no conversation = new; ours with every surviving document mapped = done (the engine skips them); ours with the
    // mapped documents forming the START of the thread (seq rule: time, then key) and more after them = append; the same with a newer
    // dumped document sorting before a mapped one = left as loaded and reported; anything else = half done
    const mappedAt = keep.flatMap((c, i) => (a.migrated(c.key) ? [i] : []));
    const mappedKeep = mappedAt.length;
    const isNew = existing === undefined && mappedKeep === 0;
    const isDone = existing === uuid && mappedKeep === keep.length;
    const mine = existing === uuid && mappedKeep > 0 && mappedKeep < keep.length;
    const isAppend = mine && mappedAt.every((at, i) => at === i);
    const isOutOfOrder = mine && !isAppend;
    if (!isNew && !isDone && !isAppend && !isOutOfOrder) {
      partial.push(tk);
      continue;
    }
    if (isOutOfOrder) {
      // never guess: the thread stays as loaded; the turns that would need a seq inside it are quarantined and counted
      for (const c of keep) {
        if (a.migrated(c.key)) continue;
        const d = docs.get(c.key)!;
        d.state = 'quarantine';
        d.code = 'APPEND_OUT_OF_ORDER';
        d.reason =
          'the thread is already loaded and this turn sorts before a loaded one; appending it would break the seq rule, so the thread is left as loaded';
        delete d.thread;
      }
      keep = keep.filter((c) => a.migrated(c.key));
      outOfOrder.push(tk);
    }
    const loaded = isNew ? 0 : isAppend ? mappedKeep : keep.length;

    // ---- contact by phone, status, assignee, counters ------------------------------------------------------------------------------
    const softs: Soft[] = [];
    let contactVia: ThreadRec['contactVia'] = contact ? 'ref' : 'none';
    if (!contact) {
      const hit = a.contactsByDigits.get(first.peerKey);
      if (hit && hit.n === 1) {
        contact = { id: hit.id };
        contactVia = 'phone';
        softs.push({
          code: 'CONTACT_BY_PHONE',
          reason:
            'no contact reference resolved; the single contact with this phone number was linked',
        });
      } else {
        softs.push({
          code: 'CONTACT_UNRESOLVED',
          reason: deleted
            ? 'the contact of this chat was deleted at the source; loaded with no contact (--keep-deleted-contact-chats)'
            : hit
              ? 'no contact reference resolved and several contacts share this phone number; not guessed'
              : sawCandidate
                ? 'the contact reference of this chat matches no migrated contact'
                : 'the chat carries no contact reference and no contact has this phone number',
        });
      }
    }
    const newest = (pick: (c: Cand) => string | null): string | null => {
      for (let i = keep.length - 1; i >= 0; i--) {
        const v = pick(keep[i]!);
        if (v) return v;
      }
      return null;
    };
    const last = keep[keep.length - 1]!;
    const peerName = newest((c) => c.peerName);
    const statusRaw = newest((c) => c.statusRaw)?.toLowerCase() ?? null;
    let status: 'open' | 'closed' = 'open';
    if (settings.threadStatus === 'closed') status = 'closed';
    else if (statusRaw === 'closed') status = 'closed';
    else if (statusRaw !== 'open')
      softs.push({
        code: 'NO_STATUS_CONV',
        reason: statusRaw
          ? 'user.conversation_status is neither Open nor Closed; imported open'
          : 'no turn carries user.conversation_status; imported open',
      });
    const agentTurn = [...keep].reverse().find((c) => c.agentId);
    let assigneeId: number | null = null;
    if (agentTurn && settings.assignAgents && a.hasUsers) {
      const ref = a.ref('user', agentTurn.agentId);
      if (ref && ref.table === 'users') assigneeId = ref.id;
      else
        softs.push({
          code: 'UNRESOLVED_AGENT',
          reason:
            'the newest Waboo agent of this chat matches no migrated user; the thread is not assigned',
        });
    }
    const customerIn = [...keep]
      .reverse()
      .find((c) => c.direction === 'in' && c.senderKind === 'customer');
    const lastOut = [...keep].reverse().find((c) => c.direction === 'out');
    const iso = (ms: number): string => new Date(ms).toISOString();
    const lastInboundAt = customerIn ? iso(customerIn.ms) : null;
    const routing = scrub(
      plain({
        legacy: {
          source: 'waboo',
          botid: last.botid,
          lastSessionId: newest((c) => c.sessionId),
          conversationState: newest((c) => c.stateRaw),
          ...(agentTurn ? { agent: { id: agentTurn.agentId, name: agentTurn.agentName } } : {}),
        },
      }),
    ).value as Record<string, unknown>;
    const rec: ThreadRec = {
      key: tk,
      uuid,
      ext: first.ext,
      peerKey: first.peerKey,
      peerName,
      title: defaultTitle(CHANNEL_KIND, first.peerKey, peerName),
      contactId: contact?.id ?? null,
      contactVia,
      status,
      assigneeId,
      routingMeta: routing,
      preview: last.preview,
      createdAt: iso(keep[0]!.ms),
      lastMessageAt: iso(last.ms),
      lastInboundAt,
      lastOutboundAt: lastOut ? iso(lastOut.ms) : null,
      windowExpiresAt: customerIn ? iso(customerIn.ms + settings.windowHours * 3_600_000) : null,
      resolvedAt: status === 'closed' ? iso(last.ms) : null,
      msgSeq: keep.length,
      loaded,
      docs: keep.map((c) => c.key),
      lastDoc: last.key,
      botids: [...new Set(keep.map((c) => c.botid))].sort(),
    };
    threads.set(tk, rec);

    keep.forEach((c, i) => {
      const d = docs.get(c.key)!;
      d.seq = i + 1;
      d.at = iso(c.ms);
      d.softs = [...(i === 0 ? softs : []), ...(dupSoft.has(c.key) ? [dupSoft.get(c.key)!] : [])];
      d.ledgerKey = null;
      if (c.providerId && i < loaded && a.ledgerOwned) {
        // a message that is already loaded: it owns its id when the target's ledger says so (nothing is decided again for it)
        const lk = `${c.ext}\u0000${c.providerId}`;
        if (a.ledgerOwned.has(lk) && !providerOwner.has(lk)) {
          providerOwner.add(lk);
          d.ledgerKey = c.providerId;
        }
      } else if (c.providerId) {
        const lk = `${c.ext}\u0000${c.providerId}`;
        if (providerOwner.has(lk) || a.ledgerOwned?.has(lk))
          d.softs.push({
            code: 'DUP_PROVIDER_ID',
            reason:
              'another message already owns this provider message id in the ledger; this one has no ledger row',
          });
        else {
          providerOwner.add(lk);
          d.ledgerKey = c.providerId;
        }
      }
      min = Math.min(min, c.ms);
      max = Math.max(max, c.ms);
    });
  }

  // docs tally and fingerprint (stable across runs; used to refuse a stale checkpoint)
  for (const k of [...docs.keys()].sort()) {
    const d = docs.get(k)!;
    tally[d.state === 'thread' ? 'thread' : `${d.state}:${d.code}`] =
      (tally[d.state === 'thread' ? 'thread' : `${d.state}:${d.code}`] ?? 0) + 1;
    hash.update(`${k}|${d.state}|${d.code ?? ''}|${d.thread ?? ''}|${d.seq ?? ''}\n`);
  }
  hash.update(settings.mapSha256);
  return {
    settings,
    docs,
    threads,
    order: order.filter((k) => threads.has(k)),
    channelIds: new Map(),
    unmapped,
    partial,
    outOfOrder,
    range: Number.isFinite(min)
      ? { min: new Date(min).toISOString(), max: new Date(max).toISOString() }
      : null,
    fingerprint: hash.digest('hex').slice(0, 32),
    tally,
  };
}

/** Stream order of the load: every thread in key order (documents in seq order), then everything else in file order. */
export async function* loadOrder(
  plan: ChatPlan,
  source: Source,
  client: string,
): AsyncGenerator<Doc> {
  if (!source.readAt || !source.readIndexed)
    throw new Error('INBOX: source cannot read by position');
  for (const tk of plan.order) {
    for (const key of plan.threads.get(tk)!.docs) {
      const d = plan.docs.get(key)!;
      yield await source.readAt(client, 'chathistory', d.offset, d.length);
    }
  }
  // everything that is not part of a loaded thread (quarantined, excluded, malformed, the later copy of a repeated key)
  const emitted = new Set<string>();
  for (const tk of plan.order) for (const key of plan.threads.get(tk)!.docs) emitted.add(key);
  for await (const { doc } of source.readIndexed(client, 'chathistory')) {
    const keys = docKeys(doc);
    const k = keys.length ? primaryKey(doc) : null;
    if (k !== null && emitted.has(k) && plan.docs.get(k)?.state === 'thread') {
      // the first copy was emitted with its thread; a repeated key goes out here so the engine can quarantine it
      emitted.delete(k);
      continue;
    }
    yield doc;
  }
}
