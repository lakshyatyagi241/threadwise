import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { AccountGateService } from '../../../src/modules/auth/security/account-gate.service';
import { OrgSuspensionService } from '../../../src/modules/auth/security/org-suspension.service';
import { EpochService } from '../../../src/modules/auth/sessions/epoch.service';
import { BookingPageThemesCache } from '../../../src/modules/appointments-booking/booking-page-themes.cache';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import { FakeClock, FakeRedis } from './fake-redis';

/**
 * Cost of the hit/miss counters per cache call (Sheet3 #65). This file imports only the cache classes, never the metrics package, so the
 * SAME file runs unchanged on a checkout without the counters (the baseline) and on this branch; the report compares the two medians.
 * It prints one JSON line, and writes it to $CACHE_BENCH_OUT when set. The assertions only guard against a broken measurement; the
 * numbers are in the report.
 */
const N = Number(process.env.CACHE_BENCH_N ?? 20_000);
const REPEATS = Number(process.env.CACHE_BENCH_REPEATS ?? 5);

async function nsPerOp(label: string, op: () => Promise<unknown>): Promise<[string, number]> {
  for (let i = 0; i < 5_000; i++) await op(); // warm up the JIT
  const runs: number[] = [];
  for (let r = 0; r < REPEATS; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) await op();
    runs.push(Number(process.hrtime.bigint() - t0) / N);
  }
  runs.sort((a, b) => a - b);
  return [label, Math.round(runs[Math.floor(runs.length / 2)]!)];
}

describe('cost per cache call', () => {
  it('measures hit paths of five real cache classes', async () => {
    Logger.overrideLogger(false);
    process.env.AUTH_REDIS_FAILURE_MODE = 'open';
    const redis = new FakeRedis(Object.assign(new FakeClock(), { now: () => Date.now() }));
    // keep the fake from growing a call log for 100k * 9 calls
    Object.defineProperty(redis, 'calls', { value: { push: () => 0 } });

    const prefs = new NotificationPrefsResolver({
      txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [{ prefs: { v: 1 } }] }) }),
    } as never);
    await prefs.stored(1);

    const epoch = new EpochService(
      redis as never,
      { get: vi.fn(async () => 1), set: vi.fn() } as never,
    );
    await redis.set('auth:epoch', '1');
    await epoch.current();

    const themes = new BookingPageThemesCache(redis as never);
    await themes.set(1, { look: 'A' });

    const orgs = new OrgSuspensionService(
      {
        txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
          fn({ execute: async () => ({ rows: [{ status: 'active' }] }) }),
      } as never,
      redis as never,
    );
    await orgs.isSuspended(1);

    const gate = new AccountGateService({} as never, {} as never, redis as never, {} as never);
    (gate as unknown as { compute: unknown }).compute = async () => ({ suspended: false });
    await gate.stateFor(1, 7, { includeOrgSuspension: false });

    const rows = [
      await nsPerOp('in-process: notification prefs hit', () => prefs.stored(1)),
      await nsPerOp('in-process: token epoch hit', () => epoch.current()),
      await nsPerOp('redis class: booking theme hit (fake redis)', () => themes.get(1)),
      await nsPerOp('redis class: workspace suspension hit (fake redis)', () =>
        orgs.isSuspended(1),
      ),
      await nsPerOp('redis class: account gate hit (fake redis)', () =>
        gate.stateFor(1, 7, { includeOrgSuspension: false }),
      ),
    ];
    const out = {
      n: N,
      repeats: REPEATS,
      node: process.version,
      nsPerOp: Object.fromEntries(rows),
    };
    console.log(`BENCH ${JSON.stringify(out)}`);
    if (process.env.CACHE_BENCH_OUT)
      writeFileSync(process.env.CACHE_BENCH_OUT, JSON.stringify(out));
    for (const [, v] of rows) expect(v).toBeGreaterThan(0);
  }, 300_000);
});
