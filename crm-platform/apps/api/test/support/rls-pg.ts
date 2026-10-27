import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { startTestPg, type TestPg } from './pg-it';

export interface RlsPg {
  /** The migrated database and its owner connection (sees every row; use it to arrange and to look). */
  pg: TestPg;
  /** A new workspace; returns its id. */
  newOrg(slug: string): Promise<number>;
  /**
   * One transaction in the workspace as the restricted application role, with the tenant set the way the app's own transactions set
   * it, so row-level security judges every statement. Whatever `fn` writes is rolled back if it throws.
   */
  inOrg<T>(orgId: number, fn: (tx: never) => Promise<T>): Promise<T>;
  stop(): Promise<void>;
}

/**
 * A migrated throwaway Postgres plus the restricted `crm_app_user` role a request runs as. The migrations grant to that role only when
 * it already exists and `startTestPg` migrates first, so the role is created here with the grants the app role has.
 */
export async function startRlsPg(): Promise<RlsPg> {
  const pg = await startTestPg();
  await pg.owner.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app_user') THEN
      CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF; END $$`);
  await pg.owner.query(`GRANT USAGE ON SCHEMA public TO crm_app_user`);
  await pg.owner.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app_user`,
  );
  await pg.owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app_user`);
  const appUrl = `${pg.uri}${pg.uri.includes('?') ? '&' : '?'}options=-c%20role%3Dcrm_app_user`;
  const app = new Pool({ connectionString: appUrl, max: 4 });
  return {
    pg,
    async newOrg(slug) {
      const r = await pg.owner.query(
        `INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, 'starter') RETURNING id`,
        [slug],
      );
      return Number(r.rows[0].id);
    },
    inOrg: (orgId, fn) =>
      drizzle(app).transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.org_id', ${String(orgId)}, true)`);
        return fn(tx as never);
      }),
    async stop() {
      await app.end().catch(() => undefined);
      await pg.stop();
    },
  };
}
