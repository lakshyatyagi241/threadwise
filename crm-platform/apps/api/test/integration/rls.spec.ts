import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * Tenant isolation, proven against a real Postgres.
 *
 * This is the single most important test in the repository. Every other
 * safeguard — repositories, guards, code review — is a convention that can be
 * forgotten. RLS is the one that cannot, and this suite is what proves it is
 * actually switched on.
 *
 * It deliberately talks raw SQL rather than going through the application:
 * the claim under test is "the database refuses", not "our code remembers to
 * filter".
 */
describe('row-level security', () => {
  let container: StartedPostgreSqlContainer;
  /** Owner connection: runs migrations and seeds across tenants. */
  let owner: Client;
  /** Application connection: restricted, non-superuser. Everything under test. */
  let client: Client;
  let orgA: number;
  let orgB: number;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();

    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();

    // The login role the application uses. It must exist BEFORE migrations, so
    // 0007 can grant it membership of crm_app.
    //
    // This is the whole point of the suite: the container's POSTGRES_USER is a
    // SUPERUSER, and a superuser bypasses RLS even with FORCE ROW LEVEL
    // SECURITY set. Testing as the owner would pass against an application
    // that has no isolation whatsoever.
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );

    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../packages/db/migrations'),
      log: () => undefined,
    });

    const a = await owner.query<{ id: number }>(
      `INSERT INTO organizations (slug, name, plan) VALUES ('org-a','Org A','starter') RETURNING id`,
    );
    const b = await owner.query<{ id: number }>(
      `INSERT INTO organizations (slug, name, plan) VALUES ('org-b','Org B','starter') RETURNING id`,
    );
    orgA = Number(a.rows[0]!.id);
    orgB = Number(b.rows[0]!.id);

    await owner.query(
      `INSERT INTO contacts (org_id, name, email, phone) VALUES ($1,'A Person','a@example.com','+911111111111')`,
      [orgA],
    );
    await owner.query(
      `INSERT INTO contacts (org_id, name, email, phone) VALUES ($1,'B Person','b@example.com','+922222222222')`,
      [orgB],
    );

    client = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await client.connect();
  }, 180_000);

  afterAll(async () => {
    await client?.end();
    await owner?.end();
    await container?.stop();
  });

  async function asOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      return await fn();
    } finally {
      await client.query('COMMIT');
    }
  }

  it('shows a tenant only its own rows', async () => {
    const rows = await asOrg(orgA, async () => {
      const result = await client.query<{ name: string }>('SELECT name FROM contacts');
      return result.rows;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('A Person');
  });

  it('hides another tenant’s row even when its id is known exactly', async () => {
    const rows = await asOrg(orgA, async () => {
      // Guessing the id must not help: the policy is on org_id, not on the
      // predicate the caller happens to write.
      const result = await client.query('SELECT * FROM contacts WHERE org_id = $1', [orgB]);
      return result.rows;
    });

    expect(rows).toHaveLength(0);
  });

  it('refuses to insert a row into another tenant', async () => {
    await expect(
      asOrg(orgA, async () =>
        client.query(`INSERT INTO contacts (org_id, name) VALUES ($1, 'Smuggled')`, [orgB]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('refuses to move a row to another tenant via UPDATE', async () => {
    await expect(
      asOrg(orgA, async () =>
        client.query(`UPDATE contacts SET org_id = $1 WHERE org_id = $2`, [orgB, orgA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('returns nothing when no tenant context is set (fails closed)', async () => {
    await client.query('BEGIN');
    // No set_config at all: current_org_id() is NULL, `org_id = NULL` is never
    // true, so the correct outcome is zero rows — not every row.
    const result = await client.query('SELECT * FROM contacts');
    await client.query('COMMIT');

    expect(result.rows).toHaveLength(0);
  });

  it('applies the same isolation to partner agents and their lead mappings', async () => {
    const rows = await asOrg(orgB, async () => {
      const result = await client.query('SELECT * FROM partner_agent_leads');
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('has RLS enabled AND forced on every tenant table', async () => {
    // FORCE matters for the owner path: without it the migration role (which
    // owns these tables) bypasses every policy.
    const result = await owner.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('contacts','users','partner_agents','partner_agent_leads','api_keys','audit_log')
        AND relkind IN ('r','p')
    `);

    for (const row of result.rows) {
      expect({ [row.relname]: [row.relrowsecurity, row.relforcerowsecurity] }).toEqual({
        [row.relname]: [true, true],
      });
    }
    expect(result.rows.length).toBeGreaterThanOrEqual(6);
  });

  it('connects as a non-superuser — otherwise every assertion above is vacuous', async () => {
    const result = await client.query<{ usesuper: boolean; rolbypassrls: boolean }>(
      `SELECT r.rolsuper AS usesuper, r.rolbypassrls
       FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(result.rows[0]).toEqual({ usesuper: false, rolbypassrls: false });
  });
});
