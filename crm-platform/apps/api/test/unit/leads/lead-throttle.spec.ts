import { describe, expect, it } from 'vitest';
import { LeadHookThrottle, LEAD_HOOK_LIMITS } from '../../../src/modules/leads/lead-throttle';

/** A Redis stand-in for the three commands the throttle uses: a fixed window per key. */
function fakeRedis(opts: { failing?: boolean } = {}) {
  const counts = new Map<string, number>();
  return {
    counts,
    multi() {
      let key = '';
      const chain = {
        incr(k: string) {
          key = k;
          return chain;
        },
        expire() {
          return chain;
        },
        ttl() {
          return chain;
        },
        async exec() {
          if (opts.failing) throw new Error('redis down');
          const n = (counts.get(key) ?? 0) + 1;
          counts.set(key, n);
          return [
            [null, n],
            [null, 1],
            [null, 42],
          ];
        },
      };
      return chain;
    },
  };
}

const make = (redis: ReturnType<typeof fakeRedis>) => new LeadHookThrottle(redis as never);

describe('LeadHookThrottle (L-04: per-token and per-IP limits)', () => {
  it('lets an address through up to its budget, then answers 429 with a retry hint', async () => {
    const t = make(fakeRedis());
    for (let i = 0; i < LEAD_HOOK_LIMITS.ip; i++) await t.checkIp('1.2.3.4');
    await expect(t.checkIp('1.2.3.4')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: [{ path: 'retryAfterSeconds', message: '42' }],
    });
    expect(await t.checkIp('5.6.7.8').then(() => 'ok')).toBe('ok');
  });

  it('a token has its own budget, higher than an address, whatever address it comes from', async () => {
    const t = make(fakeRedis());
    expect(LEAD_HOOK_LIMITS.token).toBeGreaterThan(LEAD_HOOK_LIMITS.ip);
    for (let i = 0; i < LEAD_HOOK_LIMITS.token; i++) await t.checkToken('a'.repeat(64));
    await expect(t.checkToken('a'.repeat(64))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(t.checkToken('b'.repeat(64))).resolves.toBeUndefined();
  });

  it('keys the token budget by its hash, never the token', async () => {
    const redis = fakeRedis();
    await make(redis).checkToken('c'.repeat(64));
    const key = [...redis.counts.keys()][0]!;
    expect(key.startsWith('lead:hook:token:')).toBe(true);
    expect(key.length).toBeLessThan('lead:hook:token:'.length + 30);
  });

  it('fails open when Redis is down: a lead is not dropped because a cache is', async () => {
    const t = make(fakeRedis({ failing: true }));
    await expect(t.checkIp('1.2.3.4')).resolves.toBeUndefined();
    await expect(t.checkToken('d'.repeat(64))).resolves.toBeUndefined();
  });
});
