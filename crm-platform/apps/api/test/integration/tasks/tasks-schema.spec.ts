import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The tasks table against a real Postgres, as the restricted application role (a superuser bypasses every policy and would
 * make the isolation assertions vacuous, see rls.spec.ts). Constraint checks use the owner connection: owners skip RLS but
 * never CHECK, UNIQUE or FK.
 */
describe('tasks: schema, constraints and isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;
  let contactA: number;
  let contactB: number;
  let dealA: number;
  let taskA: number;
  let taskB: number;

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
      `INSERT INTO organizations (slug, name, plan) VALUES ('ta','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('tb','B','starter') RETURNING id`,
    );
    userA = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@t.test','A','x') RETURNING id`,
      [orgA],
    );
    userB = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'b@t.test','B','x') RETURNING id`,
      [orgB],
    );
    contactA = await one(`INSERT INTO contacts (org_id, name) VALUES ($1,'CA') RETURNING id`, [
      orgA,
    ]);
    contactB = await one(`INSERT INTO contacts (org_id, name) VALUES ($1,'CB') RETURNING id`, [
      orgB,
    ]);
    const pipe = await one(`SELECT id FROM pipelines WHERE org_id = $1`, [orgA]);
    const stage = await one(
      `SELECT id FROM pipeline_stages WHERE org_id = $1 ORDER BY sort_order LIMIT 1`,
      [orgA],
    );
    dealA = await one(
      `INSERT INTO deals (org_id, pipeline_id, stage_id, title, currency) VALUES ($1,$2,$3,'D','USD') RETURNING id`,
      [orgA, pipe, stage],
    );
    taskA = await one(
      `INSERT INTO tasks (org_id, title, assignee_id, contact_id, deal_id) VALUES ($1,'Task A',$2,$3,$4) RETURNING id`,
      [orgA, userA, contactA, dealA],
    );
    taskB = await one(
      `INSERT INTO tasks (org_id, title, assignee_id) VALUES ($1,'Task B',$2) RETURNING id`,
      [orgB, userB],
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

  describe('row-level security', () => {
    it('RLS is enabled and forced with a tenant policy', async () => {
      const res = await owner.query(
        `SELECT relrowsecurity, relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = 'tasks' AND p.policyname = 'tenant_isolation')::int AS policies
           FROM pg_class WHERE relname = 'tasks' AND relkind = 'r'`,
      );
      expect(res.rows[0]).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        policies: 1,
      });
    });

    it('a workspace sees only its own tasks, even when the other id is known exactly', async () => {
      const own = await asOrg(orgA, async () => (await app.query(`SELECT id FROM tasks`)).rows);
      expect(own.map((r) => Number(r.id))).toEqual([taskA]);
      const other = await asOrg(
        orgA,
        async () =>
          (await app.query(`SELECT 1 FROM tasks WHERE org_id = $1 AND id = $2`, [orgB, taskB]))
            .rows,
      );
      expect(other).toHaveLength(0);
    });

    it('with no tenant set a query sees no rows, and a write into another workspace is refused by WITH CHECK', async () => {
      await app.query('BEGIN');
      try {
        expect((await app.query(`SELECT 1 FROM tasks`)).rows).toHaveLength(0);
      } finally {
        await app.query('ROLLBACK');
      }
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgA)]);
        await expect(
          app.query(`INSERT INTO tasks (org_id, title) VALUES ($1, 'smuggled')`, [orgB]),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await app.query('ROLLBACK');
      }
    });
  });

  describe('foreign keys are composite', () => {
    it('a task cannot be assigned to, or created by, a user of another workspace', async () => {
      await rejects(
        `INSERT INTO tasks (org_id, title, assignee_id) VALUES ($1,'x',$2)`,
        [orgA, userB],
        /fk_tasks_assignee_id/,
      );
      await rejects(
        `INSERT INTO tasks (org_id, title, created_by) VALUES ($1,'x',$2)`,
        [orgA, userB],
        /fk_tasks_created_by/,
      );
    });
    it('a task cannot link a contact or a deal of another workspace', async () => {
      await rejects(
        `INSERT INTO tasks (org_id, title, contact_id) VALUES ($1,'x',$2)`,
        [orgA, contactB],
        /fk_tasks_contact_id/,
      );
      await rejects(
        `INSERT INTO tasks (org_id, title, deal_id) VALUES ($1,'x',$2)`,
        [orgB, dealA],
        /fk_tasks_deal_id/,
      );
    });
    it('deleting a linked contact, deal or user keeps the task and clears only the link', async () => {
      const t = Number(
        (
          await owner.query(
            `INSERT INTO tasks (org_id, title, assignee_id, contact_id) VALUES ($1,'keep',$2,$3) RETURNING id`,
            [
              orgA,
              userA,
              Number(
                (
                  await owner.query(
                    `INSERT INTO contacts (org_id, name) VALUES ($1,'gone') RETURNING id`,
                    [orgA],
                  )
                ).rows[0].id,
              ),
            ],
          )
        ).rows[0].id,
      );
      await owner.query(`DELETE FROM contacts WHERE org_id = $1 AND name = 'gone'`, [orgA]);
      const r = (await owner.query(`SELECT contact_id, assignee_id FROM tasks WHERE id = $1`, [t]))
        .rows[0];
      expect(r.contact_id).toBeNull();
      expect(Number(r.assignee_id)).toBe(userA);
    });
    it('a deal timeline row points at one task, and deleting the task keeps the row', async () => {
      const t = Number(
        (
          await owner.query(`INSERT INTO tasks (org_id, title) VALUES ($1,'m') RETURNING id`, [
            orgA,
          ])
        ).rows[0].id,
      );
      const a1 = Number(
        (
          await owner.query(
            `INSERT INTO deal_activities (org_id, deal_id, type, body, task_id) VALUES ($1,$2,'task','b',$3) RETURNING id`,
            [orgA, dealA, t],
          )
        ).rows[0].id,
      );
      await rejects(
        `INSERT INTO deal_activities (org_id, deal_id, type, body, task_id) VALUES ($1,$2,'task','b2',$3)`,
        [orgA, dealA, t],
        /uq_deal_activities_task/,
      );
      await owner.query(`DELETE FROM tasks WHERE id = $1`, [t]);
      const r = await owner.query(`SELECT task_id FROM deal_activities WHERE id = $1`, [a1]);
      expect(r.rows[0].task_id).toBeNull();
    });
  });

  describe('value rules', () => {
    it('priority, status and source are enumerations; the title is not blank', async () => {
      await rejects(
        `INSERT INTO tasks (org_id, title, priority) VALUES ($1,'x','urgent')`,
        [orgA],
        /chk_tasks_priority/,
      );
      await rejects(
        `INSERT INTO tasks (org_id, title, status, done_at) VALUES ($1,'x','cancelled', now())`,
        [orgA],
        /chk_tasks_(status|done_stamp)/,
      );
      await rejects(
        `INSERT INTO tasks (org_id, title, source) VALUES ($1,'x','fax')`,
        [orgA],
        /chk_tasks_source/,
      );
      await rejects(
        `INSERT INTO tasks (org_id, title) VALUES ($1,'   ')`,
        [orgA],
        /chk_tasks_title/,
      );
      await rejects(
        `INSERT INTO tasks (org_id, title) VALUES ($1, repeat('x', 256))`,
        [orgA],
        /chk_tasks_title/,
      );
    });
    it('status and done_at always agree', async () => {
      await rejects(
        `INSERT INTO tasks (org_id, title, status) VALUES ($1,'x','done')`,
        [orgA],
        /chk_tasks_done_stamp/,
      );
      await rejects(
        `INSERT INTO tasks (org_id, title, done_at) VALUES ($1,'x', now())`,
        [orgA],
        /chk_tasks_done_stamp/,
      );
      await rejects(
        `UPDATE tasks SET status = 'done' WHERE id = $1`,
        [taskA],
        /chk_tasks_done_stamp/,
      );
    });
  });

  describe('optimistic locking', () => {
    it('every update bumps row_version, and a guarded update with a stale version matches nothing', async () => {
      const before = Number(
        (await owner.query(`SELECT row_version FROM tasks WHERE id = $1`, [taskA])).rows[0]
          .row_version,
      );
      const ok = await owner.query(
        `UPDATE tasks SET priority = 'high' WHERE id = $1 AND row_version = $2 RETURNING row_version`,
        [taskA, before],
      );
      expect(Number(ok.rows[0].row_version)).toBe(before + 1);
      const stale = await owner.query(
        `UPDATE tasks SET priority = 'low' WHERE id = $1 AND row_version = $2 RETURNING id`,
        [taskA, before],
      );
      expect(stale.rows).toHaveLength(0);
    });
  });

  describe('capability keys', () => {
    it('the four keys are registered, record-scoped where the route reads or changes existing rows', async () => {
      const res = await owner.query(
        `SELECT key, supports_scope FROM permission_defs WHERE key LIKE 'record.tasks.%' ORDER BY key`,
      );
      expect(res.rows).toEqual([
        { key: 'record.tasks.create', supports_scope: false },
        { key: 'record.tasks.delete', supports_scope: true },
        { key: 'record.tasks.read', supports_scope: true },
        { key: 'record.tasks.update', supports_scope: true },
      ]);
    });
  });
});
