import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAID_ORDER_HOOK } from '../../../src/modules/shopify-woocommerce/_shims/tokens';
import type { PaidOrderHook } from '../../../src/modules/shopify-woocommerce/_shims/tokens';
import {
  WebhookPipelineService,
  type WebhookJob,
} from '../../../src/modules/shopify-woocommerce/webhook-pipeline.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * A paid store order becomes one invoice (TW-ECOM-035), against a real Postgres: the pipeline mirrors the order, the hook bills it
 * through the invoicing module. Covers paid -> one invoice settled in the ledger, a replayed and a re-sent delivery -> no second one,
 * unpaid and switched-off -> none, the workspace's trigger, true minor units for a zero-decimal currency, tax -> tax invoice,
 * a failing hand-off never failing the delivery, the Invoices tab's list filtered by source, and tenant isolation.
 */
let h: Harness;
let api: Api;
let pipeline: WebhookPipelineService;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  pipeline = h.app.get(WebhookPipelineService);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const q = async (sql: string, params: unknown[] = []) => (await h.owner.query(sql, params)).rows;

async function store(t: Tenant, kind: 'shopify' | 'woocommerce', currency = 'USD') {
  const secret = randomBytes(20).toString('hex');
  const r =
    kind === 'shopify'
      ? await q(
          `INSERT INTO shopify_integrations (org_id, user_id, store_url, store_name, shop_currency, access_token, webhook_secret)
           VALUES ($1, $2, $3, 'S', $4, 'x', $5) RETURNING id, uuid`,
          [t.orgId, t.adminUserId, `${secret.slice(0, 6)}.myshopify.com`, currency, secret],
        )
      : await q(
          `INSERT INTO woocommerce_integrations (org_id, user_id, store_url, store_name, store_currency, consumer_key, consumer_secret, webhook_secret)
           VALUES ($1, $2, $3, 'W', $4, 'k', 's', $5) RETURNING id, uuid`,
          [t.orgId, t.adminUserId, `https://${secret.slice(0, 6)}.test`, currency, secret],
        );
  return { id: Number(r[0].id), uuid: r[0].uuid as string };
}

const policy = (t: Tenant, kind: string, uuid: string, body: object) =>
  api.http().put(`/v2/${kind}/stores/${uuid}/invoice-policy`).set(bearer(t.admin)).send(body);

type Kind = 'shopify' | 'woocommerce';

async function deliver(
  t: Tenant,
  kind: Kind,
  storeId: number,
  topic: string,
  data: Record<string, unknown>,
  deliveryId: string,
) {
  const log = (
    await q(
      `INSERT INTO ${kind}_integration_logs (org_id, integration_id, event_type, status) VALUES ($1, $2, $3, 'received') RETURNING id, created_at`,
      [t.orgId, storeId, topic],
    )
  )[0];
  const run: WebhookJob = {
    orgId: t.orgId,
    kind,
    storeId,
    eventType: topic,
    data,
    deliveryId,
    log: { id: Number(log.id), createdAt: new Date(log.created_at).toISOString() },
  };
  await pipeline.run(run);
}

const invoices = (t: Tenant) =>
  q(
    `SELECT id, uuid, source, doc_type, status, currency, total_minor, paid_minor, sent_at, delivery_channel, wa_order_id, buyer_phone
     FROM invoices WHERE org_id = $1 ORDER BY id`,
    [t.orgId],
  );

const shopifyOrder = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `#${id}`,
  order_number: id,
  currency: 'USD',
  total_price: '25.00',
  total_discounts: '0.00',
  total_tax: '0.00',
  financial_status: 'paid',
  customer: {
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
    phone: '+1 555 010 9999',
  },
  line_items: [
    { title: 'Tea', quantity: 2, price: '10.00', sku: 'TEA' },
    { title: 'Mug', quantity: 1, price: '5.00', sku: 'MUG' },
  ],
  shipping_lines: [],
  tax_lines: [],
  ...over,
});

describe('a paid Shopify order is invoiced once (TW-ECOM-035)', () => {
  it('makes one settled invoice for a paid order, and a replay or a later delivery makes no second', async () => {
    const t = await api.signup('einv1');
    const s = await store(t, 'shopify');
    expect((await policy(t, 'shopify', s.uuid, { autoInvoice: true })).body).toEqual({
      autoInvoice: true,
      trigger: 'on_paid',
    });

    await deliver(t, 'shopify', s.id, 'orders/paid', shopifyOrder(7001), 'd-1');
    const [inv, ...rest] = await invoices(t);
    expect(rest).toHaveLength(0);
    expect(inv).toMatchObject({
      source: 'shopify',
      doc_type: 'receipt',
      status: 'issued',
      currency: 'USD',
      total_minor: 2500,
      paid_minor: 2500,
      delivery_channel: 'whatsapp',
    });
    expect(inv.sent_at).not.toBeNull();
    expect(Number(inv.wa_order_id)).toBeGreaterThan(0);
    expect(
      (
        await q(`SELECT sales_order_id, invoice_id FROM wa_orders WHERE id = $1`, [inv.wa_order_id])
      )[0],
    ).toMatchObject({ invoice_id: inv.id });
    expect(
      Number(
        (await q(`SELECT count(*)::int AS n FROM sales_orders WHERE org_id = $1`, [t.orgId]))[0].n,
      ),
    ).toBe(1);

    // the same delivery again (the store's retry), then a new delivery of the same order
    await deliver(t, 'shopify', s.id, 'orders/paid', shopifyOrder(7001), 'd-1');
    await deliver(t, 'shopify', s.id, 'orders/updated', shopifyOrder(7001), 'd-2');
    expect(await invoices(t)).toHaveLength(1);
    expect(
      Number(
        (await q(`SELECT count(*)::int AS n FROM payments WHERE org_id = $1`, [t.orgId]))[0].n,
      ),
    ).toBe(1);
    const claims = await q(
      `SELECT delivery_id, outcome FROM ecom_invoice_handoffs WHERE org_id = $1 ORDER BY id`,
      [t.orgId],
    );
    expect(claims).toEqual([
      { delivery_id: 'd-1', outcome: 'invoiced' },
      { delivery_id: 'd-2', outcome: 'existing' },
    ]);
  });

  it('does not bring an invoice back after it was voided when the order is sent again', async () => {
    const t = await api.signup('einv2');
    const s = await store(t, 'shopify');
    await policy(t, 'shopify', s.uuid, { autoInvoice: true, trigger: 'on_placed' });
    const unpaid = shopifyOrder(7002, { financial_status: 'pending' });
    await deliver(t, 'shopify', s.id, 'orders/create', unpaid, 'v-1');
    const [inv] = await invoices(t);
    const voided = await api
      .http()
      .post(`/v2/invoices/${inv.uuid}/void`)
      .set(bearer(t.admin))
      .set('Idempotency-Key', 'void-7002')
      .send({ reason: 'issued by mistake' });
    expect(voided.status, JSON.stringify(voided.body)).toBeLessThan(300);
    await deliver(t, 'shopify', s.id, 'orders/updated', unpaid, 'v-2');
    const after = await invoices(t);
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe('void');
  });

  it('makes nothing for an unpaid order, and nothing while the switch is off', async () => {
    const t = await api.signup('einv3');
    const s = await store(t, 'shopify');
    // off by default
    await deliver(t, 'shopify', s.id, 'orders/paid', shopifyOrder(7003), 'o-1');
    expect(await invoices(t)).toHaveLength(0);
    await policy(t, 'shopify', s.uuid, { autoInvoice: true });
    await deliver(
      t,
      'shopify',
      s.id,
      'orders/create',
      shopifyOrder(7004, { financial_status: 'pending' }),
      'o-2',
    );
    await deliver(
      t,
      'shopify',
      s.id,
      'orders/cancelled',
      shopifyOrder(7005, { financial_status: 'paid', cancelled_at: '2026-01-01T00:00:00Z' }),
      'o-3',
    );
    expect(await invoices(t)).toHaveLength(0);
    // the orders are still mirrored
    expect(
      Number(
        (await q(`SELECT count(*)::int AS n FROM wa_orders WHERE org_id = $1`, [t.orgId]))[0].n,
      ),
    ).toBe(3);
  });

  it('follows the workspace trigger: placed invoices an unpaid order and records no payment', async () => {
    const t = await api.signup('einv4');
    const s = await store(t, 'shopify');
    await policy(t, 'shopify', s.uuid, { autoInvoice: true, trigger: 'on_placed' });
    await deliver(
      t,
      'shopify',
      s.id,
      'orders/create',
      shopifyOrder(7006, { financial_status: 'pending' }),
      't-1',
    );
    const [inv] = await invoices(t);
    expect(inv).toMatchObject({ total_minor: 2500, paid_minor: 0 });
  });

  it('keeps true minor units for a zero-decimal currency and puts a real tax on a tax invoice', async () => {
    const t = await api.signup('einv5');
    const s = await store(t, 'shopify', 'JPY');
    await policy(t, 'shopify', s.uuid, { autoInvoice: true });
    await deliver(
      t,
      'shopify',
      s.id,
      'orders/paid',
      shopifyOrder(7007, {
        currency: 'JPY',
        total_price: '3300',
        total_tax: '300',
        taxes_included: false,
        tax_lines: [{ title: 'VAT', price: '300', rate: 0.1 }],
        line_items: [{ title: 'Tea', quantity: 2, price: '1500', sku: 'TEA' }],
      }),
      'j-1',
    );
    const [inv] = await invoices(t);
    expect(inv).toMatchObject({ currency: 'JPY', doc_type: 'tax_invoice', total_minor: 3300 });
  });
});

describe('a paid WooCommerce order (TW-ECOM-035)', () => {
  const woo = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    number: String(id),
    status: 'processing',
    currency: 'USD',
    total: '12.00',
    total_tax: '0.00',
    discount_total: '0.00',
    shipping_total: '2.00',
    shipping_tax: '0.00',
    billing: {
      first_name: 'Grace',
      last_name: 'H',
      email: 'g@example.com',
      phone: '+1 555 020 1111',
      country: 'US',
    },
    line_items: [{ name: 'Cup', quantity: 2, subtotal: '10.00', total: '10.00', sku: 'CUP' }],
    tax_lines: [],
    ...over,
  });

  it('invoices a processing order with its shipping, but not a pending one', async () => {
    const t = await api.signup('einv6');
    const s = await store(t, 'woocommerce');
    await policy(t, 'woocommerce', s.uuid, { autoInvoice: true });
    await deliver(t, 'woocommerce', s.id, 'order.created', woo(8001, { status: 'pending' }), 'w-1');
    expect(await invoices(t)).toHaveLength(0);
    await deliver(t, 'woocommerce', s.id, 'order.updated', woo(8001), 'w-2');
    const [inv, ...rest] = await invoices(t);
    expect(rest).toHaveLength(0);
    expect(inv).toMatchObject({ source: 'woocommerce', total_minor: 1200, paid_minor: 1200 });
  });
});

describe('the hand-off never fails the delivery, and the tab reads its own store (TW-ECOM-035)', () => {
  it('a hand-off that throws leaves the delivery done and the order mirrored', async () => {
    const t = await api.signup('einv7');
    const s = await store(t, 'shopify');
    const hook = h.app.get<PaidOrderHook>(PAID_ORDER_HOOK);
    const real = hook.handOff.bind(hook);
    hook.handOff = () => Promise.reject(new Error('invoicing is down'));
    try {
      await expect(
        deliver(t, 'shopify', s.id, 'orders/paid', shopifyOrder(7010), 'f-1'),
      ).resolves.toBeUndefined();
    } finally {
      hook.handOff = real;
    }
    expect(
      Number(
        (await q(`SELECT count(*)::int AS n FROM wa_orders WHERE org_id = $1`, [t.orgId]))[0].n,
      ),
    ).toBe(1);
  });

  it('lists only the source asked for, keeps tenants apart, and the policy is 404 across tenants', async () => {
    const a = await api.signup('einv8');
    const b = await api.signup('einv9');
    const sa = await store(a, 'shopify');
    const sb = await store(b, 'shopify');
    await policy(a, 'shopify', sa.uuid, { autoInvoice: true });
    await policy(b, 'shopify', sb.uuid, { autoInvoice: true });
    // the same store order id in two workspaces
    await deliver(a, 'shopify', sa.id, 'orders/paid', shopifyOrder(9001), 'x-1');
    await deliver(b, 'shopify', sb.id, 'orders/paid', shopifyOrder(9001), 'x-1');
    await q(
      `INSERT INTO invoices (org_id, source, doc_type, status, currency, currency_exponent) VALUES ($1, 'manual', 'tax_invoice', 'draft', 'USD', 2)`,
      [a.orgId],
    ).catch(() => undefined);

    const list = (t: Tenant, source: string) =>
      api.http().get(`/v2/invoices?source=${source}`).set(bearer(t.admin));
    const ra = await list(a, 'shopify');
    expect(ra.status).toBe(200);
    expect(ra.body.data).toHaveLength(1);
    expect(ra.body.data[0].source).toBe('shopify');
    expect((await list(a, 'woocommerce')).body.data).toHaveLength(0);
    const rb = await list(b, 'shopify');
    expect(rb.body.data).toHaveLength(1);
    expect(rb.body.data[0].id).not.toBe(ra.body.data[0].id);

    const cross = await api
      .http()
      .get(`/v2/shopify/stores/${sb.uuid}/invoice-policy`)
      .set(bearer(a.admin));
    expect(cross.status).toBe(404);
    expect(
      (await q(`SELECT delivery_id FROM ecom_invoice_handoffs WHERE org_id = $1`, [a.orgId]))
        .length,
    ).toBe(1);
  });

  it('forces row level security on the claims table', async () => {
    const r = await q(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'ecom_invoice_handoffs'`,
    );
    expect(r[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const p = await q(
      `SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'ecom_invoice_handoffs'`,
    );
    expect(Number(p[0].n)).toBe(1);
  });
});
