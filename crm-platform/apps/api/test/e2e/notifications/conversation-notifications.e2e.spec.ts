import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REALTIME_EVENT, realtimeEventSchemas } from '@crm/contracts';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { InboxTriageService } from '../../../src/modules/team-inbox-conversations/inbox-triage.service';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import { TaskNotificationConsumer } from '../../../src/modules/notifications/task-notification.consumer';
import { OutboxDrainService } from '../../../src/workers/outbox-drain.service';
import {
  listen,
  eventsOf,
  simChannel,
  simInbound,
  sleep,
  until,
  type Conn,
  type Pipeline,
  type SimChannel,
} from '../chat-conversations/pipeline-support';
import { Api, startHarness, type Tenant } from '../contacts-attributes-tags/support';
import { AGENT, Inbox } from '../team-inbox-conversations/support';

/**
 * Live conversation notifications end to end (BL-096 phase 1, docs/specs/realtime-notifications.md): a real inbound message through the
 * ingest pipeline writes a `message.received` outbox event; the REAL outbox drain hands it to the REAL consumer, which writes the bell
 * rows; the publisher announces them (`notification.created`) to the right people's `user` rooms over real sockets and the Redis adapter.
 * Who is told, and who is not, is asserted on both the feed (REST) and the sockets.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

const adapterRedis: Redis[] = [];
class TestRedisIoAdapter extends IoAdapter {
  private ctor?: ReturnType<typeof createAdapter>;
  connect(redisUrl: string): void {
    const pub = new Redis(redisUrl, { maxRetriesPerRequest: null, retryStrategy: () => null });
    const sub = pub.duplicate();
    for (const r of [pub, sub]) r.on('error', () => undefined);
    adapterRedis.push(pub, sub);
    this.ctor = createAdapter(pub, sub);
  }
  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as { adapter: (a: unknown) => void };
    if (this.ctor) server.adapter(this.ctor);
    return server as unknown as Server;
  }
}

let p: Pipeline;
let api: Api;
let inbox: Inbox;
let drainer: OutboxDrainService;
let prefs: NotificationPrefsResolver;

beforeAll(async () => {
  const h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/chat-conversations/chat-conversations-worker.module'))
        .ChatConversationsWorkerModule,
      (await import('../../../src/modules/notifications')).NotificationsWorkerModule,
    ],
    configureApp: (app) => {
      const adapter = new TestRedisIoAdapter(app);
      adapter.connect(process.env.REDIS_URL!);
      app.useWebSocketAdapter(adapter);
    },
  });
  await h.app.listen(0, '127.0.0.1');
  const socketUrl = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}/realtime`;
  api = new Api(h);
  p = {
    h,
    api,
    socketUrl,
    stop: async () => {
      await h.stop();
      for (const r of adapterRedis) r.disconnect();
    },
  };
  inbox = new Inbox(h, api);
  drainer = new OutboxDrainService(h.app.get(DatabaseService), h.app.get(OutboxSubscriberRegistry));
  prefs = h.app.get(NotificationPrefsResolver, { strict: false });
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

// --- helpers -------------------------------------------------------------------------------------------------------------------

const uuidOf = async (userId: number) =>
  (await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

/** What the worker's drain loop does: claim every pending outbox row and hand it to the subscribers, until none is left. */
async function deliver(): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    await drainer.drain();
    const left = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM event_outbox WHERE status IN ('pending','processing')`,
    );
    if (left.rows[0].n === 0) return;
    await sleep(50);
  }
  throw new Error('the outbox did not drain');
}

const outboxCount = async (orgId: number, type: string) =>
  Number(
    (
      await p.h.owner.query(
        `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = $2`,
        [orgId, type],
      )
    ).rows[0].n,
  );

/** A customer message through the real pipeline; resolves once its `message.received` event is in the outbox. */
async function customerSays(t: Tenant, ch: SimChannel, from: string, text: string, name?: string) {
  const before = await outboxCount(t.orgId, 'message.received');
  await simInbound(p, t, ch, { from, text, ...(name ? { name } : {}) });
  await until('message.received in the outbox', async () =>
    (await outboxCount(t.orgId, 'message.received')) > before ? true : undefined,
  );
}

async function conversationUuid(t: Tenant, ch: SimChannel, peer: string): Promise<string> {
  const r = await until('the conversation', async () => {
    const x = await p.h.owner.query(
      `SELECT uuid FROM conversations WHERE org_id = $1 AND channel_id = $2 AND peer_key = $3`,
      [t.orgId, ch.internalId, peer],
    );
    return x.rows[0]?.uuid as string | undefined;
  });
  return r;
}

interface Row {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  count?: number;
  subject?: { kind: string; id: string } | null;
}
const feed = async (token: string, qs = '') => {
  const res = await api.as(token).get(`/v2/notifications${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { data: Row[]; meta: { unread: number } };
};
const created = (c: Conn) =>
  eventsOf(c, REALTIME_EVENT.notificationCreated).map((e) => e.payload as Record<string, unknown>);
const reads = (c: Conn) =>
  eventsOf(c, REALTIME_EVENT.notificationRead).map((e) => e.payload as Record<string, unknown>);
const settle = () => sleep(500);

// --- the people ------------------------------------------------------------------------------------------------------------------

describe('conversation notifications over sockets', () => {
  let t: Tenant;
  let other: Tenant;
  let ch: SimChannel;
  let bo: { token: string; userId: number }; // sees and answers everything
  let ana: { token: string; userId: number }; // only her own threads
  let cy: { token: string; userId: number }; // only her own threads, none assigned
  let sockets: Record<'admin' | 'bo' | 'ana' | 'ana2' | 'cy' | 'foreign', Conn>;

  beforeAll(async () => {
    t = await api.signup('ntv');
    other = await api.signup('ntw');
    ch = await simChannel(p, t);
    bo = await api.member(t, 'bo', AGENT);
    ana = await api.member(t, 'ana', [
      ['inbox.conversation.read', 'own'],
      ['inbox.conversation.reply', 'own'],
    ]);
    cy = await api.member(t, 'cy', [
      ['inbox.conversation.read', 'own'],
      ['inbox.conversation.reply', 'own'],
    ]);
    sockets = {
      admin: await listen(p, t.admin),
      bo: await listen(p, bo.token),
      ana: await listen(p, ana.token),
      ana2: await listen(p, ana.token), // a second tab of the same person
      cy: await listen(p, cy.token),
      foreign: await listen(p, other.admin),
    };
  });

  const everyone = () => Object.values(sockets);
  const mark = () =>
    Object.fromEntries(Object.entries(sockets).map(([k, c]) => [k, c.events.length]));
  const since = (m: Record<string, number>, who: keyof typeof sockets) =>
    sockets[who].events.slice(m[who]).filter((e) => e.name === REALTIME_EVENT.notificationCreated);

  it('a new chat nobody owns tells everyone who may see AND reply, once, and nobody else (D1)', async () => {
    const m = mark();
    await customerSays(t, ch, '919800000001', 'Hello, I need help with my order', 'Newbie');
    await deliver();
    await settle();

    const adminFeed = await feed(t.admin);
    const boFeed = await feed(bo.token);
    for (const f of [adminFeed, boFeed]) {
      expect(f.data).toHaveLength(1);
      expect(f.data[0]).toMatchObject({
        type: 'new_chat',
        title: 'New chat from Newbie',
        body: 'Hello, I need help with my order',
        readAt: null,
      });
      expect(f.data[0]!.data).toMatchObject({ contactName: 'Newbie', channelKind: 'simulator' });
      expect(f.data[0]!.subject).toMatchObject({ kind: 'conversation' });
      expect(f.data[0]!.link).toBe(`/inbox?c=${f.data[0]!.subject!.id}`);
      expect(f.meta.unread).toBe(1);
    }
    // Ana and Cy see only their own threads: an unassigned one is not theirs. Another workspace hears nothing.
    expect((await feed(ana.token)).data).toHaveLength(0);
    expect((await feed(cy.token)).data).toHaveLength(0);
    expect((await feed(other.admin)).data).toHaveLength(0);

    for (const who of ['admin', 'bo'] as const) {
      const evs = since(m, who);
      expect(evs, who).toHaveLength(1);
      const payload = realtimeEventSchemas[REALTIME_EVENT.notificationCreated].parse(
        evs[0]!.data.payload,
      );
      expect(payload).toMatchObject({
        type: 'new_chat',
        unread: 1,
        subjectKind: 'conversation',
        collapsed: false,
        silent: false,
      });
      // The event is a hint: ids and numbers, never the customer's words, name or number.
      const wire = JSON.stringify(evs[0]!.data);
      expect(wire).not.toContain('Newbie');
      expect(wire).not.toContain('Hello');
      expect(wire).not.toContain('919800000001');
    }
    for (const who of ['ana', 'ana2', 'cy', 'foreign'] as const)
      expect(since(m, who), who).toHaveLength(0);
  });

  it('later messages on a chat I own collapse into ONE row with a count; only the first pings; nobody else is told', async () => {
    await customerSays(t, ch, '919800000002', 'first', 'Dee');
    await deliver();
    const conv = await conversationUuid(t, ch, '919800000002');
    await p.h.owner.query(`UPDATE conversations SET assignee_user_id = $1 WHERE uuid = $2`, [
      ana.userId,
      conv,
    ]);
    const m = mark();

    await customerSays(t, ch, '919800000002', 'second message', 'Dee');
    await deliver();
    await customerSays(t, ch, '919800000002', 'third message', 'Dee');
    await deliver();
    await customerSays(t, ch, '919800000002', 'fourth message', 'Dee');
    await deliver();
    await settle();

    const mine = await feed(ana.token);
    const rows = mine.data.filter((r) => r.type === 'new_message');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      count: 3,
      title: '3 new messages from Dee',
      body: 'fourth message',
      readAt: null,
      subject: { kind: 'conversation', id: conv },
    });
    // One bell entry for the chat, so the badge is 1, not 3.
    expect(mine.meta.unread).toBe(1);

    const evs = since(m, 'ana').map((e) => e.data.payload as Record<string, unknown>);
    expect(evs).toHaveLength(3);
    expect(evs.map((e) => e.silent)).toEqual([false, true, true]);
    expect(evs.map((e) => e.collapsed)).toEqual([false, true, true]);
    expect(evs.every((e) => e.unread === 1 && e.type === 'new_message')).toBe(true);
    // Her second tab hears the same; the others do not.
    expect(since(m, 'ana2')).toHaveLength(3);
    for (const who of ['admin', 'bo', 'cy', 'foreign'] as const)
      expect(since(m, who), who).toHaveLength(0);
  });

  it('delivering the same events again changes nothing (at-least-once outbox)', async () => {
    const before = await feed(ana.token);
    const boBefore = await feed(bo.token);
    await p.h.owner.query(
      `UPDATE event_outbox SET status = 'pending', attempts = 0, available_at = now(), processed_at = NULL
        WHERE org_id = $1 AND event_type = 'message.received' AND payload ->> 'firstInbound' = 'false'`,
      [t.orgId],
    );
    await deliver();
    const after = await feed(ana.token);
    expect(after.data.map((r) => [r.id, r.count])).toEqual(before.data.map((r) => [r.id, r.count]));
    expect(after.meta.unread).toBe(before.meta.unread);
    expect((await feed(bo.token)).data.map((r) => r.id)).toEqual(boBefore.data.map((r) => r.id));
  });

  it('opening the thread clears its bell row on every tab and device, and says so on the socket', async () => {
    const conv = await conversationUuid(t, ch, '919800000002');
    const m = mark();
    const res = await api
      .as(ana.token)
      .post(`/v2/inbox/conversations/${conv}/read`)
      .send({ upToSeq: 99 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await settle();

    const f = await feed(ana.token);
    expect(f.data.find((r) => r.type === 'new_message')!.readAt).not.toBeNull();
    expect(f.meta.unread).toBe(0);
    for (const who of ['ana', 'ana2'] as const) {
      const evs = sockets[who].events
        .slice(m[who])
        .filter((e) => e.name === REALTIME_EVENT.notificationRead);
      expect(evs, who).toHaveLength(1);
      const payload = realtimeEventSchemas[REALTIME_EVENT.notificationRead].parse(
        evs[0]!.data.payload,
      );
      expect(payload.unread).toBe(0);
      expect(payload.notificationIds).toHaveLength(1);
    }
    for (const who of ['admin', 'bo', 'cy', 'foreign'] as const) {
      expect(
        sockets[who].events.slice(m[who]).filter((e) => e.name === REALTIME_EVENT.notificationRead),
        who,
      ).toHaveLength(0);
    }
  });

  it('a person who is reading the thread when a message lands is not alerted; a bell row they have is cleared', async () => {
    const conv = await conversationUuid(t, ch, '919800000002');
    await customerSays(t, ch, '919800000002', 'while you read', 'Dee');
    // The open thread marks itself read as the message arrives, before the worker gets to the event.
    await api.as(ana.token).post(`/v2/inbox/conversations/${conv}/read`).send({ upToSeq: 99 });
    const m = mark();
    await deliver();
    await settle();
    expect(since(m, 'ana')).toHaveLength(0);
    expect((await feed(ana.token)).meta.unread).toBe(0);
  });

  it('assigning a conversation tells the new assignee, never the person who did it, and unassigning tells nobody', async () => {
    await customerSays(t, ch, '919800000003', 'assign me', 'Eve');
    await deliver();
    const conv = await conversationUuid(t, ch, '919800000003');
    const m = mark();

    let res = await api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv}/assign`)
      .send({ rowVersion: await inbox.version(conv), userId: await uuidOf(ana.userId) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await deliver();
    await settle();

    const f = await feed(ana.token);
    const row = f.data.find((r) => r.type === 'conversation_assigned')!;
    expect(row).toMatchObject({
      title: 'Conversation assigned to you',
      subject: { kind: 'conversation', id: conv },
    });
    expect(row.data).toMatchObject({ contactName: 'Eve', teamAssigned: false });
    const evs = since(m, 'ana');
    expect(evs).toHaveLength(1);
    expect(evs[0]!.data.payload).toMatchObject({ type: 'conversation_assigned', silent: false });
    for (const who of ['admin', 'bo', 'cy', 'foreign'] as const)
      expect(since(m, who), who).toHaveLength(0);

    // Assigning it to oneself, and unassigning it, tell nobody.
    const m2 = mark();
    res = await api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv}/assign`)
      .send({ rowVersion: await inbox.version(conv), userId: null });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    res = await api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv}/assign`)
      .send({ rowVersion: await inbox.version(conv), userId: await uuidOf(t.adminUserId) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await deliver();
    await settle();
    for (const who of Object.keys(sockets) as Array<keyof typeof sockets>) {
      expect(since(m2, who), who).toHaveLength(0);
    }
    // Reassigned back to Ana later: a real second event notifies again.
    res = await api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv}/assign`)
      .send({ rowVersion: await inbox.version(conv), userId: await uuidOf(ana.userId) });
    expect(res.status).toBe(200);
    await deliver();
    expect(
      (await feed(ana.token)).data.filter((r) => r.type === 'conversation_assigned'),
    ).toHaveLength(2);
  });

  it('a snoozed chat that comes back by its time tells its assignee, and nobody else', async () => {
    await customerSays(t, ch, '919800000011', 'wake me', 'Wren');
    await deliver();
    const conv = await conversationUuid(t, ch, '919800000011');
    const assigned = await api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv}/assign`)
      .send({ rowVersion: await inbox.version(conv), userId: await uuidOf(ana.userId) });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    const snoozed = await api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv}/snooze`)
      .send({
        rowVersion: await inbox.version(conv),
        until: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(snoozed.status, JSON.stringify(snoozed.body)).toBe(200);
    await deliver();
    await p.h.owner.query(
      `UPDATE conversations SET snoozed_until = now() - interval '1 minute' WHERE uuid = $1`,
      [conv],
    );
    expect(await p.h.app.get(InboxTriageService).wakeDue()).toBeGreaterThanOrEqual(1);
    await deliver();
    await settle();

    const wakes = (await feed(ana.token)).data.filter((r) => r.type === 'snooze_wake');
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({ subject: { kind: 'conversation', id: conv } });
    expect(wakes[0]!.data).toMatchObject({ contactName: 'Wren', teamAssigned: false });
    expect((await feed(bo.token)).data.some((r) => r.type === 'snooze_wake')).toBe(false);
    expect((await feed(t.admin)).data.some((r) => r.type === 'snooze_wake')).toBe(false);
  });

  it('a mention tells each mentioned person who may see the conversation, not the author, not someone who cannot', async () => {
    await customerSays(t, ch, '919800000004', 'mention me', 'Fay');
    await deliver();
    const conv = await conversationUuid(t, ch, '919800000004');
    const m = mark();
    // Unassigned: Bo (reads all) may see it; Cy (own only) may not. The author is the admin.
    const res = await api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv}/notes`)
      .send({
        body: 'please take a look at this one',
        mentions: [await uuidOf(bo.userId), await uuidOf(cy.userId)],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await deliver();
    await settle();

    const boRow = (await feed(bo.token)).data.find((r) => r.type === 'mention')!;
    expect(boRow).toMatchObject({ subject: { kind: 'conversation', id: conv } });
    expect(boRow.title).toContain('mentioned you');
    expect(boRow.data).toMatchObject({
      preview: 'please take a look at this one',
      contactName: 'Fay',
    });
    expect(since(m, 'bo')).toHaveLength(1);
    expect((await feed(cy.token)).data.filter((r) => r.type === 'mention')).toHaveLength(0);
    expect((await feed(t.admin)).data.filter((r) => r.type === 'mention')).toHaveLength(0);
    for (const who of ['admin', 'cy', 'ana', 'foreign'] as const)
      expect(since(m, who), who).toHaveLength(0);
  });

  it('a muted conversation writes no new-chat or new-message row, but an assignment still reaches the person', async () => {
    await customerSays(t, ch, '919800000005', 'quiet please', 'Gus');
    await deliver();
    const conv = await conversationUuid(t, ch, '919800000005');
    await p.h.owner.query(
      `UPDATE conversations SET muted_at = now(), assignee_user_id = $2 WHERE uuid = $1`,
      [conv, ana.userId],
    );
    const m = mark();
    const beforeAna = (await feed(ana.token)).data.length;
    await customerSays(t, ch, '919800000005', 'still muted', 'Gus');
    await deliver();
    await settle();
    expect((await feed(ana.token)).data).toHaveLength(beforeAna);
    expect(since(m, 'ana')).toHaveLength(0);

    // Muting silences messages, not being addressed.
    await p.h.owner.query(`UPDATE conversations SET assignee_user_id = NULL WHERE uuid = $1`, [
      conv,
    ]);
    const res = await api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv}/assign`)
      .send({ rowVersion: await inbox.version(conv), userId: await uuidOf(ana.userId) });
    expect(res.status).toBe(200);
    await deliver();
    expect(
      (await feed(ana.token)).data.some(
        (r) => r.type === 'conversation_assigned' && r.subject?.id === conv,
      ),
    ).toBe(true);
  });

  it('the workspace toggles gate the new conversation types only (D3)', async () => {
    const off = { inapp: false, email: false, slack: false };
    await p.h.owner.query(
      `UPDATE organizations SET settings = settings || jsonb_build_object('notificationPrefs', $2::jsonb) WHERE id = $1`,
      [t.orgId, JSON.stringify({ events: { new_customer_reply: off }, categories: {} })],
    );
    prefs.clear();
    const m = mark();
    const bobefore = (await feed(bo.token)).data.length;
    await customerSays(t, ch, '919800000006', 'toggle off', 'Hal');
    await deliver();
    await settle();
    expect((await feed(bo.token)).data).toHaveLength(bobefore);
    expect(since(m, 'bo')).toHaveLength(0);

    // Mentions are a different toggle and still work; a task (ungated) is delivered as before.
    const conv = await conversationUuid(t, ch, '919800000006');
    const note = await api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv}/notes`)
      .send({ body: 'ping', mentions: [await uuidOf(bo.userId)] });
    expect(note.status).toBe(201);
    await deliver();
    expect(
      (await feed(bo.token)).data.filter((r) => r.type === 'mention' && r.subject?.id === conv),
    ).toHaveLength(1);

    await p.h.owner.query(
      `UPDATE organizations SET settings = settings - 'notificationPrefs' WHERE id = $1`,
      [t.orgId],
    );
    prefs.clear();
  });

  it('with the switch off the ingest writes no message.received event at all', async () => {
    const before = await outboxCount(t.orgId, 'message.received');
    process.env.NOTIFY_CONVERSATIONS_ENABLED = 'false';
    try {
      await simInbound(p, t, ch, { from: '919800000007', text: 'switch off' });
      await until(
        'the conversation',
        async () =>
          (
            await p.h.owner.query(
              `SELECT 1 FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id WHERE c.org_id = $1 AND c.peer_key = '919800000007'`,
              [t.orgId],
            )
          ).rows[0],
      );
    } finally {
      delete process.env.NOTIFY_CONVERSATIONS_ENABLED;
    }
    expect(await outboxCount(t.orgId, 'message.received')).toBe(before);
  });

  it('the existing consumers push too: a task assigned to Ana lights her bell live', async () => {
    const m = mark();
    const anaUuid = await uuidOf(ana.userId);
    const res = await api
      .as(t.admin)
      .post('/v2/tasks')
      .send({ title: 'Call the supplier', assigneeId: anaUuid });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await deliver();
    await settle();
    const evs = since(m, 'ana');
    expect(evs).toHaveLength(1);
    expect(evs[0]!.data.payload).toMatchObject({
      type: 'task_assigned',
      subjectKind: null,
      silent: false,
    });
    expect(since(m, 'bo')).toHaveLength(0);
    expect(p.h.app.get(TaskNotificationConsumer)).toBeDefined();
  });

  it('mark-all-read and read-subject tell the person other tabs, and only them', async () => {
    const m = mark();
    // Something unread for Ana first.
    const conv = await conversationUuid(t, ch, '919800000003');
    const sub = await api
      .as(ana.token)
      .post('/v2/notifications/read-subject')
      .send({ kind: 'conversation', id: conv });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.updated).toBeGreaterThanOrEqual(1);
    const bad = await api
      .as(ana.token)
      .post('/v2/notifications/read-subject')
      .send({ kind: 'nope', id: conv });
    expect(bad.status).toBe(422);

    const all = await api.as(ana.token).post('/v2/notifications/read-all');
    expect(all.status).toBe(200);
    await settle();
    expect((await feed(ana.token)).meta.unread).toBe(0);
    const evs = sockets.ana2.events
      .slice(m.ana2)
      .filter((e) => e.name === REALTIME_EVENT.notificationRead);
    expect(evs.length).toBeGreaterThanOrEqual(1);
    expect(evs.at(-1)!.data.payload).toMatchObject({ unread: 0 });
    for (const who of ['admin', 'cy', 'foreign'] as const) {
      expect(
        sockets[who].events.slice(m[who]).filter((e) => e.name === REALTIME_EVENT.notificationRead),
        who,
      ).toHaveLength(0);
    }
    expect(reads(sockets.ana).length).toBeGreaterThan(0);
  });

  it('a person without the inbox permission is never told about a conversation', async () => {
    const blind = await api.member(t, 'blind', []);
    const sock = await listen(p, blind.token);
    const m = sock.events.length;
    await customerSays(t, ch, '919800000008', 'nobody home', 'Ivy');
    await deliver();
    await settle();
    expect((await feed(blind.token)).data).toHaveLength(0);
    expect(
      sock.events.slice(m).filter((e) => e.name === REALTIME_EVENT.notificationCreated),
    ).toHaveLength(0);
    expect(created(sockets.foreign)).toHaveLength(0);
    expect(everyone().length).toBe(6);
  });

  it('drain headroom: a burst of queued message events is consumed in one tick, and the rates are recorded', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString(); // ahead of any "she just read it" mark
    const queue = async (conversationId: number, uuid: string, n: number) =>
      p.h.owner.query(
        `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
         SELECT $1, 'conversations', $2, 'message.received', jsonb_build_object(
           'conversationId', $3::text, 'messageId', '44444444-4444-4444-8444-444444444444',
           'channelId', '33333333-3333-4333-8333-333333333333', 'channelKind', 'simulator',
           'firstInbound', false, 'group', false, 'preview', 'burst ' || g, 'contactName', 'Dee', 'at', $4::text)
         FROM generate_series(1, $5) g`,
        [t.orgId, conversationId, uuid, at, n],
      );
    const pending = async () =>
      Number(
        (
          await p.h.owner.query(
            `SELECT count(*)::int AS n FROM event_outbox WHERE status IN ('pending','processing')`,
          )
        ).rows[0].n,
      );
    const timed = async (label: string, events: number) => {
      const started = Date.now();
      await drainer.drain();
      const ms = Date.now() - started;
      console.info(
        `[drain headroom] ${label}: ${events} message.received events in ${ms} ms (${Math.round((events / ms) * 1000)} events/s)`,
      );
      expect(await pending()).toBe(0);
    };

    // One busy chat: its events must stay in order, one after another, and every one is counted.
    const busy = await conversationUuid(t, ch, '919800000002');
    const busyRow = await p.h.owner.query(`SELECT id FROM conversations WHERE uuid = $1`, [busy]);
    await queue(Number(busyRow.rows[0].id), busy, 100);
    await timed('one chat', 100);
    const f = await feed(ana.token);
    expect(f.data.find((r) => r.type === 'new_message' && r.subject?.id === busy)?.count).toBe(100);

    // Many chats at once (the realistic burst): different aggregates are dispatched side by side.
    const chats: Array<{ id: number; uuid: string }> = [];
    for (let i = 0; i < 20; i += 1) {
      chats.push(await inbox.conversation(t, ch.id, { assigneeUserId: ana.userId, messages: 0 }));
    }
    for (const c of chats) await queue(c.id, c.uuid, 20);
    await timed('twenty chats', 400);
    const rows = (await feed(ana.token, '?limit=50')).data.filter((r) => r.type === 'new_message');
    for (const c of chats) {
      expect(rows.find((r) => r.subject?.id === c.uuid)?.count, c.uuid).toBe(20);
    }
  });
});
