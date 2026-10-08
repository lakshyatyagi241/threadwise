import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, verifySchema } from '@crm/db';

/**
 * Structural invariants over the WHOLE schema, read from the catalog.
 *
 * rls.spec.ts proves isolation for the tables it seeds. This suite proves the
 * rules that make isolation hold for tables nobody has written a test for yet:
 * every tenant table forces RLS behind a policy that actually names the tenant
 * function, every reference between tenant tables carries org_id, and the
 * Drizzle schema still describes what the migrations built. A table added next
 * month is covered the day it is added.
 */
describe('schema invariants', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;

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
  }, 180_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  it('every table with an org_id column forces RLS behind a policy that names the tenant', async () => {
    const { rows } = await owner.query<{ table: string; enabled: boolean; forced: boolean }>(`
      SELECT c.relname AS "table", c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)
    `);
    expect(rows.length).toBeGreaterThan(100);
    const notForced = rows.filter((r) => !r.enabled || !r.forced).map((r) => r.table);
    expect(notForced).toEqual([]);

    const policies = await owner.query<{
      table: string;
      cmd: string;
      qual: string | null;
      check: string | null;
    }>(`
      SELECT tablename AS "table", cmd, qual, with_check AS "check" FROM pg_policies WHERE schemaname = 'public'
    `);
    const byTable = new Map<string, { cmd: string; qual: string | null; check: string | null }[]>();
    for (const p of policies.rows) byTable.set(p.table, [...(byTable.get(p.table) ?? []), p]);
    const weak = rows
      .map((r) => r.table)
      .filter((t) => {
        const ps = byTable.get(t) ?? [];
        // either one policy gates both what is visible and what may be written, by the tenant function, or the
        // tenant may only read its own rows (a SELECT policy by the tenant function) and every write is
        // privileged-only (a workspace must not write its own entitlement rows, e.g. marketplace_subscriptions)
        const both = ps.some(
          (p) =>
            /current_org_id\(\)/.test(p.qual ?? '') && /current_org_id\(\)/.test(p.check ?? ''),
        );
        const readOnlyForTenant =
          ps.some((p) => p.cmd === 'SELECT' && /current_org_id\(\)/.test(p.qual ?? '')) &&
          ps
            .filter((p) => p.cmd !== 'SELECT')
            .every((p) => /app_is_privileged\(\)/.test(`${p.qual ?? ''}${p.check ?? ''}`));
        return !(both || readOnlyForTenant);
      });
    expect(weak).toEqual([]);
  });

  it('every table without an org_id is either the tenant table, a registry, or behind a privileged-only or read-only policy', async () => {
    const { rows } = await owner.query<{ table: string; forced: boolean }>(`
      SELECT c.relname AS "table", c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition
        AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)
    `);
    // permission_defs is the compile-time capability registry (migration-written, select-only);
    // _migrations is the journal. Everything else without org_id must be RLS-protected.
    const unprotected = rows
      .filter((r) => !r.forced)
      .map((r) => r.table)
      .sort();
    // workspace_preset_baseline: the global list of grants every organization's preset roles receive (select-only, migration-written)
    expect(unprotected).toEqual(['_migrations', 'permission_defs', 'workspace_preset_baseline']);
  });

  it('every foreign key into a tenant table carries org_id (a cross-tenant reference is structurally impossible)', async () => {
    const { rows } = await owner.query<{
      conname: string;
      child: string;
      parent: string;
      cols: string[];
      parent_cols: string[];
    }>(`
      SELECT c.conname, rel.relname AS child, frel.relname AS parent,
             (SELECT array_agg(att.attname::text ORDER BY k.ord)
                FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.attnum) AS cols,
             (SELECT array_agg(att.attname::text ORDER BY k.ord)
                FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute att ON att.attrelid = c.confrelid AND att.attnum = k.attnum) AS parent_cols
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_class frel ON frel.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname = 'public' AND c.contype = 'f' AND c.conparentid = 0
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attname = 'org_id' AND NOT a.attisdropped)
    `);
    expect(rows.length).toBeGreaterThan(200);
    // A tenant table may reference a global table by a plain key, but never another tenant table without org_id. What makes a
    // reference tenant-safe is the PARENT side: the key must include the parent's org_id. The child column may be named differently
    // (impersonation_sessions keeps the workspace it acts in as target_workspace_id, referencing users (org_id, id)).
    const offenders = rows
      .filter((r) => !r.parent_cols.includes('org_id'))
      .map((r) => `${r.child}.${r.conname} -> ${r.parent}`);
    expect(offenders).toEqual([]);
  });

  it('tenant tables are keyed by (org_id, id); streams by (id, partition key) and have no foreign keys', async () => {
    const pks = await owner.query<{ table: string; cols: string[]; partitioned: boolean }>(`
      SELECT rel.relname AS "table",
             (SELECT array_agg(att.attname::text ORDER BY k.ord)
                FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.attnum) AS cols,
             (rel.relkind = 'p') AS partitioned
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname = 'public' AND c.contype = 'p' AND NOT rel.relispartition
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = rel.oid AND a.attname = 'org_id' AND NOT a.attisdropped)
    `);
    // 1:1 per-user tables keyed by (org_id, user_id) are the documented exceptions from auth_core.
    const badTenantKeys = pks.rows
      .filter((r) => !r.partitioned && r.cols[0] !== 'org_id')
      .map((r) => `${r.table}(${r.cols.join(',')})`);
    expect(badTenantKeys).toEqual([]);

    const streams = pks.rows.filter((r) => r.partitioned).map((r) => r.table);
    expect(streams.length).toBeGreaterThan(10);
    const fks = await owner.query<{ table: string }>(
      `SELECT rel.relname AS "table" FROM pg_constraint c JOIN pg_class rel ON rel.oid = c.conrelid
       WHERE c.contype = 'f' AND rel.relname = ANY($1) AND c.conparentid = 0`,
      [streams],
    );
    expect(fks.rows.map((r) => r.table)).toEqual([]);

    // every stream has a default partition so a gap in partition maintenance cannot fail a write
    const defaults = await owner.query<{ parent: string }>(
      `SELECT parent.relname AS parent FROM pg_inherits i
       JOIN pg_class child ON child.oid = i.inhrelid
       JOIN pg_class parent ON parent.oid = i.inhparent
       WHERE child.relname = parent.relname || '_default'`,
    );
    const withDefault = new Set(defaults.rows.map((r) => r.parent));
    expect(streams.filter((s) => !withDefault.has(s))).toEqual([]);
  });

  it('the app role is not a superuser and is subject to the policies it was just checked against', async () => {
    const { rows } = await owner.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'crm_app_user'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('every partition of a protected parent enforces the same tenant policy itself', async () => {
    const { rows } = await owner.query<{
      table: string;
      enabled: boolean;
      forced: boolean;
      has_policy: boolean;
    }>(`
      SELECT c.relname AS "table", c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             EXISTS (
               SELECT 1 FROM pg_policy pol
               WHERE pol.polrelid = c.oid
                 AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%current_org_id()%'
                 AND pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%current_org_id()%'
             ) AS has_policy
      FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
      JOIN pg_class parent ON parent.oid = i.inhparent
      WHERE c.relkind IN ('r', 'p') AND c.relnamespace = 'public'::regnamespace
        AND parent.relrowsecurity
    `);
    expect(rows.length).toBeGreaterThan(80);
    // A query that names a partition skips the parent's policies and uses the partition's own, so a
    // partition with none returns every tenant's rows. A migration that creates a partition by hand
    // (a stream's _default) must call inherit_partition_rls() on it.
    const unprotected = rows
      .filter((r) => !r.enabled || !r.forced || !r.has_policy)
      .map((r) => r.table);
    expect(unprotected).toEqual([]);
  });

  it('every SECURITY DEFINER function pins its search_path and is closed to PUBLIC', async () => {
    const { rows } = await owner.query<{ name: string; pinned: boolean; open_to_public: boolean }>(`
      SELECT p.proname AS name,
             EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search\\_path=%') AS pinned,
             -- a NULL ACL is the default grant, which includes PUBLIC
             (p.proacl IS NULL OR EXISTS (
               SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
             )) AS open_to_public
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
    `);
    // Such a function runs with its owner's rights; an unpinned search_path lets a caller
    // redirect names it resolves, and an open EXECUTE lets any role at all call it.
    expect(rows.map((r) => r.name)).toContain('ensure_monthly_partition');
    expect(rows.filter((r) => !r.pinned).map((r) => r.name)).toEqual([]);
    expect(rows.filter((r) => r.open_to_public).map((r) => r.name)).toEqual([]);
  });

  it('the Drizzle schema describes what the migrations built', async () => {
    const result = await verifySchema(owner);
    // Warnings are drift that cannot break a query (an undeclared FK, a default Drizzle does not know);
    // errors are the ones that become runtime failures.
    expect(result.errors).toEqual([]);
    expect(result.declared).toBeGreaterThan(200);
  });
});
