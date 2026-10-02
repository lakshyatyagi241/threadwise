import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withPrivileged, type DbClient } from '@crm/db';
import { SetupRepository } from '../../../src/modules/install-update-licensing/setup.repository';

/**
 * The first-run lock as a property of the database (WD-INST-001, -015): forced RLS on a platform table, the
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

  async function seedOrg(tx: Parameters<typeof repo.state>[0]): Promise<number> {
    const { sql } = await import('drizzle-orm');
    const res = await tx.execute(
      sql`INSERT INTO organizations (slug, name, plan) VALUES (${`o-${Date.now()}-${Math.random()}`}, 'Seeded', 'starter') RETURNING id`,
    );
    return Number((res.rows[0] as { id: number }).id);
  }

  /** The operator and workspace step 4 creates, linked on the singleton row. */
  async function provision(tx: Parameters<typeof repo.state>[0]): Promise<number> {
    const op = await repo.insertOperator(tx, {
      email: `op-${Date.now()}-${Math.random()}@example.test`,
      fullName: 'Owner',
      passwordHash: 'x',
    });
    await repo.lockRow(tx);
    await repo.linkProvisioned(tx, { operatorId: op.id, orgId: await seedOrg(tx), appUrl: null });
    return op.id;
  }

  it('keeps run_step between 0 and 6', async () => {
    await reset();
    await expect(
      owner.query('INSERT INTO platform_setup (id, run_step) VALUES (1, 7)'),
    ).rejects.toThrow(/chk_platform_setup_run_step/);
    await expect(
      owner.query('INSERT INTO platform_setup (id, run_step) VALUES (1, -1)'),
    ).rejects.toThrow(/chk_platform_setup_run_step/);
  });

  it('creates the row on first use and only ever moves the step forward', async () => {
    await reset();
    await withPrivileged(appDb.db, (tx) => repo.advance(tx, 2));
    await withPrivileged(appDb.db, (tx) => repo.advance(tx, 1));
    await withPrivileged(appDb.db, (tx) => repo.advance(tx, 3));
    await withPrivileged(appDb.db, (tx) => repo.advance(tx, 3));
    const state = await withPrivileged(appDb.db, (tx) => repo.state(tx));
    expect(state.runStep).toBe(3);
    expect(state.completedAt).toBeNull();
  });

  it('reports an empty deployment as step 0 with no row at all', async () => {
    await reset();
    const state = await withPrivileged(appDb.db, (tx) => repo.state(tx));
    expect(state).toMatchObject({
      completedAt: null,
      runStep: 0,
      firstOperatorId: null,
      firstOrgId: null,
    });
  });

  it('links what step 4 created, and counts only operators that run did not create as foreign', async () => {
    await reset();
    await owner.query('DELETE FROM platform_operators');
    const first = await withPrivileged(appDb.db, (tx) => provision(tx));
    let state = await withPrivileged(appDb.db, (tx) => repo.state(tx));
    expect(state).toMatchObject({ firstOperatorId: first, runStep: 4, foreignOperators: 0 });

    // an operator made some other way (the CLI) means somebody else already owns the platform
    await owner.query(
      `INSERT INTO platform_operators (email, full_name, password_hash, role) VALUES ('cli@example.test', 'CLI', 'x', 'super_admin')`,
    );
    state = await withPrivileged(appDb.db, (tx) => repo.state(tx));
    expect(state.foreignOperators).toBe(1);
    await owner.query(`DELETE FROM platform_operators WHERE email = 'cli@example.test'`);
  });

  it('complete takes the lock once, and only after an operator was linked', async () => {
    await reset();
    await owner.query('DELETE FROM platform_operators');
    // nothing provisioned yet: there is nothing to lock
    await withPrivileged(appDb.db, (tx) => repo.lockRow(tx));
    expect(await withPrivileged(appDb.db, (tx) => repo.complete(tx, '1.0.0'))).toBeNull();

    await withPrivileged(appDb.db, (tx) => provision(tx));
    const first = await withPrivileged(appDb.db, (tx) => repo.complete(tx, '1.0.0'));
    expect(first).toBeInstanceOf(Date);
    expect(await withPrivileged(appDb.db, (tx) => repo.complete(tx, '9.9.9'))).toBeNull();

    const row = await owner.query('SELECT completed_version, run_step FROM platform_setup');
    expect(row.rows).toEqual([{ completed_version: '1.0.0', run_step: 6 }]);
  });

  it('advance never touches a completed install', async () => {
    await withPrivileged(appDb.db, (tx) => repo.advance(tx, 1));
    const row = await owner.query('SELECT run_step FROM platform_setup');
    expect(row.rows).toEqual([{ run_step: 6 }]);
  });

  it('serialises two finalizes: the second waits on the row lock, then finds the install complete', async () => {
    await reset();
    await owner.query('DELETE FROM platform_operators');
    await withPrivileged(appDb.db, (tx) => provision(tx));

    let releaseWinner!: () => void;
    const winnerMayCommit = new Promise<void>((r) => (releaseWinner = r));
    let winnerLocked!: () => void;
    const winnerHoldsLock = new Promise<void>((r) => (winnerLocked = r));

    const winner = withPrivileged(appDb.db, async (tx) => {
      await repo.lockRow(tx);
      winnerLocked();
      await winnerMayCommit;
      return repo.complete(tx, 'winner');
    });
    await winnerHoldsLock;

    let loserSettled = false;
    const loser = withPrivileged(appDb.db, async (tx) => {
      const row = await repo.lockRow(tx);
      return { sawCompleted: row.completedAt !== null, at: await repo.complete(tx, 'loser') };
    }).then((v) => {
      loserSettled = true;
      return v;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(loserSettled).toBe(false);

    releaseWinner();
    const [w, l] = await Promise.all([winner, loser]);
    expect(w).toBeInstanceOf(Date);
    expect(l).toEqual({ sawCompleted: true, at: null });
    const row = await owner.query('SELECT completed_version FROM platform_setup');
    expect(row.rows).toEqual([{ completed_version: 'winner' }]);
  });

  it('a rolled-back finalize leaves the lock open', async () => {
    await reset();
    await owner.query('DELETE FROM platform_operators');
    await withPrivileged(appDb.db, (tx) => provision(tx));
    await expect(
      withPrivileged(appDb.db, async (tx) => {
        await repo.complete(tx, '1');
        throw new Error('boom after the lock');
      }),
    ).rejects.toThrow('boom');
    const state = await withPrivileged(appDb.db, (tx) => repo.state(tx));
    expect(state.completedAt).toBeNull();
  });

  it('summarises the operator and workspace for the final response', async () => {
    await reset();
    await owner.query('DELETE FROM platform_operators');
    expect(await withPrivileged(appDb.db, (tx) => repo.summary(tx))).toBeNull();
    await withPrivileged(appDb.db, (tx) => provision(tx));
    const summary = await withPrivileged(appDb.db, (tx) => repo.summary(tx));
    expect(summary?.operator.email).toMatch(/@example\.test$/);
    expect(summary?.org.name).toBe('Seeded');
  });

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
