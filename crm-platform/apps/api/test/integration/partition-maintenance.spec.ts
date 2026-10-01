import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../src/infra/db/database.service';
import { PartitionMaintenanceService } from '../../src/workers/partition-maintenance.service';

/**
 * Partition maintenance against a real Postgres.
 *
 * The claim under test: the job finds partitioned tables in the catalog, so a
 * stream added by a migration is kept ahead of the clock the day it is created,
 * with nobody editing a list in application code. If it only knew the two
 * tables it was originally written for, every later stream would run out of
 * partitions and silently fill its `_default` partition.
 *
 * The service runs as `crm_app_user`, the role the worker really connects as.
 * That role owns no table and cannot create one, so partition creation only
 * works through the SECURITY DEFINER ensure_monthly_partition (ADR-0021).
 * Running as the owner here would pass for any partition-creating code,
 * including code that can only ever work on a laptop.
 */
describe('partition maintenance', () => {
  let container: StartedPostgreSqlContainer;
  /** Owner connection: runs migrations and creates tables the way a migration would. */
  let owner: Client;
  /** The application role. Everything under test runs on this. */
  let app: Client;
  let clients: DbClientPair;
  let service: PartitionMaintenanceService;

  const appUrl = () =>
    `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`;

  /** Rows the app role sees in `relation` with the given tenant context, as a request would. */
  async function countAs(orgId: number | null, relation: string): Promise<number> {
    await app.query('BEGIN');
    try {
      if (orgId !== null) {
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      }
      const { rows } = await app.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${relation}`);
      return rows[0]!.n;
    } finally {
      await app.query('ROLLBACK');
    }
  }

  /** Calls the function the way the worker does and returns the error text, or null. */
  async function callAs(client: Client, parent: string, at: string): Promise<string | null> {
    try {
      await client.query(`SELECT ensure_monthly_partition($1::regclass, $2::date)`, [parent, at]);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }

  /** `YYYYMM` of the month `offset` months from now, as the database sees it. */
  async function month(offset: number): Promise<string> {
    const { rows } = await owner.query<{ m: string }>(
      `SELECT to_char(date_trunc('month', now()) + make_interval(months => $1), 'YYYYMM') AS m`,
      [offset],
    );
    return rows[0]!.m;
  }

  async function partitionsOf(parent: string): Promise<string[]> {
    const { rows } = await owner.query<{ name: string }>(
      `SELECT child.relname AS name FROM pg_inherits i
       JOIN pg_class child ON child.oid = i.inhrelid
       JOIN pg_class par ON par.oid = i.inhparent
       WHERE par.relname = $1 ORDER BY child.relname`,
      [parent],
    );
    return rows.map((r) => r.name);
  }

  async function rangeParents(): Promise<string[]> {
    const { rows } = await owner.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_partitioned_table p JOIN pg_class c ON c.oid = p.partrelid
       WHERE c.relnamespace = 'public'::regnamespace AND NOT c.relispartition AND p.partstrat = 'r'`,
    );
    return rows.map((r) => r.name);
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../packages/db/migrations'),
      log: () => undefined,
    });

    app = new Client({ connectionString: appUrl() });
    await app.connect();
    clients = createDbClientPair({ url: appUrl(), poolMax: 2 });
    service = new PartitionMaintenanceService(new DatabaseService(clients));
  }, 180_000);

  afterAll(async () => {
    await clients?.close();
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  it('keeps event_outbox and audit_log three months ahead, as before', async () => {
    const ahead = await month(3);
    // Migrations bootstrap previous, current and the next two months only.
    expect(await partitionsOf('event_outbox')).not.toContain(`event_outbox_${ahead}`);

    await service.ensurePartitions();

    for (const table of ['event_outbox', 'audit_log']) {
      const partitions = await partitionsOf(table);
      for (let offset = 0; offset <= 3; offset += 1) {
        expect(partitions).toContain(`${table}_${await month(offset)}`);
      }
      expect(partitions).toContain(`${table}_default`);
    }
  });

  it('covers every stream the schema migrations created, not just the two it started with', async () => {
    const ahead = await month(3);
    const parents = await rangeParents();
    // event_outbox, audit_log and the 17 Reference streams.
    expect(parents.length).toBeGreaterThanOrEqual(19);
    expect(parents).toEqual(expect.arrayContaining(['messages', 'usage_charges']));

    await service.ensurePartitions();

    const missing: string[] = [];
    for (const parent of parents) {
      if (!(await partitionsOf(parent)).includes(`${parent}_${ahead}`)) missing.push(parent);
    }
    expect(missing).toEqual([]);
  });

  it('picks up a partitioned table created after the service was written, and gives it next month', async () => {
    await owner.query(`
      CREATE SEQUENCE brand_new_stream_id_seq;
      CREATE TABLE brand_new_stream (
        org_id bigint NOT NULL,
        id bigint NOT NULL DEFAULT nextval('brand_new_stream_id_seq'),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (id, created_at)
      ) PARTITION BY RANGE (created_at);
    `);
    expect(await partitionsOf('brand_new_stream')).toEqual([]);

    await service.ensurePartitions();

    const partitions = await partitionsOf('brand_new_stream');
    expect(partitions).toContain(`brand_new_stream_${await month(1)}`);
    expect(partitions).toEqual(
      await Promise.all([0, 1, 2, 3].map(async (n) => `brand_new_stream_${await month(n)}`)),
    );
  });

  it('is idempotent: a second run changes nothing and does not fail', async () => {
    const before = await partitionsOf('brand_new_stream');
    await service.ensurePartitions();
    expect(await partitionsOf('brand_new_stream')).toEqual(before);
  });

  it('leaves alone tables it cannot or should not create monthly partitions for', async () => {
    await owner.query(`
      CREATE TABLE hash_bucketed (id bigint NOT NULL, org_id bigint NOT NULL) PARTITION BY HASH (org_id);
      CREATE TABLE hash_bucketed_0 PARTITION OF hash_bucketed FOR VALUES WITH (MODULUS 2, REMAINDER 0);
      CREATE TABLE hash_bucketed_1 PARTITION OF hash_bucketed FOR VALUES WITH (MODULUS 2, REMAINDER 1);
      CREATE TABLE plain_table (id bigint PRIMARY KEY);
    `);
    // A sub-partitioned child: it is a partition AND partitioned, so it is not a parent.
    await owner.query(`
      CREATE TABLE nested_stream (id bigint NOT NULL, created_at timestamptz NOT NULL)
        PARTITION BY RANGE (created_at);
      CREATE TABLE nested_stream_2020 PARTITION OF nested_stream
        FOR VALUES FROM ('2020-01-01') TO ('2021-01-01') PARTITION BY RANGE (created_at);
    `);

    await service.ensurePartitions();

    expect(await partitionsOf('hash_bucketed')).toEqual(['hash_bucketed_0', 'hash_bucketed_1']);
    expect(await partitionsOf('nested_stream_2020')).toEqual([]);
    // the real parent is still maintained
    expect(await partitionsOf('nested_stream')).toContain(`nested_stream_${await month(3)}`);
  });

  it('one table that cannot be maintained does not stop the others', async () => {
    // Tables are processed in name order, so one on each side of the failing one
    // shows that neither the earlier work was rolled back nor the later work skipped.
    // The failing one has a RANGE key that is not a date, which ensure_monthly_partition rejects.
    await owner.query(`
      CREATE TABLE before_failing (id bigint NOT NULL, created_at timestamptz NOT NULL)
        PARTITION BY RANGE (created_at);
      CREATE TABLE numeric_ranged (id bigint NOT NULL) PARTITION BY RANGE (id);
      CREATE TABLE trailing_stream (id bigint NOT NULL, created_at timestamptz NOT NULL)
        PARTITION BY RANGE (created_at);
    `);

    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let logged: unknown[][];
    try {
      await service.ensurePartitions();
    } finally {
      // mockRestore() clears the recorded calls, so read them first
      logged = [...spy.mock.calls];
      spy.mockRestore();
    }

    // named in the log, so the failure is visible rather than swallowed
    expect(logged).toEqual([
      [expect.objectContaining({ table: 'numeric_ranged' }), expect.any(String)],
    ]);
    for (const table of ['before_failing', 'trailing_stream', 'event_outbox', 'audit_log']) {
      expect(await partitionsOf(table)).toContain(`${table}_${await month(3)}`);
    }
    expect(await partitionsOf('numeric_ranged')).toEqual([]);
    // it would fail, and log, on every later run in this file
    await owner.query(`DROP TABLE numeric_ranged`);
  });

  it('reports rows sitting in default partitions as the app role, and only for tables that have one', async () => {
    await owner.query(`
      CREATE TABLE strays (id bigint NOT NULL, created_at timestamptz NOT NULL)
        PARTITION BY RANGE (created_at);
      CREATE TABLE strays_default PARTITION OF strays DEFAULT;
      INSERT INTO strays VALUES (1, '2040-06-15'), (2, '2040-07-15');
    `);

    const counts = await service.defaultPartitionCounts();

    expect(counts['strays']).toBe(2);
    // the 0006 default partitions: the app role could not read these before 20261001110100
    expect(counts['event_outbox']).toBe(0);
    expect(counts['audit_log']).toBe(0);
    // brand_new_stream was created with no default partition: nothing to count, and no error.
    expect(counts).not.toHaveProperty('brand_new_stream');
  });

  it('warns after a run while rows are sitting in a default partition', async () => {
    const spy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let warned: unknown[][];
    try {
      await service.ensurePartitions();
    } finally {
      warned = [...spy.mock.calls];
      spy.mockRestore();
    }

    expect(warned).toEqual([
      [{ defaultPartitionRows: { strays: 2 } }, expect.stringContaining('default partitions')],
    ]);
  });

  it('stops warning once the default partitions are empty', async () => {
    await owner.query(`TRUNCATE strays`);
    const spy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await service.ensurePartitions();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('creates partitions owned by the table owner, not by the role that asked', async () => {
    const { rows } = await owner.query<{ owner: string }>(
      `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname = $1`,
      [`brand_new_stream_${await month(3)}`],
    );
    expect(rows[0]!.owner).toBe('crm');
  });

  it("a partition enforces its parent's tenant policy when queried directly", async () => {
    await owner.query(`
      CREATE TABLE tenant_stream (
        org_id bigint NOT NULL, id bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      ) PARTITION BY RANGE (created_at);
      ALTER TABLE tenant_stream ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tenant_stream FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON tenant_stream FOR ALL
        USING (org_id = current_org_id() OR app_is_privileged())
        WITH CHECK (org_id = current_org_id() OR app_is_privileged());
    `);
    await service.ensurePartitions();
    // the owner is a superuser, so this seeds across tenants regardless of policy
    await owner.query(`INSERT INTO tenant_stream (org_id, id) VALUES (1, 1), (1, 2), (2, 3)`);
    const partition = `tenant_stream_${await month(0)}`;

    expect(await countAs(1, partition)).toBe(2);
    expect(await countAs(2, partition)).toBe(1);
    // no tenant context fails closed, as on the parent
    expect(await countAs(null, partition)).toBe(0);
    expect(await countAs(1, 'tenant_stream')).toBe(2);
  });

  it('the partitions a migration bootstrapped are readable by the app role and tenant-filtered', async () => {
    // before 20261001110100 these were not granted to crm_app at all
    for (const relation of ['event_outbox_default', 'audit_log_default']) {
      expect(await countAs(null, relation), relation).toBe(0);
    }
    const { rows } = await owner.query<{ forced: boolean }>(
      `SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname = $1`,
      [`event_outbox_${await month(0)}`],
    );
    expect(rows[0]!.forced).toBe(true);
  });

  it('leaves the partitions of a parent without RLS open, like the parent', async () => {
    const { rows } = await owner.query<{ rls: boolean }>(
      `SELECT relrowsecurity AS rls FROM pg_class WHERE relname = $1`,
      [`brand_new_stream_${await month(3)}`],
    );
    expect(rows[0]!.rls).toBe(false);
  });

  it('two workers starting together do not collide on the same partition', async () => {
    await owner.query(`
      CREATE TABLE contended_stream (id bigint NOT NULL, created_at timestamptz NOT NULL)
        PARTITION BY RANGE (created_at);
    `);

    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let logged: unknown[][];
    try {
      await Promise.all([service.ensurePartitions(), service.ensurePartitions()]);
    } finally {
      logged = [...spy.mock.calls];
      spy.mockRestore();
    }

    expect(logged).toEqual([]);
    expect(await partitionsOf('contended_stream')).toHaveLength(4);
  });

  describe('ensure_monthly_partition as the runtime role', () => {
    it('is the only way in: the role cannot create a partition itself', async () => {
      await expect(
        app.query(
          `CREATE TABLE public.event_outbox_203001 PARTITION OF event_outbox
             FOR VALUES FROM ('2030-01-01') TO ('2030-02-01')`,
        ),
      ).rejects.toThrow(/permission denied|must be owner/i);
    });

    it('refuses anything that is not a range-partitioned table in public', async () => {
      await owner.query(`
        CREATE SCHEMA elsewhere;
        GRANT USAGE ON SCHEMA elsewhere TO crm_app;
        CREATE TABLE elsewhere.other_stream (id bigint NOT NULL, created_at timestamptz NOT NULL)
          PARTITION BY RANGE (created_at);
        CREATE TABLE refused_hash (id bigint NOT NULL) PARTITION BY HASH (id);
      `);
      const today = new Date().toISOString().slice(0, 10);
      for (const parent of [
        'contacts', // a plain tenant table
        'refused_hash', // partitioned, but not RANGE
        'event_outbox_default', // a partition, not a parent
        'elsewhere.other_stream', // RANGE, wrong schema
      ]) {
        expect(await callAs(app, parent, today), parent).toMatch(
          /not a range-partitioned table in schema public/,
        );
      }
      expect(await partitionsOf('other_stream')).toEqual([]);
    });

    it('refuses months far outside the window around now', async () => {
      for (const at of ['1990-01-01', '2999-01-01']) {
        expect(await callAs(app, 'event_outbox', at), at).toMatch(/outside the allowed window/);
      }
    });

    it('is not callable by a role that is not one of the runtime groups', async () => {
      await owner.query(`CREATE ROLE stranger LOGIN PASSWORD 'test'`);
      const stranger = new Client({
        connectionString: `postgres://stranger:test@${container.getHost()}:${container.getPort()}/crm`,
      });
      await stranger.connect();
      try {
        expect(await callAs(stranger, 'event_outbox', '2026-10-01')).toMatch(
          /permission denied for function ensure_monthly_partition/,
        );
      } finally {
        await stranger.end();
      }
    });
  });
});
