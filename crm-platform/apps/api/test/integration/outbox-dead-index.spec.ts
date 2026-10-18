import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOutboxDeadIndex, runMigrations } from '@crm/db';

/**
 * The dead-event index on the partitioned event_outbox (ASYNC-048/050), against a real Postgres.
 *
 * A plain CREATE INDEX on the partitioned parent holds a SHARE lock on every partition while it scans, which blocks the writes of
 * every request that emits an event. Postgres refuses CONCURRENTLY on the parent, so a large table gets its index built partition by
 * partition by `buildOutboxDeadIndex`; the migration itself gives up after 3 seconds of waiting for the lock instead of stalling writers.
 */
const MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/migrations/20261227090300_outbox_dead_index.sql',
);

describe('outbox dead index', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let other: Client;

  const dropIndex = () => owner.query(`DROP INDEX IF EXISTS idx_outbox_dead`);
  const seed = (n: number, status = 'dead') =>
    owner.query(
      `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload, status)
       SELECT 1, 'm', g, 'e.t', '{}', $1 FROM generate_series(1, $2) g`,
      [status, n],
    );
  const state = async () =>
    (
      await owner.query<{ valid: boolean; children: number; invalidChildren: number }>(
        `SELECT p.indisvalid AS valid,
                (SELECT count(*)::int FROM pg_inherits WHERE inhparent = p.indexrelid) AS children,
                (SELECT count(*)::int FROM pg_inherits h JOIN pg_index c ON c.indexrelid = h.inhrelid
                  WHERE h.inhparent = p.indexrelid AND NOT c.indisvalid) AS "invalidChildren"
           FROM pg_index p JOIN pg_class x ON x.oid = p.indexrelid WHERE x.relname = 'idx_outbox_dead'`,
      )
    ).rows[0];
  const partitions = async () =>
    (
      await owner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_inherits WHERE inhparent = 'event_outbox'::regclass`,
      )
    ).rows[0]!.n;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    other = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await other.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../packages/db/migrations'),
      log: () => undefined,
    });
  }, 180_000);

  afterAll(async () => {
    await other?.end();
    await owner?.end();
    await container?.stop();
  });

  it('the migration builds a valid index on every partition', async () => {
    const s = await state();
    expect(s?.valid).toBe(true);
    expect(s?.children).toBe(await partitions());
  });

  it('builds the index per partition without a table lock, and the planner then uses it', async () => {
    await dropIndex();
    await seed(2000);
    await seed(5000, 'done');

    const out = await buildOutboxDeadIndex(owner);

    expect(out.built.length).toBe(await partitions());
    const s = await state();
    expect(s).toEqual({ valid: true, children: await partitions(), invalidChildren: 0 });
    await owner.query(`ANALYZE event_outbox`);
    const plan = await owner.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT 1 FROM event_outbox WHERE status = 'dead' LIMIT 10`,
    );
    expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toMatch(/_dead_idx/);
  });

  it('a second run changes nothing', async () => {
    expect((await buildOutboxDeadIndex(owner)).built).toEqual([]);
  });

  it('rebuilds a partition index that an interrupted build left invalid, and attaches everything', async () => {
    await dropIndex();
    // What a build killed half way leaves: the parent ON ONLY, and one partition index that is invalid and not attached.
    await owner.query(
      `CREATE INDEX idx_outbox_dead ON ONLY event_outbox (created_at) WHERE status = 'dead'`,
    );
    const first = (
      await owner.query<{ relname: string }>(
        `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = 'event_outbox'::regclass ORDER BY c.relname LIMIT 1`,
      )
    ).rows[0]!.relname;
    await owner.query(
      `CREATE INDEX ${first}_dead_idx ON ${first} (created_at) WHERE status = 'dead'`,
    );
    await owner.query(
      `UPDATE pg_index SET indisvalid = false WHERE indexrelid = '${first}_dead_idx'::regclass`,
    );

    const out = await buildOutboxDeadIndex(owner);

    expect(out.built).toContain(`${first}_dead_idx`);
    expect(await state()).toEqual({
      valid: true,
      children: await partitions(),
      invalidChildren: 0,
    });
  });

  it('the migration gives up after about 3 seconds when a writer holds the table, instead of stalling', async () => {
    await dropIndex();
    await other.query('BEGIN');
    await other.query(
      `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload) VALUES (1, 'm', 1, 'e.t', '{}')`,
    );
    const started = Date.now();
    await owner.query('BEGIN');
    try {
      await expect(owner.query(readFileSync(MIGRATION, 'utf8'))).rejects.toThrow(/lock timeout/);
    } finally {
      await owner.query('ROLLBACK');
      await other.query('ROLLBACK');
    }
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
