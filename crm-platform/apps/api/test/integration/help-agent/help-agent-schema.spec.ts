import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The Help assistant's two tables and seeds against a real Postgres as the restricted application role (a superuser bypasses every
 * policy): forced row-level security, a cross-tenant read and write attempt, the composite foreign key to users, the checks, the touch
 * trigger and the permission seeds.
 */
describe('help agent: schema, isolation and seeds', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;

  const asTenant = async <T>(org: number, fn: () => Promise<T>): Promise<T> => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };
  const task = (org: number, user: number | null, over: Record<string, unknown> = {}) =>
    owner.query(
      `INSERT INTO help_agent_tasks (org_id, user_id, locale, task_length, route, status) VALUES ($1,$2,'en',$3,'/contacts',$4) RETURNING id, uuid`,
      [org, user, over.taskLength ?? 10, over.status ?? 'running'],
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
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    const org = async (slug: string) =>
      Number(
        (
          await owner.query(
            `INSERT INTO organizations (slug,name,plan) VALUES ($1,$1,'starter') RETURNING id`,
            [slug],
          )
        ).rows[0].id,
      );
    orgA = await org('ha-a');
    orgB = await org('ha-b');
    const user = async (o: number, email: string) =>
      Number(
        (
          await owner.query(
            `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2,'U','x') RETURNING id`,
            [o, email],
          )
        ).rows[0].id,
      );
    userA = await user(orgA, 'a@x.test');
    userB = await user(orgB, 'b@x.test');
    await task(orgA, userA);
    await task(orgB, userB);
    await owner.query(
      `INSERT INTO help_agent_settings (org_id, enabled) VALUES ($1, true), ($2, false)`,
      [orgA, orgB],
    );
    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
  }, 240_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  it('forces row-level security on both tables', async () => {
    const res = await owner.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname)::int AS policies
       FROM pg_class c WHERE c.relname IN ('help_agent_settings','help_agent_tasks') ORDER BY c.relname`,
    );
    expect(res.rows).toHaveLength(2);
    for (const r of res.rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
      expect(r.policies, r.relname).toBeGreaterThanOrEqual(1);
    }
  });

  it('shows a workspace only its own tasks and switch, and nothing without a context', async () => {
    expect(
      (await asTenant(orgA, () => app.query(`SELECT org_id FROM help_agent_tasks`))).rows.map((r) =>
        Number(r.org_id),
      ),
    ).toEqual([orgA]);
    expect(
      (await asTenant(orgB, () => app.query(`SELECT enabled FROM help_agent_settings`))).rows,
    ).toEqual([{ enabled: false }]);
    await app.query('BEGIN');
    try {
      expect((await app.query(`SELECT 1 FROM help_agent_tasks`)).rows).toHaveLength(0);
    } finally {
      await app.query('ROLLBACK');
    }
  });

  it("refuses a workspace writing into another, and updating or deleting another workspace's rows", async () => {
    await expect(
      asTenant(orgA, () =>
        app.query(
          `INSERT INTO help_agent_tasks (org_id, user_id, locale, task_length, route) VALUES ($1,$2,'en',5,'/x')`,
          [orgB, userB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asTenant(orgA, () =>
        app.query(`INSERT INTO help_agent_settings (org_id, enabled) VALUES ($1, true)`, [orgB]),
      ),
    ).rejects.toThrow(/row-level security|duplicate key/);
    const upd = await asTenant(orgA, () =>
      app.query(`UPDATE help_agent_tasks SET status = 'failed' WHERE org_id = $1`, [orgB]),
    );
    expect(upd.rowCount).toBe(0);
    const del = await asTenant(orgA, () =>
      app.query(`DELETE FROM help_agent_tasks WHERE org_id = $1`, [orgB]),
    );
    expect(del.rowCount).toBe(0);
  });

  it("refuses a task pointing at another workspace's user (composite foreign key)", async () => {
    await expect(task(orgA, userB)).rejects.toThrow(/fk_help_agent_tasks_user|foreign key/);
    await expect(
      owner.query(
        `INSERT INTO help_agent_settings (org_id, enabled, updated_by) VALUES ($1, true, $2) ON CONFLICT (org_id) DO UPDATE SET updated_by = EXCLUDED.updated_by`,
        [orgA, userB],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('keeps the task when its user is deleted (the user column is cleared)', async () => {
    const u = Number(
      (
        await owner.query(
          `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'gone@x.test','G','x') RETURNING id`,
          [orgA],
        )
      ).rows[0].id,
    );
    const t = await task(orgA, u);
    await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, u]);
    const row = await owner.query(
      `SELECT user_id FROM help_agent_tasks WHERE org_id = $1 AND id = $2`,
      [orgA, t.rows[0].id],
    );
    expect(row.rows).toEqual([{ user_id: null }]);
  });

  it('holds the checks: a known status, non-negative counts, a positive task length', async () => {
    await expect(task(orgA, userA, { status: 'exploded' })).rejects.toThrow(
      /ck_help_agent_tasks_status/,
    );
    await expect(task(orgA, userA, { taskLength: 0 })).rejects.toThrow(
      /ck_help_agent_tasks_counts/,
    );
    await expect(
      owner.query(`UPDATE help_agent_tasks SET steps = -1 WHERE org_id = $1`, [orgA]),
    ).rejects.toThrow(/ck_help_agent_tasks_counts/);
  });

  it('bumps the row version on update (optimistic locking trigger)', async () => {
    const t = await task(orgA, userA);
    await owner.query(
      `UPDATE help_agent_tasks SET steps = steps + 1 WHERE org_id = $1 AND id = $2`,
      [orgA, t.rows[0].id],
    );
    const row = await owner.query(
      `SELECT row_version FROM help_agent_tasks WHERE org_id = $1 AND id = $2`,
      [orgA, t.rows[0].id],
    );
    expect(row.rows[0].row_version).toBe(2);
  });

  it('has one settings row per workspace, off by default for a workspace with no row', async () => {
    await expect(
      owner.query(`INSERT INTO help_agent_settings (org_id) VALUES ($1)`, [orgA]),
    ).rejects.toThrow(/duplicate key/);
    const orgC = Number(
      (
        await owner.query(
          `INSERT INTO organizations (slug,name,plan) VALUES ('ha-c','ha-c','starter') RETURNING id`,
        )
      ).rows[0].id,
    );
    const none = await owner.query(
      `SELECT count(*)::int AS n FROM help_agent_settings WHERE org_id = $1`,
      [orgC],
    );
    expect(none.rows[0].n).toBe(0);
    await owner.query(`INSERT INTO help_agent_settings (org_id) VALUES ($1)`, [orgC]);
    expect(
      (await owner.query(`SELECT enabled FROM help_agent_settings WHERE org_id = $1`, [orgC]))
        .rows[0].enabled,
    ).toBe(false);
  });

  it('seeds the two permission keys, and the Owner and Admin presets only', async () => {
    const defs = await owner.query(
      `SELECT key, supports_scope FROM permission_defs WHERE key LIKE 'help.agent.%' ORDER BY key`,
    );
    expect(defs.rows).toEqual([
      { key: 'help.agent.manage', supports_scope: false },
      { key: 'help.agent.use', supports_scope: false },
    ]);
    const baseline = await owner.query(
      `SELECT preset_key, permission_key FROM workspace_preset_baseline WHERE permission_key LIKE 'help.agent.%' ORDER BY preset_key, permission_key`,
    );
    expect(baseline.rows).toEqual([
      { preset_key: 'admin', permission_key: 'help.agent.manage' },
      { preset_key: 'admin', permission_key: 'help.agent.use' },
      { preset_key: 'workspace_admin', permission_key: 'help.agent.manage' },
      { preset_key: 'workspace_admin', permission_key: 'help.agent.use' },
    ]);
  });
});
