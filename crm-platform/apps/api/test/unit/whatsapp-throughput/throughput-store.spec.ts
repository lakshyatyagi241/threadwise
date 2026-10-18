import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WABA_THROUGHPUT_SETTINGS_DEFAULTS, type WabaThroughputSettings } from '@crm/contracts';
import {
  ThroughputStore,
  type PublishedNumber,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/throughput/throughput-store';

/**
 * The pacing script and the counters, against a real Redis (the Lua is the part a mock would not prove). Starts its own throwaway
 * `redis-server` on a free port; the suite is skipped where the binary is not installed.
 */
const haveRedis = spawnSync('redis-server', ['--version']).status === 0;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

const settings = (over: Partial<WabaThroughputSettings> = {}): WabaThroughputSettings => ({
  ...WABA_THROUGHPUT_SETTINGS_DEFAULTS,
  ...over,
});
const number = (over: Partial<PublishedNumber> = {}): PublishedNumber => ({
  mps: 20,
  capMps: 20,
  source: 'meta',
  paused: false,
  pauseReason: null,
  tierName: 'TIER_1K',
  tierCap: 1000,
  tierUnlimited: false,
  ...over,
});

describe.skipIf(!haveRedis)('ThroughputStore on Redis', () => {
  let proc: ChildProcess;
  let redis: Redis;
  let store: ThroughputStore;
  let n = 0;
  const pn = () => `1000000${(n++).toString().padStart(4, '0')}`;

  beforeAll(async () => {
    const port = await freePort();
    proc = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], {
      stdio: 'ignore',
    });
    redis = new Redis({
      port,
      host: '127.0.0.1',
      maxRetriesPerRequest: 20,
      retryStrategy: () => 50,
    });
    redis.on('error', () => undefined); // the server takes a moment to listen; ioredis retries
    await redis.ping();
    store = new ThroughputStore(redis);
  });

  afterAll(async () => {
    redis?.disconnect();
    proc?.kill();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  it('lets a burst through, then spaces sends at the number’s rate', async () => {
    const id = pn();
    await store.publishNumber(id, number({ mps: 20 })); // 50 ms apart, 250 ms burst
    const g = settings({ maxLocalWaitMs: 60_000 });
    const waits: number[] = [];
    for (let i = 0; i < 40; i++) waits.push((await store.reserve(id, g)).waitMs);
    expect(waits.slice(0, 5).every((w) => w === 0)).toBe(true);
    // The 40th send is 39 intervals (1950 ms) behind the first, less the 250 ms burst.
    expect(waits[39]).toBeGreaterThan(1_600);
    expect(waits[39]).toBeLessThan(1_800);
    expect([...waits].sort((a, b) => a - b)).toEqual(waits);
  });

  it('gives concurrent workers distinct turns that add up to the rate', async () => {
    const id = pn();
    await store.publishNumber(id, number({ mps: 100 })); // 10 ms apart
    const g = settings({ maxLocalWaitMs: 60_000 });
    const rs = await Promise.all(Array.from({ length: 200 }, () => store.reserve(id, g)));
    const waits = rs.map((r) => r.waitMs).sort((a, b) => a - b);
    // 200 sends at 100 per second span 2 s: the last waits about 2 s minus the burst.
    expect(waits[199]).toBeGreaterThan(1_650);
    expect(waits[199]).toBeLessThan(1_800);
    // No two sends share a slot closer than the interval (allowing the integer rounding of the wait).
    const late = waits.filter((w) => w > 0);
    for (let i = 1; i < late.length; i++) expect(late[i]! - late[i - 1]!).toBeGreaterThanOrEqual(9);
  });

  it('hands a send back, without reserving, when its turn is beyond the local wait', async () => {
    const id = pn();
    await store.publishNumber(id, number({ mps: 10 }));
    const g = settings({ maxLocalWaitMs: 300 });
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await store.reserve(id, g));
    const deferred = results.filter((r) => r.status === 'deferred');
    expect(deferred.length).toBeGreaterThan(0);
    expect(deferred[0]!.waitMs).toBeGreaterThan(300);
    // A deferral moved nothing: the next deferred answer is the same wait, not further out.
    const again = await store.reserve(id, g);
    expect(again.status).toBe('deferred');
    expect(Math.abs(again.waitMs - deferred.at(-1)!.waitMs)).toBeLessThan(60);
  });

  it('refuses while a number is paused', async () => {
    const id = pn();
    await store.publishNumber(id, number({ paused: true, pauseReason: 'quality review' }));
    expect((await store.reserve(id, settings())).status).toBe('paused');
    await store.publishNumber(id, number({ paused: false }));
    expect((await store.reserve(id, settings())).status).toBe('ok');
  });

  it('paces an unpublished number at the platform default', async () => {
    const r = await store.reserve(pn(), settings({ defaultMps: 40 }));
    expect(r.status).toBe('ok');
    expect(r.mps).toBe(40);
  });

  it('halves the speed after a Meta throttle and wins it back', async () => {
    const id = pn();
    await store.publishNumber(id, number({ mps: 80, capMps: 80 }));
    await store.recordMetaThrottle(id, 'throughput', true);
    const slowed = await store.reserve(id, settings());
    expect(slowed.mps).toBe(40);
    expect(slowed.speedPct).toBeLessThanOrEqual(50);
    // Without adaptive back-off the throttle is only counted.
    const other = pn();
    await store.publishNumber(other, number({ mps: 80, capMps: 80 }));
    await store.recordMetaThrottle(other, 'throughput', false);
    expect((await store.reserve(other, settings({ adaptiveBackoff: false }))).mps).toBe(80);
  });

  it('holds sends back for the minute a throughput upgrade takes', async () => {
    const id = pn();
    await store.publishNumber(id, number({ mps: 80 }));
    await store.recordMetaThrottle(id, 'upgrade', true);
    const r = await store.reserve(id, settings({ maxLocalWaitMs: 5_000 }));
    expect(r.status).toBe('deferred');
    expect(r.waitMs).toBeGreaterThan(55_000);
  });

  it('counts sends per second and per minute for the console', async () => {
    const id = pn();
    for (let i = 0; i < 7; i++) await store.recordSent(id, `9199000000${i}`, false);
    await store.recordWait(id, 120);
    await store.recordDeferred(id);
    await store.recordMetaThrottle(id, 'throughput', true);
    const live = (await store.live([id])).get(id)!;
    expect(live.sent5m).toBe(7);
    expect(live.peak1m).toBeGreaterThanOrEqual(1);
    expect(live.mpsNow).toBeGreaterThan(0);
    expect(live.waited5m).toBe(1);
    expect(live.waitMs5m).toBe(120);
    expect(live.deferred5m).toBe(1);
    expect(live.metaThrottled5m).toBe(1);
    expect(live.speedFactor).toBeLessThan(1);
    const { perSecond, perMinute } = await store.series(id);
    expect(perSecond).toHaveLength(60);
    expect(perMinute).toHaveLength(60);
    expect(perMinute.at(-1)!.sent).toBe(7);
  });

  it('counts each template recipient once in the 24 hour tier estimate', async () => {
    const id = pn();
    for (let i = 0; i < 50; i++) await store.recordSent(id, `91990000${i}`, true);
    for (let i = 0; i < 50; i++) await store.recordSent(id, `91990000${i}`, true); // the same people again
    await store.recordSent(id, '918888888888', false); // a service reply is not business-initiated
    // A HyperLogLog: constant memory, about 1% error.
    const used = await store.tierUsed(id);
    expect(used).toBeGreaterThanOrEqual(48);
    expect(used).toBeLessThanOrEqual(52);
    expect((await store.tierUsedMany([id])).get(id)).toBe(used);
  });

  it('keeps a capped event log and gates repeating events', async () => {
    const id = pn();
    await store.pushEvent(id, 'deferred', 'a', 60_000);
    await store.pushEvent(id, 'deferred', 'b', 60_000); // gated
    await store.pushEvent(id, 'paused', 'c');
    const events = await store.events(id);
    expect(events.map((e) => e.kind)).toEqual(['paused', 'deferred']);
    for (let i = 0; i < 120; i++) await store.pushEvent(id, 'synced', String(i));
    expect(await store.events(id, 500)).toHaveLength(100);
  });

  it('publishes and reads the platform settings', async () => {
    await store.publishGlobal(settings({ enabled: false, defaultMps: 33, enforceTierCap: true }));
    const g = await store.global();
    expect(g.enabled).toBe(false);
    expect(g.defaultMps).toBe(33);
    expect(g.enforceTierCap).toBe(true);
  });

  it('allows only one sync tick at a time', async () => {
    expect(await store.tryLock(5_000)).toBe(true);
    expect(await store.tryLock(5_000)).toBe(false);
  });
});
