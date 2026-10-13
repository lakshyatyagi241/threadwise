import { createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlatformSettingsService } from '../../../src/modules/auth';
import {
  CommerceSender,
  COMMERCE_SENDER,
} from '../../../src/modules/shopify-woocommerce/_shims/tokens';
import { bodyParams } from '../../../src/modules/shopify-woocommerce/event-rules';
import {
  WebhookPipelineService,
  type WebhookJob,
} from '../../../src/modules/shopify-woocommerce/webhook-pipeline.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** The stores' webhooks, the event message and the mirror upkeep (TW-ECOM-008, 010, 027), against a real Postgres and a fake sender. */
let h: Harness;
let api: Api;
let pipeline: WebhookPipelineService;
const CLIENT_SECRET = 'shopify-client-secret';
const sentMessages: Array<{ to: string; params: string[]; template: string }> = [];
let failSend: string | null = null;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  pipeline = h.app.get(WebhookPipelineService);
  const settings = h.app.get(PlatformSettingsService);
  await settings.mergeDocument('ecom.shopify', { enabled: true, clientId: 'c' }, null);
  await settings.setSecret('ecom.shopify.client_secret', CLIENT_SECRET, null);
  const sender = h.app.get<CommerceSender>(COMMERCE_SENDER);
  sender.send = (_org, m) => {
    if (failSend) return Promise.reject(new Error(failSend));
    sentMessages.push({
      to: m.to,
      params: bodyParams(m.template.body, m.ctx.positional),
      template: m.template.name,
    });
    return Promise.resolve({ providerMessageId: 'wamid.1' });
  };
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  sentMessages.length = 0;
  failSend = null;
});

const sign = (raw: string, secret: string): string =>
  createHmac('sha256', secret).update(raw).digest('base64');

async function store(t: Tenant, kind: 'shopify' | 'woocommerce') {
  const secret = randomBytes(20).toString('hex');
  const r =
    kind === 'shopify'
      ? await h.owner.query(
          `INSERT INTO shopify_integrations (org_id, user_id, store_url, store_name, shop_currency, access_token, webhook_secret)
           VALUES ($1, $2, $3, 'S', 'USD', 'x', $4) RETURNING id`,
          [t.orgId, t.adminUserId, `${secret.slice(0, 6)}.myshopify.com`, secret],
        )
      : await h.owner.query(
          `INSERT INTO woocommerce_integrations (org_id, user_id, store_url, store_name, store_currency, consumer_key, consumer_secret, webhook_secret)
           VALUES ($1, $2, $3, 'W', 'USD', 'k', 's', $4) RETURNING id`,
          [t.orgId, t.adminUserId, `https://${secret.slice(0, 6)}.test`, secret],
        );
  return { id: Number(r.rows[0].id), secret };
}

async function template(t: Tenant, body = 'Hi {{1}}, order {{2}} total {{3}}'): Promise<number> {
  const r = await h.owner.query(
    `INSERT INTO wa_templates (org_id, user_id, template_name, template_body, language, channel)
     VALUES ($1, $2, $3, $4, 'en_US', 'whatsapp') RETURNING id`,
    [t.orgId, t.adminUserId, `tpl_${randomBytes(4).toString('hex')}`, body],
  );
  return Number(r.rows[0].id);
}

async function automation(
  t: Tenant,
  kind: 'shopify' | 'woocommerce',
  storeId: number,
  eventType: string,
  templateId: number | null,
  extra: { sendTo?: string; adminNumber?: string; varMap?: string[]; active?: boolean } = {},
) {
  await h.owner.query(
    `INSERT INTO ${kind}_integration_events (org_id, integration_id, event_type, is_active, template_id, send_to, admin_number, var_map)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      t.orgId,
      storeId,
      eventType,
      extra.active ?? true,
      templateId,
      extra.sendTo ?? 'customer',
      extra.adminNumber ?? null,
      extra.varMap ? JSON.stringify(extra.varMap) : null,
    ],
  );
}

const logs = async (t: Tenant, kind: 'shopify' | 'woocommerce', storeId: number) =>
  (
    await h.owner.query(
      `SELECT event_type, status, recipient, error FROM ${kind}_integration_logs WHERE org_id = $1 AND integration_id = $2 ORDER BY created_at, id`,
      [t.orgId, storeId],
    )
  ).rows;

const order = {
  id: 1001,
  name: '#1001',
  order_number: 1001,
  total_price: '25.00',
  currency: 'USD',
  financial_status: 'paid',
  customer: { first_name: 'Ada', last_name: 'L', phone: '+1 555 010 9999' },
};

const shopifyPost = (
  secret: string,
  topic: string,
  body: unknown,
  hmac?: string,
  id = randomBytes(6).toString('hex'),
) => {
  const raw = JSON.stringify(body);
  return api
    .http()
    .post(`/v2/shopify/webhook/${secret}`)
    .set('content-type', 'application/json')
    .set('x-shopify-topic', topic)
    .set('x-shopify-webhook-id', id)
    .set('x-shopify-hmac-sha256', hmac ?? sign(raw, CLIENT_SECRET))
    .send(raw);
};

const job = (
  t: Tenant,
  kind: 'shopify' | 'woocommerce',
  storeId: number,
  eventType: string,
  data: Record<string, unknown>,
  logId: number,
  createdAt: string,
): WebhookJob => ({
  orgId: t.orgId,
  kind,
  storeId,
  eventType,
  data,
  log: { id: logId, createdAt },
});

describe('the Shopify webhook door (TW-ECOM-008)', () => {
  it('answers 404 for an unknown address and 401 "bad hmac" for a wrong signature', async () => {
    const t = await api.signup('ewh1');
    const s = await store(t, 'shopify');
    expect((await shopifyPost('f'.repeat(40), 'orders/create', order)).status).toBe(404);
    const bad = await shopifyPost(s.secret, 'orders/create', order, sign('{}', 'wrong'));
    expect(bad.status).toBe(401);
    expect(bad.text).toBe('bad hmac');
    expect(await logs(t, 'shopify', s.id)).toHaveLength(0);
  });

  it('logs a signed delivery once and answers 200; a repeat of the same delivery id is dropped', async () => {
    const t = await api.signup('ewh2');
    const s = await store(t, 'shopify');
    expect((await shopifyPost(s.secret, 'orders/create', order, undefined, 'dup-1')).status).toBe(
      200,
    );
    expect((await shopifyPost(s.secret, 'orders/create', order, undefined, 'dup-1')).status).toBe(
      200,
    );
    const rows = await logs(t, 'shopify', s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: 'orders/create', status: 'received' });
  });

  it("never resolves another tenant's store through the secret of a different kind", async () => {
    const t = await api.signup('ewh4');
    const s = await store(t, 'shopify');
    const raw = '{}';
    const r = await api
      .http()
      .post(`/v2/woocommerce/webhook/${s.secret}`)
      .set('x-wc-webhook-signature', sign(raw, s.secret))
      .send(raw);
    expect(r.status).toBe(404);
  });
});

describe('the WooCommerce webhook door (TW-ECOM-027)', () => {
  it('verifies with the store\'s own secret and says "bad signature" otherwise', async () => {
    const t = await api.signup('ewh5');
    const w = await store(t, 'woocommerce');
    const raw = JSON.stringify({ id: 7, status: 'processing' });
    const ok = await api
      .http()
      .post(`/v2/woocommerce/webhook/${w.secret}`)
      .set('content-type', 'application/json')
      .set('x-wc-webhook-topic', 'order.updated')
      .set('x-wc-webhook-delivery-id', 'd1')
      .set('x-wc-webhook-signature', sign(raw, w.secret))
      .send(raw);
    expect(ok.status).toBe(200);
    const bad = await api
      .http()
      .post(`/v2/woocommerce/webhook/${w.secret}`)
      .set('content-type', 'application/json')
      .set('x-wc-webhook-signature', sign(raw, 'nope'))
      .send(raw);
    expect(bad.status).toBe(401);
    expect(bad.text).toBe('bad signature');
  });

  it('acknowledges a store ping (a body that is not JSON) without logging it', async () => {
    const t = await api.signup('ewh6');
    const w = await store(t, 'woocommerce');
    const raw = 'webhook_id=12';
    const r = await api
      .http()
      .post(`/v2/woocommerce/webhook/${w.secret}`)
      .set('content-type', 'application/x-www-form-urlencoded')
      .set('x-wc-webhook-signature', sign(raw, w.secret))
      .send(raw);
    expect(r.status).toBe(200);
    expect(await logs(t, 'woocommerce', w.id)).toHaveLength(0);
  });
});

describe('the event message and mirror upkeep (TW-ECOM-010)', () => {
  it('sends the mapped template to the customer with the default order variables and marks the log sent', async () => {
    const t = await api.signup('ewh7');
    const s = await store(t, 'shopify');
    await automation(t, 'shopify', s.id, 'orders/create', await template(t));
    await shopifyPost(s.secret, 'orders/create', order);
    const [row] = (
      await h.owner.query(`SELECT id, created_at FROM shopify_integration_logs WHERE org_id = $1`, [
        t.orgId,
      ])
    ).rows;
    await pipeline.run(
      job(
        t,
        'shopify',
        s.id,
        'orders/create',
        order,
        Number(row.id),
        new Date(row.created_at).toISOString(),
      ),
    );
    expect(sentMessages).toEqual([
      { to: '15550109999', params: ['Ada L', '#1001', '25.00 USD'], template: expect.any(String) },
    ]);
    expect((await logs(t, 'shopify', s.id))[0]).toMatchObject({
      status: 'sent',
      recipient: '15550109999',
    });
    const orders = await h.owner.query(
      `SELECT count(*)::int AS n FROM wa_orders WHERE org_id = $1`,
      [t.orgId],
    );
    expect(orders.rows[0].n).toBe(1);
  });

  it('sends to the admin number too when "both", and honors a chosen variable list', async () => {
    const t = await api.signup('ewh8');
    const s = await store(t, 'shopify');
    await automation(t, 'shopify', s.id, 'orders/paid', await template(t, 'Order {{1}}'), {
      sendTo: 'both',
      adminNumber: '+91 98765 43210',
      varMap: ['order_name'],
    });
    await shopifyPost(s.secret, 'orders/paid', order);
    const [row] = (
      await h.owner.query(`SELECT id, created_at FROM shopify_integration_logs WHERE org_id = $1`, [
        t.orgId,
      ])
    ).rows;
    await pipeline.run(
      job(
        t,
        'shopify',
        s.id,
        'orders/paid',
        order,
        Number(row.id),
        new Date(row.created_at).toISOString(),
      ),
    );
    expect(sentMessages.map((m) => m.to).sort()).toEqual(['15550109999', '919876543210']);
    expect(sentMessages[0]!.params).toEqual(['#1001']);
  });

  it('records a failed send on the log with its reason and still keeps the mirror current', async () => {
    const t = await api.signup('ewh9');
    const s = await store(t, 'shopify');
    await automation(t, 'shopify', s.id, 'orders/create', await template(t));
    failSend = 'No WhatsApp Cloud API number is connected to send from.';
    await shopifyPost(s.secret, 'orders/create', order);
    const [row] = (
      await h.owner.query(`SELECT id, created_at FROM shopify_integration_logs WHERE org_id = $1`, [
        t.orgId,
      ])
    ).rows;
    await pipeline.run(
      job(
        t,
        'shopify',
        s.id,
        'orders/create',
        order,
        Number(row.id),
        new Date(row.created_at).toISOString(),
      ),
    );
    expect((await logs(t, 'shopify', s.id))[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('No WhatsApp Cloud API number'),
    });
    expect(
      (await h.owner.query(`SELECT count(*)::int AS n FROM wa_orders WHERE org_id = $1`, [t.orgId]))
        .rows[0].n,
    ).toBe(1);
  });

  it('sends nothing when the automation is off, has no template, or the customer has no phone', async () => {
    const t = await api.signup('ewh10');
    const s = await store(t, 'shopify');
    await automation(t, 'shopify', s.id, 'orders/create', await template(t), { active: false });
    await automation(t, 'shopify', s.id, 'orders/paid', null);
    await automation(t, 'shopify', s.id, 'orders/updated', await template(t));
    for (const [topic, data] of [
      ['orders/create', order],
      ['orders/paid', order],
      ['orders/updated', { ...order, customer: { first_name: 'No', last_name: 'Phone' } }],
    ] as const) {
      await shopifyPost(s.secret, topic, data);
    }
    const rows = (
      await h.owner.query(
        `SELECT id, created_at, event_type FROM shopify_integration_logs WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows;
    for (const r of rows) {
      const data =
        r.event_type === 'orders/updated' ? { ...order, customer: { first_name: 'No' } } : order;
      await pipeline.run(
        job(
          t,
          'shopify',
          s.id,
          r.event_type,
          data,
          Number(r.id),
          new Date(r.created_at).toISOString(),
        ),
      );
    }
    expect(sentMessages).toHaveLength(0);
  });

  it('fires a WooCommerce order.<status> automation once per order and status', async () => {
    const t = await api.signup('ewh11');
    const w = await store(t, 'woocommerce');
    await automation(t, 'woocommerce', w.id, 'order.processing', await template(t));
    const data = {
      id: 55,
      number: '55',
      total: '9',
      status: 'processing',
      billing: { first_name: 'Bo', phone: '08012345678', country: 'NG' },
    };
    const raw = JSON.stringify(data);
    const post = (id: string) =>
      api
        .http()
        .post(`/v2/woocommerce/webhook/${w.secret}`)
        .set('content-type', 'application/json')
        .set('x-wc-webhook-topic', 'order.updated')
        .set('x-wc-webhook-delivery-id', id)
        .set('x-wc-webhook-signature', sign(raw, w.secret))
        .send(raw);
    await post('a');
    await post('b');
    for (const r of (
      await h.owner.query(
        `SELECT id, created_at FROM woocommerce_integration_logs WHERE org_id = $1 ORDER BY id`,
        [t.orgId],
      )
    ).rows)
      await pipeline.run(
        job(
          t,
          'woocommerce',
          w.id,
          'order.updated',
          data,
          Number(r.id),
          new Date(r.created_at).toISOString(),
        ),
      );
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]!.to).toBe('2348012345678');
  });
});

describe('delivered, uninstall and the privacy webhooks (TW-ECOM-018, 021, 022)', () => {
  const runLogged = async (
    t: Tenant,
    kind: 'shopify' | 'woocommerce',
    storeId: number,
    topic: string,
    data: Record<string, unknown>,
  ) => {
    const [row] = (
      await h.owner.query(
        `SELECT id, created_at FROM ${kind}_integration_logs WHERE org_id = $1 AND event_type = $2 ORDER BY id DESC LIMIT 1`,
        [t.orgId, topic],
      )
    ).rows;
    await pipeline.run(
      job(t, kind, storeId, topic, data, Number(row.id), new Date(row.created_at).toISOString()),
    );
  };

  it('fires the Delivered automation for the customer on the mirrored order', async () => {
    const t = await api.signup('ewh12');
    const s = await store(t, 'shopify');
    await automation(
      t,
      'shopify',
      s.id,
      'order/delivered',
      await template(t, 'Hi {{1}}, order {{2}} arrived, total {{3}}'),
    );
    await shopifyPost(s.secret, 'orders/create', order);
    await runLogged(t, 'shopify', s.id, 'orders/create', order);
    sentMessages.length = 0;
    const fulfilment = { id: 9, order_id: 1001, shipment_status: 'delivered' };
    await shopifyPost(s.secret, 'fulfillments/update', fulfilment);
    await runLogged(t, 'shopify', s.id, 'fulfillments/update', fulfilment);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({ to: '15550109999', params: ['Ada L', '#1001', ''] });
  });

  it('does not fire Delivered for a shipment still in transit', async () => {
    const t = await api.signup('ewh13');
    const s = await store(t, 'shopify');
    await automation(t, 'shopify', s.id, 'order/delivered', await template(t));
    const fulfilment = { id: 9, order_id: 1, shipment_status: 'in_transit' };
    await shopifyPost(s.secret, 'fulfillments/update', fulfilment);
    await runLogged(t, 'shopify', s.id, 'fulfillments/update', fulfilment);
    expect(sentMessages).toHaveLength(0);
  });

  it('clears the token on app/uninstalled and keeps the row, mapping and logs', async () => {
    const t = await api.signup('ewh14');
    const s = await store(t, 'shopify');
    await shopifyPost(s.secret, 'app/uninstalled', { id: 1 });
    await runLogged(t, 'shopify', s.id, 'app/uninstalled', { id: 1 });
    const row = (
      await h.owner.query(
        `SELECT access_token, connected_at FROM shopify_integrations WHERE id = $1`,
        [s.id],
      )
    ).rows[0];
    expect(row).toEqual({ access_token: '', connected_at: null });
    expect(await logs(t, 'shopify', s.id)).toHaveLength(1);
  });

  const compliance = (topic: string, body: Record<string, unknown>, hmac?: string) => {
    const raw = JSON.stringify(body);
    return api
      .http()
      .post('/v2/shopify/compliance')
      .set('content-type', 'application/json')
      .set('x-shopify-topic', topic)
      .set('x-shopify-hmac-sha256', hmac ?? sign(raw, CLIENT_SECRET))
      .send(raw);
  };

  it('refuses a bad signature before reading anything, with no store installed', async () => {
    const r = await compliance(
      'shop/redact',
      { shop_domain: 'x.myshopify.com' },
      sign('{}', 'wrong'),
    );
    expect(r.status).toBe(401);
    expect(r.text).toBe('bad hmac');
  });

  it("customers/redact erases that customer's logs only; shop/redact erases the store; both answer 200", async () => {
    const t = await api.signup('ewh15');
    const s = await store(t, 'shopify');
    const domain = (
      await h.owner.query(`SELECT store_url FROM shopify_integrations WHERE id = $1`, [s.id])
    ).rows[0].store_url as string;
    await h.owner.query(
      `INSERT INTO shopify_integration_logs (org_id, integration_id, event_type, status, recipient)
       VALUES ($1, $2, 'orders/create', 'sent', '111'), ($1, $2, 'orders/create', 'sent', '222')`,
      [t.orgId, s.id],
    );
    expect(
      (await compliance('customers/redact', { shop_domain: domain, customer: { phone: '111' } }))
        .status,
    ).toBe(200);
    expect((await logs(t, 'shopify', s.id)).map((l) => l.recipient)).toEqual(['222']);
    expect((await compliance('customers/data_request', { shop_domain: domain })).status).toBe(200);
    expect((await compliance('shop/redact', { shop_domain: domain })).status).toBe(200);
    expect(
      (await h.owner.query(`SELECT 1 FROM shopify_integrations WHERE id = $1`, [s.id])).rows,
    ).toHaveLength(0);
    expect(await logs(t, 'shopify', s.id)).toHaveLength(0);
  });
});

describe('a new store order is announced for the order flow trigger (TW-FLR-006)', () => {
  /** Posts a signed Shopify delivery and runs it through the pipeline the way the worker does. */
  const shopifyRun = async (
    t: Tenant,
    s: { id: number; secret: string },
    topic: string,
    data: Record<string, unknown>,
  ) => {
    await shopifyPost(s.secret, topic, data);
    const [row] = (
      await h.owner.query(
        `SELECT id, created_at FROM shopify_integration_logs WHERE org_id = $1 AND event_type = $2 ORDER BY id DESC LIMIT 1`,
        [t.orgId, topic],
      )
    ).rows;
    await pipeline.run(
      job(t, 'shopify', s.id, topic, data, Number(row.id), new Date(row.created_at).toISOString()),
    );
  };
  const announced = async (t: Tenant) =>
    (
      await h.owner.query(
        `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'order.placed' ORDER BY id`,
        [t.orgId],
      )
    ).rows.map((r) => r.payload as Record<string, unknown>);

  it('writes one order.placed with the order, in the transaction that wrote the order', async () => {
    const t = await api.signup('ewhop1');
    const s = await store(t, 'shopify');
    await shopifyRun(t, s, 'orders/create', order);
    const [w] = (
      await h.owner.query(`SELECT uuid, contact_id FROM wa_orders WHERE org_id = $1`, [t.orgId])
    ).rows;
    const events = await announced(t);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orderId: w.uuid,
      via: 'shopify',
      contactId: Number(w.contact_id),
      phone: '15550109999',
      name: 'Ada L',
      orderNumber: '1001',
      totalMinor: 2500,
      currency: 'USD',
      status: 'paid',
    });
  });

  it('announces an order once: a repeat delivery, the paid and updated topics of the same order add nothing', async () => {
    const t = await api.signup('ewhop2');
    const s = await store(t, 'shopify');
    await shopifyRun(t, s, 'orders/create', order);
    await shopifyRun(t, s, 'orders/create', order);
    await shopifyRun(t, s, 'orders/paid', order);
    await shopifyRun(t, s, 'orders/updated', { ...order, financial_status: 'refunded' });
    expect(await announced(t)).toHaveLength(1);
  });

  it('does not announce an order first seen through an update (it is older than the connection), or one with no number', async () => {
    const t = await api.signup('ewhop3');
    const s = await store(t, 'shopify');
    await shopifyRun(t, s, 'orders/updated', { ...order, id: 2002 });
    await shopifyRun(t, s, 'orders/create', {
      ...order,
      id: 2003,
      customer: { first_name: 'No Phone' },
    });
    expect(await announced(t)).toHaveLength(0);
    const rows = await h.owner.query(`SELECT count(*)::int AS n FROM wa_orders WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(rows.rows[0].n).toBe(2);
  });

  it('announces a WooCommerce order.created once and not its order.updated', async () => {
    const t = await api.signup('ewhop4');
    const w = await store(t, 'woocommerce');
    const data = {
      id: 77,
      number: '77',
      total: '12.50',
      currency: 'USD',
      status: 'processing',
      billing: { first_name: 'Bo', phone: '08012345678', country: 'NG' },
    };
    const run = async (topic: string) => {
      const raw = JSON.stringify(data);
      await api
        .http()
        .post(`/v2/woocommerce/webhook/${w.secret}`)
        .set('content-type', 'application/json')
        .set('x-wc-webhook-topic', topic)
        .set('x-wc-webhook-delivery-id', randomBytes(5).toString('hex'))
        .set('x-wc-webhook-signature', sign(raw, w.secret))
        .send(raw);
      const [row] = (
        await h.owner.query(
          `SELECT id, created_at FROM woocommerce_integration_logs WHERE org_id = $1 AND event_type = $2 ORDER BY id DESC LIMIT 1`,
          [t.orgId, topic],
        )
      ).rows;
      await pipeline.run(
        job(
          t,
          'woocommerce',
          w.id,
          topic,
          data,
          Number(row.id),
          new Date(row.created_at).toISOString(),
        ),
      );
    };
    await run('order.created');
    await run('order.updated');
    const events = await announced(t);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      via: 'woocommerce',
      phone: '2348012345678',
      orderNumber: '77',
      totalMinor: 1250,
      status: 'paid',
    });
  });

  it('never announces into another workspace', async () => {
    const a = await api.signup('ewhop5a');
    const b = await api.signup('ewhop5b');
    const s = await store(a, 'shopify');
    await shopifyRun(a, s, 'orders/create', order);
    expect(await announced(a)).toHaveLength(1);
    expect(await announced(b)).toHaveLength(0);
  });
});
