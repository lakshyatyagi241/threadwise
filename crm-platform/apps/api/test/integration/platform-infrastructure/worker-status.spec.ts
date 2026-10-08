import { hostname } from 'node:os';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readInfraEnv } from '../../../src/config/domains/platform-infrastructure.env';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import { WorkerStatusService } from '../../../src/modules/platform-infrastructure';
import {
  ALIVE_FOR_BEATS,
  OUTBOX_SAMPLE_KEY,
  WORKERS_KEY,
} from '../../../src/modules/platform-infrastructure/observability/worker-heartbeat';
import { WorkerHeartbeatService } from '../../../src/modules/platform-infrastructure/observability/worker-heartbeat.service';
import { workerIsBeating } from '../../../src/modules/platform-infrastructure/observability/worker-probe';

/** Against a real Redis. These keys are global, so each test starts from empty and leaves them empty. */
const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
const env = readInfraEnv({
  INFRA_WORKER_HEARTBEAT_SECONDS: '10',
  INFRA_OUTBOX_LAG_WARN_SECONDS: '60',
});
const ALIVE_MS = 10 * ALIVE_FOR_BEATS * 1000;
const NOW = 1_800_000_000_000;

let redis: Redis;
const clear = () => redis.del(WORKERS_KEY, OUTBOX_SAMPLE_KEY);

beforeAll(() => {
  redis = new Redis(url, { maxRetriesPerRequest: 1 });
});
beforeEach(clear);
afterAll(async () => {
  await clear();
  await redis.quit();
});

const sample = (over: Record<string, number> = {}) =>
  JSON.stringify({ ready: 4, lagSeconds: 5, sampledAt: NOW - 3000, ...over });

describe('WorkerStatusService', () => {
  const status = () => new WorkerStatusService(redis, env);

  it('reports no workers and an unknown outbox when nothing has been published', async () => {
    expect(await status().read(NOW)).toEqual({
      workers: { status: 'down', count: 0 },
      outbox: { status: 'unknown' },
    });
  });

  it('counts only workers that beat within three intervals', async () => {
    await redis.zadd(
      WORKERS_KEY,
      NOW - 1000,
      'a:1',
      NOW - ALIVE_MS + 1000,
      'b:1',
      NOW - ALIVE_MS - 1000,
      'c:1',
    );
    expect((await status().read(NOW)).workers).toEqual({ status: 'up', count: 2 });
  });

  it('says ok with the numbers when the outbox is keeping up', async () => {
    await redis.set(OUTBOX_SAMPLE_KEY, sample());
    expect((await status().read(NOW)).outbox).toEqual({
      status: 'ok',
      ready: 4,
      lagSeconds: 5,
      sampleAgeSeconds: 3,
    });
  });

  it('says lagging from the warn threshold up', async () => {
    await redis.set(OUTBOX_SAMPLE_KEY, sample({ lagSeconds: 59 }));
    expect((await status().read(NOW)).outbox.status).toBe('ok');
    await redis.set(OUTBOX_SAMPLE_KEY, sample({ lagSeconds: 60 }));
    expect((await status().read(NOW)).outbox.status).toBe('lagging');
  });

  it('does not trust a sample that is older than three intervals (nobody is sampling)', async () => {
    await redis.set(OUTBOX_SAMPLE_KEY, sample({ sampledAt: NOW - ALIVE_MS - 1 }));
    expect((await status().read(NOW)).outbox).toEqual({ status: 'unknown' });
  });

  it.each(['not json', '{}', '{"ready":"x","lagSeconds":1,"sampledAt":1}', 'null'])(
    'treats a corrupt sample (%s) as unknown',
    async (raw) => {
      await redis.set(OUTBOX_SAMPLE_KEY, raw);
      expect((await status().read(NOW)).outbox).toEqual({ status: 'unknown' });
    },
  );
});

/** A stand-in for the database that answers the sampling query. */
function fakeDb(rows: unknown[] | Error): DatabaseService {
  return {
    privileged: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => {
          if (rows instanceof Error) throw rows;
          return { rows };
        },
      }),
  } as unknown as DatabaseService;
}

describe('WorkerHeartbeatService', () => {
  const id = `${hostname()}:${process.pid}`;

  it('publishes the beat and the outbox sample', async () => {
    const hb = new WorkerHeartbeatService(fakeDb([{ ready: 3, lag_seconds: 7 }]), redis, env);
    await hb.beat(NOW);
    expect(Number(await redis.zscore(WORKERS_KEY, id))).toBe(NOW);
    expect(JSON.parse((await redis.get(OUTBOX_SAMPLE_KEY))!)).toEqual({
      ready: 3,
      lagSeconds: 7,
      sampledAt: NOW,
    });
    expect(await redis.pttl(OUTBOX_SAMPLE_KEY)).toBeGreaterThan(0);
  });

  it('reports lag 0 when nothing is due', async () => {
    await new WorkerHeartbeatService(fakeDb([{ ready: 0, lag_seconds: null }]), redis, env).beat(
      NOW,
    );
    expect(JSON.parse((await redis.get(OUTBOX_SAMPLE_KEY))!)).toMatchObject({
      ready: 0,
      lagSeconds: 0,
    });
  });

  it('forgets workers that stopped long ago', async () => {
    await redis.zadd(WORKERS_KEY, NOW - ALIVE_MS * 3, 'dead:9');
    await new WorkerHeartbeatService(fakeDb([{ ready: 0, lag_seconds: 0 }]), redis, env).beat(NOW);
    expect(await redis.zscore(WORKERS_KEY, 'dead:9')).toBeNull();
  });

  it('still beats when the database is down (and says nothing it does not know)', async () => {
    await new WorkerHeartbeatService(fakeDb(new Error('db down')), redis, env).beat(NOW);
    expect(Number(await redis.zscore(WORKERS_KEY, id))).toBe(NOW);
    expect(await redis.get(OUTBOX_SAMPLE_KEY)).toBeNull();
  });

  it('never throws, even when Redis is down', async () => {
    const dead = new Redis({
      host: '127.0.0.1',
      port: 1,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    dead.on('error', () => undefined);
    await expect(
      new WorkerHeartbeatService(fakeDb([{ ready: 0, lag_seconds: 0 }]), dead, env).beat(NOW),
    ).resolves.toBeUndefined();
    dead.disconnect();
  });

  it('leaves the set on a clean shutdown so it shows as gone at once', async () => {
    const hb = new WorkerHeartbeatService(fakeDb([{ ready: 0, lag_seconds: 0 }]), redis, env);
    await hb.beat(NOW);
    await hb.onApplicationShutdown();
    expect(await redis.zscore(WORKERS_KEY, id)).toBeNull();
  });
});

describe('worker container probe', () => {
  it('is true only for a fresh beat from this host', async () => {
    const host = 'abc123';
    await redis.zadd(WORKERS_KEY, NOW - 1000, `${host}:1`, NOW - 1000, 'other:1');
    expect(await workerIsBeating(redis, host, ALIVE_MS, NOW)).toBe(true);
    expect(await workerIsBeating(redis, 'nobody', ALIVE_MS, NOW)).toBe(false);
  });

  it('is false when this host has only stale beats', async () => {
    await redis.zadd(WORKERS_KEY, NOW - ALIVE_MS - 1, 'abc123:1');
    expect(await workerIsBeating(redis, 'abc123', ALIVE_MS, NOW)).toBe(false);
  });

  it('finds the entry among hundreds of other workers', async () => {
    const entries = Array.from(
      { length: 500 },
      (_, i) => [NOW - 500, `host${i}:1`] as const,
    ).flat();
    await redis.zadd(WORKERS_KEY, ...entries);
    expect(await workerIsBeating(redis, 'host497', ALIVE_MS, NOW)).toBe(true);
    expect(await workerIsBeating(redis, 'host999', ALIVE_MS, NOW)).toBe(false);
  });
});
