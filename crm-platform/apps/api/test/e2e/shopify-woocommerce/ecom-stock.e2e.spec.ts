import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  COMMERCE_SENDER,
  type CommerceSender,
} from '../../../src/modules/shopify-woocommerce/_shims/tokens';
import { StockService } from '../../../src/modules/shopify-woocommerce/stock.service';
import {
  WebhookPipelineService,
  type WebhookJob,
} from '../../../src/modules/shopify-woocommerce/webhook-pipeline.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** The back-in-stock waitlist: opt-in by message, one alert on an out-to-in update (WD-ECOM-020), against a real Postgres. */
let h: Harness;
let api: Api;
let stock: StockService;
let pipeline: WebhookPipelineService;
const sent: Array<{ to: string; params: string[] }> = [];
const texts: Array<{ to: string; body: string }> = [];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  stock = h.app.get(StockService);
  pipeline = h.app.get(WebhookPipelineService);
  const sender = h.app.get<CommerceSender>(COMMERCE_SENDER);
  sender.send = (_o, m) => {
    sent.push({ to: m.to, params: m.params });
    return Promise.resolve({ providerMessageId: 'w1' });
  };
  sender.sendText = (_o, m) => {
    texts.push({ to: m.to, body: m.body });
    return Promise.resolve({ providerMessageId: 'w2' });
  };
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  sent.length = 0;
  texts.length = 0;
});

async function shopify(t: Tenant, withAutomation = true): Promise<number> {
  const secret = randomBytes(20).toString('hex');
  const r = await h.owner.query(
    `INSERT INTO shopify_integrations (org_id, user_id, store_url, store_name, shop_currency, access_token, webhook_secret)
     VALUES ($1, $2, 'shop.myshopify.com', 'Shop', 'USD', 'x', $3) RETURNING id`,
    [t.orgId, t.adminUserId, secret],
  );
  const id = Number(r.rows[0].id);
  if (withAutomation) {
    const tpl = await h.owner.query(
      `INSERT INTO wa_templates (org_id, user_id, template_name, template_body, language, channel)
       VALUES ($1, $2, $3, '{{1}}: {{2}} is back {{3}}', 'en_US', 'whatsapp') RETURNING id`,
      [t.orgId, t.adminUserId, `tpl_${randomBytes(4).toString('hex')}`],
    );
    await h.owner.query(
      `INSERT INTO shopify_integration_events (org_id, integration_id, event_type, is_active, template_id) VALUES ($1, $2, 'stock/back', true, $3)`,
      [t.orgId, id, Number(tpl.rows[0].id)],
    );
  }
  return id;
}

const product = (t: Tenant, pid: string, name: string, sku: string, inStock: boolean) =>
  h.owner.query(
    `INSERT INTO wa_products (org_id, shopify_product_id, sku, name, slug, price_minor, currency_code, in_stock, availability, status)
     VALUES ($1, $2, $3, $4, $5, 1000, 'USD', $6, $7, 'active')`,
    [
      t.orgId,
      pid,
      sku,
      name,
      `${name.toLowerCase().replace(/\W+/g, '-')}-${pid}`,
      inStock,
      inStock ? 'in stock' : 'out of stock',
    ],
  );

const waiting = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT customer_phone, status FROM shopify_stock_waitlist WHERE org_id = $1 ORDER BY id`,
      [t.orgId],
    )
  ).rows;

const restock = (t: Tenant, storeId: number, data: Record<string, unknown>) =>
  h.owner
    .query(
      `INSERT INTO shopify_integration_logs (org_id, integration_id, event_type, status) VALUES ($1, $2, 'products/update', 'received') RETURNING id, created_at`,
      [t.orgId, storeId],
    )
    .then(({ rows: [log] }) => {
      const job: WebhookJob = {
        orgId: t.orgId,
        kind: 'shopify',
        storeId,
        eventType: 'products/update',
        data,
        log: { id: Number(log.id), createdAt: new Date(log.created_at).toISOString() },
      };
      return pipeline.run(job);
    });

describe('the opt-in (WD-ECOM-020)', () => {
  it('puts the customer on the list for the named sold-out product and confirms in the session', async () => {
    const t = await api.signup('estk1');
    await shopify(t);
    await product(t, '501', 'Red Shirt', 'SH-R', false);
    expect(
      await stock.optIn(
        t.orgId,
        'shopify',
        '+1 555 010 2222',
        'Please notify me about the Red Shirt',
      ),
    ).toBe(true);
    expect(await waiting(t)).toEqual([{ customer_phone: '15550102222', status: 'waiting' }]);
    expect(texts[0]!.body).toBe(
      'Done! We\'ll message you the moment "Red Shirt" is back in stock.',
    );
  });

  it('adds a customer once per product while they are waiting', async () => {
    const t = await api.signup('estk2');
    await shopify(t);
    await product(t, '502', 'Blue Hoodie', 'HOOD-B', false);
    await stock.optIn(t.orgId, 'shopify', '15550102222', 'notify me hood-b');
    await stock.optIn(t.orgId, 'shopify', '15550102222', 'notify me hood-b');
    expect(await waiting(t)).toHaveLength(1);
  });

  it('ignores a product that is in stock, an unknown product, other words, and a workspace with no store', async () => {
    const t = await api.signup('estk3');
    await shopify(t);
    await product(t, '503', 'Green Cap', 'CAP-G', true);
    expect(
      await stock.optIn(t.orgId, 'shopify', '15550102222', 'notify me about the green cap'),
    ).toBe(false);
    expect(
      await stock.optIn(t.orgId, 'shopify', '15550102222', 'notify me about a purple sock'),
    ).toBe(false);
    expect(await stock.optIn(t.orgId, 'shopify', '15550102222', 'hello there')).toBe(false);
    const bare = await api.signup('estk4');
    await product(bare, '504', 'Red Shirt', 'SH-R', false);
    expect(await stock.optIn(bare.orgId, 'shopify', '15550102222', 'notify me red shirt')).toBe(
      false,
    );
  });
});

describe('the restock alert (WD-ECOM-020)', () => {
  it('messages everyone waiting once, marks them notified, and logs stock/back', async () => {
    const t = await api.signup('estk5');
    const s = await shopify(t);
    await product(t, '601', 'Red Shirt', 'SH-R', false);
    await stock.optIn(t.orgId, 'shopify', '15550102222', 'notify me red shirt');
    await stock.optIn(t.orgId, 'shopify', '15550103333', 'notify me red shirt');
    const update = {
      id: 601,
      title: 'Red Shirt',
      handle: 'red-shirt',
      variants: [{ inventory_quantity: 5 }],
    };
    await restock(t, s, update);
    expect(sent.map((m) => m.to)).toEqual(['15550102222', '15550103333']);
    expect(sent[0]!.params).toEqual([
      'there',
      'Red Shirt',
      'https://shop.myshopify.com/products/red-shirt',
    ]);
    expect((await waiting(t)).map((w) => w.status)).toEqual(['notified', 'notified']);
    const log = (
      await h.owner.query(
        `SELECT status, recipient, payload FROM shopify_integration_logs WHERE org_id = $1 AND event_type = 'stock/back'`,
        [t.orgId],
      )
    ).rows[0];
    expect(log).toMatchObject({
      status: 'sent',
      recipient: '2 waiting',
      payload: { product: 'Red Shirt', notified: 2 },
    });
    // The mirror now says in stock, so a second update is not a transition.
    sent.length = 0;
    await restock(t, s, update);
    expect(sent).toHaveLength(0);
  });

  it('does not fire for a product that was already in stock, or that stays out of stock', async () => {
    const t = await api.signup('estk6');
    const s = await shopify(t);
    await product(t, '602', 'Red Shirt', 'SH-R', false);
    await stock.optIn(t.orgId, 'shopify', '15550102222', 'notify me red shirt');
    await restock(t, s, { id: 602, title: 'Red Shirt', variants: [{ inventory_quantity: 0 }] });
    expect(sent).toHaveLength(0);
    expect((await waiting(t))[0]!.status).toBe('waiting');
  });

  it('does nothing without an active stock/back automation', async () => {
    const t = await api.signup('estk7');
    const s = await shopify(t, false);
    await product(t, '603', 'Red Shirt', 'SH-R', false);
    await stock.optIn(t.orgId, 'shopify', '15550102222', 'notify me red shirt');
    await restock(t, s, { id: 603, title: 'Red Shirt', variants: [{ inventory_quantity: 9 }] });
    expect(sent).toHaveLength(0);
    expect((await waiting(t))[0]!.status).toBe('waiting');
  });
});
