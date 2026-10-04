import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/modules/platform-infrastructure';

/**
 * The limiter against a real Redis (the Lua script is the logic, so a fake would test nothing). CI provides a Redis service;
 * locally `docker compose up -d redis` and REDIS_URL from .env.
 */
const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
const WINDOW = 60;
// Start of a window, so "into the window" below is exact.
const T0 = Math.floor(Date.now() / (WINDOW * 1000)) * WINDOW * 1000;
const t = (windows: number, intoWindowMs = 0) => T0 + windows * WINDOW * 1000 + intoWindowMs;

let redis: Redis;
let limiter: RateLimiter;
const keys: string[] = [];
const fresh = () => {
  const k = `test:rl:${randomUUID()}`;
  keys.push(k);
  return k;
};

beforeAll(() => {
  redis = new Redis(url, { maxRetriesPerRequest: 1 });
  limiter = new RateLimiter(redis);
});

afterAll(async () => {
  const toDelete = (await Promise.all(keys.map((k) => redis.keys(`${k}:*`)))).flat();
  if (toDelete.length > 0) await redis.del(...toDelete);
  await redis.quit();
});

describe('RateLimiter (Redis)', () => {
  it('allows exactly `limit` requests in a window, then refuses', async () => {
    const key = fresh();
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await limiter.consume(key, 5, WINDOW, t(0, 1000)));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, true, false, false]);
    expect(results.map((r) => r.remaining)).toEqual([4, 3, 2, 1, 0, 0, 0]);
    expect(results.every((r) => !r.degraded)).toBe(true);
  });

  it('is atomic: 100 concurrent requests against a limit of 10 admit exactly 10', async () => {
    const key = fresh();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => limiter.consume(key, 10, WINDOW, t(0, 5000))),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it('does not count a refused request, so hammering does not extend the penalty', async () => {
    const key = fresh();
    for (let i = 0; i < 5; i++) await limiter.consume(key, 5, WINDOW, t(0, 1000));
    for (let i = 0; i < 200; i++) await limiter.consume(key, 5, WINDOW, t(0, 2000));
    const current = await redis.get(`${key}:${Math.floor(t(0) / (WINDOW * 1000))}`);
    expect(Number(current)).toBe(5);
  });

  it('reports the seconds until the window rolls, at least 1', async () => {
    const key = fresh();
    for (let i = 0; i < 3; i++) await limiter.consume(key, 3, WINDOW, t(0, 0));
    const early = await limiter.consume(key, 3, WINDOW, t(0, 10_000));
    expect(early).toMatchObject({ allowed: false, retryAfterSeconds: 50 });
    const late = await limiter.consume(key, 3, WINDOW, t(0, 59_999));
    expect(late.retryAfterSeconds).toBe(1);
  });

  it('weighs the previous window: right after a full window only the rounding error of one request fits', async () => {
    const key = fresh();
    for (let i = 0; i < 5; i++) await limiter.consume(key, 5, WINDOW, t(0, 59_000));
    // 1 s into the next window the previous one still weighs 59/60 (4.92 of 5): one more fits, then it is full again
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await limiter.consume(key, 5, WINDOW, t(1, 1000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
  });

  it('lets the previous window decay: half a window later, about half the quota is back', async () => {
    const key = fresh();
    for (let i = 0; i < 10; i++) await limiter.consume(key, 10, WINDOW, t(0, 59_000));
    const results = [];
    for (let i = 0; i < 10; i++) results.push(await limiter.consume(key, 10, WINDOW, t(1, 30_000)));
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBeGreaterThanOrEqual(4);
    expect(allowed).toBeLessThanOrEqual(6);
  });

  it('bounds a burst across the window boundary far below the 2x of a fixed window', async () => {
    const key = fresh();
    let allowed = 0;
    for (let i = 0; i < 20; i++) {
      if ((await limiter.consume(key, 10, WINDOW, t(0, 59_900))).allowed) allowed++;
    }
    for (let i = 0; i < 20; i++) {
      if ((await limiter.consume(key, 10, WINDOW, t(1, 100))).allowed) allowed++;
    }
    expect(allowed).toBeLessThanOrEqual(11);
  });

  it('forgets everything after two windows with no traffic', async () => {
    const key = fresh();
    for (let i = 0; i < 5; i++) await limiter.consume(key, 5, WINDOW, t(0, 1000));
    const later = await limiter.consume(key, 5, WINDOW, t(2, 0));
    expect(later).toMatchObject({ allowed: true, remaining: 4 });
  });

  it('keeps separate keys independent', async () => {
    const a = fresh();
    const b = fresh();
    for (let i = 0; i < 3; i++) await limiter.consume(a, 3, WINDOW, t(0, 1000));
    expect((await limiter.consume(a, 3, WINDOW, t(0, 1000))).allowed).toBe(false);
    expect((await limiter.consume(b, 3, WINDOW, t(0, 1000))).allowed).toBe(true);
  });

  it('expires its keys, so counters cannot pile up in Redis', async () => {
    const key = fresh();
    await limiter.consume(key, 5, WINDOW);
    const live = await redis.keys(`${key}:*`);
    expect(live).toHaveLength(1);
    const ttl = await redis.pttl(live[0] as string);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2 * WINDOW * 1000);
  });

  it('fails open and says so when Redis is unreachable', async () => {
    const dead = new Redis({
      host: '127.0.0.1',
      port: 1,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    dead.on('error', () => undefined);
    const result = await new RateLimiter(dead).consume('x', 5, WINDOW);
    expect(result).toMatchObject({ allowed: true, degraded: true });
    dead.disconnect();
  });
});
