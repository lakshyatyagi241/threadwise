import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTcpFaultProxy, type TcpFaultProxy } from '../../unit/network-failure/tcp-fault-proxy';
import { spawnInstance, type RemoteInstance } from './cross-process';
import { buildInstance, secondsUntil, startEnv, type Env, type Instance } from './harness';
import { record } from './results';

/**
 * Platform-wide state that lives in platform_settings and is mirrored or snapshotted in memory (item #66): the settings snapshot
 * (M03, 5 s), the token epoch (R07/M02, 5 s) and the send halt (R08, 30 s). Process A is this test's own instance; process B is a real
 * second OS process on the same Postgres and Redis. The writer is B, the reader is A, so nothing but the documented mechanism can
 * make A fresh. Seconds are measured on a monotonic clock.
 */
describe('platform settings, token epoch and send halt across two processes', () => {
  let env: Env;
  let a: Instance;
  let b: RemoteInstance;
  const proxies: TcpFaultProxy[] = [];

  beforeAll(async () => {
    env = await startEnv();
    a = buildInstance(env, 'A');
    b = await spawnInstance(env, 'B');
  }, 240_000);
  afterAll(async () => {
    b?.kill();
    await a?.close();
    for (const p of proxies) await p.close();
    await env?.stop();
  });

  it('settings snapshot: written by B, A is fresh within 5 s (measured); written by A, A is fresh at once', async () => {
    expect(await a.settings.get('ci66.k')).toBeUndefined(); // A now holds a snapshot without the key
    await b.call('settings.set', 'ci66.k', 1);
    const s = await secondsUntil(() => a.settings.get<number>('ci66.k').then((v) => v ?? 0), 1, 8);
    expect(s).toBeLessThanOrEqual(5.5);
    record('M03 settings snapshot', {
      writer: 'other process',
      measuredStaleSeconds: s,
      documentedSeconds: 5,
    });
    await a.settings.set('ci66.k', 2, null);
    expect(await a.settings.get('ci66.k')).toBe(2);
  });

  it('token epoch: bumped by B, A (holding a 5 s copy) is fresh within 5 s; B itself at once', async () => {
    expect(await a.epoch.current()).toBe(0);
    const next = await b.call<number>('epoch.bump', 1);
    expect(next).toBe(1);
    expect(await b.call('epoch.current')).toBe(1);
    const s = await secondsUntil(() => a.epoch.current(), 1, 8);
    expect(s).toBeLessThanOrEqual(5.5);
    record('R07/M02 token epoch', {
      writer: 'other process',
      measuredStaleSeconds: s,
      documentedSeconds: 5,
    });
  });

  it('two processes bump the epoch one after the other: the epoch advances twice (defect D1: the second read a stale snapshot)', async () => {
    // B holds a settings snapshot from before A's bump; both bump through the real service.
    const before = await b.call<number>('epoch.current');
    await b.call('settings.get', 'auth.epoch'); // B's snapshot now says `before`
    const first = await a.epoch.bump(1);
    expect(first).toBe(before + 1);
    const second = await b.call<number>('epoch.bump', 1); // B's snapshot is up to 5 s old
    expect(second).toBe(before + 2);
    const stored = await env.pg.owner.query(
      `SELECT value FROM platform_settings WHERE key = 'auth.epoch'`,
    );
    expect(Number(stored.rows[0].value)).toBe(before + 2);
  });

  it('send halt: set by B, A (no process copy) sees it at once; cleared by B likewise', async () => {
    expect(await a.halt.isHalted()).toBe(false);
    await b.call('halt.set', true);
    expect(await a.halt.isHalted()).toBe(true);
    await b.call('halt.set', false);
    expect(await a.halt.isHalted()).toBe(false);
  });

  it('send halt, the mirror write is lost (Redis unreachable for B): A is fresh within the 30 s mirror TTL, not later', async () => {
    const proxy = await startTcpFaultProxy({ host: env.redis.host, port: env.redis.port });
    proxies.push(proxy);
    const c = await spawnInstance(env, 'C', `redis://127.0.0.1:${proxy.port}`);
    try {
      expect(await a.halt.isHalted()).toBe(false); // mirror '0' is in Redis with a TTL
      expect(await c.call('halt.is')).toBe(false);
      await proxy.setMode('refuse'); // C cannot reach Redis from now on, but still reaches Postgres
      await c.call('halt.set', true); // Postgres is written, the mirror is not
      expect(await env.admin.get('auth:send-halt')).toBe('0');
      const s = await secondsUntil(() => a.halt.isHalted(), true, 40, 250);
      expect(s).toBeLessThanOrEqual(30.5);
      record('R08 send-halt mirror, write lost', {
        measuredStaleSeconds: s,
        documentedSeconds: 30,
      });
    } finally {
      c.kill();
    }
  }, 90_000);

  it('token epoch, the mirror write is lost (Redis unreachable for the bumping process): every process is fresh within 30 s + 5 s (defect D2: it was never)', async () => {
    const proxy = await startTcpFaultProxy({ host: env.redis.host, port: env.redis.port });
    proxies.push(proxy);
    const c = await spawnInstance(env, 'C2', `redis://127.0.0.1:${proxy.port}`);
    try {
      await env.admin.del('auth:epoch');
      const reader = buildInstance(env, 'R'); // cold: its first read fills the mirror the normal way
      const now = await reader.epoch.current();
      expect(await env.admin.get('auth:epoch')).toBe(String(now));
      await proxy.setMode('refuse');
      const next = await c.call<number>('epoch.bump', 1);
      expect(next).toBe(now + 1);
      expect(await env.admin.get('auth:epoch')).toBe(String(now)); // the mirror really is stale
      const s = await secondsUntil(() => reader.epoch.current(), now + 1, 45, 250);
      expect(s).toBeLessThanOrEqual(35.5);
      await reader.close();
      record('R07 token epoch mirror, write lost', {
        measuredStaleSeconds: s,
        documentedSeconds: 35,
      });
    } finally {
      c.kill();
    }
  }, 90_000);
});
