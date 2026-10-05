import { Logger } from '@nestjs/common';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withPrivileged, withTenant, type DbClient } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { TenantDirectory } from '../../../src/modules/auth/platform/tenant-directory';
import { PlanCatalogService } from '../../../src/modules/plans-subscriptions-trials/plan-catalog.service';
import { PlanStore } from '../../../src/modules/plans-subscriptions-trials/plan-store';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';

/**
 * The plan catalogue and the per-organization plan state against a real
 * Postgres, as the restricted application role (a superuser would bypass every
 * policy and make the RLS assertions vacuous, see rls.spec.ts). Constraint
 * checks use the owner connection: owners skip RLS but never CHECK or UNIQUE.
 */
describe('plan schema, RLS and sign-up provisioning', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  const PLAN_CORE = '20261002090000_plan_core.sql';
  const DAY = 86_400_000;

  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let dbClient: DbClient;
  let db: DatabaseService;
  let directory: TenantDirectory;
  let entitlements: PlanEntitlementService;
  let catalog: PlanCatalogService;
  let orgA: number;
  let orgB: number;
  /** An organization with no org_plan_state row (a plain INSERT does not create one). */
  let orgBare: number;

  const q = (c: Client, text: string, params: unknown[] = []) => c.query(text, params);

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

  /** Inserts a plan with the given columns (jsonb columns may be passed as objects or raw JSON text). */
  async function insertPlan(c: Client, over: Record<string, unknown> & { slug: string }) {
    const row: Record<string, unknown> = { name: over.slug || 'Plan', is_free: true, ...over };
    const keys = Object.keys(row);
    const values = keys.map((k) => {
      const v = row[k];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const res = await c.query(
      `INSERT INTO plans (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id, uuid`,
      values,
    );
    return res.rows[0] as { id: number; uuid: string };
  }

  /** Expects the insert to be refused by the named CHECK/UNIQUE constraint. */
  const refuses = (over: Record<string, unknown> & { slug: string }, constraint: string | RegExp) =>
    expect(insertPlan(owner, over)).rejects.toThrow(constraint);

  const paidPlan = (slug: string, amount: string, extra: Record<string, unknown> = {}) => ({
    slug,
    is_free: false,
    amount,
    ...extra,
  });

  beforeAll(async () => {
    // The entitlement service warns once when an organization is on a plan with no catalogue row.
    Logger.overrideLogger(false);
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
          await q(owner, `INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            slug,
          ])
        ).rows[0].id,
      );
    orgA = await org('plan-org-a');
    orgB = await org('plan-org-b');
    orgBare = await org('plan-org-bare');
    await q(
      owner,
      `INSERT INTO org_plan_state (org_id, trial_ends_at, billing_cycle) VALUES
         ($1, now() + interval '5 days', 'trial'), ($2, now() + interval '9 days', 'trial')`,
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

    dbClient = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
    db = {
      primary: dbClient.db,
      privileged: (fn: Parameters<DatabaseService['privileged']>[0]) =>
        withPrivileged(dbClient.db, fn),
      txAs: (
        tenant: Parameters<DatabaseService['txAs']>[0],
        fn: Parameters<DatabaseService['txAs']>[1],
      ) => withTenant(dbClient.db, tenant, fn),
    } as unknown as DatabaseService;
    catalog = new PlanCatalogService(db);
    entitlements = new PlanEntitlementService(db, catalog, new PlanStore(db));
    directory = new TenantDirectory(db, entitlements);
  }, 180_000);

  afterAll(async () => {
    await dbClient?.close();
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  // Plans are platform-wide and orgs hold no foreign key to them, so each test starts from an empty catalogue.
  beforeEach(async () => {
    await owner.query('DELETE FROM plans');
  });

  describe('plans: the platform catalogue', () => {
    it('is readable by any transaction: with a tenant, with none, and as another tenant', async () => {
      await insertPlan(owner, { slug: 'free' });
      await insertPlan(owner, paidPlan('pro', '29.00'));

      const slugs = (rows: Array<{ slug: string }>) => rows.map((r) => r.slug).sort();
      const sql = 'SELECT slug FROM plans ORDER BY slug';
      expect(slugs((await asOrg(orgA, () => q(app, sql))).rows)).toEqual(['free', 'pro']);
      expect(slugs((await asOrg(orgB, () => q(app, sql))).rows)).toEqual(['free', 'pro']);
      expect(slugs((await asNobody(() => q(app, sql))).rows)).toEqual(['free', 'pro']);
    });

    it('refuses a tenant INSERT', async () => {
      await expect(asOrg(orgA, () => insertPlan(app, { slug: 'sneaky' }))).rejects.toThrow(
        /row-level security/i,
      );
      await expect(asNobody(() => insertPlan(app, { slug: 'sneaky' }))).rejects.toThrow(
        /row-level security/i,
      );
      expect((await q(owner, `SELECT 1 FROM plans WHERE slug = 'sneaky'`)).rows).toHaveLength(0);
    });

    it('lets a tenant UPDATE and DELETE touch nothing', async () => {
      await insertPlan(owner, paidPlan('pro', '29.00', { name: 'Pro' }));
      await asOrg(orgA, async () => {
        const upd = await q(
          app,
          `UPDATE plans SET name = 'hijacked', amount = 0, is_active = false`,
        );
        expect(upd.rowCount).toBe(0);
        const del = await q(app, 'DELETE FROM plans');
        expect(del.rowCount).toBe(0);
      });
      const row = await q(
        owner,
        `SELECT name, amount::text AS amount, is_active FROM plans WHERE slug = 'pro'`,
      );
      expect(row.rows).toEqual([{ name: 'Pro', amount: '29.00', is_active: true }]);
    });

    it('lets the privileged flag insert, update and delete', async () => {
      await asPrivileged(async () => {
        const made = await insertPlan(app, paidPlan('ops_plan', '49.00', { name: 'Ops' }));
        expect(made.id).toBeTruthy();
        const upd = await q(
          app,
          `UPDATE plans SET name = 'Ops 2' WHERE slug = 'ops_plan' RETURNING name`,
        );
        expect(upd.rows).toEqual([{ name: 'Ops 2' }]);
        const del = await q(app, `DELETE FROM plans WHERE slug = 'ops_plan'`);
        expect(del.rowCount).toBe(1);
      });
      // ...and it was a rolled-back transaction, so nothing stayed.
      expect((await q(owner, `SELECT 1 FROM plans`)).rows).toHaveLength(0);
    });

    it('does not let a tenant context stand in for the privileged flag', async () => {
      await insertPlan(owner, { slug: 'free' });
      await expect(
        inTx(
          [
            `SELECT set_config('app.org_id', '${orgA}', true)`,
            `SELECT set_config('app.privileged', 'off', true)`,
          ],
          () => insertPlan(app, { slug: 'nope' }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('stores money as numeric(12,2) and reads it back as exact text', async () => {
      await insertPlan(owner, paidPlan('pro', '19.9', { offer_amount: '14.5' }));
      const row = await q(
        owner,
        `SELECT amount::text AS amount, offer_amount::text AS offer FROM plans WHERE slug = 'pro'`,
      );
      expect(row.rows[0]).toEqual({ amount: '19.90', offer: '14.50' });
    });

    it('fills the documented defaults', async () => {
      await insertPlan(owner, { slug: 'bare', name: 'Bare', is_free: true });
      const { rows } = await q(owner, `SELECT * FROM plans WHERE slug = 'bare'`);
      expect(rows[0]).toMatchObject({
        kind: 'plan',
        amount: '0.00',
        offer_amount: null,
        currency: 'USD',
        billing_unit: 'months',
        billing_duration: 1,
        is_lifetime: false,
        is_active: true,
        is_default: false,
        is_highlighted: false,
        is_custom_quote: false,
        sort_order: 0,
        cta_label: 'Get started',
        limits: {},
        features: {},
        row_version: 1,
      });
      expect(rows[0].uuid).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('bumps row_version and updated_at on every update', async () => {
      await insertPlan(owner, { slug: 'free' });
      await q(owner, `UPDATE plans SET name = 'one' WHERE slug = 'free'`);
      await q(owner, `UPDATE plans SET name = 'two' WHERE slug = 'free'`);
      const row = await q(
        owner,
        `SELECT row_version, updated_at >= created_at AS touched FROM plans WHERE slug = 'free'`,
      );
      expect(row.rows[0]).toEqual({ row_version: 3, touched: true });
    });

    it('keeps slugs unique', async () => {
      await insertPlan(owner, { slug: 'free' });
      await refuses({ slug: 'free' }, /plans_slug_key|unique/i);
    });

    it('indexes the plan slug on organizations for the in-use guard', async () => {
      const idx = await q(
        owner,
        `SELECT 1 FROM pg_indexes WHERE tablename = 'organizations' AND indexname = 'idx_organizations_plan'`,
      );
      expect(idx.rows).toHaveLength(1);
    });
  });

  describe('plans: CHECK constraints', () => {
    it('keeps an offer positive and strictly below the price (chk_plans_offer)', async () => {
      await refuses(paidPlan('o1', '10.00', { offer_amount: '10.00' }), 'chk_plans_offer');
      await refuses(paidPlan('o2', '10.00', { offer_amount: '12.00' }), 'chk_plans_offer');
      await refuses(paidPlan('o3', '10.00', { offer_amount: '0.00' }), 'chk_plans_offer');
      await insertPlan(owner, paidPlan('o4', '10.00', { offer_amount: '9.99' }));
    });

    it('a free plan costs 0 and has no offer (chk_plans_free)', async () => {
      await refuses({ slug: 'f1', is_free: true, amount: '5.00' }, 'chk_plans_free');
      await refuses(
        { slug: 'f2', is_free: true, amount: '0.00', offer_amount: '1.00' },
        /chk_plans_(free|offer)/,
      );
      await insertPlan(owner, { slug: 'f3', is_free: true, amount: '0.00' });
    });

    it('a custom quote has no price and is not free (chk_plans_custom, chk_plans_free)', async () => {
      await refuses(
        { slug: 'c1', is_free: false, is_custom_quote: true, amount: '9.00' },
        'chk_plans_custom',
      );
      await refuses(
        { slug: 'c2', is_free: true, is_custom_quote: true, amount: '0.00' },
        'chk_plans_free',
      );
      await insertPlan(owner, {
        slug: 'c3',
        is_free: false,
        is_custom_quote: true,
        amount: '0.00',
      });
    });

    it('a priced plan is not free: price 0 must be marked free (chk_plans_priced)', async () => {
      await refuses({ slug: 'p1', is_free: false, amount: '0.00' }, 'chk_plans_priced');
      await insertPlan(owner, paidPlan('p2', '0.01'));
    });

    it('refuses a negative price (chk_plans_amount)', async () => {
      await refuses(paidPlan('neg', '-1.00'), /chk_plans_(amount|priced)/);
    });

    it('refuses a bad slug: uppercase, spaces, dashes, empty, an all-digit slug, more than 32 characters (chk_plans_slug)', async () => {
      for (const slug of ['Pro', 'pro plus', 'pro-plus', '', '12345', '0', '__', 'a'.repeat(33)]) {
        await refuses({ slug }, 'chk_plans_slug');
      }
      await insertPlan(owner, { slug: 'a'.repeat(32) });
      await insertPlan(owner, { slug: '1a' });
      await insertPlan(owner, { slug: '_a_' });
    });

    it('a default plan must be active (chk_plans_default_active)', async () => {
      await refuses({ slug: 'd1', is_default: true, is_active: false }, 'chk_plans_default_active');
      await insertPlan(owner, { slug: 'd2', is_default: true, is_active: true });
    });

    it('allows only one default at a time (uq_plans_single_default)', async () => {
      await insertPlan(owner, { slug: 'first', is_default: true });
      await refuses({ slug: 'second', is_default: true }, /uq_plans_single_default/);
      // Several non-defaults are fine, and un-flagging the first frees the slot.
      await insertPlan(owner, { slug: 'third' });
      await insertPlan(owner, { slug: 'fourth' });
      await q(owner, `UPDATE plans SET is_default = false WHERE slug = 'first'`);
      await insertPlan(owner, { slug: 'second', is_default: true });
      const defaults = await q(owner, `SELECT slug FROM plans WHERE is_default`);
      expect(defaults.rows).toEqual([{ slug: 'second' }]);
    });

    it('refuses an update that would make a second default', async () => {
      await insertPlan(owner, { slug: 'first', is_default: true });
      await insertPlan(owner, { slug: 'second' });
      await expect(
        q(owner, `UPDATE plans SET is_default = true WHERE slug = 'second'`),
      ).rejects.toThrow(/uq_plans_single_default/);
    });

    it('limits and features must be JSON objects (chk_plans_limits, chk_plans_features)', async () => {
      for (const bad of ['[]', '"text"', '42', 'true', 'null']) {
        await refuses({ slug: 'jl', limits: bad }, 'chk_plans_limits');
        await refuses({ slug: 'jf', features: bad }, 'chk_plans_features');
      }
      await insertPlan(owner, { slug: 'jok', limits: { devices: 3 }, features: { calling: true } });
      const row = await q(owner, `SELECT limits, features FROM plans WHERE slug = 'jok'`);
      expect(row.rows[0]).toEqual({ limits: { devices: 3 }, features: { calling: true } });
    });

    it('bounds the text, currency, billing and ordering columns', async () => {
      await refuses({ slug: 't1', name: '' }, 'chk_plans_name');
      await refuses({ slug: 't2', name: 'n'.repeat(121) }, 'chk_plans_name');
      await refuses({ slug: 't3', subtitle: 'x'.repeat(192) }, 'chk_plans_subtitle');
      await refuses({ slug: 't4', detail: 'x'.repeat(5001) }, 'chk_plans_detail');
      await refuses({ slug: 't5', kind: 'bogus' }, 'chk_plans_kind');
      await refuses({ slug: 't6', currency: 'usd' }, 'chk_plans_currency');
      await refuses({ slug: 't7', currency: 'US' }, 'chk_plans_currency');
      await refuses({ slug: 't8', billing_unit: 'hours' }, 'chk_plans_unit');
      await refuses({ slug: 't9', billing_duration: 0 }, 'chk_plans_duration');
      await refuses({ slug: 't10', billing_duration: 121 }, 'chk_plans_duration');
      await refuses({ slug: 't11', sort_order: -1 }, 'chk_plans_sort');
      await refuses({ slug: 't12', cta_label: '' }, 'chk_plans_cta');
      await refuses({ slug: 't13', cta_label: 'c'.repeat(65) }, 'chk_plans_cta');
      await insertPlan(owner, { slug: 'ok_addon', kind: 'addon' });
    });
  });

  describe('org_plan_state: per-organization plan state', () => {
    it('shows a tenant only its own row', async () => {
      const own = await asOrg(orgA, () =>
        q(app, 'SELECT org_id, billing_cycle FROM org_plan_state'),
      );
      expect(own.rows).toEqual([{ org_id: orgA, billing_cycle: 'trial' }]);

      const other = await asOrg(orgA, () =>
        q(app, 'SELECT * FROM org_plan_state WHERE org_id = $1', [orgB]),
      );
      expect(other.rows).toHaveLength(0);

      const reverse = await asOrg(orgB, () => q(app, 'SELECT org_id FROM org_plan_state'));
      expect(reverse.rows).toEqual([{ org_id: orgB }]);
    });

    it('returns nothing without a tenant context', async () => {
      expect((await asNobody(() => q(app, 'SELECT * FROM org_plan_state'))).rows).toHaveLength(0);
    });

    it('shows the privileged flag every row', async () => {
      const rows = await asPrivileged(() =>
        q(app, 'SELECT org_id FROM org_plan_state WHERE org_id IN ($1, $2) ORDER BY org_id', [
          orgA,
          orgB,
        ]),
      );
      expect(rows.rows).toEqual([{ org_id: orgA }, { org_id: orgB }]);
    });

    it('refuses a tenant INSERT, for its own organization or another', async () => {
      await expect(
        asOrg(orgBare, () => q(app, 'INSERT INTO org_plan_state (org_id) VALUES ($1)', [orgBare])),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        asOrg(orgA, () => q(app, 'INSERT INTO org_plan_state (org_id) VALUES ($1)', [orgBare])),
      ).rejects.toThrow(/row-level security/i);
    });

    it('lets a tenant UPDATE and DELETE touch nothing: a workspace cannot extend its own trial', async () => {
      const before = await q(
        owner,
        'SELECT trial_ends_at, billing_cycle, platform_owned, overrides FROM org_plan_state WHERE org_id = $1',
        [orgA],
      );
      await asOrg(orgA, async () => {
        const upd = await q(
          app,
          `UPDATE org_plan_state SET trial_ends_at = now() + interval '3650 days', platform_owned = true,
             overrides = '{"features":{"remove_branding":true}}'::jsonb`,
        );
        expect(upd.rowCount).toBe(0);
        expect((await q(app, 'DELETE FROM org_plan_state')).rowCount).toBe(0);
        // Nor another org's row.
        expect(
          (
            await q(app, 'UPDATE org_plan_state SET platform_owned = true WHERE org_id = $1', [
              orgB,
            ])
          ).rowCount,
        ).toBe(0);
      });
      const after = await q(
        owner,
        'SELECT trial_ends_at, billing_cycle, platform_owned, overrides FROM org_plan_state WHERE org_id = $1',
        [orgA],
      );
      expect(after.rows).toEqual(before.rows);
    });

    it('lets the privileged flag write it', async () => {
      await asPrivileged(async () => {
        const upd = await q(
          app,
          `UPDATE org_plan_state SET platform_owned = true WHERE org_id = $1 RETURNING platform_owned`,
          [orgA],
        );
        expect(upd.rows).toEqual([{ platform_owned: true }]);
        const ins = await q(
          app,
          'INSERT INTO org_plan_state (org_id) VALUES ($1) RETURNING org_id',
          [orgBare],
        );
        expect(ins.rows).toEqual([{ org_id: orgBare }]);
        expect(
          (await q(app, 'DELETE FROM org_plan_state WHERE org_id = $1', [orgBare])).rowCount,
        ).toBe(1);
      });
    });

    it('fills its defaults: monthly, no trial, no end, no overrides, not platform owned', async () => {
      const org = Number(
        (
          await q(
            owner,
            `INSERT INTO organizations (slug, name) VALUES ('plan-defaults', 'D') RETURNING id`,
          )
        ).rows[0].id,
      );
      await q(owner, 'INSERT INTO org_plan_state (org_id) VALUES ($1)', [org]);
      const row = await q(owner, 'SELECT * FROM org_plan_state WHERE org_id = $1', [org]);
      expect(row.rows[0]).toMatchObject({
        trial_ends_at: null,
        plan_ends_at: null,
        billing_cycle: 'monthly',
        overrides: {},
        platform_owned: false,
        row_version: 1,
      });
    });

    it('checks the billing cycle and the overrides shape', async () => {
      await expect(
        q(owner, `UPDATE org_plan_state SET billing_cycle = 'weekly' WHERE org_id = $1`, [orgA]),
      ).rejects.toThrow('chk_org_plan_state_cycle');
      for (const bad of ['[]', '"x"', 'null', '3']) {
        await expect(
          q(owner, `UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
            orgA,
            bad,
          ]),
        ).rejects.toThrow('chk_org_plan_state_overrides');
      }
      for (const ok of ['trial', 'monthly', 'yearly']) {
        await q(owner, `UPDATE org_plan_state SET billing_cycle = $2 WHERE org_id = $1`, [
          orgB,
          ok,
        ]);
      }
      await q(owner, `UPDATE org_plan_state SET billing_cycle = 'trial' WHERE org_id = $1`, [orgB]);
    });

    it('needs a real organization and goes away with it', async () => {
      await expect(
        q(owner, 'INSERT INTO org_plan_state (org_id) VALUES (987654321)'),
      ).rejects.toThrow(/foreign key/i);
      const org = Number(
        (
          await q(
            owner,
            `INSERT INTO organizations (slug, name) VALUES ('plan-cascade', 'C') RETURNING id`,
          )
        ).rows[0].id,
      );
      await q(owner, 'INSERT INTO org_plan_state (org_id) VALUES ($1)', [org]);
      await q(owner, 'DELETE FROM organizations WHERE id = $1', [org]);
      expect(
        (await q(owner, 'SELECT 1 FROM org_plan_state WHERE org_id = $1', [org])).rows,
      ).toHaveLength(0);
    });

    it('holds one row per organization', async () => {
      await expect(
        q(owner, 'INSERT INTO org_plan_state (org_id) VALUES ($1)', [orgA]),
      ).rejects.toThrow(/unique|duplicate|primary/i);
    });
  });

  describe('migration backfill', () => {
    it('gives an organization that existed before the migration a plain state row (no trial)', async () => {
      // A second database migrated up to the migration BEFORE plan_core, an organization created there,
      // then the full set applied: the backfill statement at the end of plan_core must cover it.
      const before = mkdtempSync(join(tmpdir(), 'plan-backfill-'));
      await owner.query('CREATE DATABASE crm_backfill');
      const url = new URL(container.getConnectionUri());
      url.pathname = '/crm_backfill';
      const legacy = new Client({ connectionString: url.toString() });
      try {
        for (const f of readdirSync(MIGRATIONS).filter(
          (n) => n.endsWith('.sql') && n < PLAN_CORE,
        )) {
          copyFileSync(join(MIGRATIONS, f), join(before, f));
        }
        await runMigrations(url.toString(), { dir: before, log: () => undefined });
        await legacy.connect();
        expect(
          (await legacy.query(`SELECT to_regclass('org_plan_state') AS t`)).rows[0].t,
        ).toBeNull();
        await legacy.query(
          `INSERT INTO organizations (slug, name, plan) VALUES ('legacy-one', 'L1', 'pro'), ('legacy-two', 'L2', 'starter')`,
        );

        const applied = await runMigrations(url.toString(), {
          dir: MIGRATIONS,
          log: () => undefined,
        });
        expect(applied.applied).toContain(PLAN_CORE.replace(/\.sql$/, ''));

        const rows = await legacy.query(
          `SELECT o.slug, o.plan, s.trial_ends_at, s.plan_ends_at, s.billing_cycle, s.overrides, s.platform_owned
           FROM organizations o JOIN org_plan_state s ON s.org_id = o.id ORDER BY o.slug`,
        );
        expect(rows.rows).toEqual([
          {
            slug: 'legacy-one',
            plan: 'pro',
            trial_ends_at: null,
            plan_ends_at: null,
            billing_cycle: 'monthly',
            overrides: {},
            platform_owned: false,
          },
          {
            slug: 'legacy-two',
            plan: 'starter',
            trial_ends_at: null,
            plan_ends_at: null,
            billing_cycle: 'monthly',
            overrides: {},
            platform_owned: false,
          },
        ]);
        // The organization's plan slug is untouched by the migration.
        const count = await legacy.query(
          `SELECT (SELECT count(*) FROM organizations)::int AS orgs, (SELECT count(*) FROM org_plan_state)::int AS states`,
        );
        expect(count.rows[0]).toEqual({ orgs: 2, states: 2 });
      } finally {
        await legacy.end().catch(() => undefined);
        await owner.query('DROP DATABASE IF EXISTS crm_backfill WITH (FORCE)');
        rmSync(before, { recursive: true, force: true });
      }
    });

    it('does not create a state row for an organization inserted by a plain INSERT', async () => {
      expect(
        (await q(owner, 'SELECT 1 FROM org_plan_state WHERE org_id = $1', [orgBare])).rows,
      ).toHaveLength(0);
    });
  });

  describe('sign-up provisioning writes the plan (TenantDirectory.provisionOrganization)', () => {
    let seq = 0;
    const provision = (
      signupPlan: { defaultPlanSlug: string | null; trialDays: number },
      over: { fail?: boolean } = {},
    ) => {
      const slug = `signup-${++seq}`;
      return directory.provisionOrganization(
        {
          orgName: `Signup ${seq}`,
          slug,
          fullName: 'Founder',
          email: `founder${seq}@signup.test`,
          passwordHash: 'hash',
          phoneE164: null,
          phoneVerified: false,
          emailVerifiedAt: null,
          locale: null,
          orgSettings: {},
          signupPlan,
        },
        async () => {
          if (over.fail) throw new Error('boom');
        },
      );
    };
    const stored = async (orgId: number) => {
      const org = await q(owner, 'SELECT plan FROM organizations WHERE id = $1', [orgId]);
      const state = await q(
        owner,
        'SELECT trial_ends_at, plan_ends_at, billing_cycle, overrides, platform_owned FROM org_plan_state WHERE org_id = $1',
        [orgId],
      );
      return { plan: org.rows[0].plan as string, state: state.rows };
    };

    it('a free default with a trial length: plan = the free plan, trial_ends_at = now + days, cycle trial', async () => {
      await insertPlan(owner, { slug: 'free', is_default: true });
      const t0 = Date.now();
      const result = await provision({ defaultPlanSlug: null, trialDays: 14 });
      const t1 = Date.now();

      expect(result.plan).toMatchObject({
        planSlug: 'free',
        step: 'flagged',
        billingCycle: 'trial',
      });
      const { plan, state } = await stored(result.org.id);
      expect(plan).toBe('free');
      expect(state).toHaveLength(1);
      expect(state[0].billing_cycle).toBe('trial');
      const ends = (state[0].trial_ends_at as Date).getTime();
      expect(ends).toBeGreaterThanOrEqual(t0 + 14 * DAY);
      expect(ends).toBeLessThanOrEqual(t1 + 14 * DAY);
      expect(result.plan.trialEndsAt?.getTime()).toBe(ends);
      expect(state[0]).toMatchObject({ plan_ends_at: null, overrides: {}, platform_owned: false });
    });

    it('a paid default (named by the registration setting): plan = the paid plan, no trial, cycle monthly', async () => {
      await insertPlan(owner, { slug: 'free', is_default: true });
      await insertPlan(owner, paidPlan('pro', '29.00'));
      const result = await provision({ defaultPlanSlug: 'pro', trialDays: 14 });

      expect(result.plan).toMatchObject({
        planSlug: 'pro',
        step: 'setting',
        trialEndsAt: null,
        billingCycle: 'monthly',
      });
      const { plan, state } = await stored(result.org.id);
      expect(plan).toBe('pro');
      expect(state[0]).toMatchObject({ trial_ends_at: null, billing_cycle: 'monthly' });
    });

    it('a flagged paid default also gets no trial', async () => {
      await insertPlan(owner, paidPlan('pro', '29.00', { is_default: true }));
      await insertPlan(owner, { slug: 'free' });
      const result = await provision({ defaultPlanSlug: null, trialDays: 14 });
      expect(result.plan).toMatchObject({ planSlug: 'pro', step: 'flagged', trialEndsAt: null });
      expect((await stored(result.org.id)).state[0]).toMatchObject({
        trial_ends_at: null,
        billing_cycle: 'monthly',
      });
    });

    it('a free plan with 0 trial days gets no trial', async () => {
      await insertPlan(owner, { slug: 'free' });
      const result = await provision({ defaultPlanSlug: null, trialDays: 0 });
      expect(result.plan).toMatchObject({
        planSlug: 'free',
        step: 'free',
        trialEndsAt: null,
        billingCycle: 'monthly',
      });
      expect((await stored(result.org.id)).state[0]).toMatchObject({
        trial_ends_at: null,
        billing_cycle: 'monthly',
      });
    });

    it('no plans at all: the literal starter, no trial, and no catalogue row is invented', async () => {
      const result = await provision({ defaultPlanSlug: null, trialDays: 14 });
      expect(result.plan).toMatchObject({
        planSlug: 'starter',
        step: 'literal',
        trialEndsAt: null,
        billingCycle: 'monthly',
      });
      const { plan, state } = await stored(result.org.id);
      expect(plan).toBe('starter');
      expect(state[0]).toMatchObject({ trial_ends_at: null, billing_cycle: 'monthly' });
      expect((await q(owner, 'SELECT 1 FROM plans')).rows).toHaveLength(0);
    });

    it('a registration setting that names an inactive plan falls through to the next step', async () => {
      await insertPlan(owner, paidPlan('retired', '29.00', { is_active: false }));
      await insertPlan(owner, { slug: 'free' });
      const result = await provision({ defaultPlanSlug: 'retired', trialDays: 7 });
      expect(result.plan).toMatchObject({ planSlug: 'free', step: 'free', billingCycle: 'trial' });
    });

    it('an add-on never becomes the sign-up plan, even when named', async () => {
      await insertPlan(owner, { slug: 'extra_seats', kind: 'addon', is_free: true });
      const result = await provision({ defaultPlanSlug: 'extra_seats', trialDays: 7 });
      expect(result.plan).toMatchObject({ planSlug: 'starter', step: 'literal' });
    });

    it('lets the new organization read its own state row, and nobody else read it', async () => {
      await insertPlan(owner, { slug: 'free', is_default: true });
      const a = await provision({ defaultPlanSlug: null, trialDays: 14 });
      const b = await provision({ defaultPlanSlug: null, trialDays: 0 });

      const seenByA = await asOrg(a.org.id, () =>
        q(app, 'SELECT org_id, billing_cycle FROM org_plan_state'),
      );
      expect(seenByA.rows).toEqual([{ org_id: a.org.id, billing_cycle: 'trial' }]);
      const seenByB = await asOrg(b.org.id, () =>
        q(app, 'SELECT org_id, billing_cycle FROM org_plan_state'),
      );
      expect(seenByB.rows).toEqual([{ org_id: b.org.id, billing_cycle: 'monthly' }]);
    });

    it('rolls the plan state back with the organization when a later step fails', async () => {
      await insertPlan(owner, { slug: 'free', is_default: true });
      const before = (await q(owner, 'SELECT count(*)::int AS n FROM org_plan_state')).rows[0].n;
      await expect(
        provision({ defaultPlanSlug: null, trialDays: 14 }, { fail: true }),
      ).rejects.toThrow('boom');
      const after = (await q(owner, 'SELECT count(*)::int AS n FROM org_plan_state')).rows[0].n;
      expect(after).toBe(before);
    });

    it('recordInitialState overwrites a previous initial state instead of failing', async () => {
      const org = await provision({ defaultPlanSlug: null, trialDays: 0 });
      await db.privileged((tx) =>
        entitlements.recordInitialState(tx, org.org.id, {
          planSlug: 'starter',
          step: 'literal',
          trialEndsAt: new Date(Date.now() + 3 * DAY),
          billingCycle: 'trial',
        }),
      );
      const { state } = await stored(org.org.id);
      expect(state).toHaveLength(1);
      expect(state[0].billing_cycle).toBe('trial');
      expect(state[0].trial_ends_at).not.toBeNull();
    });
  });

  describe('reading plans as a tenant (catalogue and entitlement services)', () => {
    /** An organization on the given plan slug with a state row. */
    async function orgOn(slug: string, planSlug: string, state = '') {
      const id = Number(
        (
          await q(
            owner,
            `INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, $2) RETURNING id`,
            [slug, planSlug],
          )
        ).rows[0].id,
      );
      await q(owner, `INSERT INTO org_plan_state (org_id) VALUES ($1)`, [id]);
      if (state) await q(owner, `UPDATE org_plan_state SET ${state} WHERE org_id = $1`, [id]);
      return id;
    }

    it('lists active plans only, in sort order then price, marks the current one and drops add-ons', async () => {
      await insertPlan(owner, { slug: 'free', sort_order: 1 });
      await insertPlan(owner, paidPlan('pro', '29.00', { sort_order: 3 }));
      await insertPlan(owner, paidPlan('basic', '9.00', { sort_order: 3 }));
      await insertPlan(owner, paidPlan('retired', '5.00', { is_active: false, sort_order: 0 }));
      await insertPlan(owner, { slug: 'extra_seats', kind: 'addon', sort_order: 0 });
      const org = await orgOn('cards-1', 'basic', `trial_ends_at = '2030-01-01T00:00:00Z'`);

      const cards = await entitlements.cardsForOrg(org);
      expect(cards.data.map((c) => c.slug)).toEqual(['free', 'basic', 'pro']);
      expect(cards.currentSlug).toBe('basic');
      expect(cards.trialEndsAt).toBe('2030-01-01T00:00:00.000Z');
      expect(cards.data.map((c) => [c.slug, c.current, c.action])).toEqual([
        ['free', false, 'continue_free'],
        ['basic', true, 'current'],
        ['pro', false, 'upgrade'],
      ]);
    });

    it('lists plans by sort order, then by NUMERIC price, then slug (100.00 is not below 9.00)', async () => {
      await insertPlan(owner, paidPlan('dear', '100.00', { sort_order: 1 }));
      await insertPlan(owner, paidPlan('cheap', '9.00', { sort_order: 1 }));
      await insertPlan(owner, paidPlan('mid', '29.00', { sort_order: 1 }));
      await insertPlan(owner, paidPlan('b_tie', '29.00', { sort_order: 1 }));
      await insertPlan(owner, paidPlan('first', '500.00', { sort_order: 0 }));
      const rows = await db.txAs({ orgId: orgA, userId: null }, (tx) => catalog.listPlans(tx));
      expect(rows.map((r) => r.slug)).toEqual(['first', 'cheap', 'b_tie', 'mid', 'dear']);
    });

    it('ranks against a current plan that is no longer listed (inactive) and treats a missing one as unknown', async () => {
      await insertPlan(owner, paidPlan('legacy', '50.00', { is_active: false }));
      await insertPlan(owner, paidPlan('cheap', '10.00'));
      await insertPlan(owner, paidPlan('dear', '90.00'));
      const onLegacy = await orgOn('cards-2', 'legacy');
      const cards = await entitlements.cardsForOrg(onLegacy);
      expect(cards.data.map((c) => [c.slug, c.action])).toEqual([
        ['cheap', 'downgrade_unavailable'],
        ['dear', 'upgrade'],
      ]);
      expect(cards.data.some((c) => c.current)).toBe(false);

      const onGhost = await orgOn('cards-3', 'ghost_plan');
      const ghost = await entitlements.cardsForOrg(onGhost);
      expect(ghost.currentSlug).toBe('ghost_plan');
      expect(ghost.data.map((c) => c.action)).toEqual(['choose', 'choose']);
    });

    it('answers isActiveSlug without any tenant context', async () => {
      await insertPlan(owner, { slug: 'free' });
      await insertPlan(owner, paidPlan('retired', '5.00', { is_active: false }));
      await insertPlan(owner, { slug: 'extra_seats', kind: 'addon' });
      expect(await catalog.isActiveSlug('free')).toBe(true);
      expect(await catalog.isActiveSlug('retired')).toBe(false);
      expect(await catalog.isActiveSlug('extra_seats')).toBe(false);
      expect(await catalog.isActiveSlug('nope')).toBe(false);
    });

    it('resolves entitlements from the plan, an override, platform ownership and a missing plan', async () => {
      await insertPlan(owner, {
        slug: 'free',
        limits: { devices: 3 },
        features: { remove_branding: false, calling: true },
      });
      const org = await orgOn('ent-1', 'free');

      const e = await entitlements.forOrg(org);
      expect(e).toMatchObject({
        planSlug: 'free',
        planKnown: true,
        billingCycle: 'monthly',
        platformOwned: false,
      });
      expect(await entitlements.featureEnabled(org, 'remove_branding')).toBe(false);
      expect(await entitlements.featureEnabled(org, 'calling')).toBe(true);
      expect(await entitlements.limit(org, 'devices')).toBe(3);
      await expect(entitlements.assertFeature(org, 'remove_branding')).rejects.toMatchObject({
        code: 'PLAN_FEATURE_LOCKED',
      });
      await expect(entitlements.assertWithinLimit(org, 'devices', 2)).resolves.toBeUndefined();
      await expect(entitlements.assertWithinLimit(org, 'devices', 3)).rejects.toMatchObject({
        code: 'PLAN_LIMIT_REACHED',
      });

      await q(
        owner,
        `UPDATE org_plan_state SET overrides = '{"features":{"remove_branding":true},"limits":{"devices":-1}}' WHERE org_id = $1`,
        [org],
      );
      expect(await entitlements.featureEnabled(org, 'remove_branding')).toBe(true);
      expect(await entitlements.limit(org, 'devices')).toBe(0);

      await q(
        owner,
        `UPDATE org_plan_state SET overrides = '{"features":{"calling":false},"limits":{"devices":1}}' WHERE org_id = $1`,
        [org],
      );
      expect(await entitlements.featureEnabled(org, 'calling')).toBe(false);
      expect(await entitlements.limit(org, 'devices')).toBe(1);

      await q(
        owner,
        `UPDATE org_plan_state SET overrides = '{}', platform_owned = true WHERE org_id = $1`,
        [org],
      );
      expect(await entitlements.featureEnabled(org, 'remove_branding')).toBe(true);
      expect(await entitlements.limit(org, 'devices')).toBe(0);

      await q(owner, `UPDATE org_plan_state SET platform_owned = false WHERE org_id = $1`, [org]);
      await q(owner, `DELETE FROM plans WHERE slug = 'free'`);
      const open = await entitlements.forOrg(org);
      expect(open).toMatchObject({ planSlug: 'free', planKnown: false, planName: null });
      expect(await entitlements.featureEnabled(org, 'remove_branding')).toBe(true);
      expect(await entitlements.limit(org, 'devices')).toBe(0);
    });

    it('an organization with no state row reads as monthly, not owned, no trial', async () => {
      await insertPlan(owner, { slug: 'starter' });
      const e = await entitlements.forOrg(orgBare);
      expect(e).toMatchObject({
        billingCycle: 'monthly',
        platformOwned: false,
        trialEndsAt: null,
        planEndsAt: null,
        overrides: {},
      });
    });

    it('an add-on with the organization’s plan slug is not its plan', async () => {
      await insertPlan(owner, {
        slug: 'addon_like',
        kind: 'addon',
        is_free: true,
        features: { remove_branding: false },
      });
      const org = await orgOn('ent-2', 'addon_like');
      const e = await entitlements.forOrg(org);
      expect(e?.planKnown).toBe(false);
      expect(await entitlements.featureEnabled(org, 'remove_branding')).toBe(true);
    });

    it('never reads another organization: an unknown id has no entitlements', async () => {
      expect(await entitlements.forOrg(987654321)).toBeNull();
      expect(await entitlements.featureEnabled(987654321, 'remove_branding')).toBe(false);
    });
  });
});
