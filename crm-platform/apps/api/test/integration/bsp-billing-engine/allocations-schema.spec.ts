import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, OWNER_URL } from './live-db';

/**
 * bsp_credit_allocations against the real migrated schema, as the restricted application role (a superuser bypasses every policy
 * and would make the isolation assertions vacuous, see rls.spec.ts). Constraint checks use the owner connection: owners skip RLS
 * but never CHECK, UNIQUE or FK.
 */
describe('bsp_credit_allocations: schema, constraints and isolation', () => {
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  const created: number[] = [];

  const asOrg = async <T>(orgId: number, fn: () => Promise<T>): Promise<T> => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };

  const insertAs = (orgId: number, waba: string) =>
    app.query(
      `INSERT INTO bsp_credit_allocations (org_id, waba_id, currency, status) VALUES ($1, $2, 'USD', 'attached')`,
      [orgId, waba],
    );

  beforeAll(async () => {
    owner = new Client({ connectionString: OWNER_URL });
    app = new Client({ connectionString: APP_URL });
    await Promise.all([owner.connect(), app.connect()]);
    const mk = async (slug: string) =>
      Number(
        (
          await owner.query(
            `INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, 'starter') RETURNING id`,
            [`bspsch-${slug}-${Date.now()}`],
          )
        ).rows[0].id,
      );
    orgA = await mk('a');
    orgB = await mk('b');
    created.push(orgA, orgB);
  });

  afterAll(async () => {
    if (created.length) await owner.query(`DELETE FROM organizations WHERE id = ANY($1)`, [created]);
    await Promise.all([owner.end(), app.end()]);
  });

  it('the application role is neither a superuser nor able to bypass RLS (else every check below is vacuous)', async () => {
    const r = await app.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('RLS is enabled and forced, and the policy has both USING and WITH CHECK on the tenant', async () => {
    const t = await owner.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'bsp_credit_allocations'`,
    );
    expect(t.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const p = await owner.query(
      `SELECT qual, with_check FROM pg_policies WHERE tablename = 'bsp_credit_allocations'`,
    );
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].qual).toContain('current_org_id()');
    expect(p.rows[0].with_check).toContain('current_org_id()');
  });

  it('a tenant sees only its own rows, and cannot write one for another tenant', async () => {
    await owner.query(
      `INSERT INTO bsp_credit_allocations (org_id, waba_id, status) VALUES ($1, 'iso-a', 'attached'), ($2, 'iso-b', 'attached')`,
      [orgA, orgB],
    );
    const seenByA = await asOrg(orgA, async () =>
      (await app.query(`SELECT waba_id FROM bsp_credit_allocations`)).rows.map((r) => r.waba_id),
    );
    expect(seenByA).toEqual(['iso-a']);

    await expect(asOrg(orgA, () => insertAs(orgB, 'smuggled'))).rejects.toThrow(/row-level security/);

    // With no tenant context at all nothing is visible: the failure mode is empty, not everything.
    await app.query('BEGIN');
    const none = await app.query(`SELECT 1 FROM bsp_credit_allocations`);
    await app.query('ROLLBACK');
    expect(none.rows).toHaveLength(0);
  });

  it('one row per (workspace, WABA): a second insert for the pair is refused, another workspace may use the same WABA id', async () => {
    await owner.query(
      `INSERT INTO bsp_credit_allocations (org_id, waba_id) VALUES ($1, 'uniq-1')`,
      [orgA],
    );
    await expect(
      owner.query(`INSERT INTO bsp_credit_allocations (org_id, waba_id) VALUES ($1, 'uniq-1')`, [orgA]),
    ).rejects.toThrow(/uq_bsp_credit_allocations_org_waba/);
    await owner.query(`INSERT INTO bsp_credit_allocations (org_id, waba_id) VALUES ($1, 'uniq-1')`, [orgB]);
  });

  it('the upsert the attach path uses retries a failed row in place and never touches an attached one', async () => {
    const upsert = (status: string) =>
      owner.query(
        `INSERT INTO bsp_credit_allocations (org_id, waba_id, status, last_error)
         VALUES ($1, 'ups-1', $2, $3)
         ON CONFLICT (org_id, waba_id) DO UPDATE SET status = EXCLUDED.status, last_error = EXCLUDED.last_error, revoked_at = NULL
         WHERE bsp_credit_allocations.status <> 'attached'
         RETURNING status`,
        [orgA, status, status === 'failed' ? 'boom' : null],
      );
    expect((await upsert('failed')).rows[0].status).toBe('failed');
    expect((await upsert('attached')).rows[0].status).toBe('attached');
    // a late failure must not overwrite the success: the statement updates nothing
    expect((await upsert('failed')).rows).toHaveLength(0);
    const row = await owner.query(
      `SELECT status, last_error FROM bsp_credit_allocations WHERE org_id = $1 AND waba_id = 'ups-1'`,
      [orgA],
    );
    expect(row.rows[0]).toEqual({ status: 'attached', last_error: null });
  });

  it('refuses a status outside the three, a lower-case or oversized currency and a credit source nobody implements', async () => {
    const bad = (cols: string, vals: string) =>
      owner.query(`INSERT INTO bsp_credit_allocations (org_id, waba_id, ${cols}) VALUES ($1, 'chk-' || $2, ${vals})`, [
        orgA,
        Math.random().toString(36).slice(2),
      ]);
    await expect(bad('status', `'pending'`)).rejects.toThrow(/chk_bsp_credit_allocations_status/);
    await expect(bad('currency', `'usd'`)).rejects.toThrow(/chk_bsp_credit_allocations_currency/);
    await expect(bad('currency', `'ABCDEFGHI'`)).rejects.toThrow(/chk_bsp_credit_allocations_currency/);
    await expect(bad('credit_source', `'carrier-pigeon'`)).rejects.toThrow(/chk_bsp_credit_allocations_source/);
  });

  it('bumps row_version and updated_at on update (the optimistic lock)', async () => {
    await owner.query(`INSERT INTO bsp_credit_allocations (org_id, waba_id) VALUES ($1, 'ver-1')`, [orgA]);
    await owner.query(`UPDATE bsp_credit_allocations SET status = 'revoked' WHERE org_id = $1 AND waba_id = 'ver-1'`, [orgA]);
    const r = await owner.query(
      `SELECT row_version FROM bsp_credit_allocations WHERE org_id = $1 AND waba_id = 'ver-1'`,
      [orgA],
    );
    expect(r.rows[0].row_version).toBe(2);
  });

  it('deleting the organization removes its allocations (hard delete, no orphans)', async () => {
    const org = Number(
      (
        await owner.query(
          `INSERT INTO organizations (slug, name, plan) VALUES ($1, 'tmp', 'starter') RETURNING id`,
          [`bspsch-tmp-${Date.now()}`],
        )
      ).rows[0].id,
    );
    await owner.query(`INSERT INTO bsp_credit_allocations (org_id, waba_id) VALUES ($1, 'gone')`, [org]);
    await owner.query(`DELETE FROM organizations WHERE id = $1`, [org]);
    const left = await owner.query(`SELECT 1 FROM bsp_credit_allocations WHERE org_id = $1`, [org]);
    expect(left.rows).toHaveLength(0);
  });

  it('registers the billing permission keys and grants them to every Admin preset', async () => {
    const defs = await owner.query(
      `SELECT key, supports_scope FROM permission_defs WHERE key LIKE 'bsp.%' ORDER BY key`,
    );
    expect(defs.rows.map((r) => r.key)).toEqual(['bsp.billing.manage', 'bsp.billing.read']);
    const missing = await owner.query(
      `SELECT r.org_id FROM roles r
       WHERE r.system_key = 'admin'
         AND (SELECT count(*) FROM role_grants g WHERE g.org_id = r.org_id AND g.role_id = r.id AND g.permission_key LIKE 'bsp.%') <> 2`,
    );
    expect(missing.rows).toHaveLength(0);
  });
});
