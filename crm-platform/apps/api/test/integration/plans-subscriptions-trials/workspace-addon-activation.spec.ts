import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Tx } from '@crm/db';
import {
  activationOf,
  packIdOfApp,
  setActivation,
  syncAppActivation,
} from '../../../src/modules/plans-subscriptions-trials/addon-activation';

/**
 * A workspace's own switch on an add-on (`workspace_addon_activation`) on real Postgres with every migration: the table's isolation and checks,
 * the writes the lifecycle service and the Marketplace's install / uninstall make, and the permission the routes need.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');

describe('workspace_addon_activation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let tx: Tx;
  let orgA = 0;
  let orgB = 0;
  let plain = 0;
  let appPack = 0;
  let appId = 0;

  const org = async (slug: string) =>
    Number(
      (
        await owner.query(
          `INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, 'pro') RETURNING id`,
          [slug],
        )
      ).rows[0].id,
    );

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    tx = drizzle(owner) as unknown as Tx;
    orgA = await org('act-a');
    orgB = await org('act-b');
    plain = Number(
      (
        await owner.query(
          `INSERT INTO plans (slug, kind, name, amount, features) VALUES ('act_plain', 'addon', 'Plain', 9, '{"inbox_routing": true}') RETURNING id`,
        )
      ).rows[0].id,
    );
    const cat = await owner.query('SELECT id FROM marketplace_categories LIMIT 1');
    appId = Number(
      (
        await owner.query(
          `INSERT INTO marketplace_apps (slug, kind, category_id, name, tagline, status, pricing_model, price_amount, price_currency)
           VALUES ('act-app', 'mini_app', $1, 'act-app', 't', 'draft', 'paid_monthly', 9, 'USD') RETURNING id`,
          [cat.rows[0].id],
        )
      ).rows[0].id,
    );
    appPack = Number(
      (
        await owner.query(
          `INSERT INTO plans (slug, kind, name, amount, marketplace_app_id) VALUES ('mkt_actapp', 'addon', 'App', 9, $1) RETURNING id`,
          [appId],
        )
      ).rows[0].id,
    );
  }, 180_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  it('has row-level security enabled and forced with a tenant policy, a state check and one row per add-on per workspace', async () => {
    const rls = await owner.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'workspace_addon_activation'`,
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const pol = await owner.query(
      `SELECT policyname FROM pg_policies WHERE tablename = 'workspace_addon_activation'`,
    );
    expect(pol.rows.map((r) => r.policyname)).toContain('tenant_isolation');
    await expect(
      owner.query(
        `INSERT INTO workspace_addon_activation (org_id, addon_id, state) VALUES ($1, $2, 'paused')`,
        [orgA, plain],
      ),
    ).rejects.toThrow(/chk_workspace_addon_activation_state/);
  });

  it('setActivation switches one workspace only; switching back keeps the row; no row means active', async () => {
    expect((await activationOf(tx, orgA)).size).toBe(0);
    await setActivation(tx, orgA, plain, 'disabled', { userId: null });
    expect((await activationOf(tx, orgA)).get(plain)).toBe('disabled');
    expect((await activationOf(tx, orgB)).get(plain)).toBeUndefined();
    await setActivation(tx, orgA, plain, 'disabled', { userId: null });
    await setActivation(tx, orgA, plain, 'active', { userId: null });
    expect((await activationOf(tx, orgA)).get(plain)).toBe('active');
    expect(
      (
        await owner.query(
          `SELECT count(*)::int AS n FROM workspace_addon_activation WHERE org_id = $1`,
          [orgA],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("an app's disable and uninstall record an opt-out, its install and enable lift one and write nothing when there is none; a free app has no add-on", async () => {
    expect(await packIdOfApp(tx, appId)).toBe(appPack);
    await syncAppActivation(tx, orgB, appId, 'active', null);
    expect((await activationOf(tx, orgB)).size).toBe(0);
    await syncAppActivation(tx, orgB, appId, 'disabled', null);
    expect((await activationOf(tx, orgB)).get(appPack)).toBe('disabled');
    await syncAppActivation(tx, orgB, appId, 'active', null);
    expect((await activationOf(tx, orgB)).get(appPack)).toBe('active');
    expect(await packIdOfApp(tx, 999_999)).toBeNull();
    await expect(syncAppActivation(tx, orgB, 999_999, 'disabled', null)).resolves.toBeUndefined();
  });

  it('registers addons.activation.manage and gives it to the admin presets', async () => {
    const def = await owner.query(
      `SELECT category FROM permission_defs WHERE key = 'addons.activation.manage'`,
    );
    expect(def.rows[0]?.category).toBe('addons');
    const baseline = await owner.query(
      `SELECT preset_key FROM workspace_preset_baseline WHERE permission_key = 'addons.activation.manage' ORDER BY preset_key`,
    );
    expect(baseline.rows.map((r) => r.preset_key)).toEqual(['admin', 'workspace_admin']);
  });

  it('is removed with the workspace and with the add-on', async () => {
    await setActivation(tx, orgA, plain, 'disabled', { userId: null });
    await owner.query(`DELETE FROM plans WHERE id = $1`, [plain]);
    expect(
      (
        await owner.query(
          `SELECT count(*)::int AS n FROM workspace_addon_activation WHERE addon_id = $1`,
          [plain],
        )
      ).rows[0].n,
    ).toBe(0);
    await owner.query(`DELETE FROM organizations WHERE id = $1`, [orgB]);
    expect(
      (
        await owner.query(
          `SELECT count(*)::int AS n FROM workspace_addon_activation WHERE org_id = $1`,
          [orgB],
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
