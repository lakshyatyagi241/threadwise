import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runTransaction, type DbClient, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { RedisModule } from '../../../src/infra/redis/redis.module';
import {
  BlockingWorker,
  BoundedQueue,
  PRODUCER_CONNECTION_OPTIONS,
  queueRedisOptions,
} from '../../../src/infra/queue/queue.module';
import { OutboxDrainService } from '../../../src/workers/outbox-drain.service';
import { startTcpFaultProxy, type TcpFaultProxy } from '../../unit/network-failure/tcp-fault-proxy';
import { timed } from '../../unit/network-failure/fault-server';
import { startNfInfra, type NfInfra } from './infra';

/**
 * Outage and RECOVERY against real Postgres and Redis, with the fault injected by a TCP proxy in front of each (see infra.ts).
 * The unit suite proves that every case ends in time with a classifiable error; this one proves the system comes back by itself when
 * the dependency does, with no restart, and that the repeated failures in between leaked nothing.
 */
let infra: NfInfra;
let pgProxy: TcpFaultProxy;
let redisProxy: TcpFaultProxy;
let owner: Client;
const cleanups: Array<() => Promise<unknown> | unknown> = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function eventually<T>(fn: () => Promise<T>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (Date.now() > end) throw err;
      await sleep(100);
    }
  }
}

beforeAll(async () => {
  Logger.overrideLogger(false);
  console.error = () => undefined;
  infra = await startNfInfra();
  pgProxy = await startTcpFaultProxy(infra.pg);
  redisProxy = await startTcpFaultProxy({ host: infra.redis.host, port: infra.redis.port });
  owner = new Client({ connectionString: infra.ownerUrl() });
  await owner.connect();
}, 600_000);

afterEach(async () => {
  await pgProxy.setMode('pass');
  await redisProxy.setMode('pass');
  while (cleanups.length) {
    await Promise.race([Promise.resolve(cleanups.pop()!()).catch(() => undefined), sleep(1_000)]);
  }
});

afterAll(async () => {
  await owner?.end().catch(() => undefined);
  await pgProxy?.close();
  await redisProxy?.close();
  await infra?.stop();
});

function db(poolMax = 3): DbClient {
  const c = createDbClient({
    url: infra.appUrl('127.0.0.1', pgProxy.port),
    poolMax,
    statementTimeoutMs: 500,
  });
  cleanups.push(() => c.pool.end());
  return c;
}
const ping = (c: DbClient) => runTransaction(c.db, (tx) => tx.execute(sql`select 1 as one`));

describe('Postgres: outage, then recovery', () => {
  it.each(['reset', 'refuse', 'stall', 'blackhole'] as const)(
    '%s: transactions fail inside the deadline, and the same pool works again once the proxy passes',
    async (mode) => {
      const c = db(3);
      await ping(c); // warm: a live pooled connection exists, as in production
      await pgProxy.setMode(mode);
      for (let i = 0; i < 4; i++) {
        // more failures than pool slots (3): a leaked slot per failure would starve the recovery below
        const r = await timed(() => ping(c));
        expect(r.error, `${mode} #${i}`).toBeDefined();
        // a silent link also hangs the new connection each retry needs, which ends at the 10 s connection timeout
        expect(r.ms).toBeLessThan(mode === 'stall' || mode === 'blackhole' ? 12_000 : 6_000);
      }
      await pgProxy.setMode('pass');
      const back = await timed(() => eventually(() => ping(c)));
      expect(back.error).toBeUndefined();
      expect(back.ms).toBeLessThan(8_000);
      expect(c.pool.totalCount).toBeLessThanOrEqual(3);
      expect(c.pool.waitingCount).toBe(0);
    },
    90_000,
  );
});

describe('Redis: outage, then recovery', () => {
  function appRedis(): Redis {
    type Provider = { useFactory: (config: { get: (k: string) => string }) => Redis };
    const [provider] = Reflect.getMetadata('providers', RedisModule) as Provider[];
    const redis = provider!.useFactory({
      get: () => `redis://127.0.0.1:${redisProxy.port}/${infra.redis.db}`,
    });
    redis.on('error', () => undefined);
    cleanups.push(() => redis.disconnect());
    return redis;
  }
  const key = () => `nf2:${randomBytes(4).toString('hex')}`;

  it.each(['reset', 'refuse', 'stall', 'blackhole'] as const)(
    '%s: commands fail inside the deadline, and the same client works again once the proxy passes',
    async (mode) => {
      const redis = appRedis();
      const k = key();
      await redis.set(k, '1', 'EX', 60);
      await redisProxy.setMode(mode);
      const r = await timed(() => redis.get(k));
      expect(r.error).toBeDefined();
      expect(r.ms).toBeLessThan(3_500);
      await redisProxy.setMode('pass');
      const back = await eventually(() => redis.get(k), 15_000);
      expect(back).toBe('1');
      await redis.del(k);
    },
    60_000,
  );
});

describe('BullMQ: producers and workers across a Redis outage', () => {
  const prefix = `nf2${randomBytes(4).toString('hex')}`;
  const conn = (producer: boolean) => ({
    ...queueRedisOptions(`redis://127.0.0.1:${redisProxy.port}/${infra.redis.db}`),
    ...(producer ? PRODUCER_CONNECTION_OPTIONS : {}),
  });

  it('a producer that started while Redis was down fails fast, then works by itself when Redis returns', async () => {
    await redisProxy.setMode('refuse');
    const q = new BoundedQueue('recovery', { prefix, connection: conn(true) });
    q.on('error', () => undefined);
    cleanups.push(async () => {
      await q.obliterate({ force: true }).catch(() => undefined);
      await q.disconnect();
    });
    const down = await timed(() => q.add('job', { n: 1 }));
    expect(down.error).toBeDefined();
    expect(down.ms).toBeLessThan(5_000);
    await redisProxy.setMode('pass');
    const job = await eventually(() => q.add('job', { n: 2 }), 20_000);
    expect(job.id).toBeDefined();
  }, 60_000);

  it('a producer that lost Redis mid-life fails fast on every call, then recovers', async () => {
    const q = new BoundedQueue('midlife', { prefix, connection: conn(true) });
    q.on('error', () => undefined);
    cleanups.push(async () => {
      await q.obliterate({ force: true }).catch(() => undefined);
      await q.disconnect();
    });
    await q.add('job', { n: 1 });
    await redisProxy.setMode('refuse');
    await sleep(300);
    for (let i = 0; i < 3; i++) {
      const r = await timed(() => q.add('job', { n: 10 + i }));
      expect(r.error).toBeDefined();
      expect(r.ms).toBeLessThan(2_000);
    }
    await redisProxy.setMode('pass');
    await eventually(() => q.add('job', { n: 99 }), 20_000);
  }, 60_000);

  it.each(['reset', 'blackhole'] as const)(
    'a worker keeps waiting through a %s outage and picks up the next job when Redis returns',
    async (mode) => {
      const name = `worker-${mode}`;
      const direct = new Queue(name, {
        prefix,
        connection: {
          ...queueRedisOptions(`redis://${infra.redis.host}:${infra.redis.port}/${infra.redis.db}`),
        },
      });
      direct.on('error', () => undefined);
      const done: number[] = [];
      const worker = new BlockingWorker(
        name,
        async (job: Job) => {
          done.push(job.data.n);
        },
        {
          prefix,
          connection: { ...conn(false), maxRetriesPerRequest: 1, enableOfflineQueue: false },
        },
      );
      worker.on('error', () => undefined);
      cleanups.push(async () => {
        await worker.close(true).catch(() => undefined);
        await direct.obliterate({ force: true }).catch(() => undefined);
        await direct.disconnect();
      });
      await worker.waitUntilReady();
      await direct.add('j', { n: 1 });
      await eventually(async () => expect(done).toContain(1), 10_000);

      await redisProxy.setMode(mode);
      await sleep(1_500);
      expect(worker.isRunning()).toBe(true); // an outage does not stop the worker
      await direct.add('j', { n: 2 }); // enqueued by another process while this worker cannot see Redis
      await redisProxy.setMode('pass');
      await eventually(async () => expect(done).toContain(2), 30_000);
    },
    90_000,
  );
});

describe('outbox drain across a database outage', () => {
  it('a tick during the outage ends without throwing; the next tick after it delivers the event exactly once', async () => {
    const c = db(2);
    const pair = { primary: c, replica: c, close: async () => undefined } as DbClientPair;
    const delivered: string[] = [];
    const registry = { dispatch: async (e: { id: string }) => void delivered.push(e.id) } as never;
    const drain = new OutboxDrainService(new DatabaseService(pair), registry);

    const org = await owner.query(
      `INSERT INTO organizations (name, slug) VALUES ('nf2 outbox', $1) RETURNING id`,
      [`nf2-${randomBytes(4).toString('hex')}`],
    );
    await owner.query(
      `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
       VALUES ($1, 'nf2', '1', 'nf2.test', '{}'::jsonb)`,
      [org.rows[0].id],
    );

    for (const mode of ['reset', 'stall'] as const) {
      await pgProxy.setMode(mode);
      const r = await timed(() => drain.drain());
      expect(r.error).toBeUndefined();
      expect(r.ms).toBeLessThan(12_000);
      expect(delivered).toHaveLength(0);
      await pgProxy.setMode('pass');
    }
    await eventually(async () => {
      await drain.drain();
      expect(delivered).toHaveLength(1);
    }, 15_000);
    await drain.drain();
    expect(delivered).toHaveLength(1);
    const row = await owner.query(`SELECT status FROM event_outbox WHERE org_id = $1`, [
      org.rows[0].id,
    ]);
    expect(row.rows[0].status).toBe('done');
  }, 90_000);
});
