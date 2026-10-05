import { randomUUID } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import {
  PlatformInfrastructureModule,
  RedisLockService,
} from '../../../src/modules/platform-infrastructure';

/** Against a real Redis: the scripts are the logic. CI provides a Redis service; locally REDIS_URL from .env. */
const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
let redis: Redis;
let locks: RedisLockService;
const keys: string[] = [];
const fresh = () => {
  const k = `test:lock:${randomUUID()}`;
  keys.push(k);
  return k;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(() => {
  redis = new Redis(url, { maxRetriesPerRequest: 1 });
  locks = new RedisLockService(redis);
});

afterAll(async () => {
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

/** A service whose Redis is unreachable. */
function unreachable() {
  const dead = new Redis({
    host: '127.0.0.1',
    port: 1,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  dead.on('error', () => undefined);
  return { service: new RedisLockService(dead), stop: () => dead.disconnect() };
}

describe('acquire / release', () => {
  it('gives the lock to exactly one of 50 concurrent callers', async () => {
    const key = fresh();
    const got = await Promise.all(
      Array.from({ length: 50 }, () => locks.acquire(key, { ttlMs: 5000, onUnavailable: 'skip' })),
    );
    expect(got.filter(Boolean)).toHaveLength(1);
  });

  it('refuses a second holder until the first releases, then lets the next in', async () => {
    const key = fresh();
    const first = await locks.acquire(key, { ttlMs: 5000, onUnavailable: 'skip' });
    expect(first).not.toBeNull();
    expect(await locks.acquire(key, { ttlMs: 5000, onUnavailable: 'skip' })).toBeNull();
    expect(await first!.release()).toBe(true);
    expect(await locks.acquire(key, { ttlMs: 5000, onUnavailable: 'skip' })).not.toBeNull();
  });

  it('lets a crashed holder go: the lock expires on its own', async () => {
    const key = fresh();
    await locks.acquire(key, { ttlMs: 150, onUnavailable: 'skip' });
    expect(await locks.acquire(key, { ttlMs: 5000, onUnavailable: 'skip' })).toBeNull();
    await sleep(250);
    expect(await locks.acquire(key, { ttlMs: 5000, onUnavailable: 'skip' })).not.toBeNull();
  });

  it('never frees a lock that has passed to someone else (the token decides, not the key)', async () => {
    const key = fresh();
    const slow = await locks.acquire(key, { ttlMs: 100, onUnavailable: 'skip' });
    await sleep(200);
    const next = await locks.acquire(key, { ttlMs: 5000, onUnavailable: 'skip' });
    expect(next).not.toBeNull();
    expect(await slow!.release()).toBe(false); // the slow holder's late release is a no-op
    expect(await redis.get(key)).toBe(next!.token); // and the new holder is untouched
    expect(await locks.acquire(key, { ttlMs: 5000, onUnavailable: 'skip' })).toBeNull();
  });

  it('release is idempotent', async () => {
    const lease = await locks.acquire(fresh(), { ttlMs: 5000, onUnavailable: 'skip' });
    expect(await lease!.release()).toBe(true);
    expect(await lease!.release()).toBe(false);
    expect(lease!.held).toBe(false);
  });

  it('renew extends the expiry and refuses once the lock is gone', async () => {
    const key = fresh();
    const lease = (await locks.acquire(key, { ttlMs: 300, onUnavailable: 'skip' }))!;
    await sleep(200);
    expect(await lease.renew(2000)).toBe(true);
    expect(await redis.pttl(key)).toBeGreaterThan(1000);
    await redis.del(key);
    expect(await lease.renew()).toBe(false);
    expect(lease.held).toBe(false);
  });

  it('renew does not steal back a lock another holder took', async () => {
    const key = fresh();
    const old = (await locks.acquire(key, { ttlMs: 80, onUnavailable: 'skip' }))!;
    await sleep(150);
    const next = (await locks.acquire(key, { ttlMs: 5000, onUnavailable: 'skip' }))!;
    expect(await old.renew(60_000)).toBe(false);
    expect(await redis.get(key)).toBe(next.token);
    expect(await redis.pttl(key)).toBeLessThanOrEqual(5000);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a ttl of %s', async (ttlMs) => {
    await expect(locks.acquire(fresh(), { ttlMs, onUnavailable: 'skip' })).rejects.toThrow(
      RangeError,
    );
  });
});

describe('withLock', () => {
  it('runs the work once under contention and returns its value', async () => {
    const key = fresh();
    let running = 0;
    let maxRunning = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        locks.withLock(key, { ttlMs: 5000, onUnavailable: 'skip' }, async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await sleep(30);
          running--;
          return 'done';
        }),
      ),
    );
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    expect(results.find((r) => r.acquired)).toMatchObject({ value: 'done', lost: false });
    expect(maxRunning).toBe(1);
  });

  it('releases when the work throws, and rethrows', async () => {
    const key = fresh();
    await expect(
      locks.withLock(key, { ttlMs: 5000, onUnavailable: 'skip' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await redis.exists(key)).toBe(0);
  });

  it('keeps the lock past its TTL while the work runs (heartbeat)', async () => {
    const key = fresh();
    const out = await locks.withLock(
      key,
      { ttlMs: 300, renewEveryMs: 80, onUnavailable: 'skip' },
      async ({ lease }) => {
        await sleep(900); // three TTLs
        const other = await locks.acquire(key, { ttlMs: 1000, onUnavailable: 'skip' });
        return { stolen: other !== null, held: lease.held };
      },
    );
    expect(out).toMatchObject({
      acquired: true,
      lost: false,
      value: { stolen: false, held: true },
    });
  });

  it('aborts the work and reports lost when the lease is taken over', async () => {
    const key = fresh();
    const out = await locks.withLock(
      key,
      { ttlMs: 300, renewEveryMs: 50, onUnavailable: 'skip' },
      async ({ signal }) => {
        await redis.set(key, 'someone-else'); // another holder takes over
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        return signal.aborted;
      },
    );
    expect(out).toMatchObject({ acquired: true, value: true, lost: true });
    expect(await redis.get(key)).toBe('someone-else'); // and the takeover's lock is not released by the old holder
  });

  it('without a heartbeat the work must fit the TTL', async () => {
    const key = fresh();
    await locks.withLock(key, { ttlMs: 100, renewEveryMs: 0, onUnavailable: 'skip' }, async () => {
      await sleep(250);
    });
    // expired mid-work and released by nobody: the key is simply gone
    expect(await redis.exists(key)).toBe(0);
  });

  it('can wait for a busy lock and gets it when it frees', async () => {
    const key = fresh();
    const holder = (await locks.acquire(key, { ttlMs: 5000, onUnavailable: 'skip' }))!;
    setTimeout(() => void holder.release(), 120);
    const out = await locks.withLock(
      key,
      { ttlMs: 5000, onUnavailable: 'skip', wait: { timeoutMs: 2000, retryMs: 20 } },
      async () => 'got it',
    );
    expect(out).toMatchObject({ acquired: true, value: 'got it' });
  });

  it('gives up after the wait timeout', async () => {
    const key = fresh();
    await locks.acquire(key, { ttlMs: 5000, onUnavailable: 'skip' });
    const startedAt = Date.now();
    const out = await locks.withLock(
      key,
      { ttlMs: 5000, onUnavailable: 'skip', wait: { timeoutMs: 200, retryMs: 20 } },
      async () => 'never',
    );
    expect(out).toEqual({ acquired: false });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('rejects a renewal period that would let the lease lapse between beats', async () => {
    await expect(
      locks.withLock(
        fresh(),
        { ttlMs: 100, renewEveryMs: 100, onUnavailable: 'skip' },
        async () => 1,
      ),
    ).rejects.toThrow(/shorter than ttlMs/);
  });
});

describe('once', () => {
  it('is true for the first caller in the window and false for the rest', async () => {
    const key = fresh();
    const got = await Promise.all(Array.from({ length: 30 }, () => locks.once(key, 5000, 'skip')));
    expect(got.filter(Boolean)).toHaveLength(1);
  });

  it('opens again after the window', async () => {
    const key = fresh();
    expect(await locks.once(key, 100, 'skip')).toBe(true);
    expect(await locks.once(key, 100, 'skip')).toBe(false);
    await sleep(180);
    expect(await locks.once(key, 100, 'skip')).toBe(true);
  });
});

describe('when Redis is unreachable', () => {
  it('acquire with skip reports "not acquired"; with proceed hands back an unprotected lease', async () => {
    const { service, stop } = unreachable();
    expect(await service.acquire('k', { ttlMs: 1000, onUnavailable: 'skip' })).toBeNull();
    const lease = await service.acquire('k', { ttlMs: 1000, onUnavailable: 'proceed' });
    expect(lease).toMatchObject({ degraded: true, held: true });
    expect(await lease!.renew()).toBe(true);
    expect(await lease!.release()).toBe(true);
    stop();
  });

  it('withLock runs the work only under proceed', async () => {
    const { service, stop } = unreachable();
    const skipped = await service.withLock(
      'k',
      { ttlMs: 1000, onUnavailable: 'skip' },
      async () => 1,
    );
    expect(skipped).toEqual({ acquired: false });
    const ran = await service.withLock(
      'k',
      { ttlMs: 1000, onUnavailable: 'proceed' },
      async () => 2,
    );
    expect(ran).toMatchObject({ acquired: true, value: 2, lost: false });
    stop();
  });

  it('once answers by policy: skip says "already done", proceed says "go ahead"', async () => {
    const { service, stop } = unreachable();
    expect(await service.once('k', 1000, 'skip')).toBe(false);
    expect(await service.once('k', 1000, 'proceed')).toBe(true);
    stop();
  });
});

describe('wiring', () => {
  it('PlatformInfrastructureModule provides and exports the lock service', async () => {
    @Global()
    @Module({ providers: [{ provide: REDIS_CLIENT, useValue: redis }], exports: [REDIS_CLIENT] })
    class FakeRedisModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [FakeRedisModule, PlatformInfrastructureModule],
    }).compile();
    const service = moduleRef.get(RedisLockService);
    const lease = await service.acquire(fresh(), { ttlMs: 1000, onUnavailable: 'skip' });
    expect(lease).not.toBeNull();
    await lease!.release();
  });
});
