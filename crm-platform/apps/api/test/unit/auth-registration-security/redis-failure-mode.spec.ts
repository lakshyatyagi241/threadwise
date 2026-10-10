import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimitService } from '../../../src/modules/auth/security/rate-limit.service';
import { PartnerAgentStatusService } from '../../../src/modules/auth/sessions/partner-agent-status.service';
import {
  degradedError,
  onRedisFailure,
  redisFailsClosed,
} from '../../../src/modules/auth/support/resilience';

const KEYS = ['AUTH_REDIS_FAILURE_MODE', 'NODE_ENV'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
const setEnv = (e: Partial<Record<(typeof KEYS)[number], string | undefined>>) => {
  for (const [k, v] of Object.entries(e)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

describe('failure mode', () => {
  it('is closed in production and open elsewhere by default', () => {
    expect(redisFailsClosed({ NODE_ENV: 'production' })).toBe(true);
    expect(redisFailsClosed({ NODE_ENV: 'development' })).toBe(false);
    expect(redisFailsClosed({ NODE_ENV: 'test' })).toBe(false);
    expect(redisFailsClosed({})).toBe(false);
  });

  it('can be forced either way', () => {
    expect(redisFailsClosed({ NODE_ENV: 'production', AUTH_REDIS_FAILURE_MODE: 'open' })).toBe(
      false,
    );
    expect(redisFailsClosed({ NODE_ENV: 'development', AUTH_REDIS_FAILURE_MODE: 'closed' })).toBe(
      true,
    );
  });

  it('answers closed mode with a 503 the client can retry', () => {
    const err = degradedError();
    expect(err.getStatus()).toBe(503);
    expect(err.code).toBe('AUTH_SERVICE_DEGRADED');
    setEnv({ NODE_ENV: 'production', AUTH_REDIS_FAILURE_MODE: undefined });
    expect(() => onRedisFailure('test', new Error('down'))).toThrow(/temporarily unavailable/);
    setEnv({ NODE_ENV: 'test' });
    expect(() => onRedisFailure('test', new Error('down'))).not.toThrow();
  });
});

const brokenRedis = () => {
  const boom = async () => {
    throw new Error('ECONNREFUSED');
  };
  const chain: Record<string, unknown> = {};
  for (const m of ['incr', 'expire', 'ttl']) chain[m] = () => chain;
  chain.exec = boom;
  return { multi: () => chain, get: boom, ttl: boom, del: boom, set: boom };
};

describe('the login throttle when Redis is down', () => {
  it('carries on unthrottled in open mode (and says so in the log)', async () => {
    setEnv({ NODE_ENV: 'development', AUTH_REDIS_FAILURE_MODE: undefined });
    const rate = new RateLimitService(brokenRedis() as never);
    await expect(rate.hit('k', 60)).resolves.toMatchObject({ count: 1 });
    await expect(rate.peek('k')).resolves.toMatchObject({ count: 0 });
    await expect(rate.allow('k', 5, 60)).resolves.toBe(true);
  });

  it('refuses in closed mode instead of silently skipping the count', async () => {
    setEnv({ NODE_ENV: 'production', AUTH_REDIS_FAILURE_MODE: undefined });
    const rate = new RateLimitService(brokenRedis() as never);
    await expect(rate.hit('k', 60)).rejects.toMatchObject({ code: 'AUTH_SERVICE_DEGRADED' });
    await expect(rate.peek('k')).rejects.toMatchObject({ code: 'AUTH_SERVICE_DEGRADED' });
    await expect(rate.allow('k', 5, 60)).rejects.toMatchObject({ code: 'AUTH_SERVICE_DEGRADED' });
  });
});

describe('partner agent revocation', () => {
  const build = (status: 'active' | 'suspended' | undefined, redis: Record<string, unknown>) => {
    const execute = vi.fn(async () => ({ rows: status ? [{ status }] : [] }));
    const db = { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({ execute }) };
    return { svc: new PartnerAgentStatusService(db as never, redis as never), execute };
  };
  const memoryRedis = () => {
    const m = new Map<string, string>();
    return {
      m,
      get: async (k: string) => m.get(k) ?? null,
      set: async (k: string, v: string) => (m.set(k, v), 'OK'),
      del: async (k: string) => (m.delete(k) ? 1 : 0),
    };
  };

  it('lets an active agent through and caches the answer', async () => {
    const redis = memoryRedis();
    const { svc, execute } = build('active', redis);
    await expect(svc.assertActive(1, 7)).resolves.toBeUndefined();
    await expect(svc.assertActive(1, 7)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(redis.m.get('auth:partner:1:7')).toBe('1');
  });

  it('refuses a suspended agent, an unknown agent, and says nothing about why', async () => {
    await expect(build('suspended', memoryRedis()).svc.assertActive(1, 7)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(build(undefined, memoryRedis()).svc.assertActive(1, 7)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('takes effect at once on the instance that invalidates, and within the cache window elsewhere', async () => {
    const redis = memoryRedis();
    const first = build('active', redis);
    await first.svc.assertActive(1, 7);
    const second = build('suspended', redis);
    // Another instance still sees the cached "active" until the entry expires or is invalidated.
    await expect(second.svc.assertActive(1, 7)).resolves.toBeUndefined();
    await second.svc.invalidate(1, 7);
    await expect(second.svc.assertActive(1, 7)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('uses the database when Redis is down in open mode, and refuses in closed mode', async () => {
    setEnv({ NODE_ENV: 'development', AUTH_REDIS_FAILURE_MODE: undefined });
    const down = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
      del: async () => 0,
    };
    await expect(build('active', down).svc.assertActive(1, 7)).resolves.toBeUndefined();
    await expect(build('suspended', down).svc.assertActive(1, 7)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    setEnv({ NODE_ENV: 'production', AUTH_REDIS_FAILURE_MODE: undefined });
    await expect(build('active', down).svc.assertActive(1, 7)).rejects.toMatchObject({
      code: 'AUTH_SERVICE_DEGRADED',
    });
  });
});
