import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from '@crm/db';
import { SqlStorefrontProductsReader } from '../../../src/modules/catalog-products/sql-storefront-reader';

/**
 * Last-unit race on a variant, against a scratch database with the product_variants migration applied
 * (MIGRATION_DATABASE_URL, owner role). Skipped when it is not set.
 */
const URL = process.env.MIGRATION_DATABASE_URL;

describe.skipIf(!URL)('storefront reader: variant stock', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let orgId: number;
  let productId: number;
  let variantA: number;
  let variantB: number;
  const reader = new SqlStorefrontProductsReader();
  const tx = <T>(fn: (t: Tx) => Promise<T>) => db.transaction((t) => fn(t as unknown as Tx));
  const scalar = async (q: ReturnType<typeof sql>) =>
    (await db.execute(q)).rows[0] as Record<string, unknown>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL, max: 6 });
    db = drizzle(pool);
    const slug = `vs${Date.now()}`;
    orgId = Number(
      (
        await scalar(
          sql`INSERT INTO organizations (slug,name,plan) VALUES (${slug},'V','starter') RETURNING id`,
        )
      ).id,
    );
    productId = Number(
      (
        await scalar(sql`INSERT INTO wa_products (org_id, slug, name, price_minor, stock_qty, in_stock, options_json)
          VALUES (${orgId}, 'tee', 'Tee', 100, 1, true, '[{"name":"Size","values":["S","M"]}]'::jsonb) RETURNING id`)
      ).id,
    );
    variantA = Number(
      (
        await scalar(sql`INSERT INTO wa_product_variants (org_id, product_id, option_values_json, title, price_minor, stock_qty, position)
          VALUES (${orgId}, ${productId}, '["S"]'::jsonb, 'S', 100, 1, 0) RETURNING id`)
      ).id,
    );
    variantB = Number(
      (
        await scalar(sql`INSERT INTO wa_product_variants (org_id, product_id, option_values_json, title, price_minor, stock_qty, position)
          VALUES (${orgId}, ${productId}, '["M"]'::jsonb, 'M', 150, 3, 1) RETURNING id`)
      ).id,
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`);
    await pool.end();
  });

  it('two buyers racing for the last unit of a variant: exactly one gets it, the aggregate follows', async () => {
    const results = await Promise.all([
      tx((t) => reader.takeStock(t, orgId, productId, 1, variantA)),
      tx((t) => reader.takeStock(t, orgId, productId, 1, variantA)),
    ]);
    expect(results.sort()).toEqual([0, 1]);
    const v = await scalar(
      sql`SELECT stock_qty FROM wa_product_variants WHERE id = ${variantA} AND org_id = ${orgId}`,
    );
    expect(Number(v.stock_qty)).toBe(0);
    const p = await scalar(
      sql`SELECT stock_qty, price_minor, in_stock FROM wa_products WHERE id = ${productId} AND org_id = ${orgId}`,
    );
    expect(Number(p.stock_qty)).toBe(3);
    expect(Number(p.price_minor)).toBe(100); // lowest ACTIVE variant price (invariant 1), sold out or not
    expect(p.in_stock).toBe(true);
  });

  it('takes only what is left and never from another variant', async () => {
    expect(await tx((t) => reader.takeStock(t, orgId, productId, 5, variantB))).toBe(3);
    const p = await scalar(
      sql`SELECT stock_qty, in_stock FROM wa_products WHERE id = ${productId} AND org_id = ${orgId}`,
    );
    expect(Number(p.stock_qty)).toBe(0);
    expect(p.in_stock).toBe(false);
  });
});
