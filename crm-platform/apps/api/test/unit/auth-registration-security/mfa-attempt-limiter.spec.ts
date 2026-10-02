import { describe, expect, it } from 'vitest';
import type { AppError } from '../../../src/common/errors/app-error';
import { idleTimeoutError } from '../../../src/modules/auth/sessions/session.service';
import { RateLimitService } from '../../../src/modules/auth/security/rate-limit.service';
import { MfaAttemptLimiter } from '../../../src/modules/auth/support/mfa-attempts';

/** A just-enough Redis: counters with a fixed window and a clock the test can move. */
class FakeRedis {
  private data = new Map<string, { n: number; exp: number }>();
  now = 0;

  multi() {
    const ops: Array<() => unknown> = [];
    let key = '';
    let window = 0;
    const chain = {
      incr: (k: string) => {
        key = k;
        ops.push(() => {
          const cur = this.live(k);
          const n = (cur?.n ?? 0) + 1;
          this.data.set(k, { n, exp: cur?.exp ?? 0 });
          return n;
        });
        return chain;
      },
      expire: (_k: string, seconds: number) => {
        window = seconds;
        ops.push(() => {
          const cur = this.data.get(key)!;
          if (!cur.exp) cur.exp = this.now + window * 1000;
          return 1;
        });
        return chain;
      },
      ttl: (k: string) => {
        ops.push(() => {
          const cur = this.live(k);
          return cur ? Math.ceil((cur.exp - this.now) / 1000) : -2;
        });
        return chain;
      },
      exec: async () => ops.map((op) => [null, op()]),
    };
    return chain;
  }

  private live(k: string) {
    const cur = this.data.get(k);
    if (cur && cur.exp && cur.exp <= this.now) {
      this.data.delete(k);
      return undefined;
    }
    return cur;
  }

  async get(k: string) {
    const cur = this.live(k);
    return cur ? String(cur.n) : null;
  }

  async ttl(k: string) {
    const cur = this.live(k);
    return cur ? Math.ceil((cur.exp - this.now) / 1000) : -2;
  }

  async del(k: string) {
    this.data.delete(k);
    return 1;
  }
}

function limiter() {
  const redis = new FakeRedis();
  return { redis, limiter: new MfaAttemptLimiter(new RateLimitService(redis as never)) };
}

/** WD-AUTH-030: five wrong codes in fifteen minutes per person, across every challenge. */
describe('MFA attempt budget', () => {
  it('lets four failures through and stops at the fifth', async () => {
    const { limiter: l } = limiter();
    for (let i = 0; i < 4; i++) {
      await l.assertAvailable('user', 1, 7);
      expect(await l.recordFailure('user', 1, 7)).toBe(false);
    }
    await l.assertAvailable('user', 1, 7);
    expect(await l.recordFailure('user', 1, 7)).toBe(true);
    await expect(l.assertAvailable('user', 1, 7)).rejects.toMatchObject({
      code: 'AUTH_ACCOUNT_LOCKED',
    });
  });

  it('tells the caller how long to wait', async () => {
    const { limiter: l } = limiter();
    for (let i = 0; i < 5; i++) await l.recordFailure('user', 1, 7);
    const err = (await l.assertAvailable('user', 1, 7).catch((e: unknown) => e)) as AppError;
    expect(err.getStatus()).toBe(429);
    expect(Number(err.details?.[0]?.message)).toBeGreaterThan(0);
    expect(Number(err.details?.[0]?.message)).toBeLessThanOrEqual(15 * 60);
  });

  it('is per person and per pool', async () => {
    const { limiter: l } = limiter();
    for (let i = 0; i < 5; i++) await l.recordFailure('user', 1, 7);
    await l.assertAvailable('user', 1, 8);
    await l.assertAvailable('user', 2, 7);
    await l.assertAvailable('operator', 0, 7);
  });

  it('forgets everything after a success and after the window', async () => {
    const { limiter: l, redis } = limiter();
    for (let i = 0; i < 5; i++) await l.recordFailure('user', 1, 7);
    await l.clear('user', 1, 7);
    await l.assertAvailable('user', 1, 7);

    for (let i = 0; i < 5; i++) await l.recordFailure('user', 1, 7);
    redis.now += 15 * 60 * 1000 + 1000;
    await l.assertAvailable('user', 1, 7);
  });
});

describe('idle-timeout error (WD-AUTH-033)', () => {
  it('carries the limit so the sign-in page can say how long', () => {
    const err = idleTimeoutError(45);
    expect(err.getStatus()).toBe(401);
    expect(err.code).toBe('UNAUTHENTICATED');
    expect(err.details).toEqual([
      { path: 'reason', message: 'idle' },
      { path: 'idleMinutes', message: '45' },
    ]);
  });
});
