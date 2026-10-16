import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REALTIME_EVENT, realtimeEventSchemas } from '@crm/contracts';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import { OutboxDrainService } from '../../../src/workers/outbox-drain.service';
import { listen, sleep, type Conn, type Pipeline } from '../chat-conversations/pipeline-support';
import { Api, startHarness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Phase 2 producers end to end (BL-096, docs/specs/realtime-notifications.md catalogue rows 8 to 10): a personal WhatsApp number
 * dropping, a broadcast / campaign / scheduled message finishing or failing, and team chat mentions and direct messages. The outbox
 * rows are the ones the real domain code writes (device events hand-written in the shape the runtime emits; team chat through the real
 * HTTP API), the REAL drain hands them to the REAL consumers, and the announcements are asserted on real sockets over the Redis
 * adapter and on the REST feed. The per-person preferences are driven through `PUT /v2/notifications/preferences`.
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
let drainer: OutboxDrainService;
let workspacePrefs: NotificationPrefsResolver;

beforeAll(async () => {
  const h = await startHarness({
    loadModules: async () => [
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
  drainer = new OutboxDrainService(h.app.get(DatabaseService), h.app.get(OutboxSubscriberRegistry));
  workspacePrefs = h.app.get(NotificationPrefsResolver, { strict: false });
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

// --- helpers -------------------------------------------------------------------------------------------------------------------

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
const settle = () => sleep(400);

async function emit(
  t: Tenant,
  aggregateModule: string,
  aggregateId: number | string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await p.h.owner.query(
    `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload) VALUES ($1,$2,$3,$4,$5)`,
    [t.orgId, aggregateModule, String(aggregateId), eventType, JSON.stringify(payload)],
  );
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
const feed = async (token: string) => {
  const res = await api.as(token).get('/v2/notifications');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { data: Row[]; meta: { unread: number } };
};
const rowsOf = async (token: string, type: string) =>
  (await feed(token)).data.filter((r) => r.type === type);

const created = (c: Conn, from = 0) =>
  c.events
    .slice(from)
    .filter((e) => e.name === REALTIME_EVENT.notificationCreated)
    .map((e) => realtimeEventSchemas[REALTIME_EVENT.notificationCreated].parse(e.data.payload));
const reads = (c: Conn, from = 0) =>
  c.events
    .slice(from)
    .filter((e) => e.name === REALTIME_EVENT.notificationRead)
    .map((e) => e.data.payload as Record<string, unknown>);

async function setPref(
  token: string,
  type: string,
  patch: { bell?: boolean | null; toast?: boolean | null; sound?: boolean | null },
) {
  const res = await api
    .as(token)
    .put('/v2/notifications/preferences')
    .send({ items: [{ type, ...patch }] });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { items: Array<Record<string, unknown>> };
}

const uuidOf = async (userId: number) =>
  (await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

// --- the preferences API ---------------------------------------------------------------------------------------------------------

describe('GET and PUT /v2/notifications/preferences', () => {
  let t: Tenant;
  let other: Tenant;
  let me: { token: string; userId: number };

  beforeAll(async () => {
    t = await api.signup('npa');
    other = await api.signup('npb');
    me = await api.member(t, 'me', []);
  });

  it('lists every type with the defaults and nothing overridden for a person who never chose', async () => {
    const res = await api.as(me.token).get('/v2/notifications/preferences');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(20);
    const chat = items.find((i) => i.type === 'new_chat')!;
    expect(chat).toEqual({
      type: 'new_chat',
      group: 'conversations',
      bell: true,
      toast: true,
      sound: true,
      push: true,
      defaults: { bell: true, toast: true, sound: true, push: true },
      overrides: { bell: null, toast: null, sound: null, push: null },
      workspaceInapp: true,
    });
    expect(items.find((i) => i.type === 'task_completed')).toMatchObject({
      toast: false,
      sound: false,
    });
  });

  it('a partial update changes only what it names, is idempotent, is audited once, and null resets', async () => {
    const first = await setPref(me.token, 'new_message', { toast: false });
    expect(first.items.find((i) => i.type === 'new_message')).toMatchObject({
      bell: true,
      toast: false,
      sound: true,
      overrides: { bell: null, toast: false, sound: null },
    });
    await setPref(me.token, 'new_message', { toast: false });
    await setPref(me.token, 'new_message', { sound: false });
    const row = (
      await p.h.owner.query(
        `SELECT bell, toast, sound, row_version FROM notification_user_prefs WHERE user_id = $1 AND type = 'new_message'`,
        [me.userId],
      )
    ).rows;
    expect(row).toEqual([{ bell: null, toast: false, sound: false, row_version: 2 }]);
    // The audit trail has the two real changes, not the repeat.
    const audits = await p.h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'notifications' AND record_id = $2 ORDER BY id`,
      [t.orgId, me.userId],
    );
    expect(audits.rows.map((r) => r.delta)).toEqual([
      { 'new_message.toast': { old: null, new: false } },
      { 'new_message.sound': { old: null, new: false } },
    ]);
    const reset = await setPref(me.token, 'new_message', { toast: null, sound: null });
    expect(reset.items.find((i) => i.type === 'new_message')).toMatchObject({
      toast: true,
      sound: true,
      overrides: { bell: null, toast: null, sound: null },
    });
    expect(
      (
        await p.h.owner.query(
          `SELECT count(*)::int AS n FROM notification_user_prefs WHERE user_id = $1`,
          [me.userId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('shows the workspace owner toggle as the bell a person inherits, and their own choice over it', async () => {
    await p.h.owner.query(
      `UPDATE organizations SET settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{notificationPrefs}', $2::jsonb) WHERE id = $1`,
      [
        t.orgId,
        JSON.stringify({
          events: { device_disconnected: { inapp: false, email: false, slack: false } },
          categories: {},
        }),
      ],
    );
    workspacePrefs.clear();
    const res = await api.as(me.token).get('/v2/notifications/preferences');
    expect(
      res.body.items.find((i: Record<string, unknown>) => i.type === 'device_disconnected'),
    ).toMatchObject({
      bell: false,
      workspaceInapp: false,
      overrides: { bell: null },
    });
    await setPref(me.token, 'device_disconnected', { bell: true });
    expect(
      (await api.as(me.token).get('/v2/notifications/preferences')).body.items.find(
        (i: Record<string, unknown>) => i.type === 'device_disconnected',
      ),
    ).toMatchObject({ bell: true, workspaceInapp: false, overrides: { bell: true } });
    await setPref(me.token, 'device_disconnected', { bell: null });
    await p.h.owner.query(
      `UPDATE organizations SET settings = settings - 'notificationPrefs' WHERE id = $1`,
      [t.orgId],
    );
    workspacePrefs.clear();
  });

  it('refuses an unknown type, an empty body and a duplicate with 422, and a stranger sees only their own', async () => {
    for (const body of [
      { items: [{ type: 'nonsense', bell: true }] },
      { items: [] },
      {
        items: [
          { type: 'mention', bell: true },
          { type: 'mention', bell: false },
        ],
      },
      { items: [{ type: 'mention', bell: 'yes' }] },
    ]) {
      const res = await api.as(me.token).put('/v2/notifications/preferences').send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    await setPref(me.token, 'mention', { bell: false });
    const stranger = await api.as(other.admin).get('/v2/notifications/preferences');
    expect(
      stranger.body.items.find((i: Record<string, unknown>) => i.type === 'mention'),
    ).toMatchObject({
      bell: true,
      overrides: { bell: null },
    });
    expect((await api.http().get('/v2/notifications/preferences')).status).toBe(401);
  });
});

// --- devices (row 8) ---------------------------------------------------------------------------------------------------------------

describe('device notifications', () => {
  let t: Tenant;
  let other: Tenant;
  let reader: { token: string; userId: number }; // wa.devices.read
  let plain: { token: string; userId: number }; // no devices grant
  let sockets: Record<'admin' | 'reader' | 'plain' | 'foreign', Conn>;
  let deviceId: number;
  let deviceUuid: string;

  beforeAll(async () => {
    t = await api.signup('ndv');
    other = await api.signup('ndw');
    reader = await api.member(t, 'reader', [['wa.devices.read']]);
    plain = await api.member(t, 'plain', []);
    sockets = {
      admin: await listen(p, t.admin),
      reader: await listen(p, reader.token),
      plain: await listen(p, plain.token),
      foreign: await listen(p, other.admin),
    };
    const d = await p.h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, phone_digits, status, connection_state)
       VALUES ($1, 'Sales phone', '919812345678', '919812345678', 'connected', 'connected') RETURNING id, uuid`,
      [t.orgId],
    );
    deviceId = Number(d.rows[0].id);
    deviceUuid = d.rows[0].uuid;
  });

  const marks = () =>
    Object.fromEntries(Object.entries(sockets).map(([k, c]) => [k, c.events.length]));

  it('a drop tells everyone who may read devices, once, and nobody else, with no number and no code on the wire', async () => {
    const m = marks();
    await emit(t, 'devices', deviceId, 'device.disconnected', {
      state: 'disconnected',
      reason: 'proxy_unreachable',
      previous: 'connected',
    });
    await deliver();
    await settle();

    for (const token of [t.admin, reader.token]) {
      const rows = await rowsOf(token, 'device_disconnected');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        title: 'Sales phone disconnected',
        link: `/devices/${deviceUuid}`,
        subject: { kind: 'device', id: deviceUuid },
        readAt: null,
      });
      expect(rows[0]!.data).toMatchObject({
        deviceId: deviceUuid,
        deviceName: 'Sales phone',
        maskedNumber: '…5678',
      });
      expect(JSON.stringify(rows[0])).not.toContain('919812345678');
    }
    expect(await rowsOf(plain.token, 'device_disconnected')).toHaveLength(0);
    expect(await rowsOf(other.admin, 'device_disconnected')).toHaveLength(0);

    for (const who of ['admin', 'reader'] as const) {
      const evs = created(sockets[who], m[who]);
      expect(evs, who).toHaveLength(1);
      expect(evs[0]).toMatchObject({
        type: 'device_disconnected',
        subjectKind: 'device',
        subjectId: deviceUuid,
        silent: false,
        toast: true,
        sound: false,
      });
      const wire = JSON.stringify(sockets[who].events.slice(m[who]));
      expect(wire).not.toContain('5678');
      expect(wire).not.toContain('Sales phone');
    }
    for (const who of ['plain', 'foreign'] as const)
      expect(created(sockets[who], m[who]), who).toHaveLength(0);
  });

  it('a flapping number notifies once an hour: the same drop again, and a redelivery, add nothing', async () => {
    const before = (await feed(t.admin)).data.length;
    await emit(t, 'devices', deviceId, 'device.disconnected', {
      state: 'disconnected',
      reason: 'proxy_unreachable',
    });
    await deliver();
    expect((await feed(t.admin)).data).toHaveLength(before);
    // Redelivery of every event already handled.
    await p.h.owner.query(
      `UPDATE event_outbox SET status = 'pending', attempts = 0, available_at = now(), processed_at = NULL WHERE org_id = $1`,
      [t.orgId],
    );
    await deliver();
    expect((await feed(t.admin)).data).toHaveLength(before);
  });

  it('a disconnect the person asked for says nothing', async () => {
    const before = (await feed(t.admin)).data.length;
    await emit(t, 'devices', deviceId, 'device.disconnected', {
      state: 'disconnected',
      reason: 'user',
    });
    await emit(t, 'devices', deviceId, 'device.logged_out', {
      state: 'logged_out',
      reason: 'user',
    });
    await deliver();
    expect((await feed(t.admin)).data).toHaveLength(before);
  });

  it('a person with the bell off for the type gets no row and no push; one with the toast off gets the row with toast=false', async () => {
    await setPref(reader.token, 'device_logged_out', { bell: false });
    await setPref(t.admin, 'device_logged_out', { toast: false });
    const m = marks();
    await emit(t, 'devices', deviceId, 'device.logged_out', {
      state: 'logged_out',
      reason: 'unlinked_on_phone',
    });
    await deliver();
    await settle();

    expect(await rowsOf(reader.token, 'device_logged_out')).toHaveLength(0);
    expect(created(sockets.reader, m.reader)).toHaveLength(0);

    const adminRows = await rowsOf(t.admin, 'device_logged_out');
    expect(adminRows).toHaveLength(1);
    expect(adminRows[0]!.title).toBe('Sales phone was logged out');
    const evs = created(sockets.admin, m.admin);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ type: 'device_logged_out', toast: false, silent: false });
  });

  it('coming back online marks the drop rows read for everyone and says so on their sockets, and adds a back-online row', async () => {
    const m = marks();
    await emit(t, 'devices', deviceId, 'device.connected', {
      state: 'connected',
      reason: null,
      previous: 'disconnected',
    });
    await deliver();
    await settle();

    const down = await rowsOf(t.admin, 'device_disconnected');
    expect(down.every((r) => r.readAt !== null)).toBe(true);
    expect((await rowsOf(t.admin, 'device_logged_out')).every((r) => r.readAt !== null)).toBe(true);
    const back = await rowsOf(t.admin, 'device_connected');
    expect(back).toHaveLength(1);
    expect(back[0]!.title).toBe('Sales phone is back online');

    expect(reads(sockets.admin, m.admin).length).toBeGreaterThan(0);
    // The reader had the bell off for logged_out but was told about the drop, so they hear the recovery too.
    expect(await rowsOf(reader.token, 'device_connected')).toHaveLength(1);
    expect(await rowsOf(plain.token, 'device_connected')).toHaveLength(0);
  });

  it('a first pairing (no drop was announced) does not announce "back online"', async () => {
    const d = await p.h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, phone_digits, status, connection_state)
       VALUES ($1, 'New phone', '919800000000', '919800000000', 'connected', 'connected') RETURNING id`,
      [t.orgId],
    );
    await emit(t, 'devices', Number(d.rows[0].id), 'device.connected', {
      state: 'connected',
      reason: null,
      previous: 'awaiting_qr',
    });
    await deliver();
    const rows = (await feed(t.admin)).data.filter(
      (r) => r.subject?.kind === 'device' && r.title.startsWith('New phone'),
    );
    expect(rows).toHaveLength(0);
  });

  it('the silent-worker sweep (device.status_changed with worker_silent) is announced; ordinary status reports are not', async () => {
    const d = await p.h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, phone_digits, status, connection_state)
       VALUES ($1, 'Quiet phone', '919811111111', '919811111111', 'connected', 'connected') RETURNING id`,
      [t.orgId],
    );
    const id = Number(d.rows[0].id);
    await emit(t, 'devices', id, 'device.status_changed', {
      status: 'connected',
      state: 'connected',
      reason: null,
      progress: 100,
    });
    await emit(t, 'devices', id, 'device.status_changed', {
      status: 'disconnected',
      state: 'awaiting_qr',
      reason: null,
    });
    await deliver();
    expect(
      (await feed(t.admin)).data.filter((r) => r.title.startsWith('Quiet phone')),
    ).toHaveLength(0);
    await emit(t, 'devices', id, 'device.status_changed', {
      status: 'disconnected',
      label: 'Disconnected',
      state: 'disconnected',
      reason: 'worker_silent',
      progress: 0,
    });
    await deliver();
    const rows = (await feed(t.admin)).data.filter((r) => r.title.startsWith('Quiet phone'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toContain('stopped responding');
  });

  it("the owner's device_disconnected toggle off stops the row for people who did not choose, and a person's own choice beats it", async () => {
    const d = await p.h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, phone_digits, status, connection_state)
       VALUES ($1, 'Toggle phone', '919822222222', '919822222222', 'connected', 'connected') RETURNING id`,
      [t.orgId],
    );
    const id = Number(d.rows[0].id);
    await p.h.owner.query(
      `UPDATE organizations SET settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{notificationPrefs}', $2::jsonb) WHERE id = $1`,
      [
        t.orgId,
        JSON.stringify({
          events: { device_disconnected: { inapp: false, email: false, slack: false } },
          categories: {},
        }),
      ],
    );
    workspacePrefs.clear();
    await setPref(reader.token, 'device_disconnected', { bell: true });
    await emit(t, 'devices', id, 'device.disconnected', {
      state: 'disconnected',
      reason: 'forbidden',
    });
    await deliver();
    const mine = (token: string) =>
      rowsOf(token, 'device_disconnected').then((r) =>
        r.filter((x) => x.title.startsWith('Toggle phone')),
      );
    expect(await mine(t.admin)).toHaveLength(0);
    expect(await mine(reader.token)).toHaveLength(1);
    await p.h.owner.query(
      `UPDATE organizations SET settings = settings - 'notificationPrefs' WHERE id = $1`,
      [t.orgId],
    );
    workspacePrefs.clear();
  });
});

// --- broadcast, campaign, scheduled message outcomes (row 9) -------------------------------------------------------------------------

describe('broadcast, campaign and scheduled message outcomes', () => {
  let t: Tenant;
  let other: Tenant;
  let maker: { token: string; userId: number };
  let bystander: { token: string; userId: number };
  let sockets: Record<'admin' | 'maker' | 'bystander' | 'foreign', Conn>;

  beforeAll(async () => {
    t = await api.signup('nbo');
    other = await api.signup('nbp');
    maker = await api.member(t, 'maker', []);
    bystander = await api.member(t, 'bystander', []);
    sockets = {
      admin: await listen(p, t.admin),
      maker: await listen(p, maker.token),
      bystander: await listen(p, bystander.token),
      foreign: await listen(p, other.admin),
    };
  });
  const marks = () =>
    Object.fromEntries(Object.entries(sockets).map(([k, c]) => [k, c.events.length]));

  async function broadcast(name: string, status: string, counts = { total: 100, ok: 98, fail: 2 }) {
    const r = await p.h.owner.query(
      `INSERT INTO broadcasts (org_id, name, user_id, status, total_recipients, success_count, fail_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, uuid`,
      [t.orgId, name, maker.userId, status, counts.total, counts.ok, counts.fail],
    );
    return { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
  }

  it('a finished broadcast tells the person who started it, with the counts, and nobody else', async () => {
    const b = await broadcast('Diwali offer', 'completed');
    const m = marks();
    await emit(t, 'broadcasts', b.id, 'broadcast.status_changed', {
      uuid: b.uuid,
      status: 'completed',
      previousStatus: 'running',
    });
    await deliver();
    await settle();

    const rows = await rowsOf(maker.token, 'broadcast_completed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Broadcast finished',
      body: 'Broadcast "Diwali offer" finished. 98 sent, 2 failed.',
      link: `/broadcasts/${b.uuid}`,
      subject: { kind: 'broadcast', id: b.uuid },
    });
    expect(rows[0]!.data).toMatchObject({
      kind: 'broadcast',
      id: b.uuid,
      status: 'completed',
      total: 100,
      sent: 98,
      failed: 2,
    });
    for (const token of [t.admin, bystander.token, other.admin]) {
      expect(await rowsOf(token, 'broadcast_completed')).toHaveLength(0);
    }
    const evs = created(sockets.maker, m.maker);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      type: 'broadcast_completed',
      toast: true,
      sound: false,
      silent: false,
    });
    for (const who of ['admin', 'bystander', 'foreign'] as const)
      expect(created(sockets[who], m[who]), who).toHaveLength(0);
  });

  it('a failed broadcast tells the starter AND the workspace admins, not a bystander', async () => {
    const b = await broadcast('Broken send', 'failed', { total: 10, ok: 0, fail: 10 });
    await emit(t, 'broadcasts', b.id, 'broadcast.status_changed', {
      uuid: b.uuid,
      status: 'failed',
      previousStatus: 'running',
    });
    await deliver();
    for (const token of [maker.token, t.admin]) {
      const rows = (await rowsOf(token, 'broadcast_failed')).filter(
        (r) => r.subject?.id === b.uuid,
      );
      expect(rows, token).toHaveLength(1);
      expect(rows[0]!.title).toBe('Broadcast failed');
    }
    expect(await rowsOf(bystander.token, 'broadcast_failed')).toHaveLength(0);
  });

  it('a redelivered event writes nothing twice, and a status that is not final says nothing', async () => {
    const b = await broadcast('Quiet', 'running');
    const before = (await feed(maker.token)).data.length;
    for (const status of ['running', 'paused', 'cancelled']) {
      await emit(t, 'broadcasts', b.id, 'broadcast.status_changed', {
        uuid: b.uuid,
        status,
        previousStatus: 'scheduled',
      });
    }
    await deliver();
    expect((await feed(maker.token)).data).toHaveLength(before);
    await p.h.owner.query(
      `UPDATE event_outbox SET status = 'pending', attempts = 0, available_at = now(), processed_at = NULL WHERE org_id = $1`,
      [t.orgId],
    );
    await deliver();
    expect(
      (await feed(maker.token)).data.filter((r) => r.type === 'broadcast_completed'),
    ).toHaveLength(1);
  });

  it('the starter with the bell off for the type gets no row and no push; with only the toast off, the row with toast=false', async () => {
    await setPref(maker.token, 'broadcast_completed', { bell: false });
    const b1 = await broadcast('Muted one', 'completed');
    const m = marks();
    await emit(t, 'broadcasts', b1.id, 'broadcast.status_changed', {
      uuid: b1.uuid,
      status: 'completed',
      previousStatus: 'running',
    });
    await deliver();
    await settle();
    expect(
      (await rowsOf(maker.token, 'broadcast_completed')).filter((r) => r.subject?.id === b1.uuid),
    ).toHaveLength(0);
    expect(created(sockets.maker, m.maker)).toHaveLength(0);

    await setPref(maker.token, 'broadcast_completed', { bell: null, toast: false });
    const b2 = await broadcast('Silent toast', 'completed');
    const m2 = marks();
    await emit(t, 'broadcasts', b2.id, 'broadcast.status_changed', {
      uuid: b2.uuid,
      status: 'completed',
      previousStatus: 'running',
    });
    await deliver();
    await settle();
    expect(
      (await rowsOf(maker.token, 'broadcast_completed')).filter((r) => r.subject?.id === b2.uuid),
    ).toHaveLength(1);
    const evs = created(sockets.maker, m2.maker);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ toast: false, silent: false });
    await setPref(maker.token, 'broadcast_completed', { toast: null });
  });

  it('a campaign that completes or fails notifies like a broadcast (workspace key campaign_failed gates the failure)', async () => {
    const mk = async (name: string, status: string) =>
      p.h.owner.query(
        `INSERT INTO wpcampaigns (org_id, campaign_name, created_by, status, total_recipients, sent_count, failed_count)
         VALUES ($1,$2,$3,$4,50,48,2) RETURNING id, uuid`,
        [t.orgId, name, maker.userId, status],
      );
    const done = (await mk('Spring sale', 'completed')).rows[0];
    await emit(t, 'campaigns', done.id, 'campaign.status_updated', {
      uuid: done.uuid,
      name: 'Spring sale',
      status: 'completed',
      previousStatus: 'running',
    });
    const bad = (await mk('Bad run', 'failed')).rows[0];
    await emit(t, 'campaigns', bad.id, 'campaign.status_updated', {
      uuid: bad.uuid,
      name: 'Bad run',
      status: 'failed',
      previousStatus: 'running',
    });
    await deliver();
    const ok = (await rowsOf(maker.token, 'campaign_completed')).filter(
      (r) => r.subject?.id === done.uuid,
    );
    expect(ok).toHaveLength(1);
    expect(ok[0]).toMatchObject({
      body: 'Campaign "Spring sale" finished. 48 sent, 2 failed.',
      link: `/campaigns/${done.uuid}`,
    });
    expect(
      (await rowsOf(t.admin, 'campaign_failed')).filter((r) => r.subject?.id === bad.uuid),
    ).toHaveLength(1);
    expect(
      (await rowsOf(maker.token, 'campaign_failed')).filter((r) => r.subject?.id === bad.uuid),
    ).toHaveLength(1);
    expect(await rowsOf(t.admin, 'campaign_completed')).toHaveLength(0);

    // The owner turns campaign_failed off: admins who did not choose stop hearing it; the starter's own bell choice (on) wins for them.
    await p.h.owner.query(
      `UPDATE organizations SET settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{notificationPrefs}', $2::jsonb) WHERE id = $1`,
      [
        t.orgId,
        JSON.stringify({
          events: { campaign_failed: { inapp: false, email: false, slack: false } },
          categories: {},
        }),
      ],
    );
    workspacePrefs.clear();
    await setPref(maker.token, 'campaign_failed', { bell: true });
    const bad2 = (await mk('Bad run 2', 'failed')).rows[0];
    await emit(t, 'campaigns', bad2.id, 'campaign.status_updated', {
      uuid: bad2.uuid,
      name: 'Bad run 2',
      status: 'failed',
      previousStatus: 'running',
    });
    await deliver();
    expect(
      (await rowsOf(t.admin, 'campaign_failed')).filter((r) => r.subject?.id === bad2.uuid),
    ).toHaveLength(0);
    expect(
      (await rowsOf(maker.token, 'campaign_failed')).filter((r) => r.subject?.id === bad2.uuid),
    ).toHaveLength(1);
    await p.h.owner.query(
      `UPDATE organizations SET settings = settings - 'notificationPrefs' WHERE id = $1`,
      [t.orgId],
    );
    workspacePrefs.clear();
  });

  it('a campaign that finishes again before the bell is read updates ONE row with the newest counts; once read, the next finish writes a new row', async () => {
    const c = (
      await p.h.owner.query(
        `INSERT INTO wpcampaigns (org_id, campaign_name, created_by, status, total_recipients, sent_count, failed_count)
         VALUES ($1,'A/B test',$2,'completed',13,7,6) RETURNING id, uuid`,
        [t.orgId, maker.userId],
      )
    ).rows[0];
    const finish = () =>
      emit(t, 'campaigns', c.id, 'campaign.status_updated', {
        uuid: c.uuid,
        name: 'A/B test',
        status: 'completed',
        previousStatus: 'running',
      });
    const mine = async () =>
      (await rowsOf(maker.token, 'campaign_completed')).filter((r) => r.subject?.id === c.uuid);

    await finish();
    await deliver();
    expect(await mine()).toHaveLength(1);
    expect((await mine())[0]!.body).toBe('Campaign "A/B test" finished. 7 sent, 6 failed.');

    // Finished again with new counts, unread: still one row, the newest counts, run count 2.
    await p.h.owner.query(`UPDATE wpcampaigns SET sent_count = 9, failed_count = 4 WHERE id = $1`, [
      c.id,
    ]);
    await finish();
    await deliver();
    await finish();
    await deliver();
    const rows = await mine();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe('Campaign "A/B test" finished. 9 sent, 4 failed.');
    expect(rows[0]!.data).toMatchObject({ id: c.uuid, sent: 9, failed: 4, runs: 3 });
    expect(rows[0]!.readAt).toBeNull();

    // Read: the next finish is news again, so it is a second row.
    const read = await api.as(maker.token).post(`/v2/notifications/${rows[0]!.id}/read`).send({});
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    await finish();
    await deliver();
    const after = await mine();
    expect(after).toHaveLength(2);
    expect(after.filter((r) => r.readAt === null)).toHaveLength(1);
    expect(after.find((r) => r.readAt === null)!.data).toMatchObject({ runs: 1 });
  });

  it('a scheduled message that finishes or fails notifies its starter (the new scheduled.status_changed event)', async () => {
    const mk = async (name: string) =>
      p.h.owner.query(
        `INSERT INTO scheduled_messages (org_id, user_id, schedule_name, send_date, send_time, scheduled_time, timezone, recipient_type)
         VALUES ($1,$2,$3,current_date,'10:00',now(),'UTC','numbers') RETURNING id, uuid`,
        [t.orgId, maker.userId, name],
      );
    const ok = (await mk('Reminder')).rows[0];
    await emit(t, 'scheduled_messages', ok.id, 'scheduled.status_changed', {
      uuid: ok.uuid,
      name: 'Reminder',
      status: 'completed',
      sent: 5,
      failed: 1,
    });
    const bad = (await mk('Lost reminder')).rows[0];
    await emit(t, 'scheduled_messages', bad.id, 'scheduled.status_changed', {
      uuid: bad.uuid,
      name: 'Lost reminder',
      status: 'failed',
      reason: 'Every recipient failed',
    });
    await deliver();
    const done = (await rowsOf(maker.token, 'scheduled_completed')).filter(
      (r) => r.subject?.id === ok.uuid,
    );
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      title: 'Scheduled message finished',
      link: `/scheduled/${ok.uuid}`,
    });
    const failed = (await rowsOf(maker.token, 'scheduled_failed')).filter(
      (r) => r.subject?.id === bad.uuid,
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.body).toContain('Every recipient failed');
    expect(
      (await rowsOf(t.admin, 'scheduled_failed')).filter((r) => r.subject?.id === bad.uuid),
    ).toHaveLength(1);
    expect(await rowsOf(t.admin, 'scheduled_completed')).toHaveLength(0);
  });
});

// --- team chat (row 10) ------------------------------------------------------------------------------------------------------------

describe('team chat notifications', () => {
  let t: Tenant;
  let other: Tenant;
  let ann: { token: string; userId: number }; // the author
  let ben: { token: string; userId: number };
  let cat: { token: string; userId: number };
  let sockets: Record<'ann' | 'ben' | 'cat' | 'foreign', Conn>;
  let general: string;
  let benUuid: string;
  let catUuid: string;
  let annUuid: string;

  const say = async (token: string, channel: string, body: string) => {
    const res = await api
      .as(token)
      .post(`/v2/team-chat/channels/${channel}/messages`)
      .send({ body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string };
  };
  const mention = (name: string, uuid: string) => `@[${name}](${uuid})`;
  const marks = () =>
    Object.fromEntries(Object.entries(sockets).map(([k, c]) => [k, c.events.length]));

  beforeAll(async () => {
    t = await api.signup('ntc');
    other = await api.signup('ntd');
    ann = await api.member(t, 'ann', []);
    ben = await api.member(t, 'ben', []);
    cat = await api.member(t, 'cat', []);
    [annUuid, benUuid, catUuid] = await Promise.all([
      uuidOf(ann.userId),
      uuidOf(ben.userId),
      uuidOf(cat.userId),
    ]);
    sockets = {
      ann: await listen(p, ann.token),
      ben: await listen(p, ben.token),
      cat: await listen(p, cat.token),
      foreign: await listen(p, other.admin),
    };
    const list = await api.as(ann.token).get('/v2/team-chat/channels');
    general = list.body.data.find((c: { slug: string }) => c.slug === 'general').id;
  });

  it('an @mention tells the mentioned person (not the author, not the others), links to the channel and previews as text', async () => {
    const m = marks();
    await say(ann.token, general, `hey ${mention('Ben', benUuid)} can you check the invoice?`);
    await deliver();
    await settle();

    const rows = await rowsOf(ben.token, 'teamchat_mention');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      link: `/team-chat?c=${general}`,
      subject: { kind: 'team_chat_channel', id: general },
      readAt: null,
    });
    expect(rows[0]!.title).toContain('mentioned you in #general');
    // The mention token shows as a name, never as a raw uuid.
    expect(rows[0]!.body).toBe('hey @Ben can you check the invoice?');
    expect(JSON.stringify(rows[0])).not.toContain(benUuid);
    for (const token of [ann.token, cat.token, other.admin])
      expect(await rowsOf(token, 'teamchat_mention')).toHaveLength(0);

    const evs = created(sockets.ben, m.ben);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      type: 'teamchat_mention',
      subjectKind: 'team_chat_channel',
      subjectId: general,
      silent: false,
      toast: true,
      sound: true,
    });
    for (const who of ['ann', 'cat', 'foreign'] as const)
      expect(created(sockets[who], m[who]), who).toHaveLength(0);
  });

  it('more mentions in the same channel collapse into ONE unread row with a count; only the first pings', async () => {
    const m = marks();
    await say(ann.token, general, `${mention('Ben', benUuid)} second`);
    await deliver();
    await say(ann.token, general, `${mention('Ben', benUuid)} third`);
    await deliver();
    await settle();
    const rows = await rowsOf(ben.token, 'teamchat_mention');
    expect(rows.filter((r) => r.readAt === null)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 3, title: '3 new mentions in #general' });
    const evs = created(sockets.ben, m.ben);
    expect(evs.map((e) => e.silent)).toEqual([true, true]);
    expect(evs.every((e) => e.collapsed)).toBe(true);
    expect((await feed(ben.token)).meta.unread).toBe(1);
  });

  it('delivering the same events again changes nothing', async () => {
    const before = await rowsOf(ben.token, 'teamchat_mention');
    await p.h.owner.query(
      `UPDATE event_outbox SET status = 'pending', attempts = 0, available_at = now(), processed_at = NULL WHERE org_id = $1 AND event_type LIKE 'teamchat.%'`,
      [t.orgId],
    );
    await deliver();
    const after = await rowsOf(ben.token, 'teamchat_mention');
    expect(after.map((r) => [r.id, r.count])).toEqual(before.map((r) => [r.id, r.count]));
  });

  it('a person already looking at the channel (read pointer past the message) is not alerted', async () => {
    const m = marks();
    const msg = await say(ann.token, general, `${mention('Cat', catUuid)} are you there?`);
    // Cat has the channel open: it polls and moves her read pointer past the message before the notification worker gets to it.
    const read = await api.as(cat.token).post(`/v2/team-chat/channels/${general}/read`).send({});
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(msg.id).toBeTruthy();
    await deliver();
    await settle();
    expect(await rowsOf(cat.token, 'teamchat_mention')).toHaveLength(0);
    expect(created(sockets.cat, m.cat)).toHaveLength(0);
  });

  it('a mention in a private channel reaches members only', async () => {
    const created_ = await api
      .as(t.admin)
      .post('/v2/team-chat/channels')
      .send({ name: 'finance', type: 'private' });
    expect(created_.status, JSON.stringify(created_.body)).toBe(201);
    const priv = created_.body.id as string;
    const add = await api
      .as(t.admin)
      .post(`/v2/team-chat/channels/${priv}/members`)
      .send({ userId: benUuid });
    expect(add.status, JSON.stringify(add.body)).toBe(204);
    const before = (await rowsOf(cat.token, 'teamchat_mention')).length;
    const benBefore = (await rowsOf(ben.token, 'teamchat_mention')).length;
    await say(t.admin, priv, `${mention('Cat', catUuid)} ${mention('Ben', benUuid)} budget`);
    await deliver();
    // Cat is not in the channel: she hears nothing; Ben is, and does.
    expect(await rowsOf(cat.token, 'teamchat_mention')).toHaveLength(before);
    const ben2 = await rowsOf(ben.token, 'teamchat_mention');
    expect(ben2.some((r) => r.subject?.id === priv)).toBe(true);
    expect(ben2.length).toBe(benBefore + 1);
  });

  it('the person can silence it: bell off = no row and no push; toast off = the row with toast=false', async () => {
    await setPref(cat.token, 'teamchat_mention', { bell: false });
    await setPref(ben.token, 'teamchat_mention', { toast: false });
    const m = marks();
    await say(
      ann.token,
      general,
      `${mention('Cat', catUuid)} ${mention('Ben', benUuid)} standup now`,
    );
    await deliver();
    await settle();
    expect(await rowsOf(cat.token, 'teamchat_mention')).toHaveLength(0);
    expect(created(sockets.cat, m.cat)).toHaveLength(0);
    const evs = created(sockets.ben, m.ben);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ type: 'teamchat_mention', toast: false });
    await setPref(cat.token, 'teamchat_mention', { bell: null });
    await setPref(ben.token, 'teamchat_mention', { toast: null });
  });

  it('a direct message tells the other person, collapsed per conversation; a message that also mentions them is the mention row only', async () => {
    const open = await api.as(ann.token).post('/v2/team-chat/dm').send({ userId: benUuid });
    expect([200, 201], JSON.stringify(open.body)).toContain(open.status);
    const dm = open.body.id as string;
    const m = marks();

    await say(ann.token, dm, 'lunch today?');
    await deliver();
    await say(ann.token, dm, 'or tomorrow?');
    await deliver();
    await settle();
    const rows = (await rowsOf(ben.token, 'teamchat_message')).filter((r) => r.subject?.id === dm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      count: 2,
      title: '2 new messages from ' + (rows[0]!.data as { authorName: string }).authorName,
      link: `/team-chat?c=${dm}`,
    });
    expect(rows[0]!.data).toMatchObject({ direct: true, preview: 'or tomorrow?' });
    // The sender and a third person hear nothing about it.
    expect(await rowsOf(ann.token, 'teamchat_message')).toHaveLength(0);
    expect(await rowsOf(cat.token, 'teamchat_message')).toHaveLength(0);
    const evs = created(sockets.ben, m.ben);
    expect(evs.map((e) => [e.type, e.silent])).toEqual([
      ['teamchat_message', false],
      ['teamchat_message', true],
    ]);

    const mentionsBefore = (await rowsOf(ben.token, 'teamchat_mention')).length;
    await say(ann.token, dm, `${mention('Ben', benUuid)} urgent`);
    await deliver();
    const direct = (await rowsOf(ben.token, 'teamchat_message')).filter(
      (r) => r.subject?.id === dm,
    );
    expect(direct).toHaveLength(1);
    expect(direct[0]!.count).toBe(2);
    expect(
      (await rowsOf(ben.token, 'teamchat_mention')).filter((r) => r.subject?.id === dm),
    ).toHaveLength(1);
    expect((await rowsOf(ben.token, 'teamchat_mention')).length).toBe(mentionsBefore + 1);
    expect(annUuid).toBeTruthy();
  });

  it('opening the channel clears its rows through read-subject, on every tab', async () => {
    const m = marks();
    const res = await api
      .as(ben.token)
      .post('/v2/notifications/read-subject')
      .send({ kind: 'team_chat_channel', id: general });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.updated).toBeGreaterThan(0);
    await settle();
    expect(
      (await rowsOf(ben.token, 'teamchat_mention'))
        .filter((r) => r.subject?.id === general)
        .every((r) => r.readAt !== null),
    ).toBe(true);
    expect(reads(sockets.ben, m.ben)).toHaveLength(1);
  });
});
