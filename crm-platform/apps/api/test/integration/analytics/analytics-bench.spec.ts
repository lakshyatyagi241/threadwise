import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { METRIC } from '@crm/contracts';
import { createDbClient, runMigrations, withPrivileged, withTenant, type DbClient } from '@crm/db';
import { AnalyticsEvents } from '../../../src/kernel/analytics/analytics-events.service';
import { AnalyticsQueryService } from '../../../src/modules/analytics/query/analytics-query.service';
import {
  RollupService,
  type Privileged,
} from '../../../src/modules/analytics/rollup/rollup.service';

/**
 * Phase 0 benchmark and decision gate (docs/superpowers/plans/2026-10-16-event-based-analytics-phase0.md, task A10).
 * Skipped unless ANALYTICS_BENCH=1. Runs against a Postgres limited to 1 GB of memory and 256 MB shared buffers, like production.
 * The results table is printed; copy it into docs/performance/analytics/phase0-bench.md.
 */
const RUN = process.env.ANALYTICS_BENCH === '1';

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

describe.skipIf(!RUN)('analytics phase 0 benchmark', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: DbClient;
  const results: Record<string, number | string> = {};

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .withCommand([
        'postgres',
        '-c',
        'shared_buffers=256MB',
        '-c',
        'max_connections=100',
        '-c',
        'work_mem=4MB',
      ])
      .withResourcesQuota({ memory: 1, cpu: 2 })
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    await owner.query(
      `CREATE TABLE zz_biz (org_id bigint NOT NULL, id bigserial PRIMARY KEY, n int NOT NULL)`,
    );
    await owner.query(`GRANT ALL ON zz_biz TO crm_app_user`);
    await owner.query(`GRANT USAGE, SELECT ON SEQUENCE zz_biz_id_seq TO crm_app_user`);
    app = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
  }, 300_000);

  afterAll(async () => {
    console.table(results);
    await app?.close();
    await owner?.end();
    await container?.stop();
  });

  const timeTxs = async (n: number, withEvent: AnalyticsEvents | null): Promise<number[]> => {
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const start = performance.now();
      await withTenant(app.db, { orgId: 7 }, async (tx) => {
        await tx.execute(
          (await import('drizzle-orm')).sql`INSERT INTO zz_biz (org_id, n) VALUES (7, ${i})`,
        );
        if (withEvent)
          await withEvent.record(tx, { type: 3, orgId: 7, channelKind: 1, campaignId: 9 });
      });
      out.push(performance.now() - start);
    }
    return out;
  };

  it('writer overhead per event, with and without the savepoint', async () => {
    const savepointOn = new AnalyticsEvents();
    const savepointOff = new AnalyticsEvents({
      get: (k: string) => (k === 'ANALYTICS_EVENT_SAVEPOINT' ? false : true),
    } as never);
    await timeTxs(300, null); // warm up
    const trips: number[] = [];
    for (let i = 0; i < 500; i += 1) {
      const t = performance.now();
      await app.pool.query('SELECT 1');
      trips.push(performance.now() - t);
    }
    results['one query round trip p50 ms'] = round(pct(trips, 0.5));
    const base = await timeTxs(3000, null);
    const on = await timeTxs(3000, savepointOn);
    const off = await timeTxs(3000, savepointOff);
    results['tx p50 ms, no event'] = round(pct(base, 0.5));
    results['tx p95 ms, no event'] = round(pct(base, 0.95));
    results['overhead p50 ms, savepoint on'] = round(pct(on, 0.5) - pct(base, 0.5));
    results['overhead p95 ms, savepoint on'] = round(pct(on, 0.95) - pct(base, 0.95));
    results['overhead p50 ms, savepoint off'] = round(pct(off, 0.5) - pct(base, 0.5));
    results['overhead p95 ms, savepoint off'] = round(pct(off, 0.95) - pct(base, 0.95));
    expect(savepointOn.stats().failures).toBe(0);
  }, 900_000);

  it('bulk insert throughput through recordMany', async () => {
    const writer = new AnalyticsEvents();
    const before = Number((await owner.query(`SELECT count(*) AS n FROM an_events`)).rows[0].n);
    // All events belong to the tenant the transaction is scoped to; another org would be refused by row-level security.
    const batch = Array.from({ length: 500 }, () => ({
      type: 3 as const,
      orgId: 7,
      channelKind: 1,
    }));
    const start = performance.now();
    for (let b = 0; b < 200; b += 1) {
      await withTenant(app.db, { orgId: 7 }, (tx) => writer.recordMany(tx, batch));
    }
    const seconds = (performance.now() - start) / 1000;
    results['recordMany events per second'] = Math.round(100_000 / seconds);
    expect(writer.stats().failures).toBe(0);
    const after = Number((await owner.query(`SELECT count(*) AS n FROM an_events`)).rows[0].n);
    expect(after - before).toBe(100_000);
    await owner.query('TRUNCATE an_events');
  }, 900_000);

  it('rolls up an hour of design-target traffic, then a steady-state minute', async () => {
    const priv: Privileged = { privileged: (fn) => withPrivileged(app.db, fn) };
    const svc = new RollupService(priv);
    await owner.query('TRUNCATE an_events');
    await owner.query('TRUNCATE an_rollup_hour, an_rollup_day');
    const start = new Date(Date.now() - 2 * 3_600_000);
    await owner.query(`UPDATE an_rollup_state SET recorded_before = $1 WHERE name = 'main'`, [
      new Date(start.getTime() - 60_000).toISOString(),
    ]);
    await owner.query(
      `INSERT INTO an_events (org_id, type, recorded_at, occurred_at, channel_kind, source_kind, campaign_id)
       SELECT 1 + (g % 200), (ARRAY[1,2,3,4,5,6])[1 + (g % 6)],
              $1::timestamptz + g * interval '28.8 milliseconds', $1::timestamptz + g * interval '28.8 milliseconds',
              1 + (g % 3), 1 + (g % 2), CASE WHEN g % 3 = 0 THEN 1 + (g % 50) END
         FROM generate_series(1, 125000) g`,
      [start.toISOString()],
    );
    await owner.query('ANALYZE an_events');
    const t0 = performance.now();
    const pass = await svc.runOnce();
    results['catch-up 125k events, ms'] = Math.round(performance.now() - t0);
    results['catch-up slices'] = pass?.slices ?? 0;
    const rolled = Number(
      (
        await owner.query(
          `SELECT sum(n) AS n FROM an_rollup_day WHERE metric = $1 AND org_id <> 0`,
          [METRIC.MSG_COUNT],
        )
      ).rows[0].n,
    );
    expect(rolled).toBe(125_000);

    // One minute at the design target is about 2,100 events, recorded a bit more than the lag ago.
    await owner.query(
      `INSERT INTO an_events (org_id, type, occurred_at, recorded_at, channel_kind, source_kind)
       SELECT 1 + (g % 200), 3, now(), now() - interval '90 seconds' + g * interval '10 milliseconds', 1, 1
         FROM generate_series(1, 2100) g`,
    );
    const t1 = performance.now();
    await svc.runOnce();
    results['steady-state pass 2.1k events, ms'] = Math.round(performance.now() - t1);
  }, 900_000);

  it('answers a month of one busy workspace from the rollups', async () => {
    await owner.query(
      `INSERT INTO an_rollup_day (org_id, metric, bucket, d1, d2, d3, n)
       SELECT o, 1, current_date - d, t, c, s, 100 + ((o + d + t + c + s) % 50)
         FROM generate_series(1, 200) o, generate_series(0, 89) d, generate_series(1, 6) t,
              generate_series(1, 3) c, generate_series(1, 2) s
       ON CONFLICT DO NOTHING`,
    );
    await owner.query(
      `INSERT INTO an_rollup_hour (org_id, metric, bucket, d1, d2, n)
       SELECT o, 1, date_trunc('day', now()) - d * interval '1 day' + h * interval '1 hour', t, c, 10 + ((o + d + h) % 20)
         FROM generate_series(1, 200) o, generate_series(0, 13) d, generate_series(0, 23) h,
              generate_series(1, 6) t, generate_series(1, 3) c
       ON CONFLICT DO NOTHING`,
    );
    await owner.query('ANALYZE an_rollup_day');
    await owner.query('ANALYZE an_rollup_hour');
    // About 90 seconds of unrolled events for this workspace, so the read includes a live tail.
    await owner.query(
      `INSERT INTO an_events (org_id, type, occurred_at, channel_kind, source_kind)
       SELECT 7, 3, now(), 1, 1 FROM generate_series(1, 50)`,
    );

    const q = new AnalyticsQueryService();
    const from30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const day: number[] = [];
    const hour: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const a = performance.now();
      await withTenant(app.db, { orgId: 7 }, (tx) =>
        q.series(tx, { orgId: 7, metric: METRIC.MSG_COUNT, grain: 'day', from: from30, to }),
      );
      day.push(performance.now() - a);
      const b = performance.now();
      await withTenant(app.db, { orgId: 7 }, (tx) =>
        q.series(tx, {
          orgId: 7,
          metric: METRIC.MSG_COUNT,
          grain: 'hour',
          from: new Date(Date.now() - 7 * 86_400_000).toISOString(),
          to: new Date(Date.now() + 86_400_000).toISOString(),
          groupBy: ['bucket', 'd1'],
        }),
      );
      hour.push(performance.now() - b);
    }
    results['series 30 days (day grain) p50 ms'] = round(pct(day, 0.5));
    results['series 30 days (day grain) p95 ms'] = round(pct(day, 0.95));
    results['series 7 days (hour grain, by type) p50 ms'] = round(pct(hour, 0.5));
    results['series 7 days (hour grain, by type) p95 ms'] = round(pct(hour, 0.95));
  }, 900_000);

  it('reports storage per event', async () => {
    const r = await owner.query(
      `SELECT sum(pg_total_relation_size(c.oid))::bigint AS bytes, sum(c.reltuples)::bigint AS rows
         FROM pg_class c WHERE c.relname ~ '^an_events_' AND c.relkind = 'r'`,
    );
    const events = Number((await owner.query(`SELECT count(*) AS n FROM an_events`)).rows[0].n);
    results['an_events rows'] = events;
    results['an_events bytes per event (with indexes)'] = Math.round(
      Number(r.rows[0].bytes) / events,
    );
    const rollups = await owner.query(
      `SELECT pg_total_relation_size('an_rollup_day') + pg_total_relation_size('an_rollup_hour') AS bytes`,
    );
    results['rollup tables MB'] = Math.round(Number(rollups.rows[0].bytes) / 1_048_576);
    expect(events).toBeGreaterThan(0);
  }, 300_000);
});
