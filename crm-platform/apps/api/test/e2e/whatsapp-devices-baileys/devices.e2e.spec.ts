import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PERSONAL_WA_NOTICE_VERSION, personalWaNoticeCanonicalText } from '@crm/contracts';
import { createHash } from 'node:crypto';
import { DeviceRuntimeService } from '../../../src/modules/node-bridge-runtime/runtime/device-runtime.service';
import { waKeys } from '../../../src/modules/node-bridge-runtime/runtime/wa-redis';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import {
  rig,
  worker as buildWorker,
  type FakeFactory,
  type FakeSocket,
  type Rig,
} from '../node-bridge-runtime/support';

/**
 * Personal WhatsApp numbers (BL-095 phase 1): the real app, real Postgres and Redis, and a FAKE socket standing in for WhatsApp. The
 * runtime (a worker) is built by hand as in the runtime suites, so a QR is produced and a scan is simulated without a phone.
 *
 * Covered: create -> acknowledge -> QR start -> poll -> simulated connected -> rename -> disconnect -> delete, and the refusals the spec
 * asks for (allow-list off, no acknowledgement, cap, wrong permission, other workspace, removed from the allow-list mid-pairing).
 */
let h: Harness;
let api: Api;
let r: Rig;
let redis: Redis;
const runtimes: DeviceRuntimeService[] = [];

const SECRET_QR = 'QR-FAKE-SECRET-4f7a91c0';
const SECRET_CODE = 'ZX81KQ7M';

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  r = rig(h);
  redis = r.redis;
}, 240_000);

afterEach(async () => {
  for (const rt of runtimes.splice(0)) await rt.onApplicationShutdown();
  await h.owner.query(`DELETE FROM device_auth_state`);
  const keys = await redis.keys('wa:*');
  if (keys.length) await redis.del(...keys);
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h?.stop();
});

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
const settle = () => sleep(150);

async function startWorker(opts: { qr?: boolean } = {}) {
  const w = await buildWorker(h, r);
  runtimes.push(w.rt);
  if (opts.qr !== false) {
    // A new socket shows a QR, as WhatsApp does; the test then plays the scan with `scan`.
    w.factory.script = (s) =>
      setImmediate(() => {
        s.emit({ type: 'connecting' });
        s.emit({ type: 'qr', qr: SECRET_QR });
      });
  }
  return w;
}

/** The phone scans: credentials arrive, the socket restarts and opens as the right number. */
function scan(factory: FakeFactory, digits: string) {
  const s: FakeSocket = factory.last;
  s.emit({ type: 'creds' });
  s.emit({ type: 'connecting' });
  s.emit({ type: 'open', linkedId: `${digits}:1@s.whatsapp.net` });
}

const ACK = { version: PERSONAL_WA_NOTICE_VERSION, items: [true, true, true], locale: 'en' };

/** An unlimited plan for the workspace, so the pilot cap (not the plan) is what answers. */
async function planLimit(t: Tenant, devices: number) {
  await h.owner.query(
    `UPDATE org_plan_state SET overrides = jsonb_build_object('limits', jsonb_build_object('devices', $2::int)) WHERE org_id = $1`,
    [t.orgId, devices],
  );
}

let seq = 0;
const nextPhone = () => `98${String(2000000 + seq++).padStart(8, '0')}`;

const get = (token: string, path: string) => api.http().get(path).set(bearer(token));
const post = (token: string, path: string, body: object = {}, key?: string) => {
  const req = api.http().post(path).set(bearer(token));
  if (key) req.set('idempotency-key', key);
  return req.send(body);
};
const patch = (token: string, path: string, body: object) =>
  api.http().patch(path).set(bearer(token)).send(body);
const del = (token: string, path: string) => api.http().delete(path).set(bearer(token));

async function setup(label: string, o: { limit?: number } = {}) {
  const t = await api.signup(label);
  await planLimit(t, o.limit ?? -1);
  return t;
}

async function create(t: Tenant, over: Record<string, unknown> = {}) {
  const phone = nextPhone();
  const res = await post(t.admin, '/v2/devices', {
    name: 'Shop line',
    countryCode: '+91',
    phone,
    acknowledgement: ACK,
    ...over,
  });
  return { res, phone, digits: `91${phone}`, id: res.body.id as string };
}

const row = async (uuid: string) =>
  (await h.owner.query(`SELECT * FROM devices WHERE uuid = $1`, [uuid])).rows[0];

async function allowedOff(t: Tenant) {
  await h.owner.query(`DELETE FROM unofficial_whatsapp_workspaces WHERE org_id = $1`, [t.orgId]);
}

describe('the whole journey: create, acknowledge, QR, poll, connected, rename, disconnect, delete', () => {
  it('works end to end, and never leaks the QR', async () => {
    const t = await setup('journey');
    const w = await startWorker();

    // Captured on purpose: nothing the app logs may contain the QR or the code.
    const logged: string[] = [];
    for (const m of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
      vi.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => {
        logged.push(JSON.stringify(a));
      });
    }
    const out = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
      logged.push(String(c));
      return true;
    });

    // 1. the notice: not accepted yet
    const before = await get(t.admin, '/v2/devices/risk-notice');
    expect(before.status).toBe(200);
    expect(before.body).toEqual({
      version: PERSONAL_WA_NOTICE_VERSION,
      accepted: false,
      acceptedAt: null,
    });

    // 2. creating without it is refused with the stable code
    const phone = nextPhone();
    const refused = await post(t.admin, '/v2/devices', {
      name: 'Shop line',
      countryCode: '+91',
      phone,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PERSONAL_WA_NOTICE_REQUIRED');
    expect(refused.body.errors).toEqual([
      { path: 'requiredVersion', message: PERSONAL_WA_NOTICE_VERSION },
    ]);

    // 3. accept it (recorded for THIS person: the canonical text is hashed)
    const accepted = await post(t.admin, '/v2/devices/risk-notice', { ...ACK, locale: 'ar' });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ version: PERSONAL_WA_NOTICE_VERSION, accepted: true });
    const acks = (
      await h.owner.query(`SELECT * FROM device_risk_acknowledgements WHERE org_id = $1`, [t.orgId])
    ).rows;
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({
      user_id: t.adminUserId,
      user_name: 'Admin Person',
      policy_version: PERSONAL_WA_NOTICE_VERSION,
      locale: 'ar',
      device_uuid: null,
      text_sha256: createHash('sha256')
        .update(personalWaNoticeCanonicalText(), 'utf8')
        .digest('hex'),
    });
    // a hash of the address, never the address
    expect(acks[0].ip_hash).toMatch(/^[0-9a-f]{64}$/);
    // idempotent per (person, version)
    await post(t.admin, '/v2/devices/risk-notice', ACK);
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM device_risk_acknowledgements WHERE org_id = $1`,
          [t.orgId],
        )
      ).rows[0].n,
    ).toBe(1);

    // 4. create: state `created`, audit and outbox in the same transaction, consent linked
    const key = 'create-journey-1';
    const created = await post(
      t.admin,
      '/v2/devices',
      { name: 'Shop line', countryCode: '+91', phone: `+91 ${phone}`, region: '' },
      key,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({
      name: 'Shop line',
      phone: `+91${phone}`,
      region: 'IN',
      connectionState: 'created',
      stateReason: null,
      status: 'disconnected',
      active: false,
      activateAfterPairing: true,
      assignee: { name: 'Admin Person' },
      createdBy: { name: 'Admin Person' },
      hasSession: false,
      rowVersion: 1,
    });
    // an internal id never leaves the system
    expect(JSON.stringify(created.body)).not.toMatch(/"(org_id|orgId|userId|user_id)"/);
    const d = await row(id);
    expect(d.phone_digits).toBe(`91${phone}`);
    expect(Number(d.consent_id)).toBe(Number(acks[0].id));
    const ev = (
      await h.owner.query(
        `SELECT event_type, payload FROM event_outbox WHERE aggregate_module = 'devices' AND aggregate_id = $1 ORDER BY id`,
        [d.id],
      )
    ).rows;
    expect(ev.map((e) => e.event_type)).toEqual(['device.created']);
    const audit = (
      await h.owner.query(
        `SELECT action, module FROM audit_log WHERE org_id = $1 AND module = 'devices' AND record_id = $2`,
        [t.orgId, d.id],
      )
    ).rows;
    expect(audit).toEqual([{ action: 'insert', module: 'devices' }]);
    // the same Idempotency-Key replays the answer and creates nothing
    const replay = await post(
      t.admin,
      '/v2/devices',
      { name: 'Shop line', countryCode: '+91', phone: `+91 ${phone}`, region: '' },
      key,
    );
    expect(replay.body.id).toBe(id);
    expect(
      (await h.owner.query(`SELECT count(*)::int AS n FROM devices WHERE org_id = $1`, [t.orgId]))
        .rows[0].n,
    ).toBe(1);

    // 5. start a QR: the worker produces it, the answer carries it, nothing may cache it
    const started = await post(t.admin, `/v2/devices/${id}/pairing/qr`);
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.headers['cache-control']).toBe('no-store');
    expect(started.headers.vary).toMatch(/Authorization/i);
    expect(started.body).toMatchObject({
      method: 'qr',
      state: 'awaiting_qr',
      qr: SECRET_QR,
      code: null,
      startedByMe: true,
    });
    expect(started.body.deadlineAt > started.body.startedAt).toBe(true);
    expect((await row(id)).connection_state).toBe('awaiting_qr');
    expect((await row(id)).status).toBe('needs_pair');
    // Redis holds { qr, at } for at most 45 s
    const stored = JSON.parse((await redis.get(waKeys.qr(t.orgId, Number(d.id))))!) as {
      qr: string;
      at: number;
    };
    expect(stored.qr).toBe(SECRET_QR);
    expect(await redis.ttl(waKeys.qr(t.orgId, Number(d.id)))).toBeLessThanOrEqual(45);
    // the command answer is read once and gone
    expect(await redis.keys('wa:cmd:res:*')).toEqual([]);

    // 6. the poll
    const poll = await get(t.admin, `/v2/devices/${id}/pairing`);
    expect(poll.status).toBe(200);
    expect(poll.headers['cache-control']).toBe('no-store');
    expect(poll.body).toMatchObject({
      attempt: started.body.attempt,
      state: 'awaiting_qr',
      qr: SECRET_QR,
    });
    expect(poll.body.qrAgeMs).toBeGreaterThanOrEqual(0);

    // 7. the phone scans: connected, active (activate_after_pairing), events raised
    scan(w.factory, `91${phone}`);
    await settle();
    await sleep(1100); // the poll is limited to one a second per person
    const done = await get(t.admin, `/v2/devices/${id}/pairing`);
    expect(done.body).toMatchObject({ state: 'connected', reason: null, qr: null, code: null });
    const live = await row(id);
    expect(live).toMatchObject({
      status: 'connected',
      connection_state: 'connected',
      active: true,
    });
    expect(live.state_changed_at).not.toBeNull();
    const types = (
      await h.owner.query(
        `SELECT event_type FROM event_outbox WHERE aggregate_module = 'devices' AND aggregate_id = $1 ORDER BY id`,
        [d.id],
      )
    ).rows.map((e) => e.event_type);
    expect(types).toContain('device.pairing_started');
    expect(types).toContain('device.connected');
    expect(types.filter((x) => x === 'device.connected')).toHaveLength(1);
    expect(await redis.get(waKeys.qr(t.orgId, Number(d.id)))).toBeNull();

    // 8. rename, with the optimistic lock
    const detail = await get(t.admin, `/v2/devices/${id}`);
    expect(detail.body).toMatchObject({
      connectionState: 'connected',
      status: 'connected',
      hasSession: false,
    });
    const renamed = await patch(t.admin, `/v2/devices/${id}`, {
      name: 'Front desk',
      rowVersion: detail.body.rowVersion,
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.name).toBe('Front desk');
    const stale = await patch(t.admin, `/v2/devices/${id}`, {
      name: 'Again',
      rowVersion: detail.body.rowVersion,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    // the number is locked while linked
    const locked = await patch(t.admin, `/v2/devices/${id}`, {
      countryCode: '+91',
      phone: nextPhone(),
      rowVersion: renamed.body.rowVersion,
    });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('DEVICE_NUMBER_LOCKED');
    // a rename is audited and raises device.renamed
    expect(
      (
        await h.owner.query(
          `SELECT 1 FROM event_outbox WHERE aggregate_id = $1 AND event_type = 'device.renamed'`,
          [d.id],
        )
      ).rowCount,
    ).toBe(1);

    // 9. the list: the meter, the cap, the notice standing, the worker
    const list = await get(t.admin, '/v2/devices');
    expect(list.status).toBe(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).toEqual([id]);
    expect(list.body.meta).toEqual({
      used: 1,
      limit: 2,
      planLimit: 0,
      pilotCap: 2,
      noticeVersion: PERSONAL_WA_NOTICE_VERSION,
      noticeAccepted: true,
      workerRunning: true,
      // the signed-up workspace's plan has the full-history feature
      historyFullAllowed: true,
    });

    // 10. disconnect: the worker unlinks, the session is gone, the state says why
    const off = await post(t.admin, `/v2/devices/${id}/disconnect`);
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.unlinked).toBe(true);
    expect(off.body.device).toMatchObject({
      connectionState: 'disconnected',
      stateReason: 'user',
      status: 'disconnected',
    });
    expect(w.factory.last.loggedOut).toBe(true);

    // 11. delete frees the slot
    const gone = await del(t.admin, `/v2/devices/${id}`);
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect(gone.body).toEqual({ id, deleted: true, unlinked: false });
    expect(await row(id)).toBeUndefined();
    expect((await get(t.admin, `/v2/devices/${id}`)).status).toBe(404);
    expect((await get(t.admin, '/v2/devices')).body.meta.used).toBe(0);

    // no secret anywhere it must not be: logs, the outbox, the audit trail, the idempotency store
    out.mockRestore();
    const everything = logged.join('\n');
    expect(everything).not.toContain(SECRET_QR);
    expect(everything).not.toContain(SECRET_CODE);
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM event_outbox WHERE payload::text LIKE '%QR-FAKE%'`,
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM audit_log WHERE delta::text LIKE '%QR-FAKE%'`,
        )
      ).rows[0].n,
    ).toBe(0);
    for (const k of await redis.keys('idem:*')) expect(await redis.get(k)).not.toContain(SECRET_QR);
  });
});

describe('a pairing code', () => {
  it('is returned for the number, with the warning data, and a number without a country code is refused first', async () => {
    const t = await setup('code');
    const w = await startWorker({ qr: false });
    // A socket that is asked for a pairing code shows no QR and does not open by itself.
    w.factory.script = () => undefined;
    const { id, digits } = await create(t);
    const res = await post(t.admin, `/v2/devices/${id}/pairing/code`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      method: 'code',
      state: 'awaiting_pairing_code',
      code: SECRET_CODE,
      qr: null,
    });
    expect(res.body.codeExpiresIn).toBeGreaterThan(170);
    expect(w.factory.last.pairingFor).toBe(digits);
    expect(res.headers['cache-control']).toBe('no-store');

    const short = await create(t, { countryCode: '+1', phone: '12345' });
    const refused = await post(t.admin, `/v2/devices/${short.id}/pairing/code`);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('DEVICE_PHONE_INVALID');
  });
});

describe('the refusals', () => {
  it('the engine is off for the workspace: 422 WA_UNOFFICIAL_DISABLED on every route', async () => {
    const t = await setup('off');
    const { id } = await create(t);
    await allowedOff(t);
    const calls = [
      get(t.admin, '/v2/devices'),
      post(t.admin, '/v2/devices', {
        name: 'Another',
        countryCode: '+91',
        phone: nextPhone(),
        acknowledgement: ACK,
      }),
      get(t.admin, '/v2/devices/risk-notice'),
      post(t.admin, '/v2/devices/risk-notice', ACK),
      get(t.admin, `/v2/devices/${id}`),
      patch(t.admin, `/v2/devices/${id}`, { name: 'Zed', rowVersion: 1 }),
      post(t.admin, `/v2/devices/${id}/pairing/qr`),
      post(t.admin, `/v2/devices/${id}/pairing/code`),
      get(t.admin, `/v2/devices/${id}/pairing`),
      del(t.admin, `/v2/devices/${id}/pairing`),
      post(t.admin, `/v2/devices/${id}/disconnect`),
      del(t.admin, `/v2/devices/${id}`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.code).toBe('WA_UNOFFICIAL_DISABLED');
    }
    // nothing was changed
    expect((await row(id)).device_name).toBe('Shop line');
  });

  it('a workspace removed from the allow-list in the middle of a pairing gets 422 on the next call, and its socket closes', async () => {
    const t = await setup('mid');
    const w = await startWorker();
    const { id } = await create(t);
    const started = await post(t.admin, `/v2/devices/${id}/pairing/qr`);
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    await allowedOff(t);
    await sleep(1100);
    const next = await get(t.admin, `/v2/devices/${id}/pairing`);
    expect(next.status).toBe(422);
    expect(next.body.code).toBe('WA_UNOFFICIAL_DISABLED');
    // the runtime closes the sockets of a workspace that is no longer allowed on its next pass; the session rows are kept
    await w.rt.pass();
    expect(w.rt.isOwned(t.orgId, Number((await row(id)).id))).toBe(false);
    expect(w.factory.last.ended).toBe(true);
  });

  it('every person accepts for themselves: an admin accepted, a colleague with the keys still needs to', async () => {
    const t = await setup('own');
    await startWorker();
    const { id } = await create(t);
    const colleague = await api.member(t, 'colleague', [
      ['wa.devices.read'],
      ['wa.devices.create'],
      ['wa.devices.pair'],
    ]);
    const create2 = await post(colleague.token, '/v2/devices', {
      name: 'Mine',
      countryCode: '+91',
      phone: nextPhone(),
    });
    expect(create2.status).toBe(409);
    expect(create2.body.code).toBe('PERSONAL_WA_NOTICE_REQUIRED');
    const pair = await post(colleague.token, `/v2/devices/${id}/pairing/qr`);
    expect(pair.status).toBe(409);
    expect(pair.body.code).toBe('PERSONAL_WA_NOTICE_REQUIRED');
    expect((await get(colleague.token, '/v2/devices/risk-notice')).body.accepted).toBe(false);
  });

  it('an acknowledgement of an OLDER version does not count: a version bump asks again', async () => {
    const t = await setup('bump');
    await h.owner.query(
      `INSERT INTO device_risk_acknowledgements (org_id, user_id, user_name, policy_version, text_sha256) VALUES ($1, $2, 'Admin Person', '2026-01-01.1', $3)`,
      [t.orgId, t.adminUserId, 'a'.repeat(64)],
    );
    const res = await post(t.admin, '/v2/devices', {
      name: 'Shop',
      countryCode: '+91',
      phone: nextPhone(),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PERSONAL_WA_NOTICE_REQUIRED');
    // an inline acknowledgement of a stale version is refused too
    const stale = await post(t.admin, '/v2/devices', {
      name: 'Shop',
      countryCode: '+91',
      phone: nextPhone(),
      acknowledgement: { ...ACK, version: '2026-01-01.1' },
    });
    expect(stale.status).toBe(409);
    // and tickboxes that are not all ticked never reach the service
    const partial = await post(t.admin, '/v2/devices', {
      name: 'Shop',
      countryCode: '+91',
      phone: nextPhone(),
      acknowledgement: { ...ACK, items: [true, false, true] },
    });
    expect(partial.status).toBe(422);
  });

  it('the pilot cap of 2 applies whatever the plan says; the plan limit applies when it is lower', async () => {
    const t = await setup('cap', { limit: -1 }); // unlimited plan
    expect((await create(t)).res.status).toBe(201);
    expect((await create(t)).res.status).toBe(201);
    const third = await create(t);
    expect(third.res.status).toBe(422);
    expect(third.res.body.code).toBe('DEVICE_PILOT_CAP_REACHED');
    expect(third.res.body.errors).toEqual(
      expect.arrayContaining([{ path: 'limitValue', message: '2' }]),
    );

    const lower = await setup('cap1', { limit: 1 });
    expect((await create(lower)).res.status).toBe(201);
    const second = await create(lower);
    expect(second.res.status).toBe(422);
    expect(second.res.body.code).toBe('PLAN_LIMIT_REACHED');
    expect((await get(lower.admin, '/v2/devices')).body.meta).toMatchObject({
      used: 1,
      limit: 1,
      planLimit: 1,
      pilotCap: 2,
    });
  });

  it('parallel adds cannot both pass the cap (one creation at a time per workspace)', async () => {
    const t = await setup('race');
    await post(t.admin, '/v2/devices/risk-notice', ACK);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        post(t.admin, '/v2/devices', { name: 'Racer', countryCode: '+91', phone: nextPhone() }),
      ),
    );
    expect(results.filter((x) => x.status === 201)).toHaveLength(2);
    expect(
      results
        .filter((x) => x.status === 422)
        .every((x) => x.body.code === 'DEVICE_PILOT_CAP_REACHED'),
    ).toBe(true);
    expect(
      (await h.owner.query(`SELECT count(*)::int AS n FROM devices WHERE org_id = $1`, [t.orgId]))
        .rows[0].n,
    ).toBe(2);
  });

  it('the same number twice in a workspace is refused, however it is typed', async () => {
    const t = await setup('dup');
    const first = await create(t);
    const again = await post(t.admin, '/v2/devices', {
      name: 'Twin',
      countryCode: '91',
      phone: `+91 ${first.phone}`,
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('DEVICE_ALREADY_EXISTS');
    expect(again.body.errors).toEqual([{ path: 'existingId', message: first.id }]);
    // another workspace may use the same number (cross-workspace uniqueness is a later decision)
    const other = await setup('dup2');
    const ok = await post(other.admin, '/v2/devices', {
      name: 'Twin',
      countryCode: '+91',
      phone: first.phone,
      acknowledgement: ACK,
    });
    expect(ok.status).toBe(201);
  });

  it('the assignee must be a member of THIS workspace', async () => {
    const t = await setup('assignee');
    const other = await setup('assignee2');
    const otherUser = (
      await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [other.adminUserId])
    ).rows[0].uuid;
    const res = await create(t, { assigneeUserId: otherUser });
    expect(res.res.status).toBe(422);
    const mine = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [t.adminUserId]))
      .rows[0].uuid;
    expect((await create(t, { assigneeUserId: mine })).res.status).toBe(201);
  });

  it('a wrong permission is 403, per route, and a caller with none is refused before any of it', async () => {
    const t = await setup('perm');
    const { id } = await create(t);
    const reader = await api.member(t, 'reader', [['wa.devices.read']]);
    expect((await get(reader.token, '/v2/devices')).status).toBe(200);
    expect((await get(reader.token, `/v2/devices/${id}`)).status).toBe(200);
    const denied = [
      post(reader.token, '/v2/devices', {
        name: 'No',
        countryCode: '+91',
        phone: nextPhone(),
        acknowledgement: ACK,
      }),
      post(reader.token, '/v2/devices/risk-notice', ACK),
      patch(reader.token, `/v2/devices/${id}`, { name: 'No', rowVersion: 1 }),
      post(reader.token, `/v2/devices/${id}/pairing/qr`),
      post(reader.token, `/v2/devices/${id}/pairing/code`),
      get(reader.token, `/v2/devices/${id}/pairing`),
      post(reader.token, `/v2/devices/${id}/disconnect`),
      del(reader.token, `/v2/devices/${id}`),
    ];
    for (const res of await Promise.all(denied)) expect(res.status).toBe(403);
    const nobody = await api.member(t, 'nobody', [['record.contacts.read']]);
    expect((await get(nobody.token, '/v2/devices')).status).toBe(403);
    // each action has its own key
    const disconnecter = await api.member(t, 'disc', [['wa.devices.disconnect']]);
    expect((await post(disconnecter.token, `/v2/devices/${id}/disconnect`)).status).toBe(200);
    expect((await del(disconnecter.token, `/v2/devices/${id}`)).status).toBe(403);
    const deleter = await api.member(t, 'dele', [['wa.devices.delete']]);
    expect((await del(deleter.token, `/v2/devices/${id}`)).status).toBe(200);
    // an unauthenticated call is 401
    expect((await api.http().get('/v2/devices')).status).toBe(401);
  });

  it('another workspace sees nothing: 404 on every route that names a device, and its list is empty', async () => {
    const a = await setup('iso-a');
    const b = await setup('iso-b');
    await startWorker();
    const { id } = await create(a);
    await post(b.admin, '/v2/devices/risk-notice', ACK);
    const probes = [
      get(b.admin, `/v2/devices/${id}`),
      patch(b.admin, `/v2/devices/${id}`, { name: 'Hijack', rowVersion: 1 }),
      post(b.admin, `/v2/devices/${id}/pairing/qr`),
      post(b.admin, `/v2/devices/${id}/pairing/code`),
      get(b.admin, `/v2/devices/${id}/pairing`),
      del(b.admin, `/v2/devices/${id}/pairing`),
      post(b.admin, `/v2/devices/${id}/disconnect`),
      del(b.admin, `/v2/devices/${id}`),
    ];
    for (const res of await Promise.all(probes)) {
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    }
    expect((await get(b.admin, '/v2/devices')).body.data).toEqual([]);
    // and nothing happened to the device
    expect((await row(id)).device_name).toBe('Shop line');
    expect((await row(id)).connection_state).toBe('created');
  });
});

describe('pairing rules', () => {
  it('a device that keeps a healthy saved session is not wiped by a stray start; relink forgets it on purpose (R1)', async () => {
    const t = await setup('r1');
    const w = await startWorker();
    const { id } = await create(t);
    const dev = Number((await row(id)).id);
    await h.owner.query(
      `UPDATE devices SET connection_state = 'disconnected', status = 'disconnected' WHERE id = $1`,
      [dev],
    );
    await r.store.write(t.orgId, dev, [
      ['creds', '{"a":1}'],
      ['pre-key-1', '{"a":1}'],
      ['pre-key-2', '{"a":1}'],
    ]);

    const refused = await post(t.admin, `/v2/devices/${id}/pairing/qr`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('DEVICE_NOT_PAIRABLE');
    expect(await r.store.count(t.orgId, dev)).toBe(3);
    // the runtime has the same rule on its own, for a caller that does not go through the API
    const direct = await r.control.requestQr(t.orgId, dev);
    expect(direct).toMatchObject({ ok: false, status: 'not_pairable' });
    expect(await r.store.count(t.orgId, dev)).toBe(3);
    expect(w.factory.sockets).toHaveLength(0);

    const relinked = await post(t.admin, `/v2/devices/${id}/pairing/qr`, { relink: true });
    expect(relinked.status, JSON.stringify(relinked.body)).toBe(200);
    expect(relinked.body.qr).toBe(SECRET_QR);
    expect(await r.store.count(t.orgId, dev)).toBe(0);
  });

  it('a connected device is never re-paired, even with relink: disconnect it first', async () => {
    const t = await setup('conn');
    await startWorker();
    const { id } = await create(t);
    await h.owner.query(
      `UPDATE devices SET connection_state = 'connected', status = 'connected' WHERE uuid = $1`,
      [id],
    );
    for (const body of [{}, { relink: true }]) {
      const res = await post(t.admin, `/v2/devices/${id}/pairing/qr`, body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DEVICE_NOT_PAIRABLE');
    }
  });

  it('a second person cannot start while the first attempt runs, and is told who and when', async () => {
    const t = await setup('two');
    await startWorker();
    const { id } = await create(t);
    const second = await api.member(t, 'second', [['wa.devices.read'], ['wa.devices.pair']]);
    const first = await post(t.admin, `/v2/devices/${id}/pairing/qr`);
    expect(first.status).toBe(200);
    const blocked = await post(second.token, `/v2/devices/${id}/pairing/qr`, {
      relink: true,
      acknowledgement: ACK,
    });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
    expect(blocked.body.code).toBe('DEVICE_PAIRING_IN_PROGRESS');
    expect(blocked.body.errors).toEqual(
      expect.arrayContaining([{ path: 'startedBy', message: 'Admin Person' }]),
    );
    // the second person may read the attempt (workspace and permission scoped), flagged as not theirs
    await sleep(1100);
    const seen = await get(second.token, `/v2/devices/${id}/pairing`);
    expect(seen.status).toBe(200);
    expect(seen.body.startedByMe).toBe(false);
    // the first person may start again
    const again = await post(t.admin, `/v2/devices/${id}/pairing/qr`, { relink: true });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
  });

  it('a pairing start is limited to 5 an hour per device, then 429 with retryAfterS', async () => {
    const t = await setup('rate');
    await startWorker();
    const { id } = await create(t);
    for (let i = 0; i < 5; i++) {
      const res = await post(t.admin, `/v2/devices/${id}/pairing/qr`, { relink: true });
      expect(res.status, `start ${i + 1}: ${JSON.stringify(res.body)}`).toBe(200);
      // the runtime lets one attempt run at a time per device: let the previous one release its lock
      await redis.del(waKeys.initLock(t.orgId, Number((await row(id)).id)));
    }
    const sixth = await post(t.admin, `/v2/devices/${id}/pairing/qr`, { relink: true });
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('DEVICE_PAIRING_RATE_LIMITED');
    expect(Number(sixth.body.errors[0].message)).toBeGreaterThan(0);
  });

  it('with no worker running a start is 503 WA_WORKER_UNAVAILABLE and leaves no attempt behind', async () => {
    const t = await setup('noworker');
    const { id } = await create(t);
    const res = await post(t.admin, `/v2/devices/${id}/pairing/qr`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WA_WORKER_UNAVAILABLE');
    await sleep(1100);
    expect((await get(t.admin, `/v2/devices/${id}/pairing`)).status).toBe(404);
    expect((await get(t.admin, '/v2/devices')).body.meta.workerRunning).toBe(false);
  });

  it('polling with no attempt is 404 DEVICE_NO_PAIRING; a scan with another phone ends in error / mismatch', async () => {
    const t = await setup('mismatch');
    const w = await startWorker();
    const { id } = await create(t);
    const none = await get(t.admin, `/v2/devices/${id}/pairing`);
    expect(none.status).toBe(404);
    expect(none.body.code).toBe('DEVICE_NO_PAIRING');
    await post(t.admin, `/v2/devices/${id}/pairing/qr`);
    scan(w.factory, '911111111111');
    await settle();
    await sleep(1100);
    const res = await get(t.admin, `/v2/devices/${id}/pairing`);
    expect(res.body).toMatchObject({ state: 'error', reason: 'mismatch', qr: null });
    expect((await row(id)).status).toBe('disconnected');
  });

  it('when WhatsApp ends the link the state is logged_out, never a ban, and the device can be paired again', async () => {
    const t = await setup('loggedout');
    const w = await startWorker();
    const { id, digits } = await create(t);
    await post(t.admin, `/v2/devices/${id}/pairing/qr`);
    scan(w.factory, digits);
    await settle();
    w.factory.last.emit({ type: 'close', code: 403 });
    await settle();
    const d = await get(t.admin, `/v2/devices/${id}`);
    expect(d.body).toMatchObject({
      connectionState: 'logged_out',
      stateReason: 'forbidden',
      status: 'disconnected',
    });
    expect(d.body.lastError).toMatchObject({ reason: 'forbidden' });
    expect(JSON.stringify(d.body)).not.toMatch(/ban/i);
    const events = (
      await h.owner.query(
        `SELECT event_type FROM event_outbox WHERE aggregate_module = 'devices' AND aggregate_id = $1`,
        [(await row(id)).id],
      )
    ).rows.map((e) => e.event_type);
    expect(events).toContain('device.logged_out');
    // pairing again is allowed from logged_out (the session was wiped)
    const again = await post(t.admin, `/v2/devices/${id}/pairing/qr`);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
  });

  it('cancelling an attempt ends it', async () => {
    const t = await setup('cancel');
    await startWorker();
    const { id } = await create(t);
    await post(t.admin, `/v2/devices/${id}/pairing/qr`);
    const res = await del(t.admin, `/v2/devices/${id}/pairing`);
    expect(res.body).toEqual({ cancelled: true });
    await sleep(1100);
    expect((await get(t.admin, `/v2/devices/${id}/pairing`)).status).toBe(404);
    expect((await del(t.admin, `/v2/devices/${id}/pairing`)).body).toEqual({ cancelled: false });
  });
});

describe('disconnect and delete without a worker, and with threads', () => {
  it('no worker answers a disconnect: the saved session is removed here so a worker that returns cannot reconnect it', async () => {
    const t = await setup('discnow');
    const { id } = await create(t);
    const dev = Number((await row(id)).id);
    await h.owner.query(
      `UPDATE devices SET connection_state = 'connected', status = 'connected', active = true WHERE id = $1`,
      [dev],
    );
    await r.store.write(t.orgId, dev, [
      ['creds', '{"a":1}'],
      ['pre-key-1', '{"a":1}'],
      ['pre-key-2', '{"a":1}'],
    ]);
    const res = await post(t.admin, `/v2/devices/${id}/disconnect`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.unlinked).toBe(false);
    expect(res.body.device).toMatchObject({
      connectionState: 'disconnected',
      stateReason: 'user',
      status: 'disconnected',
    });
    expect(await r.store.count(t.orgId, dev)).toBe(0);
    const types = (
      await h.owner.query(
        `SELECT event_type FROM event_outbox WHERE aggregate_module = 'devices' AND aggregate_id = $1`,
        [dev],
      )
    ).rows.map((e) => e.event_type);
    expect(types).toContain('device.disconnected');
  });

  it('delete closes the open conversations of its channel, switches the channel off, removes the session and frees the slot', async () => {
    const t = await setup('delthreads');
    const { id } = await create(t);
    const dev = Number((await row(id)).id);
    const ch = await h.owner.query(
      `INSERT INTO channels (org_id, kind, name, status, external_id) VALUES ($1, 'whatsapp_qr', 'Shop line', 'connected', $2) RETURNING id`,
      [t.orgId, id],
    );
    const conv = async (status: string, peer: string) =>
      Number(
        (
          await h.owner.query(
            `INSERT INTO conversations (org_id, channel_id, peer_key, title, status) VALUES ($1, $2, $3, 'chat', $4) RETURNING id`,
            [t.orgId, ch.rows[0].id, peer, status],
          )
        ).rows[0].id,
      );
    const open = await conv('open', 'p1');
    const snoozed = await conv('snoozed', 'p2');
    const resolved = await conv('resolved', 'p3');
    await r.store.write(t.orgId, dev, [['creds', '{"a":1}']]);

    const res = await del(t.admin, `/v2/devices/${id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const states = (
      await h.owner.query(`SELECT id, status FROM conversations WHERE id = ANY($1)`, [
        [open, snoozed, resolved],
      ])
    ).rows;
    expect(Object.fromEntries(states.map((s) => [Number(s.id), s.status]))).toEqual({
      [open]: 'closed',
      [snoozed]: 'closed',
      [resolved]: 'resolved',
    });
    expect(
      (await h.owner.query(`SELECT status FROM channels WHERE id = $1`, [ch.rows[0].id])).rows[0]
        .status,
    ).toBe('disconnected');
    expect(await r.store.count(t.orgId, dev)).toBe(0);
    const ev = (
      await h.owner.query(
        `SELECT payload FROM event_outbox WHERE aggregate_module = 'devices' AND aggregate_id = $1 AND event_type = 'device.deleted'`,
        [dev],
      )
    ).rows;
    expect(ev[0].payload).toMatchObject({ closedConversations: 2 });
    // the slot is free again
    expect((await create(t)).res.status).toBe(201);
  });
});

describe('reading', () => {
  it('lists newest first with a keyset cursor, filters by state and searches name and number', async () => {
    const t = await setup('list', { limit: -1 });
    const a = await create(t, { name: 'Alpha line' });
    const b = await create(t, { name: 'Beta line' });
    await h.owner.query(`UPDATE devices SET active = true WHERE uuid = $1`, [a.id]);
    const all = await get(t.admin, '/v2/devices');
    // active first, then newest
    expect(all.body.data.map((x: { id: string }) => x.id)).toEqual([a.id, b.id]);
    const page1 = await get(t.admin, '/v2/devices?limit=1');
    expect(page1.body.page).toMatchObject({ hasMore: true, limit: 1 });
    const page2 = await get(
      t.admin,
      `/v2/devices?limit=1&cursor=${encodeURIComponent(page1.body.page.nextCursor)}`,
    );
    expect(page2.body.data.map((x: { id: string }) => x.id)).toEqual([b.id]);
    expect(page2.body.page.hasMore).toBe(false);
    expect((await get(t.admin, '/v2/devices?state=connected')).body.data).toEqual([]);
    expect((await get(t.admin, '/v2/devices?state=created')).body.data).toHaveLength(2);
    expect(
      (await get(t.admin, '/v2/devices?q=beta')).body.data.map((x: { id: string }) => x.id),
    ).toEqual([b.id]);
    expect(
      (await get(t.admin, `/v2/devices?q=${b.phone.slice(0, 7)}`)).body.data.length,
    ).toBeGreaterThan(0);
    // a % in the search is literal
    expect((await get(t.admin, '/v2/devices?q=%25')).body.data).toEqual([]);
    expect((await get(t.admin, '/v2/devices?cursor=garbage')).status).toBe(400);
  });
});
