import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { cacheSeriesCount, readCacheCounts, setCacheSink } from '@crm/observability/testing';
import { RuntimeMonitor } from '@crm/observability';
import { OrgSuspensionService } from '../../../src/modules/auth/security/org-suspension.service';
import { BookingPageThemesCache } from '../../../src/modules/appointments-booking/booking-page-themes.cache';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import { FakeClock, FakeRedis } from './fake-redis';

/**
 * Hit ratio read back from the exposed counters for workloads whose answer is known independently (Sheet3 #65, item f). Each workload
 * runs on a real cache class; an oracle that does not use the counters (a tiny simulation of the cache) says how many hits, misses
 * and errors there must be; the ratio is computed from the /metrics text. With CACHE_RATIO_OUT set the numbers are written for the report.
 */
const T0 = 1_700_000_000_000;
let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const scrape = (monitor: RuntimeMonitor, cache: string) => {
  const body = monitor.render();
  const read = (metric: string) =>
    Number(
      new RegExp(`^${metric}\\{[^}]*cache="${cache}"[^}]*\\} (\\d+)$`, 'm').exec(body)?.[1] ?? 0,
    );
  return {
    hits: read('crm_cache_hits_total'),
    misses: read('crm_cache_misses_total'),
    errors: read('crm_cache_errors_total'),
  };
};
const results: Record<string, unknown> = {};

beforeEach(() => {
  Logger.overrideLogger(false);
  process.env.AUTH_REDIS_FAILURE_MODE = 'open';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  seed = 12345;
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.AUTH_REDIS_FAILURE_MODE;
});

describe('hit ratio from the counters equals the oracle', () => {
  const monitor = new RuntimeMonitor({ service: 'api' });

  it('steady state: 5,000 requests over 50 workspaces, in-process cache (5 s TTL, no time passes)', async () => {
    const r = new NotificationPrefsResolver({
      txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [{ prefs: { v: 1 } }] }) }),
    } as never);
    const seen = new Set<number>();
    let wantHits = 0;
    let wantMisses = 0;
    const before = scrape(monitor, 'notification_prefs');
    for (let i = 0; i < 5_000; i++) {
      const org = 1 + Math.floor(rnd() * 50);
      if (seen.has(org)) wantHits++;
      else {
        wantMisses++;
        seen.add(org);
      }
      await r.stored(org);
    }
    const after = scrape(monitor, 'notification_prefs');
    const got = {
      hits: after.hits - before.hits,
      misses: after.misses - before.misses,
      errors: after.errors - before.errors,
    };
    expect(got).toEqual({ hits: wantHits, misses: wantMisses, errors: 0 });
    results.steady = {
      cache: 'notification_prefs',
      requests: 5_000,
      workspaces: 50,
      ...got,
      ratio: got.hits / (got.hits + got.misses),
    };
  });

  it('TTL churn: 3,000 requests over 100 workspaces spread across 30 minutes, Redis entry lives 120 s', async () => {
    const redis = new FakeRedis(Object.assign(new FakeClock(), { now: () => Date.now() }));
    const themes = new BookingPageThemesCache(redis as never);
    const expiry = new Map<number, number>();
    let wantHits = 0;
    let wantMisses = 0;
    const before = scrape(monitor, 'booking_page_theme');
    for (let i = 0; i < 3_000; i++) {
      vi.setSystemTime(T0 + Math.floor((i / 3_000) * 30 * 60_000));
      const org = 1 + Math.floor(rnd() * 100);
      const live = (expiry.get(org) ?? 0) > Date.now();
      if (live) wantHits++;
      else wantMisses++;
      const got = await themes.get(org);
      if (!got) {
        await themes.set(org, { o: org });
        expiry.set(org, Date.now() + 120_000);
      }
    }
    const after = scrape(monitor, 'booking_page_theme');
    const got = {
      hits: after.hits - before.hits,
      misses: after.misses - before.misses,
      errors: after.errors - before.errors,
    };
    expect(got).toEqual({ hits: wantHits, misses: wantMisses, errors: 0 });
    results.ttlChurn = {
      cache: 'booking_page_theme',
      requests: 3_000,
      workspaces: 100,
      minutes: 30,
      ttlSeconds: 120,
      ...got,
      ratio: got.hits / (got.hits + got.misses),
    };
  });

  it('Redis outage: 1,000 requests, Redis down for requests 400 to 599 (200 lookups), the answers stay correct', async () => {
    const redis = new FakeRedis(Object.assign(new FakeClock(), { now: () => Date.now() }));
    const orgs = new OrgSuspensionService(
      {
        txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
          fn({ execute: async () => ({ rows: [{ status: 'suspended' }] }) }),
      } as never,
      redis as never,
    );
    const before = scrape(monitor, 'org_suspension');
    let wrong = 0;
    for (let i = 0; i < 1_000; i++) {
      redis.down = i >= 400 && i < 600;
      if ((await orgs.isSuspended(7)) !== true) wrong++;
    }
    const after = scrape(monitor, 'org_suspension');
    const got = {
      hits: after.hits - before.hits,
      misses: after.misses - before.misses,
      errors: after.errors - before.errors,
    };
    // 1 cold miss, 399 hits, then 200 failed reads (each one error and one miss; the key is not rewritten while Redis is down), then 400 hits
    expect(wrong).toBe(0);
    expect(got.errors).toBe(200);
    expect(got.misses).toBe(1 + 200);
    expect(got.hits).toBe(399 + 400);
    results.outage = {
      cache: 'org_suspension',
      requests: 1_000,
      redisDownRequests: 200,
      ...got,
      ratio: got.hits / (got.hits + got.misses),
      errorRatio: got.errors / (got.hits + got.misses),
    };
  });

  it('known 80 hits and 20 misses', async () => {
    const r = new NotificationPrefsResolver({
      txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [{ prefs: { v: 1 } }] }) }),
    } as never);
    const before = scrape(monitor, 'notification_prefs');
    for (let org = 900; org < 920; org++) for (let k = 0; k < 5; k++) await r.stored(org);
    const after = scrape(monitor, 'notification_prefs');
    const got = { hits: after.hits - before.hits, misses: after.misses - before.misses, errors: 0 };
    expect(got).toEqual({ hits: 80, misses: 20, errors: 0 });
    expect(got.hits / (got.hits + got.misses)).toBe(0.8);
    results.known = { cache: 'notification_prefs', requests: 100, ...got, ratio: 0.8 };
    if (process.env.CACHE_RATIO_OUT)
      writeFileSync(process.env.CACHE_RATIO_OUT, JSON.stringify(results, null, 1));
  });
});
