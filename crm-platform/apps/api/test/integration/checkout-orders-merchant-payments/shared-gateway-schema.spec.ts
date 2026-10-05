import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The shared workspace gateway store against a real Postgres as the restricted application role (a superuser bypasses every policy):
 * forced RLS on `wa_merchant_gateways`, the workspace row (`storefront_id = 0`) the old foreign key made impossible, one default per
 * scope, a deleted shop taking its own overrides with it, the public gateway lookup the webhook uses, the data migration that
 * copies a shop's Razorpay keys, and the registered permission keys.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const KEYS = [
  'store.orders.read',
  'store.orders.manage',
  'store.orders.delete',
  'store.coupons.read',
  'store.coupons.manage',
  'store.customers.read',
  'store.customers.manage',
  'store.groups.read',
  'store.groups.manage',
  'store.gateways.read',
  'store.gateways.manage',
  'store.payments.view',
  'store.payments.manage',
];

describe('shared workspace gateway: schema, isolation, lookup, backfill', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let shopA: number;
  let shopA2: number;
  let shopB: number;

  const scalar = async (q: string, params: unknown[] = []) =>
    Number((await owner.query(q, params)).rows[0].id);
  const insertShop = (org: number, slug: string) =>
    scalar(`INSERT INTO wa_storefronts (org_id, slug, shop_name) VALUES ($1,$2,$2) RETURNING id`, [
      org,
      slug,
    ]);
  const insertGateway = (org: number, shop: number, slug: string) =>
    scalar(
      `INSERT INTO wa_merchant_gateways (org_id, storefront_id, slug, credentials, mode, active)
       VALUES ($1,$2,$3,'cipher','live',true) RETURNING id`,
      [org, shop, slug],
    );
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
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    orgA = await scalar(
      `INSERT INTO organizations (slug,name,plan) VALUES ('ga','A','starter') RETURNING id`,
    );
    orgB = await scalar(
      `INSERT INTO organizations (slug,name,plan) VALUES ('gb','B','starter') RETURNING id`,
    );
    shopA = await insertShop(orgA, 'gshop-a');
    shopA2 = await insertShop(orgA, 'gshop-a2');
    shopB = await insertShop(orgB, 'gshop-b');
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

  it('RLS is enabled and forced with exactly one tenant_isolation policy', async () => {
    const res = await owner.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity, count(p.polname)::int AS policies, bool_and(p.polname = 'tenant_isolation') AS named
         FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relname = 'wa_merchant_gateways' GROUP BY 1, 2`,
    );
    expect(res.rows[0]).toEqual({
      relrowsecurity: true,
      relforcerowsecurity: true,
      policies: 1,
      named: true,
    });
  });

  it('a workspace row (storefront_id 0) and a shop row can both be stored', async () => {
    const ws = await insertGateway(orgA, 0, 'stripe');
    const own = await insertGateway(orgA, shopA, 'stripe');
    expect(ws).not.toBe(own);
    const dupe = owner.query(
      `INSERT INTO wa_merchant_gateways (org_id, storefront_id, slug) VALUES ($1, 0, 'stripe')`,
      [orgA],
    );
    await expect(dupe).rejects.toThrow(/uq_wa_merchant_gateways_storefront_id_slug/);
  });

  it('a tenant sees only its own gateways and cannot write into another tenant', async () => {
    await insertGateway(orgB, 0, 'razorpay');
    const a = await asTenant(orgA, async () =>
      (await app.query(`SELECT DISTINCT org_id FROM wa_merchant_gateways`)).rows.map((r) =>
        Number(r.org_id),
      ),
    );
    expect(a).toEqual([orgA]);
    const none = await asTenant(
      null,
      async () => (await app.query(`SELECT 1 FROM wa_merchant_gateways`)).rowCount,
    );
    expect(none).toBe(0);
    await expect(
      asTenant(orgA, () =>
        app.query(
          `INSERT INTO wa_merchant_gateways (org_id, storefront_id, slug) VALUES ($1, 0, 'paypal')`,
          [orgB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const upd = await asTenant(orgA, () =>
      app.query(`UPDATE wa_merchant_gateways SET active = false WHERE org_id = $1`, [orgB]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('allows one default per scope and refuses a second', async () => {
    await owner.query(
      `UPDATE wa_merchant_gateways SET is_default = true WHERE org_id = $1 AND storefront_id = 0 AND slug = 'stripe'`,
      [orgA],
    );
    // The shop scope has its own default.
    await owner.query(
      `UPDATE wa_merchant_gateways SET is_default = true WHERE org_id = $1 AND storefront_id = $2`,
      [orgA, shopA],
    );
    await insertGateway(orgA, 0, 'paypal');
    await expect(
      owner.query(
        `UPDATE wa_merchant_gateways SET is_default = true WHERE org_id = $1 AND storefront_id = 0 AND slug = 'paypal'`,
        [orgA],
      ),
    ).rejects.toThrow(/uq_wa_merchant_gateways_default/);
  });

  it('refuses a bad mode, a bad slug and a negative scope', async () => {
    for (const [mode, slug, scope, what] of [
      ['sandbox', 'stripe', 0, 'chk_wa_merchant_gateways_mode'],
      ['live', 'Bad Slug', 0, 'chk_wa_merchant_gateways_slug'],
      ['live', 'okslug', -1, 'chk_wa_merchant_gateways_scope'],
    ] as const) {
      await expect(
        owner.query(
          `INSERT INTO wa_merchant_gateways (org_id, storefront_id, slug, mode) VALUES ($1,$2,$3,$4)`,
          [orgB, scope, slug, mode],
        ),
        what,
      ).rejects.toThrow(new RegExp(what));
    }
  });

  it("deleting a shop removes its own overrides and nobody else's", async () => {
    await insertGateway(orgA, shopA2, 'razorpay');
    const before = Number(
      (
        await owner.query(`SELECT count(*)::int AS n FROM wa_merchant_gateways WHERE org_id = $1`, [
          orgA,
        ])
      ).rows[0].n,
    );
    await owner.query(`DELETE FROM wa_storefronts WHERE id = $1`, [shopA2]);
    const left = (
      await owner.query(
        `SELECT storefront_id, slug FROM wa_merchant_gateways WHERE org_id = $1 ORDER BY id`,
        [orgA],
      )
    ).rows.map((r) => `${r.storefront_id}:${r.slug}`);
    expect(left).toHaveLength(before - 1);
    expect(left).toContain('0:stripe');
    expect(left).toContain(`${shopA}:stripe`);
    expect(left.some((l) => l.endsWith(':razorpay'))).toBe(false);
    // Another organization's rows are untouched.
    expect(
      Number(
        (
          await owner.query(
            `SELECT count(*)::int AS n FROM wa_merchant_gateways WHERE org_id = $1`,
            [orgB],
          )
        ).rows[0].n,
      ),
    ).toBeGreaterThan(0);
  });

  it('the public lookup answers the gateway behind a uuid without a tenant, and nothing for an unknown one', async () => {
    const row = (
      await owner.query(
        `SELECT uuid, id FROM wa_merchant_gateways WHERE org_id = $1 AND storefront_id = 0 AND slug = 'stripe'`,
        [orgA],
      )
    ).rows[0];
    const found = await asTenant(
      null,
      async () =>
        (await app.query(`SELECT * FROM store_gateway_lookup($1::uuid)`, [row.uuid])).rows,
    );
    expect(found).toHaveLength(1);
    expect(Object.keys(found[0]).sort()).toEqual([
      'gateway_active',
      'gateway_id',
      'gateway_org_id',
      'gateway_slug',
      'gateway_storefront_id',
    ]);
    expect({
      id: Number(found[0].gateway_id),
      org: Number(found[0].gateway_org_id),
      shop: Number(found[0].gateway_storefront_id),
      slug: found[0].gateway_slug,
      active: found[0].gateway_active,
    }).toEqual({ id: Number(row.id), org: orgA, shop: 0, slug: 'stripe', active: true });
    const none = await asTenant(
      null,
      async () =>
        (
          await app.query(
            `SELECT * FROM store_gateway_lookup('00000000-0000-4000-8000-000000000000'::uuid)`,
          )
        ).rows,
    );
    expect(none).toEqual([]);
    // The lookup lifted RLS only for its own statement: the table is still closed afterwards.
    const after = await asTenant(
      null,
      async () => (await app.query(`SELECT 1 FROM wa_merchant_gateways`)).rowCount,
    );
    expect(after).toBe(0);
  });

  it("the data migration copies a shop's Razorpay keys as they are, skips what is not usable, and can run twice", async () => {
    const sql = readFileSync(
      resolve(MIGRATIONS, '20261030090200_chk_gateway_backfill_razorpay.sql'),
      'utf8',
    );
    const good = await insertShop(orgB, 'rzp-good');
    const noSecret = await insertShop(orgB, 'rzp-nosecret');
    const upi = await insertShop(orgB, 'rzp-upi');
    const cfg = (o: unknown) => JSON.stringify(o);
    await owner.query(
      `UPDATE wa_storefronts SET payment_provider = 'razorpay_api', payment_config_json = $2::jsonb WHERE id = $1`,
      [
        good,
        cfg({ key_id: 'rzp_live_x', key_secret: 'v1:aa:bb:cc', webhook_secret: 'v1:dd:ee:ff' }),
      ],
    );
    await owner.query(
      `UPDATE wa_storefronts SET payment_provider = 'razorpay_api', payment_config_json = $2::jsonb WHERE id = $1`,
      [noSecret, cfg({ key_id: 'rzp_live_y' })],
    );
    await owner.query(
      `UPDATE wa_storefronts SET payment_provider = 'upi', payment_config_json = $2::jsonb WHERE id = $1`,
      [upi, cfg({ handle: 'me@upi' })],
    );
    await owner.query('BEGIN');
    await owner.query(sql);
    await owner.query('COMMIT');
    await owner.query('BEGIN');
    await owner.query(sql);
    await owner.query('COMMIT');

    const rows = (
      await owner.query(
        `SELECT storefront_id, slug, credentials, mode, active, is_default, meta FROM wa_merchant_gateways WHERE org_id = $1 AND storefront_id IN ($2,$3,$4)`,
        [orgB, good, noSecret, upi],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].storefront_id)).toBe(good);
    expect(rows[0]).toMatchObject({
      slug: 'razorpay',
      credentials: null,
      mode: 'live',
      active: true,
      is_default: false,
      meta: {
        migratedFromStorefront: true,
        legacy: { key_id: 'rzp_live_x', key_secret: 'v1:aa:bb:cc', webhook_secret: 'v1:dd:ee:ff' },
      },
    });
    // The old column keeps its value.
    const old = (
      await owner.query(`SELECT payment_config_json c FROM wa_storefronts WHERE id = $1`, [good])
    ).rows[0].c;
    expect(old.key_id).toBe('rzp_live_x');
    void shopB;
  });

  it('registers the merchant-side permission keys (the admin preset gets them from the trigger; the e2e spec calls every route as that admin)', async () => {
    const keys = (
      await owner.query(`SELECT key FROM permission_defs WHERE key = ANY($1) ORDER BY key`, [KEYS])
    ).rows.map((r) => r.key);
    expect(keys).toEqual([...KEYS].sort());
  });
});
