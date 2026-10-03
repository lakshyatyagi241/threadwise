import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The companies table against a real Postgres, as the restricted application role (a superuser bypasses every policy and would
 * make the isolation assertions vacuous, see rls.spec.ts). Constraint checks use the owner connection: owners skip RLS but
 * never CHECK, UNIQUE or FK.
 */
describe('companies: schema, constraints and isolation (WD-CTP)', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;
  let companyA: number;
  let companyB: number;

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
      `INSERT INTO organizations (slug, name, plan) VALUES ('coa','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('cob','B','starter') RETURNING id`,
    );
    userA = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@co.test','A','x') RETURNING id`,
      [orgA],
    );
    userB = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'b@co.test','B','x') RETURNING id`,
      [orgB],
    );
    companyA = await one(
      `INSERT INTO companies (org_id, name, created_by, owner_id) VALUES ($1,'Acme',$2,$2) RETURNING id`,
      [orgA, userA],
    );
    companyB = await one(`INSERT INTO companies (org_id, name) VALUES ($1,'Beta') RETURNING id`, [
      orgB,
    ]);

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
    it('RLS is enabled and forced with a tenant policy that has both USING and WITH CHECK', async () => {
      const res = await owner.query(
        `SELECT relrowsecurity, relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = 'companies' AND p.policyname = 'tenant_isolation' AND p.qual IS NOT NULL AND p.with_check IS NOT NULL)::int AS policies
           FROM pg_class WHERE relname = 'companies' AND relkind = 'r'`,
      );
      expect(res.rows[0]).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        policies: 1,
      });
    });

    it('a workspace sees only its own companies, even when the other id is known exactly', async () => {
      const own = await asOrg(orgA, async () => (await app.query(`SELECT id FROM companies`)).rows);
      expect(own.map((r) => Number(r.id))).toEqual([companyA]);
      const other = await asOrg(
        orgA,
        async () =>
          (
            await app.query(`SELECT 1 FROM companies WHERE org_id = $1 AND id = $2`, [
              orgB,
              companyB,
            ])
          ).rows,
      );
      expect(other).toHaveLength(0);
    });

    it('with no tenant set a query sees no rows, and a write into another workspace is refused by WITH CHECK', async () => {
      await app.query('BEGIN');
      try {
        expect((await app.query(`SELECT 1 FROM companies`)).rows).toHaveLength(0);
      } finally {
        await app.query('ROLLBACK');
      }
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgA)]);
        await expect(
          app.query(`INSERT INTO companies (org_id, name) VALUES ($1, 'smuggled')`, [orgB]),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await app.query('ROLLBACK');
      }
    });
  });

  describe('foreign keys are composite', () => {
    it('a company cannot be owned or created by a user of another workspace', async () => {
      await rejects(
        `INSERT INTO companies (org_id, name, owner_id) VALUES ($1,'x',$2)`,
        [orgA, userB],
        /companies_org_id_owner_id_fkey/,
      );
      await rejects(
        `INSERT INTO companies (org_id, name, created_by) VALUES ($1,'x',$2)`,
        [orgA, userB],
        /fk_companies_created_by/,
      );
    });

    it('a contact or a deal cannot point at a company of another workspace', async () => {
      await rejects(
        `INSERT INTO contacts (org_id, name, company_id) VALUES ($1,'x',$2)`,
        [orgA, companyB],
        /contacts_org_id_company_id_fkey/,
      );
      const pipe = Number(
        (await owner.query(`SELECT id FROM pipelines WHERE org_id = $1`, [orgA])).rows[0].id,
      );
      const stage = Number(
        (await owner.query(`SELECT id FROM pipeline_stages WHERE org_id = $1 LIMIT 1`, [orgA]))
          .rows[0].id,
      );
      await rejects(
        `INSERT INTO deals (org_id, pipeline_id, stage_id, title, company_id) VALUES ($1,$2,$3,'x',$4)`,
        [orgA, pipe, stage, companyB],
        /fk_deals_company_id/,
      );
    });

    it('deleting a user keeps the company and clears only the owner and the creator', async () => {
      const u = Number(
        (
          await owner.query(
            `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'gone@co.test','G','x') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      const c = Number(
        (
          await owner.query(
            `INSERT INTO companies (org_id, name, owner_id, created_by) VALUES ($1,'Keep',$2,$2) RETURNING id`,
            [orgA, u],
          )
        ).rows[0].id,
      );
      await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, u]);
      const row = (
        await owner.query(`SELECT owner_id, created_by FROM companies WHERE id = $1`, [c])
      ).rows[0];
      expect(row).toEqual({ owner_id: null, created_by: null });
    });

    it('deleting a company unlinks its contacts and deals (keeping them) and bumps their version', async () => {
      const c = Number(
        (
          await owner.query(
            `INSERT INTO companies (org_id, name) VALUES ($1,'Doomed') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      const contact = Number(
        (
          await owner.query(
            `INSERT INTO contacts (org_id, name, company_id) VALUES ($1,'Kept',$2) RETURNING id`,
            [orgA, c],
          )
        ).rows[0].id,
      );
      const before = Number(
        (await owner.query(`SELECT row_version FROM contacts WHERE id = $1`, [contact])).rows[0]
          .row_version,
      );
      await owner.query(`DELETE FROM companies WHERE org_id = $1 AND id = $2`, [orgA, c]);
      const after = (
        await owner.query(`SELECT company_id, row_version FROM contacts WHERE id = $1`, [contact])
      ).rows[0];
      expect(after.company_id).toBeNull();
      expect(Number(after.row_version)).toBeGreaterThan(before);
    });

    it('every table that references companies unlinks on delete instead of blocking it', async () => {
      const res = await owner.query(
        `SELECT conrelid::regclass::text AS tbl, confdeltype, pg_get_constraintdef(oid) AS def
           FROM pg_constraint WHERE confrelid = 'companies'::regclass AND contype = 'f'`,
      );
      expect(res.rows.map((r) => r.tbl).sort()).toEqual(
        expect.arrayContaining([
          'contacts',
          'deals',
          'tasks',
          'projects',
          'sales_docs',
          'invoices',
          'payments',
        ]),
      );
      for (const r of res.rows) expect(r.confdeltype, r.tbl).toBe('n');
    });
  });

  describe('value rules (WaDesk limits)', () => {
    it('the name is required, not blank and at most 191 characters', async () => {
      await rejects(
        `INSERT INTO companies (org_id) VALUES ($1)`,
        [orgA],
        /null value in column "name"/,
      );
      await rejects(
        `INSERT INTO companies (org_id, name) VALUES ($1,'   ')`,
        [orgA],
        /chk_companies_name/,
      );
      await rejects(
        `INSERT INTO companies (org_id, name) VALUES ($1,$2)`,
        [orgA, 'x'.repeat(192)],
        /chk_companies_name/,
      );
      await owner.query(`INSERT INTO companies (org_id, name) VALUES ($1,$2)`, [
        orgA,
        'x'.repeat(191),
      ]);
    });

    it.each([
      ['domain', 191, /chk_companies_domain/],
      ['email', 191, /chk_companies_email/],
      ['phone', 32, /chk_companies_phone/],
      ['industry', 100, /chk_companies_industry/],
      ['size_range', 40, /chk_companies_size_range/],
      ['address', 500, /chk_companies_address/],
      ['notes', 2000, /chk_companies_notes/],
    ])('%s is at most %i characters', async (column, max, pattern) => {
      await rejects(
        `INSERT INTO companies (org_id, name, ${column}) VALUES ($1,'x',$2)`,
        [orgA, 'y'.repeat(max + 1)],
        pattern,
      );
      await owner.query(`INSERT INTO companies (org_id, name, ${column}) VALUES ($1,'x',$2)`, [
        orgA,
        'y'.repeat(max),
      ]);
    });

    it('the version and the update stamp move on every write (the touch trigger)', async () => {
      const c = (
        await owner.query(
          `INSERT INTO companies (org_id, name) VALUES ($1,'Touch') RETURNING id, row_version`,
          [orgA],
        )
      ).rows[0];
      await owner.query(`UPDATE companies SET phone = '1' WHERE org_id = $1 AND id = $2`, [
        orgA,
        c.id,
      ]);
      const after = (await owner.query(`SELECT row_version FROM companies WHERE id = $1`, [c.id]))
        .rows[0];
      expect(Number(after.row_version)).toBe(Number(c.row_version) + 1);
    });

    it('duplicate names are allowed (WaDesk has no uniqueness rule)', async () => {
      await owner.query(`INSERT INTO companies (org_id, name) VALUES ($1,'Twin'), ($1,'Twin')`, [
        orgA,
      ]);
    });
  });

  describe('indexes', () => {
    it('the list, the name search and the contact lookup have the indexes the queries are written for', async () => {
      const res = await owner.query(
        `SELECT indexname FROM pg_indexes WHERE tablename IN ('companies','contacts') AND indexname = ANY($1)`,
        [
          [
            'idx_companies_org_created',
            'idx_companies_org_name',
            'idx_companies_owner',
            'idx_companies_created_by',
            'idx_companies_name_trgm',
            'idx_contacts_company_id',
          ],
        ],
      );
      expect(res.rows.map((r) => r.indexname).sort()).toEqual([
        'idx_companies_created_by',
        'idx_companies_name_trgm',
        'idx_companies_org_created',
        'idx_companies_org_name',
        'idx_companies_owner',
        'idx_contacts_company_id',
      ]);
    });
  });

  describe('permissions (WD-CTP-001, D-02)', () => {
    it('the four keys exist, with a record scope on read, update and delete only', async () => {
      const res = await owner.query(
        `SELECT key, supports_scope FROM permission_defs WHERE key LIKE 'record.companies.%' ORDER BY key`,
      );
      expect(res.rows).toEqual([
        { key: 'record.companies.create', supports_scope: false },
        { key: 'record.companies.delete', supports_scope: true },
        { key: 'record.companies.read', supports_scope: true },
        { key: 'record.companies.update', supports_scope: true },
      ]);
    });

    it('a new workspace gets them: the Owner and Admin everything, the Manager everything, the Agent read + create at all and edit at own, the Viewer nothing', async () => {
      const org = Number(
        (
          await owner.query(
            `INSERT INTO organizations (slug, name, plan) VALUES ('cop','P','starter') RETURNING id`,
          )
        ).rows[0].id,
      );
      await owner.query(`SELECT provision_workspace_presets($1)`, [org]);
      const grants = async (systemKey: string) =>
        (
          await owner.query(
            `SELECT g.permission_key, g.record_scope FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
              WHERE g.org_id = $1 AND r.system_key = $2 AND g.permission_key LIKE 'record.companies.%' ORDER BY g.permission_key`,
            [org, systemKey],
          )
        ).rows.map((r) => `${r.permission_key}:${r.record_scope}`);
      const all = [
        'record.companies.create:all',
        'record.companies.delete:all',
        'record.companies.read:all',
        'record.companies.update:all',
      ];
      expect(await grants('admin')).toEqual(all);
      expect(await grants('workspace_admin')).toEqual(all);
      expect(await grants('manager')).toEqual(all);
      expect(await grants('agent')).toEqual([
        'record.companies.create:all',
        'record.companies.read:all',
        'record.companies.update:own',
      ]);
      expect(await grants('viewer')).toEqual([]);
    });
  });
});
