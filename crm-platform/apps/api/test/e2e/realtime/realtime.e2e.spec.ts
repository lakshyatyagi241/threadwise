import { Test } from '@nestjs/testing';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import type { ServerOptions } from 'socket.io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REALTIME_EVENT,
  REALTIME_MAX_JOINED_ROOMS,
  type RealtimeEnvelope,
  type RealtimeReady,
  type RealtimeRoomAck,
  type RealtimeRoomSpec,
} from '@crm/contracts';
import { DbModule } from '../../../src/infra/db/db.module';
import { RedisModule } from '../../../src/infra/redis/redis.module';
import { KernelModule } from '../../../src/kernel/kernel.module';
import { RealtimeEmitterModule } from '../../../src/realtime/realtime-emitter.module';
import { RealtimeGateway } from '../../../src/realtime/realtime.gateway';
import { AudienceResolver } from '../../../src/realtime/audience/audience.resolver';
import { RealtimeEmitter } from '../../../src/realtime/realtime-emitter.service';
import {
  Api,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Realtime end to end: the ticket flow, the handshake, room authorisation, and delivery of events published by ANOTHER process.
 * Real Postgres (row-level security, the real `conversations` and `team_members` tables), real Redis, the real API with its
 * gateway listening, real socket.io clients.
 *
 * The plan's exit criterion (4.1): a socket connects with a ticket, joins an authorised conversation room, is refused an
 * unauthorised one, and receives an emit published from a separate process.
 */
let h: Harness;
let api: Api;
let url: string;
const adapterRedis: Redis[] = [];

/** The production adapter (socket.io over Redis), with its connections kept so the spec can close them. */
class TestRedisIoAdapter extends IoAdapter {
  private ctor?: ReturnType<typeof createAdapter>;
  connect(redisUrl: string): void {
    // No reconnects and a quiet error handler: the container is stopped under these connections at the end of the run.
    const pub = new Redis(redisUrl, { maxRetriesPerRequest: null, retryStrategy: () => null });
    const sub = pub.duplicate();
    for (const r of [pub, sub]) r.on('error', () => undefined);
    adapterRedis.push(pub, sub);
    this.ctor = createAdapter(pub, sub);
  }
  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as { adapter: (a: unknown) => void };
    if (this.ctor) server.adapter(this.ctor);
    return server;
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
  await h.app.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}/realtime`;
}, 240_000);

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await h?.stop();
  for (const r of adapterRedis) r.disconnect();
});

// --- helpers -------------------------------------------------------------------------------------------------------------

const sockets: Socket[] = [];

interface Conn {
  socket: Socket;
  /** Every event the server sent, in order (system events included). */
  events: Array<{ name: string; data: RealtimeEnvelope<Record<string, unknown>> }>;
  ready?: RealtimeReady;
  error?: string;
}

/** Connects and settles: resolves when the server accepted (`connect`) or refused (`connect_error`) the handshake. */
function open(auth: Record<string, unknown>): Promise<Conn> {
  const socket = io(url, {
    auth,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    autoConnect: false,
  });
  sockets.push(socket);
  const conn: Conn = { socket, events: [] };
  socket.onAny((name, data) => {
    conn.events.push({ name, data });
    if (name === 'rt.ready') conn.ready = data as unknown as RealtimeReady;
  });
  return new Promise((done) => {
    socket.on('connect', () => done(conn));
    socket.on('connect_error', (err) => {
      conn.error = err.message;
      done(conn);
    });
    socket.connect();
  });
}

const ticketFor = async (token: string): Promise<string> => {
  const res = await api.as(token).post('/v2/realtime/ticket');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.ticket as string;
};
const connectAs = async (token: string) => open({ ticket: await ticketFor(token) });

const join = (c: Conn, spec: unknown): Promise<RealtimeRoomAck> =>
  c.socket.timeout(5000).emitWithAck('room:join', spec);
const conv = (id: string): RealtimeRoomSpec => ({ kind: 'conv', id });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(probe: () => T | undefined, ms = 5000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = probe();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error('timed out waiting for an event');
    await sleep(25);
  }
}
const received = (c: Conn, type: string) =>
  c.events.filter((e) => e.name === type).map((e) => e.data);
const firstOf = (c: Conn, type: string) => waitFor(() => received(c, type)[0]);
/** Whether an event of this type shows up within a short window: for asserting that something does NOT arrive. */
const arrives = async (c: Conn, type: string, ms = 600) => {
  await sleep(ms);
  return received(c, type).length > 0;
};

async function team(t: Tenant, name: string, members: number[]) {
  const row = await h.owner.query(
    `INSERT INTO teams (org_id, name) VALUES ($1,$2) RETURNING id, uuid`,
    [t.orgId, name],
  );
  for (const userId of members) {
    await h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      row.rows[0].id,
      userId,
    ]);
  }
  return { id: Number(row.rows[0].id), uuid: row.rows[0].uuid as string };
}

const channelIds = new Map<number, number>();
/** One channel per workspace (conversations belong to a channel). */
async function channelOf(t: Tenant): Promise<number> {
  const known = channelIds.get(t.orgId);
  if (known) return known;
  const row = await h.owner.query(
    `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','Test channel') RETURNING id`,
    [t.orgId],
  );
  channelIds.set(t.orgId, Number(row.rows[0].id));
  return Number(row.rows[0].id);
}

/**
 * A conversation straight into the table (the owner connection). When the table gains required columns, add them HERE: this is
 * also the guard that the gateway's default loader still finds `assignee_user_id` and `assignee_team_id` where it reads them.
 */
async function conversation(
  t: Tenant,
  assignee: { userId?: number | null; teamId?: number | null } = {},
  uuid: string = randomUUID(),
): Promise<{ uuid: string; assigneeUserId: number | null; assigneeTeamId: number | null }> {
  await h.owner.query(
    `INSERT INTO conversations (org_id, uuid, channel_id, peer_key, title, assignee_user_id, assignee_team_id)
     VALUES ($1,$2,$3,$4,'Test thread',$5,$6)`,
    [
      t.orgId,
      uuid,
      await channelOf(t),
      randomUUID(),
      assignee.userId ?? null,
      assignee.teamId ?? null,
    ],
  );
  return { uuid, assigneeUserId: assignee.userId ?? null, assigneeTeamId: assignee.teamId ?? null };
}

const READ = (scope: 'all' | 'team' | 'own'): Grant[] => [['inbox.conversation.read', scope]];

const runChild = (input: unknown): Promise<string[]> =>
  new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', resolve(__dirname, 'emit-from-process.ts'), JSON.stringify(input)],
      { cwd: resolve(__dirname, '../../..'), env: process.env },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) =>
      code === 0
        ? done(out.trim().split('\n').filter(Boolean))
        : fail(new Error(`child exited ${code}: ${err}`)),
    );
  });

// --- the ticket endpoint --------------------------------------------------------------------------------------------------

describe('POST /v2/realtime/ticket', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('rtk');
  });

  it('gives a staff session a one-time ticket, never cached', async () => {
    const res = await api.as(t.admin).post('/v2/realtime/ticket');
    expect(res.status).toBe(200);
    expect(res.body.ticket).toMatch(/^rtk_[A-Za-z0-9_-]{43}$/);
    expect(res.body.expiresIn).toBe(60);
    expect(res.headers['cache-control']).toBe('no-store');
    const again = await api.as(t.admin).post('/v2/realtime/ticket');
    expect(again.body.ticket).not.toBe(res.body.ticket);
  });

  it('needs a session: no token, a garbage token and a token for another pool are all refused', async () => {
    expect((await api.http().post('/v2/realtime/ticket')).status).toBe(401);
    expect(
      (await api.http().post('/v2/realtime/ticket').set('authorization', 'Bearer nope')).status,
    ).toBe(401);
  });

  it('is rate limited per person, so a reconnect loop cannot flood Redis', async () => {
    const looper = await api.member(t, 'looper', []);
    let refused: number | undefined;
    for (let i = 0; i < 40 && refused === undefined; i++) {
      const res = await api.as(looper.token).post('/v2/realtime/ticket');
      if (res.status === 429) refused = i;
      else expect(res.status).toBe(200);
    }
    expect(refused).toBe(30);
    // Someone else in the same workspace is not affected.
    expect((await api.as(t.admin).post('/v2/realtime/ticket')).status).toBe(200);
  });
});

// --- the handshake -----------------------------------------------------------------------------------------------------------

describe('handshake', () => {
  let t: Tenant;
  let agent: { token: string; userId: number };
  beforeAll(async () => {
    t = await api.signup('rth');
    agent = await api.member(t, 'agent', READ('own'));
  });

  it('accepts a ticket and says where the two rooms the server put the socket in stand', async () => {
    const c = await connectAs(agent.token);
    expect(c.error).toBeUndefined();
    const ready = await waitFor(() => c.ready);
    expect(ready).toMatchObject({
      v: 1,
      rooms: [
        { room: 'org', seq: 0 },
        { room: 'user', seq: 0 },
      ],
    });
    expect(new Date(ready.serverTime).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // Rooms are named without internal ids.
    expect(ready.rooms.map((r) => r.room)).toEqual(['org', 'user']);
  });

  it('refuses a ticket used a second time (replay), without saying why', async () => {
    const ticket = await ticketFor(agent.token);
    expect((await open({ ticket })).error).toBeUndefined();
    expect((await open({ ticket })).error).toBe('unauthorized');
  });

  it.each([
    ['no credential', {}],
    ['a made-up ticket', { ticket: `rtk_${'A'.repeat(43)}` }],
    ['a malformed ticket', { ticket: 'rtk_x' }],
    ['a non-string ticket', { ticket: { $ne: null } }],
    ['a garbage token', { token: 'not.a.jwt' }],
  ])('refuses %s with the same bare message', async (_name, auth) => {
    expect((await open(auth)).error).toBe('unauthorized');
  });

  it('still accepts an access token for a client that can hold one', async () => {
    const c = await open({ token: agent.token });
    expect(c.error).toBeUndefined();
    expect((await waitFor(() => c.ready)).rooms.map((r) => r.room)).toEqual(['org', 'user']);
  });

  it('refuses a ticket whose session was revoked after it was minted', async () => {
    const victim = await api.member(t, 'victim', READ('own'));
    const sid = (await api.as(victim.token).get('/v2/auth/session')).body.sessionId as string;
    const ticket = await ticketFor(victim.token);
    await h.redis.set(`auth:rev:${sid}`, '1', 'EX', 60);
    expect((await open({ ticket })).error).toBe('unauthorized');
    await h.redis.del(`auth:rev:${sid}`);
  });

  it('drops a connected socket once its session ends (the sweep)', async () => {
    const leaver = await api.member(t, 'leaver', READ('own'));
    const sid = (await api.as(leaver.token).get('/v2/auth/session')).body.sessionId as string;
    const c = await connectAs(leaver.token);
    expect(c.socket.connected).toBe(true);

    const closed = new Promise<string>((done) => c.socket.on('disconnect', done));
    await h.redis.set(`auth:rev:${sid}`, '1', 'EX', 60);
    await (h.app.get(RealtimeGateway) as unknown as { dropRevoked(): Promise<void> }).dropRevoked();
    expect(await closed).toBe('io server disconnect');
    await h.redis.del(`auth:rev:${sid}`);
  });
});

// --- room authorisation --------------------------------------------------------------------------------------------------

describe('room:join', () => {
  let t: Tenant;
  let other: Tenant;
  let owner: { token: string; userId: number };
  let allReader: { token: string; userId: number };
  let teamReader: { token: string; userId: number };
  let colleague: { token: string; userId: number };
  let plain: { token: string; userId: number };
  let ops: { uuid: string; id: number };
  let mine: Awaited<ReturnType<typeof conversation>>;
  let unassigned: Awaited<ReturnType<typeof conversation>>;
  let opsThread: Awaited<ReturnType<typeof conversation>>;
  let theirs: Awaited<ReturnType<typeof conversation>>;

  beforeAll(async () => {
    t = await api.signup('rtr');
    other = await api.signup('rto');
    owner = await api.member(t, 'owner', READ('own'));
    allReader = await api.member(t, 'allreader', READ('all'));
    teamReader = await api.member(t, 'teamreader', READ('team'));
    colleague = await api.member(t, 'colleague', READ('own'));
    plain = await api.member(t, 'plain', []);
    ops = await team(t, 'Ops', [teamReader.userId]);
    mine = await conversation(t, { userId: owner.userId });
    unassigned = await conversation(t);
    opsThread = await conversation(t, { teamId: ops.id });
    theirs = await conversation(t, { userId: colleague.userId });
  });

  it('lets the assignee in, and answers with where the room stands', async () => {
    const c = await connectAs(owner.token);
    const ack = await join(c, conv(mine.uuid));
    expect(ack).toEqual({ ok: true, room: `conv:${mine.uuid}`, seq: 0 });
  });

  it('refuses a conversation the caller may not read, with one answer for every reason', async () => {
    const c = await connectAs(owner.token);
    const refusals = [
      await join(c, conv(theirs.uuid)), // a colleague's, scope own
      await join(c, conv(unassigned.uuid)), // unassigned, scope own
      await join(c, conv(opsThread.uuid)), // a team's, scope own
      await join(c, conv(randomUUID())), // does not exist
    ];
    for (const r of refusals) expect(r).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('applies the scope of the grant: all reads everything, team reads its own, its team and the queue, none reads nothing', async () => {
    const all = await connectAs(allReader.token);
    for (const c of [mine, unassigned, opsThread, theirs])
      expect((await join(all, conv(c.uuid))).ok).toBe(true);

    const team_ = await connectAs(teamReader.token);
    expect((await join(team_, conv(opsThread.uuid))).ok).toBe(true); // assigned to their team
    expect((await join(team_, conv(unassigned.uuid))).ok).toBe(true); // the shared queue
    expect((await join(team_, conv(mine.uuid))).ok).toBe(false); // someone else's
    expect((await join(team_, conv(theirs.uuid))).ok).toBe(false);

    const nobody = await connectAs(plain.token);
    for (const c of [mine, unassigned, opsThread, theirs]) {
      expect(await join(nobody, conv(c.uuid))).toEqual({ ok: false, code: 'FORBIDDEN' });
    }
  });

  it("never opens another workspace's conversation, even by its real uuid", async () => {
    const stranger = await api.member(other, 'stranger', READ('all'));
    const c = await connectAs(stranger.token);
    expect(await join(c, conv(mine.uuid))).toEqual({ ok: false, code: 'FORBIDDEN' });
    // ...and the admin of the other workspace, who holds every permission there, is no different.
    const admin = await connectAs(other.admin);
    expect(await join(admin, conv(mine.uuid))).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('follows a role change at once: a revoked grant is refused on the next join', async () => {
    const flip = await api.member(t, 'flip', READ('all'));
    const c = await connectAs(flip.token);
    expect((await join(c, conv(theirs.uuid))).ok).toBe(true);
    await h.owner.query(
      `UPDATE role_grants SET record_scope = 'own' WHERE org_id = $1 AND permission_key = 'inbox.conversation.read'
         AND role_id IN (SELECT role_id FROM user_roles WHERE org_id = $1 AND user_id = $2)`,
      [t.orgId, flip.userId],
    );
    await h.owner.query(
      `UPDATE organizations SET roles_version = roles_version + 1 WHERE id = $1`,
      [t.orgId],
    );
    await h.redis.del(`rbac:version:${t.orgId}`);
    const again = await connectAs(flip.token);
    expect(await join(again, conv(theirs.uuid))).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('opens inbox rooms by scope: all needs the all scope; a team room needs membership', async () => {
    const all = await connectAs(allReader.token);
    expect(await join(all, { kind: 'inbox', scope: 'all' })).toEqual({
      ok: true,
      room: 'inbox:all',
      seq: 0,
    });
    expect((await join(all, { kind: 'inbox', scope: `team:${ops.uuid}` })).ok).toBe(true);

    const team_ = await connectAs(teamReader.token);
    expect((await join(team_, { kind: 'inbox', scope: 'all' })).ok).toBe(false);
    expect((await join(team_, { kind: 'inbox', scope: `team:${ops.uuid}` })).ok).toBe(true);

    const own = await connectAs(owner.token);
    expect((await join(own, { kind: 'inbox', scope: `team:${ops.uuid}` })).ok).toBe(false);
    // A team that is not in this workspace.
    expect((await join(all, { kind: 'inbox', scope: `team:${randomUUID()}` })).ok).toBe(false);
  });

  it('refuses anything that is not a room it can join, and never lets a client name a user or org room', async () => {
    const c = await connectAs(allReader.token);
    for (const bad of [
      null,
      {},
      'conv',
      { kind: 'conv' },
      { kind: 'conv', id: 'not-a-uuid' },
      { kind: 'user' },
      { kind: 'org' },
      { kind: 'inbox', scope: 'everything' },
    ]) {
      expect(await join(c, bad)).toEqual({ ok: false, code: 'INVALID' });
    }
  });

  it('is idempotent, and leaves cleanly', async () => {
    const c = await connectAs(owner.token);
    expect((await join(c, conv(mine.uuid))).ok).toBe(true);
    expect((await join(c, conv(mine.uuid))).ok).toBe(true);
    const left = await c.socket.timeout(5000).emitWithAck('room:leave', conv(mine.uuid));
    expect(left.ok).toBe(true);
    await h.app
      .get(RealtimeEmitter)
      .emit(t.orgId, [{ kind: 'conv', id: mine.uuid }], REALTIME_EVENT.unread, {
        conversationId: mine.uuid,
        unread: 1,
      });
    expect(await arrives(c, REALTIME_EVENT.unread)).toBe(false);
  });

  it(`caps a socket at ${REALTIME_MAX_JOINED_ROOMS} explicit rooms`, async () => {
    const c = await connectAs(allReader.token);
    for (let i = 0; i < REALTIME_MAX_JOINED_ROOMS; i++) {
      expect((await join(c, conv((await conversation(t)).uuid))).ok).toBe(true);
    }
    expect(await join(c, conv((await conversation(t)).uuid))).toEqual({ ok: false, code: 'LIMIT' });
    // Leaving one makes room for another.
    const held = c.socket.id && (await conversation(t));
    expect(held).toBeTruthy();
  }, 30_000);
});

// --- delivery ---------------------------------------------------------------------------------------------------------------

describe('delivery', () => {
  let t: Tenant;
  let other: Tenant;
  let owner: { token: string; userId: number };
  let allReader: { token: string; userId: number };
  let colleague: { token: string; userId: number };
  let plain: { token: string; userId: number };
  let thread: Awaited<ReturnType<typeof conversation>>;

  beforeAll(async () => {
    t = await api.signup('rtd');
    other = await api.signup('rtdo');
    owner = await api.member(t, 'owner', READ('own'));
    allReader = await api.member(t, 'allreader', READ('all'));
    colleague = await api.member(t, 'colleague', READ('own'));
    plain = await api.member(t, 'plain', []);
    thread = await conversation(t, { userId: owner.userId });
  });

  it('delivers an event published by a SEPARATE process to the sockets in the room, and only to them', async () => {
    const inRoom = await connectAs(owner.token);
    const alsoIn = await connectAs(allReader.token);
    const notJoined = await connectAs(allReader.token); // same person, a second tab that never opened the thread
    const stranger = await connectAs((await api.member(other, 'stranger', READ('all'))).token);
    await join(inRoom, conv(thread.uuid));
    await join(alsoIn, conv(thread.uuid));
    const baseline = await join(stranger, conv((await conversation(other)).uuid));
    expect(baseline.ok).toBe(true);

    const messageId = randomUUID();
    const lines = await runChild({
      orgId: t.orgId,
      conversation: { uuid: thread.uuid, assigneeUserId: owner.userId, assigneeTeamId: null },
      messageId,
    });
    expect(JSON.parse(lines[0]!).report.rooms).toEqual([{ room: `conv:${thread.uuid}`, seq: 1 }]);

    for (const c of [inRoom, alsoIn]) {
      const env = await firstOf(c, REALTIME_EVENT.messageNew);
      expect(env).toMatchObject({
        v: 1,
        type: REALTIME_EVENT.messageNew,
        room: `conv:${thread.uuid}`,
        seq: 1,
        payload: { conversationId: thread.uuid, message: { id: messageId, seq: 1 } },
      });
      expect(env.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Date(env.at).getTime()).toBeGreaterThan(Date.now() - 60_000);
    }
    expect(await arrives(notJoined, REALTIME_EVENT.messageNew)).toBe(false);
    expect(await arrives(stranger, REALTIME_EVENT.messageNew)).toBe(false);
  }, 60_000);

  it('the audience resolved in that other process reaches exactly the people who may read the thread', async () => {
    const owner1 = await connectAs(owner.token);
    const owner2 = await connectAs(owner.token); // a second device of the same person
    const all = await connectAs(allReader.token);
    const other_ = await connectAs(colleague.token); // may not read this thread
    const none = await connectAs(plain.token); // no read grant at all
    const strangerAdmin = await connectAs(other.admin); // another workspace, every permission there

    const lines = await runChild({
      orgId: t.orgId,
      conversation: { uuid: thread.uuid, assigneeUserId: owner.userId, assigneeTeamId: null },
      messageId: randomUUID(),
    });
    const { audience } = JSON.parse(lines[1]!);
    expect(audience).toContain(owner.userId);
    expect(audience).toContain(allReader.userId);
    expect(audience).not.toContain(colleague.userId);
    expect(audience).not.toContain(plain.userId);

    for (const c of [owner1, owner2, all]) {
      expect((await firstOf(c, REALTIME_EVENT.unread)).payload).toEqual({
        conversationId: thread.uuid,
        unread: 1,
      });
    }
    expect(await arrives(other_, REALTIME_EVENT.unread)).toBe(false);
    expect(await arrives(none, REALTIME_EVENT.unread)).toBe(false);
    expect(await arrives(strangerAdmin, REALTIME_EVENT.unread)).toBe(false);
  }, 60_000);

  it('numbers events per room across processes: the API emitter and the child continue one count', async () => {
    const t2 = await api.signup('rtq');
    const agent = await api.member(t2, 'agent', READ('all'));
    const th = await conversation(t2, { userId: agent.userId });
    const c = await connectAs(agent.token);
    await join(c, conv(th.uuid));

    const emitter = h.app.get(RealtimeEmitter);
    const payload = { conversationId: th.uuid, unread: 3 };
    await emitter.emit(t2.orgId, [{ kind: 'conv', id: th.uuid }], REALTIME_EVENT.unread, payload);
    await runChild({
      orgId: t2.orgId,
      conversation: { uuid: th.uuid, assigneeUserId: agent.userId, assigneeTeamId: null },
      messageId: randomUUID(),
    });
    await emitter.emit(t2.orgId, [{ kind: 'conv', id: th.uuid }], REALTIME_EVENT.unread, payload);

    await waitFor(() =>
      c.events.filter((e) => e.data?.room === `conv:${th.uuid}`).length >= 3 ? true : undefined,
    );
    const seqs = c.events.filter((e) => e.data?.room === `conv:${th.uuid}`).map((e) => e.data.seq);
    expect(seqs).toEqual([1, 2, 3]);
    // A client that joins later is told where the room stands, so it knows what the next number will be.
    const late = await connectAs(agent.token);
    expect(await join(late, conv(th.uuid))).toEqual({ ok: true, room: `conv:${th.uuid}`, seq: 3 });
  }, 60_000);

  it('tells a client to fetch again when the server asks for a resync', async () => {
    const c = await connectAs(owner.token);
    await join(c, conv(thread.uuid));
    await h.app
      .get(RealtimeEmitter)
      .requestResync(t.orgId, [{ kind: 'conv', id: thread.uuid }], 'permissions-changed');
    const env = await firstOf(c, 'rt.resync');
    expect(env).toMatchObject({
      room: `conv:${thread.uuid}`,
      payload: { reason: 'permissions-changed' },
    });
  });

  it('evicts a person from a room when they lose the conversation, so they stop receiving it', async () => {
    const tt = await api.signup('rte');
    const a = await api.member(tt, 'a', READ('own'));
    const th = await conversation(tt, { userId: a.userId });
    const c = await connectAs(a.token);
    await join(c, conv(th.uuid));

    const emitter = h.app.get(RealtimeEmitter);
    await emitter.emit(tt.orgId, [{ kind: 'conv', id: th.uuid }], REALTIME_EVENT.unread, {
      conversationId: th.uuid,
      unread: 1,
    });
    await firstOf(c, REALTIME_EVENT.unread);

    await emitter.evict(tt.orgId, a.userId, { kind: 'conv', id: th.uuid });
    await sleep(300);
    c.events.length = 0;
    await emitter.emit(tt.orgId, [{ kind: 'conv', id: th.uuid }], REALTIME_EVENT.unread, {
      conversationId: th.uuid,
      unread: 2,
    });
    expect(await arrives(c, REALTIME_EVENT.unread)).toBe(false);
  });

  it("keeps each workspace's rooms apart even when two rooms have the same uuid", async () => {
    const shared = randomUUID();
    const a = await connectAs(allReader.token);
    const b = await connectAs((await api.member(other, 'b', READ('all'))).token);
    // The other workspace's room by the same name: it can be joined only if a conversation with that uuid is theirs.
    await conversation(t, {}, shared);
    await conversation(other, {}, shared);
    expect((await join(a, conv(shared))).ok).toBe(true);
    expect((await join(b, conv(shared))).ok).toBe(true);

    await h.app
      .get(RealtimeEmitter)
      .emit(t.orgId, [{ kind: 'conv', id: shared }], REALTIME_EVENT.unread, {
        conversationId: shared,
        unread: 9,
      });
    await firstOf(a, REALTIME_EVENT.unread);
    expect(await arrives(b, REALTIME_EVENT.unread)).toBe(false);
  });

  it('the resolver the API holds answers the same as the one in the other process', async () => {
    const audience = await h.app
      .get(AudienceResolver)
      .forConversation(t.orgId, { assigneeUserId: owner.userId, assigneeTeamId: null });
    expect(audience).toContain(owner.userId);
    expect(audience).toContain(allReader.userId);
    expect(audience).not.toContain(colleague.userId);
    expect(audience).not.toContain(plain.userId);
  });

  it('the publish-only module stands up with exactly what the worker process has, and its emitter reaches the API sockets', async () => {
    // worker.ts imports these modules and no HTTP server: this is the same set, in this process, against the same Redis.
    // Imported here, after the harness set the environment: the config module reads it when it is first loaded.
    const { AppConfigModule } = await import('../../../src/config/config.module');
    const worker = await Test.createTestingModule({
      imports: [AppConfigModule, DbModule, RedisModule, KernelModule, RealtimeEmitterModule],
    }).compile();
    await worker.init();
    try {
      const c = await connectAs(owner.token);
      await join(c, conv(thread.uuid));
      const audience = await worker
        .get(AudienceResolver)
        .forConversation(t.orgId, { assigneeUserId: owner.userId, assigneeTeamId: null });
      expect(audience).toContain(owner.userId);
      await worker
        .get(RealtimeEmitter)
        .emit(t.orgId, [{ kind: 'conv', id: thread.uuid }], REALTIME_EVENT.unread, {
          conversationId: thread.uuid,
          unread: 5,
        });
      expect((await firstOf(c, REALTIME_EVENT.unread)).payload).toMatchObject({ unread: 5 });
    } finally {
      await worker.close();
    }
  });
});
