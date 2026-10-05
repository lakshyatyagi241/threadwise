import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { WOOCOMMERCE, type WooFactory } from '../../../src/infra/providers/ecom/ecom.port';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** The store dashboard (TW-ECOM-023): Shopify from the mirror, WooCommerce live plus the mirror, against a real Postgres. */
let h: Harness;
let api: Api;
let crypto: CryptoService;
let live: {
  orders: Array<Record<string, unknown>>;
  products: Array<Record<string, unknown>>;
  customers: Array<Record<string, unknown>>;
  report: Record<string, unknown>;
};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  crypto = h.app.get(CryptoService, { strict: false });
  const woo = h.app.get<WooFactory>(WOOCOMMERCE);
  woo.store = () => ({
    test: () => Promise.reject(new Error('unused')),
    counts: () => Promise.resolve({ products: 12, orders: 30, customers: 4 }),
    products: () => Promise.reject(new Error('unused')),
    orders: () => Promise.reject(new Error('unused')),
    customers: () => Promise.reject(new Error('unused')),
    registerWebhooks: () => Promise.resolve({}),
    deleteWebhooks: () => Promise.resolve(),
    recent: (r) => Promise.resolve(live[r]),
    salesReport: () => Promise.resolve(live.report),
    updateOrder: () => Promise.resolve(true),
    createPendingOrder: () => Promise.resolve(null),
  });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  live = { orders: [], products: [], customers: [], report: {} };
});

async function shopify(t: Tenant): Promise<string> {
  const secret = randomBytes(20).toString('hex');
  const r = await h.owner.query(
    `INSERT INTO shopify_integrations (org_id, user_id, store_url, store_name, shop_currency, access_token, webhook_secret)
     VALUES ($1, $2, $3, 'Acme', 'USD', 'x', $4) RETURNING uuid`,
    [t.orgId, t.adminUserId, `${secret.slice(0, 6)}.myshopify.com`, secret],
  );
  return r.rows[0].uuid as string;
}

async function wooStore(t: Tenant): Promise<string> {
  const secret = randomBytes(20).toString('hex');
  const r = await h.owner.query(
    `INSERT INTO woocommerce_integrations (org_id, user_id, store_url, store_name, store_currency, consumer_key, consumer_secret, webhook_secret)
     VALUES ($1, $2, $3, 'Woo', 'USD', $4, $5, $6) RETURNING uuid`,
    [
      t.orgId,
      t.adminUserId,
      `https://${secret.slice(0, 6)}.test`,
      crypto.encrypt('ck'),
      crypto.encrypt('cs'),
      secret,
    ],
  );
  return r.rows[0].uuid as string;
}

const get = (t: Tenant, kind: string, id: string) =>
  api.http().get(`/v2/${kind}/stores/${id}/dashboard`).set(bearer(t.admin));

describe('the Shopify dashboard', () => {
  it('serves counts, lists, highlights and analytics from the mirror', async () => {
    const t = await api.signup('edb1');
    const id = await shopify(t);
    for (const [i, [name, price, cmp]] of [
      ['Shirt', 5000, 10000],
      ['Hat', 3000, null],
      ['Coat', 9000, null],
    ].entries()) {
      await h.owner.query(
        `INSERT INTO wa_products (org_id, shopify_product_id, name, slug, price_minor, compare_price_minor, currency_code, brand)
         VALUES ($1, $2, $3, $4, $5, $6, 'USD', 'Acme')`,
        [t.orgId, String(i + 1), name, `${name}-${i}`.toLowerCase(), price, cmp],
      );
    }
    await h.owner.query(
      `INSERT INTO wa_orders (org_id, shopify_order_id, source, customer_name, total_minor, currency_code, status, meta_json)
       VALUES ($1, '1', 'shopify', 'Ada', 10000, 'USD', 'paid', '{"name":"#1001","financial_status":"paid"}'::jsonb),
              ($1, 'w', 'woocommerce', 'Other', 99900, 'USD', 'paid', '{}'::jsonb)`,
      [t.orgId],
    );
    await h.owner.query(
      `INSERT INTO shopify_integration_logs (org_id, integration_id, event_type, status) SELECT $1, id, 'orders/create', 'sent' FROM shopify_integrations WHERE uuid = $2::uuid`,
      [t.orgId, id],
    );
    const res = await get(t, 'shopify', id);
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d.counts).toEqual({ products: 3, orders: 1, customers: 0 });
    expect(d.products.map((p: { title: string }) => p.title)).toEqual(['Coat', 'Hat', 'Shirt']);
    expect(
      d.offers.map((p: { title: string; discountPct: number }) => [p.title, p.discountPct]),
    ).toEqual([['Shirt', 50]]);
    expect(d.popular[0].title).toBe('Coat');
    expect(d.orders).toHaveLength(1);
    expect(d.orders[0]).toMatchObject({
      name: '#1001',
      customer: 'Ada',
      status: 'paid',
      total: 100,
    });
    expect(d.analytics).toMatchObject({
      revenueTotal: 100,
      ordersTotal: 1,
      aov: 100,
      messagesSent: 1,
    });
    expect(d.analytics.trend).toHaveLength(14);
    expect(d.revenue30d).toBe(100);
    expect(d.woo).toBeNull();
    expect(d.logTotal).toBe(1);
    expect(d.logsByEvent).toEqual({ 'orders/create': 1 });
  });

  it("is 404 for another workspace's store", async () => {
    const t = await api.signup('edb2');
    const other = await api.signup('edb3');
    expect((await get(t, 'shopify', await shopify(other))).status).toBe(404);
  });
});

describe('the WooCommerce dashboard', () => {
  it('reads recent records and the sales report live, and the CRM figures from the mirror', async () => {
    const t = await api.signup('edb4');
    const id = await wooStore(t);
    live = {
      orders: [
        {
          number: '7',
          status: 'processing',
          total: '25',
          currency: 'USD',
          billing: { first_name: 'Bo', email: 'b@x.test' },
        },
      ],
      products: [{ id: 3, name: 'Hat', price: '10', regular_price: '10', stock_status: 'instock' }],
      customers: [
        { first_name: 'Cy', last_name: 'D', email: 'c@x.test', orders_count: 2, total_spent: '50' },
      ],
      report: { total_sales: '1234.50', total_orders: 20, total_customers: 4, total_items: 55 },
    };
    await h.owner.query(
      `INSERT INTO wa_orders (org_id, woo_order_id, source, total_minor, currency_code, status) VALUES ($1, 'o1', 'woocommerce', 2000, 'USD', 'paid')`,
      [t.orgId],
    );
    const d = (await get(t, 'woocommerce', id)).body;
    expect(d.counts).toEqual({ products: 12, orders: 30, customers: 4 });
    expect(d.orders).toHaveLength(1);
    expect(d.orders[0]).toMatchObject({ name: '#7', customer: 'Bo', total: 25 });
    expect(d.products[0]).toMatchObject({ title: 'Hat', price: 10 });
    expect(d.customers[0]).toMatchObject({ name: 'Cy D', ordersCount: 2, totalSpent: 50 });
    expect(d.revenue30d).toBe(1234.5);
    expect(d.woo).toMatchObject({
      orders30d: 20,
      customers30d: 4,
      itemsSold30d: 55,
      senderKey: null,
    });
    expect(d.analytics).toMatchObject({ revenueTotal: 20, ordersTotal: 1 });
    expect(d.offers).toEqual([]);
  });

  it('a store that does not answer leaves the live lists empty and still answers', async () => {
    const t = await api.signup('edb5');
    const id = await wooStore(t);
    const res = await get(t, 'woocommerce', id);
    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([]);
    expect(res.body.revenue30d).toBe(0);
  });

  it('lists connected numbers to send from, templates with their variable counts, groups and coupons', async () => {
    const t = await api.signup('edb6');
    const id = await wooStore(t);
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, is_primary) VALUES ($1, 'waba', 'connected', '+15550001111', true)`,
      [t.orgId],
    );
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, user_id, template_name, template_body, language, channel) VALUES ($1, $2, 'welcome', 'Hi {{1}} {{2}}', 'en_US', 'whatsapp')`,
      [t.orgId, t.adminUserId],
    );
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, user_id, template_name, template_body, language, channel, meta_template_id, meta_status) VALUES ($1, $2, 'pending_one', 'x', 'en_US', 'whatsapp', 'm1', 'PENDING')`,
      [t.orgId, t.adminUserId],
    );
    await h.owner.query(`INSERT INTO contact_groups (org_id, name) VALUES ($1, 'Buyers')`, [
      t.orgId,
    ]);
    await h.owner.query(
      `INSERT INTO wa_coupons (org_id, code, type, amount, active) VALUES ($1, 'SAVE10', 'percent', 10, true), ($1, 'OLD', 'percent', 5, false)`,
      [t.orgId],
    );
    const d = (await get(t, 'woocommerce', id)).body;
    expect(d.woo.senders).toEqual([
      { key: expect.stringMatching(/^waba:/), label: '+15550001111', engine: 'waba' },
    ]);
    expect(d.templates).toEqual([
      expect.objectContaining({ name: 'welcome', paramCount: 2, engine: 'baileys' }),
    ]);
    expect(d.contactGroups.map((g: { name: string }) => g.name)).toEqual(['Buyers']);
    expect(d.coupons).toEqual([{ code: 'SAVE10', type: 'percent', amount: 10 }]);
  });
});
