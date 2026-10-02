import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { WOOCOMMERCE, type WooFactory } from '../../../src/infra/providers/ecom/ecom.port';
import {
  COMMERCE_SENDER,
  type CommerceSender,
} from '../../../src/modules/shopify-woocommerce/_shims/tokens';
import { EcomInboundService } from '../../../src/modules/shopify-woocommerce/ecom-inbound.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** The WooCommerce concierge and the inbound entry point (WD-ECOM-031, 034), against a real Postgres and fakes. */
let h: Harness;
let api: Api;
let inbound: EcomInboundService;
let crypto: CryptoService;
const texts: Array<{ to: string; body: string }> = [];
const sent: Array<{ to: string; params: string[] }> = [];
const patches: Array<{ order: string; patch: Record<string, unknown> }> = [];
let orderOk = true;
let link: { url: string; orderId: string } | null = {
  url: 'https://shop.test/pay/1',
  orderId: '55',
};
const created: Array<Array<{ reference: string; qty: number }>> = [];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  inbound = h.app.get(EcomInboundService);
  crypto = h.app.get(CryptoService, { strict: false });
  const sender = h.app.get<CommerceSender>(COMMERCE_SENDER);
  sender.sendText = (_o, m) => {
    texts.push({ to: m.to, body: m.body });
    return Promise.resolve({ providerMessageId: 't' });
  };
  sender.send = (_o, m) => {
    sent.push({ to: m.to, params: m.params });
    return Promise.resolve({ providerMessageId: 's' });
  };
  const woo = h.app.get<WooFactory>(WOOCOMMERCE);
  woo.store = () => ({
    test: () => Promise.reject(new Error('unused')),
    counts: () => Promise.reject(new Error('unused')),
    products: () => Promise.reject(new Error('unused')),
    orders: () => Promise.reject(new Error('unused')),
    customers: () => Promise.reject(new Error('unused')),
    registerWebhooks: () => Promise.resolve({}),
    deleteWebhooks: () => Promise.resolve(),
    updateOrder: (order, patch) => {
      patches.push({ order, patch });
      return Promise.resolve(orderOk);
    },
    recent: () => Promise.resolve([]),
    salesReport: () => Promise.resolve({}),
    createPendingOrder: (items) => {
      created.push([...items]);
      return Promise.resolve(link);
    },
  });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  texts.length = 0;
  sent.length = 0;
  patches.length = 0;
  created.length = 0;
  orderOk = true;
  link = { url: 'https://shop.test/pay/1', orderId: '55' };
});

const PHONE = '2348012345678';

async function setup(t: Tenant): Promise<number> {
  const secret = randomBytes(20).toString('hex');
  const r = await h.owner.query(
    `INSERT INTO woocommerce_integrations (org_id, user_id, store_url, store_name, store_currency, consumer_key, consumer_secret, webhook_secret)
     VALUES ($1, $2, $3, 'Acme', 'USD', $4, $5, $6) RETURNING id`,
    [
      t.orgId,
      t.adminUserId,
      `https://${secret.slice(0, 6)}.test`,
      crypto.encrypt('ck'),
      crypto.encrypt('cs'),
      secret,
    ],
  );
  return Number(r.rows[0].id);
}

const order = (
  t: Tenant,
  id: string,
  status: string,
  over: { daysAgo?: number; minor?: number; items?: unknown[] } = {},
) =>
  h.owner.query(
    `INSERT INTO wa_orders (org_id, woo_order_id, source, customer_phone, total_minor, currency_code, status, items_json, meta_json, created_at)
     VALUES ($1, $2, 'woocommerce', $3, $4, 'USD', $5, $6::jsonb, $7::jsonb, now() - make_interval(days => $8))`,
    [
      t.orgId,
      id,
      PHONE,
      over.minor ?? 1000,
      status,
      JSON.stringify(
        over.items ?? [
          { title: 'Shirt', qty: 2, sku: 'SH-R' },
          { title: 'x', qty: 1, sku: '' },
        ],
      ),
      JSON.stringify({ name: `#${id}` }),
      over.daysAgo ?? 0,
    ],
  );

const logs = async (t: Tenant, type: string) =>
  (
    await h.owner.query(
      `SELECT status, recipient FROM woocommerce_integration_logs WHERE org_id = $1 AND event_type = $2`,
      [t.orgId, type],
    )
  ).rows;

describe('the address change', () => {
  it('asks for the address of the newest editable order, then applies the next message as the address', async () => {
    const t = await api.signup('econ1');
    await setup(t);
    await order(t, '70', 'shipped');
    await order(t, '71', 'paid');
    expect(await inbound.handleInbound(t.orgId, `+${PHONE}`, 'please change my address')).toEqual([
      'woocommerce-concierge',
    ]);
    expect(texts[0]!.body).toContain('order #71');
    expect(await logs(t, 'order/edit-request')).toHaveLength(1);
    await inbound.handleInbound(t.orgId, PHONE, '12 Rose Street, Lagos, Lagos, 100001');
    expect(patches).toEqual([
      { order: '71', patch: { shipping: { address_1: '12 Rose Street, Lagos, Lagos, 100001' } } },
    ]);
    expect(texts[1]!.body).toBe(
      'Done — the shipping address for order #71 has been updated. Thank you!',
    );
    expect(await logs(t, 'order/edit-apply')).toEqual([{ status: 'sent', recipient: PHONE }]);
  });

  it('keeps the window open for a too-short address and says so when the store refuses', async () => {
    const t = await api.signup('econ2');
    await setup(t);
    await order(t, '72', 'new');
    await inbound.handleInbound(t.orgId, PHONE, 'edit address');
    await inbound.handleInbound(t.orgId, PHONE, 'abc');
    expect(texts[1]!.body).toContain('too short');
    expect(patches).toHaveLength(0);
    orderOk = false;
    await inbound.handleInbound(t.orgId, PHONE, '5 Long Road, Abuja, FCT, 900001');
    expect(texts[2]!.body).toContain("we couldn't update order #72");
    expect(await logs(t, 'order/edit-apply')).toEqual([{ status: 'failed', recipient: PHONE }]);
  });

  it('says the address is locked when no order is editable', async () => {
    const t = await api.signup('econ3');
    await setup(t);
    await order(t, '73', 'shipped');
    await inbound.handleInbound(t.orgId, PHONE, 'wrong address');
    expect(texts[0]!.body).toContain('still editable');
  });
});

describe('reorder and points', () => {
  it('mints a pending order for the last basket by sku and sends the link', async () => {
    const t = await api.signup('econ4');
    await setup(t);
    await order(t, '80', 'shipped');
    expect(await inbound.handleInbound(t.orgId, PHONE, 'Reorder please')).toEqual([
      'woocommerce-concierge',
    ]);
    expect(created).toEqual([[{ reference: 'SH-R', qty: 2 }]]);
    expect(texts[0]!.body).toBe(
      "Here's your re-order — same items as last time. Tap to checkout:\nhttps://shop.test/pay/1",
    );
    expect(await logs(t, 'reorder')).toHaveLength(1);
  });

  it('answers nothing when the store gives no link, there is no order, or no item has a sku', async () => {
    const t = await api.signup('econ5');
    await setup(t);
    expect(await inbound.handleInbound(t.orgId, PHONE, 'reorder')).toEqual([]);
    await order(t, '81', 'shipped', { items: [{ title: 'x', qty: 1, sku: '' }] });
    expect(await inbound.handleInbound(t.orgId, PHONE, 'reorder')).toEqual([]);
    await order(t, '82', 'shipped');
    link = null;
    expect(await inbound.handleInbound(t.orgId, PHONE, 'reorder')).toEqual([]);
    expect(texts).toHaveLength(0);
  });

  it('summarises orders, spend and the points balance from the contact', async () => {
    const t = await api.signup('econ6');
    await setup(t);
    await order(t, '90', 'paid', { minor: 150000 });
    await order(t, '91', 'paid', { minor: 5000 });
    await h.owner.query(
      `INSERT INTO contacts (org_id, name, phone, data) VALUES ($1, 'Bo', $2, '{"points_balance": 120}'::jsonb)`,
      [t.orgId, `+${PHONE}`],
    );
    await inbound.handleInbound(t.orgId, PHONE, 'my points?');
    expect(texts[0]!.body).toBe(
      "Here's your account summary:\n• Orders: 2\n• Total spent: USD 1,550.00\n• Points balance: 120",
    );
  });

  it("is silent for an unknown customer, a workspace with no store, and another workspace's data", async () => {
    const t = await api.signup('econ7');
    const other = await api.signup('econ8');
    await setup(t);
    await order(other, '95', 'paid');
    expect(await inbound.handleInbound(t.orgId, PHONE, 'my points')).toEqual([]);
    expect(await inbound.handleInbound(other.orgId, PHONE, 'my points')).toEqual([]);
    expect(texts).toHaveLength(0);
  });
});

describe('the review reward', () => {
  async function reward(t: Tenant, storeId: number) {
    const tpl = await h.owner.query(
      `INSERT INTO wa_templates (org_id, user_id, template_name, template_body, language, channel)
       VALUES ($1, $2, $3, 'Thanks {{1}}! From {{2}}', 'en_US', 'whatsapp') RETURNING id`,
      [t.orgId, t.adminUserId, `tpl_${randomBytes(4).toString('hex')}`],
    );
    await h.owner.query(
      `INSERT INTO woocommerce_integration_events (org_id, integration_id, event_type, is_active, template_id) VALUES ($1, $2, 'review/reward', true, $3)`,
      [t.orgId, storeId, Number(tpl.rows[0].id)],
    );
  }

  it('sends the reward template to a recent buyer once per 30 days', async () => {
    const t = await api.signup('econ9');
    const s = await setup(t);
    await reward(t, s);
    await order(t, '100', 'shipped', { daysAgo: 3 });
    expect(await inbound.handleInbound(t.orgId, PHONE, '5 stars, great')).toEqual([
      'woocommerce-concierge',
    ]);
    expect(sent).toEqual([{ to: PHONE, params: ['there', 'Acme'] }]);
    expect(await logs(t, 'review/reward')).toEqual([{ status: 'sent', recipient: PHONE }]);
    expect(await inbound.handleInbound(t.orgId, PHONE, 'love it')).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it('needs a delivered order in the last 30 days and an active automation', async () => {
    const t = await api.signup('econ10');
    const s = await setup(t);
    await order(t, '101', 'shipped', { daysAgo: 60 });
    await reward(t, s);
    expect(await inbound.handleInbound(t.orgId, PHONE, 'great')).toEqual([]);
    const bare = await api.signup('econ11');
    await setup(bare);
    await order(bare, '102', 'shipped', { daysAgo: 1 });
    expect(await inbound.handleInbound(bare.orgId, PHONE, 'great')).toEqual([]);
    expect(sent).toHaveLength(0);
  });
});
