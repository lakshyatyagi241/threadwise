import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  MessageHistoryDetail,
  MessageHistoryInsights,
  MessageHistoryPage,
  MessageHistoryRow,
  MessageHistorySummary,
  MessageLogExport,
} from '@crm/contracts';
import { MessageLogArchiveService } from '../../../src/modules/chat-conversations/message-log-archive.service';
import { pageSql } from '../../../src/modules/chat-conversations/message-history.query';
import { startPipeline, until, type Pipeline } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import { Inbox } from './support';

/**
 * Message History end to end on a real database: one feed over the message stream and the recipient rows of broadcasts, campaigns and
 * scheduled messages; filters; real counts; the drawer (live and archived events); who sees what (conversation scope, bulk rows,
 * masked numbers, cost); tenant isolation; the export with the filters; and the query plan on a few thousand rows.
 */
let p: Pipeline;
let inbox: Inbox;

beforeAll(async () => {
  p = await startPipeline();
  inbox = new Inbox(p.h, p.api);
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const day = (offset: number): string =>
  new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const q = (sqlText: string, params: unknown[] = []) => p.h.owner.query(sqlText, params);

interface Seeded {
  t: Tenant;
  agentOwn: { token: string; userId: number };
  reader: { token: string; userId: number };
  reader2: { token: string; userId: number };
  noHistory: { token: string; userId: number };
  noRead: { token: string; userId: number };
  convMine: string;
  convOther: string;
  convFree: string;
  ids: Record<string, string>;
  templateUuid: string;
  channelUuid: string;
  campaignUuid: string;
  broadcastUuid: string;
  scheduledUuid: string;
}

async function message(
  t: Tenant,
  convId: number,
  seq: number,
  o: {
    dir: 'in' | 'out';
    at: string;
    status?: string;
    kind?: string;
    body?: string | null;
    senderKind?: string;
    senderUserId?: number | null;
    senderAgentId?: number | null;
    meta?: Record<string, unknown>;
    templateId?: number | null;
    providerId?: string | null;
    failCode?: string | null;
    failReason?: string | null;
    mediaName?: string | null;
    deletedAt?: string | null;
  },
): Promise<{ id: number; uuid: string; createdAt: string }> {
  const r = await q(
    `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, sender_user_id, sender_agent_id, body, status,
        failure_code, failure_reason, provider_message_id, template_id, meta, media_name, deleted_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18::timestamptz)
     RETURNING id, uuid, created_at::text AS created_at`,
    [
      t.orgId,
      convId,
      seq,
      o.dir,
      o.kind ?? 'text',
      o.senderKind ?? (o.dir === 'in' ? 'customer' : 'agent'),
      o.senderUserId ?? (o.dir === 'out' && !o.senderKind ? t.adminUserId : null),
      o.senderAgentId ?? null,
      o.body === undefined ? `message ${seq}` : o.body,
      o.status ?? (o.dir === 'in' ? 'received' : 'sent'),
      o.failCode ?? null,
      o.failReason ?? null,
      o.providerId ?? null,
      o.templateId ?? null,
      JSON.stringify(o.meta ?? {}),
      o.mediaName ?? null,
      o.deletedAt ?? null,
      o.at,
    ],
  );
  return {
    id: Number(r.rows[0].id),
    uuid: r.rows[0].uuid as string,
    createdAt: r.rows[0].created_at as string,
  };
}

async function event(
  t: Tenant,
  m: { id: number; createdAt: string },
  name: string,
  at: string,
  detail = {},
) {
  await q(
    `INSERT INTO message_events (org_id, message_id, message_created_at, event, detail, created_at)
     VALUES ($1,$2,$3::timestamptz,$4,$5::jsonb,$6::timestamptz)`,
    [t.orgId, m.id, m.createdAt, name, JSON.stringify(detail), at],
  );
}

async function seed(): Promise<Seeded> {
  const t = await p.api.signup('hist');
  const grant = (...g: Array<[string, 'all' | 'team' | 'own']>) => g;
  const agentOwn = await p.api.member(
    t,
    'own',
    grant(
      ['msg.history.read', 'all'],
      ['inbox.conversation.read', 'own'],
      ['record.contacts.read', 'own'],
    ),
  );
  const reader = await p.api.member(
    t,
    'reader',
    grant(['msg.history.read', 'all'], ['inbox.conversation.read', 'all']),
  );
  const reader2 = await p.api.member(
    t,
    'reader2',
    grant(
      ['msg.history.read', 'all'],
      ['inbox.conversation.read', 'all'],
      ['record.contacts.read', 'all'],
      ['wallet.statement.read', 'all'],
    ),
  );
  const noHistory = await p.api.member(t, 'nohist', grant(['inbox.conversation.read', 'all']));
  const noRead = await p.api.member(t, 'noread', grant(['msg.history.read', 'all']));

  const ch = await inbox.channel(t.admin, { name: 'Main' });
  const contactIds = await p.api.seedContacts(t, [
    { name: 'Asha Mine', phone: '+919800000001', ownerId: agentOwn.userId },
    { name: 'Bina Other', phone: '+919800000002', ownerId: t.adminUserId },
  ]);
  const cid = async (uuid: string) =>
    Number((await q(`SELECT id FROM contacts WHERE uuid = $1`, [uuid])).rows[0].id);
  const c1 = await cid(contactIds[0]!);
  const c2 = await cid(contactIds[1]!);
  const c3 = await cid(
    (await p.api.seedContacts(t, [{ name: 'Cold Cara', phone: '+919800000003' }]))[0]!,
  );

  const mine = await inbox.conversation(t, ch.id, {
    peer: '919800000001',
    peerName: 'Asha',
    assigneeUserId: agentOwn.userId,
    contactId: c1,
    messages: 0,
    lastMessageAt: null,
  });
  const other = await inbox.conversation(t, ch.id, {
    peer: '919800000002',
    peerName: 'Bina',
    assigneeUserId: t.adminUserId,
    contactId: c2,
    messages: 0,
    lastMessageAt: null,
  });
  const free = await inbox.conversation(t, ch.id, {
    peer: '919800000077',
    peerName: null,
    messages: 0,
    lastMessageAt: null,
  });

  const tpl = await q(
    `INSERT INTO wa_templates (org_id, template_name, template_body) VALUES ($1,'welcome_tpl','Hello {{1}}') RETURNING id, uuid`,
    [t.orgId],
  );
  const tplId = Number(tpl.rows[0].id);
  const ids: Record<string, string> = {};

  const m1 = await message(t, mine.id, 1, {
    dir: 'in',
    at: ago(4 * HOUR),
    body: 'Hello I need help with my order number 123 please',
  });
  const m2 = await message(t, mine.id, 2, {
    dir: 'out',
    at: ago(4 * HOUR - 60_000),
    status: 'read',
    body: 'Sure, checking now',
    providerId: 'wamid.M2',
  });
  const m3 = await message(t, mine.id, 3, {
    dir: 'out',
    at: ago(3 * HOUR),
    status: 'delivered',
    kind: 'template',
    body: 'Hello Asha',
    templateId: tplId,
    providerId: 'wamid.M3',
  });
  const m4 = await message(t, other.id, 1, {
    dir: 'out',
    at: ago(2 * DAY),
    status: 'failed',
    body: 'Flow message',
    meta: { source: 'flow' },
    failCode: 'ECOSYSTEM_ENGAGEMENT_BLOCKED',
    failReason: '#131049 Meta chose not to deliver',
    providerId: 'wamid.M4',
  });
  const m5 = await message(t, other.id, 2, {
    dir: 'in',
    at: ago(10 * DAY),
    kind: 'image',
    body: null,
    mediaName: 'photo.png',
  });
  const m6 = await message(t, free.id, 1, {
    dir: 'out',
    at: ago(40 * DAY),
    status: 'sent',
    body: 'API message',
    meta: { source: 'api' },
  });
  const m7 = await message(t, mine.id, 4, {
    dir: 'out',
    at: ago(95 * DAY),
    status: 'delivered',
    body: 'AI answer',
    senderKind: 'bot',
    senderAgentId: 999,
    providerId: 'wamid.M7',
  });
  const m8 = await message(t, other.id, 3, {
    dir: 'out',
    at: ago(100 * DAY),
    status: 'failed',
    body: 'Old failure',
    failCode: 'RECIPIENT_UNDELIVERABLE',
    failReason: 'not on whatsapp',
  });
  const m9 = await message(t, free.id, 2, {
    dir: 'in',
    at: ago(200 * DAY),
    body: 'Very old hello',
  });
  ids.m1 = `m:${m1.uuid}`;
  ids.m2 = `m:${m2.uuid}`;
  ids.m3 = `m:${m3.uuid}`;
  ids.m4 = `m:${m4.uuid}`;
  ids.m5 = `m:${m5.uuid}`;
  ids.m6 = `m:${m6.uuid}`;
  ids.m7 = `m:${m7.uuid}`;
  ids.m8 = `m:${m8.uuid}`;
  ids.m9 = `m:${m9.uuid}`;

  // Never in the feed: the mirrored bubble of a broadcast / campaign (the recipient row is the one shown), a call line, a deleted message.
  await message(t, mine.id, 5, {
    dir: 'out',
    at: ago(5 * HOUR),
    body: 'mirrored broadcast',
    senderKind: 'broadcast',
    meta: { source: 'broadcast', broadcast_id: randomUUID() },
  });
  await message(t, mine.id, 6, {
    dir: 'out',
    at: ago(5 * HOUR),
    body: 'mirrored campaign',
    senderKind: 'broadcast',
    meta: { source: 'campaign', campaign_id: randomUUID() },
  });
  await message(t, mine.id, 7, {
    dir: 'out',
    at: ago(5 * HOUR),
    body: 'call',
    kind: 'system',
    senderKind: 'system',
  });
  await message(t, mine.id, 8, {
    dir: 'out',
    at: ago(5 * HOUR),
    body: 'deleted one',
    deletedAt: ago(HOUR),
  });

  // The delivery log of the two old messages, then the sweep moves them to the archive.
  for (const m of [m7, m8]) {
    await event(t, m, 'queued', new Date(new Date(m.createdAt).getTime() + 1000).toISOString());
    await event(t, m, 'attempt', new Date(new Date(m.createdAt).getTime() + 2000).toISOString(), {
      attempt: 1,
    });
    await event(
      t,
      m,
      m === m8 ? 'failed' : 'sent',
      new Date(new Date(m.createdAt).getTime() + 3000).toISOString(),
      m === m8
        ? { code: 'RECIPIENT_UNDELIVERABLE', reason: 'not on whatsapp' }
        : { providerMessageId: 'wamid.M7' },
    );
  }
  await event(t, m1, 'queued', ago(4 * HOUR));
  await p.h.app.get(MessageLogArchiveService).sweep();

  // A broadcast with a read, a failed and a still pending recipient (the cold one has no thread).
  const b = await q(
    `INSERT INTO broadcasts (org_id, name, template_id) VALUES ($1,'Spring offer',$2) RETURNING id, uuid`,
    [t.orgId, tplId],
  );
  const bId = Number(b.rows[0].id);
  const bc = async (
    contact: number,
    status: string,
    sentAt: string | null,
    createdAt: string,
    err: string | null,
    wa: string | null,
  ) =>
    (
      await q(
        `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, error_message, whatsapp_message_id, sent_at, read_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz, CASE WHEN $4 = 'read' THEN $7::timestamptz END, $8::timestamptz) RETURNING uuid`,
        [t.orgId, bId, contact, status, err, wa, sentAt, createdAt],
      )
    ).rows[0].uuid as string;
  ids.bRead = `b:${await bc(c1, 'read', ago(5 * HOUR), ago(6 * HOUR), null, 'wamid.B1')}`;
  ids.bFailed = `b:${await bc(c2, 'failed', null, ago(5 * HOUR), 'Number is not on WhatsApp', null)}`;
  ids.bPending = `b:${await bc(c3, 'pending', null, ago(5 * HOUR), null, null)}`;

  const k = await q(
    `INSERT INTO wpcampaigns (org_id, campaign_name, template_id) VALUES ($1,'Diwali Sale',$2) RETURNING id, uuid`,
    [t.orgId, tplId],
  );
  const kId = Number(k.rows[0].id);
  ids.kDelivered = `c:${
    (
      await q(
        `INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status, phone_number, recipient_name, whatsapp_message_id, sent_at, delivered_at, created_at)
         VALUES ($1,$2,NULL,'delivered','919800000099','Cold Carl','wamid.K1',$3::timestamptz,$3::timestamptz,$3::timestamptz) RETURNING uuid`,
        [t.orgId, kId, ago(6 * HOUR)],
      )
    ).rows[0].uuid
  }`;
  ids.kFailed = `c:${
    (
      await q(
        `INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status, phone_number, recipient_name, error_code, error_message, created_at)
         VALUES ($1,$2,NULL,'failed','919800000098','Failing Fay','131049','#131049 Meta chose not to deliver',$3::timestamptz) RETURNING uuid`,
        [t.orgId, kId, ago(2 * HOUR)],
      )
    ).rows[0].uuid
  }`;

  const s = await q(
    `INSERT INTO scheduled_messages (org_id, schedule_name, send_date, send_time, scheduled_time, timezone, recipient_type, message_content)
     VALUES ($1,'Morning hello', current_date, '09:00', now(), 'UTC', 'contacts', 'Good morning to you') RETURNING id, uuid`,
    [t.orgId],
  );
  const sId = Number(s.rows[0].id);
  ids.sSent = `s:${
    (
      await q(
        `INSERT INTO scheduled_message_contacts (org_id, scheduled_message_id, contact_id, phone, status, wa_message_id, sent_at, created_at)
         VALUES ($1,$2,NULL,'919800000004','sent','wamid.S1',$3::timestamptz,$3::timestamptz) RETURNING uuid`,
        [t.orgId, sId, ago(3 * HOUR)],
      )
    ).rows[0].uuid
  }`;
  ids.sFailed = `s:${
    (
      await q(
        `INSERT INTO scheduled_message_contacts (org_id, scheduled_message_id, contact_id, phone, status, error_message, failed_at, created_at)
         VALUES ($1,$2,NULL,'919800000005','failed','Send failed',$3::timestamptz,$3::timestamptz) RETURNING uuid`,
        [t.orgId, sId, ago(3 * HOUR)],
      )
    ).rows[0].uuid
  }`;

  // What M2 and the broadcast's read recipient cost.
  await q(
    `INSERT INTO usage_charges (org_id, wamid, credits, currency, status) VALUES ($1,'wamid.M3',150,'INR','charged'), ($1,'wamid.B1',250,'INR','charged'), ($1,'wamid.M2',100,'USD','charged')`,
    [t.orgId],
  );

  return {
    t,
    agentOwn,
    reader,
    reader2,
    noHistory,
    noRead,
    convMine: mine.uuid,
    convOther: other.uuid,
    convFree: free.uuid,
    ids,
    templateUuid: tpl.rows[0].uuid as string,
    channelUuid: ch.id,
    campaignUuid: k.rows[0].uuid as string,
    broadcastUuid: b.rows[0].uuid as string,
    scheduledUuid: s.rows[0].uuid as string,
  };
}

let S: Seeded;
beforeAll(async () => {
  S = await seed();
}, 300_000);

const get = async <T>(token: string, path: string, expected = 200): Promise<T> => {
  const res = await p.api.as(token).get(path);
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return res.body as T;
};
const list = (token: string, qs = '') => get<MessageHistoryPage>(token, `/v2/message-history${qs}`);
const rowIds = (page: MessageHistoryPage) => page.data.map((r) => r.id);
/** A window that covers the whole seeded year. */
const WIDE = () => `from=${day(-250)}&to=${day(0)}`;

describe('the feed', () => {
  it('lists the last 30 days newest first: messages and recipient rows once each, never a mirrored bubble, a call line or a deleted message', async () => {
    const page = await list(S.t.admin, '?limit=100');
    const ids = rowIds(page);
    expect(new Set(ids)).toEqual(
      new Set([
        S.ids.m1,
        S.ids.m2,
        S.ids.m3,
        S.ids.m4,
        S.ids.m5,
        S.ids.bRead,
        S.ids.bFailed,
        S.ids.bPending,
        S.ids.kDelivered,
        S.ids.kFailed,
        S.ids.sSent,
        S.ids.sFailed,
      ]),
    );
    expect(ids).toHaveLength(12);
    const times = page.data.map((r) => Date.parse(r.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(page.page.hasMore).toBe(false);
    expect(page.window.to > page.window.from).toBe(true);
  });

  it('pages with a cursor across hot and archived days with no row twice and none missing', async () => {
    const all: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: MessageHistoryPage = await list(
        S.t.admin,
        `?${WIDE()}&limit=4${cursor ? `&cursor=${cursor}` : ''}`,
      );
      all.push(...rowIds(res));
      cursor = res.page.nextCursor;
      pages += 1;
      expect(res.page.hasMore).toBe(cursor !== null);
    } while (cursor && pages < 20);
    expect(all).toHaveLength(16);
    expect(new Set(all).size).toBe(16);
    for (const k of ['m6', 'm7', 'm8', 'm9']) expect(all).toContain(S.ids[k]);
    // And in one go it is the same order.
    const once = await list(S.t.admin, `?${WIDE()}&limit=100`);
    expect(rowIds(once)).toEqual(all);
  });

  it('keeps pages exact when rows share a moment (the cursor carries the rank and id)', async () => {
    const t = await p.api.signup('ties');
    const ch = await inbox.channel(t.admin, { name: 'Tie' });
    const conv = await inbox.conversation(t, ch.id, { messages: 0, lastMessageAt: null });
    const at = ago(HOUR);
    for (let i = 1; i <= 7; i += 1) await message(t, conv.id, i, { dir: 'in', at });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: MessageHistoryPage = await list(
        t.admin,
        `?limit=3${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...rowIds(res));
      cursor = res.page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('refuses a made-up cursor, a window in the future, a reversed one and one older than a year', async () => {
    await get(S.t.admin, '/v2/message-history?cursor=garbage', 422);
    await get(S.t.admin, `/v2/message-history?from=${day(0)}&to=${day(2)}`, 422);
    await get(S.t.admin, `/v2/message-history?from=${day(-1)}&to=${day(-3)}`, 422);
    await get(S.t.admin, `/v2/message-history?from=${day(-400)}&to=${day(0)}`, 422);
    await get(S.t.admin, '/v2/message-history?dir=sideways', 422);
  });

  it('shows each row as the screen needs it: type pill, source, status, failure, entity, channel, template', async () => {
    const page = await list(S.t.admin, '?limit=100');
    const by = (id: string) => page.data.find((r) => r.id === id)!;
    expect(by(S.ids.m1)).toMatchObject({
      direction: 'in',
      status: 'received',
      source: 'inbox',
      type: 'text',
      entityKind: 'message',
    });
    expect(by(S.ids.m3)).toMatchObject({
      type: 'template',
      status: 'delivered',
      template: { name: 'welcome_tpl' },
    });
    expect(by(S.ids.m4)).toMatchObject({
      source: 'flow',
      status: 'failed',
      failure: { code: 'ECOSYSTEM_ENGAGEMENT_BLOCKED' },
    });
    expect(by(S.ids.m5)).toMatchObject({ type: 'image', mediaName: 'photo.png', preview: null });
    expect(by(S.ids.m3).channel).toMatchObject({ id: S.channelUuid, name: 'Main' });
    expect(by(S.ids.bRead)).toMatchObject({
      source: 'broadcast',
      type: 'broadcast',
      status: 'read',
      entity: { kind: 'broadcast', name: 'Spring offer' },
      conversationId: null,
    });
    expect(by(S.ids.bFailed).failure?.reason).toBe('Number is not on WhatsApp');
    expect(by(S.ids.bPending).status).toBe('queued');
    expect(by(S.ids.kDelivered)).toMatchObject({
      source: 'campaign',
      contact: { name: 'Cold Carl' },
      entity: { kind: 'campaign', name: 'Diwali Sale' },
    });
    expect(by(S.ids.kFailed).failure).toMatchObject({ code: '131049' });
    expect(by(S.ids.sSent)).toMatchObject({
      source: 'scheduled',
      entity: { kind: 'scheduled', name: 'Morning hello' },
      preview: 'Good morning to you',
    });
    expect(by(S.ids.m1).conversationId).toBe(S.convMine);
  });

  it('the preview is the first 40 characters', async () => {
    const page = await list(S.t.admin, '?limit=100');
    const m1 = page.data.find((r) => r.id === S.ids.m1)!;
    expect(m1.preview).toBe('Hello I need help with my order number 1…');
    expect(Array.from(m1.preview!)).toHaveLength(41);
  });
});

describe('the filters', () => {
  it('direction tabs: out, in, and fail (outbound and failed)', async () => {
    const out = await list(S.t.admin, '?dir=out&limit=100');
    expect(out.data.every((r) => r.direction === 'out')).toBe(true);
    expect(out.data).toHaveLength(10);
    const inb = await list(S.t.admin, '?dir=in&limit=100');
    expect(rowIds(inb).sort()).toEqual([S.ids.m1, S.ids.m5].sort());
    const fail = await list(S.t.admin, '?dir=fail&limit=100');
    expect(rowIds(fail).sort()).toEqual(
      [S.ids.m4, S.ids.bFailed, S.ids.kFailed, S.ids.sFailed].sort(),
    );
  });

  it('status: queued, sent, delivered, read, failed', async () => {
    const by = async (s: string) => rowIds(await list(S.t.admin, `?status=${s}&limit=100`)).sort();
    expect(await by('queued')).toEqual([S.ids.bPending]);
    expect(await by('sent')).toEqual([S.ids.sSent]);
    expect(await by('delivered')).toEqual([S.ids.m3, S.ids.kDelivered].sort());
    expect(await by('read')).toEqual([S.ids.m2, S.ids.bRead].sort());
    expect((await by('failed')).length).toBe(4);
  });

  it('source (one or several) and the Reference type filter', async () => {
    expect(rowIds(await list(S.t.admin, '?source=flow&limit=100'))).toEqual([S.ids.m4]);
    expect(rowIds(await list(S.t.admin, `?${WIDE()}&source=api,ai&limit=100`)).sort()).toEqual(
      [S.ids.m6, S.ids.m7].sort(),
    );
    expect((await list(S.t.admin, '?type=broadcast&limit=100')).data).toHaveLength(3);
    expect((await list(S.t.admin, '?type=campaign&limit=100')).data).toHaveLength(2);
    expect((await list(S.t.admin, '?type=scheduled&limit=100')).data).toHaveLength(2);
    expect(rowIds(await list(S.t.admin, '?type=template&limit=100'))).toEqual([S.ids.m3]);
    expect(rowIds(await list(S.t.admin, '?type=image&limit=100'))).toEqual([S.ids.m5]);
    expect((await list(S.t.admin, '?type=location&limit=100')).data).toHaveLength(0);
    expect(rowIds(await list(S.t.admin, '?type=text&limit=100')).sort()).toEqual(
      [S.ids.m1, S.ids.m2, S.ids.m4].sort(),
    );
  });

  it('channel, template, campaign, broadcast and scheduled message', async () => {
    const byChannel = await list(S.t.admin, `?channelId=${S.channelUuid}&limit=100`);
    expect(byChannel.data).toHaveLength(5);
    expect(byChannel.data.every((r) => r.entityKind === 'message')).toBe(true);
    expect(await list(S.t.admin, `?channelId=${randomUUID()}&limit=100`)).toMatchObject({
      data: [],
    });
    expect((await list(S.t.admin, `?templateId=${S.templateUuid}&limit=100`)).data).toHaveLength(6);
    expect((await list(S.t.admin, `?campaignId=${S.campaignUuid}&limit=100`)).data).toHaveLength(2);
    expect((await list(S.t.admin, `?broadcastId=${S.broadcastUuid}&limit=100`)).data).toHaveLength(
      3,
    );
    expect((await list(S.t.admin, `?scheduledId=${S.scheduledUuid}&limit=100`)).data).toHaveLength(
      2,
    );
    expect((await list(S.t.admin, `?scheduledId=${randomUUID()}&limit=100`)).data).toHaveLength(0);
  });

  it('the window: 24h, 7d, 30d, 90d and a day pair', async () => {
    const n = async (qs: string) => (await list(S.t.admin, `?${qs}&limit=100`)).data.length;
    // Within 24 hours: m1, m2, m3 and the nine recipient rows made that day (the broadcast's were created 5-6 hours ago).
    expect(await n('range=24h')).toBe(10);
    expect(await n('range=7d')).toBe(11);
    expect(await n('range=30d')).toBe(12);
    expect(await n('range=90d')).toBe(13);
    expect(await n(WIDE())).toBe(16);
    expect(await n(`from=${day(-45)}&to=${day(-35)}`)).toBe(1);
  });

  it('search: a contact name, the text, an entity name, a message id; a number by digits', async () => {
    const s = async (term: string) =>
      rowIds(await list(S.t.admin, `?q=${encodeURIComponent(term)}&limit=100`)).sort();
    expect(await s('asha')).toEqual([S.ids.m1, S.ids.m2, S.ids.m3, S.ids.bRead].sort());
    expect(await s('order number')).toEqual([S.ids.m1]);
    expect(await s('diwali')).toEqual([S.ids.kDelivered, S.ids.kFailed].sort());
    expect(await s(S.ids.m4.slice(2))).toEqual([S.ids.m4]);
    expect(await s('98000000')).toEqual(
      expect.arrayContaining([S.ids.m1, S.ids.sSent, S.ids.kDelivered]),
    );
    expect(await s('919800000099')).toEqual([S.ids.kDelivered]);
    expect(await s('nothing like this')).toEqual([]);
    // % and _ are plain characters, not wildcards.
    expect(await s('%')).toEqual([]);
  });
});

describe('the counts', () => {
  it('KPI cards are real counts of the window, over every source', async () => {
    const k = await get<MessageHistorySummary>(S.t.admin, '/v2/message-history/summary');
    expect(k).toMatchObject({
      total: 12,
      received: 2,
      failed: 4,
      sent: 6,
      queued: 1,
      delivered: 4,
      read: 2,
      sentPct: 50,
      receivedPct: 17,
      failPct: 66.7,
      deliveryRate: 44.4,
    });
    expect(k.dirCounts).toEqual({ all: 12, out: 10, in: 2, fail: 4 });
    // The 30 days before hold one message (the 40 day old API send): 12 against 1 is +1100%.
    expect(k.deltaPct).toBe(1100);
  });

  it('the narrowing filters do not move the cards; the scoping ones do', async () => {
    const base = await get<MessageHistorySummary>(S.t.admin, '/v2/message-history/summary');
    const narrowed = await get<MessageHistorySummary>(
      S.t.admin,
      '/v2/message-history/summary?dir=fail&q=zzz&type=image',
    );
    expect(narrowed.total).toBe(base.total);
    const campaign = await get<MessageHistorySummary>(
      S.t.admin,
      `/v2/message-history/summary?campaignId=${S.campaignUuid}`,
    );
    expect(campaign).toMatchObject({ total: 2, failed: 1, delivered: 1 });
  });

  it('compares with the equal period before and reads the average first response', async () => {
    const k = await get<MessageHistorySummary>(S.t.admin, `/v2/message-history/summary?${WIDE()}`);
    expect(k.total).toBe(16);
    const wide = await get<MessageHistorySummary>(
      S.t.admin,
      '/v2/message-history/summary?range=90d',
    );
    // 13 rows in 90 days; the previous 90 days hold m7 (95d), m8 (100d): +550%.
    expect(wide.total).toBe(13);
    expect(wide.deltaPct).toBe(550);
    // Inside 7 days only one chat had both sides: the customer wrote at 4h ago, the agent answered 60 s later.
    const week = await get<MessageHistorySummary>(
      S.t.admin,
      '/v2/message-history/summary?range=7d',
    );
    expect(week.avgFirstResponseSeconds).toBe(60);
  });

  it('charges are summed by currency for a caller who may read the wallet statement, and hidden from everyone else', async () => {
    const admin = await get<MessageHistorySummary>(S.t.admin, '/v2/message-history/summary');
    expect(admin.cost).toEqual([
      { currency: 'INR', minor: 400, messages: 2 },
      { currency: 'USD', minor: 100, messages: 1 },
    ]);
    const reader2 = await get<MessageHistorySummary>(
      S.reader2.token,
      '/v2/message-history/summary',
    );
    expect(reader2.cost).toEqual(admin.cost);
    const reader = await get<MessageHistorySummary>(S.reader.token, '/v2/message-history/summary');
    expect(reader.cost).toBeNull();
    const rows = await list(S.t.admin, '?limit=100');
    expect(rows.data.find((r) => r.id === S.ids.m3)!.cost).toEqual({
      minor: 150,
      currency: 'INR',
      status: 'charged',
    });
    expect(rows.data.find((r) => r.id === S.ids.bRead)!.cost).toMatchObject({ minor: 250 });
    expect(rows.data.find((r) => r.id === S.ids.m1)!.cost).toBeNull();
    const hidden = await list(S.reader.token, '?limit=100');
    expect(hidden.data.every((r) => r.cost === null)).toBe(true);
  });

  it('insights: the volume per day (empty days included), the type mix and the most active conversations', async () => {
    const i = await get<MessageHistoryInsights>(
      S.t.admin,
      '/v2/message-history/insights?range=7d&bucket=daily&tz=UTC',
    );
    expect(i.volume.length).toBeGreaterThanOrEqual(7);
    expect(i.volume.reduce((n, v) => n + v.sent + v.received + v.failed, 0)).toBe(11);
    expect(i.volume.reduce((n, v) => n + v.failed, 0)).toBe(4);
    expect(i.volume.reduce((n, v) => n + v.received, 0)).toBe(1);
    expect(i.typeMix).toEqual({
      text: 4,
      autoReply: 0,
      campaign: 2,
      broadcast: 3,
      scheduled: 2,
      media: 0,
    });
    expect(i.topConversations[0]).toMatchObject({
      conversationId: S.convMine,
      messages: 3,
      name: 'Asha Mine',
    });
    const hourly = await get<MessageHistoryInsights>(
      S.t.admin,
      '/v2/message-history/insights?bucket=hourly&tz=Asia/Kolkata',
    );
    expect(hourly.tz).toBe('Asia/Kolkata');
    expect(hourly.volume.length).toBeLessThanOrEqual(26);
    const weekly = await get<MessageHistoryInsights>(
      S.t.admin,
      '/v2/message-history/insights?range=90d&bucket=weekly',
    );
    expect(weekly.volume.length).toBeGreaterThanOrEqual(12);
    // The charts follow the filters, as Reference's did.
    const failed = await get<MessageHistoryInsights>(
      S.t.admin,
      '/v2/message-history/insights?dir=fail',
    );
    expect(failed.volume.reduce((n, v) => n + v.sent + v.received, 0)).toBe(0);
    expect(failed.volume.reduce((n, v) => n + v.failed, 0)).toBe(4);
  });
});

describe('the drawer', () => {
  it('opens a message with its text, who sent it, and the delivery log', async () => {
    const d = await get<MessageHistoryDetail>(S.t.admin, `/v2/message-history/${S.ids.m1}`);
    expect(d.body).toBe('Hello I need help with my order number 123 please');
    expect(d.preview).toHaveLength(41);
    expect(d.conversationId).toBe(S.convMine);
    expect(d.timeline.map((e) => e.event)).toEqual(['queued']);
    const m2 = await get<MessageHistoryDetail>(S.t.admin, `/v2/message-history/${S.ids.m2}`);
    expect(m2).toMatchObject({
      sender: { kind: 'agent', name: 'Admin Person' },
      providerMessageId: 'wamid.M2',
    });
  });

  it('reads an archived day: the events of a 100 day old message come from the archive', async () => {
    const d = await get<MessageHistoryDetail>(S.t.admin, `/v2/message-history/${S.ids.m8}`);
    expect(d.fromArchive).toBe(true);
    expect(d.timeline.map((e) => e.event)).toEqual(['queued', 'attempt', 'failed']);
    expect(d.failure).toMatchObject({ code: 'RECIPIENT_UNDELIVERABLE' });
    expect(d.timeline[2]).toMatchObject({ errorCode: 'RECIPIENT_UNDELIVERABLE' });
    const e = await get<MessageHistoryDetail>(S.t.admin, `/v2/message-history/${S.ids.m9}`);
    // A message with no log lines: its status is known, its steps are not.
    expect(e.timeline).toEqual([]);
  });

  it('opens a recipient row with the moments it recorded', async () => {
    const f = await get<MessageHistoryDetail>(S.t.admin, `/v2/message-history/${S.ids.kFailed}`);
    expect(f.timeline.map((x) => x.event)).toEqual(['queued', 'failed']);
    expect(f.failure?.reason).toContain('131049');
    expect(f.entity).toMatchObject({ kind: 'campaign' });
    const s = await get<MessageHistoryDetail>(S.t.admin, `/v2/message-history/${S.ids.sSent}`);
    expect(s.body).toBe('Good morning to you');
    expect(s.timeline.map((x) => x.event)).toEqual(['queued', 'sent']);
    const b = await get<MessageHistoryDetail>(S.t.admin, `/v2/message-history/${S.ids.bRead}`);
    expect(b.timeline.map((x) => x.event)).toEqual(['queued', 'sent', 'read']);
  });

  it('answers 404 for a row that does not exist, 422 for an id that is not one', async () => {
    await get(S.t.admin, `/v2/message-history/m:${randomUUID()}`, 404);
    await get(S.t.admin, `/v2/message-history/b:${randomUUID()}`, 404);
    await get(S.t.admin, '/v2/message-history/not-an-id', 422);
  });
});

describe('who sees what', () => {
  it('a member who reads only their own conversations sees only those messages: no one else, no recipient rows', async () => {
    const mine = await list(S.agentOwn.token, `?${WIDE()}&limit=100`);
    expect(new Set(rowIds(mine))).toEqual(new Set([S.ids.m1, S.ids.m2, S.ids.m3, S.ids.m7]));
    for (const id of [
      S.ids.m4,
      S.ids.m5,
      S.ids.m6,
      S.ids.m8,
      S.ids.m9,
      S.ids.bRead,
      S.ids.kFailed,
      S.ids.sSent,
    ]) {
      expect(rowIds(mine)).not.toContain(id);
    }
  });

  it('their cards, charts and search count only what they can see', async () => {
    const k = await get<MessageHistorySummary>(S.agentOwn.token, '/v2/message-history/summary');
    expect(k).toMatchObject({ total: 3, received: 1, failed: 0 });
    expect(k.dirCounts.all).toBe(3);
    const i = await get<MessageHistoryInsights>(
      S.agentOwn.token,
      '/v2/message-history/insights?range=30d',
    );
    expect(i.volume.reduce((n, v) => n + v.sent + v.received + v.failed, 0)).toBe(3);
    expect(i.typeMix.broadcast + i.typeMix.campaign + i.typeMix.scheduled).toBe(0);
    expect(i.topConversations.map((c) => c.conversationId)).toEqual([S.convMine]);
    // The text and the name of someone else's chat are not searchable.
    expect(rowIds(await list(S.agentOwn.token, '?q=Old%20failure'))).toEqual([]);
    expect(rowIds(await list(S.agentOwn.token, `?${WIDE()}&q=Bina`))).toEqual([]);
    expect(rowIds(await list(S.agentOwn.token, `?q=Flow%20message`))).toEqual([]);
    expect(
      rowIds(await list(S.agentOwn.token, '?channelId=' + S.channelUuid + '&limit=100')).sort(),
    ).toEqual([S.ids.m1, S.ids.m2, S.ids.m3].sort());
  });

  it("the drawer of someone else's message, or of any recipient row, is a 404 for them (as if it did not exist)", async () => {
    for (const id of [S.ids.m4, S.ids.m5, S.ids.m8, S.ids.bRead, S.ids.kFailed, S.ids.sSent]) {
      await get(S.agentOwn.token, `/v2/message-history/${id}`, 404);
    }
    const own = await get<MessageHistoryDetail>(
      S.agentOwn.token,
      `/v2/message-history/${S.ids.m1}`,
    );
    expect(own.body).toContain('order number');
  });

  it('a member who reads every conversation sees everything, recipient rows included', async () => {
    const all = await list(S.reader.token, '?limit=100');
    expect(all.data).toHaveLength(12);
  });

  it('needs the history permission and a read scope for conversations', async () => {
    await get(S.noHistory.token, '/v2/message-history', 403);
    await get(S.noHistory.token, '/v2/message-history/summary', 403);
    await get(S.noHistory.token, '/v2/message-history/insights', 403);
    await get(S.noHistory.token, `/v2/message-history/${S.ids.m1}`, 403);
    await get(S.noRead.token, '/v2/message-history', 403);
    const anon = await p.api.http().get('/v2/message-history');
    expect(anon.status).toBe(401);
  });

  it("another workspace sees none of it: an empty feed, zero counts, a 404 on this workspace's rows", async () => {
    const other = await p.api.signup('other');
    expect((await list(other.admin, `?${WIDE()}`)).data).toEqual([]);
    const k = await get<MessageHistorySummary>(other.admin, '/v2/message-history/summary');
    expect(k.total).toBe(0);
    await get(other.admin, `/v2/message-history/${S.ids.m1}`, 404);
    await get(other.admin, `/v2/message-history/${S.ids.bRead}`, 404);
    expect((await list(other.admin, `?campaignId=${S.campaignUuid}`)).data).toEqual([]);
    expect((await list(other.admin, `?channelId=${S.channelUuid}`)).data).toEqual([]);
  });
});

describe('recipient numbers', () => {
  const rowOf = (page: MessageHistoryPage, id: string): MessageHistoryRow =>
    page.data.find((r) => r.id === id)!;

  it('are masked to the last four digits for a caller who may not read the contact, and whole for one who may', async () => {
    const hidden = await list(S.reader.token, '?limit=100');
    const m1 = rowOf(hidden, S.ids.m1);
    expect(m1.recipient).toEqual({ value: expect.stringMatching(/^•+0001$/), masked: true });
    expect(JSON.stringify(hidden)).not.toContain('9198000000');
    // The contact's NAME is shown either way (Reference's rule).
    expect(m1.contact.name).toBe('Asha Mine');
    expect(rowOf(hidden, S.ids.kDelivered).recipient.value).toMatch(/^•+0099$/);
    expect(rowOf(hidden, S.ids.sSent).recipient.value).toMatch(/^•+0004$/);

    const shown = await list(S.reader2.token, '?limit=100');
    expect(rowOf(shown, S.ids.m1).recipient).toEqual({ value: '+919800000001', masked: false });
    expect(rowOf(shown, S.ids.kDelivered).recipient.value).toBe('+919800000099');
    const admin = await list(S.t.admin, '?limit=100');
    expect(rowOf(admin, S.ids.sSent).recipient.value).toBe('+919800000004');
  });

  it('a contact scoped to its owner is open only to the owner', async () => {
    const mine = await list(S.agentOwn.token, '?limit=100');
    // Asha's contact is owned by this member.
    expect(rowOf(mine, S.ids.m1).recipient).toEqual({ value: '+919800000001', masked: false });
    // A thread with no saved contact is not a contact they may read.
    const free = await list(S.agentOwn.token, `?${WIDE()}&limit=100`);
    expect(free.data.some((r) => r.recipient.masked)).toBe(false);
  });

  it('cannot be found by typing digits when they are masked, and can when they are shown', async () => {
    expect(rowIds(await list(S.reader.token, '?q=919800000001'))).toEqual([]);
    expect(rowIds(await list(S.reader.token, '?q=9800000001'))).toEqual([]);
    // The last four are visible, but a hidden number is not searchable at all.
    expect(rowIds(await list(S.reader.token, '?q=0001'))).toEqual([]);
    expect(rowIds(await list(S.reader2.token, '?q=919800000001')).sort()).toEqual(
      [S.ids.m1, S.ids.m2, S.ids.m3, S.ids.bRead].sort(),
    );
    expect(rowIds(await list(S.t.admin, '?q=919800000099'))).toEqual([S.ids.kDelivered]);
  });
});

describe('the export', () => {
  const post = (token: string, body: Record<string, unknown>) =>
    p.api
      .as(token)
      .post('/v2/message-history/exports')
      .set('idempotency-key', `x-${randomUUID()}`)
      .send(body);

  it('is built with the filters of the screen, listed with its kind, and downloaded as a CSV', async () => {
    // One at a time per workspace: an export that is still running refuses the next.
    const busy = (
      await q(
        `INSERT INTO message_log_exports (org_id, requested_by, range_from, range_to, status, started_at)
         VALUES ($1,$2,current_date,current_date,'running',now()) RETURNING id`,
        [S.t.orgId, S.t.adminUserId],
      )
    ).rows[0].id;
    expect((await post(S.t.admin, { range: '7d' })).status).toBe(409);
    await q(`DELETE FROM message_log_exports WHERE id = $1`, [busy]);

    const res = await post(S.t.admin, { dir: 'fail', range: '30d' });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const created = res.body as MessageLogExport;
    expect(created.kind).toBe('messages');

    const ready = await until(
      'the export is ready',
      async () => {
        const l = await get<{ data: MessageLogExport[] }>(
          S.t.admin,
          '/v2/inbox/message-logs/exports?kind=messages',
        );
        const e = l.data.find((x) => x.id === created.id);
        if (e?.status === 'failed') throw new Error(`export failed: ${e.error}`);
        return e?.status === 'ready' ? e : undefined;
      },
      60_000,
    );
    expect(ready.rowCount).toBe(4);
    // It is not in the delivery-log list.
    const events = await get<{ data: MessageLogExport[] }>(
      S.t.admin,
      '/v2/inbox/message-logs/exports',
    );
    expect(events.data.find((x) => x.id === created.id)).toBeUndefined();

    const dl = await p.api
      .as(S.t.admin)
      .get(`/v2/inbox/message-logs/exports/${created.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/message-history-.*\.csv/);
    const lines = dl.text
      .slice(dl.text.startsWith(String.fromCharCode(0xfeff)) ? 1 : 0)
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe(
      'ID,Source,When (UTC),Direction,Phone,Contact,Status,Type,Body,Channel,Template,Campaign / broadcast / schedule,Error code,Error message',
    );
    expect(lines).toHaveLength(5);
    const body = lines.slice(1).join('\n');
    for (const id of [S.ids.m4, S.ids.bFailed, S.ids.kFailed, S.ids.sFailed])
      expect(body).toContain(id);
    expect(body).not.toContain(S.ids.m1);
    expect(body).toContain('ECOSYSTEM_ENGAGEMENT_BLOCKED');
    expect(body).toContain('Diwali Sale');
  }, 120_000);

  it('applies the search and the source filters too', async () => {
    const res = await post(S.t.admin, { range: '90d', q: 'diwali', source: ['campaign'] });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const created = res.body as MessageLogExport;
    const ready = await until(
      'ready',
      async () => {
        const l = await get<{ data: MessageLogExport[] }>(
          S.t.admin,
          '/v2/inbox/message-logs/exports?kind=messages',
        );
        const e = l.data.find((x) => x.id === created.id);
        if (e?.status === 'failed') throw new Error(`export failed: ${e.error}`);
        return e?.status === 'ready' ? e : undefined;
      },
      60_000,
    );
    expect(ready.rowCount).toBe(2);
  }, 120_000);

  it('is refused to a member who cannot export, and to one who cannot read every conversation', async () => {
    expect((await post(S.reader.token, { range: '7d' })).status).toBe(403);
    expect((await post(S.noHistory.token, { range: '7d' })).status).toBe(403);
    const limited = await p.api.member(S.t, 'exp-own', [
      ['msg.history.read', 'all'],
      ['inbox.conversation.read', 'own'],
      ['inbox.logs.export', 'all'],
    ]);
    // Holds the export key but sees only their own chats: the file would hand out the rest.
    expect((await post(limited.token, { range: '7d' })).status).toBe(403);
    const noHist = await p.api.member(S.t, 'exp-nohist', [
      ['inbox.conversation.read', 'all'],
      ['inbox.logs.export', 'all'],
    ]);
    expect((await post(noHist.token, { range: '7d' })).status).toBe(403);
    expect((await post(S.t.admin, { range: '400d' })).status).toBe(422);
    expect((await post(S.t.admin, { from: day(-1), to: day(-5) })).status).toBe(422);
  });
});

describe('the query plan', () => {
  it('a page of the feed and the counts stay index scans with a few thousand rows', async () => {
    const t = await p.api.signup('plan');
    const ch = await inbox.channel(t.admin, { name: 'Plan' });
    // 200 conversations, so the planner has a real choice between walking the conversations and walking the messages by time.
    const chId = await inbox.channelId(ch.id);
    await q(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title, status, msg_seq, last_message_at)
       SELECT $1, $2, '9199' || lpad(g::text, 8, '0'), 'Plan ' || g, 'open', 20, now() FROM generate_series(1, 200) g`,
      [t.orgId, chId],
    );
    const convIds = (
      await q(`SELECT array_agg(id ORDER BY id) AS ids FROM conversations WHERE org_id = $1`, [
        t.orgId,
      ])
    ).rows[0].ids as string[];
    await q(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, body, status, created_at)
       SELECT $1, ($2::bigint[])[1 + g % 200], g, CASE WHEN g % 3 = 0 THEN 'in' ELSE 'out' END, 'text', CASE WHEN g % 3 = 0 THEN 'customer' ELSE 'agent' END,
              'message ' || g, CASE WHEN g % 3 = 0 THEN 'received' WHEN g % 7 = 0 THEN 'failed' ELSE 'delivered' END,
              now() - (g || ' minutes')::interval
       FROM generate_series(1, 4000) g`,
      [t.orgId, `{${convIds.join(',')}}`],
    );
    const contact = Number(
      (
        await q(
          `INSERT INTO contacts (org_id, name, phone) VALUES ($1,'Plan','+919811111111') RETURNING id`,
          [t.orgId],
        )
      ).rows[0].id,
    );
    const b = Number(
      (await q(`INSERT INTO broadcasts (org_id, name) VALUES ($1,'Plan') RETURNING id`, [t.orgId]))
        .rows[0].id,
    );
    await q(
      `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, sent_at, created_at)
       SELECT $1, $2, $3, 'sent', now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval FROM generate_series(1, 1500) g`,
      [t.orgId, b, contact],
    );
    for (const table of [
      'messages',
      'conversations',
      'contacts',
      'channels',
      'broadcast_contacts',
      'broadcasts',
      'wa_templates',
    ]) {
      await q(`ANALYZE ${table}`);
    }

    const dialect = new PgDialect();
    const ctx = {
      orgId: t.orgId,
      conversationVisible: sql`TRUE`,
      bulk: true,
      contacts: { scope: 'all' as const, userId: t.adminUserId, teamIds: [] },
      cost: false,
    };
    const sel = {
      window: { from: new Date(Date.now() - 30 * DAY), to: new Date(Date.now() + 1000) },
      scoping: {},
      narrow: {},
    };
    const built = dialect.sqlToQuery(pageSql(ctx, sel, 'row', null, 25));
    const plan = await q(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${built.sql}`,
      built.params as unknown[],
    );
    const text = plan.rows.map((r) => r['QUERY PLAN'] as string).join('\n');
    console.log(
      `--- EXPLAIN ANALYZE, page of 25 over 4000 messages + 1500 broadcast rows ---\n${text}`,
    );
    const ms = Number(/Execution Time: ([\d.]+) ms/.exec(text)?.[1]);
    expect(ms).toBeLessThan(500);
    // Each branch is cut at 26 rows before the merge: no branch reads thousands of rows.
    expect(text).toMatch(/Limit/);
    // No node of the plan reads the thousands of rows the window holds: each branch is cut at 26 before the merge.
    const actual = [...text.matchAll(/actual time=[\d.]+\.\.[\d.]+ rows=(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    expect(Math.max(...actual)).toBeLessThan(1500);

    // And the API answers a page of it.
    const page = await list(t.admin, '?limit=25');
    expect(page.data).toHaveLength(25);
    expect(page.page.hasMore).toBe(true);
    const k = await get<MessageHistorySummary>(t.admin, '/v2/message-history/summary');
    expect(k.total).toBe(5500);
  }, 120_000);
});
