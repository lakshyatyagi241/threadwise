import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REALTIME_EVENT, pushTestResponseSchema, realtimeEventSchemas } from '@crm/contracts';
import { WEB_PUSH_PROVIDER } from '../../../src/infra/providers/web-push/web-push.port';
import { FakeWebPushProvider, fakeSubscription, useVapidEnv } from '../../support/web-push-fakes';
import { listen, sleep, type Conn, type Pipeline } from '../chat-conversations/pipeline-support';
import { Api, startHarness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * "Send a test notification" end to end (owner walkthrough item 25: the test showed only the tab title). One press must go through every
 * way a person is told: a real bell row of the harmless `test` type for the caller only, `notification.created` to the caller's own user
 * room only (real sockets over the Redis adapter), and the Web Push to the caller's devices (a fake push service). The answer says which
 * channels fired, and the person can be sent one test every ten seconds.
 */
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
let restoreEnv: () => void;
const push = new FakeWebPushProvider();

beforeAll(async () => {
  restoreEnv = useVapidEnv();
  const h = await startHarness({
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
  // The real sender runs; only the far end (the browser vendors' push services) is a fake.
  const real = h.app.get(WEB_PUSH_PROVIDER, { strict: false }) as FakeWebPushProvider;
  real.send = push.send.bind(push);
  real.isEnabled = () => true;
}, 300_000);

afterAll(async () => {
  restoreEnv?.();
  await p?.stop();
});

const created = (c: Conn) =>
  c.events
    .filter((e) => e.name === REALTIME_EVENT.notificationCreated)
    .map((e) => realtimeEventSchemas[REALTIME_EVENT.notificationCreated].parse(e.data.payload));

const feed = async (token: string) => {
  const res = await api.as(token).get('/v2/notifications');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as {
    data: Array<{ id: string; type: string; title: string; readAt: string | null }>;
    meta: { unread: number };
  };
};

const addDevice = async (token: string, n: number) => {
  const res = await api
    .as(token)
    .post('/v2/notifications/push/subscriptions')
    .send(fakeSubscription(n));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

describe('POST /v2/notifications/push/test', () => {
  let t: Tenant;
  let other: Tenant;
  let me: { token: string; userId: number };
  let colleague: { token: string; userId: number };
  let stranger: { token: string; userId: number };

  beforeAll(async () => {
    t = await api.signup('ptest');
    other = await api.signup('ptesto');
    me = await api.member(t, 'me', []);
    colleague = await api.member(t, 'col', []);
    stranger = await api.member(other, 'str', []);
    await addDevice(me.token, 1);
    await addDevice(me.token, 2);
  });

  it('writes a real bell row for the caller only, announces it to their room only, and pushes to every device', async () => {
    const mine = await listen(p, me.token);
    const theirs = await listen(p, colleague.token);
    const foreign = await listen(p, stranger.token);
    push.sent.length = 0;

    const res = await api.as(me.token).post('/v2/notifications/push/test');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(pushTestResponseSchema.parse(res.body)).toEqual({ inApp: true, sent: 2, failed: 0 });

    // The Web Push leg still goes to every device, marked as a test.
    expect(push.sent).toHaveLength(2);
    expect(push.sent.every((s) => s.payload.test === true)).toBe(true);

    // The in-app leg: one unread `test` row for me, in the feed the bell reads.
    const mineFeed = await feed(me.token);
    expect(mineFeed.data).toHaveLength(1);
    expect(mineFeed.data[0]).toMatchObject({ type: 'test', readAt: null });
    expect(mineFeed.meta.unread).toBe(1);

    // ...announced like any real notification (the toast and ping flags follow the catalogue), and to nobody else.
    await sleep(500);
    expect(created(mine)).toHaveLength(1);
    expect(created(mine)[0]).toMatchObject({
      notificationId: mineFeed.data[0]!.id,
      type: 'test',
      unread: 1,
      silent: false,
      toast: true,
      sound: true,
      subjectKind: null,
    });
    expect(created(theirs)).toHaveLength(0);
    expect(created(foreign)).toHaveLength(0);
    expect((await feed(colleague.token)).data).toHaveLength(0);
    expect((await feed(stranger.token)).data).toHaveLength(0);
  });

  it('allows one test per person every ten seconds: a second press is 429 and writes nothing', async () => {
    const before = (await feed(me.token)).data.length;
    const again = await api.as(me.token).post('/v2/notifications/push/test');
    expect(again.status).toBe(429);
    expect(again.body.code).toBe('RATE_LIMITED');
    expect((await feed(me.token)).data).toHaveLength(before);
  });

  it('is not throttled by the chat burst throttle: a colleague pressing at the same moment still gets theirs', async () => {
    const res = await api.as(colleague.token).post('/v2/notifications/push/test');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // No devices for the colleague: the push leg reports none, the in-app leg still fired.
    expect(res.body).toEqual({ inApp: true, sent: 0, failed: 0 });
    expect((await feed(colleague.token)).data).toHaveLength(1);
  });

  it('honours the person: bell off for the test type = no row and no event, but the push still goes', async () => {
    const quiet = await api.member(t, 'quiet', []);
    await addDevice(quiet.token, 3);
    const off = await api
      .as(quiet.token)
      .put('/v2/notifications/preferences')
      .send({ items: [{ type: 'test', bell: false }] });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const conn = await listen(p, quiet.token);
    push.sent.length = 0;
    const res = await api.as(quiet.token).post('/v2/notifications/push/test');
    expect(res.body).toEqual({ inApp: false, sent: 1, failed: 0 });
    await sleep(400);
    expect(created(conn)).toHaveLength(0);
    expect((await feed(quiet.token)).data).toHaveLength(0);
    expect(push.sent).toHaveLength(1);
  });

  it('honours the person: toast off = the row and the live event arrive with toast:false', async () => {
    const calm = await api.member(t, 'calm', []);
    await api
      .as(calm.token)
      .put('/v2/notifications/preferences')
      .send({ items: [{ type: 'test', toast: false, sound: false }] });
    const conn = await listen(p, calm.token);
    const res = await api.as(calm.token).post('/v2/notifications/push/test');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.inApp).toBe(true);
    await sleep(500);
    expect(created(conn)).toHaveLength(1);
    expect(created(conn)[0]).toMatchObject({ toast: false, sound: false, silent: false });
  });

  it('lists the test type under System in the preferences', async () => {
    const res = await api.as(me.token).get('/v2/notifications/preferences');
    expect(res.body.items.find((i: { type: string }) => i.type === 'test')).toMatchObject({
      group: 'system',
      bell: true,
      toast: true,
      sound: true,
      push: false,
    });
  });
});
