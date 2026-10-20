import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RbacService } from '../../../src/kernel/rbac/rbac.service';

/**
 * RBAC grant cache against a REAL Redis (the cache is a Lua script, so a fake would test the fake). Uses the shared dev Redis, database
 * 12 only, with random workspace ids; only keys of those workspaces are deleted. Skipped (and said so) when no Redis answers.
 * Override with CACHE_AUDIT_REDIS_URL.
 */
const URL = process.env.CACHE_AUDIT_REDIS_URL ?? 'redis://127.0.0.1:56379/12';
const probe = new Redis(URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
  connectTimeout: 1500,
});
probe.on('error', () => undefined);
let up = false;
const A = 9_000_000 + Math.floor(Math.random() * 900_000);
const B = A + 1;

describe('RBAC grant cache on a real Redis (workspace ids ' + A + ' / ' + B + ')', () => {
  const t = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => {
      if (!up) return ctx.skip();
      await fn();
    });
  const grants: Record<number, Array<Record<string, string>>> = {
    [A]: [{ permission_key: 'contacts.read', effect: 'allow', record_scope: 'all' }],
    [B]: [],
  };
  const versions: Record<number, number> = { [A]: 1, [B]: 1 };
  let loads = 0;
  const db = {
    privileged: async (fn: (tx: unknown) => unknown) =>
      fn({
        execute: async () => ({
          rows: [{ roles_version: ++versions[A]! }],
        }),
      }),
    txAs: async (ctx: { orgId: number }, fn: (tx: unknown) => unknown) => {
      loads++;
      return fn({ execute: async () => ({ rows: grants[ctx.orgId] }) });
    },
  };
  let redis: Redis;
  let svc: RbacService;
  const mine = async () =>
    (await redis.keys('rbac:*')).filter((k) => k.includes(String(A)) || k.includes(String(B)));

  beforeAll(async () => {
    Logger.overrideLogger(false);
    up = await probe.connect().then(
      () => true,
      () => false,
    );
    if (!up) return;
    redis = new Redis(URL);
    svc = new RbacService(db as never, redis as never);
  });
  afterAll(async () => {
    if (redis) {
      const keys = await mine();
      if (keys.length) await redis.del(...keys);
      redis.disconnect();
    }
    probe.disconnect();
  });

  t("workspace A then workspace B, same user id: B never receives A's grants", async () => {
    const a = await svc.grantsForUser(A, 7);
    const b = await svc.grantsForUser(B, 7);
    expect(svc.can(a, 'contacts.read').allowed).toBe(true);
    expect(svc.can(b, 'contacts.read').allowed).toBe(false);
    const again = await svc.grantsForUser(B, 7); // from the cache this time
    expect(svc.can(again, 'contacts.read').allowed).toBe(false);
  });

  t('every key written has a time to live of at most 600 s', async () => {
    const keys = await mine();
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      const ttl = await redis.ttl(k);
      expect(ttl, k).toBeGreaterThan(0);
      expect(ttl, k).toBeLessThanOrEqual(600);
    }
  });

  t(
    'after a role change the next read sees it at once (stale window 0 s) and loads once',
    async () => {
      await svc.grantsForUser(A, 8);
      const before = loads;
      await svc.grantsForUser(A, 8);
      expect(loads).toBe(before); // hit
      grants[A] = [{ permission_key: 'contacts.read', effect: 'deny', record_scope: 'all' }];
      const t0 = Date.now();
      await svc.bumpRolesVersion(A);
      const g = await svc.grantsForUser(A, 8);
      console.log(`STALE rbac healthy ${(Date.now() - t0) / 1000} s`);
      expect(svc.can(g, 'contacts.read').allowed).toBe(false);
      expect(loads).toBe(before + 1);
    },
  );

  t(
    'worst case: the version key cannot be refreshed, so the old grants live until the version key expires (<= 600 s)',
    async () => {
      const vkey = `rbac:version:${A}`;
      const pttl = await redis.pttl(vkey);
      console.log(`STALE rbac worst case ${Math.round(pttl / 1000)} s now, bound 600 s`);
      expect(pttl).toBeGreaterThan(0);
      expect(pttl).toBeLessThanOrEqual(600_000);
    },
  );

  t(
    'Redis answers but is empty (flushed): grants come back from the database and are cached again',
    async () => {
      const keys = await mine();
      await redis.del(...keys);
      const before = loads;
      const g = await svc.grantsForUser(A, 8);
      expect(svc.can(g, 'contacts.read').allowed).toBe(false);
      expect(loads).toBe(before + 1);
    },
  );

  t(
    'stampede: 50 parallel misses for one user load the grants from the database this many times',
    async () => {
      const keys = await mine();
      await redis.del(...keys);
      const before = loads;
      await Promise.all(Array.from({ length: 50 }, () => svc.grantsForUser(A, 11)));
      console.log(`STAMPEDE rbac ${loads - before}/50`);
      expect(loads - before).toBeGreaterThan(1);
    },
  );
});
