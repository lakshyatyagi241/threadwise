import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from '@crm/db';
import { resolveVariantRetailerIds } from '../../../src/modules/catalog-products/catalog-variants';
import { InventoryService } from '../../../src/modules/catalog-products/inventory.service';
import { WabaOrdersService } from '../../../src/modules/whatsapp-cloud-api-waba/waba-orders.service';
import { OrderingFlowService } from '../../../src/modules/flow-runtime-engine/runtime/nodes/ai/ordering.service';
import { SqlStoreMirror } from '../../../src/modules/shopify-woocommerce/_shims/sql-store-mirror';
import { shopifyProduct, wooProduct } from '../../../src/modules/shopify-woocommerce/mirror-rules';

/**
 * The channel layers of product variants against a scratch database with the product_variants migration applied
 * (MIGRATION_DATABASE_URL, owner role, so RLS is not exercised here). Skipped when it is not set. The model, translation and
 * contact services are fakes; no provider is called.
 */
const URL = process.env.MIGRATION_DATABASE_URL;

describe.skipIf(!URL)('product variants on the WhatsApp, flow and store-mirror side', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let orgId: number;
  let productId: number;
  const tx = <T>(fn: (t: Tx) => Promise<T>) => db.transaction((t) => fn(t as unknown as Tx));
  const row = async (q: ReturnType<typeof sql>) =>
    (await db.execute(q)).rows[0] as Record<string, unknown>;
  const rows = async (q: ReturnType<typeof sql>) =>
    (await db.execute(q)).rows as Array<Record<string, unknown>>;
  const dbService = { txAs: (_c: unknown, fn: (t: Tx) => Promise<unknown>) => tx(fn) };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL, max: 4 });
    db = drizzle(pool);
    orgId = Number(
      (
        await row(
          sql`INSERT INTO organizations (slug,name,plan) VALUES (${`vc${Date.now()}`},'VC','starter') RETURNING id`,
        )
      ).id,
    );
    productId = Number(
      (
        await row(sql`INSERT INTO wa_products (org_id, slug, name, sku, price_minor, currency_code, stock_qty, in_stock, status, options_json)
          VALUES (${orgId}, 'hoodie', 'Hoodie', 'HOOD', 100000, 'INR', 8, true, 'active',
                  '[{"name":"Size","values":["S","M"]},{"name":"Colour","values":["Red","Blue"]}]'::jsonb) RETURNING id`)
      ).id,
    );
    const v = (
      vals: string,
      title: string,
      sku: string | null,
      price: number,
      stock: number | null,
      pos: number,
    ) =>
      db.execute(sql`INSERT INTO wa_product_variants (org_id, product_id, option_values_json, title, sku, price_minor, stock_qty, position, meta_retailer_id)
        VALUES (${orgId}, ${productId}, ${vals}::jsonb, ${title}, ${sku}, ${price}, ${stock}, ${pos}, NULL)`);
    await v('["S","Red"]', 'S / Red', 'HOOD-S-RED', 100000, 2, 0);
    await v('["M","Red"]', 'M / Red', null, 120000, 3, 1);
    await v('["M","Blue"]', 'M / Blue', null, 120000, 3, 2);
    await db.execute(
      sql`UPDATE wa_product_variants SET meta_retailer_id = 'custom-mb' WHERE org_id = ${orgId} AND title = 'M / Blue'`,
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`);
    await pool.end();
  });

  it('resolves a variant by its stored id, its SKU or the derived <product id>-<position + 1>', async () => {
    const got = await tx((t) =>
      resolveVariantRetailerIds(t, orgId, ['HOOD-S-RED', 'HOOD-2', 'custom-mb', 'HOOD', 'nope']),
    );
    expect([...got.keys()].sort()).toEqual(['HOOD-2', 'HOOD-S-RED', 'custom-mb']);
    expect(got.get('HOOD-2')).toMatchObject({
      title: 'M / Red',
      priceMinor: 120000,
      stockQty: 3,
      productId,
    });
  });

  it('a WhatsApp cart line naming a variant becomes an order line with the variant fields', async () => {
    const outbox = { emit: async () => undefined };
    const contacts = {
      findOrCreateByPhone: async () => ({ outcome: 'skipped', reason: 'no_phone' }),
    };
    const svc = new WabaOrdersService(outbox as never, contacts as never);
    const id = await tx((t) =>
      svc.capture(
        t,
        orgId,
        1,
        {
          id: `wamid.${Date.now()}`,
          type: 'order',
          order: {
            catalog_id: 'c1',
            product_items: [
              { product_retailer_id: 'HOOD-2', quantity: 2, item_price: 1200, currency: 'INR' },
              { product_retailer_id: 'HOOD-S-RED', quantity: 5, item_price: 1000, currency: 'INR' },
              { product_retailer_id: 'HOOD', quantity: 1, item_price: 1000, currency: 'INR' },
            ],
          },
        },
        '+91 90000 00001',
        'Asha',
      ),
    );
    expect(id).not.toBeNull();
    const o = await row(
      sql`SELECT items_json, meta_json FROM wa_orders WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const items = o.items_json as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      retailer_id: 'HOOD-2',
      variant_title: 'M / Red',
      name: 'Hoodie',
      quantity: 2,
      price_minor: 120000,
      product_id: productId,
    });
    expect(typeof items[0]!.variant_id).toBe('string');
    expect(items[1]).toMatchObject({ variant_title: 'S / Red', quantity: 5 });
    // The product's own retailer id (no variant) is a plain line, as before.
    expect(items[2]).toMatchObject({ retailer_id: 'HOOD', name: 'Hoodie' });
    expect(items[2]).not.toHaveProperty('variant_id');
    // 5 requested of a variant with 2 in stock is noted for the merchant.
    expect((o.meta_json as { stock_warnings: unknown[] }).stock_warnings).toEqual([
      { retailer_id: 'HOOD-S-RED', requested: 5, available: 2, active: true },
    ]);
    const li = await rows(
      sql`SELECT retailer_id, quantity FROM wa_order_items WHERE org_id = ${orgId} AND order_id = ${id} ORDER BY id`,
    );
    expect(li.map((r) => r.retailer_id)).toEqual(['HOOD-2', 'HOOD-S-RED', 'HOOD']);
  });

  describe('AI ordering', () => {
    const phone = '919000000002';
    const make = (modelItems: unknown) => {
      const ai = { call: async () => ({ ok: true, reply: JSON.stringify({ items: modelItems }) }) };
      const translation = {
        detectAndTranslate: async (text: string) => ({ language: 'en', text }),
        translate: async (text: string) => text,
      };
      const media = { resolve: async () => null };
      const group = { notify: async () => ({ posted: false, reason: 'off' }) };
      const outbox = { emit: async () => undefined };
      const contacts = {
        findOrCreateByPhone: async () => ({ outcome: 'skipped', reason: 'no_phone' }),
      };
      return new OrderingFlowService(
        dbService as never,
        ai as never,
        new InventoryService(dbService as never),
        translation as never,
        media as never,
        group as never,
        outbox as never,
        contacts as never,
      );
    };

    it('matches the variant from the customer words, holds that variant and prices it', async () => {
      const svc = make([{ name: 'hoodie', qty: 2, variant: 'M red' }]);
      const res = await svc.parse(orgId, { customer_phone: phone, text: '2 hoodie M red' });
      expect(res.has_items).toBe(true);
      expect(res.items[0]).toMatchObject({
        name: 'Hoodie',
        variant_title: 'M / Red',
        qty: 2,
        price_minor: 120000,
        retailer_id: 'HOOD-2',
      });
      expect(res.summary).toContain('2 × Hoodie (M / Red)');
      const v = await row(
        sql`SELECT reserved_qty FROM wa_product_variants WHERE org_id = ${orgId} AND title = 'M / Red'`,
      );
      expect(Number(v.reserved_qty)).toBe(2);
      const p = await row(
        sql`SELECT reserved_qty FROM wa_products WHERE org_id = ${orgId} AND id = ${productId}`,
      );
      expect(Number(p.reserved_qty)).toBe(2);
      // Confirm: the order line carries the variant and the stock goes down on the variant.
      const done = await svc.confirm(orgId, {
        customer_phone: phone,
        ship_text: '',
        notify_group: false,
      });
      expect(done.ok).toBe(true);
      const after = await row(
        sql`SELECT stock_qty, reserved_qty FROM wa_product_variants WHERE org_id = ${orgId} AND title = 'M / Red'`,
      );
      expect(Number(after.stock_qty)).toBe(1);
      expect(Number(after.reserved_qty)).toBe(0);
      const order = await row(
        sql`SELECT items_json FROM wa_orders WHERE org_id = ${orgId} AND source = 'whatsapp_ai' ORDER BY id DESC LIMIT 1`,
      );
      expect((order.items_json as Array<Record<string, unknown>>)[0]).toMatchObject({
        variant_title: 'M / Red',
        retailer_id: 'HOOD-2',
      });
    });

    it('asks for the option the customer left out and holds nothing', async () => {
      const before = await row(
        sql`SELECT sum(reserved_qty)::int AS r FROM wa_product_variants WHERE org_id = ${orgId}`,
      );
      const svc = make([{ name: 'hoodie', qty: 1, variant: 'M' }]);
      const res = await svc.parse(orgId, { customer_phone: phone, text: 'hoodie M' });
      expect(res.has_items).toBe(false);
      expect(res.unavailable[0]).toMatchObject({
        reason: 'option_required',
        options: [{ name: 'Colour', values: ['Red', 'Blue'] }],
      });
      expect(res.summary).toContain('please tell us the Colour: Red, Blue');
      const after = await row(
        sql`SELECT sum(reserved_qty)::int AS r FROM wa_product_variants WHERE org_id = ${orgId}`,
      );
      expect(after.r).toBe(before.r);
    });

    it('reports the variant that is out of stock, not the product aggregate', async () => {
      const svc = make([{ name: 'hoodie', qty: 5, variant: 'S red' }]);
      const res = await svc.parse(orgId, { customer_phone: phone, text: '5 hoodie S red' });
      expect(res.unavailable[0]).toMatchObject({
        reason: 'out_of_stock',
        available: 2,
        name: 'Hoodie (S / Red)',
      });
    });
  });

  describe('store mirror', () => {
    const mirror = new SqlStoreMirror({} as never);
    const ctx = { storeUrl: 'demo.myshopify.com', currency: 'USD' };
    const tee = (over: Record<string, unknown> = {}) => ({
      id: 880001,
      title: 'Mirror Tee',
      handle: 'mirror-tee',
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        {
          id: 1,
          option1: 'S',
          sku: 'MT-S',
          price: '10.00',
          inventory_management: 'shopify',
          inventory_quantity: 4,
        },
        {
          id: 2,
          option1: 'M',
          sku: '',
          price: '12.00',
          inventory_management: 'shopify',
          inventory_quantity: 6,
        },
      ],
      ...over,
    });
    const state = async () => ({
      p: await row(
        sql`SELECT price_minor, stock_qty, in_stock, options_json FROM wa_products WHERE org_id = ${orgId} AND shopify_product_id = '880001'`,
      ),
      v: await rows(sql`SELECT v.title, v.sku, v.price_minor, v.stock_qty, v.reserved_qty, v.position FROM wa_product_variants v
        JOIN wa_products p ON p.org_id = v.org_id AND p.id = v.product_id WHERE v.org_id = ${orgId} AND p.shopify_product_id = '880001' ORDER BY v.position`),
    });

    it('imports variants and keeps the product row as the aggregate', async () => {
      await tx((t) => mirror.upsertProduct(t, orgId, 'shopify', null, shopifyProduct(tee(), ctx)));
      const s = await state();
      expect(s.v.map((x) => [x.title, x.sku, Number(x.price_minor), Number(x.stock_qty)])).toEqual([
        ['S', 'MT-S', 1000, 4],
        ['M', 'SHOPIFY-V2', 1200, 6],
      ]);
      expect(Number(s.p.price_minor)).toBe(1000);
      expect(Number(s.p.stock_qty)).toBe(10);
      expect(s.p.in_stock).toBe(true);
      expect(s.p.options_json).toEqual([{ name: 'Size', values: ['S', 'M'] }]);
    });

    it('a re-import updates stock and price, keeps the holds, adds and removes variants, and never duplicates', async () => {
      await db.execute(
        sql`UPDATE wa_product_variants SET reserved_qty = 1 WHERE org_id = ${orgId} AND title = 'S'`,
      );
      const next = tee({
        options: [{ name: 'Size', values: ['S', 'L'] }],
        variants: [
          {
            id: 1,
            option1: 'S',
            sku: 'MT-S',
            price: '9.00',
            inventory_management: 'shopify',
            inventory_quantity: 0,
          },
          {
            id: 3,
            option1: 'L',
            sku: 'MT-L',
            price: '14.00',
            inventory_management: null,
            inventory_quantity: 0,
          },
        ],
      });
      await tx((t) => mirror.upsertProduct(t, orgId, 'shopify', null, shopifyProduct(next, ctx)));
      const s = await state();
      expect(
        s.v.map((x) => [
          x.title,
          Number(x.price_minor),
          x.stock_qty === null ? null : Number(x.stock_qty),
          Number(x.reserved_qty),
        ]),
      ).toEqual([
        ['S', 900, 0, 1],
        ['L', 1400, null, 0],
      ]);
      // An unlimited active variant makes the product unlimited; the lowest price wins.
      expect(s.p.stock_qty).toBeNull();
      expect(Number(s.p.price_minor)).toBe(900);
      expect(s.p.in_stock).toBe(true);
      const count = await row(
        sql`SELECT count(*)::int AS n FROM wa_products WHERE org_id = ${orgId} AND shopify_product_id = '880001'`,
      );
      expect(count.n).toBe(1);
    });

    it('swapping two SKUs in one import does not trip the unique SKU index', async () => {
      const swap = tee({
        options: [{ name: 'Size', values: ['S', 'L'] }],
        variants: [
          { id: 1, option1: 'S', sku: 'MT-L', price: '9.00', inventory_management: null },
          { id: 3, option1: 'L', sku: 'MT-S', price: '14.00', inventory_management: null },
        ],
      });
      await tx((t) => mirror.upsertProduct(t, orgId, 'shopify', null, shopifyProduct(swap, ctx)));
      expect((await state()).v.map((x) => [x.title, x.sku])).toEqual([
        ['S', 'MT-L'],
        ['L', 'MT-S'],
      ]);
    });

    it('a product the store now sells without variants is a plain product again', async () => {
      const plain = {
        id: 880001,
        title: 'Mirror Tee',
        handle: 'mirror-tee',
        options: [{ name: 'Title', values: ['Default Title'] }],
        variants: [{ id: 9, option1: 'Default Title', sku: 'MT', price: '8.00' }],
      };
      await tx((t) => mirror.upsertProduct(t, orgId, 'shopify', null, shopifyProduct(plain, ctx)));
      const s = await state();
      expect(s.v).toEqual([]);
      expect(s.p.options_json).toBeNull();
      expect(Number(s.p.price_minor)).toBe(800);
    });

    it('a WooCommerce variable product whose variations were not read keeps its stored variants', async () => {
      const wctx = { storeUrl: 'https://w.test', currency: 'USD' };
      const full = {
        id: 880002,
        type: 'variable',
        name: 'Woo Shirt',
        price: '20.00',
        variations: [1, 2],
        attributes: [{ name: 'Size', variation: true, options: ['Small', 'Large'] }],
        _variations: [
          {
            id: 1,
            sku: 'WS-S',
            price: '20.00',
            manage_stock: true,
            stock_quantity: 3,
            attributes: [{ name: 'Size', option: 'Small' }],
          },
          {
            id: 2,
            sku: '',
            price: '22.00',
            manage_stock: false,
            stock_status: 'instock',
            attributes: [{ name: 'Size', option: 'Large' }],
          },
        ],
      };
      await tx((t) => mirror.upsertProduct(t, orgId, 'woocommerce', null, wooProduct(full, wctx)));
      const { _variations, ...bare } = full;
      void _variations;
      await tx((t) => mirror.upsertProduct(t, orgId, 'woocommerce', null, wooProduct(bare, wctx)));
      const v =
        await rows(sql`SELECT v.title, v.sku, v.stock_qty FROM wa_product_variants v JOIN wa_products p ON p.org_id = v.org_id AND p.id = v.product_id
        WHERE v.org_id = ${orgId} AND p.woo_product_id = '880002' ORDER BY v.position`);
      expect(v.map((x) => [x.title, x.sku])).toEqual([
        ['Small', 'WS-S'],
        ['Large', 'WOO-V2'],
      ]);
    });
  });
});
