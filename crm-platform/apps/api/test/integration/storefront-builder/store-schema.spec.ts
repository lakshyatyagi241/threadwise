import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The storefront tables against a real Postgres as the restricted application role (a superuser bypasses every policy): forced
 * RLS with a tenant_isolation policy, tenant isolation of reads and writes, the composite foreign keys, the unique slug and
 * the one-active-recovery index, and the three SECURITY DEFINER lookups the public shop uses before a tenant is known.
 */
const TABLES = ['wa_storefronts', 'wa_storefront_views', 'storefront_cart_recoveries'] as const;

describe('storefront-builder: schema, isolation, public lookups', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let shopA: number;
  let shopB: number;

  const scalar = async (q: string, params: unknown[] = []) =>
    Number((await owner.query(q, params)).rows[0].id);
  const insertShop = (org: number, slug: string) =>
    scalar(`INSERT INTO wa_storefronts (org_id, slug, shop_name) VALUES ($1,$2,$2) RETURNING id`, [
      org,
      slug,
    ]);
  /** One transaction as the restricted role with the tenant set; always rolled back. */
  const asTenant = async <T>(org: number | null, fn: () => Promise<T>) => {
    await app.query('BEGIN');
    try {
      if (org !== null) await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };

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
    orgA = await scalar(
      `INSERT INTO organizations (slug,name,plan) VALUES ('sa','A','starter') RETURNING id`,
    );
    orgB = await scalar(
      `INSERT INTO organizations (slug,name,plan) VALUES ('sb','B','starter') RETURNING id`,
    );
    shopA = await insertShop(orgA, 'shop-a');
    shopB = await insertShop(orgB, 'shop-b');
    await owner.query(
      `UPDATE wa_storefronts SET custom_domain = 'shop.a.test', custom_domain_verified = true WHERE id = $1`,
      [shopA],
    );
    await owner.query(`UPDATE wa_storefronts SET custom_domain = 'shop.b.test' WHERE id = $1`, [
      shopB,
    ]);
    for (const [org, shop] of [
      [orgA, shopA],
      [orgB, shopB],
    ] as const) {
      await owner.query(
        `INSERT INTO wa_storefront_views (org_id, storefront_id, day, views) VALUES ($1,$2,current_date,3)`,
        [org, shop],
      );
      await owner.query(
        `INSERT INTO storefront_cart_recoveries (org_id, storefront_id, customer_phone) VALUES ($1,$2,'919800000001')`,
        [org, shop],
      );
    }
    const url = new URL(container.getConnectionUri());
    url.username = 'crm_app_user';
    url.password = 'test';
    app = new Client({ connectionString: url.toString() });
    await app.connect();
  }, 180_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  it('RLS is enabled and forced on every storefront table, with exactly one tenant_isolation policy', async () => {
    const res = await owner.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              count(p.polname)::int AS policies, bool_and(p.polname = 'tenant_isolation') AS named
         FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relname = ANY($1) GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity ORDER BY 1`,
      [[...TABLES]],
    );
    expect(res.rows.map((r) => r.relname)).toEqual([...TABLES].sort());
    for (const r of res.rows)
      expect([r.relname, r.relrowsecurity, r.relforcerowsecurity, r.policies, r.named]).toEqual([
        r.relname,
        true,
        true,
        1,
        true,
      ]);
  });

  it('a tenant sees only its own rows, and none without a tenant', async () => {
    for (const t of TABLES) {
      const a = await asTenant(orgA, async () =>
        (await app.query(`SELECT org_id FROM ${t}`)).rows.map((r) => Number(r.org_id)),
      );
      expect([t, a]).toEqual([t, [orgA]]);
      const none = await asTenant(
        null,
        async () => (await app.query(`SELECT 1 FROM ${t}`)).rowCount,
      );
      expect([t, none]).toEqual([t, 0]);
    }
  });

  it('a tenant cannot write into another tenant (WITH CHECK) or update its rows', async () => {
    await expect(
      asTenant(orgA, () =>
        app.query(`INSERT INTO wa_storefronts (org_id, slug) VALUES ($1,'sneaky')`, [orgB]),
      ),
    ).rejects.toThrow(/row-level security/);
    const res = await asTenant(orgA, () =>
      app.query(`UPDATE wa_storefronts SET shop_name = 'x' WHERE id = $1`, [shopB]),
    );
    expect(res.rowCount).toBe(0);
  });

  it('the composite foreign keys refuse a view or recovery that points at another tenant shop', async () => {
    await expect(
      owner.query(
        `INSERT INTO wa_storefront_views (org_id, storefront_id, day, views) VALUES ($1,$2,current_date - 1,1)`,
        [orgA, shopB],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      owner.query(
        `INSERT INTO storefront_cart_recoveries (org_id, storefront_id, customer_phone) VALUES ($1,$2,'1')`,
        [orgA, shopB],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('slugs are unique across tenants, custom domains too, and views are one row per shop and day', async () => {
    await expect(insertShop(orgB, 'shop-a')).rejects.toThrow(/uq_wa_storefronts_slug/);
    await expect(
      owner.query(`UPDATE wa_storefronts SET custom_domain = 'shop.a.test' WHERE id = $1`, [shopB]),
    ).rejects.toThrow(/uq_wa_storefronts_custom_domain/);
    await expect(
      owner.query(
        `INSERT INTO wa_storefront_views (org_id, storefront_id, day, views) VALUES ($1,$2,current_date,1)`,
        [orgA, shopA],
      ),
    ).rejects.toThrow(/uq_wa_storefront_views_storefront_id_day/);
  });

  it('only one active recovery exists per shop and phone, a sent one does not block a new cart', async () => {
    await expect(
      owner.query(
        `INSERT INTO storefront_cart_recoveries (org_id, storefront_id, customer_phone) VALUES ($1,$2,'919800000001')`,
        [orgA, shopA],
      ),
    ).rejects.toThrow(/uq_storefront_cart_recoveries_active/);
    await owner.query(
      `UPDATE storefront_cart_recoveries SET status = 'sent' WHERE org_id = $1 AND storefront_id = $2`,
      [orgA, shopA],
    );
    await owner.query(
      `INSERT INTO storefront_cart_recoveries (org_id, storefront_id, customer_phone) VALUES ($1,$2,'919800000001')`,
      [orgA, shopA],
    );
  });

  it('the public lookups answer without a tenant and expose only what the shop needs', async () => {
    const slug = await asTenant(
      null,
      async () => (await app.query(`SELECT * FROM store_public_lookup_slug('shop-a')`)).rows,
    );
    expect(slug).toHaveLength(1);
    expect(Number(slug[0].store_org_id)).toBe(orgA);
    expect(Number(slug[0].storefront_id)).toBe(shopA);
    expect(
      await asTenant(
        null,
        async () => (await app.query(`SELECT * FROM store_public_lookup_slug('nope')`)).rowCount,
      ),
    ).toBe(0);
    // a verified custom domain only; an unverified one serves nothing
    expect(
      await asTenant(
        null,
        async () =>
          (await app.query(`SELECT slug FROM store_public_lookup_host('shop.a.test')`)).rows,
      ),
    ).toEqual([{ slug: 'shop-a' }]);
    expect(
      await asTenant(
        null,
        async () =>
          (await app.query(`SELECT 1 FROM store_public_lookup_host('shop.b.test')`)).rowCount,
      ),
    ).toBe(0);
    const byId = await asTenant(
      null,
      async () => (await app.query(`SELECT * FROM store_public_lookup_id($1)`, [shopB])).rows,
    );
    expect(Number(byId[0].store_org_id)).toBe(orgB);
  });

  it('a lookup does not leave the session privileged', async () => {
    const after = await asTenant(orgA, async () => {
      await app.query(`SELECT * FROM store_public_lookup_slug('shop-b')`);
      return (await app.query(`SELECT slug FROM wa_storefronts`)).rows.map((r) => r.slug);
    });
    expect(after).toEqual(['shop-a']);
  });

  it('the four store permission keys are registered', async () => {
    const keys = (
      await owner.query(`SELECT key FROM permission_defs WHERE key LIKE 'store.%' ORDER BY key`)
    ).rows.map((r) => r.key);
    // The merchant-side keys (orders, coupons, ...) are registered by the chk migration and checked in its own spec.
    expect(keys).toEqual(
      expect.arrayContaining([
        'store.dashboard.read',
        'store.shops.manage',
        'store.storefront.manage',
        'store.storefront.read',
      ]),
    );
  });
});
