import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  REALTIME_EVENT,
  createWaDeviceGroupResultSchema,
  waDeviceGroupInviteLinkSchema,
  waDeviceGroupJoinPreviewSchema,
  waDeviceGroupJoinRequestsSchema,
  waDeviceGroupJoinResultSchema,
  waDeviceGroupListSchema,
  waDeviceGroupMembersSchema,
  waDeviceGroupSchema,
  waDeviceGroupsStateSchema,
  waDeviceGroupsSyncResultSchema,
  waGroupParticipantResultsSchema,
} from '@crm/contracts';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type { GroupSnapshot } from '../../../src/infra/providers/node-bridge-runtime/inbound.port';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { DeviceGroupsSink } from '../../../src/modules/whatsapp-devices-baileys/device-groups.sink';
import { DeviceGroupsSweepService } from '../../../src/modules/whatsapp-devices-baileys/device-groups-sweep.service';
import { DeviceRuntimeService } from '../../../src/modules/node-bridge-runtime/runtime/device-runtime.service';
import { OutboxDrainService } from '../../../src/workers/outbox-drain.service';
import {
  listen,
  sleep,
  until,
  type Conn,
  type Pipeline,
} from '../chat-conversations/pipeline-support';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import {
  fakeGroupSnapshot,
  rig,
  worker as buildWorker,
  type FakeSocket,
  type Rig,
} from '../node-bridge-runtime/support';

/**
 * The groups of a PERSONAL WhatsApp number (docs/threadwise-port/plan/whatsapp-personal-groups-build.md): the real app, real Postgres and
 * Redis, and a FAKE socket standing in for WhatsApp, held by a worker built by hand as in the runtime suites. The worker-side pieces (the
 * directory sink, the realtime and notification consumers, the sweep) are the real ones, loaded next to the app.
 *
 * Covered: the gate and the permission matrix, the other workspace's 404, list/state, create, update (with a failing second call),
 * participants with per-number results, not-admin and left refusals before any WhatsApp call, the limiter (429, `retryAfterS`, cooldown
 * started by WhatsApp's own refusal), join requests, the invite link (never in audit, events or logs), leave, picture, join by link, the
 * directory sync (prune, rejoin, the legacy storefront tables), the sweep, idempotent replays, audit rows, the realtime hint and the
 * notifications.
 */
const adapterRedis: Redis[] = [];
class TestRedisIoAdapter extends IoAdapter {
  private ctor?: ReturnType<typeof createAdapter>;
  connect(redisUrl: string): void {
    const pub = new Redis(redisUrl, { maxRetriesPerRequest: null, retryStrategy: () => null });
    const sub = pub.duplicate();
    for (const x of [pub, sub]) x.on('error', () => undefined);
    adapterRedis.push(pub, sub);
    this.ctor = createAdapter(pub, sub);
  }
  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as { adapter: (a: unknown) => void };
    if (this.ctor) server.adapter(this.ctor);
    return server as unknown as Server;
  }
}

let h: Harness;
let api: Api;
let r: Rig;
let p: Pipeline;
let drainer: OutboxDrainService;
let sweep: DeviceGroupsSweepService;
const runtimes: DeviceRuntimeService[] = [];

beforeAll(async () => {
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/whatsapp-devices-baileys'))
        .WhatsappDevicesBaileysWorkerModule,
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
  p = { h, api, socketUrl, stop: async () => undefined } as unknown as Pipeline;
  r = rig(h);
  // The worker's runtime in these suites is built by hand around `r.inbound`: the real sink goes on it, as the worker module does.
  r.inbound.register(h.app.get(DeviceGroupsSink));
  sweep = h.app.get(DeviceGroupsSweepService);
  sweep.jitterMs = 0;
  drainer = new OutboxDrainService(h.app.get(DatabaseService), h.app.get(OutboxSubscriberRegistry));
}, 300_000);

afterEach(async () => {
  for (const rt of runtimes.splice(0)) await rt.onApplicationShutdown();
  await h.owner.query(`DELETE FROM device_auth_state`);
  const keys = await r.redis.keys('wa:*');
  if (keys.length) await r.redis.del(...keys);
  Object.assign(r.control.groupLimiter.limits, baseLimits);
});
afterAll(async () => {
  await h?.stop();
  for (const x of adapterRedis) x.disconnect();
});

const baseLimits = {
  opsPerMinute: 20,
  opsPerDay: 200,
  createsPerDay: 5,
  joinByLinkPerDay: 5,
  joinByLinkEnabled: false,
  cooldownSeconds: 600,
  participantsPerCall: 20,
};

// --- arranging ----------------------------------------------------------------------------------------------------------------

let seq = 0;
const settle = () => sleep(150);

interface Dev {
  t: Tenant;
  deviceId: number;
  uuid: string;
  digits: string;
  socket: FakeSocket;
  base: string;
}

/** A workspace with a connected number held by a worker whose socket is fake. */
async function connected(label: string, t?: Tenant): Promise<Dev> {
  const tenant = t ?? (await api.signup(label));
  const phone = `90${String(10000000 + seq++).padStart(8, '0')}`;
  const digits = `91${phone}`;
  const row = (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, phone_digits, status, active)
       VALUES ($1, 'Shop line', '+91', $2, $3, 'disconnected', false) RETURNING id, uuid`,
      [tenant.orgId, phone, digits],
    )
  ).rows[0];
  const w = await buildWorker(h, r);
  runtimes.push(w.rt);
  await w.rt.adopt(tenant.orgId, Number(row.id));
  await settle();
  return {
    t: tenant,
    deviceId: Number(row.id),
    uuid: row.uuid as string,
    digits,
    socket: w.factory.last as FakeSocket,
    base: `/v2/devices/${row.uuid}/groups`,
  };
}

/** A group the number is in, as the socket reads it: the number itself (superadmin) and one more member. */
function snap(d: Dev, groupId: string, over: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return fakeGroupSnapshot({
    groupId,
    subject: `Group ${groupId.slice(-3)}`,
    participants: [
      {
        jid: `${d.digits}@s.whatsapp.net`,
        phone: d.digits,
        lid: null,
        name: 'Me',
        admin: 'superadmin',
      },
      {
        jid: '919000000002@s.whatsapp.net',
        phone: '919000000002',
        lid: null,
        name: 'Asha',
        admin: null,
      },
    ],
    ...over,
  });
}

const count = async (d: Dev) =>
  Number(
    (
      await h.owner.query(`SELECT count(*)::int AS n FROM wa_device_groups WHERE device_id = $1`, [
        d.deviceId,
      ])
    ).rows[0].n,
  );

/** The socket reports its groups and the directory sink writes them. */
async function seed(d: Dev, groups: GroupSnapshot[], complete = true) {
  const before = await count(d);
  d.socket.emit({ type: 'groups', groups, complete });
  await until('directory written', async () => {
    const rows = await h.owner.query(
      `SELECT count(*)::int AS n FROM wa_device_groups WHERE device_id = $1 AND synced_at > now() - interval '5 seconds'`,
      [d.deviceId],
    );
    return (
      (rows.rows[0].n as number) >= Math.min(groups.length, groups.length + before) || undefined
    );
  });
  await sleep(30);
}

const uuidOf = async (d: Dev, groupId: string) =>
  (
    await h.owner.query(
      `SELECT uuid FROM wa_device_groups WHERE device_id = $1 AND group_jid = $2`,
      [d.deviceId, groupId],
    )
  ).rows[0]?.uuid as string;
const rowOf = async (d: Dev, groupId: string) =>
  (
    await h.owner.query(`SELECT * FROM wa_device_groups WHERE device_id = $1 AND group_jid = $2`, [
      d.deviceId,
      groupId,
    ])
  ).rows[0] as Record<string, unknown> | undefined;
const outbox = async (orgId: number, type: string) =>
  (
    await h.owner.query(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
      [orgId, type],
    )
  ).rows.map((x) => x.payload as Record<string, unknown>);
const audits = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT action, delta FROM audit_log WHERE org_id = $1 AND module = 'wa_device_groups' ORDER BY id`,
      [orgId],
    )
  ).rows as Array<{ action: string; delta: Record<string, { new: unknown }> }>;
const eventNames = async (orgId: number) =>
  (await audits(orgId)).map((a) => String(a.delta.event?.new ?? ''));

let keySeq = 0;
const get = (token: string, path: string) => api.http().get(path).set(bearer(token));
const post = (token: string, path: string, body: object = {}, key?: string) =>
  api
    .http()
    .post(path)
    .set(bearer(token))
    .set('idempotency-key', key ?? `k-${Date.now()}-${keySeq++}`)
    .send(body);
const patch = (token: string, path: string, body: object) =>
  api
    .http()
    .patch(path)
    .set(bearer(token))
    .set('idempotency-key', `k-${Date.now()}-${keySeq++}`)
    .send(body);
const del = (token: string, path: string, body?: object) =>
  api
    .http()
    .delete(path)
    .set(bearer(token))
    .set('idempotency-key', `k-${Date.now()}-${keySeq++}`)
    .send(body);

const boom = (code: number, text = 'refused') =>
  Object.assign(new Error(text), { isBoom: true, data: code });

const GID = '120363000000000001';

// --- the gate, permissions and tenancy -------------------------------------------------------------------------------------------

describe('the gate, the permission matrix and the other workspace', () => {
  it('answers 422 WA_UNOFFICIAL_DISABLED while the workspace is off the allow-list, before touching anything', async () => {
    const d = await connected('gateoff');
    await h.owner.query(`DELETE FROM unofficial_whatsapp_workspaces WHERE org_id = $1`, [
      d.t.orgId,
    ]);
    for (const res of [
      await get(d.t.admin, d.base),
      await get(d.t.admin, `${d.base}/state`),
      await post(d.t.admin, d.base, {
        subject: 'x',
        numbers: ['+919800000001'],
        acknowledgeRisk: true,
      }),
    ]) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('WA_UNOFFICIAL_DISABLED');
    }
    expect(d.socket.groupCalls).toEqual([]);
  });

  it('each key opens exactly its routes', async () => {
    const d = await connected('matrix');
    await seed(d, [snap(d, GID)]);
    const gid = await uuidOf(d, GID);
    const reader = await api.member(d.t, 'reader', [['wa.groups.read']]);
    const manager = await api.member(d.t, 'manager', [['wa.groups.read'], ['wa.groups.manage']]);
    const creator = await api.member(d.t, 'creator', [['wa.groups.create']]);
    const leaver = await api.member(d.t, 'leaver', [['wa.groups.leave']]);
    const nobody = await api.member(d.t, 'nobody', []);

    // read: list, state, detail, refresh; not members, not changes
    for (const path of [d.base, `${d.base}/state`, `${d.base}/${gid}`])
      expect((await get(reader.token, path)).status).toBe(200);
    expect((await get(reader.token, `${d.base}/${gid}/participants`)).status).toBe(403);
    expect((await get(reader.token, `${d.base}/${gid}/join-requests`)).status).toBe(403);
    expect((await get(reader.token, `${d.base}/${gid}/invite-link`)).status).toBe(403);
    expect((await patch(reader.token, `${d.base}/${gid}`, { subject: 'X' })).status).toBe(403);
    expect((await post(reader.token, `${d.base}/${gid}/leave`, { confirm: true })).status).toBe(
      403,
    );
    expect(
      (
        await post(reader.token, d.base, {
          subject: 'X',
          numbers: ['+919800000001'],
          acknowledgeRisk: true,
        })
      ).status,
    ).toBe(403);

    // manage: members, requests, link, changes; not create, not leave
    expect((await get(manager.token, `${d.base}/${gid}/participants`)).status).toBe(200);
    expect((await get(manager.token, `${d.base}/${gid}/join-requests`)).status).toBe(200);
    expect((await post(manager.token, `${d.base}/${gid}/leave`, { confirm: true })).status).toBe(
      403,
    );
    expect(
      (
        await post(manager.token, d.base, {
          subject: 'X',
          numbers: ['+919800000001'],
          acknowledgeRisk: true,
        })
      ).status,
    ).toBe(403);

    // create alone opens create and nothing else; leave alone opens leave and nothing else
    expect((await get(creator.token, d.base)).status).toBe(403);
    expect((await get(leaver.token, d.base)).status).toBe(403);
    expect((await get(nobody.token, d.base)).status).toBe(403);
    d.socket.groupReplies.leave = { ok: true };
    expect((await post(leaver.token, `${d.base}/${gid}/leave`, { confirm: true })).status).toBe(
      200,
    );
    // and nothing reached WhatsApp for a refused call
    expect(d.socket.groupCalls.map((c) => c.type)).toEqual(['leave']);
  });

  it("another workspace's number and groups are 404, never 403", async () => {
    const a = await connected('tenantA');
    const b = await connected('tenantB');
    await seed(a, [snap(a, GID)]);
    const gid = await uuidOf(a, GID);
    // B's admin asks about A's number
    expect((await get(b.t.admin, a.base)).status).toBe(404);
    expect((await get(b.t.admin, `${a.base}/state`)).status).toBe(404);
    expect((await get(b.t.admin, `${a.base}/${gid}`)).status).toBe(404);
    expect((await patch(b.t.admin, `${a.base}/${gid}`, { subject: 'Hijack' })).status).toBe(404);
    // B's admin asks about A's group through B's own number
    const cross = await get(b.t.admin, `${b.base}/${gid}`);
    expect(cross.status).toBe(404);
    expect(cross.body.code).toBe(ERROR_CODES.WA_GROUP_NOT_FOUND);
    expect(a.socket.groupCalls).toEqual([]);
  });

  it('a device that is not connected answers 409 WA_GROUP_DEVICE_NOT_READY and spends no limiter budget', async () => {
    const t = await api.signup('notready');
    const row = (
      await h.owner.query(
        `INSERT INTO devices (org_id, device_name, country_code, phone_number, phone_digits, status, active)
         VALUES ($1, 'Off', '+91', '9011111111', '919011111111', 'disconnected', false) RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    const base = `/v2/devices/${row.uuid}/groups`;
    const state = await get(t.admin, `${base}/state`);
    expect(state.body).toMatchObject({ connected: false, reason: 'not_connected' });
    const res = await post(t.admin, base, {
      subject: 'x',
      numbers: ['+919800000001'],
      acknowledgeRisk: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ERROR_CODES.WA_GROUP_DEVICE_NOT_READY);
    expect(await r.control.groupLimiter.peek(t.orgId, Number(row.id))).toMatchObject({
      opsPerMinute: { remaining: 20 },
      createsPerDay: { remaining: 5 },
    });
  });

  it('a connected device that no worker holds answers 409 too (device not owned)', async () => {
    const t = await api.signup('notowned');
    const row = (
      await h.owner.query(
        `INSERT INTO devices (org_id, device_name, country_code, phone_number, phone_digits, status, active)
         VALUES ($1, 'Orphan', '+91', '9022222222', '919022222222', 'connected', true) RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    const base = `/v2/devices/${row.uuid}/groups`;
    const state = await get(t.admin, `${base}/state`);
    expect(state.body).toMatchObject({ connected: true, reason: 'worker_unavailable' });
    r.control.local = null;
    const res = await post(t.admin, base, {
      subject: 'x',
      numbers: ['+919800000001'],
      acknowledgeRisk: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ERROR_CODES.WA_GROUP_DEVICE_NOT_READY);
  });
});

// --- reading ------------------------------------------------------------------------------------------------------------------------

describe('list, detail and state read the directory', () => {
  it('lists newest first by keyset, with stats over every group, and never a number or a code', async () => {
    const d = await connected('list');
    await seed(d, [snap(d, `${GID}1`), snap(d, `${GID}2`), snap(d, `${GID}3`, { isAdmin: false })]);
    const first = await get(d.t.admin, `${d.base}?limit=2`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.page.hasMore).toBe(true);
    expect(first.body.stats).toEqual({ groups: 3, members: 6, joinRequests: 0, admin: 2, left: 0 });
    const second = await get(d.t.admin, `${d.base}?limit=2&cursor=${first.body.page.nextCursor}`);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.page.hasMore).toBe(false);
    const seen = [...first.body.items, ...second.body.items].map(
      (g: { groupId: string }) => g.groupId,
    );
    expect(new Set(seen).size).toBe(3);

    const text = JSON.stringify(first.body);
    expect(text).not.toMatch(/9190000000|@s\.whatsapp\.net|@lid/);
    expect(text).not.toMatch(/invite_?code|chat\.whatsapp\.com/i);
    const one = first.body.items[0];
    expect(one.participantsPreview[0]).toEqual({ name: 'Me', admin: 'superadmin' });
    expect(Object.keys(one.participantsPreview[0]).sort()).toEqual(['admin', 'name']);
  });

  it('filters by subject and by left, and stats do not move with the filter', async () => {
    const d = await connected('filter');
    await seed(d, [
      snap(d, `${GID}1`, { subject: 'Alpha club' }),
      snap(d, `${GID}2`, { subject: 'Beta' }),
    ]);
    await seed(d, [snap(d, `${GID}1`, { subject: 'Alpha club' })], true); // Beta vanishes: left
    const q = await get(d.t.admin, `${d.base}?q=alph`);
    expect(q.body.items.map((g: { subject: string }) => g.subject)).toEqual(['Alpha club']);
    const left = await get(d.t.admin, `${d.base}?status=left`);
    expect(left.body.items.map((g: { subject: string }) => g.subject)).toEqual(['Beta']);
    const active = await get(d.t.admin, `${d.base}?status=active`);
    expect(active.body.items).toHaveLength(1);
    expect(active.body.stats).toMatchObject({ groups: 2, left: 1 });
  });

  it('state says ready, what is left of the limits and when the directory was last read', async () => {
    const d = await connected('state');
    await seed(d, [snap(d, GID)]);
    const s = await get(d.t.admin, `${d.base}/state`);
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({
      deviceId: d.uuid,
      connected: true,
      reason: 'ready',
      joinByLinkEnabled: false,
      limits: {
        participantsPerCall: 20,
        cooldownUntil: null,
        opsPerMinute: { limit: 20, remaining: 20 },
      },
    });
    expect(s.body.lastSyncedAt).toEqual(expect.any(String));
  });

  it('members are paged from the cached roster with E.164 numbers and the self flag, and can be searched', async () => {
    const d = await connected('members');
    await seed(d, [snap(d, GID, { size: 3 })]);
    const gid = await uuidOf(d, GID);
    const res = await get(d.t.admin, `${d.base}/${gid}/participants?limit=1`);
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0]).toMatchObject({
      phone: `+${d.digits}`,
      self: true,
      admin: 'superadmin',
    });
    expect(res.body.page.hasMore).toBe(true);
    const next = await get(
      d.t.admin,
      `${d.base}/${gid}/participants?limit=1&cursor=${res.body.page.nextCursor}`,
    );
    expect(next.body.members[0]).toMatchObject({ phone: '+919000000002', self: false });
    const found = await get(d.t.admin, `${d.base}/${gid}/participants?q=ash`);
    expect(found.body.members.map((m: { name: string }) => m.name)).toEqual(['Asha']);
    expect((await get(d.t.admin, `${d.base}/${gid}/participants?cursor=zzz`)).status).toBe(422);
  });
});

// --- create -----------------------------------------------------------------------------------------------------------------------

describe('create', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    subject: 'Launch crew',
    description: 'Plans',
    numbers: ['+919800000001', '+919800000002'],
    acknowledgeRisk: true,
    ...over,
  });

  it('creates through the socket, answers per number, stores the row and audits and announces it once', async () => {
    const d = await connected('create');
    d.socket.groupReplies.create = (a) => ({
      group: snap(d, '120363000000000099', {
        subject: (a as { subject: string }).subject,
        description: 'Plans',
      }),
      participants: [
        { jid: '919800000001@s.whatsapp.net', status: '200' },
        { jid: '919800000002@s.whatsapp.net', status: '403' },
      ],
      descriptionSet: true,
    });
    const key = 'create-1';
    const res = await post(d.t.admin, d.base, body(), key);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.group).toMatchObject({
      subject: 'Launch crew',
      isAdmin: true,
      groupId: '120363000000000099',
      left: false,
      deviceId: d.uuid,
    });
    expect(res.body.participants).toEqual({
      okCount: 1,
      failCount: 1,
      results: [
        { number: '+919800000001', outcome: 'ok', code: '200' },
        { number: '+919800000002', outcome: 'privacy_blocked', code: '403' },
      ],
    });
    expect(res.body.descriptionSet).toBe(true);
    expect(d.socket.groupCalls).toEqual([
      {
        type: 'create',
        subject: 'Launch crew',
        participants: ['919800000001', '919800000002'],
        description: 'Plans',
      },
    ]);
    const row = await rowOf(d, '120363000000000099');
    expect(Number(row?.created_by_user_id)).toBe(d.t.adminUserId);
    expect(await eventNames(d.t.orgId)).toEqual(['wa.group.create']);
    expect(await outbox(d.t.orgId, 'whatsapp.device_group.created')).toHaveLength(1);
    // the audit row names counts, not numbers
    expect(JSON.stringify(await audits(d.t.orgId))).not.toMatch(/919800000001/);

    // the same key replays the answer and does not call WhatsApp again
    const again = await post(d.t.admin, d.base, body(), key);
    expect(again.status).toBe(201);
    expect(again.body.group.id).toBe(res.body.group.id);
    expect(d.socket.groupCalls).toHaveLength(1);
  });

  it('refuses before WhatsApp: no confirmation, more than 20, the number itself, a bad number', async () => {
    const d = await connected('createbad');
    const many = Array.from({ length: 21 }, (_, i) => `+9198000${String(10000 + i)}`);
    expect((await post(d.t.admin, d.base, body({ acknowledgeRisk: false }))).status).toBe(422);
    expect((await post(d.t.admin, d.base, body({ numbers: many }))).status).toBe(422);
    expect((await post(d.t.admin, d.base, body({ numbers: ['9876'] }))).status).toBe(422);
    const self = await post(d.t.admin, d.base, body({ numbers: [`+${d.digits}`] }));
    expect(self.status).toBe(422);
    expect(self.body.code).toBe(ERROR_CODES.WA_GROUP_INVALID_NUMBER);
    expect(d.socket.groupCalls).toEqual([]);
    expect(await r.control.groupLimiter.peek(d.t.orgId, d.deviceId)).toMatchObject({
      createsPerDay: { remaining: 5 },
    });
  });

  it('five creates a day: the sixth is a 429 with the day scope', async () => {
    const d = await connected('createcap');
    Object.assign(r.control.groupLimiter.limits, { createsPerDay: 1 });
    d.socket.groupReplies.create = {
      group: snap(d, '120363000000000098'),
      participants: [{ jid: '919800000001@s.whatsapp.net', status: '200' }],
      descriptionSet: true,
    };
    expect((await post(d.t.admin, d.base, body())).status).toBe(201);
    const second = await post(d.t.admin, d.base, body({ subject: 'Another' }));
    expect(second.status).toBe(429);
    expect(second.body.code).toBe(ERROR_CODES.WA_GROUP_RATE_LIMITED);
    expect(second.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'scope', message: 'creates_day' }),
        expect.objectContaining({ path: 'retryAfterS' }),
      ]),
    );
    expect(d.socket.groupCalls.filter((c) => c.type === 'create')).toHaveLength(1);
  });
});

// --- update ---------------------------------------------------------------------------------------------------------------------

describe('update', () => {
  it('sends one call per changed field, stores what applied, audits the field names and announces it', async () => {
    const d = await connected('update');
    await seed(d, [snap(d, GID, { subject: 'Old' })]);
    const gid = await uuidOf(d, GID);
    const res = await patch(d.t.admin, `${d.base}/${gid}`, {
      subject: 'New name',
      announce: true,
      restrict: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ subject: 'New name', announce: true, restrict: false });
    // `restrict: false` equals the stored value, so it costs no call
    expect(d.socket.groupCalls.map((c) => c.type)).toEqual(['subject', 'settings']);
    expect(d.socket.groupCalls[1]).toMatchObject({ setting: 'announcement' });
    const a = (await audits(d.t.orgId)).at(-1)!;
    expect(a.delta.fields.new).toEqual(['subject', 'announce']);
    const events = await outbox(d.t.orgId, 'whatsapp.device_group.updated');
    expect(events.at(-1)).toMatchObject({ changed: ['subject', 'settings'] });
    expect(JSON.stringify(events)).not.toContain('New name');
    // a repeat of the same change asks nothing of WhatsApp
    const repeat = await patch(d.t.admin, `${d.base}/${gid}`, { subject: 'New name' });
    expect(repeat.status).toBe(200);
    expect(d.socket.groupCalls).toHaveLength(2);
  });

  it('keeps what applied when a later call fails, and says what failed', async () => {
    const d = await connected('updatepartial');
    await seed(d, [snap(d, GID, { subject: 'Old' })]);
    const gid = await uuidOf(d, GID);
    d.socket.groupReplies.settings = boom(401, 'not-authorized');
    const res = await patch(d.t.admin, `${d.base}/${gid}`, {
      subject: 'Half done',
      announce: true,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ERROR_CODES.WA_GROUP_NOT_ADMIN);
    expect((await rowOf(d, GID))?.subject).toBe('Half done');
    expect((await rowOf(d, GID))?.announce).toBe(false);
    // a plain refusal is not a ban signal: no cooldown
    expect((await r.control.groupLimiter.peek(d.t.orgId, d.deviceId)).cooldownUntil).toBeNull();
  });

  it('refuses an admin-only change from a plain member before calling WhatsApp', async () => {
    const d = await connected('updatemember');
    await seed(d, [snap(d, GID, { isAdmin: false, restrict: true })]);
    const gid = await uuidOf(d, GID);
    const settings = await patch(d.t.admin, `${d.base}/${gid}`, { announce: true });
    expect(settings.status).toBe(403);
    expect(settings.body.code).toBe(ERROR_CODES.WA_GROUP_NOT_ADMIN);
    const text = await patch(d.t.admin, `${d.base}/${gid}`, { subject: 'Mine' });
    expect(text.status).toBe(403);
    expect(d.socket.groupCalls).toEqual([]);
  });

  it('lets a plain member rename a group that is not "admins only edit"', async () => {
    const d = await connected('updateopen');
    await seed(d, [snap(d, GID, { isAdmin: false, restrict: false })]);
    const gid = await uuidOf(d, GID);
    const res = await patch(d.t.admin, `${d.base}/${gid}`, { subject: 'Ours' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(d.socket.groupCalls.map((c) => c.type)).toEqual(['subject']);
  });

  it('needs at least one field, and the limits of the subject and description', async () => {
    const d = await connected('updatebad');
    await seed(d, [snap(d, GID)]);
    const gid = await uuidOf(d, GID);
    expect((await patch(d.t.admin, `${d.base}/${gid}`, {})).status).toBe(422);
    expect((await patch(d.t.admin, `${d.base}/${gid}`, { subject: 'x'.repeat(61) })).status).toBe(
      422,
    );
    expect(
      (await patch(d.t.admin, `${d.base}/${gid}`, { description: 'x'.repeat(513) })).status,
    ).toBe(422);
  });
});

// --- participants -------------------------------------------------------------------------------------------------------------------

describe('participants', () => {
  it('adds people and answers per number; the roster and size follow', async () => {
    const d = await connected('add');
    await seed(d, [snap(d, GID)]);
    const gid = await uuidOf(d, GID);
    d.socket.groupReplies.participants = {
      participants: [
        { jid: '919800000001@s.whatsapp.net', status: '200' },
        { jid: '919800000002@s.whatsapp.net', status: '404' },
        { jid: '919000000002@s.whatsapp.net', status: '409' },
      ],
    };
    const res = await post(d.t.admin, `${d.base}/${gid}/participants`, {
      action: 'add',
      numbers: ['+919800000001', '+919800000002', '+919000000002'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.results.map((x: { outcome: string }) => x.outcome)).toEqual([
      'ok',
      'not_on_whatsapp',
      'already_member',
    ]);
    expect(res.body).toMatchObject({ okCount: 1, failCount: 2 });
    expect(d.socket.groupCalls[0]).toEqual({
      type: 'participants',
      groupJid: GID,
      participants: ['919800000001', '919800000002', '919000000002'],
      change: 'add',
    });
    const row = await rowOf(d, GID);
    expect(row?.size).toBe(3);
    expect((row?.participants as Array<{ phone: string }>).map((m) => m.phone)).toContain(
      '919800000001',
    );
    expect(await outbox(d.t.orgId, 'whatsapp.device_group.participants_changed')).toEqual([
      expect.objectContaining({ added: 1, removed: 0, size: 3 }),
    ]);
    expect((await audits(d.t.orgId)).at(-1)!.delta).toMatchObject({
      event: { new: 'wa.group.participants_add' },
      asked: { new: 3 },
      done: { new: 1 },
    });
  });

  it('removes, promotes and demotes with per-number results', async () => {
    const d = await connected('change');
    await seed(d, [snap(d, GID)]);
    const gid = await uuidOf(d, GID);
    const reply = (status: string) => ({
      participants: [{ jid: '919000000002@s.whatsapp.net', status }],
    });
    d.socket.groupReplies.participants = reply('200');
    const up = await post(d.t.admin, `${d.base}/${gid}/participants`, {
      action: 'promote',
      numbers: ['+919000000002'],
    });
    expect(up.body.results).toEqual([{ number: '+919000000002', outcome: 'ok', code: '200' }]);
    expect(
      ((await rowOf(d, GID))?.participants as Array<{ phone: string; admin: string | null }>)[1]!
        .admin,
    ).toBe('admin');
    const down = await post(d.t.admin, `${d.base}/${gid}/participants`, {
      action: 'demote',
      numbers: ['+919000000002'],
    });
    expect(down.body.okCount).toBe(1);
    d.socket.groupReplies.participants = reply('404');
    const miss = await del(d.t.admin, `${d.base}/${gid}/participants`, {
      numbers: ['+919000000002'],
    });
    expect(miss.status).toBe(200);
    expect(miss.body.results[0]).toMatchObject({ outcome: 'not_member', code: '404' });
    d.socket.groupReplies.participants = reply('200');
    const gone = await del(d.t.admin, `${d.base}/${gid}/participants`, {
      numbers: ['+919000000002'],
    });
    expect(gone.body.okCount).toBe(1);
    expect((await rowOf(d, GID))?.size).toBe(1);
  });

  it('refuses before WhatsApp: not admin, the number itself, more than 20, an empty list, a left group', async () => {
    const d = await connected('refuse');
    await seed(d, [
      snap(d, GID, { isAdmin: false, memberAddMode: 'admin_add' }),
      snap(d, `${GID}2`),
    ]);
    const member = await uuidOf(d, GID);
    const admin = await uuidOf(d, `${GID}2`);
    const add = await post(d.t.admin, `${d.base}/${member}/participants`, {
      action: 'add',
      numbers: ['+919800000001'],
    });
    expect(add.status).toBe(403);
    expect(add.body.code).toBe(ERROR_CODES.WA_GROUP_NOT_ADMIN);
    expect(
      (await del(d.t.admin, `${d.base}/${member}/participants`, { numbers: ['+919800000001'] }))
        .status,
    ).toBe(403);
    expect(
      (
        await post(d.t.admin, `${d.base}/${admin}/participants`, {
          action: 'promote',
          numbers: [`+${d.digits}`],
        })
      ).body.code,
    ).toBe(ERROR_CODES.WA_GROUP_INVALID_NUMBER);
    const many = Array.from({ length: 21 }, (_, i) => `+9198000${String(10000 + i)}`);
    expect(
      (await post(d.t.admin, `${d.base}/${admin}/participants`, { action: 'add', numbers: many }))
        .status,
    ).toBe(422);
    expect(
      (await post(d.t.admin, `${d.base}/${admin}/participants`, { action: 'add', numbers: [] }))
        .status,
    ).toBe(422);
    expect(
      (
        await post(d.t.admin, `${d.base}/${admin}/participants`, {
          action: 'remove',
          numbers: ['+919800000001'],
        })
      ).status,
    ).toBe(422);
    await h.owner.query(
      `UPDATE wa_device_groups SET left_at = now() WHERE device_id = $1 AND group_jid = $2`,
      [d.deviceId, `${GID}2`],
    );
    const left = await post(d.t.admin, `${d.base}/${admin}/participants`, {
      action: 'add',
      numbers: ['+919800000001'],
    });
    expect(left.status).toBe(409);
    expect(left.body.code).toBe(ERROR_CODES.WA_GROUP_LEFT);
    expect(d.socket.groupCalls).toEqual([]);
  });

  it('lets a plain member add when the group lets members add', async () => {
    const d = await connected('memberadd');
    await seed(d, [snap(d, GID, { isAdmin: false, memberAddMode: 'all_member_add' })]);
    const gid = await uuidOf(d, GID);
    d.socket.groupReplies.participants = {
      participants: [{ jid: '919800000001@s.whatsapp.net', status: '200' }],
    };
    const res = await post(d.t.admin, `${d.base}/${gid}/participants`, {
      action: 'add',
      numbers: ['+919800000001'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const promote = await post(d.t.admin, `${d.base}/${gid}/participants`, {
      action: 'promote',
      numbers: ['+919800000001'],
    });
    expect(promote.status).toBe(403);
  });
});

// --- the ban-safety limiter -----------------------------------------------------------------------------------------------------

describe('the per-number limiter', () => {
  it('answers 429 with retryAfterS and the scope once the minute budget is spent, without reaching WhatsApp', async () => {
    const d = await connected('limit');
    await seed(d, [snap(d, GID)]);
    const gid = await uuidOf(d, GID);
    Object.assign(r.control.groupLimiter.limits, { opsPerMinute: 2 });
    d.socket.groupReplies.participants = {
      participants: [{ jid: '919800000001@s.whatsapp.net', status: '200' }],
    };
    const call = () =>
      post(d.t.admin, `${d.base}/${gid}/participants`, {
        action: 'add',
        numbers: ['+919800000001'],
      });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const third = await call();
    expect(third.status).toBe(429);
    expect(third.body.code).toBe(ERROR_CODES.WA_GROUP_RATE_LIMITED);
    expect(third.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'scope', message: 'ops_minute' }),
        expect.objectContaining({ path: 'retryAfterS' }),
      ]),
    );
    expect(d.socket.groupCalls).toHaveLength(2);
    const state = await get(d.t.admin, `${d.base}/state`);
    expect(state.body.limits.opsPerMinute).toMatchObject({ limit: 2, remaining: 0 });
  });

  it("WhatsApp's own refusal starts the cooldown: this call is 502, the next ones 429 until it ends", async () => {
    const d = await connected('cooldown');
    await seed(d, [snap(d, GID)]);
    const gid = await uuidOf(d, GID);
    d.socket.groupReplies.participants = boom(403, 'forbidden');
    const first = await post(d.t.admin, `${d.base}/${gid}/participants`, {
      action: 'add',
      numbers: ['+919800000001'],
    });
    expect(first.status).toBe(502);
    expect(first.body.code).toBe(ERROR_CODES.WA_GROUP_UNAVAILABLE);
    const next = await post(d.t.admin, `${d.base}/${gid}/participants`, {
      action: 'add',
      numbers: ['+919800000001'],
    });
    expect(next.status).toBe(429);
    expect(next.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'scope', message: 'cooldown' })]),
    );
    const state = await get(d.t.admin, `${d.base}/state`);
    expect(state.body.limits.cooldownUntil).toEqual(expect.any(String));
    expect(d.socket.groupCalls).toHaveLength(1);
  });

  it('a refusal by WhatsApp that is not a limit signal maps to its own code and starts no cooldown', async () => {
    const d = await connected('mapping');
    await seed(d, [snap(d, GID)]);
    const gid = await uuidOf(d, GID);
    d.socket.groupReplies.participants = boom(419, 'resource-limit');
    const full = await post(d.t.admin, `${d.base}/${gid}/participants`, {
      action: 'add',
      numbers: ['+919800000001'],
    });
    expect(full.status).toBe(422);
    expect(full.body.code).toBe(ERROR_CODES.WA_GROUP_LIMIT_REACHED);
    expect((await r.control.groupLimiter.peek(d.t.orgId, d.deviceId)).cooldownUntil).toBeNull();
  });
});

// --- join requests --------------------------------------------------------------------------------------------------------------------

describe('join requests', () => {
  it('a request event fills the queue, approve and reject answer per person and empty it', async () => {
    const d = await connected('requests');
    await seed(d, [snap(d, GID, { joinApproval: true })]);
    const gid = await uuidOf(d, GID);
    d.socket.emit({
      type: 'group_event',
      event: {
        kind: 'join_request',
        groupId: GID,
        participant: '919800000009@s.whatsapp.net',
        author: null,
        action: 'created',
        method: 'invite_link',
      },
    });
    d.socket.emit({
      type: 'group_event',
      event: {
        kind: 'join_request',
        groupId: GID,
        participant: '919800000008@s.whatsapp.net',
        author: null,
        action: 'created',
        method: 'invite_link',
      },
    });
    await until(
      'queue stored',
      async () =>
        (((await rowOf(d, GID))?.join_requests as unknown[]) ?? []).length === 2 || undefined,
    );

    const list = await get(d.t.admin, `${d.base}/${gid}/join-requests`);
    expect(list.body.requests.map((x: { phone: string }) => x.phone).sort()).toEqual([
      '+919800000008',
      '+919800000009',
    ]);
    expect((await get(d.t.admin, `${d.base}/${gid}`)).body.pendingRequestCount).toBe(2);
    expect(await outbox(d.t.orgId, 'whatsapp.device_group.join_request')).toHaveLength(2);

    d.socket.groupReplies.join_request_update = (a) => ({
      participants: (a as { participants: string[] }).participants.map((jid) => ({
        jid,
        status: jid.startsWith('919800000008') ? '404' : '200',
      })),
    });
    const res = await post(d.t.admin, `${d.base}/${gid}/join-requests`, {
      action: 'approve',
      jids: ['919800000009@s.whatsapp.net', '919800000008@s.whatsapp.net'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.results.map((x: { outcome: string }) => x.outcome)).toEqual(['ok', 'failed']);
    expect(res.body.results[0].number).toBe('+919800000009');
    // only the one that went through leaves the queue
    const left = await get(d.t.admin, `${d.base}/${gid}/join-requests`);
    expect(left.body.requests.map((x: { jid: string }) => x.jid)).toEqual([
      '919800000008@s.whatsapp.net',
    ]);
    const reject = await post(d.t.admin, `${d.base}/${gid}/join-requests`, {
      action: 'reject',
      jids: ['919800000008@s.whatsapp.net'],
    });
    expect(reject.body.okCount).toBe(0);
    d.socket.groupReplies.join_request_update = {
      participants: [{ jid: '919800000008@s.whatsapp.net', status: '200' }],
    };
    const rejected = await post(d.t.admin, `${d.base}/${gid}/join-requests`, {
      action: 'reject',
      jids: ['919800000008@s.whatsapp.net'],
    });
    expect(rejected.body.okCount).toBe(1);
    expect((await get(d.t.admin, `${d.base}/${gid}/join-requests`)).body.requests).toEqual([]);
    expect(d.socket.groupCalls.map((c) => (c as { action?: string }).action)).toEqual([
      'approve',
      'reject',
      'reject',
    ]);
  });

  it('fresh=1 reads the queue from WhatsApp (the recovery path) and replaces the stored one; not for a plain member', async () => {
    const d = await connected('fresh');
    await seed(d, [snap(d, GID), snap(d, `${GID}2`, { isAdmin: false })]);
    const gid = await uuidOf(d, GID);
    d.socket.groupReplies.join_requests = {
      requests: [
        {
          jid: '919800000007@s.whatsapp.net',
          phone: '919800000007',
          lid: null,
          name: 'Ravi',
          requestedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const res = await get(d.t.admin, `${d.base}/${gid}/join-requests?fresh=1`);
    expect(res.status).toBe(200);
    expect(res.body.requests).toEqual([
      {
        jid: '919800000007@s.whatsapp.net',
        phone: '+919800000007',
        name: 'Ravi',
        requestedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect((await get(d.t.admin, `${d.base}/${gid}`)).body.pendingRequestCount).toBe(1);
    const other = await uuidOf(d, `${GID}2`);
    const plain = await get(d.t.admin, `${d.base}/${other}/join-requests?fresh=1`);
    expect(plain.status).toBe(403);
    expect(d.socket.groupCalls.filter((c) => c.type === 'join_requests')).toHaveLength(1);
  });
});

// --- invite link ----------------------------------------------------------------------------------------------------------------------

describe('the invite link', () => {
  const CODE = 'AbCdEf1234567890abcdef';
  const NEW_CODE = 'ZyXwVu9876543210zyxwvu';

  it('is returned only by its own routes, and never reaches the audit trail, the events or the logs', async () => {
    const d = await connected('invite');
    await seed(d, [snap(d, GID)]);
    const gid = await uuidOf(d, GID);
    d.socket.groupReplies.invite = { code: CODE };
    d.socket.groupReplies.revoke_invite = { code: NEW_CODE };

    const first = await get(d.t.admin, `${d.base}/${gid}/invite-link`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toEqual({ code: CODE, url: `https://chat.whatsapp.com/${CODE}` });
    expect(first.headers['cache-control']).toBe('no-store');
    expect((await get(d.t.admin, `${d.base}/${gid}`)).body.hasInviteLink).toBe(true);
    // the held code is served without asking WhatsApp again
    expect((await get(d.t.admin, `${d.base}/${gid}/invite-link`)).body.code).toBe(CODE);
    expect(d.socket.groupCalls.filter((c) => c.type === 'invite')).toHaveLength(1);

    const reset = await post(d.t.admin, `${d.base}/${gid}/invite-link/reset`);
    expect(reset.status).toBe(200);
    expect(reset.body.code).toBe(NEW_CODE);
    expect((await get(d.t.admin, `${d.base}/${gid}/invite-link`)).body.code).toBe(NEW_CODE);

    // nowhere else
    const everything = JSON.stringify([
      (await get(d.t.admin, d.base)).body,
      (await get(d.t.admin, `${d.base}/${gid}`)).body,
      await audits(d.t.orgId),
      (await h.owner.query(`SELECT payload FROM event_outbox WHERE org_id = $1`, [d.t.orgId])).rows,
    ]);
    expect(everything).not.toContain(CODE);
    expect(everything).not.toContain(NEW_CODE);
    expect(await eventNames(d.t.orgId)).toEqual(
      expect.arrayContaining(['wa.group.invite_link_read', 'wa.group.invite_link_reset']),
    );
  });

  it('is refused to a plain member of the group and to a group the number left', async () => {
    const d = await connected('invitemember');
    await seed(d, [snap(d, GID, { isAdmin: false }), snap(d, `${GID}2`)]);
    const member = await uuidOf(d, GID);
    expect((await get(d.t.admin, `${d.base}/${member}/invite-link`)).status).toBe(403);
    expect((await post(d.t.admin, `${d.base}/${member}/invite-link/reset`)).status).toBe(403);
    await h.owner.query(
      `UPDATE wa_device_groups SET left_at = now() WHERE group_jid = $1 AND device_id = $2`,
      [`${GID}2`, d.deviceId],
    );
    const left = await get(d.t.admin, `${d.base}/${await uuidOf(d, `${GID}2`)}/invite-link`);
    expect(left.status).toBe(409);
    expect(d.socket.groupCalls).toEqual([]);
  });
});

// --- leaving -----------------------------------------------------------------------------------------------------------------------

describe('leave', () => {
  it('leaves through WhatsApp, keeps the row read-only, audits and announces it, and a second leave is 409', async () => {
    const d = await connected('leave');
    await seed(d, [snap(d, GID)]);
    const gid = await uuidOf(d, GID);
    d.socket.groupReplies.leave = { ok: true };
    expect((await post(d.t.admin, `${d.base}/${gid}/leave`, { confirm: false })).status).toBe(422);
    const res = await post(d.t.admin, `${d.base}/${gid}/leave`, { confirm: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ left: true, isAdmin: false, hasInviteLink: false });
    expect(res.body.leftAt).toEqual(expect.any(String));
    expect(await outbox(d.t.orgId, 'whatsapp.device_group.left')).toEqual([
      expect.objectContaining({ removed: false }),
    ]);
    expect(await eventNames(d.t.orgId)).toContain('wa.group.leave');
    const again = await post(d.t.admin, `${d.base}/${gid}/leave`, { confirm: true });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe(ERROR_CODES.WA_GROUP_LEFT);
    expect((await patch(d.t.admin, `${d.base}/${gid}`, { subject: 'Nope' })).status).toBe(409);
    expect(d.socket.groupCalls.map((c) => c.type)).toEqual(['leave']);
    // the row is still listed, as left
    expect((await get(d.t.admin, `${d.base}?status=left`)).body.items).toHaveLength(1);
  });

  it('treats "WhatsApp no longer has this group" as already left', async () => {
    const d = await connected('leavegone');
    await seed(d, [snap(d, GID)]);
    const gid = await uuidOf(d, GID);
    d.socket.groupReplies.leave = boom(404, 'item-not-found');
    const res = await post(d.t.admin, `${d.base}/${gid}/leave`, { confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.left).toBe(true);
  });
});

// --- picture ----------------------------------------------------------------------------------------------------------------------

describe('the group picture', () => {
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64),
  ]);

  it('sends a PNG to the socket, refuses a non-image or one over 5 MB, and removes it', async () => {
    const d = await connected('picture');
    await seed(d, [snap(d, GID)]);
    const gid = await uuidOf(d, GID);
    d.socket.groupReplies.picture = { ok: true };
    const put = (buf: Buffer, name: string, type: string) =>
      api
        .http()
        .put(`${d.base}/${gid}/picture`)
        .set(bearer(d.t.admin))
        .set('idempotency-key', `pic-${keySeq++}`)
        .attach('file', buf, { filename: name, contentType: type });
    const ok = await put(PNG, 'a.png', 'image/png');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(d.socket.groupCalls[0]).toMatchObject({ type: 'picture', groupJid: GID });
    // the declared type is not trusted
    const fake = await put(Buffer.from('<svg></svg>'), 'a.png', 'image/png');
    expect(fake.status).toBe(422);
    const big = await put(
      Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]),
      'big.png',
      'image/png',
    );
    expect(big.status).toBe(422);
    const none = await api
      .http()
      .put(`${d.base}/${gid}/picture`)
      .set(bearer(d.t.admin))
      .set('idempotency-key', 'pic-none')
      .send({});
    expect(none.status).toBe(422);
    const removed = await del(d.t.admin, `${d.base}/${gid}/picture`);
    expect(removed.status).toBe(200);
    expect(d.socket.groupCalls[1]).toMatchObject({ type: 'picture', remove: true });
    expect(d.socket.groupCalls).toHaveLength(2);
    expect(await eventNames(d.t.orgId)).toEqual(
      expect.arrayContaining(['wa.group.picture', 'wa.group.picture_remove']),
    );
  });
});

// --- join by link -----------------------------------------------------------------------------------------------------------------------

describe('join by invite link', () => {
  const CODE = 'AbCdEf1234567890abcdef';
  const body = { invite: `https://chat.whatsapp.com/${CODE}`, acknowledgeRisk: true };

  it('is off unless the platform enables it: 422 WA_GROUP_JOIN_BY_LINK_DISABLED, nothing asked of WhatsApp', async () => {
    const d = await connected('joinoff');
    for (const path of [`${d.base}/join-by-link/preview`, `${d.base}/join-by-link`]) {
      const res = await post(d.t.admin, path, body);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ERROR_CODES.WA_GROUP_JOIN_BY_LINK_DISABLED);
    }
    expect(d.socket.groupCalls).toEqual([]);
    expect((await get(d.t.admin, `${d.base}/state`)).body.joinByLinkEnabled).toBe(false);
  });

  it('previews then joins, with its own cap, and a bad link is 422', async () => {
    const d = await connected('joinon');
    Object.assign(r.control.groupLimiter.limits, { joinByLinkEnabled: true, joinByLinkPerDay: 3 });
    d.socket.groupReplies.get_invite_info = {
      invite: {
        groupId: '120363000000000077',
        subject: 'Open club',
        description: null,
        size: 40,
        joinApproval: false,
      },
    };
    d.socket.groupReplies.accept_invite = {
      joined: { groupId: '120363000000000077', requested: false },
    };
    d.socket.groupReplies.metadata = {
      group: snap(d, '120363000000000077', { subject: 'Open club' }),
    };
    expect((await get(d.t.admin, `${d.base}/state`)).body.joinByLinkEnabled).toBe(true);

    const preview = await post(d.t.admin, `${d.base}/join-by-link/preview`, { invite: CODE });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toEqual({
      subject: 'Open club',
      size: 40,
      alreadyMember: false,
      approvalRequired: false,
    });
    expect(d.socket.groupCalls[0]).toEqual({ type: 'get_invite_info', code: CODE });

    expect(
      (await post(d.t.admin, `${d.base}/join-by-link`, { ...body, acknowledgeRisk: false })).status,
    ).toBe(422);
    expect(
      (
        await post(d.t.admin, `${d.base}/join-by-link`, {
          invite: 'nonsense',
          acknowledgeRisk: true,
        })
      ).status,
    ).toBe(422);
    const join = await post(d.t.admin, `${d.base}/join-by-link`, body);
    expect(join.status, JSON.stringify(join.body)).toBe(200);
    expect(join.body.status).toBe('joined');
    expect(join.body.group).toMatchObject({ groupId: '120363000000000077', subject: 'Open club' });
    expect(await eventNames(d.t.orgId)).toContain('wa.group.join_by_link');
    expect(JSON.stringify(await audits(d.t.orgId))).not.toContain(CODE);

    const again = await post(d.t.admin, `${d.base}/join-by-link/preview`, { invite: CODE });
    expect(again.body.alreadyMember).toBe(true);
    // preview + join + preview = 3 joins of 3: the next one is capped
    const capped = await post(d.t.admin, `${d.base}/join-by-link/preview`, { invite: CODE });
    expect(capped.status).toBe(429);
    expect(capped.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'scope', message: 'join_link_day' }),
      ]),
    );
  });

  it('an invite that needs approval is "requested", with no group yet; a dead link maps to its code', async () => {
    const d = await connected('joinreq');
    Object.assign(r.control.groupLimiter.limits, { joinByLinkEnabled: true });
    d.socket.groupReplies.accept_invite = { joined: { groupId: null, requested: true } };
    const asked = await post(d.t.admin, `${d.base}/join-by-link`, body);
    expect(asked.body).toEqual({ status: 'requested', group: null });
    d.socket.groupReplies.accept_invite = boom(410, 'gone');
    const dead = await post(d.t.admin, `${d.base}/join-by-link`, body);
    expect(dead.status).toBe(422);
    expect(dead.body.code).toBe(ERROR_CODES.WA_GROUP_JOIN_LINK_INVALID);
  });
});

// --- refresh and the directory sync ------------------------------------------------------------------------------------------------

describe('refresh and the directory', () => {
  it('refresh re-reads one group, but not twice within ten seconds; a group WhatsApp no longer knows is marked left', async () => {
    const d = await connected('refresh');
    await seed(d, [snap(d, GID, { subject: 'Before' })]);
    const gid = await uuidOf(d, GID);
    d.socket.groupReplies.metadata = { group: snap(d, GID, { subject: 'After', size: 5 }) };
    // just synced: answered from the directory
    const quick = await post(d.t.admin, `${d.base}/${gid}/refresh`);
    expect(quick.body.subject).toBe('Before');
    expect(d.socket.groupCalls).toEqual([]);
    await h.owner.query(
      `UPDATE wa_device_groups SET synced_at = now() - interval '1 minute' WHERE uuid = $1`,
      [gid],
    );
    const res = await post(d.t.admin, `${d.base}/${gid}/refresh`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ subject: 'After', size: 5 });
    expect(await outbox(d.t.orgId, 'whatsapp.device_group.updated')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ changed: expect.arrayContaining(['subject']) }),
      ]),
    );
    await h.owner.query(
      `UPDATE wa_device_groups SET synced_at = now() - interval '1 minute' WHERE uuid = $1`,
      [gid],
    );
    d.socket.groupReplies.metadata = boom(404, 'item-not-found');
    const gone = await post(d.t.admin, `${d.base}/${gid}/refresh`);
    expect(gone.status).toBe(200);
    expect(gone.body.left).toBe(true);
  });

  it('sync reads the whole list, marks the vanished ones as left and is throttled to once a minute', async () => {
    const d = await connected('syncall');
    await seed(d, [snap(d, `${GID}1`), snap(d, `${GID}2`)]);
    d.socket.groupReplies.list = { groups: [snap(d, `${GID}1`, { subject: 'Kept' })] };
    const res = await post(d.t.admin, `${d.base}/sync`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ groups: 1, left: 1, throttled: false });
    expect((await rowOf(d, `${GID}2`))?.left_at).not.toBeNull();
    expect((await rowOf(d, `${GID}1`))?.subject).toBe('Kept');
    const throttled = await post(d.t.admin, `${d.base}/sync`);
    expect(throttled.body).toMatchObject({ throttled: true });
    expect(d.socket.groupCalls.filter((c) => c.type === 'list')).toHaveLength(1);
  });

  it('a complete read prunes what vanished (left_at, kept read-only) and a partial read never does; coming back clears it', async () => {
    const d = await connected('prune');
    await seed(d, [snap(d, `${GID}1`), snap(d, `${GID}2`)]);
    await seed(d, [snap(d, `${GID}1`, { subject: 'Renamed' })], false);
    expect((await rowOf(d, `${GID}2`))?.left_at).toBeNull();
    await seed(d, [snap(d, `${GID}1`)], true);
    expect((await rowOf(d, `${GID}2`))?.left_at).not.toBeNull();
    expect(await count(d)).toBe(2);
    expect(await outbox(d.t.orgId, 'whatsapp.device_group.left')).toEqual([
      expect.objectContaining({ removed: false }),
    ]);
    await seed(d, [snap(d, `${GID}1`), snap(d, `${GID}2`)], true);
    expect((await rowOf(d, `${GID}2`))?.left_at).toBeNull();
    const events = await outbox(d.t.orgId, 'whatsapp.device_group.created');
    expect(events.at(-1)).toMatchObject({ changed: ['rejoined'] });
  });

  it('keeps the legacy storefront directory filled and never touches a merchant ordering code', async () => {
    const d = await connected('legacy');
    await seed(d, [snap(d, GID, { subject: 'Customer group' })]);
    const jid = `${GID}@g.us`;
    const g = (
      await h.owner.query(`SELECT * FROM wa_groups WHERE org_id = $1 AND group_jid = $2`, [
        d.t.orgId,
        jid,
      ])
    ).rows[0];
    expect(g).toMatchObject({ subject: 'Customer group', device_phone: d.digits });
    expect(Number(g.size)).toBe(2);
    const members = (
      await h.owner.query(
        `SELECT phone, is_admin FROM wa_group_members WHERE org_id = $1 AND group_jid = $2 ORDER BY phone`,
        [d.t.orgId, jid],
      )
    ).rows;
    expect(members).toEqual(
      [
        { phone: '919000000002', is_admin: false },
        { phone: d.digits, is_admin: true },
      ].sort((a, b) => a.phone.localeCompare(b.phone)),
    );

    await h.owner.query(
      `UPDATE wa_groups SET group_code = 'VIP' WHERE org_id = $1 AND group_jid = $2`,
      [d.t.orgId, jid],
    );
    await seed(d, [
      snap(d, GID, {
        subject: 'Customer group',
        participants: [snap(d, GID).participants[0]!],
        size: 1,
      }),
    ]);
    const after = (
      await h.owner.query(
        `SELECT group_code, size FROM wa_groups WHERE org_id = $1 AND group_jid = $2`,
        [d.t.orgId, jid],
      )
    ).rows[0];
    expect(after.group_code).toBe('VIP');
    expect(Number(after.size)).toBe(1);
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM wa_group_members WHERE org_id = $1 AND group_jid = $2`,
          [d.t.orgId, jid],
        )
      ).rows[0].n,
    ).toBe(1);
    // a group the number left keeps its row and its code
    await seed(d, [], true);
    expect(
      (
        await h.owner.query(
          `SELECT group_code FROM wa_groups WHERE org_id = $1 AND group_jid = $2`,
          [d.t.orgId, jid],
        )
      ).rows[0].group_code,
    ).toBe('VIP');
  });

  it('a removal event by someone else marks the group left with removed: true; a leave of our own is not a removal', async () => {
    const d = await connected('removed');
    await seed(d, [snap(d, `${GID}1`), snap(d, `${GID}2`)]);
    d.socket.emit({
      type: 'group_event',
      event: {
        kind: 'participants',
        groupId: `${GID}1`,
        author: '919555000111@s.whatsapp.net',
        action: 'remove',
        participants: [`${d.digits}@s.whatsapp.net`],
        selfAffected: true,
      },
    });
    d.socket.emit({
      type: 'group_event',
      event: {
        kind: 'participants',
        groupId: `${GID}2`,
        author: `${d.digits}@s.whatsapp.net`,
        action: 'remove',
        participants: [`${d.digits}@s.whatsapp.net`],
        selfAffected: true,
      },
    });
    await until(
      'both left',
      async () =>
        (
          await h.owner.query(
            `SELECT count(*)::int AS n FROM wa_device_groups WHERE device_id = $1 AND left_at IS NOT NULL`,
            [d.deviceId],
          )
        ).rows[0].n === 2 || undefined,
    );
    const events = await outbox(d.t.orgId, 'whatsapp.device_group.left');
    expect(events.map((e) => e.removed).sort()).toEqual([false, true]);
    expect(JSON.stringify(events)).not.toContain('919555000111');
  });

  it('an update event is applied at once, and a promote of our own number makes it admin', async () => {
    const d = await connected('events');
    await seed(d, [snap(d, GID, { isAdmin: false })]);
    d.socket.emit({
      type: 'group_event',
      event: {
        kind: 'update',
        groupId: GID,
        author: null,
        patch: { subject: 'Live rename', announce: true },
      },
    });
    d.socket.emit({
      type: 'group_event',
      event: {
        kind: 'participants',
        groupId: GID,
        author: '919555000111@s.whatsapp.net',
        action: 'promote',
        participants: [`${d.digits}@s.whatsapp.net`],
        selfAffected: true,
      },
    });
    await until('applied', async () => {
      const row = await rowOf(d, GID);
      return (row?.subject === 'Live rename' && row?.is_admin === true) || undefined;
    });
    expect((await rowOf(d, GID))?.announce).toBe(true);
  });

  it('writes nothing for a workspace that is off the allow-list', async () => {
    const d = await connected('sinkoff');
    await h.owner.query(`DELETE FROM unofficial_whatsapp_workspaces WHERE org_id = $1`, [
      d.t.orgId,
    ]);
    d.socket.emit({ type: 'groups', groups: [snap(d, GID)], complete: true });
    await sleep(400);
    expect(await count(d)).toBe(0);
  });

  it('a first read of a big directory is one hint: every group has its created event, only the first leads', async () => {
    const d = await connected('bulk');
    const groups = Array.from({ length: 30 }, (_, i) =>
      snap(d, `1203630000000${String(1000 + i)}`),
    );
    await seed(d, groups);
    const created = await outbox(d.t.orgId, 'whatsapp.device_group.created');
    expect(created).toHaveLength(30);
    expect(created.every((e) => e.bulk === true)).toBe(true);
    expect(created.filter((e) => e.lead === true)).toHaveLength(1);
  });
});

// --- the sweep ---------------------------------------------------------------------------------------------------------------------

describe('the periodic sweep', () => {
  it('re-reads a connected number once per window, through the limiter, and skips a workspace that is off', async () => {
    const on = await connected('sweepon');
    const off = await connected('sweepoff');
    await h.owner.query(`DELETE FROM unofficial_whatsapp_workspaces WHERE org_id = $1`, [
      off.t.orgId,
    ]);
    on.socket.groupReplies.list = { groups: [snap(on, GID), snap(on, `${GID}2`)] };
    off.socket.groupReplies.list = { groups: [snap(off, GID)] };

    const done = await sweep.run();
    expect(done).toBeGreaterThanOrEqual(1);
    expect(await count(on)).toBe(2);
    expect(await count(off)).toBe(0);
    // claimed for the window: a second pass does not read it again
    await sweep.run();
    expect(on.socket.groupCalls.filter((c) => c.type === 'list')).toHaveLength(1);
    expect(off.socket.groupCalls).toEqual([]);
  });

  it('gives a number back to a later pass when the limiter refuses it (never a tight loop)', async () => {
    const d = await connected('sweeplimit');
    await r.control.groupLimiter.startCooldown(d.t.orgId, d.deviceId);
    d.socket.groupReplies.list = { groups: [snap(d, GID)] };
    await sweep.run();
    expect(d.socket.groupCalls).toEqual([]);
    expect(await count(d)).toBe(0);
    expect(await r.redis.exists(`wa:grpsweep:${d.t.orgId}:${d.deviceId}`)).toBe(0);
  });
});

// --- realtime and notifications -----------------------------------------------------------------------------------------------------

describe('the realtime hint and the notifications', () => {
  /** What the worker's drain loop does: hand every pending outbox row to the subscribers, until none is left. */
  async function deliver(): Promise<void> {
    for (let i = 0; i < 40; i += 1) {
      await drainer.drain();
      const left = await h.owner.query(
        `SELECT count(*)::int AS n FROM event_outbox WHERE status IN ('pending','processing')`,
      );
      if (left.rows[0].n === 0) return;
      await sleep(50);
    }
    throw new Error('the outbox did not drain');
  }
  const changed = (c: Conn) =>
    c.events
      .filter((e) => e.name === REALTIME_EVENT.deviceGroupChanged)
      .map((e) => e.data.payload as Record<string, unknown>);
  const rowsOf = async (token: string, type: string) =>
    ((await get(token, '/v2/notifications')).body.data as Array<Record<string, unknown>>).filter(
      (x) => x.type === type,
    );

  it('pushes a hint (ids and kind only) to people with wa.groups.read, and to nobody else', async () => {
    const d = await connected('rt');
    const reader = await api.member(d.t, 'rtreader', [['wa.groups.read']]);
    const outsider = await api.member(d.t, 'rtoutsider', [['wa.devices.read']]);
    const a = await listen(p, reader.token);
    const b = await listen(p, outsider.token);
    await deliver(); // whatever earlier suites left
    await seed(d, [snap(d, GID)]);
    await deliver();
    await until('hint', () => changed(a).length > 0 || undefined);
    const hint = changed(a)[0]!;
    expect(hint).toEqual({ groupId: await uuidOf(d, GID), deviceId: d.uuid, kind: 'created' });
    expect(JSON.stringify(hint)).not.toMatch(/Group|9190000/);
    await sleep(200);
    expect(changed(b)).toEqual([]);
  });

  it('a join request is ONE collapsing row for people with wa.groups.manage, growing with each request, with no number in it', async () => {
    const d = await connected('notifyreq');
    const manager = await api.member(d.t, 'nmanager', [['wa.groups.read'], ['wa.groups.manage']]);
    const reader = await api.member(d.t, 'nreader', [['wa.groups.read']]);
    await seed(d, [snap(d, GID, { subject: 'Sales club', joinApproval: true })]);
    await deliver();
    for (const who of ['919800000009', '919800000008']) {
      d.socket.emit({
        type: 'group_event',
        event: {
          kind: 'join_request',
          groupId: GID,
          participant: `${who}@s.whatsapp.net`,
          author: null,
          action: 'created',
          method: 'invite_link',
        },
      });
      await until(
        `queued ${who}`,
        async () => JSON.stringify((await rowOf(d, GID))?.join_requests).includes(who) || undefined,
      );
      await deliver();
      await sleep(50);
    }
    const rows = await rowsOf(manager.token, 'device_group_join_request');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: '2 people want to join Sales club',
      link: `/devices/groups?device=${d.uuid}`,
    });
    expect(JSON.stringify(rows)).not.toMatch(/9198000000/);
    expect(await rowsOf(reader.token, 'device_group_join_request')).toEqual([]);

    // approving the queue empty closes the unread row
    d.socket.groupReplies.join_request_update = (a) => ({
      participants: (a as { participants: string[] }).participants.map((jid) => ({
        jid,
        status: '200',
      })),
    });
    const gid = await uuidOf(d, GID);
    await post(d.t.admin, `${d.base}/${gid}/join-requests`, {
      action: 'approve',
      jids: ['919800000009@s.whatsapp.net', '919800000008@s.whatsapp.net'],
    });
    await deliver();
    const after = await rowsOf(manager.token, 'device_group_join_request');
    expect(after[0]!.readAt).not.toBeNull();
  });

  it('being removed by someone else is a row naming the group and the number by its label; leaving ourselves is silent', async () => {
    const d = await connected('notifyrm');
    const manager = await api.member(d.t, 'rmmanager', [['wa.groups.read'], ['wa.groups.manage']]);
    await seed(d, [
      snap(d, `${GID}1`, { subject: 'Sales club' }),
      snap(d, `${GID}2`, { subject: 'Quiet' }),
    ]);
    await deliver();
    d.socket.emit({
      type: 'group_event',
      event: {
        kind: 'participants',
        groupId: `${GID}1`,
        author: '919555000111@s.whatsapp.net',
        action: 'remove',
        participants: [`${d.digits}@s.whatsapp.net`],
        selfAffected: true,
      },
    });
    d.socket.groupReplies.leave = { ok: true };
    await post(d.t.admin, `${d.base}/${await uuidOf(d, `${GID}2`)}/leave`, { confirm: true });
    await until('removed', async () => (await rowOf(d, `${GID}1`))?.left_at || undefined);
    await deliver();
    const rows = await rowsOf(manager.token, 'device_group_removed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Removed from Sales club' });
    expect(String(rows[0]!.body)).toContain('Shop line');
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(d.digits));
  });
});

// --- the wire shapes ------------------------------------------------------------------------------------------------------------------

describe('every answer parses with its contract schema', () => {
  it('state, list, detail, create, members, participants, requests, link, preview, join, sync', async () => {
    const d = await connected('contract');
    Object.assign(r.control.groupLimiter.limits, { joinByLinkEnabled: true });
    await seed(d, [snap(d, GID, { joinApproval: true })]);
    const gid = await uuidOf(d, GID);
    const ok = (res: { status: number; body: unknown }) => {
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      return res.body;
    };
    waDeviceGroupsStateSchema.parse(ok(await get(d.t.admin, `${d.base}/state`)));
    waDeviceGroupListSchema.parse(ok(await get(d.t.admin, d.base)));
    waDeviceGroupSchema.parse(ok(await get(d.t.admin, `${d.base}/${gid}`)));
    waDeviceGroupMembersSchema.parse(ok(await get(d.t.admin, `${d.base}/${gid}/participants`)));
    waDeviceGroupJoinRequestsSchema.parse(
      ok(await get(d.t.admin, `${d.base}/${gid}/join-requests`)),
    );

    d.socket.groupReplies.create = {
      group: snap(d, '120363000000000055'),
      participants: [{ jid: '919800000001@s.whatsapp.net', status: '200' }],
      descriptionSet: true,
    };
    createWaDeviceGroupResultSchema.parse(
      ok(
        await post(d.t.admin, d.base, {
          subject: 'S',
          numbers: ['+919800000001'],
          acknowledgeRisk: true,
        }),
      ),
    );
    d.socket.groupReplies.participants = {
      participants: [{ jid: '919800000001@s.whatsapp.net', status: '200' }],
    };
    waGroupParticipantResultsSchema.parse(
      ok(
        await post(d.t.admin, `${d.base}/${gid}/participants`, {
          action: 'add',
          numbers: ['+919800000001'],
        }),
      ),
    );
    d.socket.groupReplies.invite = { code: 'AbCdEf1234567890abcdef' };
    waDeviceGroupInviteLinkSchema.parse(ok(await get(d.t.admin, `${d.base}/${gid}/invite-link`)));
    d.socket.groupReplies.get_invite_info = {
      invite: {
        groupId: '120363000000000066',
        subject: 'X',
        description: null,
        size: 3,
        joinApproval: true,
      },
    };
    waDeviceGroupJoinPreviewSchema.parse(
      ok(
        await post(d.t.admin, `${d.base}/join-by-link/preview`, {
          invite: 'AbCdEf1234567890abcdef',
        }),
      ),
    );
    d.socket.groupReplies.accept_invite = { joined: { groupId: null, requested: true } };
    waDeviceGroupJoinResultSchema.parse(
      ok(
        await post(d.t.admin, `${d.base}/join-by-link`, {
          invite: 'AbCdEf1234567890abcdef',
          acknowledgeRisk: true,
        }),
      ),
    );
    d.socket.groupReplies.list = { groups: [snap(d, GID)] };
    waDeviceGroupsSyncResultSchema.parse(ok(await post(d.t.admin, `${d.base}/sync`)));
  });
});
