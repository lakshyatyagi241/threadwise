import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withPrivileged, type DbClient } from '@crm/db';
import { AddonFulfilmentService } from '../../../src/modules/addons-extension-registry/addon-fulfilment.service';

/**
 * The add-on tables against a real Postgres as the restricted application role (a superuser would bypass every
 * policy): tenants read their purchases but cannot write them, one order is one row, a purchased add-on cannot be
 * deleted, and fulfilment is idempotent. Constraint checks use the owner connection (owners skip RLS, never CHECK).
 */
describe('add-on schema, RLS and fulfilment', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let dbClient: DbClient;
  let orgA: number;
  let orgB: number;
  let addonId: number;
  let planId: number;

  async function inTx<T>(setup: string[], fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      for (const s of setup) await app.query(s);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  const asOrg = <T>(id: number, fn: () => Promise<T>) =>
    inTx([`SELECT set_config('app.org_id', '${id}', true)`], fn);

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
    orgA = await org('add-org-a');
    orgB = await org('add-org-b');
    const plan = await owner.query(
      `INSERT INTO plans (slug, name, is_free, kind) VALUES ('base', 'Base', true, 'plan') RETURNING id`,
    );
    planId = Number(plan.rows[0].id);
    const addon = await owner.query(
      `INSERT INTO plans (slug, name, is_free, kind, amount) VALUES ('seats_5', 'Seats', false, 'addon', '9.00') RETURNING id`,
    );
    addonId = Number(addon.rows[0].id);
    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
    dbClient = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
  }, 180_000);

  afterAll(async () => {
    await dbClient?.close();
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  let seq = 0;
  /** A real order (workspace_addons.order_id is a foreign key to orders). */
  const order = async (org: number) =>
    Number(
      (
        await owner.query(
          `INSERT INTO orders (org_id, order_number, currency, amount, plan_slug) VALUES ($1, $2, 'USD', 9, 'seats_5') RETURNING id`,
          [org, `T-${++seq}`],
        )
      ).rows[0].id,
    );

  const grant = (org: number, order: number | null = null) =>
    owner.query(
      `INSERT INTO workspace_addons (org_id, package_id, order_id, status) VALUES ($1, $2, $3, 'active')`,
      [org, addonId, order],
    );

  it('lets a tenant read only its own purchases', async () => {
    await grant(orgA);
    await grant(orgB);
    const rows = await asOrg(orgA, () => app.query('SELECT org_id FROM workspace_addons'));
    expect(rows.rows.map((r) => Number(r.org_id))).toEqual([orgA]);
  });

  it('refuses a tenant that tries to grant itself an add-on', async () => {
    await expect(
      asOrg(orgA, () =>
        app.query(`INSERT INTO workspace_addons (org_id, package_id) VALUES ($1, $2)`, [
          orgA,
          addonId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('allows a privileged transaction to write', async () => {
    const res = await inTx([`SELECT set_config('app.privileged', 'on', true)`], () =>
      app.query(`INSERT INTO workspace_addons (org_id, package_id) VALUES ($1, $2) RETURNING id`, [
        orgA,
        addonId,
      ]),
    );
    expect(res.rowCount).toBe(1);
  });

  it('stores one row per (org, order, pack) and still allows rows with no order', async () => {
    const o1 = await order(orgA);
    await grant(orgA, o1);
    await expect(grant(orgA, o1)).rejects.toThrow(/uq_workspace_addons_order/);
    await grant(orgA, await order(orgA));
    await grant(orgA, null);
    await grant(orgA, null);
  });

  it('refuses to delete a purchased add-on and a bad status or period', async () => {
    await grant(orgB, await order(orgB));
    await expect(owner.query(`DELETE FROM plans WHERE id = $1`, [addonId])).rejects.toThrow(
      /fk_workspace_addons_package_id/,
    );
    await expect(
      owner.query(`INSERT INTO workspace_addons (org_id, package_id, status) VALUES ($1,$2,'x')`, [
        orgA,
        addonId,
      ]),
    ).rejects.toThrow(/chk_workspace_addons_status/);
    await expect(
      owner.query(
        `INSERT INTO workspace_addons (org_id, package_id, starts_at, ends_at) VALUES ($1,$2, now(), now() - interval '1 day')`,
        [orgA, addonId],
      ),
    ).rejects.toThrow(/chk_workspace_addons_period/);
  });

  it('keeps add-on rows out of the default and custom-quote roles, and slugs folder-safe', async () => {
    await expect(
      owner.query(
        `INSERT INTO plans (slug, name, is_free, kind, is_default) VALUES ('bad', 'Bad', true, 'addon', true)`,
      ),
    ).rejects.toThrow(/chk_plans_addon_shape/);
    await expect(
      owner.query(`INSERT INTO extensions (slug, name, status) VALUES ('../evil', 'x', 'active')`),
    ).rejects.toThrow(/chk_extensions_slug/);
    await expect(
      owner.query(`INSERT INTO extensions (slug, name, status) VALUES ('ok', 'x', 'bogus')`),
    ).rejects.toThrow(/chk_extensions_status/);
  });

  it('fulfils an order once: the replay writes nothing and a second order stacks', async () => {
    const outbox = { emit: async () => undefined } as never;
    const svc = new AddonFulfilmentService(outbox, { run: async () => undefined } as never);
    const [o1, o2, o3] = [await order(orgA), await order(orgA), await order(orgA)];
    const run = (orderId: number) =>
      withPrivileged(dbClient.db, (tx) =>
        svc.fulfil(tx, { orgId: orgA, pack: 'seats_5', orderId }),
      );
    const first = await run(o1);
    const replay = await run(o1);
    const second = await run(o2);
    expect([first.created, replay.created, second.created]).toEqual([true, false, true]);
    const n = await owner.query(
      `SELECT count(*)::int AS n FROM workspace_addons WHERE order_id IN ($1, $2)`,
      [o1, o2],
    );
    expect(n.rows[0].n).toBe(2);
    // a plan is never an add-on
    await expect(
      withPrivileged(dbClient.db, (tx) =>
        svc.fulfil(tx, { orgId: orgA, pack: 'base', orderId: o3 }),
      ),
    ).rejects.toThrow();
    expect(planId).toBeGreaterThan(0);
  });
});
