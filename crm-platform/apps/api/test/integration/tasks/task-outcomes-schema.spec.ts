import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * task_outcomes and tasks.outcome_id (20270110090000) against a real Postgres, as the restricted application role. Constraint checks
 * use the owner connection: owners skip RLS but never CHECK, UNIQUE or FK.
 */
describe('task outcomes: schema, constraints and isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let outA: number;
  let outB: number;

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
      `INSERT INTO organizations (slug, name, plan) VALUES ('oa','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('ob','B','starter') RETURNING id`,
    );
    outA = await one(
      // a new workspace is seeded with the default outcomes (20270201090000_sales_activities), 'Interested' among them
      `SELECT id FROM task_outcomes WHERE org_id = $1 AND name = 'Interested'`,
      [orgA],
    );
    outB = await one(
      // a new workspace is seeded with the default outcomes (20270201090000_sales_activities), 'Interested' among them
      `SELECT id FROM task_outcomes WHERE org_id = $1 AND name = 'Interested'`,
      [orgB],
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

  it('RLS is enabled and forced with a tenant policy', async () => {
    const res = await owner.query(
      `SELECT relrowsecurity, relforcerowsecurity,
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = 'task_outcomes' AND p.policyname = 'tenant_isolation')::int AS policies
         FROM pg_class WHERE relname = 'task_outcomes' AND relkind = 'r'`,
    );
    expect(res.rows[0]).toMatchObject({
      relrowsecurity: true,
      relforcerowsecurity: true,
      policies: 1,
    });
  });

  it('a workspace sees only its own outcomes, and none without a tenant', async () => {
    const own = await asOrg(
      orgA,
      async () => (await app.query(`SELECT id FROM task_outcomes`)).rows,
    );
    // a workspace is seeded with the default outcomes, so it has several: its own, and never the other workspace's
    const ids = own.map((r) => Number(r.id));
    expect(ids).toContain(outA);
    expect(ids).not.toContain(outB);
    await app.query('BEGIN');
    try {
      expect((await app.query(`SELECT 1 FROM task_outcomes`)).rows).toHaveLength(0);
    } finally {
      await app.query('ROLLBACK');
    }
  });

  it('a name is unique per workspace ignoring case and spaces, but two workspaces may share one', async () => {
    await rejects(
      `INSERT INTO task_outcomes (org_id, name) VALUES ($1,'  INTERESTED ')`,
      [orgA],
      /uq_task_outcomes_org_lower_name/,
    );
    expect(outB).not.toBe(outA);
  });

  it('refuses an empty or over-long name', async () => {
    await rejects(
      `INSERT INTO task_outcomes (org_id, name) VALUES ($1,'   ')`,
      [orgA],
      /chk_task_outcomes_name/,
    );
    await rejects(
      `INSERT INTO task_outcomes (org_id, name) VALUES ($1,$2)`,
      [orgA, 'x'.repeat(192)],
      /chk_task_outcomes_name/,
    );
  });

  it('a task cannot carry an outcome of another workspace', async () => {
    await rejects(
      `INSERT INTO tasks (org_id, title, outcome_id) VALUES ($1,'x',$2)`,
      [orgA, outB],
      /fk_tasks_outcome_id/,
    );
  });

  it('an outcome a task carries cannot be deleted', async () => {
    await owner.query(`INSERT INTO tasks (org_id, title, outcome_id) VALUES ($1,'t',$2)`, [
      orgA,
      outA,
    ]);
    await rejects(
      `DELETE FROM task_outcomes WHERE org_id = $1 AND id = $2`,
      [orgA, outA],
      /fk_tasks_outcome_id/,
    );
  });

  it('touch_row bumps row_version on update', async () => {
    const before = await owner.query(
      `SELECT row_version FROM task_outcomes WHERE org_id = $1 AND id = $2`,
      [orgB, outB],
    );
    await owner.query(`UPDATE task_outcomes SET is_active = false WHERE org_id = $1 AND id = $2`, [
      orgB,
      outB,
    ]);
    const after = await owner.query(
      `SELECT row_version FROM task_outcomes WHERE org_id = $1 AND id = $2`,
      [orgB, outB],
    );
    expect(Number(after.rows[0].row_version)).toBe(Number(before.rows[0].row_version) + 1);
  });

  it('the manage permission exists and the owner and admin presets hold it', async () => {
    const res = await owner.query(
      `SELECT preset_key FROM workspace_preset_baseline WHERE permission_key = 'settings.task_outcomes.manage' ORDER BY 1`,
    );
    expect(res.rows.map((r) => r.preset_key)).toEqual(['admin', 'workspace_admin']);
  });
});
