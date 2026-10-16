import {
  buildChatPlan,
  channelUuid,
  loadOrder,
  type ChatPlan,
  type ThreadRec,
} from '../inbox/plan';
import type { ChannelMap, InboxSettings } from '../inbox/config';
import { readManifest } from '../extract/manifest';
import { inbox } from '../transform/inbox';
import type { Ctx, Row, TableSpec } from '../transform/types';
import { sanitizeError } from '../util';
import { c } from '../transform/common';
import { sql, withTenant, type Database, type TenantTx } from './db';
import { insertRows, rowUuid, type Env } from './engine';

/**
 * The loader half of the inbox step: channels from the operator's map, the monthly partitions, the plan, and the hooks that make a
 * thread (conversation row, message ids, ledger rows) around the messages the engine inserts. Everything is computed before the
 * INSERT: a new thread's conversation is inserted whole and never updated (touch_row would stamp updated_at and bump row_version). The one
 * exception is APPEND (a loaded thread that gets newer messages): its conversation is updated once, in the batch's transaction, with the counters
 * the plan computed for the whole thread, and its uuid is listed in run_log _chat/chat_append. Nothing is written
 * to the outbox, notifications, events, SLA timers, unread counters or usage charges (no trigger fires on INSERT here, and no code
 * of the application runs).
 */
export const CHAT_COLLECTION = '_chat';
/** run_log step that lists the conversations of already loaded threads that got new messages (their updated_at / row_version moved). */
export const APPEND_STEP = 'chat_append';

/** Conversation uuids an append touched (conversations has a touch trigger); the verifier expects exactly these to differ. */
export async function appendedConversations(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> },
  client: string,
): Promise<Set<string>> {
  const r = (
    await db.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = ${CHAT_COLLECTION} AND step = ${APPEND_STEP}`,
    )
  ).rows[0] as { counts?: { conversations?: string[] } } | undefined;
  return new Set(r?.counts?.conversations ?? []);
}

export const CONVERSATION_SPEC: TableSpec = {
  columns: [
    c('channel_id', 'bigint'),
    c('peer_key', 'text'),
    c('peer_name', 'text'),
    c('contact_id', 'bigint'),
    c('title', 'text'),
    c('preview', 'text'),
    c('status', 'text'),
    c('last_message_at', 'timestamptz'),
    c('msg_seq', 'bigint'),
    c('last_message_id', 'bigint'),
    c('last_inbound_at', 'timestamptz'),
    c('last_outbound_at', 'timestamptz'),
    c('window_expires_at', 'timestamptz'),
    c('assignee_user_id', 'bigint'),
    c('routing_meta', 'jsonb'),
    c('resolved_at', 'timestamptz'),
    c('created_at', 'timestamptz'),
    c('updated_at', 'timestamptz'),
  ],
};

/** Columns of `conversations` the loader never writes: they must still hold the column default (the verifier checks). */
export const CONVERSATION_DEFAULTS: Record<string, unknown> = {
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

export class InboxLoadError extends Error {}

export const channelSettings = (client: string, botids: string[]): Record<string, unknown> => ({
  metered: true,
  legacy: { waboo: { client, botids } },
});

/** One channel per phone number id, with every botid that maps to it. */
export function channelsOf(
  map: ChannelMap,
): Array<{ ext: string; name: string; displayAddress: string | null; botids: string[] }> {
  const by = new Map<
    string,
    { ext: string; name: string; displayAddress: string | null; botids: string[] }
  >();
  for (const [botid, e] of Object.entries(map)) {
    const have = by.get(e.externalId);
    if (have) have.botids.push(botid);
    else
      by.set(e.externalId, {
        ext: e.externalId,
        name: e.name,
        displayAddress: e.displayAddress,
        botids: [botid],
      });
  }
  return [...by.values()]
    .map((x) => ({ ...x, botids: x.botids.sort() }))
    .sort((x, y) => (x.ext < y.ext ? -1 : 1));
}

async function ensureChannels(
  env: Env,
  s: InboxSettings,
): Promise<Map<string, { id: number; uuid: string; created: boolean }>> {
  const out = new Map<string, { id: number; uuid: string; created: boolean }>();
  const prior = (
    (
      await env.db.execute(
        sql`SELECT counts FROM migration.run_log WHERE source_client = ${env.client} AND collection = ${CHAT_COLLECTION} AND step = 'channels'`,
      )
    ).rows[0] as { counts?: { created?: Record<string, boolean> } } | undefined
  )?.counts?.created;
  await withTenant(env.db, { orgId: env.orgId }, async (tx) => {
    for (const ch of channelsOf(s.map)) {
      const found = (
        await tx.execute(sql`
          SELECT id, uuid::text AS uuid FROM channels
          WHERE org_id = ${env.orgId} AND kind = 'whatsapp_cloud'
            AND (external_id = ${ch.ext} OR uuid = ${channelUuid(env.client, ch.ext)}::uuid)`)
      ).rows[0] as { id: number | string; uuid: string } | undefined;
      if (found) {
        out.set(ch.ext, {
          id: Number(found.id),
          uuid: found.uuid,
          created: prior?.[ch.ext] === true,
        });
        continue;
      }
      const ins = await tx.execute(sql`
        INSERT INTO channels (org_id, uuid, kind, name, status, external_id, display_address, credentials_enc, credential_hints,
                              webhook_token_hash, capabilities, settings)
        VALUES (${env.orgId}, ${channelUuid(env.client, ch.ext)}::uuid, 'whatsapp_cloud', ${ch.name}, 'disconnected', ${ch.ext},
                ${ch.displayAddress}, NULL, '{}'::jsonb, NULL, '{}'::jsonb, ${JSON.stringify(channelSettings(env.client, ch.botids))}::jsonb)
        ON CONFLICT DO NOTHING
        RETURNING id, uuid::text AS uuid`);
      const row = ins.rows[0] as { id: number | string; uuid: string } | undefined;
      if (!row)
        throw new InboxLoadError(
          `INBOX_CHANNEL_HELD: the WhatsApp phone number id of channel "${ch.name}" is already held by another workspace (a number belongs to one workspace's inbox). Nothing was written for ${env.client}; fix the channel map or free the number`,
        );
      out.set(ch.ext, { id: Number(row.id), uuid: row.uuid, created: true });
    }
  });
  await env.db.execute(sql`
    INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
    VALUES (${env.client}, ${CHAT_COLLECTION}, 'channels', ${env.runId}, 0, 'done',
            ${JSON.stringify({ created: Object.fromEntries([...out].map(([k, v]) => [k, v.created])) })}::jsonb)
    ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
  return out;
}

/** The months of [min, max] in the session's own time zone (that is how ensure_monthly_partition reads its date argument). */
export async function partitionMonths(
  db: Database | TenantTx,
  range: { min: string; max: string },
): Promise<string[]> {
  const r = await db.execute(sql`
    SELECT to_char(d::date, 'YYYY-MM-DD') AS m
    FROM generate_series(date_trunc('month', ${range.min}::timestamptz), date_trunc('month', ${range.max}::timestamptz), interval '1 month') d
    ORDER BY 1`);
  return (r.rows as Array<{ m: string }>).map((x) => x.m);
}

/** Fails BEFORE anything is written when the login may not create partitions (no silent fallback to owner rights). */
async function assertPartitionPrivilege(env: Env): Promise<void> {
  const ok = (
    await env.db.execute(
      sql`SELECT has_function_privilege('ensure_monthly_partition(regclass,date)', 'EXECUTE') AS ok`,
    )
  ).rows[0] as { ok: boolean };
  if (!ok.ok)
    throw new InboxLoadError(
      'INBOX_PARTITION_PRIVILEGE: the login this run uses may not call ensure_monthly_partition(), so the historical monthly partitions of `messages` cannot be created. Grant EXECUTE on it to the worker role (the migration 20261001110000 does this for crm_worker); this tool will not create partitions with owner rights behind your back. Nothing was written',
    );
}

async function ensurePartitions(env: Env, plan: ChatPlan): Promise<number> {
  if (!plan.range) return 0;
  const range = plan.range;
  return withTenant(env.db, { orgId: env.orgId }, async (tx) => {
    const months = await partitionMonths(tx, range);
    for (const m of months) {
      try {
        await tx.execute(sql`SELECT ensure_monthly_partition('messages'::regclass, ${m}::date)`);
      } catch (e) {
        throw new InboxLoadError(
          `INBOX_PARTITION: could not create the partition of ${m}: ${sanitizeError(e)}. The function accepts months from 10 years back to 1 year ahead`,
        );
      }
    }
    return months.length;
  });
}

/** Everything pass 1 needs from the target, read once: contacts by phone, threads that already exist, the channels' ids. */
export async function planFor(a: {
  db: Database;
  orgId: number;
  client: string;
  source: Env['source'];
  fallbackAt: string;
  idmap: Env['idmap'];
  idx: Env['idx'];
  settings: InboxSettings;
}): Promise<ChatPlan> {
  const exts = [...new Set(Object.values(a.settings.map).map((e) => e.externalId))];
  // a channel is the row with that phone number id OR the row this tool made for it (uuid from the map's id): once the real WhatsApp
  // number is connected the row carries the real id, but the threads (and their uuids) were made under the map's id
  const chanUuids = exts.map((e) => channelUuid(a.client, e));
  const extOfUuid = new Map(exts.map((e) => [channelUuid(a.client, e), e]));
  const extOf = (external: string | null, uuid: string): string | undefined =>
    external !== null && exts.includes(external) ? external : extOfUuid.get(uuid);
  const [contacts, existing, chans, owned] = await withTenant(a.db, { orgId: a.orgId }, async (tx) => {
    const cs = await tx.execute(sql`
      SELECT regexp_replace(normalized_phone, '\\D', '', 'g') AS d, count(*)::int AS n, min(id) AS id
      FROM contacts WHERE org_id = ${a.orgId} AND normalized_phone IS NOT NULL GROUP BY 1`);
    const ex = await tx.execute(sql`
      SELECT ch.external_id AS ext, ch.uuid::text AS chuuid, v.peer_key AS peer, v.uuid::text AS uuid
      FROM conversations v JOIN channels ch ON ch.org_id = v.org_id AND ch.id = v.channel_id
      WHERE v.org_id = ${a.orgId} AND ch.kind = 'whatsapp_cloud'
        AND (ch.external_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(exts)}::jsonb))
             OR ch.uuid IN (SELECT jsonb_array_elements_text(${JSON.stringify(chanUuids)}::jsonb)::uuid))`);
    const ch = await tx.execute(sql`
      SELECT external_id AS ext, uuid::text AS chuuid, id FROM channels
      WHERE org_id = ${a.orgId} AND kind = 'whatsapp_cloud'
        AND (external_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(exts)}::jsonb))
             OR uuid IN (SELECT jsonb_array_elements_text(${JSON.stringify(chanUuids)}::jsonb)::uuid))`);
    const lg = await tx.execute(sql`
      SELECT c.external_id AS ext, c.uuid::text AS chuuid, l.key AS key
      FROM message_ledger l JOIN channels c ON c.org_id = l.org_id AND c.id = l.channel_id
      WHERE l.org_id = ${a.orgId} AND l.kind = 'provider_id' AND c.kind = 'whatsapp_cloud'
        AND (c.external_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(exts)}::jsonb))
             OR c.uuid IN (SELECT jsonb_array_elements_text(${JSON.stringify(chanUuids)}::jsonb)::uuid))`);
    return [cs.rows, ex.rows, ch.rows, lg.rows] as const;
  });
  const contactsByDigits = new Map(
    (contacts as Array<{ d: string; n: number; id: number | string }>).map((r) => [
      r.d,
      { n: Number(r.n), id: Number(r.id) },
    ]),
  );
  const existingThreads = new Map<string, string>();
  for (const r of existing as Array<{ ext: string | null; chuuid: string; peer: string; uuid: string }>) {
    const ext = extOf(r.ext, r.chuuid);
    if (ext !== undefined) existingThreads.set(`${ext}|${r.peer}`, r.uuid);
  }
  const ledgerOwned = new Set<string>();
  for (const r of owned as Array<{ ext: string | null; chuuid: string; key: string }>) {
    const ext = extOf(r.ext, r.chuuid);
    if (ext !== undefined) ledgerOwned.add(`${ext}\u0000${r.key}`);
  }
  const plan = await buildChatPlan({
    source: a.source,
    client: a.client,
    settings: a.settings,
    referenceAt: a.fallbackAt,
    ref: (collection, key) => a.idmap.get(collection, key),
    contactDeleted: a.idx.contactDeleted,
    hasUsers: a.idx.hasUsers,
    contactsByDigits,
    existingThreads,
    migrated: (key) => a.idmap.get('chathistory', key) !== undefined,
    ledgerOwned,
  });
  for (const r of chans as Array<{ ext: string | null; chuuid: string; id: number | string }>) {
    const ext = extOf(r.ext, r.chuuid);
    if (ext !== undefined) plan.channelIds.set(ext, Number(r.id));
  }
  return plan;
}

/** What `prepare` found, kept for the log and the report. */
export interface InboxPrepared {
  channels: number;
  partitions: number;
  tally: Record<string, number>;
}

/**
 * A document the plan will insert or quarantine as out of order (a newer turn of a LOADED thread) must not already be a message in the
 * target: if its row exists but its id_map row is gone, the thread is damaged, not merely newer. Stops before anything is written.
 */
async function assertNoStrayMessages(env: Env, plan: ChatPlan): Promise<void> {
  const keys: string[] = [];
  for (const t of plan.threads.values())
    if (t.loaded > 0 && t.loaded < t.msgSeq) keys.push(...t.docs.slice(t.loaded));
  for (const d of plan.docs.values()) if (d.code === 'APPEND_OUT_OF_ORDER') keys.push(d.key);
  for (let i = 0; i < keys.length; i += 500) {
    const uuids = keys.slice(i, i + 500).map((k) => rowUuid(env.client, 'chathistory', k, ''));
    const n = await withTenant(env.db, { orgId: env.orgId }, async (tx) =>
      Number(
        (
          await tx.execute(sql`
            SELECT count(*)::int AS n FROM messages
            WHERE org_id = ${env.orgId} AND uuid = ANY (ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(uuids)}::jsonb)::uuid))`)
        ).rows[0]!.n,
      ),
    );
    if (n > 0)
      throw new InboxLoadError(
        `PARTIAL_THREAD: ${n} message row(s) of a loaded thread exist in the target but their id_map rows are missing; refusing to append or to skip them. Investigate before re-running`,
      );
  }
}

export async function prepareInbox(env: Env): Promise<InboxPrepared> {
  const s = env.inbox;
  if (!s) {
    // run.ts demands a map as soon as the dump has chat documents; an empty collection needs nothing
    const docs =
      readManifest(env.dumpsDir, env.client)?.collections.find(
        (c) => c.collection === 'chathistory',
      )?.docs ?? 0;
    if (docs === 0) return { channels: 0, partitions: 0, tally: {} };
    throw new InboxLoadError(
      'INBOX_CONFIG: the dump has chathistory but no channel map / inbox settings were given',
    );
  }
  await assertPartitionPrivilege(env);
  const channels = await ensureChannels(env, s);
  const plan = await planFor({ ...env, settings: s });
  if (plan.partial.length > 0)
    throw new InboxLoadError(
      `PARTIAL_THREAD: ${plan.partial.length} thread(s) exist in the target with some, but not all, of their messages mapped (a message, a conversation or an id_map row is missing, or the loaded messages are not the start of the thread). Nothing is appended to a half-loaded thread; investigate before re-running`,
    );
  await assertNoStrayMessages(env, plan);
  const partitions = await ensurePartitions(env, plan);
  env.chat = plan;
  await env.db.execute(sql`
    INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
    VALUES (${env.client}, ${CHAT_COLLECTION}, 'options', ${env.runId}, 0, 'done',
            ${JSON.stringify({
              keepDeletedContactChats: s.keepDeletedContactChats,
              threadStatus: s.threadStatus,
              assignAgents: s.assignAgents,
              windowHours: s.windowHours,
              mapSha256: s.mapSha256,
            })}::jsonb)
    ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
  env.log(
    `  inbox              ${channels.size} channel(s), ${plan.threads.size} thread(s), ${partitions} monthly partition(s) ensured; plan ${JSON.stringify(plan.tally)}`,
  );
  const appends = [...plan.threads.values()].filter((t) => t.loaded > 0 && t.loaded < t.msgSeq);
  if (appends.length > 0)
    env.log(
      `  inbox              APPEND: ${appends.length} loaded thread(s) get ${appends.reduce((n, t) => n + t.msgSeq - t.loaded, 0)} newer message(s) after their last loaded one (conversation counters recomputed in the same transaction)`,
    );
  if (plan.outOfOrder.length > 0)
    env.log(
      `  WARNING: APPEND_OUT_OF_ORDER: ${plan.outOfOrder.length} loaded thread(s) hold a turn that sorts before a loaded message; left exactly as loaded, the turns are quarantined (threads: ${plan.outOfOrder
        .slice(0, 20)
        .map((k) => `${plan.threads.get(k)!.uuid}`)
        .join(', ')}${plan.outOfOrder.length > 20 ? ', ...' : ''})`,
    );
  const cnt = [...plan.unmapped.values()].reduce((a, b) => a + b, 0);
  if (cnt > 0)
    env.log(
      `  WARNING: ${cnt} chat document(s) of ${plan.unmapped.size} botid(s) are not in the channel map (quarantined NO_CHANNEL)`,
    );
  return { channels: channels.size, partitions, tally: plan.tally };
}

/** The conversation row of a thread (everything computed in pass 1; last_message_id is the id allocated for its last message). */
function conversationRow(plan: ChatPlan, threadKey: string, lastMessageId: number): Row {
  const t = plan.threads.get(threadKey)!;
  return {
    channel_id: plan.channelIds.get(t.ext) ?? null,
    peer_key: t.peerKey,
    peer_name: t.peerName,
    contact_id: t.contactId,
    title: t.title,
    preview: t.preview,
    status: t.status,
    last_message_at: t.lastMessageAt,
    msg_seq: t.msgSeq,
    last_message_id: lastMessageId,
    last_inbound_at: t.lastInboundAt,
    last_outbound_at: t.lastOutboundAt,
    window_expires_at: t.windowExpiresAt,
    assignee_user_id: t.assigneeId,
    routing_meta: t.routingMeta,
    resolved_at: t.resolvedAt,
    created_at: t.createdAt,
    updated_at: t.lastMessageAt,
  };
}

async function beforeInsert(tx: TenantTx, ctx: Ctx, table: string, rows: Row[]): Promise<void> {
  if (table !== 'messages' || rows.length === 0) return;
  const plan = ctx.chat!;
  // 1. ids for every message of the batch, allocated up front (the conversation's last_message_id needs one)
  const got = await tx.execute(
    sql`SELECT nextval('messages_id_seq')::bigint AS id FROM generate_series(1, ${rows.length})`,
  );
  const ids = (got.rows as Array<{ id: number | string }>)
    .map((r) => Number(r.id))
    .sort((a, b) => a - b);
  rows.forEach((r, i) => {
    r.id = ids[i]!;
  });
  // 2. one conversation per NEW thread, inserted whole (counters included); a thread that is already loaded keeps its conversation and
  //    gets the counters of the whole thread in the same transaction (APPEND: its new messages all sort after the loaded ones)
  const byThread = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(r._thread);
    byThread.set(k, [...(byThread.get(k) ?? []), r]);
  }
  const items: Array<{ uuid: string; row: Row }> = [];
  const appends: Array<{ k: string; t: ThreadRec; lastId: number }> = [];
  for (const [k, list] of byThread) {
    const t = plan.threads.get(k)!;
    if (list.length !== t.msgSeq - t.loaded)
      throw new InboxLoadError(
        t.loaded === 0
          ? `PARTIAL_THREAD: a batch holds ${list.length} of the ${t.msgSeq} messages of a thread; a thread is never split`
          : `PARTIAL_THREAD: a batch holds ${list.length} of the ${t.msgSeq - t.loaded} new messages of a loaded thread; a thread is never split`,
      );
    const last = list.find((r) => Number(r.seq) === t.msgSeq)!;
    if (plan.channelIds.get(t.ext) === undefined)
      throw new InboxLoadError(
        'INBOX_CHANNEL_MISSING: a thread points at a channel that was not made',
      );
    if (t.loaded === 0) items.push({ uuid: t.uuid, row: conversationRow(plan, k, Number(last.id)) });
    else appends.push({ k, t, lastId: Number(last.id) });
  }
  if (items.length > 0) {
    const inserted = await insertRows(tx, ctx.orgId, 'conversations', CONVERSATION_SPEC, items);
    if (inserted.size !== items.length)
      throw new InboxLoadError(
        'PARTIAL_THREAD: a conversation of this batch already exists; refusing to attach messages to it',
      );
  }
  const wanted = [...items.map((i) => i.uuid), ...appends.map((x) => x.t.uuid)];
  // the conversations of a loaded thread are locked, and must hold exactly the messages the plan counted as loaded
  const ci = await tx.execute(sql`
    SELECT c.id, c.uuid::text AS uuid, c.msg_seq,
           (SELECT count(*) FROM messages m WHERE m.org_id = c.org_id AND m.conversation_id = c.id)::int AS n,
           (SELECT coalesce(max(m.seq), 0) FROM messages m WHERE m.org_id = c.org_id AND m.conversation_id = c.id)::int AS mx
    FROM conversations c
    WHERE c.org_id = ${ctx.orgId} AND c.uuid = ANY (ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(wanted)}::jsonb)::uuid))
    FOR UPDATE OF c`);
  const have = new Map(
    (
      ci.rows as Array<{
        id: number | string;
        uuid: string;
        msg_seq: number | string;
        n: number;
        mx: number;
      }>
    ).map((r) => [r.uuid, r]),
  );
  const idOf = new Map<string, number>();
  for (const [k, list] of byThread) {
    const t = plan.threads.get(k)!;
    const c = have.get(t.uuid);
    if (!c) throw new InboxLoadError('INBOX: conversation id missing after insert');
    if (t.loaded > 0 && (Number(c.msg_seq) !== t.loaded || c.n !== t.loaded || c.mx !== t.loaded))
      throw new InboxLoadError(
        `PARTIAL_THREAD: the conversation of a loaded thread holds msg_seq ${c.msg_seq}, ${c.n} message(s), max seq ${c.mx}, but the plan counted ${t.loaded} loaded; refusing to append`,
      );
    idOf.set(t.uuid, Number(c.id));
    for (const r of list) r.conversation_id = Number(c.id);
  }
  for (const { k, t, lastId } of appends) {
    const v = conversationRow(plan, k, lastId);
    const done = await tx.execute(sql`
      UPDATE conversations SET
        peer_name = ${v.peer_name as string | null}, contact_id = ${v.contact_id as number | null}::bigint, title = ${v.title as string},
        preview = ${v.preview as string}, status = ${v.status as string},
        last_message_at = ${v.last_message_at as string}::timestamptz, msg_seq = ${v.msg_seq as number}::bigint,
        last_message_id = ${v.last_message_id as number}::bigint,
        last_inbound_at = ${v.last_inbound_at as string | null}::timestamptz,
        last_outbound_at = ${v.last_outbound_at as string | null}::timestamptz,
        window_expires_at = ${v.window_expires_at as string | null}::timestamptz,
        assignee_user_id = ${v.assignee_user_id as number | null}::bigint,
        routing_meta = ${JSON.stringify(v.routing_meta)}::jsonb,
        resolved_at = ${v.resolved_at as string | null}::timestamptz
      WHERE org_id = ${ctx.orgId} AND id = ${idOf.get(t.uuid)!} AND msg_seq = ${t.loaded}
      RETURNING id`);
    if (done.rows.length !== 1)
      throw new InboxLoadError(
        'PARTIAL_THREAD: the conversation of a loaded thread changed under the append',
      );
  }
  if (appends.length > 0)
    // conversations has a touch trigger: updated_at / row_version move for these rows; the verifier expects exactly this list
    await tx.execute(sql`
      INSERT INTO migration.run_log AS rl (source_client, collection, step, run_id, last_key, state, counts)
      VALUES (${ctx.client}, ${CHAT_COLLECTION}, ${APPEND_STEP}, 'chat-append', 0, 'done',
              ${JSON.stringify({ conversations: appends.map((x) => x.t.uuid) })}::jsonb)
      ON CONFLICT (source_client, collection, step) DO UPDATE SET
        counts = jsonb_build_object('conversations', (
          SELECT coalesce(jsonb_agg(DISTINCT u ORDER BY u), '[]'::jsonb)
          FROM jsonb_array_elements_text(coalesce(rl.counts->'conversations', '[]'::jsonb) || (EXCLUDED.counts->'conversations')) u)),
        updated_at = now()`);
}

async function afterInsert(
  tx: TenantTx,
  ctx: Ctx,
  table: string,
  rows: Array<{ uuid: string; row: Row; id: number | undefined }>,
): Promise<void> {
  if (table !== 'messages') return;
  const plan = ctx.chat!;
  const ledger = rows
    .filter((r) => typeof r.row._ledger === 'string')
    .map((r) => ({
      channel_id: plan.channelIds.get(plan.threads.get(String(r.row._thread))!.ext)!,
      key: r.row._ledger as string,
      message_id: r.row.id as number,
      message_created_at: r.row.created_at as string,
      conversation_id: r.row.conversation_id as number,
    }));
  if (ledger.length === 0) return;
  // the live pipeline drops a second delivery of the same provider id at cutover; only messages that really have one get a row
  await tx.execute(sql`
    INSERT INTO message_ledger (org_id, channel_id, kind, key, message_id, message_created_at, conversation_id)
    SELECT ${ctx.orgId}::bigint, x.channel_id, 'provider_id', x.key, x.message_id, x.message_created_at, x.conversation_id
    FROM jsonb_to_recordset(${JSON.stringify(ledger)}::jsonb)
      AS x(channel_id bigint, key text, message_id bigint, message_created_at timestamptz, conversation_id bigint)
    ON CONFLICT DO NOTHING`);
}

/** Wires the loader hooks into the shared step spec (the spec itself is also used by the verifier, which needs none of this). */
export function installInboxLoader(): void {
  inbox.prepare = async (env) => {
    await prepareInbox(env);
  };
  inbox.loadOrder = (env) =>
    env.chat
      ? loadOrder(env.chat, env.source, env.client)
      : env.source.read(env.client, 'chathistory');
  inbox.beforeInsert = beforeInsert;
  inbox.afterInsert = afterInsert;
}
