import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The analytics event store and rollup tables against a real Postgres, as the restricted application role (a superuser would bypass every
 * policy and make the isolation assertions vacuous).
 */
describe('analytics tables: partitions, RLS and the watermark', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;

  async function inTx<T>(setup: string[], fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      for (const stmt of setup) await app.query(stmt);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  const asOrg = <T>(orgId: number, fn: () => Promise<T>) =>
    inTx([`SELECT set_config('app.org_id', '${orgId}', true)`], fn);
  const asPrivileged = <T>(fn: () => Promise<T>) =>
    inTx([`SELECT set_config('app.privileged', 'on', true)`], fn);

  const insertEvent = (org: number) =>
    app.query(
      `INSERT INTO an_events (org_id, type, occurred_at) VALUES ($1, 3, now()) RETURNING id`,
      [org],
    );

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
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    const org = async (slug: string) =>
      Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            slug,
          ])
        ).rows[0].id,
      );
    orgA = await org('an-a');
    orgB = await org('an-b');
    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
  }, 300_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  it('an_events is range partitioned with a default partition and monthly partitions ahead', async () => {
    const kind = await owner.query(`SELECT relkind FROM pg_class WHERE relname = 'an_events'`);
    expect(kind.rows[0].relkind).toBe('p');
    const children = await owner.query(
      `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'an_events'::regclass ORDER BY c.relname`,
    );
    const names = children.rows.map((r) => r.relname as string);
    expect(names).toContain('an_events_default');
    expect(names.filter((n) => /^an_events_\d{6}$/.test(n)).length).toBeGreaterThanOrEqual(4);
  });

  it('forces RLS on every analytics table and gives every events partition its own policy', async () => {
    const tables = await owner.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname IN ('an_events','an_rollup_hour','an_rollup_day','an_rollup_state') ORDER BY relname`,
    );
    expect(tables.rows).toHaveLength(4);
    for (const r of tables.rows) {
      expect(r, r.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    }
    const parts = await owner.query(
      `SELECT c.relname, c.relforcerowsecurity,
              EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname) AS has_policy
         FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'an_events'::regclass`,
    );
    for (const r of parts.rows) {
      expect(r, r.relname).toMatchObject({ relforcerowsecurity: true, has_policy: true });
    }
  });

  it('isolates events by tenant: own rows only, foreign inserts refused, privileged sees all', async () => {
    await owner.query(
      `INSERT INTO an_events (org_id, type, occurred_at) VALUES ($1, 3, now()), ($2, 3, now())`,
      [orgA, orgB],
    );
    await asOrg(orgA, async () => {
      expect((await insertEvent(orgA)).rowCount).toBe(1);
    });
    await expect(asOrg(orgA, () => insertEvent(orgB))).rejects.toMatchObject({ code: '42501' });
    const mine = await asOrg(orgA, () => app.query(`SELECT DISTINCT org_id FROM an_events`));
    expect(mine.rows.map((r) => Number(r.org_id))).toEqual([orgA]);
    const none = await inTx([], () => app.query(`SELECT 1 FROM an_events`));
    expect(none.rowCount).toBe(0);
    const all = await asPrivileged(() =>
      app.query(`SELECT DISTINCT org_id FROM an_events ORDER BY 1`),
    );
    expect(all.rows.map((r) => Number(r.org_id))).toEqual([orgA, orgB]);
  });

  it('keeps platform rollup rows (org_id 0) invisible to tenants and visible when privileged', async () => {
    await owner.query(
      `INSERT INTO an_rollup_day (org_id, metric, bucket, n) VALUES (0, 1, '2026-10-01', 7), ($1, 1, '2026-10-01', 3)`,
      [orgA],
    );
    const tenant = await asOrg(orgA, () =>
      app.query(`SELECT org_id, n FROM an_rollup_day ORDER BY org_id`),
    );
    expect(tenant.rows.map((r) => Number(r.org_id))).toEqual([orgA]);
    const priv = await asPrivileged(() =>
      app.query(`SELECT org_id FROM an_rollup_day ORDER BY org_id`),
    );
    expect(priv.rows.map((r) => Number(r.org_id))).toEqual([0, orgA]);
  });

  it('seeds one watermark row that every tenant can read and only a privileged transaction can move', async () => {
    const state = await asOrg(orgA, () => app.query(`SELECT name FROM an_rollup_state`));
    expect(state.rows.map((r) => r.name)).toEqual(['main']);
    const upd = await asOrg(orgA, () =>
      app.query(`UPDATE an_rollup_state SET recorded_before = now()`),
    );
    expect(upd.rowCount).toBe(0);
    await expect(
      asOrg(orgA, () =>
        app.query(`INSERT INTO an_rollup_state (name, recorded_before) VALUES ('x', now())`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const priv = await asPrivileged(() =>
      app.query(`UPDATE an_rollup_state SET recorded_before = recorded_before WHERE name = 'main'`),
    );
    expect(priv.rowCount).toBe(1);
  });

  it('has no foreign keys on the stream, and the primary key is (id, recorded_at)', async () => {
    const fks = await owner.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'an_events'::regclass AND contype = 'f'`,
    );
    expect(fks.rowCount).toBe(0);
    const pk = await owner.query(
      `SELECT array_agg(a.attname::text ORDER BY k.ord) AS cols
         FROM pg_constraint c
         CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.conrelid = 'an_events'::regclass AND c.contype = 'p'`,
    );
    expect(pk.rows[0].cols).toEqual(['id', 'recorded_at']);
  });
});
