import type { Source } from '../extract/source';
import type { InboxSettings } from '../inbox/config';
import type { ChatPlan } from '../inbox/plan';
import { reparsedConversations } from '../load/chatreparse';
import { appendedConversations } from '../load/inbox';
import { relinkedConversations } from '../load/chatrelink';
import { deliveryChangedMessages } from '../load/chatdelivery';
import { statusChangedConversations } from '../load/chatstatus';
import { sql, withTenant, type Database, type TenantTx } from '../load/db';
import { isSecretName, uuidv5 } from '../util';
import { hexKey, oracleDeleted, text } from './oracle';
import { oracleChat, type OracleResult } from './oracle-chat';
import type { CollRow, FieldRow, Report } from './index';

/**
 * The verifier of the inbox step. Everything it believes about the source comes from reconcile/oracle-chat.ts (a second, simpler
 * implementation of the spec); everything it believes about the target it reads here. It checks, for the organization:
 *   - every chathistory document: loaded / excluded / quarantined as the oracle says (and as the loader's plan says),
 *   - every loaded message: conversation, seq, direction, status, sender, time, provider id, body (md5),
 *   - every thread: one conversation per number with the counters, last_message_*, window, status, contact, assignee the oracle expects,
 *   - seq continuity per conversation (no gap, no duplicate), counters = what the messages say, creation order inside a thread,
 *   - the channels the tool made, the ledger rows, the monthly partitions, nothing in messages_default,
 *   - nothing that the live application would have written (events, participants, notes), and no queued outbound message (R2).
 */
type Tx = TenantTx;

const OWN = `routing_meta->'legacy'->>'source' = 'waboo'`;

const ts = (iso: string | null): string | null => (iso === null ? null : `${iso.slice(0, -1)}000`);
const tsCol = (c: string, alias = c): string =>
  `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS ${alias}`;
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : x,
  );

/** What `conversations` columns the loader never writes must still hold (written again here, not imported). */
const CONV_DEFAULTS: Record<string, unknown> = {
  customer_language: null,
  archived: false,
  pinned_at: null,
  muted_at: null,
  waiting_since: null,
  needs_contact: false,
  priority: 'normal',
  assignee_team_id: null,
  assignee_agent_id: null,
  first_response_at: null,
  snoozed_until: null,
  resolved_by: null,
  resolved_by_agent_id: null,
  sla_policy_id: null,
  sla_first_response_due: null,
  sla_resolution_due: null,
  sla_breached: false,
  escalation_due_at: null,
  escalation_action: null,
  unread_count: 0,
  row_version: 1,
};

/** Nested keys that are read; any other nested key of these objects is dropped (reported with counts). */
const NESTED_READ: Record<string, Set<string>> = {
  user: new Set(['mobile', 'user', 'contact_id', 'conversation_status', 'conversation_state']),
  context: new Set(['visitor_phone', 'visitor_name', 'mobile_phone_number', 'contact_id']),
  agent: new Set(['id', 'name']),
};

export interface ChatVerifyArgs {
  db: Database;
  orgId: number;
  client: string;
  source: Source;
  settings: InboxSettings | null;
  /** the loader's plan (the same one the transform used), compared with the oracle */
  plan: ChatPlan | null;
  referenceAt: string;
  allowExtraRows: boolean;
  alarm: (m: string) => void;
  warnings: string[];
  fields: FieldRow[];
  notPresent: Report['notPresent'];
  threadsRow: CollRow;
}

const chunks = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export async function verifyChat(a: ChatVerifyArgs): Promise<void> {
  const { db, orgId, client, alarm } = a;
  const tenant = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => withTenant(db, { orgId }, fn);
  const rowsOf = <T>(r: { rows: unknown[] }): T[] => r.rows as T[];
  if (!a.settings) {
    alarm(
      'INBOX_NO_CHANNEL_MAP: the dump has chathistory but no channel map was given to reconcile (--channel-map): the inbox cannot be verified',
    );
    return;
  }
  const s = a.settings;
  const botToExt = new Map(Object.entries(s.map).map(([b, e]) => [b, e.externalId]));
  const exts = [...new Set(botToExt.values())].sort();

  // ---- what the target says (ids that the oracle needs) ------------------------------------------------------------------------
  const idMapOf = async (collection: string, table: string): Promise<Map<string, number>> => {
    const r = await db.execute(sql`
      SELECT source_key, target_id FROM migration.id_map
      WHERE source_client = ${client} AND source_collection = ${collection} AND target_table = ${table}`);
    return new Map(
      rowsOf<{ source_key: string; target_id: number | string }>(r).map((x) => [
        x.source_key,
        Number(x.target_id),
      ]),
    );
  };
  const contactIds = await idMapOf('contact_list', 'contacts');
  const userIds = await idMapOf('user', 'users');
  const deletedContacts = new Set<string>();
  if (a.source.collections(client).includes('contact_list'))
    for await (const d of a.source.read(client, 'contact_list'))
      if (oracleDeleted(d)) {
        if (hexKey(d._id) !== '') deletedContacts.add(hexKey(d._id));
        if (text(d.id) !== '') deletedContacts.add(text(d.id));
      }
  const byDigits = await tenant((tx) =>
    tx.execute(sql`
      SELECT regexp_replace(normalized_phone, '\\D', '', 'g') AS d, count(*)::int AS n, min(id) AS id
      FROM contacts WHERE org_id = ${orgId} AND normalized_phone IS NOT NULL GROUP BY 1`),
  );
  const contactsByDigits = new Map(
    rowsOf<{ d: string; n: number; id: number | string }>(byDigits).map((r) => [
      r.d,
      { n: Number(r.n), id: Number(r.id) },
    ]),
  );
  // a channel is the row with the map's phone number id OR the row this tool made for it (uuid from the map's id): once the real number is
  // connected the row carries the real id, but the threads (and their uuids) were made under the map's id
  const chanUuidOf = new Map(exts.map((e) => [uuidv5(`${client}|chat_channel|whatsapp_cloud|${e}`), e]));
  const extOf = (external: string | null, chuuid: string | null): string | null =>
    external !== null && exts.includes(external)
      ? external
      : ((chuuid !== null ? chanUuidOf.get(chuuid) : undefined) ?? external);
  const ex = await tenant((tx) =>
    tx.execute(sql`
      SELECT ch.external_id AS ext, ch.uuid::text AS chuuid, v.peer_key AS peer, v.uuid::text AS uuid
      FROM conversations v JOIN channels ch ON ch.org_id = v.org_id AND ch.id = v.channel_id
      WHERE v.org_id = ${orgId} AND ch.kind = 'whatsapp_cloud'
        AND (ch.external_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(exts)}::jsonb))
             OR ch.uuid IN (SELECT jsonb_array_elements_text(${JSON.stringify([...chanUuidOf.keys()])}::jsonb)::uuid))`),
  );
  const existingThreads = new Map(
    rowsOf<{ ext: string; chuuid: string; peer: string; uuid: string }>(ex).map((r) => [
      `${extOf(r.ext, r.chuuid)}|${r.peer}`,
      r.uuid,
    ]),
  );
  // which chathistory documents are messages in the target (the state after an append is read from this)
  const loadedKeys = new Set((await idMapOf('chathistory', 'messages')).keys());
  const hasUsers = a.source.collections(client).includes('user');

  // ---- the independent oracle --------------------------------------------------------------------------------------------------
  const nested = new Map<string, Map<string, number>>();
  async function* observed(): AsyncGenerator<Record<string, unknown>> {
    for await (const d of a.source.read(client, 'chathistory')) {
      for (const obj of Object.keys(NESTED_READ)) {
        const v = d[obj];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const m = nested.get(obj) ?? new Map<string, number>();
          nested.set(obj, m);
          for (const k of Object.keys(v)) m.set(k, (m.get(k) ?? 0) + 1);
        }
      }
      yield d;
    }
  }
  // visitor_logs: the current status of each chat session (README "Chat"), read here independently of the planner
  const sessionStatus = new Map<string, { status: string; ms: number }>();
  if (a.source.collections(client).includes('visitor_logs'))
    for await (const d of a.source.read(client, 'visitor_logs')) {
      const sid = String(d.session_id ?? '').trim();
      const st = String(d.conversation_status ?? '').trim().toLowerCase();
      if (sid === '' || (st !== 'open' && st !== 'closed')) continue;
      const raw = d.last_message_time ?? d.updatedAt;
      const t = raw instanceof Date ? raw.getTime() : Date.parse(String(raw ?? ''));
      const ms = Number.isNaN(t) ? 0 : t;
      const prev = sessionStatus.get(sid);
      if (!prev || ms >= prev.ms) sessionStatus.set(sid, { status: st, ms });
    }
  const oracle: OracleResult = await oracleChat(observed(), {
    client,
    sessionStatus,
    botToExt,
    keepDeletedContactChats: s.keepDeletedContactChats,
    threadStatus: s.threadStatus,
    assignAgents: s.assignAgents,
    windowHours: s.windowHours,
    referenceAt: a.referenceAt,
    deletedContacts,
    contactId: (k) => contactIds.get(k),
    userId: (k) => userIds.get(k),
    hasUsers,
    contactsByDigits,
    existingThreads,
    loaded: (k) => loadedKeys.has(k),
  });
  if (oracle.unchecked > 0)
    a.warnings.push(
      `INBOX: ${oracle.unchecked} turn(s) have a bot_response / user_query shape the independent check does not read (body and kind taken from the loader only; UNVERIFIED shapes, see README)`,
    );

  // nested keys: read or dropped
  for (const [obj, known] of Object.entries(NESTED_READ)) {
    for (const [k, n] of [...(nested.get(obj) ?? [])].sort(([x], [y]) => (x < y ? -1 : 1))) {
      const read = known.has(k);
      // a key named like a credential is counted but its name is never printed
      const shown = isSecretName(k) ? '(credential-looking key)' : k;
      a.fields.push({
        step: 'inbox',
        field: `${obj}.${shown}`,
        seen: n,
        where: read ? 'conversations / messages (see the field map)' : 'drop: not chat data',
        verdict: read ? 'mapped' : 'dropped',
      });
      if (!read)
        a.notPresent.droppedFields.push(
          `chathistory.${obj}.${shown} (${n} docs): ${obj === 'context' ? 'contact data and attribution copy; the contact already carries it' : obj === 'user' ? 'visitor_logs snapshot (phase-2 visitor_logs owns it)' : 'agent presence state'}`,
        );
    }
  }

  if (a.plan && a.plan.partial.length > 0)
    alarm(
      `PARTIAL_THREAD: ${a.plan.partial.length} thread(s) exist with some, but not all, of their messages mapped, and the loaded ones are not the start of the thread (a message, a conversation or an id_map row is missing or was changed)`,
    );
  // threads that are loaded but have newer turns in the dump that are not messages yet: run the load (it appends them)
  const pendingThreads = new Set<string>();
  let pendingMessages = 0;
  for (const th of oracle.threads.values())
    if (th.loadedCount > 0 && th.loadedCount < th.count) {
      pendingThreads.add(th.key);
      pendingMessages += th.count - th.loadedCount;
    }
  if (pendingThreads.size > 0)
    alarm(
      `APPEND_PENDING: ${pendingThreads.size} loaded thread(s) lack ${pendingMessages} newer message(s) that the dump has after their last loaded one; run the load (it appends them)`,
    );
  if (oracle.outOfOrder.length > 0)
    alarm(
      `APPEND_OUT_OF_ORDER: ${oracle.outOfOrder.length} loaded thread(s) hold a turn that sorts before a loaded message; they are left as loaded and the turns are quarantined (threads: ${oracle.outOfOrder
        .slice(0, 10)
        .map((k) => oracle.threads.get(k)!.uuid)
        .join(', ')}${oracle.outOfOrder.length > 10 ? ', ...' : ''})`,
    );
  if (a.plan) {
    const want = [...oracle.outOfOrder].sort().join('\n');
    const got = [...a.plan.outOfOrder].sort().join('\n');
    if (want !== got)
      alarm(
        `ORACLE_MISMATCH: the loader's plan and the independent check disagree on which threads are out of order (${a.plan.outOfOrder.length} vs ${oracle.outOfOrder.length})`,
      );
  }

  // ---- 1. oracle vs the loader's plan ---------------------------------------------------------------------------------------------
  let disagree = 0;
  if (a.plan) {
    // seq rule (README, Stage 2): only stored messages take a seq. If the oracle cannot decide whether a turn is empty and the loader
    // quarantined it as EMPTY_MESSAGE, the oracle's seq for that thread is not comparable: say so instead of raising a +1 per later turn.
    const seqUnsure = new Set<string>();
    for (const m of oracle.messages.values()) {
      const p = a.plan.docs.get(m.key);
      if (m.verdict === 'load' && m.bodyMd5 === undefined && p?.state === 'quarantine' && p.code === 'EMPTY_MESSAGE')
        seqUnsure.add(m.thread!);
    }
    if (seqUnsure.size > 0)
      a.warnings.push(
        `INBOX: ${seqUnsure.size} thread(s) hold a turn the independent check cannot call empty or not while the loader quarantined it as EMPTY_MESSAGE; seq is not compared in those threads (UNVERIFIED)`,
      );
    for (const m of oracle.messages.values()) {
      const p = a.plan.docs.get(m.key);
      if (m.verdict === 'engine') {
        if (p)
          alarm(
            `ORACLE_MISMATCH: chathistory ${m.key}: unstorable text, yet the plan has a verdict`,
          );
        continue;
      }
      if (!p) {
        alarm(
          `ORACLE_MISMATCH: chathistory ${m.key}: the loader's plan has no verdict for this document`,
        );
        continue;
      }
      const uncertainEmpty =
        m.verdict === 'load' &&
        m.bodyMd5 === undefined &&
        p.state === 'quarantine' &&
        p.code === 'EMPTY_MESSAGE';
      if (uncertainEmpty) continue;
      const want = m.verdict === 'load' ? 'thread' : m.verdict;
      if (p.state !== want || (m.verdict !== 'load' && p.code !== m.code)) {
        alarm(
          `ORACLE_MISMATCH: chathistory ${m.key}: independent check says ${m.verdict}${m.code ? ` ${m.code}` : ''}, loader says ${p.state}${p.code ? ` ${p.code}` : ''}`,
        );
        continue;
      }
      if (
        m.verdict === 'load' &&
        (!seqUnsure.has(m.thread!) && p.seq !== m.seq || p.at !== m.at || Boolean(p.ledgerKey) !== m.ledger)
      )
        alarm(
          `ORACLE_MISMATCH: chathistory ${m.key}: seq/time/ledger differ (independent seq ${m.seq} at ${m.at} ledger ${m.ledger}; loader seq ${p.seq} at ${p.at} ledger ${Boolean(p.ledgerKey)})`,
        );
    }
  }

  // ---- 2. every loaded message ------------------------------------------------------------------------------------------------------
  const loaded = [...oracle.messages.values()].filter((m) => m.verdict === 'load');
  // chat-delivery moved these outbound messages on from `sent` (run_log _chat/chat_delivery)
  const deliveryMoved = await deliveryChangedMessages(db, client);
  const uuidOf = (key: string): string => uuidv5(`${client}|chathistory|${key}`);
  const convOfThread = new Map<string, Set<number>>();
  const threadOfConv = new Map<number, Set<string>>();
  const idOfKey = new Map<string, number>();
  const lastIdOfThread = new Map<string, number>();
  const peerKeyOfThread = new Map<string, string>();
  for (const part of chunks(loaded, 400)) {
    const res = await tenant((tx) =>
      tx.execute(
        sql.raw(`
        SELECT m.uuid::text AS uuid, m.id, m.conversation_id AS cid, m.seq, m.direction, m.status, m.sender_kind, m.kind,
               m.provider_message_id AS prov, md5(coalesce(m.body, '')) AS bmd5, (m.body IS NULL) AS bnull,
               ${tsCol('m.created_at', 'at')}, c.peer_key, ch.external_id AS ext, ch.uuid::text AS chuuid
        FROM messages m
        LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
        LEFT JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
        WHERE m.org_id = ${orgId}
          AND m.uuid = ANY (ARRAY(SELECT jsonb_array_elements_text('${JSON.stringify(part.map((m) => uuidOf(m.key))).replace(/'/g, "''")}'::jsonb)::uuid))`),
      ),
    );
    const byUuid = new Map(
      rowsOf<{
        uuid: string;
        id: number | string;
        cid: number | string;
        seq: number | string;
        direction: string;
        status: string;
        sender_kind: string;
        kind: string;
        prov: string | null;
        bmd5: string;
        bnull: boolean;
        at: string;
        peer_key: string | null;
        ext: string | null;
        chuuid: string | null;
      }>(res).map((r) => [r.uuid, { ...r, ext: extOf(r.ext, r.chuuid) }]),
    );
    for (const m of part) {
      const r = byUuid.get(uuidOf(m.key));
      if (!r) {
        // a newer turn of a loaded thread: one APPEND_PENDING alarm above says it
        if (pendingThreads.has(m.thread!) && !loadedKeys.has(m.key)) continue;
        alarm(`ORACLE_MISMATCH: chathistory ${m.key}: no message row in the target`);
        continue;
      }
      const bad: string[] = [];
      const th = oracle.threads.get(m.thread!)!;
      if (Number(r.seq) !== m.seq) bad.push(`seq ${r.seq} != ${m.seq}`);
      if (r.direction !== m.direction) bad.push(`direction ${r.direction} != ${m.direction}`);
      const status = m.direction === 'in' ? 'received' : 'sent';
      // after cutover a late receipt may move a migrated outbound message on (sent -> delivered / read / failed); never back to queued
      const statusOk =
        r.status === status ||
        (deliveryMoved.has(String(r.uuid)) &&
          m.direction === 'out' &&
          ['delivered', 'read', 'failed'].includes(r.status)) ||
        (a.allowExtraRows &&
          m.direction === 'out' &&
          ['delivered', 'read', 'failed'].includes(r.status));
      if (!statusOk) bad.push(`status ${r.status} != ${status}`);
      if (r.sender_kind !== m.senderKind)
        bad.push(`sender_kind ${r.sender_kind} != ${m.senderKind}`);
      if (r.at !== ts(m.at!)) bad.push(`created_at ${r.at} != ${ts(m.at!)}`);
      if (r.ext !== th.ext) bad.push(`channel ${r.ext} != ${th.ext}`);
      if (m.providerCol && r.prov !== m.providerCol) bad.push('provider_message_id differs');
      if (!m.providerCol && r.prov !== null) bad.push('provider_message_id should be empty');
      if (m.kind !== undefined && r.kind !== m.kind) bad.push(`kind ${r.kind} != ${m.kind}`);
      if (m.bodyMd5 !== undefined && (r.bnull || r.bmd5 !== m.bodyMd5)) bad.push('body differs');
      if (r.peer_key !== th.peer && r.peer_key !== m.rawDigits)
        bad.push('peer_key is neither the canonical nor the raw digits');
      if (bad.length > 0) alarm(`ORACLE_MISMATCH: chathistory ${m.key}: ${bad.join('; ')}`);
      const cid = Number(r.cid);
      convOfThread.set(m.thread!, (convOfThread.get(m.thread!) ?? new Set()).add(cid));
      threadOfConv.set(cid, (threadOfConv.get(cid) ?? new Set()).add(m.thread!));
      idOfKey.set(m.key, Number(r.id));
      if (m.seq === th.count) lastIdOfThread.set(m.thread!, Number(r.id));
      if (r.peer_key !== null) peerKeyOfThread.set(m.thread!, r.peer_key);
      if (r.peer_key !== th.peer) disagree++;
    }
  }
  if (disagree > 0) {
    a.warnings.push(
      `INBOX: ${disagree} message(s) sit on a thread key that differs from the plain digits rule (allowed: canonicalised numbers, e.g. a 00 prefix)`,
    );
    if (disagree > Math.max(1, Math.floor(loaded.length / 100)))
      alarm(
        `ORACLE_MISMATCH: ${disagree} message(s) have a peer_key the plain digits rule disagrees with (more than 1%)`,
      );
  }

  // ---- 3. every thread ----------------------------------------------------------------------------------------------------------
  const threads = [...oracle.threads.values()];
  let threadsFound = 0;
  const convIds: number[] = [];
  for (const th of threads) {
    const set = convOfThread.get(th.key);
    if (!set || set.size === 0) {
      alarm(
        `ORACLE_MISMATCH: thread ${th.ext}|...${th.peer.slice(-2)}: none of its messages is in the target`,
      );
      continue;
    }
    if (set.size > 1)
      alarm(
        `THREAD_SPLIT: the ${th.count} messages of one phone number sit in ${set.size} conversations`,
      );
    convIds.push(...set);
  }
  for (const [cid, set] of threadOfConv)
    if (set.size > 1)
      alarm(
        `THREAD_MERGED: conversation ${cid} holds the messages of ${set.size} different phone numbers`,
      );
  const convRows = new Map<number, Record<string, unknown>>();
  for (const part of chunks([...new Set(convIds)], 400)) {
    const res = await tenant((tx) =>
      tx.execute(
        sql.raw(`
        SELECT c.id, c.uuid::text AS uuid, ch.external_id AS ext, ch.uuid::text AS chuuid, c.peer_key, c.peer_name, c.contact_id, c.title, c.preview, c.status,
               ${tsCol('c.last_message_at', 'last_message_at')}, ${tsCol('c.created_at', 'created_at')}, ${tsCol('c.updated_at', 'updated_at')},
               ${tsCol('c.last_inbound_at', 'last_inbound_at')}, ${tsCol('c.last_outbound_at', 'last_outbound_at')},
               ${tsCol('c.window_expires_at', 'window_expires_at')}, ${tsCol('c.resolved_at', 'resolved_at')},
               c.msg_seq, c.last_message_id, c.assignee_user_id, c.routing_meta,
               ${Object.keys(CONV_DEFAULTS)
                 .map((k) =>
                   k.endsWith('_at') || k.endsWith('_due') || k.endsWith('_until')
                     ? tsCol(`c.${k}`, k)
                     : `c.${k}`,
                 )
                 .join(', ')}
        FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
        WHERE c.org_id = ${orgId} AND c.id IN (${part.join(',')})`),
      ),
    );
    for (const r of rowsOf<Record<string, unknown>>(res))
      convRows.set(Number(r.id), {
        ...r,
        ext: extOf(r.ext as string | null, r.chuuid as string | null),
      });
  }
  // conversations whose preview chat-reparse rewrote: the touch trigger moved updated_at and row_version (recorded, expected)
  const reparsed = await reparsedConversations(db, client);
  // conversations of loaded threads that got newer messages: the same trigger moved updated_at and row_version (run_log _chat/chat_append)
  const appended = await appendedConversations(db, client);
  // chat-relink set contact_id on conversations that had none (same trigger; run_log _chat/chat_relink)
  const relinked = await relinkedConversations(db, client);
  // chat-status closed conversations Waboo has closed (same trigger; run_log _chat/chat_status)
  const statusChanged = await statusChangedConversations(db, client);
  const touched = (uuid: unknown): boolean =>
    reparsed.has(String(uuid)) ||
    appended.has(String(uuid)) ||
    relinked.has(String(uuid)) ||
    statusChanged.has(String(uuid));
  for (const th of threads) {
    const set = convOfThread.get(th.key);
    if (!set || set.size !== 1) continue;
    const cid = [...set][0]!;
    const c = convRows.get(cid);
    if (!c) {
      alarm(`TARGET_MISSING: the conversation of a migrated thread (id ${cid}) does not exist`);
      continue;
    }
    threadsFound++;
    if (pendingThreads.has(th.key)) continue; // the counters wait for the append (APPEND_PENDING says so)
    const bad: string[] = [];
    const eq = (name: string, got: unknown, want: unknown): void => {
      if ((got ?? null) !== (want ?? null)) bad.push(`${name}`);
    };
    eq('channel', c.ext, th.ext);
    eq('peer_key', c.peer_key, peerKeyOfThread.get(th.key));
    eq('created_at', c.created_at, ts(th.firstAt));
    const routing = c.routing_meta as { legacy?: { source?: string } } | null;
    if (routing?.legacy?.source !== 'waboo') bad.push('routing_meta.legacy.source');
    if (c.uuid !== uuidv5(`${client}|chat_thread|whatsapp_cloud|${th.ext}|${String(c.peer_key)}`))
      bad.push('uuid');
    if (!a.allowExtraRows) {
      eq('peer_name', c.peer_name, th.peerName);
      eq('title', c.title, th.title);
      eq('status', c.status, th.status);
      eq('resolved_at', c.resolved_at, ts(th.resolvedAt));
      eq('msg_seq', Number(c.msg_seq), th.count);
      eq('last_message_at', c.last_message_at, ts(th.lastAt));
      if (!touched(c.uuid)) eq('updated_at', c.updated_at, ts(th.lastAt));
      eq('last_inbound_at', c.last_inbound_at, ts(th.lastInboundAt));
      eq('last_outbound_at', c.last_outbound_at, ts(th.lastOutboundAt));
      eq('window_expires_at', c.window_expires_at, ts(th.windowExpiresAt));
      eq(
        'assignee_user_id',
        c.assignee_user_id === null ? null : Number(c.assignee_user_id),
        th.assigneeId,
      );
      eq('contact_id', c.contact_id === null ? null : Number(c.contact_id), th.contactId);
      eq(
        'last_message_id',
        c.last_message_id === null ? null : Number(c.last_message_id),
        lastIdOfThread.get(th.key),
      );
      if (th.preview !== undefined) eq('preview', c.preview, th.preview);
      for (const [k, want] of Object.entries(CONV_DEFAULTS))
        if ((c[k] ?? null) !== want && !(k === 'row_version' && touched(c.uuid)))
          bad.push(`default ${k}`);
    } else if (!th.contactViaPhone) {
      eq('contact_id', c.contact_id === null ? null : Number(c.contact_id), th.contactId);
    }
    if (bad.length > 0)
      alarm(
        `ORACLE_MISMATCH: conversation of thread ...${th.peer.slice(-2)}: ${bad.join(', ')} differ from the independent value`,
      );
  }
  a.threadsRow.read = threads.length;
  a.threadsRow.migrated = threadsFound;
  a.threadsRow.unaccounted = threads.length - threadsFound;

  // ---- 4. counters and seq continuity, straight from the messages (SQL) -----------------------------------------------------------
  const inv = await tenant((tx) =>
    tx.execute(
      sql.raw(`
      WITH conv AS (SELECT id, msg_seq, last_message_at, last_message_id FROM conversations WHERE org_id = ${orgId} AND ${OWN}),
      m AS (SELECT conversation_id, seq, created_at, id,
                   lag(created_at) OVER (PARTITION BY conversation_id ORDER BY seq) AS prev
            FROM messages WHERE org_id = ${orgId} AND conversation_id IN (SELECT id FROM conv))
      SELECT c.id, c.msg_seq, c.last_message_id, count(m.seq)::int AS n, min(m.seq) AS mn, max(m.seq) AS mx,
             count(DISTINCT m.seq)::int AS d, count(*) FILTER (WHERE m.created_at < m.prev)::int AS back,
             (c.last_message_at IS DISTINCT FROM max(m.created_at)) AS bad_last,
             (array_agg(m.id ORDER BY m.seq DESC))[1] AS last_id
      FROM conv c LEFT JOIN m ON m.conversation_id = c.id
      GROUP BY c.id, c.msg_seq, c.last_message_id, c.last_message_at`),
    ),
  );
  const ownConvs = new Set<number>();
  for (const r of rowsOf<{
    id: number | string;
    msg_seq: number | string;
    last_message_id: number | string | null;
    n: number;
    mn: number | string | null;
    mx: number | string | null;
    d: number;
    back: number;
    bad_last: boolean;
    last_id: number | string | null;
  }>(inv)) {
    ownConvs.add(Number(r.id));
    if (r.n === 0) {
      alarm(
        `EMPTY_THREAD: conversation ${r.id} was created by the migration and has no messages (a lost message)`,
      );
      continue;
    }
    if (Number(r.mn) !== 1 || Number(r.mx) !== r.n || r.d !== r.n)
      alarm(
        `SEQ_CONTINUITY: conversation ${r.id}: ${r.n} messages, seq ${r.mn}..${r.mx}, ${r.d} distinct (a gap or a duplicate)`,
      );
    if (Number(r.msg_seq) !== r.n)
      alarm(`COUNTER_MISMATCH: conversation ${r.id}: msg_seq ${r.msg_seq} but ${r.n} messages`);
    if (r.bad_last)
      alarm(`COUNTER_MISMATCH: conversation ${r.id}: last_message_at is not the newest message`);
    if (r.last_message_id === null || Number(r.last_message_id) !== Number(r.last_id))
      alarm(
        `COUNTER_MISMATCH: conversation ${r.id}: last_message_id is not the id of the last message`,
      );
    if (r.back > 0)
      alarm(`ORDER: conversation ${r.id}: created_at goes backwards along seq (${r.back} time(s))`);
  }
  if (!a.allowExtraRows)
    for (const id of ownConvs)
      if (!convRows.has(id))
        alarm(
          `EXTRA_ROWS: conversation ${id} carries the migration marker but no source thread accounts for it`,
        );

  // ---- 5. messages the migration must not have written or left ---------------------------------------------------------------------
  const q1 = async (text_: string): Promise<number> =>
    Number(rowsOf<{ n: number | string }>(await tenant((tx) => tx.execute(sql.raw(text_))))[0]!.n);
  const dflt = await q1(`SELECT count(*) AS n FROM messages_default WHERE org_id = ${orgId}`);
  if (dflt > 0)
    alarm(
      `PARTITION: ${dflt} message(s) of this organization sit in messages_default (a monthly partition is missing)`,
    );
  const notMapped = `NOT EXISTS (SELECT 1 FROM migration.id_map i WHERE i.source_client = '${client.replace(/'/g, "''")}' AND i.source_collection = 'chathistory' AND i.target_table = 'messages' AND i.target_id = m.id AND i.target_uuid = m.uuid)`;
  const queued = await q1(
    `SELECT count(*) AS n FROM messages m WHERE m.org_id = ${orgId} AND m.status NOT IN ${a.allowExtraRows ? "('received', 'sent', 'delivered', 'read', 'failed')" : "('received', 'sent')"} AND NOT ${notMapped}`,
  );
  if (queued > 0)
    alarm(
      `QUEUED_OUTBOUND: ${queued} migrated message(s) are not received/sent (a queued row would be RESENT to the customer)`,
    );
  const orphans = await q1(
    `SELECT count(*) AS n FROM messages m WHERE m.org_id = ${orgId} AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.org_id = m.org_id AND c.id = m.conversation_id)`,
  );
  if (orphans > 0)
    alarm(`ORPHANS: ${orphans} message(s) point at a conversation that does not exist`);
  if (!a.allowExtraRows) {
    const stray = await q1(
      `SELECT count(*) AS n FROM messages m WHERE m.org_id = ${orgId} AND (m.meta->>'historySync' = 'true' OR m.meta->'legacy'->>'src' = 'waboo') AND ${notMapped}`,
    );
    if (stray > 0)
      alarm(
        `EXTRA_ROWS: ${stray} message(s) look migrated (historySync / legacy.src) but no source document owns them`,
      );
  }

  // ---- 6. the ledger ------------------------------------------------------------------------------------------------------------
  const wantLedger = new Map<string, string>(); // `${ext}\0${key}` -> message uuid
  for (const m of loaded)
    if (m.ledger && m.provider && loadedKeys.has(m.key))
      wantLedger.set(`${oracle.threads.get(m.thread!)!.ext}\u0000${m.provider}`, uuidOf(m.key));
  const led = await tenant((tx) =>
    tx.execute(
      sql.raw(`
      SELECT ch.external_id AS ext, l.key, l.kind, m.uuid::text AS muuid, m.conversation_id AS mconv, l.conversation_id AS lconv,
             ${tsCol('l.message_created_at', 'lat')}, ${tsCol('m.created_at', 'mat')}
      FROM message_ledger l JOIN channels ch ON ch.org_id = l.org_id AND ch.id = l.channel_id
      LEFT JOIN messages m ON m.org_id = l.org_id AND m.id = l.message_id AND m.created_at = l.message_created_at
      WHERE l.org_id = ${orgId}`),
    ),
  );
  const gotLedger = new Map<string, { muuid: string | null; ok: boolean }>();
  for (const r of rowsOf<{
    ext: string;
    key: string;
    kind: string;
    muuid: string | null;
    mconv: number | string | null;
    lconv: number | string;
    lat: string;
    mat: string | null;
  }>(led)) {
    gotLedger.set(`${r.ext}\u0000${r.key}`, {
      muuid: r.muuid,
      ok:
        r.kind === 'provider_id' &&
        r.muuid !== null &&
        Number(r.mconv) === Number(r.lconv) &&
        r.lat === r.mat,
    });
  }
  let missingLedger = 0;
  for (const [k, u] of wantLedger) {
    const g = gotLedger.get(k);
    if (!g) missingLedger++;
    else if (g.muuid !== u || !g.ok)
      alarm(`LEDGER_WRONG: a message_ledger row points at the wrong message, thread or time`);
  }
  if (missingLedger > 0)
    alarm(
      `LEDGER_MISSING: ${missingLedger} message(s) with a provider id have no message_ledger row`,
    );
  if (!a.allowExtraRows) {
    const extra = [...gotLedger.keys()].filter((k) => !wantLedger.has(k)).length;
    if (extra > 0)
      alarm(`EXTRA_ROWS: ${extra} message_ledger row(s) belong to no migrated message`);
  }

  // ---- 7. nothing the live application would write ------------------------------------------------------------------------------
  if (!a.allowExtraRows) {
    const own = `(SELECT id FROM conversations WHERE org_id = ${orgId} AND ${OWN})`;
    for (const t of ['conversation_events', 'conversation_participants', 'conversation_notes']) {
      const n = await q1(
        `SELECT count(*) AS n FROM ${t} WHERE org_id = ${orgId} AND conversation_id IN ${own}`,
      );
      if (n > 0)
        alarm(
          `EXTRA_ROWS: ${n} row(s) in ${t} belong to migrated conversations (history is imported quietly)`,
        );
    }
    const ev = await q1(`
      SELECT count(*) AS n FROM message_events e WHERE e.org_id = ${orgId} AND EXISTS (
        SELECT 1 FROM migration.id_map i WHERE i.source_client = '${client.replace(/'/g, "''")}' AND i.source_collection = 'chathistory'
          AND i.target_table = 'messages' AND i.target_id = e.message_id)`);
    if (ev > 0) alarm(`EXTRA_ROWS: ${ev} message_events row(s) belong to migrated messages`);
  }

  // ---- 8. partitions ------------------------------------------------------------------------------------------------------------
  if (oracle.range) {
    const months = await tenant((tx) =>
      tx.execute(sql`
        SELECT to_char(d::date, 'YYYYMM') AS m, to_regclass('public.messages_' || to_char(d::date, 'YYYYMM')) IS NOT NULL AS ok
        FROM generate_series(date_trunc('month', ${oracle.range!.min}::timestamptz), date_trunc('month', ${oracle.range!.max}::timestamptz), interval '1 month') d`),
    );
    const missing = rowsOf<{ m: string; ok: boolean }>(months)
      .filter((x) => !x.ok)
      .map((x) => x.m);
    if (missing.length > 0)
      alarm(`PARTITION: the monthly partition(s) ${missing.join(', ')} of messages do not exist`);
  }

  // ---- 9. the channels ----------------------------------------------------------------------------------------------------------
  const created = (rowsOf<{ counts?: { created?: Record<string, boolean> } }>(
    await db.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = '_chat' AND step = 'channels'`,
    ),
  )[0]?.counts?.created ?? {}) as Record<string, boolean>;
  const cutDone =
    rowsOf<{ state?: string }>(
      await db.execute(
        sql`SELECT state FROM migration.run_log WHERE source_client = ${client} AND collection = '_cutover' AND step = 'mark_connected'`,
      ),
    )[0]?.state === 'done';
  const entriesOf = new Map<string, Array<[string, (typeof s.map)[string]]>>();
  for (const [botid, e] of Object.entries(s.map))
    entriesOf.set(e.externalId, [...(entriesOf.get(e.externalId) ?? []), [botid, e]]);
  const chans = await tenant((tx) =>
    tx.execute(sql`
      SELECT id, uuid::text AS uuid, kind, name, status, external_id, display_address, credentials_enc, credential_hints,
             webhook_token_hash, capabilities, settings, waba_config_id, business_account_id, created_by, row_version
      FROM channels WHERE org_id = ${orgId}`),
  );
  const chRows = rowsOf<Record<string, unknown>>(chans);
  for (const ext of exts) {
    const list = entriesOf.get(ext)!.sort(([x], [y]) => (x < y ? -1 : 1));
    const first = list[0]![1];
    const chUuid = uuidv5(`${client}|chat_channel|whatsapp_cloud|${ext}`);
    const row =
      chRows.find((r) => r.kind === 'whatsapp_cloud' && r.external_id === ext) ??
      chRows.find((r) => r.kind === 'whatsapp_cloud' && r.uuid === chUuid);
    if (!row) {
      alarm(`CHANNEL_MISSING: the channel for phone number id ...${ext.slice(-4)} does not exist`);
      continue;
    }
    if (created[ext] !== true) continue; // adopted: it belongs to the application, only its existence is required
    // the explicit `cutover` command connected it (status, link, business account): the application owns it now, only its existence counts
    if (cutDone) continue;
    // pointed at the real WhatsApp number since (external_id is no longer the map's id): the application owns it now, only its existence counts
    if (row.external_id !== ext) continue;
    const bad: string[] = [];
    if (row.uuid !== uuidv5(`${client}|chat_channel|whatsapp_cloud|${ext}`)) bad.push('uuid');
    if (row.credentials_enc !== null)
      bad.push('credentials_enc (must stay empty: no secret is ever written)');
    if (row.webhook_token_hash !== null) bad.push('webhook_token_hash');
    if (stable(row.credential_hints) !== '{}') bad.push('credential_hints');
    if (!a.allowExtraRows) {
      if (row.name !== first.name) bad.push('name');
      if (row.status !== 'disconnected') bad.push('status');
      if ((row.display_address ?? null) !== first.displayAddress) bad.push('display_address');
      if (stable(row.capabilities) !== '{}') bad.push('capabilities');
      if (
        stable(row.settings) !==
        stable({ metered: true, legacy: { waboo: { client, botids: list.map(([b]) => b) } } })
      )
        bad.push('settings');
      if (
        row.waba_config_id !== null ||
        row.business_account_id !== null ||
        row.created_by !== null
      )
        bad.push('link columns');
      if (Number(row.row_version) !== 1) bad.push('row_version');
    }
    if (bad.length > 0)
      alarm(
        `CHANNEL_CHANGED: channel ...${ext.slice(-4)}: ${bad.join(', ')} differ from what the migration created`,
      );
  }
  if (!a.allowExtraRows)
    for (const r of chRows) {
      const marker = (r.settings as { legacy?: { waboo?: { client?: string } } } | null)?.legacy
        ?.waboo?.client;
      if (marker === client && !exts.includes(String(r.external_id)) && !chanUuidOf.has(String(r.uuid)))
        alarm(`EXTRA_ROWS: a channel carries the migration marker but is not in the channel map`);
    }

  // ---- 10. the options the run was made with ---------------------------------------------------------------------------------------
  const opt = rowsOf<{ counts?: Record<string, unknown> }>(
    await db.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = '_chat' AND step = 'options'`,
    ),
  )[0]?.counts;
  if (opt) {
    const now = {
      keepDeletedContactChats: s.keepDeletedContactChats,
      threadStatus: s.threadStatus,
      assignAgents: s.assignAgents,
      windowHours: s.windowHours,
      mapSha256: s.mapSha256,
    };
    for (const [k, v] of Object.entries(now))
      if (opt[k] !== v)
        a.warnings.push(
          `INBOX: option ${k} differs from the run that loaded the chats (run: ${String(opt[k])}, reconcile: ${String(v)}); pass the same flags`,
        );
  }
}
