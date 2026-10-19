import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BlockingWorker,
  PRODUCER_CONNECTION_OPTIONS,
  WORKER_CONNECTION_OPTIONS,
} from '../../../src/infra/queue/queue.module';
import { ApiKeyAccessService } from '../../../src/modules/public-api/api-key-access.service';
import { RateLimitService } from '../../../src/modules/auth/security/rate-limit.service';
import { FormThrottle } from '../../../src/modules/forms-builder/form-throttle';
import { RateLimiter, guardWorkerAgainstOom } from '../../../src/modules/platform-infrastructure';
import { RedisLockService } from '../../../src/modules/platform-infrastructure/coordination/redis-lock.service';
import { REDIS_COMMAND_TIMEOUT_MS } from '../../../src/infra/redis/redis.module';
import { info, record, sleep, startOwnRedis, type OwnRedis } from './own-redis';

/**
 * What the application does when Redis is full, slow or restarted, on private servers (never the shared one).
 *
 * Full: production runs `maxmemory 192mb` with `noeviction`, so a full Redis REFUSES writes (error "OOM command not allowed") and keeps
 * everything it has. These tests fill a 12 MB server and call the real classes. The silent / refused / reset connection is item 18 part 2
 * (PR #663) and is not repeated here.
 */
const RUN = randomUUID().slice(0, 6);

describe('Redis full (maxmemory reached, noeviction)', () => {
  let own: OwnRedis;
  let admin: Redis;
  let filled = 0;
  const isOom = (e: unknown) => /OOM command not allowed/.test(String((e as Error)?.message));

  beforeAll(async () => {
    own = await startOwnRedis([
      '--maxmemory',
      '12mb',
      '--maxmemory-policy',
      'noeviction',
      '--appendonly',
      'no',
      '--save',
      '',
    ]);
    admin = own.client();
    // a few cached values that must survive the fill (nothing may be evicted)
    await admin.set(`keep:${RUN}:a`, 'precious');
    await admin.set(`keep:${RUN}:ttl`, 'precious', 'EX', 3600);
  }, 120_000);
  afterAll(async () => {
    await own.stop();
  });

  async function fill(): Promise<void> {
    const v = 'x'.repeat(1024);
    for (let i = 0; ; i++) {
      try {
        await admin.set(`fill:${RUN}:${i}`, v);
        filled = i + 1;
      } catch (e) {
        if (isOom(e)) return;
        throw e;
      }
    }
  }
  /** Keeps topping the server up so it stays AT the limit while we observe (memory otherwise wobbles by a few KB and lets a script through). */
  function holdFull(): () => void {
    let n = 0;
    const t = setInterval(
      () => void admin.set(`fill:${RUN}:hold:${n++}`, 'y'.repeat(256)).catch(() => undefined),
      15,
    );
    return () => clearInterval(t);
  }
  async function drain(): Promise<void> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, ks] = await admin.scan(cursor, 'MATCH', `fill:${RUN}:*`, 'COUNT', 1000);
      cursor = next;
      keys.push(...ks);
    } while (cursor !== '0');
    for (let i = 0; i < keys.length; i += 500) await admin.unlink(...keys.slice(i, i + 500));
  }

  it('refuses new writes, keeps every key, and still serves reads and deletes', async () => {
    await fill();
    const m = await info(admin, 'memory');
    const st = await info(admin, 'stats');
    expect(filled).toBeGreaterThan(1_000);
    expect(Number(m.used_memory)).toBeGreaterThan(Number(m.maxmemory) * 0.9);
    expect(Number(st.evicted_keys)).toBe(0);
    expect(await admin.get(`keep:${RUN}:a`)).toBe('precious');
    expect(await admin.get(`fill:${RUN}:0`)).toBe('x'.repeat(1024)); // the oldest key is still there: nothing was evicted
    await expect(admin.set('new:key', '1')).rejects.toThrow(/OOM/);
    await expect(admin.incr('new:counter')).rejects.toThrow(/OOM/);
    await expect(admin.multi().incr('new:c2').expire('new:c2', 60, 'NX').exec()).rejects.toThrow(
      /OOM|EXECABORT/,
    );
    expect(await admin.ttl(`keep:${RUN}:ttl`)).toBeGreaterThan(0); // reads, TTL, EXPIRE and DEL are not refused
    expect(await admin.expire(`keep:${RUN}:ttl`, 7200)).toBe(1);
    record('oom', {
      maxmemoryBytes: Number(m.maxmemory),
      usedMemoryAtRefusalBytes: Number(m.used_memory),
      keysStoredBeforeRefusal: filled,
      evictedKeys: Number(st.evicted_keys),
      refusedCommands: ['SET', 'INCR', 'MULTI(INCR,EXPIRE)'],
      stillWork: ['GET', 'TTL', 'EXPIRE', 'DEL/UNLINK', 'SCAN'],
    });
  }, 120_000);

  it('the shared services degrade as designed: throttles fail open, locks follow their policy, nothing throws', async () => {
    const redis = own.client({ maxRetriesPerRequest: 1 });
    const limiter = await new RateLimiter(redis).consume(`oom:${RUN}`, 5, 60);
    expect(limiter).toMatchObject({ allowed: true, degraded: true }); // sliding-window Lua writes: refused, so it lets the request through
    await expect(new FormThrottle(redis).checkIp('203.0.113.9')).resolves.toBeUndefined();
    const hit = await new RateLimitService(redis).hit(`oom:auth:${RUN}`, 60);
    expect(hit.count).toBe(1); // login / OTP throttles report "first attempt" every time while Redis is full
    const locks = new RedisLockService(redis);
    expect(
      await locks.acquire(`lock:oom:${RUN}`, { ttlMs: 5_000, onUnavailable: 'skip' }),
    ).toBeNull();
    const degraded = await locks.acquire(`lock:oom2:${RUN}`, {
      ttlMs: 5_000,
      onUnavailable: 'proceed',
    });
    expect(degraded?.degraded).toBe(true);
    // failed API-key authentications are not counted while full: the guessing throttle lapses
    const api = new ApiKeyAccessService(
      null as never,
      redis,
      null as never,
      null as never,
      null as never,
    );
    await expect(api.recordAuthFailure('partner', '203.0.113.9')).resolves.toBeUndefined();
    expect(await redis.exists('apikey:authfail:partner:203.0.113.9')).toBe(0);
    record('oomServices', {
      rateLimiter: 'allowed, degraded=true (fails open)',
      formThrottle: 'resolves (fails open)',
      authRateLimitHit: `count ${hit.count} every call (fails open)`,
      lockSkip: 'null (work does not run)',
      lockProceed: 'degraded lease (runs unprotected)',
      apiKeyFailureCounter: 'not recorded (guessing throttle lapses)',
    });
  }, 60_000);

  it('a queue producer gets an OOM error from add() and nothing is half-written', async () => {
    const q = new Queue(`oom-add-${RUN}`, {
      connection: { host: own.host, port: own.port, ...PRODUCER_CONNECTION_OPTIONS },
    });
    let err: unknown;
    try {
      await q.add('j', { a: 1 });
    } catch (e) {
      err = e;
    }
    expect(isOom(err), `add() must fail loudly, got: ${String(err)}`).toBe(true);
    expect(await admin.exists(`bull:oom-add-${RUN}:id`)).toBe(0);
    record('oomQueueAdd', {
      error: String((err as Error).message).slice(0, 120),
      keysLeftBehind: 0,
    });
    await q.close();
  }, 60_000);

  /** 5 jobs queued, the server then filled to its limit, a worker started on the full server. */
  async function workerOnFullServer(name: string, guard: boolean) {
    await drain();
    const conn = { host: own.host, port: own.port, ...WORKER_CONNECTION_OPTIONS };
    const q = new Queue(name, { connection: conn });
    await q.addBulk(Array.from({ length: 5 }, (_, n) => ({ name: 'j', data: { n } })));
    await fill();
    const release = holdFull();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.fn();
    const w = new BlockingWorker(name, async () => undefined, { connection: conn });
    if (guard) guardWorkerAgainstOom(w, { pauseMs: 1_000, log: { warn, error: vi.fn() } });
    const cpu0 = process.cpuUsage();
    await sleep(3_000);
    const cpu = process.cpuUsage(cpu0);
    const errorLines = spy.mock.calls.length;
    spy.mockRestore();
    const whileFull = await q.getJobCounts('active', 'completed', 'waiting');
    release();
    return {
      q,
      w,
      errorLines,
      warns: warn.mock.calls.length,
      cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      whileFull,
    };
  }

  it('a worker started on a full server takes no job and spins: thousands of error lines a second (the defect)', async () => {
    const { q, w, errorLines, cpuMs, whileFull } = await workerOnFullServer(
      `oom-spin-${RUN}`,
      false,
    );
    record('oomWorkerSpin', {
      seconds: 3,
      errorLinesPrinted: errorLines,
      processCpuMs: cpuMs,
      jobsCompleted: whileFull.completed,
      jobsWaiting: whileFull.waiting,
    });
    expect(whileFull.completed).toBe(0);
    expect(errorLines).toBeGreaterThan(500); // documents the unguarded behaviour of the library; the guard below is what the app uses
    await w.close(true);
    await q.close();
  }, 60_000);

  it('with the OOM guard the worker backs off, logs once per pause, and finishes the jobs when memory is back', async () => {
    const { q, w, errorLines, warns, cpuMs, whileFull } = await workerOnFullServer(
      `oom-guard-${RUN}`,
      true,
    );
    await drain(); // memory returns
    const t0 = Date.now();
    let done = 0;
    while (Date.now() - t0 < 15_000 && done < 5) {
      await sleep(250);
      done = (await q.getJobCounts('completed')).completed ?? 0;
    }
    record('oomWorkerGuarded', {
      seconds: 3,
      errorLinesPrinted: errorLines,
      pauseWarningsLogged: warns,
      processCpuMs: cpuMs,
      jobsCompletedWhileFull: whileFull.completed,
      jobsCompletedAfterMemoryReturned: done,
      msFromMemoryReturnedToAllJobsDone: Date.now() - t0,
    });
    expect(errorLines).toBeLessThan(20); // the guard owns the error event; unguarded the same 3 s print thousands of lines
    expect(warns).toBeGreaterThanOrEqual(1);
    expect(warns).toBeLessThanOrEqual(4); // one per 1 s pause, not one per error
    expect(done).toBe(5);
    await w.close();
    await q.close();
  }, 90_000);

  it('a job that is running when the server fills is not lost: it finishes when memory is back', async () => {
    await drain();
    const name = `oom-running-${RUN}`;
    const conn = { host: own.host, port: own.port, ...WORKER_CONNECTION_OPTIONS };
    const q = new Queue(name, { connection: conn });
    await q.add('j', {}, { attempts: 3, backoff: { type: 'fixed', delay: 200 } });
    let runs = 0;
    let release = () => undefined as void;
    const w = new BlockingWorker(
      name,
      async () => {
        runs++;
        if (runs === 1) {
          await fill();
          release = holdFull();
        }
      },
      { connection: conn, stalledInterval: 1_000, lockDuration: 1_000 },
    );
    guardWorkerAgainstOom(w, { pauseMs: 500, log: { warn: vi.fn(), error: vi.fn() } });
    await sleep(2_500);
    const whileFull = await q.getJobCounts('active', 'completed', 'waiting', 'delayed', 'failed');
    release();
    await drain();
    let done = 0;
    for (let i = 0; i < 60 && !done; i++) {
      await sleep(250);
      done = (await q.getJobCounts('completed')).completed ?? 0;
    }
    // Whether the finishing script is refused at the limit depends on a few KB; what must hold is that the job is not lost.
    record('oomRunningJob', {
      stateWhileFull: whileFull,
      handlerRuns: runs,
      completedAfterMemoryReturned: done,
    });
    expect(done).toBe(1);
    await w.close(true);
    await q.close();
  }, 90_000);

  it('an exact restore: the oldest keys were never evicted', async () => {
    expect(await admin.get(`keep:${RUN}:a`)).toBe('precious');
  });
});

describe('Redis slow (a stall of the server itself)', () => {
  let own: OwnRedis;
  beforeAll(async () => {
    own = await startOwnRedis(['--enable-debug-command', 'yes']); // DEBUG SLEEP, on this private server only
  }, 120_000);
  afterAll(async () => {
    await own.stop();
  });

  it('a 3 s server stall: the shared client gives up at its 2 s command deadline and the limiter fails open', async () => {
    // the shared client exactly as infra/redis/redis.module.ts builds it (deadline and capped back-off from PR #663)
    const shared = new Redis(own.url, {
      maxRetriesPerRequest: 3,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      retryStrategy: (times: number) => Math.min(times * 50, 500),
      enableReadyCheck: true,
      lazyConnect: false,
    });
    const admin = own.client();
    await shared.ping();
    const stall = admin.call('DEBUG', 'SLEEP', '3'); // blocks the server for 3 s
    await sleep(100);
    const t0 = Date.now();
    const out = await new RateLimiter(shared).consume(`slow:${RUN}`, 5, 60);
    const waited = Date.now() - t0;
    await stall;
    record('slowRedis', {
      serverStallSeconds: 3,
      commandDeadlineMs: REDIS_COMMAND_TIMEOUT_MS,
      requestWaitedMs: waited,
      result: out.degraded ? 'degraded (failed open)' : 'answered normally',
    });
    expect(out.degraded).toBe(true);
    expect(waited).toBeGreaterThanOrEqual(REDIS_COMMAND_TIMEOUT_MS - 200);
    expect(waited).toBeLessThan(2_900); // released by the deadline, not by the end of the stall
    shared.disconnect();
  }, 60_000);
});

describe('Redis restarted', () => {
  let own: OwnRedis;
  const name = () => own.container!.getName().replace(/^\//, '');
  const docker = (...a: string[]) => execFileSync('docker', a, { stdio: 'pipe' }).toString();

  beforeAll(async () => {
    // appendonly yes + everysec is the production persistence setting
    own = await startOwnRedis([
      '--appendonly',
      'yes',
      '--appendfsync',
      'everysec',
      '--maxmemory-policy',
      'noeviction',
    ]);
  }, 120_000);
  afterAll(async () => {
    await own.stop();
  });

  it('a graceful restart loses no queued job and keeps TTLs; a SIGKILL loses at most the last second of writes', async () => {
    if (!own.container) return; // needs a container this suite owns
    const qn = `rst-${RUN}`;
    const conn = { host: own.host, port: own.port, maxRetriesPerRequest: null as null };
    const q = new Queue(qn, { connection: conn });
    const admin = own.client();
    await admin.set(`ttlkey:${RUN}`, 'v', 'EX', 3600);
    await q.addBulk(Array.from({ length: 500 }, (_, i) => ({ name: 'j', data: { i } })));
    await sleep(1_500); // past one fsync
    const t0 = Date.now();
    docker('restart', '-t', '5', name());
    // first successful command after the restart
    const back = Date.now() - t0; // `docker restart` returns once the server is up again; it includes the stop and the AOF reload
    const waiting = (await q.getJobCounts('waiting')).waiting;
    const ttl = await admin.ttl(`ttlkey:${RUN}`);
    // SIGKILL after fresh writes: AOF everysec may drop up to ~1 s
    await q.addBulk(Array.from({ length: 300 }, (_, i) => ({ name: 'j', data: { late: i } })));
    docker('kill', name());
    docker('start', name());
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try {
        await new Redis(own.url, {
          maxRetriesPerRequest: 0,
          enableOfflineQueue: false,
          connectTimeout: 500,
        }).ping();
        up = true;
      } catch {
        await sleep(100);
      }
    }
    const afterKill = (await new Queue(qn, { connection: conn }).getJobCounts('waiting')).waiting;
    record('restart', {
      persistence: 'appendonly yes, appendfsync everysec',
      queuedBeforeGracefulRestart: 500,
      waitingAfterGracefulRestart: waiting,
      dockerRestartCommandMs: back,
      ttlAfterRestartSeconds: ttl,
      addedImmediatelyBeforeSigkill: 300,
      waitingAfterSigkill: afterKill,
      jobsLostToSigkill: 800 - afterKill,
    });
    expect(waiting).toBe(500);
    expect(ttl).toBeGreaterThan(3_000);
    expect(afterKill).toBeGreaterThanOrEqual(500);
    expect(afterKill).toBeLessThanOrEqual(800);
  }, 180_000);

  it('a worker and a producer resume by themselves after the server comes back', async () => {
    if (!own.container) return;
    const qn = `rst2-${RUN}`;
    const conn = { host: own.host, port: own.port, ...WORKER_CONNECTION_OPTIONS };
    const q = new Queue(qn, { connection: conn });
    let done = 0;
    const w = new Worker(qn, async () => void done++, { connection: conn, concurrency: 5 });
    await q.addBulk(Array.from({ length: 50 }, () => ({ name: 'j', data: {} })));
    await sleep(500);
    docker('restart', '-t', '2', name());
    const t0 = Date.now();
    await q.addBulk(Array.from({ length: 50 }, () => ({ name: 'j', data: {} })));
    const resumeMs = Date.now() - t0;
    await sleep(3_000);
    record('restartResume', {
      jobsDoneAfterResume: done,
      jobsAdded: 100,
      addBlockedForMs: resumeMs,
    });
    expect(done).toBeGreaterThanOrEqual(100);
    await w.close();
    await q.close();
  }, 120_000);
});
