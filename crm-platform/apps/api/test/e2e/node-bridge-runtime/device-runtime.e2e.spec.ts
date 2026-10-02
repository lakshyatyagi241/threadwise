import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DeviceAuthStore } from '../../../src/infra/providers/node-bridge-runtime/device-auth-store';
import { DeviceControlService } from '../../../src/modules/node-bridge-runtime';
import { DeviceRuntimeService } from '../../../src/modules/node-bridge-runtime/runtime/device-runtime.service';
import { waKeys } from '../../../src/modules/node-bridge-runtime/runtime/wa-redis';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { FakeFactory, rig, worker as buildWorker, type Rig } from './support';

/**
 * The unofficial engine's runtime (WD-NODE-005 to 014): the real app's database and Redis, a fake socket standing in for
 * WhatsApp. The state machine itself is tested in test/unit/node-bridge-runtime/device-session.spec.ts; this proves what
 * surrounds it: leases, the device row, the outbox, Redis, commands between processes, restore and failover.
 */
let h: Harness;
let api: Api;
let redis: Redis;
let store: DeviceAuthStore;
let control: DeviceControlService;

const runtimes: DeviceRuntimeService[] = [];
let r: Rig;
async function worker() {
  const w = await buildWorker(h, r);
  runtimes.push(w.rt);
  return w;
}

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  r = rig(h);
  ({ redis, store, control } = r);
}, 240_000);

afterEach(async () => {
  for (const rt of runtimes.splice(0)) await rt.onApplicationShutdown();
  // A saved session left behind would be adopted by the next test's worker (its restore runs at start).
  await h.owner.query(`DELETE FROM device_auth_state`);
  const keys = await redis.keys('wa:*');
  if (keys.length) await redis.del(...keys);
});
afterAll(async () => {
  await h?.stop();
});

let seq = 0;
async function arrange(label: string, o: { status?: string; phone?: string } = {}) {
  const t = await api.signup(label);
  const phone = o.phone ?? `98${String(1000000 + seq++).padStart(8, '0')}`;
  const r = await h.owner.query(
    `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
     VALUES ($1, 'Main', '+91', $2, $3, false) RETURNING id`,
    [t.orgId, phone, o.status ?? 'disconnected'],
  );
  return { t, deviceId: Number(r.rows[0].id), digits: `91${phone}` };
}
const device = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, active, last_seen_at, proxy_status, proxy_egress_ip, proxy_checked_at FROM devices WHERE id = $1`,
      [id],
    )
  ).rows[0];
const events = async (deviceId: number) =>
  (
    await h.owner.query(
      `SELECT payload FROM event_outbox WHERE aggregate_module = 'devices' AND aggregate_id = $1 AND event_type = 'device.status_changed' ORDER BY id`,
      [deviceId],
    )
  ).rows.map((r) => r.payload as { status: string; label: string; progress: number });
const seedAuth = async (t: Tenant, deviceId: number, n: number) => {
  await store.write(
    t.orgId,
    deviceId,
    Array.from({ length: n }, (_, i): [string, string] => [
      i === 0 ? 'creds' : `pre-key-${i}`,
      '{"a":1}',
    ]),
  );
};
const settle = () => new Promise<void>((r) => setTimeout(r, 120));

describe('a device comes up (WD-NODE-011, 012)', () => {
  it('connects, marks the row connected and active, writes an outbox event, and holds the lease', async () => {
    const { t, deviceId } = await arrange('up');
    const { rt, factory } = await worker();
    expect(await rt.adopt(t.orgId, deviceId)).toBe('started');
    await settle();
    expect(rt.isReady(t.orgId, deviceId)).toBe(true);
    const d = await device(deviceId);
    expect(d).toMatchObject({ status: 'connected', active: true });
    expect(d.last_seen_at).not.toBeNull();
    expect((await events(deviceId)).map((e) => e.label)).toEqual(['Connecting', 'Ready']);
    expect((await events(deviceId)).at(-1)).toMatchObject({ status: 'connected', progress: 100 });
    expect(await redis.get(waKeys.lease(t.orgId, deviceId))).not.toBeNull();
    expect(factory.targets[0]).toMatchObject({ orgId: t.orgId, deviceId, proxy: null });
  });

  it('a second worker cannot take a device that is owned: only one socket per number', async () => {
    const { t, deviceId } = await arrange('lease');
    const a = await worker();
    const b = await worker();
    expect(await a.rt.adopt(t.orgId, deviceId)).toBe('started');
    expect(await b.rt.adopt(t.orgId, deviceId)).toBe('busy');
    expect(await a.rt.adopt(t.orgId, deviceId)).toBe('already');
    expect(b.factory.sockets).toHaveLength(0);
  });

  it('another organization cannot adopt it (the row is not visible to it)', async () => {
    const a = await arrange('orga');
    const b = await arrange('orgb');
    const { rt } = await worker();
    expect(await rt.adopt(b.t.orgId, a.deviceId)).toBe('missing');
  });

  it('scanned with another phone: Mismatch, logged out, nothing kept, lease released', async () => {
    const { t, deviceId } = await arrange('mismatch');
    const { rt, factory } = await worker();
    factory.script = (s) =>
      setImmediate(() => s.emit({ type: 'open', linkedId: '911111111111:1@s.whatsapp.net' }));
    await seedAuth(t, deviceId, 4);
    await rt.adopt(t.orgId, deviceId);
    await settle();
    expect((await events(deviceId)).at(-1)!.label).toBe('Mismatch');
    expect((await device(deviceId)).status).toBe('disconnected');
    expect(factory.sockets[0]!.loggedOut).toBe(true);
    expect(await store.count(t.orgId, deviceId)).toBe(0);
    expect(rt.isOwned(t.orgId, deviceId)).toBe(false);
    expect(await redis.get(waKeys.lease(t.orgId, deviceId))).toBeNull();
  });

  it('the phone unlinks it (401): Logged Out, session wiped, no reconnect, lease released', async () => {
    const { t, deviceId } = await arrange('unlinked');
    const { rt, factory } = await worker();
    await seedAuth(t, deviceId, 4);
    await rt.adopt(t.orgId, deviceId);
    await settle();
    factory.last.emit({ type: 'close', code: 401 });
    await settle();
    expect((await events(deviceId)).at(-1)!.label).toBe('Logged Out');
    expect((await device(deviceId)).status).toBe('disconnected');
    expect(await store.count(t.orgId, deviceId)).toBe(0);
    expect(rt.isOwned(t.orgId, deviceId)).toBe(false);
    expect(factory.sockets).toHaveLength(1);
  });
});

describe('the saved session (WD-NODE-011, 007)', () => {
  it('is stored encrypted, one row per entry, and read back; another organization sees none of it', async () => {
    const { t, deviceId } = await arrange('store');
    const other = await arrange('storeother');
    await store.write(t.orgId, deviceId, [
      ['creds', '{"secret":"top-secret-value"}'],
      ['pre-key-1', '{"k":1}'],
    ]);
    const raw = (
      await h.owner.query(
        `SELECT value FROM device_auth_state WHERE device_id = $1 ORDER BY name`,
        [deviceId],
      )
    ).rows;
    expect(raw).toHaveLength(2);
    expect(JSON.stringify(raw)).not.toContain('top-secret-value');
    expect(await store.read(t.orgId, deviceId, 'creds')).toBe('{"secret":"top-secret-value"}');
    expect(
      [...(await store.readMany(t.orgId, deviceId, ['creds', 'pre-key-1', 'nope'])).keys()].sort(),
    ).toEqual(['creds', 'pre-key-1']);
    expect(await store.read(other.t.orgId, deviceId, 'creds')).toBeNull(); // row-level security
    await store.write(t.orgId, deviceId, [['pre-key-1', null]]);
    expect(await store.count(t.orgId, deviceId)).toBe(1);
  });

  it('restore opens devices with a healthy session (3 or more rows) and reports the thin ones Disconnected', async () => {
    const healthy = await arrange('restore1', { status: 'connected' });
    const thin = await arrange('restore2', { status: 'connected' });
    const none = await arrange('restore3', { status: 'disconnected' });
    await seedAuth(healthy.t, healthy.deviceId, 3);
    await seedAuth(thin.t, thin.deviceId, 2);
    const { rt, factory } = await worker();
    const r = await rt.restore();
    await settle();
    expect(r.skipped).toBeGreaterThanOrEqual(1); // the thin session, whichever pass saw it
    expect(rt.isReady(healthy.t.orgId, healthy.deviceId)).toBe(true);
    expect(rt.isOwned(thin.t.orgId, thin.deviceId)).toBe(false);
    expect((await device(thin.deviceId)).status).toBe('disconnected');
    expect((await events(thin.deviceId)).at(-1)!.label).toBe('Disconnected');
    expect(rt.isOwned(none.t.orgId, none.deviceId)).toBe(false); // never paired: nothing to restore
    expect(factory.targets.some((x) => x.deviceId === thin.deviceId)).toBe(false);
  });

  it('restore does not open a device another worker owns', async () => {
    const { t, deviceId } = await arrange('restoreowned');
    await seedAuth(t, deviceId, 3);
    const a = await worker();
    await a.rt.adopt(t.orgId, deviceId);
    const b = await worker();
    await b.rt.restore();
    expect(b.factory.targets.some((x) => x.deviceId === deviceId)).toBe(false);
  });
});

describe('failover and liveness (WD-NODE-005, 014)', () => {
  it('a worker that loses a lease closes that socket at once, so two sockets never run', async () => {
    const { t, deviceId } = await arrange('lost');
    const { rt, factory } = await worker();
    await rt.adopt(t.orgId, deviceId);
    await settle();
    await redis.set(waKeys.lease(t.orgId, deviceId), 'someone-else');
    await rt.pass();
    expect(factory.last.ended).toBe(true);
    expect(rt.isOwned(t.orgId, deviceId)).toBe(false);
    expect(factory.last.loggedOut).toBe(false); // closed, never unlinked
  });

  it('a ready device is touched on every pass; one nobody touches for 90 s flips to disconnected', async () => {
    const live = await arrange('live');
    const dead = await arrange('dead', { status: 'connected' });
    await h.owner.query(
      `UPDATE devices SET last_seen_at = now() - interval '5 minutes' WHERE id = $1`,
      [dead.deviceId],
    );
    await h.owner.query(`ALTER TABLE devices DISABLE TRIGGER ALL`).catch(() => undefined);
    const { rt } = await worker();
    await rt.adopt(live.t.orgId, live.deviceId);
    await settle();
    await h.owner.query(
      `UPDATE devices SET last_seen_at = now() - interval '5 minutes' WHERE id = $1`,
      [live.deviceId],
    );
    await rt.pass();
    expect(new Date((await device(live.deviceId)).last_seen_at).getTime()).toBeGreaterThan(
      Date.now() - 10_000,
    );
    expect((await device(live.deviceId)).status).toBe('connected');
    expect((await device(dead.deviceId)).status).toBe('disconnected');
    expect((await events(dead.deviceId)).at(-1)).toMatchObject({
      status: 'disconnected',
      label: 'Disconnected',
    });
    await h.owner.query(`ALTER TABLE devices ENABLE TRIGGER ALL`).catch(() => undefined);
  });

  it('a device whose worker died is adopted by another worker once its lease runs out', async () => {
    const { t, deviceId } = await arrange('failover');
    await seedAuth(t, deviceId, 3);
    const a = await worker();
    await a.rt.adopt(t.orgId, deviceId);
    await settle();
    const b = await worker();
    await b.rt.restore();
    expect(b.rt.isOwned(t.orgId, deviceId)).toBe(false); // still owned by a
    await redis.del(waKeys.lease(t.orgId, deviceId)); // a died: the lease expired
    await b.rt.restore();
    await settle();
    expect(b.rt.isReady(t.orgId, deviceId)).toBe(true);
  });

  it('shutdown closes the connection but keeps the session and never unlinks', async () => {
    const { t, deviceId } = await arrange('shutdown');
    await seedAuth(t, deviceId, 3);
    const { rt, factory } = await worker();
    await rt.adopt(t.orgId, deviceId);
    await settle();
    await rt.onApplicationShutdown();
    expect(factory.last.ended).toBe(true);
    expect(factory.last.loggedOut).toBe(false);
    expect(await store.count(t.orgId, deviceId)).toBe(3);
    expect(await redis.get(waKeys.lease(t.orgId, deviceId))).toBeNull();
  });
});

describe('pairing commands between processes (WD-NODE-008, 009, 010)', () => {
  const qrScript = (factory: FakeFactory) => {
    factory.script = (s) =>
      setImmediate(() => {
        s.emit({ type: 'connecting' });
        s.emit({ type: 'qr', qr: `QR-${Math.random().toString(36).slice(2, 8)}` });
      });
  };

  it('returns the QR from the worker that owns the device, and reports Qr generated', async () => {
    const { t, deviceId } = await arrange('qr');
    const { factory } = await worker();
    qrScript(factory);
    const res = await control.requestQr(t.orgId, deviceId);
    expect(res).toMatchObject({ ok: true, status: 'qr_ready' });
    expect((res as { qr: string }).qr).toMatch(/^QR-/);
    expect((await events(deviceId)).some((e) => e.label === 'Qr generated')).toBe(true);
    const view = await control.status(t.orgId, deviceId);
    expect(view).toMatchObject({ status: 'needs_pair', progress: 30, label: 'Qr generated' });
    expect(view!.qr).toBe((res as { qr: string }).qr);
  });

  it('only the owner answers when there are several workers', async () => {
    const { t, deviceId } = await arrange('qr2');
    const a = await worker();
    const b = await worker();
    qrScript(a.factory);
    qrScript(b.factory);
    await a.rt.adopt(t.orgId, deviceId, { connect: false });
    const res = await control.requestQr(t.orgId, deviceId);
    expect(res.ok).toBe(true);
    expect(a.factory.sockets.length).toBeGreaterThan(0);
    expect(b.factory.sockets).toHaveLength(0);
  });

  it('refuses a second attempt while one is in progress, and says connected when already linked', async () => {
    const { t, deviceId } = await arrange('qr3');
    const { factory } = await worker();
    await redis.set(waKeys.initLock(t.orgId, deviceId), '1', 'EX', 60);
    qrScript(factory);
    expect(await control.requestQr(t.orgId, deviceId)).toMatchObject({ ok: false, status: 'busy' });
    await redis.del(waKeys.initLock(t.orgId, deviceId));

    const up = await arrange('qr4');
    const w2 = await worker();
    await w2.rt.adopt(up.t.orgId, up.deviceId);
    await settle();
    expect(await control.requestQr(up.t.orgId, up.deviceId)).toMatchObject({
      ok: true,
      status: 'connected',
      qr: null,
      message: 'Client already ready',
    });
    expect(w2.factory.sockets).toHaveLength(1); // no new socket
  });

  it('a pairing code: generated for this phone, the same one inside 2 minutes, a clear refusal for a short number', async () => {
    const { t, deviceId, digits } = await arrange('code');
    const { factory } = await worker();
    factory.script = (s) => setImmediate(() => s.emit({ type: 'connecting' }));
    const first = await control.requestPairingCode(t.orgId, deviceId);
    expect(first).toEqual({ ok: true, status: 'code_ready', code: 'ZX81KQ7M', expiresIn: 180 });
    expect(factory.last.pairingFor).toBe(digits);
    const sockets = factory.sockets.length;
    const again = await control.requestPairingCode(t.orgId, deviceId);
    expect(again).toMatchObject({ ok: true, code: 'ZX81KQ7M' });
    expect(factory.sockets).toHaveLength(sockets); // nothing regenerated mid-entry

    const short = await arrange('codeshort', { phone: '12345' });
    const r = await control.requestPairingCode(short.t.orgId, short.deviceId);
    expect(r).toMatchObject({
      ok: false,
      status: 'error',
      message: 'Phone number must include the country code.',
    });
    expect((await events(short.deviceId)).at(-1)!.label).toBe('Pairing failed: Phone number ...');
  });

  it('terminate unlinks, wipes the session, marks Disconnected and frees the device', async () => {
    const { t, deviceId } = await arrange('terminate');
    await seedAuth(t, deviceId, 4);
    const { rt, factory } = await worker();
    await rt.adopt(t.orgId, deviceId);
    await settle();
    expect(await control.terminate(t.orgId, deviceId)).toEqual({ ok: true, status: 'terminated' });
    expect(factory.last.loggedOut).toBe(true);
    expect(await store.count(t.orgId, deviceId)).toBe(0);
    expect((await device(deviceId)).status).toBe('disconnected');
    expect(rt.isOwned(t.orgId, deviceId)).toBe(false);
  });

  it('with no worker running the answer says so instead of waiting', async () => {
    const { t, deviceId } = await arrange('noworker');
    expect(await control.requestQr(t.orgId, deviceId)).toEqual({
      ok: false,
      status: 'error',
      message: 'The WhatsApp worker is not running.',
    });
  });

  it('status is a pure read: it starts nothing and stops nothing, and an unknown device is null', async () => {
    const { t, deviceId } = await arrange('statusonly');
    const { factory } = await worker();
    expect(await control.status(t.orgId, deviceId)).toMatchObject({
      status: 'disconnected',
      progress: 50,
      qr: null,
    });
    expect(factory.sockets).toHaveLength(0);
    expect(await control.status(t.orgId, 999999)).toBeNull();
  });
});

describe('the proxy (WD-NODE-013)', () => {
  it('keeps what the last connection check found on the device', async () => {
    const { t, deviceId } = await arrange('proxy');
    const { rt } = await worker();
    await rt.recordProxyResult(t.orgId, deviceId, { ok: true, egressIp: '203.0.113.9' });
    expect(await device(deviceId)).toMatchObject({
      proxy_status: 'ok',
      proxy_egress_ip: '203.0.113.9',
    });
    await rt.recordProxyResult(t.orgId, deviceId, { ok: false, error: 'timeout' });
    expect(await device(deviceId)).toMatchObject({
      proxy_status: 'unreachable',
      proxy_egress_ip: null,
    });
    expect((await device(deviceId)).proxy_checked_at).not.toBeNull();
  });

  it('hands the device proxy, with its password decrypted, to the socket factory at every connect', async () => {
    const { t, deviceId } = await arrange('proxy2');
    const crypto = h.app.get(CryptoService, { strict: false });
    await h.owner.query(
      `UPDATE devices SET proxy_enabled = true, proxy_type = 'socks5', proxy_host = 'p.test', proxy_port = 1080, proxy_username = 'u', proxy_password = $2 WHERE id = $1`,
      [deviceId, crypto.encrypt('s3cret')],
    );
    const { rt, factory } = await worker();
    await rt.adopt(t.orgId, deviceId);
    await settle();
    expect(factory.targets[0]!.proxy).toEqual({
      type: 'socks5',
      host: 'p.test',
      port: 1080,
      username: 'u',
      password: 's3cret',
    });
  });
});
