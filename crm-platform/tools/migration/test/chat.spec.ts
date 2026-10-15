import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  InboxConfigError,
  parseChannelMap,
  resolveInbox,
  type InboxOptions,
} from '../inbox/config';
import { parseTurn } from '../inbox/parse';
import { defaultTitle, normalizePeerKey, previewOf } from '../inbox/peer';
import { runClient, type RunOptions } from '../load/run';
import { reconcile } from '../reconcile';
import { resolve } from '../registry';
import { STEPS } from '../transform';
import { asOwner, cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';
import {
  acmeChat,
  bulkChat,
  EXT_A1,
  EXT_A2,
  EXT_G1,
  globexChat,
  hex,
  LONG_TEXT,
  MAP_ACME,
  MAP_GLOBEX,
  turn,
} from './chat-fixtures';

const OWNER = 'owner@example.test';
const inboxA: InboxOptions = { channelMap: parseChannelMap(MAP_ACME) };
const inboxG: InboxOptions = { channelMap: parseChannelMap(MAP_GLOBEX) };

const opts = (
  d: Dumps,
  db: TestDb,
  client: 'acme' | 'globex',
  extra: Partial<RunOptions> = {},
): RunOptions =>
  runOpts(d, db, client, {
    org: { name: client, slug: client, ownerEmail: client === 'acme' ? OWNER : 'boss@globex.test' },
    inbox: client === 'acme' ? inboxA : inboxG,
    ...extra,
  });

const check = (
  d: Dumps,
  db: TestDb,
  client: 'acme' | 'globex',
  inbox?: InboxOptions,
  allowExtraRows = false,
) =>
  reconcile({
    source: d.source,
    dumpsDir: d.dir,
    client,
    targetUrl: db.workerUrl,
    sampleSize: 1000,
    inbox: inbox ?? (client === 'acme' ? inboxA : inboxG),
    allowExtraRows,
  });

const rows = async (db: TestDb, text: string): Promise<Array<Record<string, any>>> =>
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, any>>);
const one = async (db: TestDb, text: string): Promise<number> =>
  Number((await rows(db, text))[0]!.n);

/** Content of the chat tables that does not depend on ids or on when the run happened: two clean runs must agree on it. */
async function chatSnapshot(db: TestDb): Promise<string> {
  const msgs = await rows(
    db,
    `SELECT m.uuid::text AS uuid, c.uuid::text AS conv, m.seq, m.direction, m.kind, m.sender_kind, u.email::text AS sender, m.body, m.status,
            m.provider_message_id, m.meta, m.provider_ts, m.sent_at, m.created_at
     FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
     LEFT JOIN users u ON u.org_id = m.org_id AND u.id = m.sender_user_id ORDER BY m.uuid`,
  );
  const convs = await rows(
    db,
    `SELECT c.uuid::text AS uuid, ch.external_id, c.peer_key, c.peer_name, ct.legacy_id AS contact, c.title, c.preview, c.status,
            c.last_message_at, c.msg_seq, lm.uuid::text AS last_message, c.last_inbound_at, c.last_outbound_at, c.window_expires_at,
            u.email::text AS assignee, c.routing_meta, c.resolved_at, c.created_at, c.updated_at, c.unread_count, c.waiting_since
     FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
     LEFT JOIN contacts ct ON ct.org_id = c.org_id AND ct.id = c.contact_id
     LEFT JOIN users u ON u.org_id = c.org_id AND u.id = c.assignee_user_id
     LEFT JOIN messages lm ON lm.org_id = c.org_id AND lm.id = c.last_message_id ORDER BY c.uuid`,
  );
  const ledger = await rows(
    db,
    `SELECT ch.external_id, l.kind, l.key, m.uuid::text AS message FROM message_ledger l
     JOIN channels ch ON ch.org_id = l.org_id AND ch.id = l.channel_id
     JOIN messages m ON m.org_id = l.org_id AND m.id = l.message_id ORDER BY 1, 3`,
  );
  const channels = await rows(
    db,
    `SELECT uuid::text, kind, name, status, external_id, display_address, settings FROM channels ORDER BY external_id`,
  );
  return JSON.stringify({ msgs, convs, ledger, channels });
}

const CHAT_TABLES = [
  'channels',
  'conversations',
  'messages',
  'message_ledger',
  'migration.id_map',
  'migration.quarantine',
];
const totals = async (db: TestDb): Promise<Record<string, number>> =>
  Object.fromEntries(
    await Promise.all(
      CHAT_TABLES.map(
        async (t) => [t, await one(db, `SELECT count(*)::int AS n FROM ${t}`)] as const,
      ),
    ),
  );

let dumps: Dumps;
let base: TestDb;
const dbs: TestDb[] = [];
const clone = async (label: string, from?: string): Promise<TestDb> => {
  const d = await cloneDb(label, from);
  dbs.push(d);
  return d;
};

beforeAll(async () => {
  const a = acmeChat();
  const g = globexChat();
  dumps = await customDumps({
    acme: { contact_list: a.contact_list, user: a.user, chathistory: a.chathistory },
    globex: { contact_list: g.contact_list, chathistory: g.chathistory },
  });
  base = await clone('chat-base');
  await runClient(opts(dumps, base, 'acme'));
  await runClient(opts(dumps, base, 'globex'));
}, 1_800_000);

afterAll(async () => {
  for (const d of dbs) await d.drop();
  dumps.cleanup();
});

describe('registry and configuration', () => {
  it('chathistory is migrated by the inbox step, the derived copy stays excluded', () => {
    expect(resolve('chathistory')).toMatchObject({ disposition: 'MIGRATE', handler: 'inbox' });
    expect(resolve('chathistory').targets).toEqual([
      'channels',
      'conversations',
      'messages',
      'message_ledger',
    ]);
    expect(resolve('chathistory_view').disposition).toBe('EXCLUDE');
    expect(STEPS.at(-1)!.handler).toBe('inbox');
  });

  it('the channel map is validated: no secrets, no unknown keys, no empty map', () => {
    expect(() => parseChannelMap({})).toThrow(InboxConfigError);
    expect(() =>
      parseChannelMap({
        b: { kind: 'whatsapp_cloud', externalId: '12345', name: 'x', accessToken: 'abc' },
      }),
    ).toThrow(/unknown key/);
    expect(() =>
      parseChannelMap({
        b: { kind: 'whatsapp_cloud', externalId: 'EAAabcdefghijklmnopqrstuvwxyz1234', name: 'x' },
      }),
    ).toThrow(/credential|phone number id/);
    expect(() =>
      parseChannelMap({
        b: { kind: 'whatsapp_cloud', externalId: '12345', name: 'sk-abcdefghijklmnopqrstuvwx' },
      }),
    ).toThrow(/credential/);
    expect(() =>
      parseChannelMap({ b: { kind: 'telegram', externalId: '12345', name: 'x' } }),
    ).toThrow(/whatsapp_cloud/);
    expect(() =>
      parseChannelMap({ b: { kind: 'whatsapp_cloud', externalId: '12345', name: '  ' } }),
    ).toThrow(/name/);
    expect(() =>
      parseChannelMap({
        a: { kind: 'whatsapp_cloud', externalId: '12345', name: 'One' },
        b: { kind: 'whatsapp_cloud', externalId: '12345', name: 'Two' },
      }),
    ).toThrow(/one number is one channel/);
    expect(parseChannelMap(MAP_ACME)['bot-a1']!.externalId).toBe(EXT_A1);
  });

  it('a missing map fails loudly before anything is written (dry run included)', async () => {
    expect(() => resolveInbox(undefined, dumps.dir, 'acme')).toThrow(/no channel map/);
    const db = await clone('chat-nomap');
    for (const dryRun of [true, false]) {
      await expect(
        runClient(
          runOpts(dumps, db, 'acme', {
            org: { name: 'acme', slug: 'acme', ownerEmail: OWNER },
            dryRun,
          }),
        ),
      ).rejects.toThrow(/INBOX_CONFIG.*no channel map/);
    }
    expect(await one(db, 'SELECT count(*)::int AS n FROM organizations')).toBe(0);
    expect((await totals(db)).messages).toBe(0);
    const r = await reconcile({
      source: dumps.source,
      dumpsDir: dumps.dir,
      client: 'acme',
      targetUrl: db.workerUrl,
    });
    expect(r.ok).toBe(false);
  });
});

describe('peer key, title, preview and the turn parser', () => {
  it('normalizePeerKey follows the live ingest rule', () => {
    expect(normalizePeerKey('whatsapp_cloud', '+91 98765-43210')).toBe('919876543210');
    expect(normalizePeerKey('whatsapp_cloud', '919876543210@s.whatsapp.net')).toBe('919876543210');
    expect(normalizePeerKey('whatsapp_cloud', '919876543210:12@s.whatsapp.net')).toBe(
      '919876543210',
    );
    expect(normalizePeerKey('whatsapp_cloud', '0091 98765 43210')).toBe('919876543210');
    expect(normalizePeerKey('whatsapp_cloud', '1234')).toBe('1234');
    expect(normalizePeerKey('whatsapp_cloud', '12')).toBeNull();
    expect(normalizePeerKey('whatsapp_cloud', '  ')).toBeNull();
    expect(normalizePeerKey('webchat', ' Visitor-ABC ')).toBe('visitor-abc');
    expect(defaultTitle('whatsapp_cloud', '919876543210', null)).toBe('+919876543210');
    expect(defaultTitle('whatsapp_cloud', '919876543210', '  Asha  ')).toBe('Asha');
    expect(previewOf({ kind: 'text', body: '  a \n b  ' })).toBe('a b');
    expect(previewOf({ kind: 'image', body: null })).toBe('📎 Image');
    expect(previewOf({ kind: 'text', body: 'x'.repeat(300) })).toHaveLength(200);
  });

  it('still matches the application files it was copied from', () => {
    const api = resolvePath(__dirname, '../../../apps/api/src/modules/chat-conversations');
    const peer = readFileSync(join(api, 'peer-key.ts'), 'utf8');
    expect(peer).toContain("new Set(['simulator', 'whatsapp_cloud', 'whatsapp_qr'])");
    expect(peer).toContain('const PEER_KEY_MAX = 128');
    expect(peer).toContain('digits.length >= 4 && digits.length <= 20');
    expect(peer).toContain('return isPhoneChannel(kind) ? `+${peerKey}` : peerKey;');
    const rules = readFileSync(join(api, 'message-rules.ts'), 'utf8');
    expect(rules).toContain('export const PREVIEW_MAX = 200');
    expect(rules).toContain('`📎 ${capitalise(String(m.kind))}`');
  });

  it('reads the shapes it knows, and records a soft issue for the ones it has to guess', () => {
    const out = parseTurn({
      ctype: 'livechat',
      bot_response: {
        type: 'image',
        response: [{ url: 'https://x.example.test/a.png', text: 'cap' }],
      },
    });
    expect(out).toMatchObject({
      direction: 'out',
      kind: 'image',
      senderKind: 'agent',
      body: 'cap',
      mediaUrl: 'https://x.example.test/a.png',
    });
    expect(parseTurn({ bot_response: { response: 'plain' } }).soft.map((s) => s.code)).toContain(
      'SHAPE_UNEXPECTED',
    );
    expect(
      parseTurn({ bot_response: { type: 'zzz', response: ['a'] } }).soft.map((s) => s.code),
    ).toContain('UNKNOWN_KIND');
    expect(parseTurn({ bot_response: { response: [{ buttons: [] }] } })).toMatchObject({
      body: null,
      empty: false,
    });
    expect(parseTurn({ bot_response: { response: [''] } }).empty).toBe(true);
    expect(parseTurn({ user_query: '  hi  ' })).toMatchObject({
      direction: 'in',
      body: 'hi',
      kind: 'text',
    });
    expect(parseTurn({ user_query: { url: 'https://x.example.test/a.pdf' } })).toMatchObject({
      kind: 'document',
      body: null,
    });
    expect(parseTurn({ user_query_object: { fromAgent: 'a', toAgent: 'b' } })).toMatchObject({
      kind: 'system',
      senderKind: 'system',
    });
    expect(parseTurn({})).toMatchObject({ direction: null, empty: true });
    expect(() =>
      parseTurn({ bot_response: { response: [[[[['deep']]]]] }, user_query_object: 5 as never }),
    ).not.toThrow();
  });
});

describe('the load', () => {
  it('reconcile passes for both clients: the equation holds and every independent check agrees', async () => {
    for (const c of ['acme', 'globex'] as const) {
      const r = await check(dumps, base, c);
      expect(r.alarms, c).toEqual([]);
      expect(r.integrity, c).toEqual([]);
      expect(r.unaccounted, c).toBe(0);
      expect(r.ok, c).toBe(true);
      const row = r.collections.find((x) => x.collection === 'chathistory')!;
      expect(row.migrated + row.quarantined + row.excluded, c).toBe(row.read);
    }
    const r = await check(dumps, base, 'acme');
    expect(r.collections.find((x) => x.collection === 'chathistory')).toMatchObject({
      read: 61,
      migrated: 47,
      quarantined: 11,
      excluded: 3,
    });
    expect(
      r.collections.find((x) => x.kind === 'derived' && x.collection.startsWith('chat_threads')),
    ).toMatchObject({ read: 10, migrated: 10 });
    expect(
      r.collections.find((x) => x.collection === 'chathistory_view')?.disposition,
    ).toBeUndefined();
    const g = await check(dumps, base, 'globex');
    expect(g.collections.find((x) => x.collection === 'chathistory')).toMatchObject({
      read: 3,
      migrated: 3,
    });
  });

  it('puts every turn in the right place with the right reason', async () => {
    const r = await check(dumps, base, 'acme');
    const codes = r.nonMigrated
      .filter((n) => n.collection === 'chathistory')
      .map((n) => `${n.status}:${n.code}`);
    const tally = (c: string) => codes.filter((x) => x === c).length;
    expect(tally('quarantined:WEBCHAT_NO_CHANNEL')).toBe(1);
    expect(tally('quarantined:NO_CHANNEL')).toBe(1);
    expect(tally('quarantined:NO_PEER')).toBe(1);
    expect(tally('quarantined:BAD_DATE')).toBe(4);
    expect(tally('quarantined:EMPTY_MESSAGE')).toBe(2);
    expect(tally('quarantined:NUL_CHAR')).toBe(1);
    expect(tally('quarantined:LONE_SURROGATE')).toBe(1);
    expect(tally('excluded:CONTACT_DELETED_AT_SOURCE')).toBe(2);
    expect(tally('excluded:DUPLICATE_MESSAGE')).toBe(1);
    const soft = r.fieldIssues;
    expect(Object.keys(soft).some((k) => k.endsWith('DUP_ID_DIFFERENT_BODY'))).toBe(true);
    expect(Object.keys(soft).some((k) => k.endsWith('UNKNOWN_KIND'))).toBe(true);
    expect(Object.keys(soft).some((k) => k.endsWith('SHAPE_UNEXPECTED'))).toBe(true);
    expect(Object.keys(soft).some((k) => k.endsWith('CONTACT_BY_PHONE'))).toBe(true);
    expect(Object.keys(soft).some((k) => k.endsWith('CONTACT_UNRESOLVED'))).toBe(true);
    expect(Object.keys(soft).some((k) => k.endsWith('UNRESOLVED_AGENT'))).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/option .* differs/);
  });

  it('builds ONE conversation per number and channel, never per Waboo session', async () => {
    const t = await rows(
      base,
      `SELECT ch.external_id AS ext, c.peer_key, c.msg_seq, c.status, c.title, c.peer_name, c.contact_id IS NOT NULL AS has_contact,
              c.assignee_user_id IS NOT NULL AS assigned, c.unread_count, c.waiting_since, c.archived,
              (SELECT count(DISTINCT m.meta->'legacy'->>'sessionId') FROM messages m WHERE m.org_id = c.org_id AND m.conversation_id = c.id) AS sessions
       FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
       JOIN organizations o ON o.id = c.org_id AND o.slug = 'acme' ORDER BY ch.external_id, c.peer_key`,
    );
    expect(t.map((x) => `${x.ext}|${x.peer_key}`)).toEqual([
      `${EXT_A1}|919812345671`,
      `${EXT_A1}|919812345672`,
      `${EXT_A1}|919812345673`,
      `${EXT_A1}|919812345674`,
      `${EXT_A1}|919812345677`,
      `${EXT_A1}|919812345678`,
      `${EXT_A1}|919812345681`,
      `${EXT_A1}|919812345682`,
      `${EXT_A1}|919812345683`,
      `${EXT_A2}|919812345671`,
    ]);
    const t1 = t[0]!;
    expect(t1).toMatchObject({
      msg_seq: 12,
      status: 'closed',
      has_contact: true,
      assigned: true,
      unread_count: 0,
      waiting_since: null,
      archived: false,
    });
    expect(Number(t1.sessions)).toBe(3);
    expect(t1.peer_name).toBe('Asha R');
    expect(t1.title).toBe('Asha R');
    // by phone only, ambiguous, quarantined in phase 1, absent
    expect(t.find((x) => x.peer_key === '919812345673')).toMatchObject({
      has_contact: true,
      title: '+919812345673',
    });
    for (const p of ['919812345674', '919812345677', '919812345678'])
      expect(t.find((x) => x.peer_key === p)!.has_contact, p).toBe(false);
    // a person on two numbers has two threads
    expect(t.filter((x) => x.peer_key === '919812345671')).toHaveLength(2);
    // the deleted contact has none
    expect(t.some((x) => x.peer_key === '919812345676')).toBe(false);
  });

  it('writes messages as quiet history: sent, never queued, in order, backdated, nothing for the live pipeline', async () => {
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM messages WHERE status NOT IN ('received', 'sent')`,
      ),
    ).toBe(0);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM messages WHERE direction = 'out' AND status <> 'sent'`,
      ),
    ).toBe(0);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM messages WHERE direction = 'in' AND status <> 'received'`,
      ),
    ).toBe(0);
    expect(await one(base, `SELECT count(*)::int AS n FROM messages_default`)).toBe(0);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM messages WHERE created_at > now() - interval '1 day'`,
      ),
    ).toBe(0);
    for (const t of [
      'event_outbox',
      'notifications',
      'conversation_events',
      'conversation_participants',
      'conversation_notes',
      'message_events',
      'audit_log',
      'usage_charges',
    ])
      expect(await one(base, `SELECT count(*)::int AS n FROM ${t}`), t).toBe(
        t === 'audit_log' ? await one(base, 'SELECT count(*)::int AS n FROM audit_log') : 0,
      );
    // seq is 1..n, strictly the order of createdAt then id
    const bad = await rows(
      base,
      `SELECT c.id FROM conversations c JOIN messages m ON m.org_id = c.org_id AND m.conversation_id = c.id
       GROUP BY c.id, c.msg_seq HAVING min(m.seq) <> 1 OR max(m.seq) <> count(*) OR count(DISTINCT m.seq) <> count(*) OR c.msg_seq <> count(*)`,
    );
    expect(bad).toEqual([]);
    const tie = await rows(
      base,
      `SELECT m.seq, m.body FROM messages m JOIN conversations c ON c.id = m.conversation_id AND c.org_id = m.org_id
       WHERE c.peer_key = '919812345672' ORDER BY m.seq LIMIT 3`,
    );
    expect(tie.map((x) => x.body)).toEqual(['tie two', 'tie one', 'epoch milliseconds']);
    // partitions for Dec 2025 .. Feb 2026 exist and hold the rows
    for (const m of ['202512', '202601', '202602'])
      expect(
        await one(base, `SELECT (to_regclass('public.messages_${m}') IS NOT NULL)::int AS n`),
        m,
      ).toBe(1);
    const per = await rows(
      base,
      `SELECT tableoid::regclass::text AS p, count(*)::int AS n FROM messages GROUP BY 1 ORDER BY 1`,
    );
    expect(per.map((x) => x.p)).toEqual(
      expect.arrayContaining(['messages_202512', 'messages_202601', 'messages_202602']),
    );
  });

  it('keeps the counters, window and last-message pointers the live path would have written', async () => {
    const t1 = (
      await rows(
        base,
        `SELECT c.*, lm.body AS last_body, lm.seq AS last_seq FROM conversations c
         JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id JOIN messages lm ON lm.org_id = c.org_id AND lm.id = c.last_message_id
         WHERE ch.external_id = '${EXT_A1}' AND c.peer_key = '919812345671'`,
      )
    )[0]!;
    expect(Number(t1.last_seq)).toBe(12);
    expect(t1.last_body).toBe('Thanks');
    expect(new Date(t1.last_message_at).toISOString()).toBe('2026-02-03T08:01:00.000Z');
    expect(new Date(t1.created_at).toISOString()).toBe('2025-12-28T09:00:00.000Z');
    expect(new Date(t1.updated_at).toISOString()).toBe('2026-02-03T08:01:00.000Z');
    expect(new Date(t1.last_inbound_at).toISOString()).toBe('2026-02-03T08:01:00.000Z');
    expect(new Date(t1.last_outbound_at).toISOString()).toBe('2026-02-03T08:00:30.000Z');
    expect(new Date(t1.window_expires_at).toISOString()).toBe('2026-02-04T08:01:00.000Z');
    expect(new Date(t1.resolved_at).toISOString()).toBe('2026-02-03T08:01:00.000Z');
    expect(t1.preview).toBe('Thanks');
    expect(t1.row_version).toBe(1);
    expect(t1.routing_meta).toMatchObject({
      legacy: { source: 'waboo', botid: 'bot-a1', lastSessionId: 'sess-t1-c' },
    });
  });

  it('handles the odd shapes: media urls in meta only, hand-over line, emoji, long text, scrubbed extras', async () => {
    const m = async (body: string) =>
      (await rows(base, `SELECT * FROM messages WHERE body = '${body.replace(/'/g, "''")}'`))[0]!;
    const img = (
      await rows(
        base,
        `SELECT * FROM messages WHERE meta->'legacy'->>'mediaUrl' = 'https://files.example.test/a.jpg'`,
      )
    )[0]!;
    expect(img).toMatchObject({
      kind: 'image',
      body: 'caption',
      media_key: null,
      direction: 'out',
      status: 'sent',
    });
    const doc = (
      await rows(
        base,
        `SELECT * FROM messages WHERE meta->'legacy'->>'mediaUrl' = 'https://files.example.test/doc.pdf'`,
      )
    )[0]!;
    expect(doc).toMatchObject({
      kind: 'document',
      body: 'see attached',
      direction: 'in',
      status: 'received',
      media_key: null,
    });
    const hand = (await rows(base, `SELECT * FROM messages WHERE sender_kind = 'system'`))[0]!;
    expect(hand).toMatchObject({
      body: 'Chat transferred',
      kind: 'system',
      direction: 'in',
      status: 'received',
    });
    expect(hand.meta.legacy.transfer).toMatchObject({ from: 'usr-chat-01', to: 'usr-chat-02' });
    expect(await m('🙏🏽 emoji and 日本語 text')).toMatchObject({
      direction: 'out',
      provider_message_id: 'wamid.T8.0001',
    });
    expect(await m('नमस्ते, मुझे मदद चाहिए')).toMatchObject({ direction: 'in' });
    expect(await m('One more question "quoted" and \'single\' \\ backslash')).toMatchObject({
      direction: 'in',
    });
    expect(
      (await rows(base, `SELECT length(body) AS n FROM messages WHERE length(body) > 50000`))[0]!.n,
    ).toBe(String(LONG_TEXT.length) === '60000' ? 60000 : 0);
    const em = await m('🙏🏽 emoji and 日本語 text');
    expect(em.meta.legacy).toMatchObject({
      whatsappWindow: true,
      windowStart: '2026-02-16T09:00:00.000Z',
      src: 'waboo',
      ctype: 'bot',
    });
    expect(em.meta.legacy.extra).toEqual({ some_new_key: 'kept in extra' }); // api_token is a credential and is dropped
    expect(JSON.stringify(em.meta)).not.toContain('sk-abcdef');
    const agent = (
      await rows(
        base,
        `SELECT m.sender_kind, m.sender_user_id IS NOT NULL AS has_user FROM messages m WHERE m.body = 'Hi, this is Agent One.'`,
      )
    )[0]!;
    expect(agent).toMatchObject({ sender_kind: 'agent', has_user: true });
    const unresolved = (
      await rows(
        base,
        `SELECT m.sender_kind, m.sender_user_id FROM messages m WHERE m.body = 'a' AND m.sender_kind = 'agent'`,
      )
    )[0]!;
    expect(unresolved.sender_user_id).toBeNull();
    const buttons = (
      await rows(base, `SELECT kind, body FROM messages WHERE meta->'legacy'->>'subType' = 'quick'`)
    )[0]!;
    expect(buttons).toMatchObject({ kind: 'interactive', body: null });
  });

  it('writes the channel from the map only, with no secret, and a ledger row only for real provider ids', async () => {
    const ch = await rows(base, `SELECT * FROM channels ORDER BY external_id`);
    expect(ch.map((c) => c.external_id)).toEqual([EXT_A1, EXT_A2, EXT_G1]);
    for (const c of ch) {
      expect(c).toMatchObject({
        kind: 'whatsapp_cloud',
        status: 'disconnected',
        credentials_enc: null,
        webhook_token_hash: null,
        waba_config_id: null,
      });
      expect(c.credential_hints).toEqual({});
    }
    expect(ch[0]).toMatchObject({ name: 'Acme main', display_address: '+91 98000 11111' });
    expect(ch[0]!.settings).toEqual({
      metered: true,
      legacy: { waboo: { client: 'acme', botids: ['bot-a1'] } },
    });
    const led = await rows(
      base,
      `SELECT ch.external_id, l.key, l.kind, m.body FROM message_ledger l JOIN channels ch ON ch.org_id = l.org_id AND ch.id = l.channel_id
       JOIN messages m ON m.org_id = l.org_id AND m.id = l.message_id ORDER BY l.key`,
    );
    expect(led.map((l) => l.key)).toEqual(['wamid.T1.0001', 'wamid.T1.0002', 'wamid.T8.0001']);
    expect(led.every((l) => l.kind === 'provider_id')).toBe(true);
    expect(led[2]!.body).toBe('🙏🏽 emoji and 日本語 text'); // the first owner of a provider id keeps it
  });

  it('keeps two organizations apart even when the same phone number chats with both', async () => {
    const both = await rows(
      base,
      `SELECT o.slug, count(*)::int AS n FROM conversations c JOIN organizations o ON o.id = c.org_id WHERE c.peer_key = '919812345671' GROUP BY 1 ORDER BY 1`,
    );
    expect(both).toEqual([
      { slug: 'acme', n: 2 },
      { slug: 'globex', n: 1 },
    ]);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM messages m JOIN organizations o ON o.id = m.org_id WHERE o.slug = 'globex'`,
      ),
    ).toBe(3);
  });
});

describe('dry run, idempotency, resume', () => {
  it('a dry run writes nothing', async () => {
    const db = await clone('chat-dry');
    const lines: string[] = [];
    // org + the other steps are also rolled back: compare the whole of the chat side and the id map
    await runClient(opts(dumps, db, 'acme', { dryRun: true, log: (l) => lines.push(l) }));
    expect(await totals(db)).toEqual({
      channels: 0,
      conversations: 0,
      messages: 0,
      message_ledger: 0,
      'migration.id_map': 0,
      'migration.quarantine': 0,
    });
    expect(lines.join('\n')).toMatch(/inbox\s+\d+ read|inbox +/);
    expect(lines.join('\n')).toMatch(/DRY RUN plan/);
    // the partitions created for it are rolled back too
    expect(await one(db, `SELECT (to_regclass('public.messages_202512') IS NULL)::int AS n`)).toBe(
      1,
    );
  });

  it('a second run loads nothing new, with and without --force', async () => {
    const db = await clone('chat-rerun');
    await runClient(opts(dumps, db, 'acme'));
    const before = await totals(db);
    const snap = await chatSnapshot(db);
    await runClient(opts(dumps, db, 'acme'));
    await runClient(opts(dumps, db, 'acme', { force: true }));
    await runClient(opts(dumps, db, 'acme', { force: true, batchSize: 3 }));
    expect(await totals(db)).toEqual(before);
    expect(await chatSnapshot(db)).toBe(snap);
    const r = await check(dumps, db, 'acme');
    expect(r.alarms).toEqual([]);
  });

  it('a run killed in the middle of the chats resumes to exactly the result of a clean run', async () => {
    const clean = await clone('chat-clean');
    await runClient(opts(dumps, clean, 'acme', { batchSize: 5 }));
    const expected = await chatSnapshot(clean);

    const killed = await clone('chat-killed');
    let n = 0;
    await expect(
      runClient(
        opts(dumps, killed, 'acme', {
          batchSize: 5,
          midBatch: ({ step }) => {
            if (step === 'inbox' && ++n === 3)
              throw new Error('simulated crash inside the batch transaction');
          },
        }),
      ),
    ).rejects.toThrow(/simulated crash/);
    const partial = await totals(killed);
    expect(partial.messages).toBeGreaterThan(0);
    expect(partial.messages).toBeLessThan(47);
    // the interrupted batch rolled back whole: no thread is half there
    expect(
      await one(
        killed,
        `SELECT count(*)::int AS n FROM conversations c WHERE c.msg_seq <> (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.org_id = c.org_id)`,
      ),
    ).toBe(0);
    await runClient(opts(dumps, killed, 'acme', { batchSize: 5 }));
    expect(await chatSnapshot(killed)).toBe(expected);
    expect((await check(dumps, killed, 'acme')).alarms).toEqual([]);

    // killed AFTER a committed batch (the checkpoint is a thread boundary), different batch size on resume
    const killed2 = await clone('chat-killed2');
    let k = 0;
    await expect(
      runClient(
        opts(dumps, killed2, 'acme', {
          batchSize: 4,
          afterBatch: ({ step }) => {
            if (step === 'inbox' && ++k === 2) throw new Error('simulated kill after a commit');
          },
        }),
      ),
    ).rejects.toThrow(/simulated kill/);
    await runClient(opts(dumps, killed2, 'acme', { batchSize: 9 }));
    expect(await chatSnapshot(killed2)).toBe(expected);
  });
});

describe('safety checks', () => {
  it('refuses to start without EXECUTE on ensure_monthly_partition, and writes nothing', async () => {
    const db = await clone('chat-nopriv');
    await asOwner(db, (d) =>
      d.execute(
        sql.raw(
          'REVOKE EXECUTE ON FUNCTION ensure_monthly_partition(regclass, date) FROM crm_worker',
        ),
      ),
    );
    await expect(runClient(opts(dumps, db, 'acme'))).rejects.toThrow(/INBOX_PARTITION_PRIVILEGE/);
    const t = await totals(db);
    expect(t.channels).toBe(0);
    expect(t.messages).toBe(0);
  });

  it('a thread with some of its messages mapped and some not stops the run instead of appending', async () => {
    const db = await clone('chat-partial', base.name);
    await asOwner(db, (d) =>
      d.execute(
        sql.raw(
          `DELETE FROM migration.id_map WHERE source_client = 'acme' AND source_collection = 'chathistory' AND source_key = (SELECT source_key FROM migration.id_map WHERE source_client = 'acme' AND source_collection = 'chathistory' ORDER BY source_key LIMIT 1)`,
        ),
      ),
    );
    await expect(runClient(opts(dumps, db, 'acme', { force: true }))).rejects.toThrow(
      /PARTIAL_THREAD/,
    );
    const r = await check(dumps, db, 'acme');
    expect(r.ok).toBe(false);
    expect(r.alarms.join('\n')).toMatch(/PARTIAL_THREAD|IDMAP_MISSING/);
  });

  it('a phone number id held by another workspace aborts the client, not row by row', async () => {
    const db = await clone('chat-held');
    await runClient(opts(dumps, db, 'acme'));
    const stolen = parseChannelMap({
      'bot-g1': {
        kind: 'whatsapp_cloud',
        externalId: EXT_A1,
        displayAddress: '+44 7700 900123',
        name: 'Globex',
      },
    });
    await expect(
      runClient(opts(dumps, db, 'globex', { inbox: { channelMap: stolen } })),
    ).rejects.toThrow(/INBOX_CHANNEL_HELD/);
    expect(
      await one(
        db,
        `SELECT count(*)::int AS n FROM messages m JOIN organizations o ON o.id = m.org_id WHERE o.slug = 'globex'`,
      ),
    ).toBe(0);
  });

  it('a conversation that already exists for the number is a live thread: its chat is quarantined, not merged', async () => {
    // simulate the live app on a fresh database: org first (no chats yet), then a live channel + conversation, then the chat run
    const live = await clone('chat-live3');
    const noChat = await customDumps({
      acme: { contact_list: acmeChat().contact_list, user: acmeChat().user },
    });
    try {
      await runClient(
        runOpts(noChat, live, 'acme', { org: { name: 'acme', slug: 'acme', ownerEmail: OWNER } }),
      );
    } finally {
      noChat.cleanup();
    }
    await asOwner(live, async (d) => {
      await d.execute(
        sql.raw(
          `INSERT INTO channels (org_id, kind, name, status, external_id, display_address) SELECT id, 'whatsapp_cloud', 'App channel', 'connected', '${EXT_A1}', '+91 98000 11111' FROM organizations WHERE slug = 'acme'`,
        ),
      );
      await d.execute(
        sql.raw(
          `INSERT INTO conversations (org_id, channel_id, peer_key, title, status) SELECT c.org_id, c.id, '919812345672', 'Live thread', 'open' FROM channels c WHERE c.external_id = '${EXT_A1}'`,
        ),
      );
    });
    // the chats arrive in the same organization
    await runClient(opts(dumps, live, 'acme'));
    const q = await rows(
      live,
      `SELECT reason_code, count(*)::int AS n FROM migration.quarantine WHERE collection = 'chathistory' AND reason_code = 'THREAD_HAS_LIVE_MESSAGES' GROUP BY 1`,
    );
    expect(q).toEqual([{ reason_code: 'THREAD_HAS_LIVE_MESSAGES', n: 7 }]);
    expect(
      await one(
        live,
        `SELECT count(*)::int AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id AND c.org_id = m.org_id WHERE c.title = 'Live thread'`,
      ),
    ).toBe(0);
    expect(
      await one(live, `SELECT count(*)::int AS n FROM channels WHERE external_id = '${EXT_A1}'`),
    ).toBe(1); // adopted, not duplicated
    const r = await check(dumps, live, 'acme');
    expect(r.alarms).toEqual([]);
    expect(r.collections.find((x) => x.collection === 'chathistory')).toMatchObject({
      read: 61,
      migrated: 40,
      quarantined: 18,
      excluded: 3,
    });
    // the adopted channel is not touched by the migration
    expect(
      (await rows(live, `SELECT name, status FROM channels WHERE external_id = '${EXT_A1}'`))[0],
    ).toEqual({ name: 'App channel', status: 'connected' });
  });

  it('--keep-deleted-contact-chats loads the deleted contact thread without a contact; --thread-status closed closes every thread', async () => {
    const db = await clone('chat-flags');
    const flags: InboxOptions = {
      channelMap: parseChannelMap(MAP_ACME),
      keepDeletedContactChats: true,
      threadStatus: 'closed',
      assignAgents: false,
      windowHours: 48,
    };
    await runClient(opts(dumps, db, 'acme', { inbox: flags }));
    const t = await rows(
      db,
      `SELECT peer_key, status, contact_id, assignee_user_id, window_expires_at, last_inbound_at FROM conversations WHERE peer_key = '919812345676'`,
    );
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ status: 'closed', contact_id: null, assignee_user_id: null });
    expect(
      new Date(t[0]!.window_expires_at).getTime() - new Date(t[0]!.last_inbound_at).getTime(),
    ).toBe(48 * 3_600_000);
    expect(
      await one(db, `SELECT count(*)::int AS n FROM conversations WHERE status <> 'closed'`),
    ).toBe(0);
    expect(
      await one(
        db,
        `SELECT count(*)::int AS n FROM conversations WHERE assignee_user_id IS NOT NULL`,
      ),
    ).toBe(0);
    const r = await check(dumps, db, 'acme', flags);
    expect(r.alarms).toEqual([]);
    expect(r.collections.find((x) => x.collection === 'chathistory')).toMatchObject({
      migrated: 49,
      excluded: 1,
    });
    // reconcile with different flags says so
    const other = await check(dumps, db, 'acme', {
      channelMap: parseChannelMap(MAP_ACME),
      keepDeletedContactChats: false,
    });
    expect(other.alarms.length).toBeGreaterThan(0);
  });
});

describe('what the tool never touches', () => {
  it('has no INSERT trigger to worry about on the chat tables (a new one would change what a direct INSERT does)', async () => {
    const trg = await rows(
      base,
      `SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('messages', 'conversations', 'channels', 'message_ledger') AND (t.tgtype & 4) <> 0`,
    );
    expect(trg).toEqual([]);
  });

  it('never reads chatbot_misc_config (it holds the access token), even when the dump has it', async () => {
    const withCfg = await customDumps({
      acme: {
        contact_list: acmeChat().contact_list,
        user: acmeChat().user,
        chathistory: acmeChat().chathistory.slice(0, 12),
        chatbot_misc_config: [
          {
            _id: { $oid: '65f0a1b2000000000000aaaa' },
            botid: 'bot-a1',
            phone_number_id: '999999999999',
            access_token: 'EAAfakefakefakefakefakefakefake1234',
          },
        ],
      },
    });
    try {
      const reads: string[] = [];
      const spy = new Proxy(withCfg.source, {
        get(t, p, r) {
          if (p === 'read')
            return (client: string, collection: string) => {
              reads.push(collection);
              return t.read(client, collection);
            };
          return Reflect.get(t, p, r);
        },
      });
      const db = await clone('chat-cfg');
      await runClient({ ...opts(withCfg, db, 'acme'), source: spy });
      expect(reads).not.toContain('chatbot_misc_config');
      const leak = await rows(
        db,
        `SELECT count(*)::int AS n FROM channels c WHERE c::text LIKE '%EAAfake%' OR c::text LIKE '%999999999999%'`,
      );
      expect(leak[0]!.n).toBe(0);
      expect(await one(db, 'SELECT count(*)::int AS n FROM channels')).toBe(2); // only the two numbers of the map
    } finally {
      withCfg.cleanup();
    }
  });
});

describe('after cutover (--allow-extra-rows)', () => {
  it('live traffic on a migrated thread is not an error, a lost or altered migrated message still is', async () => {
    const db = await clone('chat-live-traffic', base.name);
    await asOwner(db, async (d) => {
      // what the application does when a customer writes to a migrated thread (conversations.repository.ts applyInbound)
      await d.execute(
        sql.raw(`
        WITH c AS (SELECT * FROM conversations WHERE peer_key = '919812345672'),
        m AS (INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, body, meta, created_at)
              SELECT org_id, id, msg_seq + 1, 'in', 'text', 'customer', 'received', 'live message', '{}', now() FROM c RETURNING id, conversation_id, created_at)
        UPDATE conversations SET msg_seq = msg_seq + 1, last_message_id = (SELECT id FROM m), last_message_at = (SELECT created_at FROM m),
               unread_count = 1, waiting_since = now() WHERE id = (SELECT conversation_id FROM m)`),
      );
      await d.execute(
        sql.raw(
          `INSERT INTO conversation_events (org_id, conversation_id, type) SELECT org_id, id, 'message.received' FROM conversations WHERE peer_key = '919812345672'`,
        ),
      );
      await d.execute(sql.raw(`UPDATE messages SET status = 'delivered' WHERE body = 'tie two'`));
      await d.execute(
        sql.raw(`UPDATE channels SET status = 'connected' WHERE external_id = '${EXT_A1}'`),
      );
    });
    expect((await check(dumps, db, 'acme')).ok).toBe(false);
    const r = await check(dumps, db, 'acme', undefined, true);
    expect(r.alarms).toEqual([]);
    await asOwner(db, (d) => d.execute(sql.raw(`DELETE FROM messages WHERE body = 'tie one'`)));
    const r2 = await check(dumps, db, 'acme', undefined, true);
    expect(r2.ok).toBe(false);
  });
});

describe('the verifier catches damage', () => {
  const mutations: Array<[string, string, RegExp]> = [
    [
      'delete a message',
      `DELETE FROM messages WHERE uuid = (SELECT m.uuid FROM messages m JOIN conversations c ON c.id = m.conversation_id AND c.org_id = m.org_id WHERE c.peer_key = '919812345672' AND m.seq = 3)`,
      /TARGET_MISSING|SEQ_CONTINUITY|COUNTER_MISMATCH/,
    ],
    [
      'swap two messages seq',
      `UPDATE messages m SET seq = CASE seq WHEN 2 THEN 3 ELSE 2 END WHERE seq IN (2, 3) AND conversation_id = (SELECT id FROM conversations WHERE peer_key = '919812345672' LIMIT 1)`,
      /ORACLE_MISMATCH.*seq|FINGERPRINT_MISMATCH.*seq/,
    ],
    [
      'change a body',
      `UPDATE messages SET body = body || ' tampered' WHERE body = 'tie two'`,
      /FINGERPRINT_MISMATCH|ORACLE_MISMATCH.*body/,
    ],
    [
      'change a direction',
      `UPDATE messages SET direction = 'out', status = 'sent' WHERE body = 'tie one'`,
      /FINGERPRINT_MISMATCH|ORACLE_MISMATCH.*direction/,
    ],
    [
      'move a message to another conversation',
      `UPDATE messages SET conversation_id = (SELECT id FROM conversations WHERE peer_key = '919812345673' LIMIT 1) WHERE body = 'tie one'`,
      /THREAD_SPLIT|THREAD_MERGED|COUNTER_MISMATCH|SEQ_CONTINUITY/,
    ],
    [
      'add an extra message',
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, body, meta, created_at)
       SELECT org_id, id, msg_seq + 1, 'in', 'text', 'customer', 'received', 'planted', '{"historySync": true, "legacy": {"src": "waboo"}}', now() FROM conversations WHERE peer_key = '919812345672'`,
      /EXTRA_ROWS|COUNTER_MISMATCH|SEQ_CONTINUITY/,
    ],
    [
      'change last_message_at',
      `UPDATE conversations SET last_message_at = last_message_at + interval '1 day' WHERE peer_key = '919812345672'`,
      /COUNTER_MISMATCH|ORACLE_MISMATCH.*last_message_at/,
    ],
    [
      'change msg_seq by one',
      `UPDATE conversations SET msg_seq = msg_seq + 1 WHERE peer_key = '919812345672'`,
      /COUNTER_MISMATCH/,
    ],
    [
      'add an outbox row',
      `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload) SELECT id, 'chat', 1, 'message.received', '{}' FROM organizations WHERE slug = 'acme'`,
      /EXTRA_ROWS.*event_outbox/,
    ],
    [
      'flip an outbound message to queued',
      `UPDATE messages SET status = 'queued' WHERE direction = 'out' AND body = 'tie two'`,
      /QUEUED_OUTBOUND|FINGERPRINT_MISMATCH|ORACLE_MISMATCH.*status/,
    ],
    [
      'delete a conversation',
      `DELETE FROM conversations WHERE peer_key = '919812345673'`,
      /TARGET_MISSING|ORACLE_MISMATCH/,
    ],
    [
      'change a peer_key',
      `UPDATE conversations SET peer_key = '919812349999' WHERE peer_key = '919812345673'`,
      /ORACLE_MISMATCH/,
    ],
    [
      'set unread on a thread',
      `UPDATE conversations SET unread_count = 3, waiting_since = now() WHERE peer_key = '919812345672'`,
      /ORACLE_MISMATCH.*default unread_count/,
    ],
    [
      'assign a different contact',
      `UPDATE conversations SET contact_id = NULL WHERE peer_key = '919812345672'`,
      /ORACLE_MISMATCH.*contact_id/,
    ],
    [
      'drop a ledger row',
      `DELETE FROM message_ledger WHERE key = 'wamid.T1.0001'`,
      /LEDGER_MISSING/,
    ],
    [
      'add a conversation event',
      `INSERT INTO conversation_events (org_id, conversation_id, type) SELECT org_id, id, 'lifecycle.created' FROM conversations WHERE peer_key = '919812345672'`,
      /EXTRA_ROWS.*conversation_events/,
    ],
    [
      'move a message into messages_default',
      `UPDATE messages SET created_at = '2019-01-01' WHERE body = 'tie one'`,
      /PARTITION|FINGERPRINT_MISMATCH/,
    ],
    [
      'store a credential on the channel',
      `UPDATE channels SET credentials_enc = 'v1:abc' WHERE external_id = '${EXT_A2}'`,
      /CHANNEL_CHANGED.*credentials_enc/,
    ],
    [
      'change a created_at',
      `UPDATE messages SET created_at = created_at + interval '1 second' WHERE body = 'tie two'`,
      /FINGERPRINT_MISMATCH|ORACLE_MISMATCH/,
    ],
    [
      'delete the channel link of the quarantine log',
      `DELETE FROM migration.quarantine WHERE collection = 'chathistory' AND reason_code = 'WEBCHAT_NO_CHANNEL'`,
      /QUARANTINE_CHANGED|NOT_LOADED|EQUATION|UNACCOUNTED/,
    ],
  ];
  it.each(mutations)('%s', async (name, statement, expected) => {
    const db = await clone('chat-dmg', base.name);
    try {
      await asOwner(db, (d) => d.execute(sql.raw(statement)));
      const r = await check(dumps, db, 'acme');
      if (process.env.CHAT_DEBUG)
        console.log(
          `DAMAGE ${name}: ${[...r.alarms, ...r.integrity]
            .map((x) => x.slice(0, 110))
            .join(' | ')
            .slice(0, 600)}`,
        );
      expect(r.ok, name).toBe(false);
      expect(r.alarms.join('\n') + r.integrity.join('\n'), name).toMatch(expected);
    } finally {
      await db.drop();
      dbs.splice(dbs.indexOf(db), 1);
    }
  });
  it('the untouched copy still passes', async () => {
    const db = await clone('chat-ok', base.name);
    const r = await check(dumps, db, 'acme');
    expect(r.alarms).toEqual([]);
  });
});

describe('volume', () => {
  it('loads 20,000 turns in thread-sized batches and verifies them', async () => {
    const big = await customDumps({ acme: { contact_list: [], chathistory: bulkChat(1000, 20) } });
    const db = await clone('chat-vol');
    try {
      const t0 = Date.now();
      await runClient(
        runOpts(big, db, 'acme', {
          org: { name: 'acme', slug: 'acme' },
          inbox: inboxA,
          batchSize: 500,
          allowNoOwner: true,
        }),
      );
      const loadMs = Date.now() - t0;
      expect(await one(db, 'SELECT count(*)::int AS n FROM messages')).toBe(20_000);
      expect(await one(db, 'SELECT count(*)::int AS n FROM conversations')).toBe(1000);
      const t1 = Date.now();
      const r = await reconcile({
        source: big.source,
        dumpsDir: big.dir,
        client: 'acme',
        targetUrl: db.workerUrl,
        inbox: inboxA,
      });
      const verifyMs = Date.now() - t1;
      console.log(
        `VOLUME 20,000 turns / 1,000 threads: load ${loadMs} ms, reconcile ${verifyMs} ms, alarms ${r.alarms.length}`,
      );
      expect(r.alarms.slice(0, 5)).toEqual([]);
      expect(r.ok).toBe(true);
      // the second run is a no-op
      const t2 = Date.now();
      await runClient(
        runOpts(big, db, 'acme', {
          org: { name: 'acme', slug: 'acme' },
          inbox: inboxA,
          batchSize: 500,
          allowNoOwner: true,
        }),
      );
      console.log(`VOLUME re-run (nothing to do): ${Date.now() - t2} ms`);
      expect(await one(db, 'SELECT count(*)::int AS n FROM messages')).toBe(20_000);
    } finally {
      big.cleanup();
    }
  }, 1_800_000);
});

describe('append: newer Waboo turns for threads that are already loaded', () => {
  const lines = (coll: string): string[] =>
    readFileSync(join(dumps.dir, 'acme', `${coll}.ndjson`), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
  const ndjson = (ls: string[]): string => ls.join('\n') + '\n';
  const parsed = lines('chathistory').map((l) => ({ l, d: JSON.parse(l) as Record<string, any> }));
  const phoneOf = (d: Record<string, any>): string => String(d.user?.mobile ?? '');
  // the "first export": T1 without the last two turns of its last session, and no thread yet for 919812345683
  const isTail = (d: Record<string, any>): boolean =>
    phoneOf(d) === '919812345671' &&
    d.botid === 'bot-a1' &&
    d.session_id === 'sess-t1-c' &&
    String(d.createdAt.$date) >= '2026-02-03T08:00:30.000Z';
  const isNewThread = (d: Record<string, any>): boolean => phoneOf(d) === '919812345683';
  const first = parsed.filter((x) => !isTail(x.d) && !isNewThread(x.d)).map((x) => x.l);
  const withTail = parsed.filter((x) => !isNewThread(x.d)).map((x) => x.l);
  const dumpOf = (ls: string[]): Promise<Dumps> =>
    customDumps({
      acme: {
        contact_list: ndjson(lines('contact_list')),
        user: ndjson(lines('user')),
        chathistory: ndjson(ls),
      },
    });
  // updated_at moves by the touch trigger on an appended conversation, external_id because the channel was re-pointed
  const content = (snap: string): unknown => {
    const j = JSON.parse(snap);
    return {
      msgs: j.msgs,
      ledger: j.ledger,
      convs: j.convs.map((c: Record<string, unknown>) => ({ ...c, updated_at: null, external_id: null })),
    };
  };

  it('the fixture split is what the tests below assume', () => {
    expect(parsed.filter((x) => isTail(x.d)).length).toBe(2);
    expect(parsed.filter((x) => isNewThread(x.d)).length).toBeGreaterThanOrEqual(1);
  });

  it('appends after the last loaded turn, equals a fresh load, is idempotent, and the verifier agrees', async () => {
    const v1 = await dumpOf(first);
    const db = await clone('chat-append');
    try {
      await runClient(opts(v1, db, 'acme'));
      const before = await totals(db);
      // the real number was connected since: the channel row carries the real id, the threads were made under the map's id
      await asOwner(db, (d) =>
        d.execute(
          sql.raw(
            `UPDATE channels SET external_id = '990000000000999' WHERE external_id = '${EXT_A1}'`,
          ),
        ),
      );
      const outbox = await one(db, 'SELECT count(*)::int AS n FROM event_outbox');
      // dry run: says what it would do, writes nothing
      await runClient(opts(dumps, db, 'acme', { dryRun: true }));
      expect(await totals(db)).toEqual(before);

      await runClient(opts(dumps, db, 'acme'));
      const after = await totals(db);
      const fresh = await totals(base);
      expect([after.messages, after.conversations, after.message_ledger]).toEqual([
        fresh.messages,
        fresh.conversations,
        fresh.message_ledger,
      ]);
      // the final state is what a fresh load of the whole dump makes
      expect(content(await chatSnapshot(db))).toEqual(content(await chatSnapshot(base)));
      // the appended conversation moved by the touch trigger, once; the run_log says which
      const log = await rows(
        db,
        `SELECT counts FROM migration.run_log WHERE collection = '_chat' AND step = 'chat_append'`,
      );
      expect((log[0]!.counts.conversations as string[]).length).toBe(1);
      expect(await one(db, 'SELECT count(*)::int AS n FROM conversations WHERE row_version > 1')).toBe(1);
      expect(await one(db, 'SELECT count(*)::int AS n FROM event_outbox')).toBe(outbox);
      // idempotent: a second run changes nothing
      const snap = await chatSnapshot(db);
      await runClient(opts(dumps, db, 'acme'));
      expect(await chatSnapshot(db)).toBe(snap);
      expect(await totals(db)).toEqual(after);
      // the verifier reads the re-pointed channel through its uuid and expects the touched conversation
      const r = await check(dumps, db, 'acme');
      expect(r.alarms).toEqual([]);
    } finally {
      v1.cleanup();
    }
  }, 600_000);

  it('before the append the verifier says APPEND_PENDING instead of one alarm per missing message', async () => {
    const v1 = await dumpOf(first);
    const full = await dumpOf(withTail);
    const db = await clone('chat-pending');
    try {
      await runClient(opts(v1, db, 'acme'));
      const r = await check(full, db, 'acme');
      const text = r.alarms.join('\n');
      expect(text).toMatch(/APPEND_PENDING: 1 loaded thread\(s\) lack 2 newer message/);
      expect(text).not.toMatch(/no message row in the target/);
    } finally {
      v1.cleanup();
      full.cleanup();
    }
  }, 600_000);

  it('a newer turn that sorts BEFORE a loaded one: the thread is left as loaded, the turn is quarantined, the run goes on', async () => {
    const early = JSON.stringify(
      turn({
        phone: '919812345672',
        at: { $date: '2026-02-10T09:00:00.000Z' },
        dir: 'in',
        text: 'older than everything loaded',
        session: 'sess-t2',
      }),
    );
    const v2 = await dumpOf([...lines('chathistory'), early]);
    const db = await clone('chat-ooo');
    try {
      await runClient(opts(dumps, db, 'acme'));
      const snap = await chatSnapshot(db);
      await runClient(opts(v2, db, 'acme'));
      expect(await chatSnapshot(db)).toBe(snap);
      expect(
        await one(
          db,
          `SELECT count(*)::int AS n FROM migration.quarantine WHERE reason_code = 'APPEND_OUT_OF_ORDER'`,
        ),
      ).toBe(1);
      const r = await check(v2, db, 'acme');
      const text = r.alarms.join('\n');
      expect(text).toMatch(/APPEND_OUT_OF_ORDER: 1 loaded thread/);
      expect(text).not.toMatch(/ORACLE_MISMATCH|PARTIAL_THREAD|APPEND_PENDING/);
    } finally {
      v2.cleanup();
    }
  }, 600_000);

  it('a message row whose id_map row is gone is damage, not news: the run stops', async () => {
    const db = await clone('chat-stray', base.name);
    await asOwner(db, (d) =>
      d.execute(
        sql.raw(
          `DELETE FROM migration.id_map WHERE source_client = 'acme' AND source_collection = 'chathistory' AND source_key = (SELECT source_key FROM migration.id_map WHERE source_client = 'acme' AND source_collection = 'chathistory' ORDER BY source_key DESC LIMIT 1)`,
        ),
      ),
    );
    await expect(runClient(opts(dumps, db, 'acme', { force: true }))).rejects.toThrow(
      /PARTIAL_THREAD/,
    );
  }, 600_000);
});

void hex;
