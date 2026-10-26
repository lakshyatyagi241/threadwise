import { Logger } from '@nestjs/common';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { createDbClient, runTransaction, type DbClient, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { HealthDb } from '../../../src/infra/db/side-pools';
import { RedisModule } from '../../../src/infra/redis/redis.module';
import {
  BoundedQueue,
  PRODUCER_CONNECTION_OPTIONS,
  PRODUCER_READY_TIMEOUT_MS,
  queueRedisOptions,
} from '../../../src/infra/queue/queue.module';
import { ProblemExceptionFilter } from '../../../src/common/filters/problem-exception.filter';
import { HealthController } from '../../../src/health/health.controller';
import { OutboxDrainService } from '../../../src/workers/outbox-drain.service';
import { closedPortUrl, timed } from './fault-server';
import { startFrozenPostgres, startFrozenRedis, type FrozenBackend } from './frozen-backends';
import { startTcpFaultProxy, type TcpFaultProxy } from './tcp-fault-proxy';

/**
 * What the API's own clients do when Postgres or Redis cannot be reached, resets the connection, or stops answering. No real server is
 * needed: "refused" is a closed port, "reset" and "black hole" come from the fault proxy with nothing behind it, and "frozen" is a fake
 * that completes the handshake and then never answers (the case no error ever reports). The cases that need a live service to come
 * back are in test/integration/network-failure.
 *
 * Each case must end within a deadline, end in an error the caller can classify, and leave nothing open.
 */
const STATEMENT_TIMEOUT_MS = 300;
/** The client-side allowance on top of the server's statement timeout (packages/db/src/client.ts). */
const QUERY_GRACE_MS = 2_500;
const SLACK_MS = 1_500;

// The failures below are logged on purpose by the code under test; the tests assert what it did, not what it printed.
beforeAll(() => Logger.overrideLogger(false));

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  // A stuck connection can make `pool.end()` wait for ever; cleanup must never be the thing that hangs.
  while (cleanups.length) {
    await Promise.race([cleanups.pop()!(), new Promise((r) => setTimeout(r, 500))]);
  }
});

function pgClient(port: number): DbClient {
  const client = createDbClient({
    url: `postgres://crm_app_user:x@127.0.0.1:${port}/crm`,
    poolMax: 2,
    statementTimeoutMs: STATEMENT_TIMEOUT_MS,
  });
  // The pool's own 'error' listener is a console.error; the tests assert outcomes, not log noise.
  console.error = () => undefined;
  cleanups.push(() => client.pool.end().catch(() => undefined));
  return client;
}

async function proxy(mode: 'refuse' | 'reset' | 'blackhole'): Promise<TcpFaultProxy> {
  const p = await startTcpFaultProxy(undefined, mode);
  cleanups.push(() => p.close());
  return p;
}

async function frozen(kind: 'pg' | 'redis' | 'pg-reset'): Promise<FrozenBackend> {
  const b = await (kind === 'redis'
    ? startFrozenRedis()
    : startFrozenPostgres(kind === 'pg-reset' ? 'reset' : 'swallow'));
  cleanups.push(() => b.close());
  return b;
}

const select1 = (c: DbClient) => c.db.execute(sql`select 1`);
// The way every tenant transaction in the API opens (withTenant / withPrivileged).
const inTx = (c: DbClient) =>
  runTransaction(c.db, async (tx) => {
    await tx.execute(sql`select 1`);
  });

async function waitFor(cond: () => boolean, ms = 2_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end && !cond()) await new Promise((r) => setTimeout(r, 25));
  return cond();
}

describe('Postgres client (createDbClient)', () => {
  it.each(['refuse', 'reset'] as const)(
    '%s: the query fails fast with an outage error and the pool holds no connection',
    async (mode) => {
      const px = await proxy(mode);
      const c = pgClient(px.port);
      const r = await timed(() => select1(c));
      expect(r.error).toBeDefined();
      expect(r.ms).toBeLessThan(SLACK_MS);
      const { isDependencyOutage } = await import('../../../src/common/errors/dependency-outage');
      expect(isDependencyOutage(r.error)).toBe(true);
      expect(await waitFor(() => c.pool.totalCount === 0)).toBe(true);
    },
  );

  it('black hole at connect: ends at the connection timeout, not never', async () => {
    const px = await proxy('blackhole');
    const c = pgClient(px.port);
    const r = await timed(() => select1(c));
    expect(r.error).toBeDefined();
    expect(r.ms).toBeGreaterThan(8_000);
    expect(r.ms).toBeLessThan(10_000 + SLACK_MS);
    expect(await waitFor(() => c.pool.totalCount === 0)).toBe(true);
  }, 20_000);

  it('connection dies at the first statement of a transaction: every failure gives its pool slot back (N10)', async () => {
    const pg = await frozen('pg-reset');
    const c = pgClient(pg.port); // two slots: a leak of one per failure would exhaust them on the third attempt
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await timed(() => inTx(c));
      expect(r.error, `attempt ${attempt}`).toBeDefined();
      expect(r.ms, `attempt ${attempt}`).toBeLessThan(SLACK_MS);
      expect(String(r.error)).not.toMatch(/timeout exceeded when trying to connect/);
    }
    expect(await waitFor(() => c.pool.totalCount === 0)).toBe(true);
  }, 20_000);

  it('connected, then silent: a query ends shortly after the statement timeout (N6)', async () => {
    const pg = await frozen('pg');
    const c = pgClient(pg.port);
    const r = await timed(() => inTx(c));
    expect(pg.swallowed()).toBeGreaterThan(0); // the request really went into the void
    expect(r.error).toBeDefined();
    expect(r.ms).toBeLessThan(STATEMENT_TIMEOUT_MS + QUERY_GRACE_MS + SLACK_MS);
    const { isDependencyOutage } = await import('../../../src/common/errors/dependency-outage');
    expect(isDependencyOutage(r.error)).toBe(true);
    // The stuck connection is thrown away, not returned to the pool to hang the next request.
    expect(await waitFor(() => c.pool.totalCount === 0 && pg.open() === 0)).toBe(true);
  }, 20_000);
});

describe('shared Redis client (RedisModule)', () => {
  function appRedis(url: string): Redis {
    type Provider = { useFactory: (config: { get: (k: string) => string }) => Redis };
    const [provider] = Reflect.getMetadata('providers', RedisModule) as Provider[];
    const redis = provider!.useFactory({ get: () => url });
    redis.on('error', () => undefined);
    cleanups.push(() => redis.disconnect());
    return redis;
  }

  it('refused: a command fails fast instead of waiting for the outage to end', async () => {
    const redis = appRedis(toRedisUrl(await closedPortUrl()));
    const r = await timed(() => redis.get('k'));
    expect(r.error).toBeDefined();
    expect(r.ms).toBeLessThan(3_000);
    const { isDependencyOutage } = await import('../../../src/common/errors/dependency-outage');
    expect(isDependencyOutage(r.error)).toBe(true);
  });

  it('connected, then silent: a command ends at its command timeout (N7)', async () => {
    const rd = await frozen('redis');
    const redis = appRedis(`redis://127.0.0.1:${rd.port}`);
    expect(await waitFor(() => redis.status === 'ready')).toBe(true);
    const r = await timed(() => redis.get('k'));
    expect(rd.swallowed()).toBeGreaterThan(0);
    expect(r.error).toBeDefined();
    expect(r.ms).toBeLessThan(3_500);
    const { isDependencyOutage } = await import('../../../src/common/errors/dependency-outage');
    expect(isDependencyOutage(r.error)).toBe(true);
  }, 20_000);
});

const toRedisUrl = (httpUrl: string) => `redis://${new URL(httpUrl).host}`;

describe('BullMQ producer connection (PRODUCER_CONNECTION_OPTIONS)', () => {
  function producer(url: string): BoundedQueue {
    const q = new BoundedQueue(`nf2-${Math.random().toString(36).slice(2)}`, {
      connection: { ...queueRedisOptions(url), ...PRODUCER_CONNECTION_OPTIONS },
    });
    q.on('error', () => undefined);
    cleanups.push(() => q.disconnect().catch(() => undefined));
    return q;
  }

  it('refused from the start (a restart during the outage): queue.add ends at the ready deadline, not never (N8)', async () => {
    const q = producer(toRedisUrl(await closedPortUrl()));
    const r = await timed(() => q.add('job', { a: 1 }));
    expect(r.error).toBeDefined();
    expect(r.ms).toBeLessThan(PRODUCER_READY_TIMEOUT_MS + SLACK_MS);
    const { isDependencyOutage } = await import('../../../src/common/errors/dependency-outage');
    expect(isDependencyOutage(r.error)).toBe(true);
  }, 20_000);

  it('connected, then silent: queue.add ends at the command timeout, not never (N8)', async () => {
    const rd = await frozen('redis');
    const q = producer(`redis://127.0.0.1:${rd.port}`);
    await q.waitUntilReady();
    const r = await timed(() => q.add('job', { a: 1 }));
    expect(r.error).toBeDefined();
    expect(r.ms).toBeLessThan(3_500);
    const { isDependencyOutage } = await import('../../../src/common/errors/dependency-outage');
    expect(isDependencyOutage(r.error)).toBe(true);
  }, 20_000);
});

describe('readiness probe (GET /ready)', () => {
  function controller(pg: DbClient, redis: Redis): HealthController {
    const pair = { primary: pg, replica: pg, close: async () => undefined } as DbClientPair;
    const workerStatus = {
      read: () => Promise.reject(new Error('redis is down')),
    } as never;
    return new HealthController(new DatabaseService(pair), new HealthDb(pg), redis, workerStatus);
  }
  const fakeRes = () => {
    const res = { code: 200, status: (c: number) => ((res.code = c), res) };
    return res;
  };

  it('both down (refused): answers 503 quickly and names no address', async () => {
    const pgPort = await closedPortUrl().then((u) => Number(new URL(u).port));
    const redisUrl = toRedisUrl(await closedPortUrl());
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    redis.on('error', () => undefined);
    cleanups.push(() => redis.disconnect());
    const res = fakeRes();
    const r = await timed(() => controller(pgClient(pgPort), redis).readiness(res as never));
    expect(r.ms).toBeLessThan(SLACK_MS * 2);
    expect(res.code).toBe(503);
    const body = JSON.stringify(r.value);
    expect(body).toContain('"degraded"');
    // The probe is public: it must not tell a stranger which host and port the database is on.
    expect(body).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|:\d{4,5}/);
  });

  it('both connected but silent: still answers 503 within a few seconds, never hangs (N9)', async () => {
    const pg = await frozen('pg');
    const rd = await frozen('redis');
    const redis = new Redis(`redis://127.0.0.1:${rd.port}`);
    redis.on('error', () => undefined);
    cleanups.push(() => redis.disconnect());
    await waitFor(() => redis.status === 'ready');
    const res = fakeRes();
    const r = await Promise.race([
      timed(() => controller(pgClient(pg.port), redis).readiness(res as never)),
      new Promise<'hung'>((ok) => setTimeout(() => ok('hung'), 8_000)),
    ]);
    expect(r).not.toBe('hung');
    expect((r as { ms: number }).ms).toBeLessThan(4_500);
    expect(res.code).toBe(503);
  }, 20_000);
});

describe('outbox drain (workers/outbox-drain.service.ts)', () => {
  function drain(pg: DbClient): OutboxDrainService {
    const pair = { primary: pg, replica: pg, close: async () => undefined } as DbClientPair;
    const registry = { dispatch: async () => undefined } as never;
    return new OutboxDrainService(new DatabaseService(pair), registry);
  }

  it('refused: a tick logs and ends, it does not throw out of the scheduler', async () => {
    const px = await proxy('refuse');
    const r = await timed(() => drain(pgClient(px.port)).drain());
    expect(r.error).toBeUndefined();
    expect(r.ms).toBeLessThan(SLACK_MS);
  });

  it('connected, then silent: a tick ends, so the next tick can run once the database is back (N6)', async () => {
    const pg = await frozen('pg');
    const service = drain(pgClient(pg.port));
    const r = await timed(() => service.drain());
    expect(r.error).toBeUndefined();
    expect(r.ms).toBeLessThan(STATEMENT_TIMEOUT_MS + QUERY_GRACE_MS + SLACK_MS);
    // `running` is the overlap guard: left set, every later tick returns at once and the outbox never drains again.
    expect((service as unknown as { running: boolean }).running).toBe(false);
  }, 20_000);
});

describe('error mapping (ProblemExceptionFilter)', () => {
  function respond(exception: unknown) {
    const out: {
      status?: number;
      body?: Record<string, unknown>;
      headers: Record<string, string>;
    } = {
      headers: {},
    };
    const response = {
      status: (c: number) => ((out.status = c), response),
      type: () => response,
      send: (b: Record<string, unknown>) => ((out.body = b), response),
      setHeader: (k: string, v: string) => void (out.headers[k] = v),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/v2/contacts', path: '/v2/contacts' }),
      }),
    };
    new ProblemExceptionFilter().catch(exception, host as never);
    return out;
  }

  it('a dead or silent database, Redis or queue is a 503 with a retry hint, never a 500', async () => {
    const px = await proxy('refuse');
    const refused = (await timed(() => select1(pgClient(px.port)))).error;
    const pg = await frozen('pg');
    const silent = (await timed(() => select1(pgClient(pg.port)))).error;
    const cases: unknown[] = [
      refused, // drizzle's wrapper around ECONNREFUSED
      silent, // node-postgres "Query read timeout"
      Object.assign(new Error('terminating connection due to administrator command'), {
        code: '57P01',
      }),
      new Error('Connection terminated unexpectedly'),
      new Error('timeout exceeded when trying to connect'),
      new Error('Connection is closed.'),
      new Error("Stream isn't writeable and enableOfflineQueue options is false"),
      new Error('Command timed out'),
    ];
    for (const err of cases) {
      const r = respond(err);
      expect(r.status, String(err)).toBe(503);
      expect(r.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
      expect(r.headers['Retry-After']).toBe('5');
      // The caller never sees an address, a role name or a driver message.
      expect(JSON.stringify(r.body)).not.toMatch(/127\.0\.0\.1|ECONN|crm_app_user|Connection/);
    }
  }, 20_000);

  it('an ordinary failure is still a 500 and a constraint error is not mistaken for an outage', () => {
    expect(respond(new Error('boom')).status).toBe(500);
    expect(respond(Object.assign(new Error('duplicate key'), { code: '23505' })).status).toBe(500);
  });
});
