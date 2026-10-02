import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The three AI tables against a real Postgres, as the restricted application role (a superuser would bypass every
 * policy and make the isolation assertions vacuous). Constraint checks use the owner connection: owners skip RLS but
 * never CHECK or UNIQUE.
 */
describe('AI keys schema, seed and row-level security', () => {
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
  const asNobody = <T>(fn: () => Promise<T>) => inTx([], fn);

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
    orgA = await org('ai-org-a');
    orgB = await org('ai-org-b');
    await owner.query(
      `INSERT INTO ai_provider_keys (org_id, provider, api_key) VALUES ($1,'openai','ca'), ($2,'openai','cb')`,
      [orgA, orgB],
    );
    await owner.query(
      `INSERT INTO ai_token_usage (org_id, provider, total_tokens) VALUES ($1,'openai',10), ($2,'openai',20)`,
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
  }, 180_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  it('seeds the 22 providers inactive and keyless', async () => {
    const res = await owner.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE is_active OR api_key IS NOT NULL)::int AS touched,
              count(DISTINCT sort_order)::int AS orders FROM admin_ai_keys`,
    );
    expect(res.rows[0]).toEqual({ n: 22, touched: 0, orders: 22 });
  });

  it('forces row-level security on all three tables, and on the ledger default partition', async () => {
    const res = await owner.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname)::int AS policies
       FROM pg_class c WHERE c.relname IN ('admin_ai_keys','ai_provider_keys','ai_token_usage','ai_token_usage_default')
       ORDER BY c.relname`,
    );
    expect(res.rows).toHaveLength(4);
    for (const r of res.rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
      expect(r.policies, r.relname).toBeGreaterThanOrEqual(1);
    }
  });

  it('hides the platform keys from every workspace and from a connection with no context', async () => {
    expect((await asOrg(orgA, () => app.query(`SELECT 1 FROM admin_ai_keys`))).rows).toHaveLength(
      0,
    );
    expect((await asNobody(() => app.query(`SELECT 1 FROM admin_ai_keys`))).rows).toHaveLength(0);
    expect((await asPrivileged(() => app.query(`SELECT 1 FROM admin_ai_keys`))).rows).toHaveLength(
      22,
    );
  });

  it('refuses a workspace writing a platform key', async () => {
    await expect(
      asOrg(orgA, () =>
        app.query(`UPDATE admin_ai_keys SET is_active = true WHERE provider = 'openai'`),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asOrg(orgA, () =>
        app.query(`INSERT INTO admin_ai_keys (provider, name) VALUES ('rogue', 'Rogue')`),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('shows a workspace only its own provider keys and ledger rows', async () => {
    const keys = await asOrg(orgA, () => app.query(`SELECT org_id FROM ai_provider_keys`));
    expect(keys.rows.map((r) => Number(r.org_id))).toEqual([orgA]);
    const usage = await asOrg(orgB, () =>
      app.query(`SELECT org_id, total_tokens FROM ai_token_usage`),
    );
    expect(usage.rows.map((r) => [Number(r.org_id), r.total_tokens])).toEqual([[orgB, 20]]);
    expect((await asNobody(() => app.query(`SELECT 1 FROM ai_token_usage`))).rows).toHaveLength(0);
    expect((await asPrivileged(() => app.query(`SELECT 1 FROM ai_token_usage`))).rows).toHaveLength(
      2,
    );
  });

  it('refuses a workspace writing a row for another workspace (WITH CHECK)', async () => {
    await expect(
      asOrg(orgA, () =>
        app.query(
          `INSERT INTO ai_provider_keys (org_id, provider, api_key) VALUES ($1,'mistral','x')`,
          [orgB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asOrg(orgA, () =>
        app.query(`INSERT INTO ai_token_usage (org_id, provider) VALUES ($1,'openai')`, [orgB]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('keeps one key per vendor per workspace, and a provider unique platform-wide', async () => {
    await expect(
      owner.query(
        `INSERT INTO ai_provider_keys (org_id, provider, api_key) VALUES ($1,'openai','dup')`,
        [orgA],
      ),
    ).rejects.toThrow(/uq_ai_provider_keys_provider/);
    await expect(
      owner.query(`INSERT INTO admin_ai_keys (provider, name) VALUES ('openai', 'Again')`),
    ).rejects.toThrow(/uq_admin_ai_keys_provider/);
  });

  it('rejects a ledger row with an unknown payer or a negative count', async () => {
    await expect(
      owner.query(
        `INSERT INTO ai_token_usage (org_id, provider, billed_against) VALUES ($1,'openai','x')`,
        [orgA],
      ),
    ).rejects.toThrow(/chk_ai_token_usage_billed_against/);
    await expect(
      owner.query(
        `INSERT INTO ai_token_usage (org_id, provider, total_tokens) VALUES ($1,'openai',-1)`,
        [orgA],
      ),
    ).rejects.toThrow(/chk_ai_token_usage_tokens/);
  });

  it('bumps the row version on every update of a key', async () => {
    const before = await owner.query(`SELECT row_version FROM ai_provider_keys WHERE org_id = $1`, [
      orgA,
    ]);
    await owner.query(`UPDATE ai_provider_keys SET is_active = false WHERE org_id = $1`, [orgA]);
    const after = await owner.query(`SELECT row_version FROM ai_provider_keys WHERE org_id = $1`, [
      orgA,
    ]);
    expect(after.rows[0].row_version).toBe(before.rows[0].row_version + 1);
  });

  it('registers the three workspace capability keys', async () => {
    const defs = await owner.query(
      `SELECT key FROM permission_defs WHERE key LIKE 'aiadm.%' ORDER BY key`,
    );
    expect(defs.rows.map((r) => r.key)).toEqual([
      'aiadm.keys.manage',
      'aiadm.keys.read',
      'aiadm.usage.read',
    ]);
  });
});
