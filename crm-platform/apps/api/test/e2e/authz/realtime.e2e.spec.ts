import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import type { ServerOptions } from 'socket.io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REALTIME_EVENT,
  type RealtimeEnvelope,
  type RealtimeReady,
  type RealtimeRoomAck,
} from '@crm/contracts';
import { RealtimeEmitter } from '../../../src/realtime/realtime-emitter.service';
import { RealtimeGateway } from '../../../src/realtime/realtime.gateway';
import { OrgSuspensionService } from '../../../src/modules/auth';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from '../auth-registration-security/harness';
import { operatorToken } from '../install-update-licensing/helpers';
import {
  Api,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Realtime authorization (AUTHZ-076..078): the handshake, room joins, cross-tenant delivery, and what happens to a connected socket
 * when its owner loses access. Real Postgres (restricted role, RLS), real Redis, the real gateway with the production Redis adapter,
 * real socket.io clients, events published through the same `RealtimeEmitter` every producer uses.
 *
 * Findings are kept as FAILING assertions: a test that names a vulnerability stays red until the application is fixed.
 */
let h: Harness;
let api: Api;
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
  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as { adapter: (a: unknown) => void };
    if (this.ctor) server.adapter(this.ctor);
    return server;
  }
}

// --- helpers ------------------------------------------------------------------------------------------------------------

interface Conn {
  socket: Socket;
  events: Array<{ name: string; data: RealtimeEnvelope<Record<string, unknown>> }>;
  ready?: RealtimeReady;
  error?: string;
  closedAt?: number;
  closeReason?: string;
}

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
  socket.on('disconnect', (reason) => {
    conn.closedAt = Date.now();
    conn.closeReason = reason;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ticketFor = async (token: string): Promise<string> => {
  const res = await api.as(token).post('/v2/realtime/ticket');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.ticket as string;
};
const connectAs = async (token: string) => {
  const c = await open({ ticket: await ticketFor(token) });
  expect(c.error, 'handshake with a valid ticket').toBeUndefined();
  await waitFor(() => c.ready);
  return c;
};
const join = (c: Conn, spec: unknown): Promise<RealtimeRoomAck> =>
  c.socket.timeout(5000).emitWithAck('room:join', spec);
const conv = (id: string) => ({ kind: 'conv', id });

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
const arrives = async (c: Conn, type: string, ms = 700) => {
  await sleep(ms);
  return received(c, type).length > 0;
};
/** Every business event a socket got (system events like rt.ready are not business events). */
const businessEvents = (c: Conn) => c.events.filter((e) => !e.name.startsWith('rt.'));

const READ = (scope: 'all' | 'team' | 'own'): Grant[] => [['inbox.conversation.read', scope]];

const channelIds = new Map<number, number>();
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
async function conversation(t: Tenant, assigneeUserId: number | null = null) {
  const uuid = randomUUID();
  await h.owner.query(
    `INSERT INTO conversations (org_id, uuid, channel_id, peer_key, title, assignee_user_id)
     VALUES ($1,$2,$3,$4,'Test thread',$5)`,
    [t.orgId, uuid, await channelOf(t), randomUUID(), assigneeUserId],
  );
  return uuid;
}
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
  return row.rows[0].uuid as string;
}

let emitter: RealtimeEmitter;
const emitUnread = (orgId: number, roomId: string, unread = 1) =>
  emitter.emit(orgId, [{ kind: 'conv', id: roomId }], REALTIME_EVENT.unread, {
    conversationId: roomId,
    unread,
  });

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
  emitter = h.app.get(RealtimeEmitter);
}, 240_000);

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await h?.stop();
  for (const r of adapterRedis) r.disconnect();
});

// --- AUTHZ-076: the handshake ------------------------------------------------------------------------------------------------

describe('AUTHZ-076 handshake', () => {
  let A: Tenant;
  let B: Tenant;
  let agent: { token: string; userId: number };
  let operator = '';

  beforeAll(async () => {
    operator = await operatorToken(h, OPERATOR_EMAIL, OPERATOR_PASSWORD);
    A = await api.signup('rz-a');
    B = await api.signup('rz-b');
    agent = await api.member(A, 'agent', READ('own'));
  });

  it('AUTHZ-076 positive: a fresh one-time ticket connects and the server puts the socket in its own org and user rooms only', async () => {
    const c = await connectAs(agent.token);
    expect(c.ready?.rooms.map((r) => r.room)).toEqual(['org', 'user']);
  });

  it.each([
    ['no credential', {}],
    ['an empty ticket', { ticket: '' }],
    ['a made-up well-formed ticket', { ticket: `rtk_${'A'.repeat(43)}` }],
    ['a ticket with a different prefix', { ticket: `xyz_${'A'.repeat(43)}` }],
    ['an object instead of a string', { ticket: { $ne: null } }],
    ['an array of tickets', { ticket: [`rtk_${'A'.repeat(43)}`] }],
    ['a garbage bearer token', { token: 'not.a.jwt' }],
    ['an empty bearer token', { token: '' }],
    ['a token-shaped object', { token: { sub: 1 } }],
  ])('AUTHZ-076 negative: %s is refused with the bare "unauthorized"', async (_name, auth) => {
    expect((await open(auth)).error).toBe('unauthorized');
  });

  it('AUTHZ-076 negative: a one-time ticket works once; the replay is refused', async () => {
    const ticket = await ticketFor(agent.token);
    expect((await open({ ticket })).error).toBeUndefined();
    expect((await open({ ticket })).error).toBe('unauthorized');
  });

  it('AUTHZ-076 negative: an expired ticket is refused', async () => {
    const ticket = await ticketFor(agent.token);
    const key = `rt:ticket:${createHash('sha256').update(ticket).digest('hex')}`;
    expect(await h.redis.pexpire(key, 400)).toBe(1);
    await sleep(900);
    expect((await open({ ticket })).error).toBe('unauthorized');
  });

  it('AUTHZ-076 negative: a ticket cannot be raced into two sockets', async () => {
    const ticket = await ticketFor(agent.token);
    const both = await Promise.all([open({ ticket }), open({ ticket })]);
    expect(both.filter((c) => c.error === undefined)).toHaveLength(1);
  });

  it('AUTHZ-076 negative: the ticket route itself needs a staff session (anon, garbage, platform operator)', async () => {
    expect((await api.http().post('/v2/realtime/ticket')).status).toBe(401);
    expect(
      (await api.http().post('/v2/realtime/ticket').set('authorization', 'Bearer nope')).status,
    ).toBe(401);
    expect([401, 403]).toContain((await api.as(operator).post('/v2/realtime/ticket')).status);
  });

  it('AUTHZ-076 negative: a platform operator access token is not accepted as a socket credential', async () => {
    expect((await open({ token: operator })).error).toBe('unauthorized');
  });

  it('AUTHZ-076 negative: a tampered access token (payload edited, signature kept) is refused', async () => {
    const [head, body, sig] = agent.token.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    claims.org = B.orgId;
    const forged = `${head}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`;
    expect((await open({ token: forged })).error).toBe('unauthorized');
    expect((await open({ token: agent.token })).error).toBeUndefined();
  });

  it('AUTHZ-076 negative: a session revoked after the ticket was minted is refused at the handshake', async () => {
    const victim = await api.member(A, 'victim', READ('own'));
    const sid = (await api.as(victim.token).get('/v2/auth/session')).body.sessionId as string;
    const ticket = await ticketFor(victim.token);
    await h.redis.set(`auth:rev:${sid}`, '1', 'EX', 60);
    expect((await open({ ticket })).error).toBe('unauthorized');
    await h.redis.del(`auth:rev:${sid}`);
  });

  it('AUTHZ-076 positive and negative: the ticket carries ITS tenant; A org events reach A and never B, and vice versa', async () => {
    const a = await connectAs(A.admin);
    const b = await connectAs(B.admin);
    await emitter.emit(A.orgId, [{ kind: 'org' }], REALTIME_EVENT.callChanged, {
      callId: randomUUID(),
    });
    await waitFor(() => received(a, REALTIME_EVENT.callChanged)[0]);
    expect(await arrives(b, REALTIME_EVENT.callChanged)).toBe(false);

    await emitter.emit(B.orgId, [{ kind: 'org' }], REALTIME_EVENT.callChanged, {
      callId: randomUUID(),
    });
    await waitFor(() => received(b, REALTIME_EVENT.callChanged)[0]);
    expect(received(a, REALTIME_EVENT.callChanged)).toHaveLength(1);
  });

  it('AUTHZ-076 negative: client-supplied tenant hints in the handshake are ignored (identity comes from the ticket only)', async () => {
    const ticket = await ticketFor(agent.token);
    const c = await open({
      ticket,
      orgId: B.orgId,
      org: B.orgId,
      userId: B.adminUserId,
      'x-org-id': B.orgId,
    });
    expect(c.error).toBeUndefined();
    await emitter.emit(B.orgId, [{ kind: 'org' }], REALTIME_EVENT.callChanged, {
      callId: randomUUID(),
    });
    expect(await arrives(c, REALTIME_EVENT.callChanged)).toBe(false);
    await emitter.emit(A.orgId, [{ kind: 'org' }], REALTIME_EVENT.callChanged, {
      callId: randomUUID(),
    });
    await waitFor(() => received(c, REALTIME_EVENT.callChanged)[0]);
  });
});

// --- AUTHZ-077: rooms and delivery across tenants ------------------------------------------------------------------------------

describe('AUTHZ-077 rooms and cross-tenant delivery', () => {
  let A: Tenant;
  let B: Tenant;
  let ownerA: { token: string; userId: number };
  let colleagueA: { token: string; userId: number };
  let plainA: { token: string; userId: number };
  let allReaderB: { token: string; userId: number };
  let convA: string;
  let convOfColleagueA: string;
  let convB: string;
  let teamA: string;

  beforeAll(async () => {
    A = await api.signup('rr-a');
    B = await api.signup('rr-b');
    ownerA = await api.member(A, 'owner', READ('own'));
    colleagueA = await api.member(A, 'colleague', READ('own'));
    plainA = await api.member(A, 'plain', []);
    allReaderB = await api.member(B, 'allreader', READ('all'));
    convA = await conversation(A, ownerA.userId);
    convOfColleagueA = await conversation(A, colleagueA.userId);
    convB = await conversation(B, null);
    teamA = await team(A, 'Ops', [ownerA.userId]);
  });

  it('AUTHZ-077 positive: the assignee joins their conversation room and gets its events', async () => {
    const c = await connectAs(ownerA.token);
    const ack = await join(c, conv(convA));
    expect(ack).toMatchObject({ ok: true, room: `conv:${convA}` });
    await emitUnread(A.orgId, convA, 4);
    expect((await waitFor(() => received(c, REALTIME_EVENT.unread)[0])).payload).toEqual({
      conversationId: convA,
      unread: 4,
    });
  });

  it('AUTHZ-077 positive: a tenant B reader joins B own conversation (the foreign-id refusals below are not a broken join)', async () => {
    const c = await connectAs(allReaderB.token);
    expect(await join(c, conv(convB))).toMatchObject({ ok: true });
  });

  it('AUTHZ-077 negative: tenant B (admin and an all-scope reader) cannot join A conversation room by uuid, case, padding or alias', async () => {
    const adminB = await connectAs(B.admin);
    const readerB = await connectAs(allReaderB.token);
    const variants: unknown[] = [
      conv(convA),
      conv(convA.toUpperCase()),
      { ...conv(convA), orgId: A.orgId },
      { ...conv(convA), org: A.orgId, tenant: A.orgId },
      { kind: 'conv', id: `${convA} ` },
      { kind: 'conv', id: ` ${convA}` },
      { kind: 'conv', id: `${convA}\n` },
    ];
    for (const c of [adminB, readerB]) {
      for (const spec of variants) {
        const ack = await join(c, spec);
        expect(ack.ok, JSON.stringify(spec)).toBe(false);
      }
    }
    await emitUnread(A.orgId, convA, 9);
    expect(await arrives(adminB, REALTIME_EVENT.unread)).toBe(false);
    expect(await arrives(readerB, REALTIME_EVENT.unread)).toBe(false);
  });

  it('AUTHZ-077 negative: tenant B cannot join A team inbox room or its user rooms, and sees nothing A emits to them', async () => {
    const adminB = await connectAs(B.admin);
    expect((await join(adminB, { kind: 'inbox', scope: `team:${teamA}` })).ok).toBe(false);
    expect((await join(adminB, { kind: 'inbox', scope: `TEAM:${teamA.toUpperCase()}` })).ok).toBe(
      false,
    );
    for (const spec of [
      { kind: 'user', userId: ownerA.userId },
      { kind: 'user', userId: String(ownerA.userId) },
      { kind: 'user', id: ownerA.userId },
      { kind: 'org', orgId: A.orgId },
      { kind: 'org' },
    ]) {
      expect(await join(adminB, spec), JSON.stringify(spec)).toEqual({
        ok: false,
        code: 'INVALID',
      });
    }
    await emitter.emitToUsers(A.orgId, [ownerA.userId], REALTIME_EVENT.unread, {
      conversationId: convA,
      unread: 2,
    });
    await emitter.emit(A.orgId, [{ kind: 'inbox', scope: 'all' }], REALTIME_EVENT.unread, {
      conversationId: convA,
      unread: 2,
    });
    expect(await arrives(adminB, REALTIME_EVENT.unread)).toBe(false);
  });

  it('AUTHZ-077 negative: wildcard, array, malformed and non-room specs are refused (INVALID), including arrays mixing own and foreign rooms', async () => {
    const c = await connectAs(allReaderB.token);
    const bad: unknown[] = [
      [conv(convB), conv(convA)],
      [conv(convA)],
      { kind: 'conv', id: '*' },
      { kind: 'conv', id: '%' },
      { kind: 'conv', id: `${convB},${convA}` },
      { kind: 'conv', id: [convB, convA] },
      { kind: 'conv', id: { $ne: null } },
      { kind: 'inbox', scope: '*' },
      { kind: 'inbox', scope: 'team:*' },
      { kind: 'inbox', scope: 'all:*' },
      { kind: '*', id: convA },
      { kind: '__proto__', id: convA },
      { rooms: [conv(convB), conv(convA)] },
      'conv:*',
      `conv:${convA}`,
      null,
      42,
    ];
    for (const spec of bad) {
      const ack = await join(c, spec);
      expect(ack, JSON.stringify(spec)).toEqual({ ok: false, code: 'INVALID' });
    }
    // The own room was not joined as a side effect of the mixed-array request either.
    await emitUnread(B.orgId, convB, 3);
    expect(await arrives(c, REALTIME_EVENT.unread)).toBe(false);
  });

  it('AUTHZ-077 negative: team-chat channels have no socket room kind at all (not joinable by any name or id)', async () => {
    const c = await connectAs(B.admin);
    for (const spec of [
      { kind: 'channel', id: randomUUID() },
      { kind: 'team-chat', id: randomUUID() },
      { kind: 'teamchat', channelId: randomUUID() },
      { kind: 'conv', id: 'team-chat' },
    ]) {
      expect(await join(c, spec), JSON.stringify(spec)).toEqual({ ok: false, code: 'INVALID' });
    }
  });

  it('AUTHZ-077 negative: the own-scope member cannot join a colleague private conversation room (policy: visibility rule, same as REST)', async () => {
    const c = await connectAs(ownerA.token);
    expect(await join(c, conv(convOfColleagueA))).toEqual({ ok: false, code: 'FORBIDDEN' });
    // The same refusal as a conversation that does not exist: the answer never says whether it is there.
    expect(await join(c, conv(randomUUID()))).toEqual({ ok: false, code: 'FORBIDDEN' });
    await emitUnread(A.orgId, convOfColleagueA, 5);
    expect(await arrives(c, REALTIME_EVENT.unread)).toBe(false);
  });

  it('AUTHZ-077 positive: the colleague does get their own conversation room; a member with no read grant gets none', async () => {
    const colleague = await connectAs(colleagueA.token);
    expect((await join(colleague, conv(convOfColleagueA))).ok).toBe(true);
    const plain = await connectAs(plainA.token);
    expect(await join(plain, conv(convOfColleagueA))).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await join(plain, conv(convA))).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('AUTHZ-077 negative: user-room events reach only the addressed user (a colleague and another tenant hear nothing)', async () => {
    const owner = await connectAs(ownerA.token);
    const colleague = await connectAs(colleagueA.token);
    const adminB = await connectAs(B.admin);
    await emitter.emitToUsers(A.orgId, [ownerA.userId], REALTIME_EVENT.unread, {
      conversationId: convA,
      unread: 7,
    });
    await waitFor(() => received(owner, REALTIME_EVENT.unread)[0]);
    expect(await arrives(colleague, REALTIME_EVENT.unread)).toBe(false);
    expect(await arrives(adminB, REALTIME_EVENT.unread)).toBe(false);
  });

  it('AUTHZ-077 negative: an emit that names A room with B org id lands in B space only (rooms embed the org id)', async () => {
    const aSock = await connectAs(ownerA.token);
    await join(aSock, conv(convA));
    const bSock = await connectAs(allReaderB.token);
    await join(bSock, conv(convB));
    // Producer bug simulation: B emits to the uuid of A's conversation.
    await emitter.emit(B.orgId, [{ kind: 'conv', id: convA }], REALTIME_EVENT.unread, {
      conversationId: convA,
      unread: 8,
    });
    expect(await arrives(aSock, REALTIME_EVENT.unread)).toBe(false);
    expect(await arrives(bSock, REALTIME_EVENT.unread)).toBe(false);
  });

  it('AUTHZ-077 positive and negative: events emitted for A reach A sockets, none reaches B (conv, inbox and user rooms)', async () => {
    const a = await connectAs(ownerA.token);
    const aAll = await connectAs(A.admin);
    const b = await connectAs(allReaderB.token);
    await join(a, conv(convA));
    await join(aAll, { kind: 'inbox', scope: 'all' });
    await join(b, { kind: 'inbox', scope: 'all' });
    await emitter.emit(A.orgId, [{ kind: 'conv', id: convA }], REALTIME_EVENT.messageNew, {
      conversationId: convA,
      message: { id: randomUUID(), seq: 1 },
    });
    await emitter.emit(
      A.orgId,
      [{ kind: 'inbox', scope: 'all' }],
      REALTIME_EVENT.conversationUpsert,
      {
        conversationId: convA,
        rowVersion: 1,
        changed: ['status'],
      },
    );
    await waitFor(() => received(a, REALTIME_EVENT.messageNew)[0]);
    await waitFor(() => received(aAll, REALTIME_EVENT.conversationUpsert)[0]);
    await sleep(700);
    expect(businessEvents(b)).toEqual([]);
  });

  it('AUTHZ-077 negative: a restricted field (the wallet balance) is not pushed to a member without wallet.balance.read', async () => {
    // GET /v2/wallet/summary needs wallet.balance.read; the same figure must not be pushed to sockets of members who are refused there.
    const nobody = await connectAs(plainA.token);
    const finance = await connectAs(
      (await api.member(A, 'finance', [['wallet.balance.read']])).token,
    );
    expect((await api.as(plainA.token).get('/v2/wallet/summary')).status).toBe(403);
    await emitter.emit(A.orgId, [{ kind: 'org' }], REALTIME_EVENT.walletUpdated, {
      balanceMinor: 123456,
      reason: 'topup',
    });
    await waitFor(() => received(finance, REALTIME_EVENT.walletUpdated)[0]);
    await sleep(500);
    const leaked = received(nobody, REALTIME_EVENT.walletUpdated).map((e) => e.payload);
    expect(
      leaked,
      'wallet.updated (balanceMinor) reached a member without wallet.balance.read',
    ).toEqual([]);
  });

  it('AUTHZ-077 negative: conversation events carry ids, never a restricted body, to the list rooms (signals only)', async () => {
    const owner = await connectAs(ownerA.token);
    await emitter.emitToUsers(A.orgId, [ownerA.userId], REALTIME_EVENT.conversationUpsert, {
      conversationId: convA,
      rowVersion: 3,
      changed: ['assignee'],
    });
    const env = await waitFor(() => received(owner, REALTIME_EVENT.conversationUpsert)[0]);
    expect(Object.keys(env.payload).sort()).toEqual(['changed', 'conversationId', 'rowVersion']);
    expect(JSON.stringify(env)).not.toMatch(/org_?id|email|phone|@/i);
  });
});

// --- AUTHZ-078: access that ends while the socket is connected -------------------------------------------------------------------

describe('AUTHZ-078 revalidation of connected sockets', () => {
  /** The documented sweep: RealtimeGateway.SESSION_SWEEP_MS. The natural sweep is measured, not forced, for removed members. */
  const SWEEP_MS = 30_000;
  let A: Tenant;
  let removed: Awaited<ReturnType<typeof connectAs>>;
  let loggedOut: Awaited<ReturnType<typeof connectAs>>;
  let revoked: Awaited<ReturnType<typeof connectAs>>;
  let control: Awaited<ReturnType<typeof connectAs>>;
  const t0: Record<string, number> = {};
  let convA: string;
  let revokedUser: { token: string; userId: number };

  beforeAll(async () => {
    A = await api.signup('rv-a');
    const removedUser = await api.member(A, 'removed', READ('all'));
    const outUser = await api.member(A, 'loggedout', READ('all'));
    revokedUser = await api.member(A, 'revoked', READ('all'));
    const keep = await api.member(A, 'keep', READ('all'));
    convA = await conversation(A, null);

    removed = await connectAs(removedUser.token);
    loggedOut = await connectAs(outUser.token);
    revoked = await connectAs(revokedUser.token);
    control = await connectAs(keep.token);
    for (const c of [removed, loggedOut, revoked, control])
      expect((await join(c, conv(convA))).ok).toBe(true);

    // 1) the member is removed through the real API, 2) a session is signed out through the real API, 3) the role is changed to one
    // with no grants through the real API. Then the socket's behaviour is observed.
    const row = await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [removedUser.userId]);
    t0.removed = Date.now();
    const del = await api.as(A.admin).delete(`/v2/workspace/members/${row.rows[0].uuid}`);
    expect(del.status, JSON.stringify(del.body)).toBe(204);

    t0.loggedOut = Date.now();
    const out = await api.as(outUser.token).post('/v2/auth/logout').send({});
    expect(out.status).toBe(201);

    const empty = await api.member(A, 'emptyrole', []);
    const emptyRole = await h.owner.query(
      `SELECT r.uuid FROM roles r JOIN user_roles ur ON ur.role_id = r.id AND ur.org_id = r.org_id WHERE ur.user_id = $1`,
      [empty.userId],
    );
    const target = await h.owner.query(`SELECT uuid, row_version FROM users WHERE id = $1`, [
      revokedUser.userId,
    ]);
    t0.revoked = Date.now();
    const patch = await api
      .as(A.admin)
      .patch(`/v2/workspace/members/${target.rows[0].uuid}/role`)
      .send({ roleId: emptyRole.rows[0].uuid, rowVersion: Number(target.rows[0].row_version) });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    // The member really lost the read grant: REST agrees.
    expect((await api.as(revokedUser.token).get('/v2/inbox/conversations')).status).toBe(403);
  }, 120_000);

  it('AUTHZ-078 positive: a member whose access did not change stays connected and keeps receiving', async () => {
    await emitUnread(A.orgId, convA, 1);
    await waitFor(() => received(control, REALTIME_EVENT.unread)[0]);
    expect(control.socket.connected).toBe(true);
  });

  it('AUTHZ-078 a signed-out session is closed by the sweep (measured against the documented 30 s)', async () => {
    const until = Date.now() + SWEEP_MS + 15_000;
    while (!loggedOut.closedAt && Date.now() < until) await sleep(250);
    const took = loggedOut.closedAt ? loggedOut.closedAt - t0.loggedOut! : null;
    console.log(
      `[AUTHZ-078] logged-out socket closed after ${took} ms (reason ${loggedOut.closeReason})`,
    );
    expect(loggedOut.closedAt, 'socket still open 45 s after logout').toBeDefined();
    expect(took!).toBeLessThanOrEqual(SWEEP_MS + 5_000);
  }, 70_000);

  it('AUTHZ-078 a removed member is disconnected by the sweep and stops receiving the joined conversation room', async () => {
    const until = Date.now() + SWEEP_MS + 15_000;
    while (!removed.closedAt && Date.now() < until) await sleep(250);
    const took = removed.closedAt ? removed.closedAt - t0.removed! : null;
    console.log(
      `[AUTHZ-078] removed member socket closed after ${took} ms (reason ${removed.closeReason})`,
    );
    expect(removed.closedAt, 'removed member socket still open 45 s after removal').toBeDefined();
    expect(took!).toBeLessThanOrEqual(SWEEP_MS + 5_000);
    // Between removal and the sweep the room is still joined: the exposure window is measured above. After the close nothing arrives.
    const before = received(removed, REALTIME_EVENT.unread).length;
    await emitUnread(A.orgId, convA, 2);
    await sleep(500);
    expect(received(removed, REALTIME_EVENT.unread).length).toBe(before);
  }, 70_000);

  it('AUTHZ-078 a member whose read grant was revoked stops receiving the conversation room events (socket closed or room left)', async () => {
    // FINDING if this fails: the sweep only checks revoked sessions and suspended workspaces. A role change bumps the RBAC version
    // but neither evicts the socket from rooms it joined under the old grant nor closes it, so message bodies keep arriving.
    await sleep(2_000);
    revoked.events.length = 0;
    const secret = randomUUID();
    await emitter.emit(A.orgId, [{ kind: 'conv', id: convA }], REALTIME_EVENT.messageNew, {
      conversationId: convA,
      message: { id: secret, seq: 99, body: 'confidential body after the role was revoked' },
    });
    await sleep(1_000);
    const stillGets = received(revoked, REALTIME_EVENT.messageNew).some(
      (e) => (e.payload as { message?: { id?: string } }).message?.id === secret,
    );
    console.log(
      `[AUTHZ-078] role-revoked socket connected=${revoked.socket.connected} still-receives-conv-room=${stillGets}`,
    );
    expect(
      stillGets,
      'role-revoked member still receives message events in a conversation room joined before the revoke',
    ).toBe(false);
  }, 30_000);

  it('AUTHZ-078 a role-revoked member is not in the audience of new list-level events and cannot re-join the room', async () => {
    const c = await connectAs(revokedUser.token);
    expect(await join(c, conv(convA))).toEqual({ ok: false, code: 'FORBIDDEN' });
    await emitter.emitToUsers(A.orgId, [], REALTIME_EVENT.unread, {
      conversationId: convA,
      unread: 1,
    });
    expect(await arrives(c, REALTIME_EVENT.unread)).toBe(false);
  });

  it('AUTHZ-078 a removed member cannot reconnect: their old access token and a ticket are both refused', async () => {
    const u = await api.member(A, 'second-removed', READ('all'));
    const row = await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [u.userId]);
    const ticket = await ticketFor(u.token);
    expect((await api.as(A.admin).delete(`/v2/workspace/members/${row.rows[0].uuid}`)).status).toBe(
      204,
    );
    expect((await open({ ticket })).error).toBe('unauthorized');
    expect((await open({ token: u.token })).error).toBe('unauthorized');
    expect((await api.as(u.token).post('/v2/realtime/ticket')).status).toBe(401);
  });

  it('AUTHZ-078 a suspended workspace stops live updates (handshake refused, connected sockets dropped by the sweep)', async () => {
    const S = await api.signup('rv-s');
    const staff = await api.member(S, 'staff', READ('all'));
    const c = await connectAs(staff.token);
    await h.owner.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [S.orgId]);
    await h.app.get(OrgSuspensionService).invalidate(S.orgId);
    const gateway = h.app.get(RealtimeGateway) as unknown as { dropRevoked(): Promise<void> };
    await gateway.dropRevoked();
    await sleep(300);
    expect(c.socket.connected).toBe(false);
    const ticket = await ticketFor(S.admin).catch(() => null);
    if (ticket) expect((await open({ ticket })).error).toBe('unauthorized');
  });
});
