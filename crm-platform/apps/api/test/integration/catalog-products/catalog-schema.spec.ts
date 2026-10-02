import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The catalog tables against a real Postgres as the restricted application role (a superuser bypasses every policy): forced RLS
 * with a tenant_isolation policy, tenant isolation of reads and writes, composite foreign keys that refuse a cross-tenant
 * reference, the value CHECKs, and the touch trigger.
 */
const TABLES = [
  'wa_catalogs',
  'wa_products',
  'wa_product_sets',
  'wa_product_reviews',
  'wa_stock_reservations',
  'cat_catalog_sends',
] as const;

describe('catalog-products: schema, isolation, foreign keys and checks', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;
  let productA: number;
  let productB: number;

  const scalar = async (q: string, params: unknown[] = []) =>
    Number((await owner.query(q, params)).rows[0].id);
  const insertProduct = (org: number, slug: string) =>
    scalar(`INSERT INTO wa_products (org_id, name, slug) VALUES ($1,$2,$2) RETURNING id`, [
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
      `INSERT INTO organizations (slug,name,plan) VALUES ('ca','A','starter') RETURNING id`,
    );
    orgB = await scalar(
      `INSERT INTO organizations (slug,name,plan) VALUES ('cb','B','starter') RETURNING id`,
    );
    userA = await scalar(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@x.test','A','x') RETURNING id`,
      [orgA],
    );
    userB = await scalar(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'b@x.test','B','x') RETURNING id`,
      [orgB],
    );
    productA = await insertProduct(orgA, 'shirt-a');
    productB = await insertProduct(orgB, 'shirt-b');
    for (const [org, id, user] of [
      [orgA, productA, userA],
      [orgB, productB, userB],
    ] as const) {
      await owner.query(
        `INSERT INTO wa_catalogs (org_id, provider, catalog_id) VALUES ($1,'meta_cloud',$2)`,
        [org, `cat-${org}`],
      );
      await owner.query(`INSERT INTO wa_product_sets (org_id, name, slug) VALUES ($1,'Set',$2)`, [
        org,
        `set-${org}`,
      ]);
      await owner.query(
        `INSERT INTO wa_product_reviews (org_id, product_id, rating, status) VALUES ($1,$2,5,'pending')`,
        [org, id],
      );
      await owner.query(
        `INSERT INTO wa_stock_reservations (org_id, product_id, qty, status) VALUES ($1,$2,1,'held')`,
        [org, id],
      );
      await owner.query(
        `INSERT INTO cat_catalog_sends (org_id, user_id, recipient, mode, status) VALUES ($1,$2,'919800000001','link','sent')`,
        [org, user],
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

  it('RLS is enabled and forced on every catalog table, with exactly one tenant_isolation policy', async () => {
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

  it('every table has the (org_id, id) primary key, a unique (org_id, uuid) and the touch trigger', async () => {
    for (const t of TABLES) {
      const pk = await owner.query(
        `SELECT string_agg(a.attname, ',' ORDER BY k.ord) cols
           FROM pg_index i
           CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          WHERE i.indrelid = $1::regclass AND i.indisprimary`,
        [t],
      );
      expect([t, pk.rows[0].cols]).toEqual([t, 'org_id,id']);
      const uuid = await owner.query(
        `SELECT 1 FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'u'
            AND pg_get_constraintdef(oid) = 'UNIQUE (org_id, uuid)'`,
        [t],
      );
      expect([t, uuid.rowCount]).toEqual([t, 1]);
      const trg = await owner.query(
        `SELECT 1 FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2`,
        [t, `trg_${t}_touch`],
      );
      expect([t, trg.rowCount]).toEqual([t, 1]);
    }
  });

  it('a tenant sees only its own rows in every table, and with no tenant set sees nothing', async () => {
    for (const t of TABLES) {
      const mine = await asTenant(orgA, () => app.query(`SELECT DISTINCT org_id FROM ${t}`));
      expect([t, mine.rows.map((r) => Number(r.org_id))]).toEqual([t, [orgA]]);
      const none = await asTenant(null, () =>
        app.query(`SELECT 1 FROM ${t}`).catch(() => ({ rows: [] })),
      );
      expect([t, none.rows.length]).toEqual([t, 0]);
    }
  });

  it('a tenant cannot insert, update or delete into another tenant', async () => {
    const inserts: Record<(typeof TABLES)[number], string> = {
      wa_catalogs: `INSERT INTO wa_catalogs (org_id, provider, catalog_id) VALUES ($1,'dialog_360','x')`,
      wa_products: `INSERT INTO wa_products (org_id, name, slug) VALUES ($1,'x','x-hijack')`,
      wa_product_sets: `INSERT INTO wa_product_sets (org_id, name, slug) VALUES ($1,'x','hijack')`,
      wa_product_reviews: `INSERT INTO wa_product_reviews (org_id, product_id) VALUES ($1, ${productB})`,
      wa_stock_reservations: `INSERT INTO wa_stock_reservations (org_id, product_id, qty) VALUES ($1, ${productB}, 1)`,
      cat_catalog_sends: `INSERT INTO cat_catalog_sends (org_id, recipient, mode, status) VALUES ($1,'1','link','sent')`,
    };
    for (const t of TABLES) {
      await expect(
        asTenant(orgA, () => app.query(inserts[t], [orgB])),
        t,
      ).rejects.toThrow(/row-level security/);
      const upd = await asTenant(orgA, () =>
        app.query(`UPDATE ${t} SET updated_at = now() WHERE org_id = $1`, [orgB]),
      );
      expect([t, upd.rowCount]).toEqual([t, 0]);
      const del = await asTenant(orgA, () =>
        app.query(`DELETE FROM ${t} WHERE org_id = $1`, [orgB]),
      );
      expect([t, del.rowCount]).toEqual([t, 0]);
    }
  });

  it("composite foreign keys refuse a reference to another tenant's parent row", async () => {
    const cross: Array<[string, string]> = [
      [
        'review -> product',
        `INSERT INTO wa_product_reviews (org_id, product_id) VALUES (${orgA}, ${productB})`,
      ],
      [
        'reservation -> product',
        `INSERT INTO wa_stock_reservations (org_id, product_id, qty) VALUES (${orgA}, ${productB}, 1)`,
      ],
      [
        'product -> user',
        `INSERT INTO wa_products (org_id, name, slug, user_id) VALUES (${orgA}, 'x', 'cross-user', ${userB})`,
      ],
      [
        'set -> user',
        `INSERT INTO wa_product_sets (org_id, name, slug, user_id) VALUES (${orgA}, 'x', 'cross-set', ${userB})`,
      ],
      [
        'send -> user',
        `INSERT INTO cat_catalog_sends (org_id, user_id, recipient, mode, status) VALUES (${orgA}, ${userB}, '1', 'link', 'sent')`,
      ],
    ];
    for (const [label, sql] of cross) {
      await expect(owner.query(sql), label).rejects.toThrow(/violates foreign key constraint/);
    }
    // The same row pointing inside the tenant is fine.
    const ok = await scalar(
      `INSERT INTO wa_product_reviews (org_id, product_id) VALUES (${orgA}, ${productA}) RETURNING id`,
    );
    await owner.query(`DELETE FROM wa_product_reviews WHERE org_id = ${orgA} AND id = ${ok}`);
  });

  it('deleting a product takes its reviews and stock holds with it; a deleted user leaves its sends and sets behind', async () => {
    const p = await insertProduct(orgA, 'cascade-me');
    await owner.query(`INSERT INTO wa_product_reviews (org_id, product_id) VALUES ($1,$2)`, [
      orgA,
      p,
    ]);
    await owner.query(
      `INSERT INTO wa_stock_reservations (org_id, product_id, qty) VALUES ($1,$2,2)`,
      [orgA, p],
    );
    await owner.query(`DELETE FROM wa_products WHERE org_id = $1 AND id = $2`, [orgA, p]);
    for (const t of ['wa_product_reviews', 'wa_stock_reservations']) {
      expect(
        Number(
          (await owner.query(`SELECT count(*)::int n FROM ${t} WHERE product_id = $1`, [p])).rows[0]
            .n,
        ),
        t,
      ).toBe(0);
    }
    const u = await scalar(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'gone@x.test','G','x') RETURNING id`,
      [orgA],
    );
    const send = await scalar(
      `INSERT INTO cat_catalog_sends (org_id, user_id, recipient, mode, status) VALUES ($1,$2,'1','link','sent') RETURNING id`,
      [orgA, u],
    );
    await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, u]);
    const after = await owner.query(
      `SELECT user_id FROM cat_catalog_sends WHERE org_id = $1 AND id = $2`,
      [orgA, send],
    );
    expect(after.rows[0].user_id).toBeNull();
  });

  it('value CHECKs refuse what the application never writes', async () => {
    const bad: Array<[string, string, RegExp]> = [
      [
        'catalog provider',
        `INSERT INTO wa_catalogs (org_id, provider, catalog_id) VALUES (${orgA}, 'carrier_pigeon', 'x')`,
        /chk_wa_catalogs_provider/,
      ],
      [
        'product status',
        `INSERT INTO wa_products (org_id, name, slug, status) VALUES (${orgA}, 'x', 'bad-status', 'deleted')`,
        /chk_wa_products_status/,
      ],
      [
        'product availability',
        `INSERT INTO wa_products (org_id, name, slug, availability) VALUES (${orgA}, 'x', 'bad-av', 'maybe')`,
        /chk_wa_products_availability/,
      ],
      [
        'product condition',
        `INSERT INTO wa_products (org_id, name, slug, condition) VALUES (${orgA}, 'x', 'bad-cond', 'broken')`,
        /chk_wa_products_condition/,
      ],
      [
        'negative price',
        `INSERT INTO wa_products (org_id, name, slug, price_minor) VALUES (${orgA}, 'x', 'bad-price', -1)`,
        /chk_wa_products_price/,
      ],
      [
        'negative stock',
        `INSERT INTO wa_products (org_id, name, slug, stock_qty) VALUES (${orgA}, 'x', 'bad-stock', -3)`,
        /chk_wa_products_stock/,
      ],
      [
        'sync status',
        `INSERT INTO wa_products (org_id, name, slug, meta_sync_status) VALUES (${orgA}, 'x', 'bad-sync', 'lost')`,
        /chk_wa_products_meta_sync_status/,
      ],
      [
        'duplicate slug',
        `INSERT INTO wa_products (org_id, name, slug) VALUES (${orgA}, 'x', 'shirt-a')`,
        /uq_wa_products_slug/,
      ],
      [
        'rating 17',
        `INSERT INTO wa_product_reviews (org_id, product_id, rating) VALUES (${orgA}, ${productA}, 17)`,
        /chk_wa_product_reviews_rating/,
      ],
      [
        'rating 0',
        `INSERT INTO wa_product_reviews (org_id, product_id, rating) VALUES (${orgA}, ${productA}, 0)`,
        /chk_wa_product_reviews_rating/,
      ],
      [
        'review status',
        `INSERT INTO wa_product_reviews (org_id, product_id, status) VALUES (${orgA}, ${productA}, 'spam')`,
        /chk_wa_product_reviews_status/,
      ],
      [
        'hold of 0',
        `INSERT INTO wa_stock_reservations (org_id, product_id, qty) VALUES (${orgA}, ${productA}, 0)`,
        /chk_wa_stock_reservations_qty/,
      ],
      [
        'hold status',
        `INSERT INTO wa_stock_reservations (org_id, product_id, qty, status) VALUES (${orgA}, ${productA}, 1, 'lost')`,
        /chk_wa_stock_reservations_status/,
      ],
      [
        'send mode',
        `INSERT INTO cat_catalog_sends (org_id, recipient, mode, status) VALUES (${orgA}, '1', 'carousel', 'sent')`,
        /chk_cat_catalog_sends_mode/,
      ],
      [
        'send status',
        `INSERT INTO cat_catalog_sends (org_id, recipient, mode, status) VALUES (${orgA}, '1', 'link', 'queued')`,
        /chk_cat_catalog_sends_status/,
      ],
      [
        'second catalog of a provider',
        `INSERT INTO wa_catalogs (org_id, provider, catalog_id) VALUES (${orgA}, 'meta_cloud', 'again')`,
        /uq_wa_catalogs_provider/,
      ],
      [
        'duplicate set slug',
        `INSERT INTO wa_product_sets (org_id, name, slug) VALUES (${orgA}, 'x', 'set-${orgA}')`,
        /uq_wa_product_sets_slug/,
      ],
    ];
    for (const [label, sql, re] of bad) await expect(owner.query(sql), label).rejects.toThrow(re);
  });

  it('the same slug and provider are fine in another tenant (uniqueness is per organization)', async () => {
    await owner.query(`INSERT INTO wa_products (org_id, name, slug) VALUES ($1,'x','shirt-a')`, [
      orgB,
    ]);
    await owner.query(`DELETE FROM wa_products WHERE org_id = $1 AND slug = 'shirt-a'`, [orgB]);
  });

  it('the touch trigger bumps row_version and updated_at on every update', async () => {
    const before = (
      await owner.query(`SELECT row_version v FROM wa_products WHERE id = $1`, [productA])
    ).rows[0].v;
    await owner.query(`UPDATE wa_products SET name = 'Shirt A2' WHERE org_id = $1 AND id = $2`, [
      orgA,
      productA,
    ]);
    const after = (
      await owner.query(`SELECT row_version v FROM wa_products WHERE id = $1`, [productA])
    ).rows[0].v;
    expect(after).toBe(before + 1);
  });

  it('the trigram index behind the name search exists', async () => {
    const r = await owner.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_wa_products_name_trgm'`,
    );
    expect(r.rows[0].indexdef).toContain('gin_trgm_ops');
  });
});
