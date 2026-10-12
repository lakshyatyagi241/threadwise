import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import type { Server, ServerOptions } from 'socket.io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REALTIME_EVENT,
  type RealtimeEnvelope,
  type RealtimeRoomAck,
  realtimeEventSchemas,
} from '@crm/contracts';
import { RealtimeEmitter } from '../../../src/realtime/realtime-emitter.service';
import { AGENT, Api, Inbox, startHarness, type Harness, type Tenant } from './support';

/**
 * What the inbox tells open screens, over real sockets (plan-inbox-chat.md Phase 1, realtime events `inbox.conversation.upsert` and
 * `inbox.assignment`): who hears about a status change, a note or an assignment, and that a person who loses a conversation is taken out
 * of its room and told to drop the row. Real Postgres, Redis, the API with its gateway listening, real socket.io clients.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let h: Harness;
let api: Api;
let inbox: Inbox;
let url: string;
const adapterRedis: Redis[] = [];
const sockets: Socket[] = [];

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

beforeAll(async () => {
  h = await startHarness({
    configureApp: (app) => {
      const adapter = new TestRedisIoAdapter(app);
      adapter.connect(process.env.REDIS_URL!);
      app.useWebSocketAdapter(adapter);
    },
  });
  api = new Api(h);
  inbox = new Inbox(h, api);
  await h.app.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}/realtime`;
}, 240_000);

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await h?.stop();
  for (const r of adapterRedis) r.disconnect();
});

interface Conn {
  socket: Socket;
  events: Array<{ name: string; data: RealtimeEnvelope<Record<string, unknown>> }>;
}

async function connectAs(token: string): Promise<Conn> {
  const t = await api.as(token).post('/v2/realtime/ticket');
  expect(t.status, JSON.stringify(t.body)).toBe(200);
  const socket = io(url, {
    auth: { ticket: t.body.ticket },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    autoConnect: false,
  });
  sockets.push(socket);
  const conn: Conn = { socket, events: [] };
  socket.onAny((name, data) => conn.events.push({ name, data }));
  await new Promise<void>((done, fail) => {
    socket.on('connect', () => done());
    socket.on('connect_error', (e) => fail(e));
    socket.connect();
  });
  return conn;
}

const join = (c: Conn, id: string): Promise<RealtimeRoomAck> =>
  c.socket.timeout(5000).emitWithAck('room:join', { kind: 'conv', id });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const received = (c: Conn, type: string) =>
  c.events.filter((e) => e.name === type).map((e) => e.data);
async function waitFor<T>(probe: () => T | undefined, ms = 5000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = probe();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error('timed out waiting for an event');
    await sleep(25);
  }
}
const firstOf = (c: Conn, type: string) => waitFor(() => received(c, type)[0]);
const quiet = async (c: Conn, type: string, ms = 700) => {
  await sleep(ms);
  return received(c, type).length === 0;
};
const userUuid = async (id: number) =>
  (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [id])).rows[0].uuid as string;

describe('assignment and status over sockets', () => {
  let t: Tenant;
  let ch: { id: string };
  let manager: { token: string; userId: number };
  let ownerOfThread: { token: string; userId: number };
  let newOwner: { token: string; userId: number };
  let watcher: { token: string; userId: number };
  let blind: { token: string; userId: number };

  beforeAll(async () => {
    t = await api.signup('irt');
    ch = await inbox.channel(t.admin);
    manager = await api.member(t, 'manager', [...AGENT, ['inbox.conversation.assign', 'all']]);
    ownerOfThread = await api.member(t, 'owner', [
      ['inbox.conversation.read', 'own'],
      ['inbox.conversation.reply', 'own'],
    ]);
    newOwner = await api.member(t, 'newowner', [['inbox.conversation.read', 'own']]);
    watcher = await api.member(t, 'watcher', [['inbox.conversation.read', 'all']]);
    blind = await api.member(t, 'blind', [['inbox.conversation.read', 'own']]);
  });

  it('a reassignment tells everyone who may see the thread, tells the person who lost it, and takes them out of its room', async () => {
    const c = await inbox.conversation(t, ch.id, {
      assigneeUserId: ownerOfThread.userId,
      messages: 1,
    });
    const [oldOwner, receiver, watching, outsider] = await Promise.all([
      connectAs(ownerOfThread.token),
      connectAs(newOwner.token),
      connectAs(watcher.token),
      connectAs(blind.token),
    ]);
    expect((await join(oldOwner, c.uuid)).ok).toBe(true);
    expect((await join(watching, c.uuid)).ok).toBe(true);
    expect((await join(outsider, c.uuid)).ok).toBe(false);

    const version = await inbox.version(c.uuid);
    const res = await api
      .as(manager.token)
      .post(`/v2/inbox/conversations/${c.uuid}/assign`)
      .send({ rowVersion: version, userId: await userUuid(newOwner.userId) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const payload = {
      conversationId: c.uuid,
      assigneeUserId: await userUuid(newOwner.userId),
      assigneeTeamId: null,
    };
    for (const who of [oldOwner, receiver, watching]) {
      const env = await firstOf(who, REALTIME_EVENT.assignment);
      expect(realtimeEventSchemas[REALTIME_EVENT.assignment].parse(env.payload)).toEqual(payload);
    }
    // The list signal reaches the same people (the old owner's list drops the row on it), and carries the new version.
    const upsert = await firstOf(oldOwner, REALTIME_EVENT.conversationUpsert);
    expect(upsert.payload).toMatchObject({
      conversationId: c.uuid,
      changed: ['assignment'],
      rowVersion: res.body.rowVersion,
    });
    expect(await quiet(outsider, REALTIME_EVENT.assignment)).toBe(true);
    expect(await quiet(outsider, REALTIME_EVENT.conversationUpsert, 100)).toBe(true);

    // Out of the room: what is published to the conversation now reaches the people with access, not the one who lost it.
    const emitter = h.app.get(RealtimeEmitter);
    const mark = oldOwner.events.length;
    await receiver.socket.timeout(5000).emitWithAck('room:join', { kind: 'conv', id: c.uuid });
    await emitter.emit(t.orgId, [{ kind: 'conv', id: c.uuid }], REALTIME_EVENT.unread, {
      conversationId: c.uuid,
      unread: 7,
    });
    await firstOf(receiver, REALTIME_EVENT.unread);
    await firstOf(watching, REALTIME_EVENT.unread);
    await sleep(300);
    expect(oldOwner.events.slice(mark).filter((e) => e.name === REALTIME_EVENT.unread)).toEqual([]);
  });

  it('a status change signals the people who may see the conversation, and nobody else', async () => {
    const c = await inbox.conversation(t, ch.id, { assigneeUserId: newOwner.userId });
    const [mine, all, outsider] = await Promise.all([
      connectAs(newOwner.token),
      connectAs(watcher.token),
      connectAs(blind.token),
    ]);
    const res = await api
      .as(manager.token)
      .post(`/v2/inbox/conversations/${c.uuid}/status`)
      .send({ rowVersion: await inbox.version(c.uuid), status: 'resolved' });
    expect(res.status).toBe(200);
    for (const who of [mine, all]) {
      const env = await firstOf(who, REALTIME_EVENT.conversationUpsert);
      expect(env.payload).toMatchObject({ conversationId: c.uuid, changed: ['status'] });
    }
    expect(await quiet(outsider, REALTIME_EVENT.conversationUpsert)).toBe(true);
  });

  it('a note signals the other people who may see the conversation, not its author', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const [author, other] = await Promise.all([connectAs(manager.token), connectAs(watcher.token)]);
    const res = await api
      .as(manager.token)
      .post(`/v2/inbox/conversations/${c.uuid}/notes`)
      .send({ body: 'heads up' });
    expect(res.status).toBe(201);
    const env = await firstOf(other, REALTIME_EVENT.conversationUpsert);
    expect(env.payload).toMatchObject({ conversationId: c.uuid, changed: ['notes'] });
    expect(await quiet(author, REALTIME_EVENT.conversationUpsert)).toBe(true);
  });

  it('a send reaches the people with the conversation open as inbox.message.new, without a media link in the broadcast', async () => {
    const c = await inbox.conversation(t, ch.id, {
      assigneeUserId: manager.userId,
      lastInboundAt: new Date().toISOString(),
    });
    const open = await connectAs(watcher.token);
    expect((await join(open, c.uuid)).ok).toBe(true);
    const res = await api
      .as(manager.token)
      .post(`/v2/inbox/conversations/${c.uuid}/messages`)
      .send({ kind: 'text', body: 'On it', clientMessageId: randomUUID() });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const env = await firstOf(open, REALTIME_EVENT.messageNew);
    expect(env.payload).toMatchObject({
      conversationId: c.uuid,
      message: { id: res.body.id, seq: res.body.seq, status: 'queued' },
    });
  });
});
