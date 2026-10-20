import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { Redis } from 'ioredis';
import { lastValueFrom, of } from 'rxjs';
import {
  MAX_CACHES,
  RuntimeMonitor,
  cacheMetrics,
  cacheSeriesCount,
  readCacheCounts,
  setCacheSink,
  startMetricsServer,
} from '@crm/observability';
import { RbacService } from '../../../src/kernel/rbac/rbac.service';
import { AccountGateService } from '../../../src/modules/auth/security/account-gate.service';
import { OrgSuspensionService } from '../../../src/modules/auth/security/org-suspension.service';
import { PartnerAgentStatusService } from '../../../src/modules/auth/sessions/partner-agent-status.service';
import { EpochService } from '../../../src/modules/auth/sessions/epoch.service';
import { BookingPageThemesCache } from '../../../src/modules/appointments-booking/booking-page-themes.cache';
import { RedisUploadedMediaCache } from '../../../src/infra/providers/whatsapp/media/upload-cache';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import { IdempotencyInterceptor } from '../../../src/common/interceptors/idempotency.interceptor';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { FakeClock, FakeRedis } from './fake-redis';

/**
 * Cache hit-rate instrumentation (Sheet3 #65), exercised on the real cache classes: exactly one count per lookup, a failing metrics
 * sink never breaks a cache path, the label set stays bounded when 10,000 workspaces use the caches, and the ratio computed from the
 * exposed counters equals the workload that produced it.
 */
// Registered before any test runs, as real caches register at import time: names that arrive after the cap are folded into `other`.
const workload = cacheMetrics('persona_view');

type Counts = { hit: number; miss: number; error: number };
const snap = (n: string): Counts => readCacheCounts(n);
const delta = (n: string, before: Counts): Counts => {
  const now = snap(n);
  return {
    hit: now.hit - before.hit,
    miss: now.miss - before.miss,
    error: now.error - before.error,
  };
};

const redisAtNow = () => new FakeRedis(Object.assign(new FakeClock(), { now: () => Date.now() }));
const orgDb = (byOrg: Record<number, unknown>) => ({
  txAs: async (ctx: { orgId: number }, fn: (tx: unknown) => unknown) =>
    fn({ execute: async () => ({ rows: [byOrg[ctx.orgId]] }) }),
});

beforeEach(() => {
  Logger.overrideLogger(false);
  process.env.AUTH_REDIS_FAILURE_MODE = 'open';
});
afterEach(() => {
  setCacheSink(undefined);
  delete process.env.AUTH_REDIS_FAILURE_MODE;
});

describe('counters move exactly once per hit, miss and error on the real classes (fake Redis)', () => {
  it('booking page theme: miss, then hit; Redis down is one error and one miss, and the page still renders', async () => {
    const redis = redisAtNow();
    const themes = new BookingPageThemesCache(redis as never);
    let b = snap('booking_page_theme');
    expect(await themes.get(1)).toBeNull();
    expect(delta('booking_page_theme', b)).toEqual({ hit: 0, miss: 1, error: 0 });
    await themes.set(1, { look: 'A' });
    b = snap('booking_page_theme');
    expect(await themes.get(1)).toEqual({ look: 'A' });
    expect(delta('booking_page_theme', b)).toEqual({ hit: 1, miss: 0, error: 0 });
    redis.down = true;
    b = snap('booking_page_theme');
    expect(await themes.get(1)).toBeNull();
    expect(delta('booking_page_theme', b)).toEqual({ hit: 0, miss: 1, error: 1 });
  });

  it('a corrupt cached value is one error and one miss, never also a hit', async () => {
    const redis = redisAtNow();
    await redis.set('appt:page-theme:v1:5', '{not json', 'EX', 60);
    const themes = new BookingPageThemesCache(redis as never);
    const b = snap('booking_page_theme');
    expect(await themes.get(5)).toBeNull();
    expect(delta('booking_page_theme', b)).toEqual({ hit: 0, miss: 1, error: 1 });
  });

  it('uploaded media id (Redis class): miss, hit, error', async () => {
    const redis = redisAtNow();
    const media = new RedisUploadedMediaCache(redis as never);
    let b = snap('whatsapp_uploaded_media');
    expect(await media.get('k')).toBeNull();
    await media.set('k', 'MEDIA', 60);
    expect(await media.get('k')).toBe('MEDIA');
    expect(delta('whatsapp_uploaded_media', b)).toEqual({ hit: 1, miss: 1, error: 0 });
    redis.down = true;
    b = snap('whatsapp_uploaded_media');
    expect(await media.get('k')).toBeNull();
    expect(delta('whatsapp_uploaded_media', b)).toEqual({ hit: 0, miss: 1, error: 1 });
  });

  it('workspace suspension: cold read misses and asks Postgres, second read hits, Redis down is an error and still answers', async () => {
    const redis = redisAtNow();
    const orgs = new OrgSuspensionService(
      orgDb({ 1: { status: 'suspended' } }) as never,
      redis as never,
    );
    let b = snap('org_suspension');
    expect(await orgs.isSuspended(1)).toBe(true);
    expect(delta('org_suspension', b)).toEqual({ hit: 0, miss: 1, error: 0 });
    b = snap('org_suspension');
    expect(await orgs.isSuspended(1)).toBe(true);
    expect(delta('org_suspension', b)).toEqual({ hit: 1, miss: 0, error: 0 });
    redis.down = true;
    b = snap('org_suspension');
    expect(await orgs.isSuspended(1)).toBe(true);
    expect(delta('org_suspension', b)).toEqual({ hit: 0, miss: 1, error: 1 });
  });

  it('partner agent status and account gate count the same way', async () => {
    const redis = redisAtNow();
    const p = new PartnerAgentStatusService(
      orgDb({ 1: { status: 'active' } }) as never,
      redis as never,
    );
    let b = snap('partner_agent_status');
    await p.isActive(1, 9);
    await p.isActive(1, 9);
    expect(delta('partner_agent_status', b)).toEqual({ hit: 1, miss: 1, error: 0 });

    const gate = new AccountGateService({} as never, {} as never, redis as never, {} as never);
    (gate as unknown as { compute: unknown }).compute = vi.fn(async () => ({ suspended: false }));
    b = snap('account_gate');
    await gate.stateFor(1, 7, { includeOrgSuspension: false });
    await gate.stateFor(1, 7, { includeOrgSuspension: false });
    await gate.stateFor(1, 7, { includeOrgSuspension: false });
    expect(delta('account_gate', b)).toEqual({ hit: 2, miss: 1, error: 0 });
    redis.down = true;
    b = snap('account_gate');
    await gate.stateFor(2, 7, { includeOrgSuspension: false });
    expect(delta('account_gate', b)).toEqual({ hit: 0, miss: 1, error: 1 });
  });

  it('token epoch: the in-process layer and the Redis layer are counted separately', async () => {
    const redis = redisAtNow();
    const epoch = new EpochService(
      redis as never,
      { get: vi.fn(async () => 1), set: vi.fn() } as never,
    );
    await redis.set('auth:epoch', '1');
    const l = snap('epoch_local');
    const r = snap('epoch_redis');
    await epoch.current(); // local miss, redis hit
    await epoch.current(); // local hit
    expect(delta('epoch_local', l)).toEqual({ hit: 1, miss: 1, error: 0 });
    expect(delta('epoch_redis', r)).toEqual({ hit: 1, miss: 0, error: 0 });
  });

  it('in-process notification preferences: miss then hit', async () => {
    const db = {
      txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [{ prefs: { v: 1 } }] }) }),
    };
    const r = new NotificationPrefsResolver(db as never);
    const b = snap('notification_prefs');
    await r.stored(1);
    await r.stored(1);
    await r.stored(1);
    expect(delta('notification_prefs', b)).toEqual({ hit: 2, miss: 1, error: 0 });
  });

  it('idempotency interceptor: first call is a miss, the replay is a hit, a Redis error is an error', async () => {
    const store = new Map<string, string>();
    let down = false;
    const redis = {
      set: async (k: string, v: string, _e: string, _s: number, nx?: string) => {
        if (down) throw new Error('down');
        if (nx === 'NX' && store.has(k)) return null;
        store.set(k, v);
        return 'OK';
      },
      get: async (k: string) => store.get(k) ?? null,
      del: async (k: string) => store.delete(k),
    };
    const ic = new IdempotencyInterceptor(
      { getAllAndOverride: () => true } as unknown as Reflector,
      redis as never,
    );
    const ctx = {
      getType: () => 'http',
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', path: '/x', body: { a: 1 }, header: () => 'key-1' }),
      }),
    } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of({ ok: true }) };
    const call = () =>
      RequestContextStore.run(
        { requestId: 'r', orgId: 7, actorType: 'user', actorId: 1, userId: 1 },
        () => lastValueFrom(ic.intercept(ctx, handler)),
      );
    const b = snap('idempotency');
    await call();
    await new Promise((r) => setTimeout(r, 5)); // the done marker is written after the handler returns
    await call();
    expect(delta('idempotency', b)).toEqual({ hit: 1, miss: 1, error: 0 });
    down = true;
    await expect(call()).rejects.toThrow('down');
    expect(delta('idempotency', b).error).toBe(1);
  });
});

describe('RBAC grants on a private real Redis', () => {
  const URL = process.env.CACHE_AUDIT_REDIS_URL ?? 'redis://127.0.0.1:56379/13'; // db 13 of the shared dev Redis, random workspace ids; only its own keys are deleted
  const A = 9_100_000 + Math.floor(Math.random() * 800_000);
  let redis: Redis;
  let up = false;
  const t = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => (up ? fn() : ctx.skip()));
  beforeAll(async () => {
    if (!URL) return;
    redis = new Redis(URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    up = await redis.connect().then(
      () => true,
      () => false,
    );
  });
  afterAll(async () => {
    if (!up) return;
    const keys = await redis.keys(`rbac:*${A}*`);
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
  });

  t(
    'cold read: version miss, grants miss; warm read: version hit, grants hit; Redis killed mid-test: errors',
    async () => {
      const db = {
        privileged: async (fn: (tx: unknown) => unknown) =>
          fn({ execute: async () => ({ rows: [{ roles_version: 1 }] }) }),
        txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
          fn({
            execute: async () => ({
              rows: [{ permission_key: 'contacts.read', effect: 'allow', record_scope: 'all' }],
            }),
          }),
      };
      const svc = new RbacService(db as never, redis as never);
      const g0 = snap('rbac_grants');
      const v0 = snap('rbac_version');
      await svc.grantsForUser(A, 7);
      expect(delta('rbac_grants', g0)).toEqual({ hit: 0, miss: 1, error: 0 });
      expect(delta('rbac_version', v0)).toEqual({ hit: 0, miss: 2, error: 0 }); // the Lua fast read, then the separate version read
      const g1 = snap('rbac_grants');
      const v1 = snap('rbac_version');
      await svc.grantsForUser(A, 7);
      expect(delta('rbac_grants', g1)).toEqual({ hit: 1, miss: 0, error: 0 });
      expect(delta('rbac_version', v1)).toEqual({ hit: 1, miss: 0, error: 0 });
      // a client pointed at a dead port: every Redis call fails, the answer still comes from the database
      const dead = new Redis('redis://127.0.0.1:1', {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        enableOfflineQueue: false,
      });
      dead.on('error', () => undefined);
      const svcDead = new RbacService(db as never, dead as never);
      const g2 = snap('rbac_grants');
      const v2 = snap('rbac_version');
      const grants = await svcDead.grantsForUser(A + 1, 7);
      expect(grants.get('contacts.read')?.effect).toBe('allow');
      expect(delta('rbac_grants', g2).miss).toBe(1);
      expect(delta('rbac_version', v2).error).toBeGreaterThanOrEqual(1);
      dead.disconnect();
    },
  );
});

describe('a failing metrics sink never breaks a cache path', () => {
  it('every cache class above still returns the right answer with a sink that throws on every call', async () => {
    setCacheSink({
      bump: () => {
        throw new Error('metrics registry exploded');
      },
    });
    const redis = redisAtNow();
    const themes = new BookingPageThemesCache(redis as never);
    await themes.set(1, { look: 'A' });
    expect(await themes.get(1)).toEqual({ look: 'A' }); // hit path
    expect(await themes.get(2)).toBeNull(); // miss path
    redis.down = true;
    expect(await themes.get(1)).toBeNull(); // error path
    redis.down = false;

    const orgs = new OrgSuspensionService(
      orgDb({ 1: { status: 'suspended' } }) as never,
      redisAtNow() as never,
    );
    expect(await orgs.isSuspended(1)).toBe(true);
    expect(await orgs.isSuspended(1)).toBe(true);

    const gate = new AccountGateService(
      {} as never,
      {} as never,
      redisAtNow() as never,
      {} as never,
    );
    (gate as unknown as { compute: unknown }).compute = async () => ({ suspended: true });
    expect((await gate.stateFor(1, 7, { includeOrgSuspension: false })).suspended).toBe(true);

    const prefs = new NotificationPrefsResolver({
      txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [{ prefs: { v: 1 } }] }) }),
    } as never);
    expect(await prefs.stored(1)).toEqual({ v: 1 });
    expect(await prefs.stored(1)).toEqual({ v: 1 });
  });

  it('a size reader that throws drops its own line, not the scrape', async () => {
    const { cacheSize } = await import('@crm/observability');
    cacheSize('exploding_size', () => {
      throw new Error('boom');
    });
    const text = new RuntimeMonitor({ service: 'api' }).render();
    expect(text).toContain('crm_cache_hits_total');
    expect(text).not.toContain('exploding_size');
  });
});

describe('bounded: the series count does not grow with workspaces', () => {
  it('10,000 distinct workspaces through real caches add no series', async () => {
    const redis = redisAtNow();
    const themes = new BookingPageThemesCache(redis as never);
    const orgs = new OrgSuspensionService(
      {
        txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
          fn({ execute: async () => ({ rows: [{ status: 'active' }] }) }),
      } as never,
      redis as never,
    );
    const monitor = new RuntimeMonitor({ service: 'api' });
    const lines = (t: string) => t.split('\n').filter((l) => l.startsWith('crm_cache_')).length;
    await themes.get(0);
    await orgs.isSuspended(1);
    const seriesBefore = cacheSeriesCount();
    const linesBefore = lines(monitor.render());
    for (let org = 1; org <= 10_000; org++) {
      await themes.get(org); // miss
      await themes.set(org, { o: org });
      await themes.get(org); // hit
      await orgs.isSuspended(org);
    }
    expect(cacheSeriesCount()).toBe(seriesBefore);
    expect(lines(monitor.render())).toBe(linesBefore);
    const text = monitor.render();
    expect(text).not.toMatch(/cache="[^"]*\d{4,}/); // no id in any label value
    expect(text).not.toMatch(/crm_cache_[a-z_]+\{[^}]*(org|user|workspace)[a-z_]*=/);
  });

  it('even a bug that builds the cache name from a workspace id cannot grow the series past the cap', () => {
    const before = cacheSeriesCount();
    for (let org = 1; org <= 10_000; org++) cacheMetrics(`ws_${org}`).hit();
    const grown = cacheSeriesCount() - before;
    expect(grown).toBeLessThanOrEqual(MAX_CACHES * 3);
    expect(snap('other').hit).toBeGreaterThan(9_000);
    // names that are not lowercase snake_case never become labels at all
    cacheMetrics('Workspace-42/User 7').miss();
    expect(snap('other').miss).toBeGreaterThanOrEqual(1);
  });
});

describe('the exposed counters give the hit ratio of a known workload', () => {
  it('80 hits and 20 misses on a real class, scraped from /metrics before and after, give 0.8', async () => {
    const monitor = new RuntimeMonitor({ service: 'api' });
    const server = startMetricsServer({
      port: 0,
      host: '127.0.0.1',
      render: () => monitor.render(),
    });
    await new Promise((res) => server.once('listening', res));
    const port = (server.address() as { port: number }).port;
    const scrape = async () => {
      const body = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
      const read = (metric: string): number =>
        Number(
          new RegExp(`^${metric}\\{[^}]*cache="notification_prefs"[^}]*\\} (\\d+)$`, 'm').exec(
            body,
          )?.[1] ?? 0,
        );
      return {
        body,
        hits: read('crm_cache_hits_total'),
        misses: read('crm_cache_misses_total'),
        errors: read('crm_cache_errors_total'),
      };
    };
    const r = new NotificationPrefsResolver({
      txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [{ prefs: { v: 1 } }] }) }),
    } as never);
    const before = await scrape();
    // 20 workspaces, each looked up 5 times: 20 first-time misses and 80 repeat hits
    for (let org = 500; org < 520; org++) for (let i = 0; i < 5; i++) await r.stored(org);
    const after = await scrape();
    server.close();
    const hits = after.hits - before.hits;
    const misses = after.misses - before.misses;
    expect({ hits, misses, errors: after.errors - before.errors }).toEqual({
      hits: 80,
      misses: 20,
      errors: 0,
    });
    expect(hits / (hits + misses)).toBe(0.8);
    expect(after.body).toContain('# TYPE crm_cache_hits_total counter');
    expect(after.body).toContain('# TYPE crm_cache_errors_total counter');
  });

  it('a clean workload: exactly 80 hits and 20 misses give 0.8', async () => {
    const before = snap('persona_view');
    const m = workload;
    for (let i = 0; i < 100; i++) {
      if (i % 5 === 0) m.miss();
      else m.hit();
    }
    const d = delta('persona_view', before);
    expect(d).toEqual({ hit: 80, miss: 20, error: 0 });
    expect(d.hit / (d.hit + d.miss)).toBe(0.8);
  });
});
