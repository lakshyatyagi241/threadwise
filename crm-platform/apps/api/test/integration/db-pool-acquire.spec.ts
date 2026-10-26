import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient } from '@crm/db';

/**
 * Sheet 3 D-07, against a real Postgres: every pool checkout is timed (`onAcquire`), which is what `crm_db_pool_acquire_seconds` and the
 * "pool wait p95 under 5 ms" target are built on. Rerun with
 * `pnpm --filter @crm/api exec vitest run test/integration/db-pool-acquire.spec.ts --testTimeout=120000` (needs Docker).
 */
let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').withDatabase('crm').start();
}, 120_000);
afterAll(async () => {
  await container.stop();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const p = (xs: number[], q: number) =>
  [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)] ?? 0;

function client(poolMax: number, waits: number[], poolName = 'primary') {
  return createDbClient({
    url: container.getConnectionUri(),
    poolMax,
    poolName,
    onAcquire: (ms) => waits.push(ms),
  });
}

describe('pool checkout timing', () => {
  it('times pool.connect and pool.query checkouts, with the pool name', async () => {
    const seen: [number, string][] = [];
    const c = createDbClient({
      url: container.getConnectionUri(),
      poolMax: 2,
      poolName: 'webhook',
      onAcquire: (ms, name) => seen.push([ms, name]),
    });
    try {
      const conn = await c.pool.connect(); // promise form
      conn.release();
      await c.pool.query('select 1'); // callback form used inside node-postgres
      expect(seen.length).toBe(2);
      expect(seen.every(([ms, name]) => ms >= 0 && name === 'webhook')).toBe(true);
    } finally {
      await c.close();
    }
  });

  it('a failed checkout (nothing listening) is timed too', async () => {
    const seen: number[] = [];
    const c = createDbClient({
      url: 'postgres://nobody@127.0.0.1:1/none',
      poolMax: 1,
      onAcquire: (ms) => seen.push(ms),
    });
    try {
      await expect(c.pool.connect()).rejects.toThrow();
      expect(seen.length).toBe(1);
    } finally {
      await c.close();
    }
  });

  it('a pool with free connections hands them out in under 5 ms at p95 (warm), and a saturated pool shows the wait', async () => {
    const waits: number[] = [];
    const c = client(4, waits);
    try {
      await Promise.all([1, 2, 3, 4].map(() => c.pool.query('select pg_sleep(0.05)'))); // open the 4 connections
      waits.length = 0;
      for (let i = 0; i < 200; i++) await c.pool.query('select 1'); // one caller at a time: always an idle connection
      expect(waits.length).toBe(200);
      expect(p(waits, 0.95)).toBeLessThan(5);

      // saturate: hold all 4 for 200 ms, a fifth caller must wait about that long
      const held = await Promise.all([1, 2, 3, 4].map(() => c.pool.connect()));
      waits.length = 0;
      const fifth = c.pool.connect();
      expect(c.pool.waitingCount).toBe(1); // what crm_db_pool_waiting shows
      await sleep(200);
      held[0]!.release();
      (await fifth).release();
      held.slice(1).forEach((h) => h.release());
      expect(waits[0]).toBeGreaterThanOrEqual(180);
    } finally {
      await c.close();
    }
  }, 30_000);

  it('pool size against concurrency: wait p95 for 24 concurrent callers each doing 100 x 3 ms queries', async () => {
    // Evidence for docs/performance/db/pool-and-pgbouncer.md (printed, with loose bounds so it stays stable on a slow runner).
    const rows: string[] = [];
    const out: Record<number, number> = {};
    for (const max of [4, 8, 12, 24]) {
      const waits: number[] = [];
      const c = client(max, waits);
      try {
        await Promise.all(Array.from({ length: max }, () => c.pool.query('select pg_sleep(0.05)')));
        waits.length = 0;
        await Promise.all(
          Array.from({ length: 24 }, async () => {
            for (let i = 0; i < 100; i++) await c.pool.query('select pg_sleep(0.003)');
          }),
        );
        out[max] = p(waits, 0.95);
        rows.push(
          `pool ${String(max).padStart(2)}: ${waits.length} checkouts, wait p50 ${p(waits, 0.5).toFixed(2)} ms, p95 ${out[max]!.toFixed(2)} ms, p99 ${p(waits, 0.99).toFixed(2)} ms`,
        );
      } finally {
        await c.close();
      }
    }
    console.log(['[D-07] 24 concurrent callers, 3 ms queries:', ...rows].join('\n'));
    expect(out[24]!).toBeLessThan(5); // a pool as large as the concurrency never queues
    expect(out[4]!).toBeGreaterThan(out[24]!); // a small pool queues
  }, 120_000);
});
