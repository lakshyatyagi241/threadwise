import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * plan_visible_addons (20261028090000): the backfill that keeps every existing customer's Marketplace as it was, the catalogue-style RLS
 * (readable by every transaction, writable only when privileged) and the trigger that keeps the rows meaningful. Real Postgres; the
 * application is a NOBYPASSRLS login, so "the database refuses" is what is under test.
 */
const MIGRATION = '20261028090000_plan_visible_addons.sql';
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');

describe('plan_visible_addons', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  const ids: Record<string, number> = {};

  const connectionUri = () => container.getConnectionUri();

  /** A marketplace app with a paid add-on pack; `status` is the listing's. */
  async function paidApp(slug: string, status: 'published' | 'draft'): Promise<void> {
    const cat = await owner.query(`SELECT id FROM marketplace_categories LIMIT 1`);
    const a = await owner.query(
      `INSERT INTO marketplace_apps (slug, kind, category_id, name, tagline, status, pricing_model, price_amount, price_currency)
       VALUES ($1, 'mini_app', $2, $1, 't', 'draft', 'paid_monthly', 9, 'USD') RETURNING id`,
      [slug, cat.rows[0].id],
    );
    if (status === 'published') {
      const v = await owner.query(
        `INSERT INTO marketplace_app_versions (app_id, version, status, manifest, scopes, changelog)
         VALUES ($1, '1.0.0', 'published', '{}'::jsonb, ARRAY[]::text[], 'x') RETURNING id`,
        [a.rows[0].id],
      );
      await owner.query(
        `UPDATE marketplace_apps SET status = 'published', current_version_id = $2 WHERE id = $1`,
        [a.rows[0].id, v.rows[0].id],
      );
    }
    const p = await owner.query(
      `INSERT INTO plans (slug, kind, name, amount, marketplace_app_id) VALUES ($1, 'addon', $2, 9, $3) RETURNING id`,
      [`mkt_${slug.replace(/-/g, '')}`, `${slug} (Marketplace)`, a.rows[0].id],
    );
    ids[`pack:${slug}`] = Number(p.rows[0].id);
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: connectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );

    // Everything BEFORE this migration, so the fixtures below are what a customer database looks like when it runs.
    const before = mkdtempSync(join(tmpdir(), 'mig-before-'));
    for (const f of readdirSync(MIGRATIONS).filter((f) => f < MIGRATION))
      cpSync(join(MIGRATIONS, f), join(before, f));
    try {
      await runMigrations(connectionUri(), { dir: before, log: () => undefined });
    } finally {
      rmSync(before, { recursive: true, force: true });
    }

    for (const [key, slug, isFree] of [
      ['free', 'free_plan', true],
      ['pro', 'pro_plan', false],
    ] as const) {
      const r = await owner.query(
        `INSERT INTO plans (slug, kind, name, amount, is_free) VALUES ($1, 'plan', $1, $2, $3) RETURNING id`,
        [slug, isFree ? 0 : 20, isFree],
      );
      ids[key] = Number(r.rows[0].id);
    }
    await paidApp('crm-booking', 'published');
    await paidApp('crm-esign', 'published');
    await paidApp('crm-draft', 'draft'); // not on sale yet: nothing to preserve
    // an add-on that is not a Marketplace pack
    const plain = await owner.query(
      `INSERT INTO plans (slug, kind, name, amount) VALUES ('boost_pack', 'addon', 'Boost', 5) RETURNING id`,
    );
    ids.boost = Number(plain.rows[0].id);

    await runMigrations(connectionUri(), { dir: MIGRATIONS, log: () => undefined });

    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
  }, 300_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  const pairs = async () =>
    (
      await owner.query(`SELECT plan_id, addon_plan_id FROM plan_visible_addons ORDER BY 1, 2`)
    ).rows.map((r) => [Number(r.plan_id), Number(r.addon_plan_id)]);

  it('backfill: every existing plan shows every published Marketplace pack, so nothing disappears', async () => {
    const want = [ids.free!, ids.pro!]
      .flatMap((p) => [ids['pack:crm-booking']!, ids['pack:crm-esign']!].map((a) => [p, a]))
      .sort((x, y) => x[0]! - y[0]! || x[1]! - y[1]!);
    expect(await pairs()).toEqual(want);
  });

  it('backfill leaves out a pack whose app is not published, and an add-on that is not a Marketplace pack', async () => {
    const rows = await pairs();
    expect(rows.some(([, a]) => a === ids['pack:crm-draft'])).toBe(false);
    expect(rows.some(([, a]) => a === ids.boost)).toBe(false);
  });

  it('is a platform catalogue: forced RLS, no org_id, readable by every transaction', async () => {
    const t = await owner.query(
      `SELECT c.relrowsecurity AS on, c.relforcerowsecurity AS forced,
              EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id') AS has_org
         FROM pg_class c WHERE c.relname = 'plan_visible_addons'`,
    );
    expect(t.rows[0]).toEqual({ on: true, forced: true, has_org: false });
    const read = await app.query(`SELECT count(*)::int AS n FROM plan_visible_addons`);
    expect(read.rows[0].n).toBe(4);
  });

  it('a tenant transaction cannot write it; a privileged one can', async () => {
    const insert = `INSERT INTO plan_visible_addons (plan_id, addon_plan_id) VALUES ($1, $2)`;
    const drafted = [ids.free, ids['pack:crm-draft']];
    await expect(app.query(insert, drafted)).rejects.toThrow(/row-level security/);
    // A delete the policy hides matches no rows rather than failing.
    const del = await app.query(`DELETE FROM plan_visible_addons WHERE plan_id = $1`, [ids.free]);
    expect(del.rowCount).toBe(0);
    expect((await pairs()).length).toBe(4);

    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.privileged', 'on', true)`);
    await app.query(insert, drafted);
    await app.query('COMMIT');
    expect((await pairs()).length).toBe(5);
    await owner.query(`DELETE FROM plan_visible_addons WHERE addon_plan_id = $1`, [
      ids['pack:crm-draft'],
    ]);
  });

  it('a row must be a plan and the add-on of a Marketplace app', async () => {
    const insert = `INSERT INTO plan_visible_addons (plan_id, addon_plan_id) VALUES ($1, $2)`;
    // an add-on in the plan column
    await expect(
      owner.query(insert, [ids['pack:crm-booking'], ids['pack:crm-esign']]),
    ).rejects.toThrow(/must be a plan/);
    // a plain add-on, and a plan, in the add-on column
    await expect(owner.query(insert, [ids.free, ids.boost])).rejects.toThrow(/Marketplace app/);
    await expect(owner.query(insert, [ids.free, ids.pro])).rejects.toThrow(/Marketplace app/);
  });

  it('deleting a plan or a pack removes its rows (no dangling visibility)', async () => {
    await owner.query(`DELETE FROM plans WHERE id = $1`, [ids.free]);
    expect((await pairs()).every(([p]) => p === ids.pro)).toBe(true);
    await owner.query(`DELETE FROM plans WHERE id = $1`, [ids['pack:crm-esign']]);
    expect(await pairs()).toEqual([[ids.pro, ids['pack:crm-booking']]]);
  });
});
