import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RateLimitService } from '../../../src/modules/auth/security/rate-limit.service';
import { WidgetThrottleService } from '../../../src/modules/chatbot-widget/widget-throttle.service';
import { PublicLinkThrottle } from '../../../src/modules/crm/sales-docs/public-link-throttle';
import { SegmentThrottle } from '../../../src/modules/crm/segments/segment-throttle';
import { WaLinkRedirectThrottle } from '../../../src/modules/forms-links-groups/wa-link-redirect-throttle';
import { FormThrottle } from '../../../src/modules/forms-builder/form-throttle';
import { LeadHookThrottle } from '../../../src/modules/leads/lead-throttle';
import { HookThrottle } from '../../../src/modules/marketplace/hook-throttle';
import { RateLimiter } from '../../../src/modules/platform-infrastructure';
import { RedisLockService } from '../../../src/modules/platform-infrastructure/coordination/redis-lock.service';
import { PublicRateLimiter } from '../../../src/modules/storefront-builder/public/public-rate-limiter';
import { RedisUploadedMediaCache } from '../../../src/infra/providers/whatsapp/media/upload-cache';
import { info, record, sleep, startOwnRedis, usedMemory, type OwnRedis } from './own-redis';

/**
 * What the Redis-only services do to the server when MANY DISTINCT callers hit them (a scan rotating through addresses, a flood of
 * tenants), measured on a private Redis with `INFO memory`:
 *   1. no key is left without a lifetime;
 *   2. no lifetime is longer than the family's declared window;
 *   3. how many bytes one caller costs, so "N callers" can be turned into megabytes;
 *   4. the memory comes back when the keys expire (the expiry is brought forward by the test: we do not wait an hour).
 * The services are the real classes, constructed with a real client; only their callers are synthetic.
 */
let own: OwnRedis;
let redis: Redis;
const N = 2_000;
const RUN = randomUUID().slice(0, 6);
const ip = (i: number) => `10.${RUN.charCodeAt(0) % 200}.${Math.floor(i / 250)}.${i % 250}`;

beforeAll(async () => {
  own = await startOwnRedis(['--maxmemory', '128mb', '--maxmemory-policy', 'noeviction']);
  redis = own.client();
}, 120_000);
afterAll(async () => {
  await own.stop();
});

async function inBatches(n: number, fn: (i: number) => Promise<unknown>, width = 100) {
  for (let i = 0; i < n; i += width)
    await Promise.all(Array.from({ length: Math.min(width, n - i) }, (_, k) => fn(i + k)));
}
const ok = <T>(p: Promise<T>) => p.catch(() => undefined); // a throttle that refuses is fine here; we measure keys

/** The largest lifetime (seconds) each family may have, from the code's own windows. */
const MAX_TTL_S: Record<string, number> = {
  'form:pub:ip:': 60,
  'lead:hook:ip:': 60,
  'store_rl:': 120,
  'wgt:hits:': 120,
  'wfl:link:redirect:': 120,
  'mkt:hook:ip:': 60,
  'salesdoc:pub:': 60,
  'segments:rl:': 60,
  'test:rl:': 120,
  'lock:': 60,
  'wa:media-id:': 3_600,
  'rl67:': 120,
};
const familyOf = (key: string) =>
  Object.keys(MAX_TTL_S).find((p) => key.startsWith(p)) ?? 'UNKNOWN';

describe('key hygiene under many distinct callers', () => {
  it('leaves no key without a lifetime, none past its window, and gives bytes per caller', async () => {
    const baseline = await usedMemory(redis);
    const form = new FormThrottle(redis);
    const lead = new LeadHookThrottle(redis);
    const store = new PublicRateLimiter(redis);
    const widget = new WidgetThrottleService(redis);
    const waLink = new WaLinkRedirectThrottle(redis);
    const hook = new HookThrottle(redis);
    const salesdoc = new PublicLinkThrottle(redis);
    const segments = new SegmentThrottle(redis);
    const authRl = new RateLimitService(redis);
    const sliding = new RateLimiter(redis);
    const locks = new RedisLockService(redis);
    const media = new RedisUploadedMediaCache(redis);

    const drivers: Array<[string, (i: number) => Promise<unknown>]> = [
      ['form:pub:ip:', (i) => ok(form.checkIp(ip(i)))],
      ['lead:hook:ip:', (i) => ok(lead.checkIp(ip(i)))],
      ['store_rl:', (i) => ok(store.hit('checkout', ip(i)))],
      ['wgt:hits:', (i) => ok(widget.allow('message', ip(i)))],
      ['wfl:link:redirect:', (i) => ok(waLink.allow(ip(i)))],
      ['mkt:hook:ip:', (i) => ok(hook.checkIp(ip(i)))],
      ['salesdoc:pub:', (i) => ok(salesdoc.check('read', ip(i), `tok-${i}`))],
      ['segments:rl:', (i) => ok(segments.check('preview', 1_000 + i, i))],
      ['rl67:', (i) => ok(authRl.hit(`rl67:${i}`, 120))],
      ['test:rl:', (i) => ok(sliding.consume(`test:rl:${RUN}:${i}`, 10, 60))],
      [
        'lock:',
        (i) => ok(locks.acquire(`lock:${RUN}:${i}`, { ttlMs: 60_000, onUnavailable: 'skip' })),
      ],
      [
        'wa:media-id:',
        (i) => ok(media.set(`wa:media-id:${RUN}:${i}`, 'MEDIA-ID-1234567890', 3_600)),
      ],
    ];

    const perFamily: Record<string, { keys: number; bytesPerKey: number }> = {};
    for (const [prefix, drive] of drivers) {
      const keysBefore = await redis.dbsize();
      await inBatches(N, drive);
      const keys = (await redis.dbsize()) - keysBefore;
      // MEMORY USAGE is exact per key (allocator noise of INFO deltas is not): average of a sample of this family's keys
      const [, sample] = await redis.scan('0', 'MATCH', `${prefix}*`, 'COUNT', 5000);
      const sizes = await Promise.all(
        sample.slice(0, 100).map((k) => redis.call('MEMORY', 'USAGE', k) as Promise<number>),
      );
      perFamily[prefix] = {
        keys,
        bytesPerKey: sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0,
      };
    }

    // every key: lifetime present and within the family's window
    const bad: string[] = [];
    const ttlMax: Record<string, number> = {};
    let total = 0;
    let noTtl = 0;
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'COUNT', 1000);
      cursor = next;
      const pipe = redis.pipeline();
      for (const k of keys) pipe.ttl(k);
      const ttls = (await pipe.exec()) ?? [];
      keys.forEach((k, i) => {
        total++;
        const ttl = Number(ttls[i]?.[1]);
        const fam = familyOf(k);
        if (ttl < 0) {
          noTtl++;
          bad.push(`${k} ttl=${ttl}`);
        } else if (fam === 'UNKNOWN' || ttl > (MAX_TTL_S[fam] ?? 0))
          bad.push(`${k} ttl=${ttl} family=${fam}`);
        ttlMax[fam] = Math.max(ttlMax[fam] ?? 0, ttl);
      });
    } while (cursor !== '0');
    expect(bad.slice(0, 5), 'a key without a lifetime, or one that outlives its window').toEqual(
      [],
    );
    expect(noTtl).toBe(0);

    const afterLoad = await usedMemory(redis);
    const growth = afterLoad - baseline;
    const bytesPerCaller = growth / (N * drivers.length);

    // 4. expiry hands the memory back (the test shortens every lifetime to 1 ms; real lifetimes are the ones asserted above)
    let c2 = '0';
    do {
      const [next, keys] = await redis.scan(c2, 'COUNT', 1000);
      c2 = next;
      const p = redis.pipeline();
      for (const k of keys) p.pexpire(k, 1);
      await p.exec();
    } while (c2 !== '0');
    await sleep(1_500); // active expiry runs 10 times a second
    const left = await redis.dbsize();
    const afterExpiry = await usedMemory(redis);

    record('keyHygieneUnderLoad', {
      distinctCallersPerFamily: N,
      families: drivers.length,
      keysCreated: total,
      keysWithoutTtl: noTtl,
      maxTtlSecondsByFamily: ttlMax,
      bytesPerKeyByFamily: Object.fromEntries(
        Object.entries(perFamily).map(([k, v]) => [k, v.bytesPerKey]),
      ),
      keysByFamily: Object.fromEntries(Object.entries(perFamily).map(([k, v]) => [k, v.keys])),
      memoryBaselineBytes: baseline,
      memoryAfterLoadBytes: afterLoad,
      memoryAfterExpiryBytes: afterExpiry,
      keysLeftAfterExpiry: left,
      averageBytesPerCallerKey: Math.round(bytesPerCaller),
      note: 'expiry brought forward to 1 ms by the test; lifetimes were asserted before that',
    });
    expect(left).toBe(0);
    // freed memory returns to within 1 MB of where it started (allocator fragmentation keeps a little)
    expect(afterExpiry - baseline).toBeLessThan(1_000_000);
    // a caller costs well under a kilobyte per key: 1,000,000 distinct callers against one family is bounded in megabytes, not gigabytes
    expect(bytesPerCaller).toBeLessThan(1_000);
  }, 180_000);

  it('reports memory in INFO so the exporter has something to read', async () => {
    const m = await info(redis, 'memory');
    expect(Number(m.used_memory)).toBeGreaterThan(0);
    if (own.container) {
      expect(Number(m.maxmemory)).toBe(128 * 1024 * 1024);
      expect(m.maxmemory_policy).toBe('noeviction');
    }
  });
});
