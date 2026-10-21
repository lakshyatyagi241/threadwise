import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BearerApiKeyGuard } from '../../../src/modules/developer-rest-api-v1/auth/bearer-api-key.guard';
import { ApiKeyAccessService } from '../../../src/modules/public-api/api-key-access.service';
import {
  bustFooterCache,
  FooterKeys,
} from '../../../src/modules/auth/security/branding-footer.service';
import { incrWithTtl } from '../../../src/infra/redis/counter';
import { startOwnRedis, type OwnRedis } from './own-redis';

/**
 * A counter must never exist without a lifetime. The old pattern was two commands, `INCR key` then (when the answer was 1)
 * `EXPIRE key`: when the second never arrives (a dropped connection, a command timeout, the process dying between the two) the
 * counter lives for ever. For a failed-login throttle that is a permanent lockout of one address; for a version counter it is a key per
 * workspace that is never freed. The proxy below makes the standalone EXPIRE fail, which is exactly that lost second command; a counter
 * written as one MULTI is not affected.
 */
// unique per run: against a reused REDIS_AUDIT_URL server an earlier run's keys must not be seen
const RUN = randomUUID().slice(0, 8);
const k = (n: string) => `test:${RUN}:${n}`;
const IP = `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const ORG = 1_000_000 + Math.floor(Math.random() * 1_000_000);
let own: OwnRedis;
let redis: Redis;

/** A client whose standalone EXPIRE/PEXPIRE is lost. A command sent inside MULTI/EXEC does not go through these methods. */
const losesExpire = (r: Redis): Redis =>
  new Proxy(r, {
    get(target, prop) {
      if (prop === 'expire' || prop === 'pexpire')
        return () => Promise.reject(new Error('connection lost before EXPIRE'));
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });

beforeAll(async () => {
  own = await startOwnRedis();
  redis = own.client();
}, 120_000);
afterAll(async () => {
  await own.stop();
});

const ttl = (key: string) => redis.ttl(key);

describe('incrWithTtl', () => {
  it('counts, sets the lifetime once, and does not move it on later hits', async () => {
    const key = k('c1');
    expect(await incrWithTtl(redis, key, 100)).toBe(1);
    const first = await ttl(key);
    expect(first).toBeGreaterThan(90);
    await redis.expire(key, 50);
    expect(await incrWithTtl(redis, key, 100)).toBe(2);
    expect(await ttl(key)).toBeLessThanOrEqual(50); // a fixed window: later hits do not extend it
  });

  it('gives a counter that already exists without a lifetime one (heals the old failure)', async () => {
    await redis.set(k('c2'), '5');
    expect(await ttl(k('c2'))).toBe(-1);
    expect(await incrWithTtl(redis, k('c2'), 60)).toBe(6);
    expect(await ttl(k('c2'))).toBeGreaterThan(0);
  });

  it('propagates a Redis failure so the caller decides (fail open or closed)', async () => {
    const dead = own.client({
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    });
    await expect(incrWithTtl(dead, k('c3'), 10)).rejects.toThrow();
  });
});

describe('the counters that used INCR then EXPIRE', () => {
  it('failed API-key authentications (partner keys) keep a lifetime when the EXPIRE is lost', async () => {
    const svc = new ApiKeyAccessService(
      null as never,
      losesExpire(redis),
      null as never,
      null as never,
      null as never,
    );
    await svc.recordAuthFailure('partner', IP);
    const t = await ttl(`apikey:authfail:partner:${IP}`);
    expect(t, 'counter has no lifetime: that address would be locked out for ever').toBeGreaterThan(
      0,
    );
    expect(t).toBeLessThanOrEqual(60);
  });

  it('failed bearer-key authentications keep a lifetime when the EXPIRE is lost', async () => {
    const guard = Object.create(BearerApiKeyGuard.prototype) as {
      redis: Redis;
      recordFailure(ip: string): Promise<void>;
    };
    guard.redis = losesExpire(redis);
    await guard.recordFailure(IP);
    const t = await ttl(`apikey:authfail:${IP}`);
    expect(t, 'counter has no lifetime: that address would be locked out for ever').toBeGreaterThan(
      0,
    );
    expect(t).toBeLessThanOrEqual(60);
  });

  it('the per-minute API-key rate counter keeps a lifetime when the EXPIRE is lost', async () => {
    const svc = new ApiKeyAccessService(
      null as never,
      losesExpire(redis),
      null as never,
      null as never,
      null as never,
    );
    await (
      svc as unknown as { consume(r: undefined, k: string, l: number): Promise<void> }
    ).consume(undefined, k('rate'), 100);
    const keys = await redis.keys(`ratelimit:apikey:${k('rate')}:*`);
    expect(keys).toHaveLength(1);
    expect(await ttl(keys[0]!)).toBeGreaterThan(0);
  });

  it('branding-footer version counters expire (one key per workspace otherwise stays for ever)', async () => {
    await bustFooterCache(redis, ORG);
    await bustFooterCache(redis);
    expect(await ttl(FooterKeys.org(ORG))).toBeGreaterThan(60); // longer than the 60 s the cache trusts a version
    expect(await ttl(FooterKeys.platform)).toBeGreaterThan(60);
  });
});
