import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  API_SRC,
  REPO_ROOT,
  scanCollections,
  scanRedisWrites,
  type CollectionHit,
  type RedisCall,
} from './scan';
import {
  checkCollections,
  checkHttpCache,
  checkRbacWriters,
  checkRedisWrites,
  checkRegisterEntries,
  loadFiles,
  loadRegister,
  type Register,
} from './checks';

/**
 * Cache-audit ratchets (Sheet3 #64). They read the source and docs/performance/cache/register.json and fail when someone adds a cache
 * that is unbounded, forgets the organisation in a key, stores without a time to live, or caches authenticated data publicly.
 * Part 1 runs each rule on the real code. Part 2 runs each rule on deliberately bad input and expects it to fail: a ratchet that has
 * never been seen to fail proves nothing.
 */
const reg = loadRegister();
const none = (v: string[]) => expect(v, v.join('\n')).toEqual([]);

describe('part 1: the real code passes every rule', () => {
  it('every mutable Map/Set is capped, or on the allowlist with a reason', () => {
    none(checkCollections(scanCollections(), reg));
  });

  it('every Redis writer is registered, every cache write has a TTL, every counter is created with its expiry', () => {
    none(checkRedisWrites(scanRedisWrites(), reg));
  });

  it('every register entry is complete; Redis and in-process caches carry the organisation in the key, or say why not', () => {
    none(checkRegisterEntries(reg));
  });

  it('public caching is only on routes that are public by design', () => {
    const files = loadFiles([API_SRC, join(REPO_ROOT, 'apps/web/src')]).filter(
      (f) => !/\.(test|spec)\./.test(f.file),
    );
    none(checkHttpCache(files, reg));
  });

  it('every place that writes role or grant tables is known, with the call that bumps the roles version', () => {
    none(checkRbacWriters(loadFiles([API_SRC]), reg));
  });

  it('totals the report quotes', () => {
    const byLayer: Record<string, number> = {};
    for (const c of reg.caches) byLayer[c.layer] = (byLayer[c.layer] ?? 0) + 1;
    // These numbers appear in the report; if they change the report must be regenerated.
    expect(reg.caches.length).toBe(69);
    expect(reg.caches.filter((c) => c.priority === 'P0').length).toBeGreaterThan(20);
    expect(Object.keys(byLayer).sort()).toEqual([
      'browser',
      'client',
      'database',
      'http',
      'next',
      'process',
      'redis',
      'request',
    ]);
  });
});

describe('part 2: each rule fails on a deliberately bad example', () => {
  const hit = (over: Partial<CollectionHit> = {}): CollectionHit => ({
    file: 'apps/api/src/modules/bad/bad.service.ts',
    name: 'cache',
    where: 'class',
    ctor: 'Map',
    sizeCapped: false,
    evicts: false,
    ...over,
  });
  const call = (over: Partial<RedisCall> = {}): RedisCall => ({
    file: 'apps/api/src/modules/bad/bad.service.ts',
    line: 10,
    method: 'set',
    receiver: 'this.redis',
    args: ['key', 'value'],
    chain: [],
    after: [],
    scope: 'async f() { await this.redis.set(key, value); }',
    ...over,
  });
  const withBad = (extra: Partial<Register>): Register => ({ ...structuredClone(reg), ...extra });

  it('unbounded Map: a new, unregistered Map is reported', () => {
    expect(checkCollections([hit()], reg).join()).toContain('not in register.json');
  });

  it('unbounded Map: a registered one with no cap and no reason is reported', () => {
    const r = withBad({
      inProcessFields: { 'modules/bad/bad.service.ts#cache': { cache: 'M08' } },
    });
    r.caches = r.caches.map((c) => (c.id === 'M08' ? { ...c, bound: { kind: 'none' } } : c));
    expect(checkCollections([hit()], r).join()).toMatch(/unbounded|explain/);
  });

  it('unbounded Map: an allowlist entry with a throw-away reason is reported', () => {
    const r = withBad({ inProcessFields: { 'modules/bad/bad.service.ts#cache': { allow: 'ok' } } });
    expect(checkCollections([hit()], r).join()).toContain('too short');
  });

  it('a register entry for a Map that no longer exists is reported', () => {
    const r = withBad({
      inProcessFields: { 'modules/gone/gone.ts#cache': { allow: 'x'.repeat(40) } },
    });
    expect(checkCollections([], r).join()).toContain('no such mutable collection');
  });

  it('Redis key with no organisation: a tenant-keyed entry whose key anchor lacks the org id is reported', () => {
    const r = withBad({});
    r.caches = [
      {
        ...r.caches.find((c) => c.id === 'R12')!,
        tenant: { mode: 'org', org: true, user: false, anchor: 'camp-summary:${id}' },
      },
    ];
    expect(
      checkRegisterEntries(
        r,
        () => true,
        () => 'camp-summary:${id}',
      ).join(),
    ).toContain('does not contain the organisation id');
  });

  it('Redis key with no organisation: a per-user value whose key has no user id is reported', () => {
    const r = withBad({});
    r.caches = [
      {
        ...r.caches.find((c) => c.id === 'R04')!,
        tenant: { mode: 'org+user', org: true, user: true, anchor: 'auth:gate:${orgId}' },
      },
    ];
    expect(
      checkRegisterEntries(
        r,
        () => true,
        () => 'auth:gate:${orgId}',
      ).join(),
    ).toContain('no user id');
  });

  it('Redis key with no organisation: "global" without a written reason is reported', () => {
    const r = withBad({});
    r.caches = [
      {
        ...r.caches.find((c) => c.id === 'R16')!,
        tenant: { mode: 'global', org: false, user: false, reason: 'shared' },
      },
    ];
    expect(
      checkRegisterEntries(
        r,
        () => true,
        () => '',
      ).join(),
    ).toContain('no written reason');
  });

  it('Redis key with no organisation: an entry that was never filled in is reported', () => {
    const r = withBad({});
    r.caches = [{ id: 'R99', layer: 'redis', priority: 'P0', location: 'apps/api/src/x.ts' }];
    expect(
      checkRegisterEntries(
        r,
        () => true,
        () => '',
      ).join(),
    ).toContain('missing field');
  });

  it('Redis write without TTL: SET with no EX/PX is reported', () => {
    const r = withBad({
      redisWriters: { ...reg.redisWriters, 'modules/bad/bad.service.ts': 'R12' },
    });
    expect(checkRedisWrites([call()], r, () => true, { stale: false }).join()).toContain(
      'without a time to live',
    );
  });

  it('Redis write without TTL: SET with EX passes, SETEX passes', () => {
    const r = withBad({
      redisWriters: { ...reg.redisWriters, 'modules/bad/bad.service.ts': 'R12' },
    });
    expect(
      checkRedisWrites(
        [
          call({ args: ['k', 'v', "'EX'", '60'] }),
          call({ method: 'setex', args: ['k', '60', 'v'] }),
        ],
        r,
        () => true,
        { stale: false },
      ),
    ).toEqual([]);
  });

  it('Redis write without TTL: INCR and EXPIRE as two commands is reported (the D-64-01 pattern)', () => {
    const r = withBad({
      redisWriters: { ...reg.redisWriters, 'modules/bad/bad.service.ts': 'S03' },
    });
    const bad = call({
      method: 'incr',
      args: ['key'],
      scope:
        'async f() { const n = await this.redis.incr(key); if (n === 1) await this.redis.expire(key, 60); }',
    });
    expect(checkRedisWrites([bad], r, () => true, { stale: false }).join()).toContain(
      'INCR and EXPIRE are separate',
    );
  });

  it('Redis write without TTL: INCR in a transaction with EXPIRE passes', () => {
    const r = withBad({
      redisWriters: { ...reg.redisWriters, 'modules/bad/bad.service.ts': 'S03' },
    });
    expect(
      checkRedisWrites(
        [call({ method: 'incr', args: ['key'], chain: ['multi'], after: ['expire', 'exec'] })],
        r,
        () => true,
        { stale: false },
      ),
    ).toEqual([]);
  });

  it('Redis write without TTL: a counter that never expires is reported', () => {
    const r = withBad({
      redisWriters: { ...reg.redisWriters, 'modules/bad/bad.service.ts': 'S03' },
    });
    expect(
      checkRedisWrites(
        [
          call({
            method: 'incr',
            args: ['key'],
            scope: 'async f() { await this.redis.incr(key); }',
          }),
        ],
        r,
        () => true,
        { stale: false },
      ).join(),
    ).toContain('no expiry');
  });

  it('Redis writer outside the register: a new file that writes to Redis is reported', () => {
    expect(
      checkRedisWrites([call({ args: ['k', 'v', "'EX'", '60'] })], reg, () => true, {
        stale: false,
      }).join(),
    ).toContain('not in register.json redisWriters');
  });

  it('public caching: a new route with Cache-Control public is reported', () => {
    const f = {
      file: 'apps/api/src/modules/bad/bad.controller.ts',
      text: "res.setHeader('Cache-Control', 'public, max-age=3600');",
    };
    expect(checkHttpCache([f], reg).join()).toContain('not in register.json httpPublicAllowed');
  });

  it('public caching: a private header is fine, a comment about "public" is fine', () => {
    const f = {
      file: 'apps/api/src/modules/bad/bad.controller.ts',
      text: "// the public page\nres.setHeader('Cache-Control', 'private, max-age=300');",
    };
    expect(
      checkHttpCache([f], reg).filter((m) => m.startsWith('apps/api/src/modules/bad')),
    ).toEqual([]);
  });

  it('role tables: a new place that writes grants without being registered is reported', () => {
    const f = {
      file: 'apps/api/src/modules/bad/bad.repository.ts',
      text: 'await tx.insert(roleGrants).values(rows);',
    };
    expect(checkRbacWriters([f], reg).join()).toContain('not in register.json rbacWriters');
  });
});
