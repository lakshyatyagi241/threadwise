import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { AccountGateService } from '../../../src/modules/auth/security/account-gate.service';
import { OrgSuspensionService } from '../../../src/modules/auth/security/org-suspension.service';
import { PartnerAgentStatusService } from '../../../src/modules/auth/sessions/partner-agent-status.service';
import { EpochService } from '../../../src/modules/auth/sessions/epoch.service';
import { AuthKeys, Ttl } from '../../../src/modules/auth/support/redis-keys';
import { BookingPageThemesCache } from '../../../src/modules/appointments-booking/booking-page-themes.cache';
import { RedisUploadedMediaCache, uploadCacheKey } from '../../../src/infra/providers/whatsapp/media/upload-cache';
import { RateLimiter } from '../../../src/modules/platform-infrastructure/rate-limit/rate-limiter';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import { WebhookTargetsRepository } from '../../../src/modules/webhook-fanout/webhook-targets.repository';
import { cacheKey as summaryKey } from '../../../src/modules/campaigns/summary/campaign-summary-rules';
import { FakeClock, FakeRedis } from './fake-redis';

/**
 * Behaviour of the audited caches against a fake Redis with a clock the test moves (Sheet3 #64): a user of workspace A and then
 * workspace B asking for the same thing, how long a changed fact stays hidden, what happens when Redis is down, and how many
 * recomputations N parallel misses cause. RBAC (Lua) is in rbac-real-redis.spec.ts.
 */
beforeEach(() => {
  Logger.overrideLogger(false);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_700_000_000_000);
  process.env.AUTH_REDIS_FAILURE_MODE = 'open';
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.AUTH_REDIS_FAILURE_MODE;
});

/** A Redis whose clock is Date.now(), so vi.setSystemTime moves it together with the in-process caches. */
const redisAtNow = () => new FakeRedis(Object.assign(new FakeClock(), { now: () => Date.now() }));
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

/** Seconds until `read()` reflects the new truth, stepping 250 ms; returns Infinity after `capS` seconds. */
async function measureStale(read: () => Promise<boolean>, capS = 700): Promise<number> {
  for (let t = 0; t <= capS * 1000; t += 250) {
    if (await read()) return t / 1000;
    advance(250);
  }
  return Infinity;
}

const orgDb = (byOrg: Record<number, unknown>) => ({
  txAs: async (ctx: { orgId: number }, fn: (tx: unknown) => unknown) => fn({ execute: async () => ({ rows: [byOrg[ctx.orgId]] }) }),
});

function gate(redis: FakeRedis, states: Record<number, { suspended: boolean }>) {
  const svc = new AccountGateService({} as never, {} as never, redis as never, {} as never);
  const compute = vi.fn(async (orgId: number) => ({ suspended: states[orgId]!.suspended }));
  (svc as unknown as { compute: unknown }).compute = compute;
  return { svc, compute };
}

describe('tenant isolation: workspace A then workspace B, same ids', () => {
  it('account gate: user 7 of workspace 1 is suspended, user 7 of workspace 2 is not', async () => {
    const { svc } = gate(redisAtNow(), { 1: { suspended: true }, 2: { suspended: false } });
    expect((await svc.stateFor(1, 7, { includeOrgSuspension: false })).suspended).toBe(true);
    expect((await svc.stateFor(2, 7, { includeOrgSuspension: false })).suspended).toBe(false);
  });

  it('workspace suspended verdict and partner agent flag do not cross workspaces', async () => {
    const redis = redisAtNow();
    const orgs = new OrgSuspensionService(orgDb({ 1: { status: 'suspended' }, 2: { status: 'active' } }) as never, redis as never);
    expect(await orgs.isSuspended(1)).toBe(true);
    expect(await orgs.isSuspended(2)).toBe(false);
    const partners = new PartnerAgentStatusService(orgDb({ 1: { status: 'active' }, 2: { status: 'blocked' } }) as never, redis as never);
    expect(await partners.isActive(1, 9)).toBe(true);
    expect(await partners.isActive(2, 9)).toBe(false);
  });

  it('booking theme, uploaded media id and campaign summary keys carry the workspace', async () => {
    const redis = redisAtNow();
    const themes = new BookingPageThemesCache(redis as never);
    await themes.set(1, { look: 'A' });
    expect(await themes.get(2)).toBeNull();
    const media = new RedisUploadedMediaCache(redis as never);
    const p = { channelUuid: 'c', phoneNumberId: 'p', sha256: 'h', mime: 'image/png' };
    await media.set(uploadCacheKey({ orgId: 1, ...p }), 'MEDIA-A', 60);
    expect(await media.get(uploadCacheKey({ orgId: 2, ...p }))).toBeNull();
    expect(summaryKey(1, 'campaign', '5', 7, [])).not.toBe(summaryKey(2, 'campaign', '5', 7, []));
  });

  it('similar keys never collide: 30 workspaces x 30 ids give 900 different keys for every builder', () => {
    const builders: Array<(o: number, i: number) => string> = [
      (o, i) => AuthKeys.gate(o, i),
      (o, i) => AuthKeys.partnerStatus(o, i),
      (o, i) => summaryKey(o, 'campaign', String(i), 7, []),
      (o, i) => uploadCacheKey({ orgId: o, channelUuid: String(i), phoneNumberId: 'p', sha256: 'h', mime: 'm' }),
    ];
    for (const b of builders) {
      const keys = new Set<string>();
      for (let o = 1; o <= 30; o++) for (let i = 1; i <= 30; i++) keys.add(b(o, i));
      expect(keys.size).toBe(900);
    }
  });

  it('in-process caches: notification preferences of workspace 1 are not served to workspace 2', async () => {
    const db = { txAs: async (c: { orgId: number }, fn: (tx: unknown) => unknown) => fn({ execute: async () => ({ rows: [{ prefs: { who: c.orgId } }] }) }) };
    const r = new NotificationPrefsResolver(db as never);
    expect(await r.stored(1)).toEqual({ who: 1 });
    expect(await r.stored(2)).toEqual({ who: 2 });
  });
});

describe('stale windows: how long a changed fact stays hidden (measured on a moving clock)', () => {
  it('account gate: 30 s', async () => {
    const states = { 1: { suspended: false } };
    const { svc } = gate(redisAtNow(), states);
    await svc.stateFor(1, 7, { includeOrgSuspension: false });
    states[1].suspended = true; // changed in the database without an invalidate() call
    const s = await measureStale(async () => (await svc.stateFor(1, 7, { includeOrgSuspension: false })).suspended);
    console.log(`STALE gate ${s}`);
    expect(s).toBeLessThanOrEqual(Ttl.gateSeconds);
    expect(s).toBeGreaterThanOrEqual(Ttl.gateSeconds - 1);
  });

  it('workspace suspension: 5 s', async () => {
    const row = { status: 'active' };
    const orgs = new OrgSuspensionService(orgDb({ 1: row }) as never, redisAtNow() as never);
    await orgs.isSuspended(1);
    row.status = 'suspended';
    const s = await measureStale(() => orgs.isSuspended(1));
    console.log(`STALE orgSuspended ${s}`);
    expect(s).toBeLessThanOrEqual(Ttl.orgSuspendedSeconds);
  });

  it('partner agent deactivated: 30 s, because invalidate() has no caller', async () => {
    const row = { status: 'active' };
    const p = new PartnerAgentStatusService(orgDb({ 1: row }) as never, redisAtNow() as never);
    await p.isActive(1, 9);
    row.status = 'blocked';
    const s = await measureStale(async () => !(await p.isActive(1, 9)));
    console.log(`STALE partner ${s}`);
    expect(s).toBeLessThanOrEqual(Ttl.partnerStatusSeconds);
  });

  it('token epoch bumped by another process: 5 s', async () => {
    const redis = redisAtNow();
    const settings = { get: vi.fn(async () => 1), set: vi.fn() };
    const epoch = new EpochService(redis as never, settings as never);
    await redis.set('auth:epoch', '1');
    expect(await epoch.current()).toBe(1);
    await redis.set('auth:epoch', '2');
    const s = await measureStale(async () => (await epoch.current()) === 2);
    console.log(`STALE epoch ${s}`);
    expect(s).toBeLessThanOrEqual(5);
  });

  it('notification preferences (5 s) and webhook-forward target (10 s)', async () => {
    let prefs: unknown = { v: 1 };
    const db = { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({ execute: async () => ({ rows: [{ prefs }] }) }) };
    const r = new NotificationPrefsResolver(db as never);
    await r.stored(1);
    prefs = { v: 2 };
    const s1 = await measureStale(async () => (r as never as { stored(o: number): Promise<{ v: number }> }).stored(1).then((x) => x.v === 2));
    console.log(`STALE notificationPrefs ${s1}`);
    expect(s1).toBeLessThanOrEqual(5);

    let active = true;
    const store = { tx: async (fn: (tx: unknown) => unknown) => fn({ execute: async () => ({ rows: [{ id: 1, is_active: active, url: 'https://x', field_filter: null, timeout_ms: 1, max_attempts: 1 }] }) }) };
    const repo = new WebhookTargetsRepository(store as never, { decrypt: () => '' } as never);
    (repo as unknown as { toDelivery: unknown }).toDelivery = () => ({ ok: true });
    await repo.deliveryTarget(1);
    active = false;
    const s2 = await measureStale(async () => (await repo.deliveryTarget(1)) === null);
    console.log(`STALE webhookTarget ${s2}`);
    expect(s2).toBeLessThanOrEqual(10);
  });
});

describe('TTL expiry and Redis failure for each P0 cache', () => {
  it('the gate entry really expires from Redis after its TTL', async () => {
    const redis = redisAtNow();
    const { svc, compute } = gate(redis, { 1: { suspended: false } });
    await svc.stateFor(1, 7, { includeOrgSuspension: false });
    expect(redis.pttlSync(AuthKeys.gate(1, 7))).toBeLessThanOrEqual(Ttl.gateSeconds * 1000);
    advance((Ttl.gateSeconds + 1) * 1000);
    expect(redis.pttlSync(AuthKeys.gate(1, 7))).toBe(-2);
    await svc.stateFor(1, 7, { includeOrgSuspension: false });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('Redis down: the gate and partner status fall back to Postgres (fail to the source of truth)', async () => {
    const redis = redisAtNow();
    redis.down = true;
    const { svc } = gate(redis, { 1: { suspended: true } });
    expect((await svc.stateFor(1, 7, { includeOrgSuspension: false })).suspended).toBe(true);
    const p = new PartnerAgentStatusService(orgDb({ 1: { status: 'blocked' } }) as never, redis as never);
    expect(await p.isActive(1, 9)).toBe(false);
  });

  it('Redis down: a suspended workspace stays suspended (database answer); both stores down lets the request through (documented)', async () => {
    const redis = redisAtNow();
    redis.down = true;
    const orgs = new OrgSuspensionService(orgDb({ 1: { status: 'suspended' } }) as never, redis as never);
    expect(await orgs.isSuspended(1)).toBe(true);
    const broken = new OrgSuspensionService({ txAs: async () => { throw new Error('pg down'); } } as never, redis as never);
    expect(await broken.isSuspended(1)).toBe(false);
  });

  it('Redis down in closed mode: partner status refuses with 503 instead of guessing', async () => {
    process.env.AUTH_REDIS_FAILURE_MODE = 'closed';
    const redis = redisAtNow();
    redis.down = true;
    const p = new PartnerAgentStatusService(orgDb({ 1: { status: 'active' } }) as never, redis as never);
    await expect(p.isActive(1, 9)).rejects.toMatchObject({ status: 503 });
  });

  it('Redis down: the token epoch comes from Postgres, the rate limiter lets the request through and says so', async () => {
    const redis = redisAtNow();
    redis.down = true;
    const epoch = new EpochService(redis as never, { get: async () => 4, set: async () => undefined } as never);
    expect(await epoch.current()).toBe(4);
    const limiter = new RateLimiter(redis as never);
    expect(await limiter.consume('k', 5, 60)).toMatchObject({ allowed: true, degraded: true });
  });

  it('Redis down: booking theme and uploaded-media caches are misses, never errors; writes are ignored', async () => {
    const redis = redisAtNow();
    redis.down = true;
    expect(await new BookingPageThemesCache(redis as never).get(1)).toBeNull();
    await expect(new BookingPageThemesCache(redis as never).set(1, {})).resolves.toBeUndefined();
    const media = new RedisUploadedMediaCache(redis as never);
    expect(await media.get('k')).toBeNull();
    await expect(media.set('k', 'v', 60)).resolves.toBeUndefined();
  });

  it('Redis slow (150 ms per command) but answering: the gate still returns the right state', async () => {
    const redis = redisAtNow();
    redis.delayMs = 150;
    vi.useRealTimers();
    const { svc } = gate(redis, { 1: { suspended: true } });
    const t0 = performance.now();
    expect((await svc.stateFor(1, 7, { includeOrgSuspension: false })).suspended).toBe(true);
    const ms = performance.now() - t0;
    console.log(`SLOW gate cold read ${Math.round(ms)} ms with 150 ms per Redis command`);
    expect(ms).toBeGreaterThanOrEqual(290); // one GET + one SETEX, sequential
  });
});

describe('stampede: N parallel misses on a cold cache', () => {
  it('counts recomputations for the uncoalesced P0 and P1 caches', async () => {
    const N = 50;
    const { svc, compute } = gate(redisAtNow(), { 1: { suspended: false } });
    await Promise.all(Array.from({ length: N }, () => svc.stateFor(1, 7, { includeOrgSuspension: false })));
    console.log(`STAMPEDE gate ${compute.mock.calls.length}/${N}`);

    let reads = 0;
    const db = { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({ execute: async () => { reads++; return { rows: [{ status: 'active' }] }; } }) };
    const orgs = new OrgSuspensionService(db as never, redisAtNow() as never);
    await Promise.all(Array.from({ length: N }, () => orgs.isSuspended(1)));
    console.log(`STAMPEDE orgSuspended ${reads}/${N}`);

    let loads = 0;
    const pdb = { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({ execute: async () => { loads++; return { rows: [{ prefs: {} }] }; } }) };
    const r = new NotificationPrefsResolver(pdb as never);
    await Promise.all(Array.from({ length: N }, () => r.stored(1)));
    console.log(`STAMPEDE notificationPrefs ${loads}/${N}`);

    // Recorded, not asserted as a defect: none of these coalesces. They must at least never serve a wrong answer.
    expect(compute.mock.calls.length).toBeGreaterThan(1);
    expect(reads).toBeGreaterThan(1);
    expect(loads).toBeGreaterThan(1);
  });
});
