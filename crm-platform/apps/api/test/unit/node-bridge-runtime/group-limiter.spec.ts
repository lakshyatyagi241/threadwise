import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import {
  GroupOpLimiter,
  loadGroupLimits,
  opKindOf,
} from '../../../src/modules/node-bridge-runtime/runtime/group-limiter';

/** The few Redis commands the limiter uses, with TTLs on a controllable clock. */
class FakeRedis {
  now = 1_800_000_000_000;
  private data = new Map<string, { v: string; exp: number | null }>();
  private live(k: string) {
    const e = this.data.get(k);
    if (e && e.exp !== null && e.exp <= this.now) this.data.delete(k);
    return this.data.get(k);
  }
  async get(k: string) {
    return this.live(k)?.v ?? null;
  }
  async set(k: string, v: string, _ex?: string, secs?: number) {
    this.data.set(k, { v, exp: secs ? this.now + secs * 1000 : null });
    return 'OK';
  }
  async ttl(k: string) {
    const e = this.live(k);
    if (!e) return -2;
    return e.exp === null ? -1 : Math.ceil((e.exp - this.now) / 1000);
  }
  async decr(k: string) {
    const e = this.live(k);
    const n = Number(e?.v ?? 0) - 1;
    this.data.set(k, { v: String(n), exp: e?.exp ?? null });
    return n;
  }
  multi() {
    const ops: Array<() => unknown> = [];
    const chain = {
      incr: (k: string) => {
        ops.push(() => {
          const e = this.live(k);
          const n = Number(e?.v ?? 0) + 1;
          this.data.set(k, { v: String(n), exp: e?.exp ?? null });
          return n;
        });
        return chain;
      },
      expire: (k: string, secs: number, _nx?: string) => {
        ops.push(() => {
          const e = this.live(k);
          if (e && e.exp === null) e.exp = this.now + secs * 1000;
          return 1;
        });
        return chain;
      },
      ttl: (k: string) => {
        ops.push(() => {
          const e = this.live(k);
          return !e ? -2 : e.exp === null ? -1 : Math.ceil((e.exp - this.now) / 1000);
        });
        return chain;
      },
      exec: async () => ops.map((o) => [null, o()]),
    };
    return chain;
  }
}

const limits = {
  ...loadGroupLimits({}),
  opsPerMinute: 3,
  opsPerDay: 5,
  createsPerDay: 2,
  joinByLinkPerDay: 1,
};
const make = () => {
  const redis = new FakeRedis();
  const limiter = new GroupOpLimiter(redis as unknown as Redis, limits, () => new Date(redis.now));
  return { redis, limiter };
};

describe('loadGroupLimits', () => {
  it('has the plan defaults and joining by link off', () => {
    expect(loadGroupLimits({})).toEqual({
      opsPerMinute: 20,
      opsPerDay: 200,
      createsPerDay: 5,
      joinByLinkPerDay: 5,
      joinByLinkEnabled: false,
      cooldownSeconds: 600,
      participantsPerCall: 20,
    });
  });
  it('reads the environment, ignores nonsense', () => {
    expect(
      loadGroupLimits({
        WA_GROUPS_OPS_PER_MINUTE: '5',
        WA_GROUPS_OPS_PER_DAY: 'lots',
        WA_GROUPS_CREATES_PER_DAY: '-1',
        WA_GROUPS_JOIN_BY_LINK_ENABLED: 'true',
        WA_GROUPS_COOLDOWN_SECONDS: '60',
        WA_GROUPS_PARTICIPANTS_PER_CALL: '0',
      }),
    ).toMatchObject({
      opsPerMinute: 5,
      opsPerDay: 200,
      createsPerDay: 5,
      joinByLinkEnabled: true,
      cooldownSeconds: 60,
      participantsPerCall: 1,
    });
  });
});

describe('opKindOf', () => {
  it('create and the invite-link actions have their own counters', () => {
    expect(opKindOf({ type: 'create', subject: 'x', participants: [] })).toBe('create');
    expect(opKindOf({ type: 'accept_invite', code: 'c' })).toBe('join_link');
    expect(opKindOf({ type: 'get_invite_info', code: 'c' })).toBe('join_link');
    expect(opKindOf({ type: 'list' })).toBe('op');
    expect(opKindOf({ type: 'leave', groupJid: 'g' })).toBe('op');
  });
});

describe('GroupOpLimiter.acquire', () => {
  it('lets the per-minute budget through and refuses the next with the time left', async () => {
    const { limiter } = make();
    for (let i = 0; i < 3; i++) expect(await limiter.acquire(1, 7, 'op')).toBeNull();
    const refused = await limiter.acquire(1, 7, 'op');
    expect(refused).toMatchObject({ scope: 'ops_minute', limit: 3 });
    expect(refused!.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused!.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('the minute window moves on', async () => {
    const { limiter, redis } = make();
    for (let i = 0; i < 3; i++) await limiter.acquire(1, 7, 'op');
    expect(await limiter.acquire(1, 7, 'op')).not.toBeNull();
    redis.now += 61_000;
    expect(await limiter.acquire(1, 7, 'op')).toBeNull();
  });

  it('a refused call costs nothing: the day counter is not spent by it', async () => {
    const { limiter, redis } = make();
    for (let i = 0; i < 3; i++) await limiter.acquire(1, 7, 'op'); // 3 of 5 today
    for (let i = 0; i < 4; i++) expect(await limiter.acquire(1, 7, 'op')).not.toBeNull();
    redis.now += 61_000;
    expect(await limiter.acquire(1, 7, 'op')).toBeNull(); // 4 of 5
    expect(await limiter.acquire(1, 7, 'op')).toBeNull(); // 5 of 5
    expect(await limiter.acquire(1, 7, 'op')).toMatchObject({ scope: 'ops_day', limit: 5 });
  });

  it('creates and link joins have their own daily caps on top of the op counters', async () => {
    const { limiter, redis } = make();
    expect(await limiter.acquire(1, 7, 'create')).toBeNull();
    expect(await limiter.acquire(1, 7, 'create')).toBeNull();
    expect(await limiter.acquire(1, 7, 'create')).toMatchObject({ scope: 'creates_day', limit: 2 });
    redis.now += 61_000;
    expect(await limiter.acquire(1, 7, 'join_link')).toBeNull();
    expect(await limiter.acquire(1, 7, 'join_link')).toMatchObject({
      scope: 'join_link_day',
      limit: 1,
    });
  });

  it('counts per workspace and device', async () => {
    const { limiter } = make();
    for (let i = 0; i < 3; i++) await limiter.acquire(1, 7, 'op');
    expect(await limiter.acquire(1, 7, 'op')).not.toBeNull();
    expect(await limiter.acquire(1, 8, 'op')).toBeNull();
    expect(await limiter.acquire(2, 7, 'op')).toBeNull();
  });

  it('the day counter resets at midnight UTC and says when', async () => {
    const { limiter, redis } = make();
    redis.now = Date.UTC(2026, 9, 12, 23, 0, 0);
    for (let i = 0; i < 2; i++) await limiter.acquire(1, 7, 'create');
    redis.now += 60_000;
    const refused = await limiter.acquire(1, 7, 'create');
    expect(refused).toMatchObject({ scope: 'creates_day' });
    expect(refused!.retryAfterSeconds).toBe(59 * 60);
    redis.now = Date.UTC(2026, 9, 13, 0, 0, 1);
    expect(await limiter.acquire(1, 7, 'create')).toBeNull();
  });

  it('fails open when Redis throws', async () => {
    const limiter = new GroupOpLimiter(
      {
        ttl: async () => {
          throw new Error('down');
        },
      } as unknown as Redis,
      limits,
    );
    expect(await limiter.acquire(1, 7, 'op')).toBeNull();
  });
});

describe('cooldown', () => {
  it('refuses everything for the cooldown after a ban signal, then lets go', async () => {
    const { limiter, redis } = make();
    await limiter.startCooldown(1, 7);
    expect(await limiter.acquire(1, 7, 'op')).toMatchObject({
      scope: 'cooldown',
      retryAfterSeconds: 600,
    });
    expect(await limiter.acquire(1, 8, 'op')).toBeNull();
    redis.now += 601_000;
    expect(await limiter.acquire(1, 7, 'op')).toBeNull();
  });
  it('a cooldown of 0 seconds is switched off', async () => {
    const redis = new FakeRedis();
    const limiter = new GroupOpLimiter(redis as unknown as Redis, {
      ...limits,
      cooldownSeconds: 0,
    });
    await limiter.startCooldown(1, 7);
    expect(await limiter.acquire(1, 7, 'op')).toBeNull();
  });
});

describe('peek', () => {
  it('shows what is left without counting', async () => {
    const { limiter } = make();
    await limiter.acquire(1, 7, 'create');
    const a = await limiter.peek(1, 7);
    const b = await limiter.peek(1, 7);
    expect(a).toEqual(b);
    expect(a.createsPerDay).toMatchObject({ limit: 2, remaining: 1 });
    expect(a.opsPerMinute).toMatchObject({ limit: 3, remaining: 2 });
    expect(a.joinByLinkPerDay).toEqual({ limit: 1, remaining: 1, resetsAt: null });
    expect(a.cooldownUntil).toBeNull();
    expect(a.participantsPerCall).toBe(20);
    await limiter.startCooldown(1, 7);
    expect((await limiter.peek(1, 7)).cooldownUntil).not.toBeNull();
  });
});
