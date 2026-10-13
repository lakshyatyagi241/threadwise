import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  SHOPIFY,
  WOOCOMMERCE,
  type EcomResult,
  type ShopInfo,
  type ShopifyFactory,
  type StoreCounts,
  type StoreRead,
  type WooFactory,
  type WooStoreInfo,
} from '../../../src/infra/providers/ecom/ecom.port';
import { ImportService } from '../../../src/modules/shopify-woocommerce/import.service';
import { startHarness, type Harness } from '../auth-registration-security/harness';
import { Api, bearer, type Tenant } from '../contacts-attributes-tags/support';

/** Importing a store into the CRM and sync now (TW-ECOM-011, 013), against a real Postgres and fake stores. */
let h: Harness;
let api: Api;
let crypto: CryptoService;
let imports: ImportService;

const empty: StoreRead = { items: [], complete: true };
let shopifyData: { products: StoreRead; orders: StoreRead; customers: StoreRead } = {
  products: empty,
  orders: empty,
  customers: empty,
};
let wooData: typeof shopifyData = { products: empty, orders: empty, customers: empty };
let counts: StoreCounts = { products: 3, orders: 2, customers: 1 };
let shopInfo: EcomResult<ShopInfo> = {
  ok: true,
  data: {
    id: '1',
    name: 'Fresh Name',
    email: null,
    owner: null,
    plan: 'pro',
    currency: null,
    country: 'India',
  },
};
let wooProbe: EcomResult<WooStoreInfo> = {
  ok: true,
  data: { name: 'Woo Fresh', currency: 'USD', country: 'US', version: '9.2' },
};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h as never);
  crypto = h.app.get(CryptoService, { strict: false });
  imports = h.app.get(ImportService);
  const shopify = h.app.get<ShopifyFactory>(SHOPIFY);
  shopify.store = () => ({
    shop: () => Promise.resolve(shopInfo),
    counts: () => Promise.resolve(counts),
    products: () => Promise.resolve(shopifyData.products),
    orders: () => Promise.resolve(shopifyData.orders),
    customers: () => Promise.resolve(shopifyData.customers),
    registerWebhooks: () => Promise.resolve({}),
    deleteWebhooks: () => Promise.resolve(),
  });
  const woo = h.app.get<WooFactory>(WOOCOMMERCE);
  woo.store = () => ({
    test: () => Promise.resolve(wooProbe),
    counts: () => Promise.resolve(counts),
    products: () => Promise.resolve(wooData.products),
    orders: () => Promise.resolve(wooData.orders),
    customers: () => Promise.resolve(wooData.customers),
    registerWebhooks: () => Promise.resolve({}),
    deleteWebhooks: () => Promise.resolve(),
    updateOrder: () => Promise.resolve(true),
    recent: () => Promise.resolve([]),
    salesReport: () => Promise.resolve({}),
    variations: () => Promise.resolve({ items: [], complete: true }),
    createPendingOrder: () => Promise.resolve(null),
  });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  shopifyData = { products: empty, orders: empty, customers: empty };
  wooData = { products: empty, orders: empty, customers: empty };
  counts = { products: 3, orders: 2, customers: 1 };
  shopInfo = {
    ok: true,
    data: {
      id: '1',
      name: 'Fresh Name',
      email: null,
      owner: null,
      plan: 'pro',
      currency: null,
      country: 'India',
    },
  };
  wooProbe = {
    ok: true,
    data: { name: 'Woo Fresh', currency: 'USD', country: 'US', version: '9.2' },
  };
});

const read = (items: Array<Record<string, unknown>>, complete = true): StoreRead => ({
  items,
  complete,
});

async function shopifyStore(t: Tenant, token = 'shpat_x'): Promise<number> {
  const r = await h.owner.query(
    `INSERT INTO shopify_integrations (org_id, user_id, store_url, store_name, shop_currency, access_token, webhook_secret)
     VALUES ($1, $2, 'my-store.myshopify.com', 'My Store', 'INR', $3, 'whsecret') RETURNING id`,
    [t.orgId, t.adminUserId, token === '' ? '' : crypto.encrypt(token)],
  );
  return Number(r.rows[0].id);
}

async function wooStore(t: Tenant): Promise<number> {
  const r = await h.owner.query(
    `INSERT INTO woocommerce_integrations (org_id, user_id, store_url, store_name, store_currency, consumer_key, consumer_secret, webhook_secret)
     VALUES ($1, $2, 'https://example.com', 'Woo', 'USD', $3, $4, 'whsecret') RETURNING id`,
    [t.orgId, t.adminUserId, crypto.encrypt('ck'), crypto.encrypt('cs')],
  );
  return Number(r.rows[0].id);
}

const q = async (sql: string, t: Tenant) => (await h.owner.query(sql, [t.orgId])).rows;

const sProduct = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  title: `Shirt ${id}`,
  handle: `shirt-${id}`,
  status: 'active',
  variants: [
    { price: '100.00', compare_at_price: '150.00', sku: `SKU-${id}`, inventory_quantity: 5 },
  ],
  ...over,
});

describe('a Shopify import (TW-ECOM-011)', () => {
  it('brings products, orders and customers into the catalog, the orders and the contacts, and stamps the store', async () => {
    const t = await api.signup('eis');
    const id = await shopifyStore(t);
    shopifyData = {
      products: read([
        sProduct(1),
        sProduct(2, { variants: [{ price: '20', inventory_quantity: 0 }] }),
      ]),
      orders: read([
        {
          id: 501,
          name: '#1001',
          order_number: 1001,
          total_price: '300.00',
          currency: 'INR',
          financial_status: 'paid',
          customer: { first_name: 'Asha', last_name: 'K', phone: '+91 98765 43210' },
          line_items: [{ title: 'Shirt 1', quantity: 2, price: '100.00', sku: 'SKU-1' }],
        },
      ]),
      customers: read([
        {
          id: 9,
          first_name: 'Asha',
          last_name: 'K',
          email: 'asha@x.test',
          phone: '+91 98765 43210',
          orders_count: 2,
          total_spent: '300.00',
        },
        { id: 10, first_name: 'No', last_name: 'Phone' },
      ]),
    };
    const stats = await imports.run(t.orgId, 'shopify', id);
    expect(stats).toEqual({ products: 2, orders: 1, customers: 1, incomplete: 0 });

    const products = await q(`SELECT * FROM wa_products WHERE org_id = $1 ORDER BY id`, t);
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({
      shopify_product_id: '1',
      sku: 'SKU-1',
      name: 'Shirt 1',
      slug: 'shirt-1',
      price_minor: 10000,
      compare_price_minor: 15000,
      currency_code: 'INR',
      in_stock: true,
      availability: 'in stock',
      status: 'active',
      product_url: 'https://my-store.myshopify.com/products/shirt-1',
    });
    expect(products[1]).toMatchObject({
      in_stock: false,
      availability: 'out of stock',
      compare_price_minor: null,
    });

    const [order] = await q(`SELECT * FROM wa_orders WHERE org_id = $1`, t);
    expect(order).toMatchObject({
      shopify_order_id: '501',
      source: 'shopify',
      customer_phone: '919876543210',
      customer_name: 'Asha K',
      total_minor: 30000,
      currency_code: 'INR',
      status: 'paid',
    });
    expect(order.items_json).toEqual([{ title: 'Shirt 1', qty: 2, price: '100.00', sku: 'SKU-1' }]);

    const contacts = await q(`SELECT name, phone, email, data FROM contacts WHERE org_id = $1`, t);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      name: 'Asha K',
      phone: '+919876543210',
      email: 'asha@x.test',
    });
    expect(contacts[0].data).toMatchObject({
      shopify_customer_id: '9',
      orders_count: 2,
      total_spent: '300.00',
    });
    const group = await q(
      `SELECT g.name, g.color, count(m.id)::int AS members FROM contact_groups g
       LEFT JOIN contact_group_members m ON m.org_id = g.org_id AND m.group_id = g.id
       WHERE g.org_id = $1 GROUP BY g.org_id, g.id`,
      t,
    );
    expect(group).toEqual([{ name: 'Shopify Customers', color: '#95BF47', members: 1 }]);

    const [store] = await q(`SELECT * FROM shopify_integrations WHERE org_id = $1`, t);
    expect(store.sync_stats).toEqual({ products: 2, orders: 1, customers: 1, incomplete: 0 });
    expect(store.products_synced_at).not.toBeNull();
    expect(store.customers_synced_at).not.toBeNull();
    expect(typeof store.metadata.shopify_group_id).toBe('number');
  });

  it('importing again updates in place and never duplicates, and a contact that already has the number only joins the group', async () => {
    const t = await api.signup('eit');
    const id = await shopifyStore(t);
    await h.owner.query(
      `INSERT INTO contacts (org_id, name, phone) VALUES ($1, 'Existing Asha', '+919876543210')`,
      [t.orgId],
    );
    shopifyData = {
      products: read([sProduct(1)]),
      orders: read([{ id: 501, total_price: '10', financial_status: 'pending' }]),
      customers: read([{ id: 9, first_name: 'Asha', phone: '919876543210' }]),
    };
    await imports.run(t.orgId, 'shopify', id);
    shopifyData.products = read([
      sProduct(1, {
        title: 'Renamed shirt',
        variants: [{ price: '250.00', sku: 'SKU-1', inventory_quantity: 1 }],
      }),
    ]);
    shopifyData.orders = read([{ id: 501, total_price: '10', financial_status: 'paid' }]);
    await imports.run(t.orgId, 'shopify', id);

    const products = await q(`SELECT name, price_minor FROM wa_products WHERE org_id = $1`, t);
    expect(products).toEqual([{ name: 'Renamed shirt', price_minor: 25000 }]);
    expect(await q(`SELECT status FROM wa_orders WHERE org_id = $1`, t)).toEqual([
      { status: 'paid' },
    ]);
    const contacts = await q(`SELECT name FROM contacts WHERE org_id = $1`, t);
    expect(contacts).toEqual([{ name: 'Existing Asha' }]);
    expect(await q(`SELECT 1 FROM contact_group_members WHERE org_id = $1`, t)).toHaveLength(1);
  });

  it('two products with the same slug both land, the second with its id on the end', async () => {
    const t = await api.signup('eiu');
    const id = await shopifyStore(t);
    shopifyData.products = read([sProduct(1, { handle: 'same' }), sProduct(2, { handle: 'same' })]);
    const stats = await imports.run(t.orgId, 'shopify', id);
    expect(stats.products).toBe(2);
    const slugs = (await q(`SELECT slug FROM wa_products WHERE org_id = $1 ORDER BY id`, t)).map(
      (r) => r.slug,
    );
    expect(slugs).toEqual(['same', 'same-2']);
  });

  it('keeps using the customer group it made, even renamed, and makes a new one when it is gone', async () => {
    const t = await api.signup('eiv');
    const id = await shopifyStore(t);
    shopifyData.customers = read([{ id: 1, first_name: 'A', phone: '111111' }]);
    await imports.run(t.orgId, 'shopify', id);
    await h.owner.query(`UPDATE contact_groups SET name = 'VIPs' WHERE org_id = $1`, [t.orgId]);
    shopifyData.customers = read([{ id: 2, first_name: 'B', phone: '222222' }]);
    await imports.run(t.orgId, 'shopify', id);
    expect(await q(`SELECT name FROM contact_groups WHERE org_id = $1`, t)).toEqual([
      { name: 'VIPs' },
    ]);
    expect(await q(`SELECT 1 FROM contact_group_members WHERE org_id = $1`, t)).toHaveLength(2);

    await h.owner.query(`DELETE FROM contact_groups WHERE org_id = $1`, [t.orgId]);
    shopifyData.customers = read([{ id: 3, first_name: 'C', phone: '333333' }]);
    await imports.run(t.orgId, 'shopify', id);
    expect(await q(`SELECT name FROM contact_groups WHERE org_id = $1`, t)).toEqual([
      { name: 'Shopify Customers' },
    ]);
  });

  it('says so when a resource was cut short, and imports nothing for a store with no credentials or another organization', async () => {
    const t = await api.signup('eiw');
    const other = await api.signup('eix');
    const id = await shopifyStore(t);
    shopifyData.products = read([sProduct(1)], false);
    expect((await imports.run(t.orgId, 'shopify', id)).incomplete).toBe(1);
    expect(
      (await q(`SELECT sync_stats FROM shopify_integrations WHERE org_id = $1`, t))[0].sync_stats
        .incomplete,
    ).toBe(1);

    expect(await imports.run(other.orgId, 'shopify', id)).toEqual({
      products: 0,
      orders: 0,
      customers: 0,
      incomplete: 0,
    });
    expect(await q(`SELECT 1 FROM wa_products WHERE org_id = $1`, other)).toHaveLength(0);

    const gone = await shopifyStore(other, '');
    expect(await imports.run(other.orgId, 'shopify', gone)).toEqual({
      products: 0,
      orders: 0,
      customers: 0,
      incomplete: 0,
    });
  });
});

describe('a WooCommerce import (TW-ECOM-011, 028)', () => {
  it('maps the products, makes a local number international from the billing country, and groups the customers', async () => {
    const t = await api.signup('eiy');
    const id = await wooStore(t);
    wooData = {
      products: read([
        {
          id: 5,
          name: 'Mug',
          slug: 'mug',
          sku: '',
          price: '8',
          regular_price: '10',
          status: 'publish',
          stock_status: 'outofstock',
        },
      ]),
      orders: read([
        {
          id: 900,
          number: '900',
          status: 'processing',
          total: '49.50',
          currency: 'USD',
          billing: {
            first_name: 'Ngozi',
            last_name: 'O',
            phone: '08012345678',
            country: 'NG',
            email: 'n@x.test',
          },
          line_items: [{ name: 'Mug', quantity: 1, price: 8, sku: 'MUG-1' }],
        },
      ]),
      customers: read([
        {
          id: 3,
          first_name: 'Ngozi',
          last_name: 'O',
          billing: { phone: '08012345678', country: 'NG' },
        },
      ]),
    };
    const stats = await imports.run(t.orgId, 'woocommerce', id);
    expect(stats).toEqual({ products: 1, orders: 1, customers: 1, incomplete: 0 });

    const [p] = await q(`SELECT * FROM wa_products WHERE org_id = $1`, t);
    expect(p).toMatchObject({
      woo_product_id: '5',
      sku: 'WOO-5',
      price_minor: 800,
      compare_price_minor: 1000,
      in_stock: false,
      status: 'active',
      currency_code: 'USD',
    });
    const [o] = await q(`SELECT * FROM wa_orders WHERE org_id = $1`, t);
    expect(o).toMatchObject({
      woo_order_id: '900',
      source: 'woocommerce',
      customer_phone: '2348012345678',
      total_minor: 4950,
      status: 'paid',
    });
    expect(o.meta_json).toMatchObject({ name: '#900', woo_status: 'processing' });
    const [c] = await q(`SELECT phone, data FROM contacts WHERE org_id = $1`, t);
    expect(c.phone).toBe('+2348012345678');
    expect(c.data).toMatchObject({ woo_customer_id: '3' });
    expect(await q(`SELECT name, color FROM contact_groups WHERE org_id = $1`, t)).toEqual([
      { name: 'WooCommerce Customers', color: '#7F54B3' },
    ]);
  });
});

describe('sync now (TW-ECOM-013)', () => {
  it('re-reads the store, refreshes its facts, queues the import and answers with its totals', async () => {
    const t = await api.signup('eiz');
    const id = await shopifyStore(t);
    const store = (await h.owner.query(`SELECT uuid FROM shopify_integrations WHERE id = $1`, [id]))
      .rows[0].uuid as string;
    const res = await api.http().post(`/v2/shopify/stores/${store}/sync`).set(bearer(t.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      counts: { products: 3, orders: 2, customers: 1 },
      importQueued: true,
    });
    const [row] = await q(
      `SELECT store_name, shop_plan, shop_currency, status, last_verified_at FROM shopify_integrations WHERE org_id = $1`,
      t,
    );
    // A fact the store did not give keeps what was saved.
    expect(row).toMatchObject({
      store_name: 'Fresh Name',
      shop_plan: 'pro',
      shop_currency: 'INR',
      status: 'active',
    });
    expect(row.last_verified_at).not.toBeNull();
  });

  it('flags a store that does not answer as error and says why, as a result and not an error', async () => {
    const t = await api.signup('eja');
    const id = await shopifyStore(t);
    const store = (await h.owner.query(`SELECT uuid FROM shopify_integrations WHERE id = $1`, [id]))
      .rows[0].uuid as string;
    shopInfo = { ok: false, error: 'HTTP 401' };
    const res = await api.http().post(`/v2/shopify/stores/${store}/sync`).set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, message: 'HTTP 401' });
    expect(
      (await q(`SELECT status FROM shopify_integrations WHERE org_id = $1`, t))[0].status,
    ).toBe('error');
  });

  it('a store with no credentials left asks to be connected again, and a foreign store is 404', async () => {
    const t = await api.signup('ejb');
    const other = await api.signup('ejc');
    const id = await shopifyStore(t, '');
    const store = (await h.owner.query(`SELECT uuid FROM shopify_integrations WHERE id = $1`, [id]))
      .rows[0].uuid as string;
    const res = await api.http().post(`/v2/shopify/stores/${store}/sync`).set(bearer(t.admin));
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain('Connect it again');
    expect(
      (await api.http().post(`/v2/shopify/stores/${store}/sync`).set(bearer(other.admin))).status,
    ).toBe(404);
  });

  it('works the same for WooCommerce, and needs ecom.connect', async () => {
    const t = await api.signup('ejd');
    const id = await wooStore(t);
    const store = (
      await h.owner.query(`SELECT uuid FROM woocommerce_integrations WHERE id = $1`, [id])
    ).rows[0].uuid as string;
    const ok = await api.http().post(`/v2/woocommerce/stores/${store}/sync`).set(bearer(t.admin));
    expect(ok.body).toEqual({
      ok: true,
      counts: { products: 3, orders: 2, customers: 1 },
      importQueued: true,
    });
    expect(
      (
        await q(
          `SELECT store_name, store_version FROM woocommerce_integrations WHERE org_id = $1`,
          t,
        )
      )[0],
    ).toEqual({
      store_name: 'Woo Fresh',
      store_version: '9.2',
    });

    const viewer = await api.member(t, 'viewer', [['ecom.read']]);
    expect(
      (await api.http().post(`/v2/woocommerce/stores/${store}/sync`).set(bearer(viewer.token)))
        .status,
    ).toBe(403);

    wooProbe = { ok: false, error: 'HTTP 500: down' };
    const bad = await api.http().post(`/v2/woocommerce/stores/${store}/sync`).set(bearer(t.admin));
    expect(bad.body).toEqual({ ok: false, message: 'HTTP 500: down' });
    expect(
      (await q(`SELECT status FROM woocommerce_integrations WHERE org_id = $1`, t))[0].status,
    ).toBe('error');
  });
});
