import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withPrivileged, type DbClient } from '@crm/db';
import { SetupRepository } from '../../../src/modules/install-update-licensing/setup.repository';

/**
 * The first-run lock as a property of the database (TW-INST-001, -015): forced RLS on a platform table, the
 * singleton and consistency constraints, the atomic claim under a real race, and the migration ledger the
 * restricted role is allowed to read. Talks to the database as the restricted application role, as production does.
 */
describe('platform_setup and the migration ledger', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let appDb: DbClient;
  const repo = new SetupRepository();

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
    const appUrl = `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`;
    app = new Client({ connectionString: appUrl });
    await app.connect();
    appDb = createDbClient({ url: appUrl, poolMax: 4 });
  }, 180_000);

  afterAll(async () => {
    await appDb?.close();
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  const reset = () => owner.query('DELETE FROM platform_setup');

  it('is forced-RLS with a privileged-only policy: a plain connection sees and writes nothing', async () => {
    await reset();
    await owner.query(`INSERT INTO platform_setup (id) VALUES (1)`);

    const visible = await app.query('SELECT count(*)::int AS n FROM platform_setup');
    expect(visible.rows[0].n).toBe(0);

    await expect(app.query('INSERT INTO platform_setup (id) VALUES (1)')).rejects.toThrow(
      /row-level security|duplicate key|violates/i,
    );
    await expect(
      app.query(`UPDATE platform_setup SET app_url = 'x' WHERE id = 1`),
    ).resolves.toMatchObject({ rowCount: 0 });

    const rls = await owner.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'platform_setup'`,
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const policy = await owner.query(
      `SELECT pg_get_expr(polqual, polrelid) AS using_expr, pg_get_expr(polwithcheck, polrelid) AS check_expr
         FROM pg_policy WHERE polrelid = 'platform_setup'::regclass`,
    );
    expect(policy.rows).toEqual([
      { using_expr: 'app_is_privileged()', check_expr: 'app_is_privileged()' },
    ]);
  });

  it('rejects a second row and a half-written completion', async () => {
    await reset();
    await expect(owner.query('INSERT INTO platform_setup (id) VALUES (2)')).rejects.toThrow(
      /chk_platform_setup_singleton/,
    );
    await expect(
      owner.query(`INSERT INTO platform_setup (id, completed_at) VALUES (1, now())`),
    ).rejects.toThrow(/chk_platform_setup_complete/);
  });

  it('claim succeeds once on a missing row and never again', async () => {
    await reset();
    const org = await owner.query(
      `INSERT INTO organizations (slug, name, plan) VALUES ('claim-org','Claim Org','starter') RETURNING id`,
    );
    const orgId = Number(org.rows[0].id);

    const first = await withPrivileged(appDb.db, (tx) =>
      repo.claim(tx, { version: '1.0.0', orgId, appUrl: 'http://localhost:3001' }),
    );
    expect(first).toBeInstanceOf(Date);
    const second = await withPrivileged(appDb.db, (tx) =>
      repo.claim(tx, { version: '9.9.9', orgId, appUrl: null }),
    );
    expect(second).toBeNull();

    const row = await owner.query(
      'SELECT completed_version, first_org_id, app_url FROM platform_setup',
    );
    expect(row.rows).toEqual([
      { completed_version: '1.0.0', first_org_id: orgId, app_url: 'http://localhost:3001' },
    ]);
  });

  it('claim is atomic under a real race: the loser waits for the winner and gets nothing', async () => {
    await reset();
    const org = await owner.query(
      `INSERT INTO organizations (slug, name, plan) VALUES ('race-org','Race Org','starter') RETURNING id`,
    );
    const orgId = Number(org.rows[0].id);

    let releaseWinner!: () => void;
    const winnerMayCommit = new Promise<void>((r) => (releaseWinner = r));
    let winnerClaimed!: () => void;
    const winnerHoldsLock = new Promise<void>((r) => (winnerClaimed = r));

    const winner = withPrivileged(appDb.db, async (tx) => {
      const at = await repo.claim(tx, { version: 'winner', orgId, appUrl: null });
      winnerClaimed();
      await winnerMayCommit;
      return at;
    });
    await winnerHoldsLock;

    // Starts while the winner's transaction is still open, so it must block on the winner's row lock.
    let loserSettled = false;
    const loser = withPrivileged(appDb.db, (tx) =>
      repo.claim(tx, { version: 'loser', orgId, appUrl: null }),
    ).then((v) => {
      loserSettled = true;
      return v;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(loserSettled).toBe(false);

    releaseWinner();
    const [w, l] = await Promise.all([winner, loser]);
    expect(w).toBeInstanceOf(Date);
    expect(l).toBeNull();

    const row = await owner.query('SELECT completed_version FROM platform_setup');
    expect(row.rows).toEqual([{ completed_version: 'winner' }]);
  });

  it('a rolled-back claim leaves the lock open (the org and the operator vanish with it)', async () => {
    await reset();
    const org = await owner.query(
      `INSERT INTO organizations (slug, name, plan) VALUES ('rb-org','Rollback Org','starter') RETURNING id`,
    );
    await expect(
      withPrivileged(appDb.db, async (tx) => {
        await repo.claim(tx, { version: '1', orgId: Number(org.rows[0].id), appUrl: null });
        throw new Error('boom after the claim');
      }),
    ).rejects.toThrow('boom');
    const state = await withPrivileged(appDb.db, (tx) => repo.state(tx));
    expect(state.completedAt).toBeNull();
  });

  it('reports the operator count and links the first operator', async () => {
    await reset();
    await owner.query('DELETE FROM platform_operators');
    expect((await withPrivileged(appDb.db, (tx) => repo.state(tx))).operatorCount).toBe(0);

    const id = await withPrivileged(appDb.db, async (tx) => {
      const op = await repo.insertOperator(tx, {
        email: 'owner@example.test',
        fullName: 'Owner',
        passwordHash: 'x',
      });
      await repo.claim(tx, { version: '1', orgId: await seedOrg(tx), appUrl: null });
      await repo.linkOperator(tx, op.id);
      return op.id;
    });
    const row = await owner.query(
      `SELECT s.first_operator_id, o.role FROM platform_setup s JOIN platform_operators o ON o.id = s.first_operator_id`,
    );
    expect(row.rows).toEqual([{ first_operator_id: id, role: 'super_admin' }]);
    expect((await withPrivileged(appDb.db, (tx) => repo.state(tx))).operatorCount).toBe(1);
  });

  async function seedOrg(tx: Parameters<typeof repo.state>[0]): Promise<number> {
    const { sql } = await import('drizzle-orm');
    const res = await tx.execute(
      sql`INSERT INTO organizations (slug, name, plan) VALUES (${`o-${Date.now()}`}, 'Seeded', 'starter') RETURNING id`,
    );
    return Number((res.rows[0] as { id: number }).id);
  }

  it('lets the restricted role read the migration ledger and the permission count', async () => {
    const ledger = await withPrivileged(appDb.db, (tx) => repo.ledger(tx));
    expect(ledger.length).toBeGreaterThan(50);
    expect(ledger.some((l) => l.id === '20261003090000_inst_platform_setup')).toBe(true);
    expect(ledger[0]?.checksum).toMatch(/^[0-9a-f]{16}$/);

    expect(await withPrivileged(appDb.db, (tx) => repo.permissionDefCount(tx))).toBeGreaterThan(0);
  });

  it('keeps the ledger function out of PUBLIC', async () => {
    const acl = await owner.query(
      `SELECT has_function_privilege('public', 'platform_migration_ledger()', 'EXECUTE') AS pub,
              has_function_privilege('crm_app', 'platform_migration_ledger()', 'EXECUTE') AS app`,
    );
    expect(acl.rows[0]).toEqual({ pub: false, app: true });
  });
});
