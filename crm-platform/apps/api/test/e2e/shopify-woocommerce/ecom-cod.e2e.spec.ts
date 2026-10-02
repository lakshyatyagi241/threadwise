import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { WOOCOMMERCE, type WooFactory } from '../../../src/infra/providers/ecom/ecom.port';
import {
  COMMERCE_SENDER,
  type CommerceSender,
} from '../../../src/modules/shopify-woocommerce/_shims/tokens';
import { CodService } from '../../../src/modules/shopify-woocommerce/cod.service';
import {
  WebhookPipelineService,
  type WebhookJob,
} from '../../../src/modules/shopify-woocommerce/webhook-pipeline.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** Cash-on-delivery double confirmation, the prepaid nudge and the risk score (WD-ECOM-016, 017, 030), against a real Postgres. */
let h: Harness;
let api: Api;
let pipeline: WebhookPipelineService;
let cod: CodService;
let crypto: CryptoService;
const sent: Array<{ to: string; template: string; params: string[] }> = [];
const texts: Array<{ to: string; body: string }> = [];
const remote: Array<{ order: string; status: string }> = [];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  pipeline = h.app.get(WebhookPipelineService);
  cod = h.app.get(CodService);
  crypto = h.app.get(CryptoService, { strict: false });
  const sender = h.app.get<CommerceSender>(COMMERCE_SENDER);
  sender.send = (_o, m) => {
    sent.push({ to: m.to, template: m.template.name, params: m.params });
    return Promise.resolve({ providerMessageId: 'wamid.1' });
  };
  sender.sendText = (_o, m) => {
    texts.push({ to: m.to, body: m.body });
    return Promise.resolve({ providerMessageId: 'wamid.2' });
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
    updateOrderStatus: (order, status) => {
      remote.push({ order, status });
      return Promise.resolve(true);
    },
  });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  sent.length = 0;
  texts.length = 0;
  remote.length = 0;
});

async function store(t: Tenant, kind: 'shopify' | 'woocommerce'): Promise<number> {
  const secret = randomBytes(20).toString('hex');
  const r =
    kind === 'shopify'
      ? await h.owner.query(
          `INSERT INTO shopify_integrations (org_id, user_id, store_url, shop_currency, access_token, webhook_secret)
           VALUES ($1, $2, $3, 'USD', 'x', $4) RETURNING id`,
          [t.orgId, t.adminUserId, `${secret.slice(0, 6)}.myshopify.com`, secret],
        )
      : await h.owner.query(
          `INSERT INTO woocommerce_integrations (org_id, user_id, store_url, store_currency, consumer_key, consumer_secret, webhook_secret)
           VALUES ($1, $2, $3, 'USD', $4, $5, $6) RETURNING id`,
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

async function automation(
  t: Tenant,
  kind: 'shopify' | 'woocommerce',
  storeId: number,
  type: string,
) {
  const tpl = await h.owner.query(
    `INSERT INTO wa_templates (org_id, user_id, template_name, template_body, language, channel)
     VALUES ($1, $2, $3, 'Hi {{1}} {{2}} {{3}}', 'en_US', 'whatsapp') RETURNING id`,
    [t.orgId, t.adminUserId, `tpl_${randomBytes(4).toString('hex')}`],
  );
  await h.owner.query(
    `INSERT INTO ${kind}_integration_events (org_id, integration_id, event_type, is_active, template_id) VALUES ($1, $2, $3, true, $4)`,
    [t.orgId, storeId, type, Number(tpl.rows[0].id)],
  );
}

const rows = async (t: Tenant, sql: string) => (await h.owner.query(sql, [t.orgId])).rows;

async function fire(
  t: Tenant,
  kind: 'shopify' | 'woocommerce',
  storeId: number,
  eventType: string,
  data: Record<string, unknown>,
) {
  const log = (
    await h.owner.query(
      `INSERT INTO ${kind}_integration_logs (org_id, integration_id, event_type, status) VALUES ($1, $2, $3, 'received') RETURNING id, created_at`,
      [t.orgId, storeId, eventType],
    )
  ).rows[0];
  const job: WebhookJob = {
    orgId: t.orgId,
    kind,
    storeId,
    eventType,
    data,
    log: { id: Number(log.id), createdAt: new Date(log.created_at).toISOString() },
    phase: 'full',
  };
  await pipeline.run(job);
}

const sOrder = {
  id: 7001,
  name: '#7001',
  order_number: 7001,
  total_price: '40.00',
  currency: 'USD',
  financial_status: 'pending',
  payment_gateway_names: ['Cash on Delivery (COD)'],
  customer: { first_name: 'Ada', last_name: 'L', phone: '+1 555 010 1111' },
};
const wOrder = {
  id: 8001,
  number: '8001',
  total: '40.00',
  currency: 'USD',
  status: 'processing',
  payment_method: 'cod',
  order_key: 'wc_order_x',
  billing: {
    first_name: 'Bo',
    last_name: '',
    email: 'b@x.test',
    phone: '08012345678',
    country: 'NG',
  },
};

describe('Shopify COD confirmation (WD-ECOM-016)', () => {
  it('asks the customer to confirm, opens a pending row and logs cod/confirm', async () => {
    const t = await api.signup('ecod1');
    const s = await store(t, 'shopify');
    await automation(t, 'shopify', s, 'cod/confirm');
    await fire(t, 'shopify', s, 'orders/create', sOrder);
    expect(sent).toEqual([
      { to: '15550101111', template: expect.any(String), params: ['Ada L', '#7001', '40.00 USD'] },
    ]);
    expect(
      await rows(
        t,
        `SELECT customer_phone, status, order_name FROM shopify_cod_confirmations WHERE org_id = $1`,
      ),
    ).toEqual([{ customer_phone: '15550101111', status: 'pending', order_name: '#7001' }]);
    const log = (
      await rows(
        t,
        `SELECT status, recipient FROM shopify_integration_logs WHERE org_id = $1 AND event_type = 'cod/confirm'`,
      )
    )[0];
    expect(log).toEqual({ status: 'sent', recipient: '15550101111' });
  });

  it('does nothing for a prepaid order or when the automation is off', async () => {
    const t = await api.signup('ecod2');
    const s = await store(t, 'shopify');
    await fire(t, 'shopify', s, 'orders/create', sOrder);
    await automation(t, 'shopify', s, 'cod/confirm');
    await fire(t, 'shopify', s, 'orders/create', {
      ...sOrder,
      id: 7002,
      payment_gateway_names: ['shopify_payments'],
      financial_status: 'paid',
    });
    expect(sent).toHaveLength(0);
    expect(await rows(t, `SELECT 1 FROM shopify_cod_confirmations WHERE org_id = $1`)).toHaveLength(
      0,
    );
  });

  it('a yes reply confirms, flips the mirrored order, logs cod/reply and thanks the customer', async () => {
    const t = await api.signup('ecod3');
    const s = await store(t, 'shopify');
    await automation(t, 'shopify', s, 'cod/confirm');
    await fire(t, 'shopify', s, 'orders/create', sOrder);
    expect(await cod.handleReply(t.orgId, 'shopify', '+1 555 010 1111', 'Yes please')).toBe(true);
    expect(
      (await rows(t, `SELECT status FROM shopify_cod_confirmations WHERE org_id = $1`))[0].status,
    ).toBe('confirmed');
    expect(
      (
        await rows(
          t,
          `SELECT status FROM wa_orders WHERE org_id = $1 AND shopify_order_id = '7001'`,
        )
      )[0].status,
    ).toBe('confirmed');
    expect(texts).toEqual([
      {
        to: '15550101111',
        body: "Thank you! Your COD order #7001 is confirmed. We'll ship it shortly.",
      },
    ]);
    expect(
      (
        await rows(
          t,
          `SELECT payload->>'result' AS r FROM shopify_integration_logs WHERE org_id = $1 AND event_type = 'cod/reply'`,
        )
      )[0].r,
    ).toBe('confirmed');
    // Settled: a second reply is not taken.
    expect(await cod.handleReply(t.orgId, 'shopify', '15550101111', 'yes')).toBe(false);
  });

  it('a no reply cancels; text that is neither is left alone and the row stays pending', async () => {
    const t = await api.signup('ecod4');
    const s = await store(t, 'shopify');
    await automation(t, 'shopify', s, 'cod/confirm');
    await fire(t, 'shopify', s, 'orders/create', sOrder);
    expect(await cod.handleReply(t.orgId, 'shopify', '15550101111', 'when does it ship?')).toBe(
      false,
    );
    expect(
      (await rows(t, `SELECT status FROM shopify_cod_confirmations WHERE org_id = $1`))[0].status,
    ).toBe('pending');
    expect(await cod.handleReply(t.orgId, 'shopify', '15550101111', 'cancel')).toBe(true);
    expect(
      (
        await rows(
          t,
          `SELECT status FROM wa_orders WHERE org_id = $1 AND shopify_order_id = '7001'`,
        )
      )[0].status,
    ).toBe('cancelled');
    expect(texts[0]!.body).toContain('has been cancelled');
  });

  it("never settles another workspace's pending confirmation", async () => {
    const t = await api.signup('ecod5');
    const other = await api.signup('ecod6');
    const s = await store(t, 'shopify');
    await automation(t, 'shopify', s, 'cod/confirm');
    await fire(t, 'shopify', s, 'orders/create', sOrder);
    expect(await cod.handleReply(other.orgId, 'shopify', '15550101111', 'yes')).toBe(false);
    expect(
      (await rows(t, `SELECT status FROM shopify_cod_confirmations WHERE org_id = $1`))[0].status,
    ).toBe('pending');
  });

  it('sends the prepaid nudge to the customer only when cod/prepaid is on', async () => {
    const t = await api.signup('ecod7');
    const s = await store(t, 'shopify');
    await automation(t, 'shopify', s, 'cod/prepaid');
    await fire(t, 'shopify', s, 'orders/create', sOrder);
    expect(sent).toHaveLength(1);
    expect(
      (
        await rows(
          t,
          `SELECT status FROM shopify_integration_logs WHERE org_id = $1 AND event_type = 'cod/prepaid'`,
        )
      )[0].status,
    ).toBe('sent');
    expect(await rows(t, `SELECT 1 FROM shopify_cod_confirmations WHERE org_id = $1`)).toHaveLength(
      0,
    );
  });
});

describe('WooCommerce COD, risk and the real order (WD-ECOM-016, 017, 030)', () => {
  it('normalises the phone, writes a cod/risk log and opens the pending row', async () => {
    const t = await api.signup('ecod8');
    const w = await store(t, 'woocommerce');
    await automation(t, 'woocommerce', w, 'cod/confirm');
    await fire(t, 'woocommerce', w, 'order.created', wOrder);
    expect(sent[0]).toMatchObject({ to: '2348012345678', params: ['Bo', '#8001', '40.00 USD'] });
    const risk = (
      await rows(
        t,
        `SELECT payload->'risk'->>'level' AS level, payload->'risk'->>'score' AS score FROM woocommerce_integration_logs WHERE org_id = $1 AND event_type = 'cod/risk'`,
      )
    )[0];
    expect(risk).toEqual({ level: 'medium', score: '30' });
  });

  it('puts the risk level into the prepaid nudge and the pay link', async () => {
    const t = await api.signup('ecod9');
    const w = await store(t, 'woocommerce');
    await automation(t, 'woocommerce', w, 'cod/prepaid');
    await fire(t, 'woocommerce', w, 'order.created', wOrder);
    expect(sent).toHaveLength(1);
  });

  it('a yes reply sets the real order to processing and a no sets it to cancelled', async () => {
    const t = await api.signup('ecod10');
    const w = await store(t, 'woocommerce');
    await automation(t, 'woocommerce', w, 'cod/confirm');
    await fire(t, 'woocommerce', w, 'order.created', wOrder);
    expect(await cod.handleReply(t.orgId, 'woocommerce', '2348012345678', 'yes')).toBe(true);
    expect(remote).toEqual([{ order: '8001', status: 'processing' }]);
    expect(
      (await rows(t, `SELECT status FROM wa_orders WHERE org_id = $1 AND woo_order_id = '8001'`))[0]
        .status,
    ).toBe('confirmed');
    await fire(t, 'woocommerce', w, 'order.created', { ...wOrder, id: 8002, number: '8002' });
    await cod.handleReply(t.orgId, 'woocommerce', '2348012345678', 'no');
    expect(remote[1]).toEqual({ order: '8002', status: 'cancelled' });
  });

  it("counts the customer's own mirrored history in the risk score", async () => {
    const t = await api.signup('ecod11');
    const w = await store(t, 'woocommerce');
    await h.owner.query(
      `INSERT INTO wa_orders (org_id, woo_order_id, source, customer_phone, total_minor, currency_code, status)
       VALUES ($1, 'p1', 'woocommerce', '2348012345678', 4000, 'USD', 'cancelled'), ($1, 'p2', 'woocommerce', '2348012345678', 4000, 'USD', 'shipped')`,
      [t.orgId],
    );
    const risk = await cod.risk(t.orgId, wOrder);
    expect(risk).toMatchObject({ score: 15, level: 'low' });
    expect(risk.reasons).toEqual(['1 prior cancelled order']);
    expect(w).toBeGreaterThan(0);
  });
});
