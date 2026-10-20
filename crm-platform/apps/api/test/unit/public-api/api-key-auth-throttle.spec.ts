import { describe, expect, it } from 'vitest';
import {
  ApiKeyAccessService,
  AUTH_FAILURES_PER_MINUTE,
} from '../../../src/modules/public-api/api-key-access.service';

/** An in-memory stand-in for the three Redis calls the throttle makes. */
function fakeRedis(down = false) {
  const store = new Map<string, number>();
  const expiries = new Map<string, number>();
  const guard = <T>(v: T): Promise<T> =>
    down ? Promise.reject(new Error('redis down')) : Promise.resolve(v);
  return {
    store,
    expiries,
    get: (k: string) => guard(store.has(k) ? String(store.get(k)) : null),
    incr: (k: string) => {
      store.set(k, (store.get(k) ?? 0) + 1);
      return guard(store.get(k)!);
    },
    expire: (k: string, s: number) => {
      expiries.set(k, s);
      return guard(1);
    },
    // INCR + EXPIRE NX in one MULTI (infra/redis/counter.ts): the window starts at the first hit and is not moved by later ones
    multi: () => {
      const ops: Array<['incr' | 'expire', string, number?]> = [];
      const tx = {
        incr: (k: string) => (ops.push(['incr', k]), tx),
        expire: (k: string, s: number) => (ops.push(['expire', k, s]), tx),
        exec: () => {
          const out: Array<[null, number]> = [];
          for (const [op, k, s] of ops) {
            if (op === 'incr') out.push([null, store.set(k, (store.get(k) ?? 0) + 1).get(k)!]);
            else {
              if (!expiries.has(k)) expiries.set(k, s!);
              out.push([null, 1]);
            }
          }
          return guard(out);
        },
      };
      return tx;
    },
  };
}

const build = (redis: ReturnType<typeof fakeRedis>) =>
  new ApiKeyAccessService({} as never, redis as never, {} as never, {} as never, {} as never);

// TI-013 (tenancy audit): the signed public API guard answered "unknown", "revoked" and "invalid" with no failed-auth throttle, so a
// caller could probe key prefixes without limit. The bearer-key guard already had this; the two now share one implementation.
describe('failed API-key authentication throttle', () => {
  it('lets an address fail up to the limit and then refuses it with 429', async () => {
    const access = build(fakeRedis());
    for (let i = 0; i < AUTH_FAILURES_PER_MINUTE; i++) {
      await access.assertNotLockedOut('signed', '203.0.113.7');
      await access.recordAuthFailure('signed', '203.0.113.7');
    }
    await expect(access.assertNotLockedOut('signed', '203.0.113.7')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('counts per address and per guard, so one noisy caller does not lock out another', async () => {
    const access = build(fakeRedis());
    for (let i = 0; i < AUTH_FAILURES_PER_MINUTE; i++)
      await access.recordAuthFailure('signed', '203.0.113.7');
    await expect(access.assertNotLockedOut('signed', '203.0.113.8')).resolves.toBeUndefined();
    await expect(access.assertNotLockedOut('bearer', '203.0.113.7')).resolves.toBeUndefined();
  });

  it('starts the one-minute window at the first failure', async () => {
    const redis = fakeRedis();
    const access = build(redis);
    await access.recordAuthFailure('signed', '198.51.100.1');
    await access.recordAuthFailure('signed', '198.51.100.1');
    expect([...redis.expiries.values()]).toEqual([60]);
  });

  it('never locks anyone out when Redis is down', async () => {
    const access = build(fakeRedis(true));
    await expect(access.recordAuthFailure('signed', '198.51.100.1')).resolves.toBeUndefined();
    await expect(access.assertNotLockedOut('signed', '198.51.100.1')).resolves.toBeUndefined();
  });
});
