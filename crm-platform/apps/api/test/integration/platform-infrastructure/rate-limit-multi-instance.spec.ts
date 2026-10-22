import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/modules/platform-infrastructure';
import { startTcpFaultProxy, type TcpFaultProxy } from '../../unit/network-failure/tcp-fault-proxy';

/**
 * Several API instances behind a load balancer share one Redis. These cases prove the limit holds across instances, with skewed
 * clocks, with many keys, and through a Redis outage (QA sheet 3, item 33). Real Redis: the Lua script is the logic.
 */
const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
const WINDOW = 60;
const T0 = Math.floor(Date.now() / (WINDOW * 1000)) * WINDOW * 1000;
const t = (windows: number, intoWindowMs = 0) => T0 + windows * WINDOW * 1000 + intoWindowMs;

const clients: Redis[] = [];
const prefix = `test:rlmi:${randomUUID()}`;
const fresh = (n = 'k') => `${prefix}:${n}:${randomUUID()}`;
const connect = (target: string | { host: string; port: number } = url) => {
  const r =
    typeof target === 'string'
      ? new Redis(target, { maxRetriesPerRequest: 1 })
      : new Redis({
          ...target,
          maxRetriesPerRequest: 0,
          retryStrategy: (n) => Math.min(n * 50, 200),
        });
  r.on('error', () => undefined);
  clients.push(r);
  return r;
};

let admin: Redis;
let proxy: TcpFaultProxy | undefined;

beforeAll(() => {
  admin = connect();
});

afterAll(async () => {
  const keys = await admin.keys(`${prefix}:*`);
  if (keys.length) await admin.del(...keys);
  await proxy?.close();
  for (const c of clients) c.disconnect();
});

describe('rate limit across instances', () => {
  it('two instances share one counter: 3 instances x 10 concurrent calls admit exactly the limit', async () => {
    const limiters = [connect(), connect(), connect()].map((r) => new RateLimiter(r));
    const key = fresh();
    const results = await Promise.all(
      limiters.flatMap((l) =>
        Array.from({ length: 10 }, () => l.consume(key, 12, WINDOW, t(0, 5000))),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(12);
  });

  it('a skewed clock (2 s) lets at most one extra request through at a window boundary', async () => {
    const a = new RateLimiter(connect());
    const b = new RateLimiter(connect());
    const key = fresh();
    let allowed = 0;
    for (let i = 0; i < 20; i++)
      if ((await a.consume(key, 10, WINDOW, t(0, 59_000))).allowed) allowed++;
    // b's clock is 2 s ahead: it is already in the next window
    for (let i = 0; i < 20; i++)
      if ((await b.consume(key, 10, WINDOW, t(1, 1000))).allowed) allowed++;
    expect(allowed).toBeLessThanOrEqual(11);
  });

  it('2,000 rotating keys (an attacker changing address every call) all expire within two windows', async () => {
    const limiter = new RateLimiter(connect());
    const base = fresh('rot');
    await Promise.all(
      Array.from({ length: 2000 }, (_, i) => limiter.consume(`${base}:${i}`, 5, WINDOW)),
    );
    const keys = await admin.keys(`${base}:*`);
    expect(keys).toHaveLength(2000);
    const ttls = await Promise.all(keys.map((k) => admin.pttl(k)));
    expect(ttls.every((x) => x > 0 && x <= 2 * WINDOW * 1000)).toBe(true);
  });

  it('losing the counters (a Redis restart without persistence) resets the limit: documented, not hidden', async () => {
    const limiter = new RateLimiter(connect());
    const key = fresh();
    for (let i = 0; i < 5; i++) await limiter.consume(key, 5, WINDOW, t(0, 1000));
    expect((await limiter.consume(key, 5, WINDOW, t(0, 1000))).allowed).toBe(false);
    await admin.del(...(await admin.keys(`${key}:*`)));
    expect((await limiter.consume(key, 5, WINDOW, t(0, 1000))).allowed).toBe(true);
  });

  it('survives a Redis outage: fails open and flags degraded, then enforces again with the counters kept', async () => {
    const u = new URL(url);
    proxy = await startTcpFaultProxy({ host: u.hostname, port: Number(u.port || 6379) });
    const limiter = new RateLimiter(connect({ host: proxy.host, port: proxy.port }));
    const key = fresh();
    for (let i = 0; i < 5; i++) await limiter.consume(key, 5, WINDOW, t(0, 1000));
    expect((await limiter.consume(key, 5, WINDOW, t(0, 1000))).allowed).toBe(false);

    await proxy.setMode('refuse');
    const during = await limiter.consume(key, 5, WINDOW, t(0, 1000));
    expect(during).toMatchObject({ allowed: true, degraded: true });

    await proxy.setMode('pass');
    let after = await limiter.consume(key, 5, WINDOW, t(0, 1000));
    for (let i = 0; i < 40 && after.degraded; i++) {
      await new Promise((r) => setTimeout(r, 100));
      after = await limiter.consume(key, 5, WINDOW, t(0, 1000));
    }
    expect(after).toMatchObject({ allowed: false, degraded: false });
  }, 20_000);
});
