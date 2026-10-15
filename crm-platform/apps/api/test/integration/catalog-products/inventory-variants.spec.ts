import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from '@crm/db';
import { InventoryService } from '../../../src/modules/catalog-products/inventory.service';

/**
 * Variant holds against an already migrated database (set VARIANTS_DB_URL, with a role that may create an organization, e.g. the owner; the transaction is rolled back). Everything runs in
 * one transaction that is rolled back. Skipped without the variable; CI's container-based specs cover the schema itself.
 */
const url = process.env.VARIANTS_DB_URL;
describe.skipIf(!url)('InventoryService with variants', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: url });
  });
  afterAll(async () => pool.end());

  it('holds, commits and releases on the variant and keeps the product aggregate', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = drizzle(client) as unknown as Tx;
      const org = Number(
        (
          await tx.execute(
            sql`INSERT INTO organizations (name, slug) VALUES ('v','v-${sql.raw(String(Date.now()))}') RETURNING id`,
          )
        ).rows[0]!.id,
      );
      await tx.execute(sql`SELECT set_config('app.org_id', ${String(org)}, true)`);
      const pid = Number(
        (
          await tx.execute(
            sql`INSERT INTO wa_products (org_id, name, slug, price_minor) VALUES (${org}, 'T', 't', 1000) RETURNING id`,
          )
        ).rows[0]!.id,
      );
      const vid = async (title: string, stock: number | null, price: number) =>
        Number(
          (
            await tx.execute(sql`INSERT INTO wa_product_variants (org_id, product_id, option_values_json, title, price_minor, stock_qty, position)
            VALUES (${org}, ${pid}, ${JSON.stringify([title])}::jsonb, ${title}, ${price}, ${stock}, 0) RETURNING id`)
          ).rows[0]!.id,
        );
      const s = await vid('S', 2, 900);
      await vid('M', 3, 1000);
      const inv = new InventoryService(null as never);
      expect(await inv.hold(tx, org, pid, 1, 'r0')).toBeNull(); // product with variants needs a variant
      expect(await inv.hold(tx, org, pid, 3, 'r1', { variantId: s })).toBeNull(); // only 2
      const h = await inv.hold(tx, org, pid, 2, 'r2', { variantId: s });
      expect(h?.variantId).toBe(s);
      const agg = async () =>
        (
          await tx.execute(
            sql`SELECT price_minor, stock_qty, reserved_qty, in_stock FROM wa_products WHERE id = ${pid}`,
          )
        ).rows[0];
      expect(await agg()).toMatchObject({
        price_minor: 900,
        stock_qty: 5,
        reserved_qty: 2,
        in_stock: true,
      });
      expect(await inv.release(tx, org, h!.id)).toBe(true);
      expect(await agg()).toMatchObject({ stock_qty: 5, reserved_qty: 0 });
      const h2 = await inv.hold(tx, org, pid, 2, 'r3', { variantId: s });
      expect(await inv.commit(tx, org, h2!.id)).toBe(true);
      expect(await agg()).toMatchObject({ stock_qty: 3, reserved_qty: 0 });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
