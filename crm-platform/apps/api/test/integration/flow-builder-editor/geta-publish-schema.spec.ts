import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The Geta publishing tables against a real Postgres, as the restricted application role (a superuser bypasses every policy and
 * would make the isolation assertions vacuous). Constraint checks use the owner connection: owners skip RLS but never CHECK,
 * UNIQUE or FK.
 */
describe('geta publishing: schema, constraints and isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let flowA: number;
  let flowB: number;

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
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    const one = async (sql: string, p: unknown[] = []) =>
      Number((await owner.query(sql, p)).rows[0].id);
    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('ga','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('gb','B','starter') RETURNING id`,
    );
    flowA = await one(`INSERT INTO flows (org_id, flow_name) VALUES ($1,'Flow A') RETURNING id`, [
      orgA,
    ]);
    flowB = await one(`INSERT INTO flows (org_id, flow_name) VALUES ($1,'Flow B') RETURNING id`, [
      orgB,
    ]);
    await owner.query(
      `INSERT INTO flb_geta_publish_settings (org_id, base_url, authorization_enc) VALUES ($1,'https://a.example.test','sealed-a'), ($2,'https://b.example.test','sealed-b')`,
      [orgA, orgB],
    );
    await owner.query(
      `INSERT INTO flb_geta_publish_syncs (org_id, flow_id, state) VALUES ($1,$2,'pending'), ($3,$4,'live')`,
      [orgA, flowA, orgB, flowB],
    );
    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
  }, 180_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  async function asOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  const rejects = (sql: string, params: unknown[], pattern: RegExp) =>
    expect(owner.query(sql, params)).rejects.toThrow(pattern);

  it('RLS is enabled and forced with a tenant_isolation policy on both tables', async () => {
    for (const table of ['flb_geta_publish_settings', 'flb_geta_publish_syncs']) {
      const res = await owner.query(
        `SELECT relrowsecurity, relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = $1 AND p.policyname = 'tenant_isolation')::int AS policies
           FROM pg_class WHERE relname = $1 AND relkind = 'r'`,
        [table],
      );
      expect(res.rows[0], table).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        policies: 1,
      });
    }
  });

  it('a workspace sees only its own settings and sync rows, even when the other ids are known', async () => {
    const own = await asOrg(
      orgA,
      async () => (await app.query(`SELECT base_url FROM flb_geta_publish_settings`)).rows,
    );
    expect(own.map((r) => r.base_url)).toEqual(['https://a.example.test']);
    const syncs = await asOrg(
      orgA,
      async () => (await app.query(`SELECT flow_id FROM flb_geta_publish_syncs`)).rows,
    );
    expect(syncs.map((r) => Number(r.flow_id))).toEqual([flowA]);
    const other = await asOrg(
      orgA,
      async () =>
        (
          await app.query(
            `SELECT 1 FROM flb_geta_publish_syncs WHERE org_id = $1 AND flow_id = $2`,
            [orgB, flowB],
          )
        ).rows,
    );
    expect(other).toHaveLength(0);
  });

  it('with no tenant set nothing is visible, and a write into another workspace is refused by WITH CHECK', async () => {
    await app.query('BEGIN');
    try {
      expect((await app.query(`SELECT 1 FROM flb_geta_publish_settings`)).rows).toHaveLength(0);
      expect((await app.query(`SELECT 1 FROM flb_geta_publish_syncs`)).rows).toHaveLength(0);
    } finally {
      await app.query('ROLLBACK');
    }
    await expect(
      asOrg(orgA, () =>
        app.query(`INSERT INTO flb_geta_publish_settings (org_id, base_url) VALUES ($1,'x')`, [
          orgB,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('a workspace cannot update or delete the other workspace rows (they are invisible)', async () => {
    const res = await asOrg(orgA, async () => {
      const u = await app.query(
        `UPDATE flb_geta_publish_syncs SET state = 'failed' WHERE org_id = $1`,
        [orgB],
      );
      const d = await app.query(`DELETE FROM flb_geta_publish_settings WHERE org_id = $1`, [orgB]);
      return [u.rowCount, d.rowCount];
    });
    expect(res).toEqual([0, 0]);
  });

  it('the sync row points at a flow of the SAME workspace (composite foreign key)', async () => {
    await rejects(
      `INSERT INTO flb_geta_publish_syncs (org_id, flow_id) VALUES ($1,$2)`,
      [orgA, flowB],
      /foreign key/,
    );
  });

  it('one settings row per workspace and one sync row per flow', async () => {
    await rejects(
      `INSERT INTO flb_geta_publish_settings (org_id, base_url) VALUES ($1,'again')`,
      [orgA],
      /duplicate key/,
    );
    await rejects(
      `INSERT INTO flb_geta_publish_syncs (org_id, flow_id) VALUES ($1,$2)`,
      [orgA, flowA],
      /duplicate key/,
    );
  });

  it('state and step values are constrained', async () => {
    await rejects(
      `UPDATE flb_geta_publish_syncs SET state = 'done' WHERE org_id = $1`,
      [orgA],
      /chk_flb_geta_syncs_state/,
    );
    await rejects(
      `UPDATE flb_geta_publish_syncs SET failed_step = 'launch' WHERE org_id = $1`,
      [orgA],
      /chk_flb_geta_syncs_failed_step/,
    );
    await rejects(
      `UPDATE flb_geta_publish_syncs SET step = 'launch' WHERE org_id = $1`,
      [orgA],
      /chk_flb_geta_syncs_step/,
    );
  });

  it('deleting a flow removes its sync row; row_version moves on update', async () => {
    const extra = Number(
      (
        await owner.query(`INSERT INTO flows (org_id, flow_name) VALUES ($1,'Gone') RETURNING id`, [
          orgA,
        ])
      ).rows[0].id,
    );
    await owner.query(`INSERT INTO flb_geta_publish_syncs (org_id, flow_id) VALUES ($1,$2)`, [
      orgA,
      extra,
    ]);
    await owner.query(`DELETE FROM flows WHERE org_id = $1 AND id = $2`, [orgA, extra]);
    const left = await owner.query(`SELECT 1 FROM flb_geta_publish_syncs WHERE flow_id = $1`, [
      extra,
    ]);
    expect(left.rowCount).toBe(0);
    const before = Number(
      (
        await owner.query(`SELECT row_version FROM flb_geta_publish_syncs WHERE flow_id = $1`, [
          flowA,
        ])
      ).rows[0].row_version,
    );
    await owner.query(`UPDATE flb_geta_publish_syncs SET attempted_at = now() WHERE flow_id = $1`, [
      flowA,
    ]);
    const after = Number(
      (
        await owner.query(`SELECT row_version FROM flb_geta_publish_syncs WHERE flow_id = $1`, [
          flowA,
        ])
      ).rows[0].row_version,
    );
    expect(after).toBe(before + 1);
  });

  it('the manage key is registered', async () => {
    const res = await owner.query(`SELECT key FROM permission_defs WHERE key = 'flb.geta.manage'`);
    expect(res.rowCount).toBe(1);
  });
});
