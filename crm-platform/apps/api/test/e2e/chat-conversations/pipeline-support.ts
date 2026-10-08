import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import type { ServerOptions } from 'socket.io';
import { expect } from 'vitest';
import type { RealtimeEnvelope } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * What the message pipeline specs share: the real API with the worker-side processors loaded into the same process (so a queued job
 * is really consumed), the realtime gateway listening, and the helpers to drive a simulator channel, wait for the pipeline, call the
 * conversations facade as a person, and listen on a socket.
 */

const adapterRedis: Redis[] = [];

/** The production adapter (socket.io over Redis), with its connections kept so the spec can close them. */
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

export interface Pipeline {
  h: Harness;
  api: Api;
  /** The socket.io url of the realtime namespace. */
  socketUrl: string;
  stop(): Promise<void>;
}

/** What the helpers below need: the flow runtime's pipeline has no socket url and reuses them. */
export type PipelineCore = Pick<Pipeline, 'h' | 'api'>;

export async function startPipeline(
  /** More worker-side modules to load next to the message pipeline's (a domain whose listener reacts to inbound messages). */
  extraModules?: () => Promise<unknown[]>,
): Promise<Pipeline> {
  process.env.CHANNEL_SIMULATOR_ENABLED = 'true';
  const h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/chat-conversations/chat-conversations-worker.module'))
        .ChatConversationsWorkerModule,
      ...(extraModules ? await extraModules() : []),
    ],
    configureApp: (app) => {
      const adapter = new TestRedisIoAdapter(app);
      adapter.connect(process.env.REDIS_URL!);
      app.useWebSocketAdapter(adapter);
    },
  });
  await h.app.listen(0, '127.0.0.1');
  const socketUrl = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}/realtime`;
  const sockets = openSockets;
  return {
    h,
    api: new Api(h),
    socketUrl,
    stop: async () => {
      for (const s of sockets) s.disconnect();
      await h.stop();
      for (const r of adapterRedis) r.disconnect();
    },
  };
}

// --- waiting -------------------------------------------------------------------------------------------------------------

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls until the probe returns something other than undefined/null/false; fails with the label after `ms`. */
export async function until<T>(
  label: string,
  probe: () => Promise<T | undefined | null | false> | T | undefined | null | false,
  ms = 15_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined && v !== null && v !== false) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await sleep(40);
  }
}

// --- sockets -------------------------------------------------------------------------------------------------------------

const openSockets: Socket[] = [];

export interface Conn {
  socket: Socket;
  events: Array<{ name: string; data: RealtimeEnvelope<Record<string, unknown>> }>;
}

/** A person's socket, connected with a one-time ticket from the real ticket route. Resolves once the server said `connect`. */
export async function listen(p: Pipeline, token: string): Promise<Conn> {
  const res = await p.api.as(token).post('/v2/realtime/ticket');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const socket = io(p.socketUrl, {
    auth: { ticket: res.body.ticket as string },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    autoConnect: false,
  });
  openSockets.push(socket);
  const conn: Conn = { socket, events: [] };
  socket.onAny((name, data) => conn.events.push({ name, data }));
  await new Promise<void>((done, fail) => {
    socket.on('connect', () => done());
    socket.on('connect_error', (err) => fail(new Error(`socket refused: ${err.message}`)));
    socket.connect();
  });
  await until('rt.ready', () => conn.events.some((e) => e.name === 'rt.ready') || undefined);
  return conn;
}

export const eventsOf = (c: Conn, type: string) =>
  c.events.filter((e) => e.name === type).map((e) => e.data);

export const joinConversation = (c: Conn, id: string) =>
  c.socket.timeout(5000).emitWithAck('room:join', { kind: 'conv', id });

// --- acting as a person -----------------------------------------------------------------------------------------------------

/** Runs `fn` as this user of this workspace, the way a request would (the facade reads the ambient context). */
export function asUser<T>(orgId: number, userId: number, fn: () => Promise<T>): Promise<T> {
  return RequestContextStore.run(
    { requestId: `spec-${Date.now()}`, orgId, actorType: 'user', actorId: userId, userId },
    fn,
  );
}

export interface SimChannel {
  id: string;
  /** Internal id, for assertions against the tables. */
  internalId: number;
}

/** A simulator channel with quick receipts (0 / 150 / 400 ms instead of 0 / 1 / 3 s). */
export async function simChannel(
  p: PipelineCore,
  t: Tenant,
  settings: Record<string, unknown> = {},
): Promise<SimChannel> {
  const res = await p.api
    .as(t.admin)
    .post('/v2/channels/simulator')
    .set('idempotency-key', `sim-${Math.random()}`)
    .send({
      name: 'Simulator',
      settings: { simulator: { latencyMs: { sent: 0, delivered: 150, read: 400 } }, ...settings },
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = await p.h.owner.query(`SELECT id FROM channels WHERE uuid = $1`, [res.body.id]);
  return { id: res.body.id as string, internalId: Number(row.rows[0].id) };
}

export async function simInbound(
  p: PipelineCore,
  t: Tenant,
  ch: SimChannel,
  body: Record<string, unknown>,
) {
  const res = await p.api
    .as(t.admin)
    .post(`/v2/dev/simulator/channels/${ch.id}/inbound`)
    .send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body as { providerMessageId: string; deliveries: number };
}

/** The one conversation row of (channel, peer), once the pipeline has made it. */
export async function conversationOf(
  p: PipelineCore,
  t: Tenant,
  ch: SimChannel,
  peer: string,
): Promise<Record<string, unknown>> {
  return until(`conversation of ${peer}`, async () => {
    const r = await p.h.owner.query(
      `SELECT * FROM conversations WHERE org_id = $1 AND channel_id = $2 AND peer_key = $3`,
      [t.orgId, ch.internalId, peer],
    );
    return r.rows[0] as Record<string, unknown> | undefined;
  });
}

export const messagesOf = async (p: PipelineCore, conversationId: number | string) =>
  (
    await p.h.owner.query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq`, [
      conversationId,
    ])
  ).rows as Array<Record<string, unknown>>;

export const scalar = async (p: PipelineCore, sql: string, params: unknown[] = []) =>
  Number((await p.h.owner.query(sql, params)).rows[0]?.n ?? 0);
