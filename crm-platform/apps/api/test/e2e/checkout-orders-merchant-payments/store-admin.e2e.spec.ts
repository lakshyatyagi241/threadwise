import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The harness first: it loads the app graph in the order the application itself does (a domain barrel first hits an import cycle).
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { signRazorpayBody } from '../../../src/infra/providers/storefront-builder/razorpay-payloads';

/**
 * The merchant side of the store end to end: orders, coupons, saved customers, the group directory, the shared workspace payment
 * gateway and the payments overview, through the real app with real Postgres and Redis. Razorpay, the gateway drivers' HTTP and DNS
 * are the fixtures (STORE_PROVIDER_MODE=fixture); the Node bridge that carries the WhatsApp text is a local HTTP stub.
 */
let h: Harness;
let api: Api;
let bridge: Server;
const bridgeCalls: Array<{ path: string; body: Record<string, string> }> = [];

process.env.STORE_PROVIDER_MODE = 'fixture';
process.env.BAILEYS_NODE_TOKEN = 'node-token-1';

let ipSeq = 0;
const ip = () => `10.88.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(async () => {
  bridge = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      bridgeCalls.push({
        path: req.url ?? '',
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, string>,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"success":true}');
    });
  });
  await new Promise<void>((r) => bridge.listen(0, '127.0.0.1', r));
  process.env.BAILEYS_SERVER_URL = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
  await new Promise((r) => bridge?.close(r));
});

// --- arranging ----------------------------------------------------------------------------------------------------------

async function device(t: Tenant, phone = '9812345678'): Promise<string> {
  const r = await h.owner.query(
    `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
     VALUES ($1, 'Counter phone', '91', $2, 'connected', true) RETURNING uuid`,
    [t.orgId, phone],
  );
  return r.rows[0].uuid as string;
}

async function shop(t: Tenant, name: string, deviceId: string): Promise<Record<string, any>> {
  const res = await api.as(t.admin).post('/v2/store/shops').send({ shopName: name, deviceId });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** A tenant with a connected device and one shop. */
async function merchant(label: string) {
  const t = await api.signup(label);
  const dev = await device(t);
  const s = await shop(t, 'Media City Threads', dev);
  const shopId = Number(
    (await h.owner.query(`SELECT id FROM wa_storefronts WHERE uuid = $1`, [s.id])).rows[0].id,
  );
  return { t, dev, s, shopId, slug: s.slug as string };
}

interface SeedOrder {
  source?: string;
  status?: string;
  name?: string | null;
  phone?: string | null;
  total?: number;
  method?: string;
  link?: string | null;
  shopId?: number | null;
  ageHours?: number;
  coupon?: string | null;
  meta?: Record<string, unknown> | null;
  currency?: string;
  items?: unknown[];
  token?: string | null;
}
async function order(t: Tenant, o: SeedOrder = {}) {
  const r = await h.owner.query(
    `INSERT INTO wa_orders (org_id, source, customer_phone, customer_name, items_json, total_minor, discount_minor, coupon_code,
                            payment_method, payment_link, status, storefront_id, currency_code, recovery_token, meta_json, created_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,0,$7,$8,$9,$10,$11,$12,$13,$14::jsonb, now() - ($15 || ' hours')::interval)
     RETURNING id, uuid`,
    [
      t.orgId,
      o.source ?? 'storefront',
      o.phone === undefined ? '+91 98765 43210' : o.phone,
      o.name === undefined ? 'Asha Rao' : o.name,
      JSON.stringify(
        o.items ?? [
          {
            product_id: 1,
            name: 'Kurta',
            qty: 2,
            price_minor: 25000,
            image: null,
            retailer_id: 'K1',
          },
        ],
      ),
      o.total ?? 50000,
      o.coupon ?? null,
      o.method ?? 'prepaid',
      o.link ?? null,
      o.status ?? 'new',
      o.shopId ?? null,
      o.currency ?? 'INR',
      o.token === undefined
        ? `tok${Math.random().toString(36).slice(2)}tok${Math.random().toString(36).slice(2)}`
        : o.token,
      o.meta ? JSON.stringify(o.meta) : null,
      String(o.ageHours ?? 1),
    ],
  );
  return { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}

const get = (t: Tenant | string, path: string) =>
  api.as(typeof t === 'string' ? t : t.admin).get(path);
const ids = (res: { body: { data: Array<{ id: string }> } }) => res.body.data.map((d) => d.id);
const dbOrder = async (id: number) =>
  (await h.owner.query(`SELECT * FROM wa_orders WHERE id = $1`, [id])).rows[0];

function stripeSign(raw: string, secret: string) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
}
function stripePaid(orderNo: number, amount: number, currency = 'inr') {
  return JSON.stringify({
    id: `evt_${orderNo}_${amount}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${orderNo}`,
        client_reference_id: `WAORD-${orderNo}`,
        payment_status: 'paid',
        payment_intent: `pi_${orderNo}`,
        amount_total: amount,
        currency,
      },
    },
  });
}
const gatewayHook = (gatewayUuid: string, raw: string, signature?: string) =>
  api
    .http()
    .post(`/v2/store-public/webhooks/gateway/${gatewayUuid}`)
    .set('x-forwarded-for', ip())
    .set('content-type', 'application/json')
    .set('stripe-signature', signature ?? '')
    .send(raw);

const saveGateway = (t: Tenant, slug: string, body: Record<string, unknown>) =>
  api.as(t.admin).put(`/v2/store/gateways/${slug}`).send(body);

// --- permissions and plan ---------------------------------------------------------------------------------------------------

describe('permissions and the plan gate', () => {
  it('a member with no keys is refused everywhere; read is not manage, and delete is its own key', async () => {
    const m = await merchant('perm');
    const o = await order(m.t, { shopId: m.shopId });
    const nobody = await api.member(m.t, 'nobody', []);
    for (const path of [
      '/v2/store/orders',
      '/v2/store/orders/counts',
      `/v2/store/orders/${o.uuid}`,
      '/v2/store/coupons',
      '/v2/store/customers',
      '/v2/store/groups',
      '/v2/store/groups/summary',
      '/v2/store/gateways',
      '/v2/store/gateways/drivers',
      '/v2/store/gateways/resolved',
      '/v2/store/payments',
      '/v2/store/payments/summary',
      '/v2/store/payments/whatsapp-pay',
    ]) {
      expect((await get(nobody.token, path)).status, path).toBe(403);
    }

    const reader = await api.member(m.t, 'reader', [['store.orders.read']]);
    expect((await get(reader.token, '/v2/store/orders')).status).toBe(200);
    const patch = await api
      .as(reader.token)
      .patch(`/v2/store/orders/${o.uuid}/status`)
      .send({ status: 'confirmed' });
    expect(patch.status).toBe(403);
    expect(
      (await api.as(reader.token).post(`/v2/store/orders/${o.uuid}/create-invoice`)).status,
    ).toBe(403);
    expect(
      (await api.as(reader.token).post(`/v2/store/orders/${o.uuid}/generate-payment-link`).send({}))
        .status,
    ).toBe(403);

    const manager = await api.member(m.t, 'manager', [['store.orders.manage']]);
    expect((await api.as(manager.token).delete(`/v2/store/orders/${o.uuid}`)).status).toBe(403);
    const deleter = await api.member(m.t, 'deleter', [['store.orders.delete']]);
    expect((await api.as(deleter.token).delete(`/v2/store/orders/${o.uuid}`)).status).toBe(204);

    const coupons = await api.member(m.t, 'coupons', [['store.coupons.read']]);
    expect((await get(coupons.token, '/v2/store/coupons')).status).toBe(200);
    expect(
      (
        await api
          .as(coupons.token)
          .post('/v2/store/coupons')
          .send({ code: 'X', type: 'flat', amount: 1 })
      ).status,
    ).toBe(403);

    const gw = await api.member(m.t, 'gw', [['store.gateways.read']]);
    expect((await get(gw.token, '/v2/store/gateways')).status).toBe(200);
    expect(
      (
        await saveGateway({ ...m.t, admin: gw.token }, 'stripe', {
          credentials: { secret_key: 'x' },
        })
      ).status,
    ).toBe(403);
    const pay = await api.member(m.t, 'pay', [['store.payments.view']]);
    expect((await get(pay.token, '/v2/store/payments')).status).toBe(200);
    expect(
      (
        await api
          .as(pay.token)
          .put('/v2/store/payments/whatsapp-pay')
          .send({ configName: 'x', paymentType: 'razorpay' })
      ).status,
    ).toBe(403);
  });

  it('orders and coupons are behind the wa_storefront plan feature; gateways, customers, groups and payments are not', async () => {
    const t = await api.signup('plan');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"wa_storefront":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    for (const path of ['/v2/store/orders', '/v2/store/orders/counts', '/v2/store/coupons']) {
      const res = await get(t, path);
      expect([path, res.status, res.body.code]).toEqual([path, 422, 'PLAN_FEATURE_LOCKED']);
    }
    const create = await api
      .as(t.admin)
      .post('/v2/store/coupons')
      .send({ code: 'X', type: 'flat', amount: 1 });
    expect(create.body.code).toBe('PLAN_FEATURE_LOCKED');
    for (const path of [
      '/v2/store/gateways',
      '/v2/store/customers',
      '/v2/store/groups',
      '/v2/store/payments',
    ]) {
      expect((await get(t, path)).status, path).toBe(200);
    }
  });
});

// --- orders -----------------------------------------------------------------------------------------------------------------

describe('orders: list, filters, detail', () => {
  let m: Awaited<ReturnType<typeof merchant>>;
  const o: Record<string, { id: number; uuid: string }> = {};

  beforeAll(async () => {
    m = await merchant('olist');
    o.o1 = await order(m.t, { status: 'new', method: 'cod', shopId: m.shopId, ageHours: 1 });
    o.o2 = await order(m.t, {
      source: 'waba',
      status: 'pending',
      name: 'Vikram',
      phone: '919811111111',
      link: 'https://pay.example/l1',
      ageHours: 2,
    });
    o.o3 = await order(m.t, {
      status: 'paid',
      name: 'Meera Nair',
      phone: '+91 99999 00000',
      shopId: m.shopId,
      meta: { paid_via: 'razorpay_link', razorpay_payment: 'pay_77' },
      ageHours: 3,
      coupon: 'SAVE10',
    });
    o.o4 = await order(m.t, {
      source: 'manual',
      status: 'cancelled',
      name: null,
      phone: '+1 (415) 555-0100',
      ageHours: 48,
    });
    o.o5 = await order(m.t, {
      source: 'shopify',
      status: 'completed',
      name: 'Zed',
      phone: '919822222222',
      ageHours: 24 * 40,
    });
  });

  it('lists newest first with the contract fields and no internal ids', async () => {
    const res = await get(m.t, '/v2/store/orders');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.map((d: any) => d.orderNo)).toEqual([
      o.o1!.id,
      o.o2!.id,
      o.o3!.id,
      o.o4!.id,
      o.o5!.id,
    ]);
    expect(res.body.page).toEqual({ nextCursor: null, hasMore: false, limit: 25 });
    expect(res.body.data[0]).toEqual({
      id: o.o1!.uuid,
      orderNo: o.o1!.id,
      source: 'storefront',
      status: 'new',
      paymentStatus: 'cod',
      paymentMethod: 'cod',
      customerName: 'Asha Rao',
      customerPhone: '+91 98765 43210',
      itemsCount: 1,
      totalMinor: 50000,
      currencyCode: 'INR',
      storefrontId: m.s.id,
      storefrontName: 'Media City Threads',
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/"org_?id"/i);
  });

  it('filters by status, source, shop, payment status and the date range', async () => {
    const q = async (qs: string) =>
      (await get(m.t, `/v2/store/orders?${qs}`)).body.data.map((d: any) => d.orderNo);
    expect(await q('status=paid')).toEqual([o.o3!.id]);
    expect(await q('status=all')).toHaveLength(5);
    expect(await q('source=waba')).toEqual([o.o2!.id]);
    expect(await q(`storefrontId=${m.s.id}`)).toEqual([o.o1!.id, o.o3!.id]);
    expect(await q('paymentStatus=awaiting')).toEqual([o.o2!.id]);
    expect(await q('paymentStatus=cod')).toEqual([o.o1!.id]);
    expect(await q('paymentStatus=paid')).toEqual([o.o3!.id]);
    expect(await q('paymentStatus=unpaid')).toEqual([o.o4!.id, o.o5!.id]);
    const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    expect(await q(`from=${day(7)}`)).toEqual([o.o1!.id, o.o2!.id, o.o3!.id, o.o4!.id]);
    expect(await q(`from=${day(60)}&to=${day(30)}`)).toEqual([o.o5!.id]);
    expect(await q(`status=new&source=storefront&storefrontId=${m.s.id}`)).toEqual([o.o1!.id]);
  });

  it("searches the buyer's phone (digits, any formatting), name and the order number", async () => {
    const q = async (term: string) =>
      (await get(m.t, `/v2/store/orders?q=${encodeURIComponent(term)}`)).body.data.map(
        (d: any) => d.orderNo,
      );
    expect(await q('98765')).toEqual([o.o1!.id]);
    expect(await q('+91 98765 43210')).toEqual([o.o1!.id]);
    expect(await q('4155550100')).toEqual([o.o4!.id]);
    expect(await q('meera')).toEqual([o.o3!.id]);
    expect(await q(`#${o.o2!.id}`)).toEqual([o.o2!.id]);
    expect(await q(String(o.o5!.id))).toContain(o.o5!.id);
    // A wildcard is literal text, not a pattern.
    expect(await q('%')).toEqual([]);
  });

  it('pages with a cursor: no row twice, none missed', async () => {
    const seen: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const res = await get(m.t, `/v2/store/orders?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((d: any) => d.orderNo));
      pages += 1;
      if (!res.body.page.hasMore) break;
      cursor = res.body.page.nextCursor;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual([o.o1!.id, o.o2!.id, o.o3!.id, o.o4!.id, o.o5!.id]);
    expect((await get(m.t, '/v2/store/orders?cursor=garbage')).status).toBe(400);
  });

  it('refuses a bad filter', async () => {
    expect((await get(m.t, '/v2/store/orders?status=lost')).status).toBe(422);
    expect((await get(m.t, '/v2/store/orders?from=10-05-2026')).status).toBe(422);
    expect((await get(m.t, '/v2/store/orders?limit=500')).status).toBe(422);
  });

  it('counts per status, workspace wide', async () => {
    const res = await get(m.t, '/v2/store/orders/counts');
    expect(res.body).toEqual({
      all: 5,
      new: 1,
      pending: 1,
      confirmed: 0,
      paid: 1,
      processing: 0,
      completed: 1,
      shipped: 0,
      cancelled: 1,
    });
  });

  it('opens one order: lines, totals, address, coupon, payments, history and the gateways it can be paid with', async () => {
    const res = await get(m.t, `/v2/store/orders/${o.o3!.uuid}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      id: o.o3!.uuid,
      orderNo: o.o3!.id,
      status: 'paid',
      paymentStatus: 'paid',
      couponCode: 'SAVE10',
      items: [
        {
          name: 'Kurta',
          qty: 2,
          priceMinor: 25000,
          lineTotalMinor: 50000,
          retailerId: 'K1',
          productId: 1,
        },
      ],
      subtotalMinor: 50000,
      shippingMinor: 0,
      taxMinor: 0,
      contactId: null,
      invoiceId: null,
      salesOrderId: null,
      availableGateways: [],
    });
    expect(res.body.payments).toEqual([
      expect.objectContaining({
        kind: 'payment_link',
        gateway: 'razorpay',
        status: 'paid',
        reference: 'pay_77',
      }),
    ]);
    expect(res.body.timeline[0]).toMatchObject({ kind: 'created', actor: 'customer' });
    expect(typeof res.body.rowVersion).toBe('number');
    expect(JSON.stringify(res.body)).not.toMatch(/recovery|"org_?id"/i);
  });

  it('answers 404 for an unknown order and 400 for a malformed id', async () => {
    expect((await get(m.t, '/v2/store/orders/7e57d1b6-0000-4000-8000-000000000000')).status).toBe(
      404,
    );
    expect((await get(m.t, '/v2/store/orders/not-a-uuid')).status).toBe(400);
  });

  it('another workspace sees none of it and cannot touch it', async () => {
    const other = await api.signup('oiso');
    expect((await get(other, '/v2/store/orders')).body.data).toEqual([]);
    expect((await get(other, `/v2/store/orders/${o.o1!.uuid}`)).status).toBe(404);
    expect(
      (
        await api
          .as(other.admin)
          .patch(`/v2/store/orders/${o.o1!.uuid}/status`)
          .send({ status: 'paid' })
      ).status,
    ).toBe(404);
    expect((await api.as(other.admin).delete(`/v2/store/orders/${o.o1!.uuid}`)).status).toBe(404);
    expect(
      (
        await api
          .as(other.admin)
          .post(`/v2/store/orders/${o.o1!.uuid}/payment-link`)
          .send({ paymentLink: 'https://x.test/p' })
      ).status,
    ).toBe(404);
    expect((await get(other, `/v2/store/orders?storefrontId=${m.s.id}`)).body.data).toEqual([]);
    expect((await dbOrder(o.o1!.id)).status).toBe('new');
  });
});

describe('orders: status, payment links, delete', () => {
  it('moves an order to any status, saves the notes and the link, tells the buyer, audits and publishes; a stale form is refused', async () => {
    const m = await merchant('ostat');
    const o = await order(m.t, { shopId: m.shopId, status: 'new' });
    const before = (await get(m.t, `/v2/store/orders/${o.uuid}`)).body;
    bridgeCalls.length = 0;

    const res = await api.as(m.t.admin).patch(`/v2/store/orders/${o.uuid}/status`).send({
      status: 'confirmed',
      notes: 'Packed and ready',
      paymentLink: 'https://pay.example/abc',
      rowVersion: before.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.notified).toBe(true);
    expect(res.body.order).toMatchObject({
      status: 'confirmed',
      notes: 'Packed and ready',
      paymentLink: 'https://pay.example/abc',
      paymentStatus: 'awaiting',
    });
    expect(res.body.order.rowVersion).toBeGreaterThan(before.rowVersion);
    expect(res.body.order.timeline.map((t: any) => t.kind)).toEqual([
      'created',
      'status_changed',
      'payment_link',
      'note',
    ]);
    expect(res.body.order.timeline[1].detail).toBe('new → confirmed');

    // Reference's text: "Your order #<id> is now: <Status>" and the link, to the buyer's number, from the shop's number.
    expect(bridgeCalls).toHaveLength(1);
    const sent = JSON.stringify(bridgeCalls[0]!.body);
    expect(sent).toContain(`Your order #${o.id} is now: Confirmed`);
    expect(sent).toContain('https://pay.example/abc');
    expect(sent).toContain('919876543210');

    const events = await api.events(m.t.orgId, 'store.order_status_changed');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orderNo: o.id,
      orderId: o.uuid,
      from: 'new',
      to: 'confirmed',
      invoiceDue: false,
    });
    expect((await api.events(m.t.orgId, 'store.order_payment_link_set')).length).toBe(1);
    expect(await api.auditCount(m.t.orgId, 'wa_orders', 'update')).toBeGreaterThanOrEqual(1);

    // The same form again: its version is stale.
    const stale = await api
      .as(m.t.admin)
      .patch(`/v2/store/orders/${o.uuid}/status`)
      .send({ status: 'shipped', rowVersion: before.rowVersion });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    expect((await dbOrder(o.id)).status).toBe('confirmed');

    // Any status to any status, out of cancelled too; no buyer message without a change, but a null clears the note.
    bridgeCalls.length = 0;
    const same = await api
      .as(m.t.admin)
      .patch(`/v2/store/orders/${o.uuid}/status`)
      .send({ status: 'confirmed', notes: null });
    expect(same.status).toBe(200);
    expect(same.body.notified).toBe(false);
    expect(same.body.order.notes).toBeNull();
    expect(bridgeCalls).toHaveLength(0);
    await api
      .as(m.t.admin)
      .patch(`/v2/store/orders/${o.uuid}/status`)
      .send({ status: 'cancelled' });
    const back = await api
      .as(m.t.admin)
      .patch(`/v2/store/orders/${o.uuid}/status`)
      .send({ status: 'new' });
    expect(back.body.order.status).toBe('new');
  });

  it('refuses an unknown status, a bad link and an over-long note', async () => {
    const m = await merchant('obad');
    const o = await order(m.t, { shopId: m.shopId });
    const patch = (body: unknown) =>
      api
        .as(m.t.admin)
        .patch(`/v2/store/orders/${o.uuid}/status`)
        .send(body as object);
    expect((await patch({ status: 'lost' })).status).toBe(422);
    expect((await patch({ status: 'paid', paymentLink: 'nope' })).status).toBe(422);
    expect((await patch({ status: 'paid', notes: 'x'.repeat(1001) })).status).toBe(422);
    expect((await patch({})).status).toBe(422);
    expect((await dbOrder(o.id)).status).toBe('new');
  });

  it('a workspace with no connected number still saves the change; the buyer simply is not messaged', async () => {
    const t = await api.signup('nosend');
    const o = await order(t, { phone: '919800000009' });
    const res = await api
      .as(t.admin)
      .patch(`/v2/store/orders/${o.uuid}/status`)
      .send({ status: 'shipped' });
    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(false);
    expect((await dbOrder(o.id)).status).toBe('shipped');
  });

  it('moving to paid or completed marks an invoice as due on the event', async () => {
    const t = await api.signup('due');
    const o = await order(t);
    await api.as(t.admin).patch(`/v2/store/orders/${o.uuid}/status`).send({ status: 'paid' });
    const events = await api.events(t.orgId, 'store.order_status_changed');
    expect(events[0]).toMatchObject({ to: 'paid', invoiceDue: true });
  });

  it('send-payment-link saves a pasted link and sends it to the buyer', async () => {
    const m = await merchant('olink');
    const o = await order(m.t, { shopId: m.shopId, name: 'Asha Rao', total: 150000 });
    bridgeCalls.length = 0;
    const res = await api
      .as(m.t.admin)
      .post(`/v2/store/orders/${o.uuid}/payment-link`)
      .send({ paymentLink: 'https://pay.example/manual' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      url: 'https://pay.example/manual',
      sent: true,
      gateway: null,
    });
    expect((await dbOrder(o.id)).payment_link).toBe('https://pay.example/manual');
    expect(JSON.stringify(bridgeCalls[0]!.body)).toContain(
      "Hi Asha Rao, here's your payment link for *₹ 1,500.00*",
    );
    expect(
      (
        await api
          .as(m.t.admin)
          .post(`/v2/store/orders/${o.uuid}/payment-link`)
          .send({ paymentLink: 'x' })
      ).status,
    ).toBe(422);
  });

  it('delete removes the order and its lines for good, and is audited', async () => {
    const m = await merchant('odel');
    const o = await order(m.t, { shopId: m.shopId });
    await h.owner.query(
      `INSERT INTO wa_order_items (org_id, order_id, retailer_id, name, quantity, price_minor) VALUES ($1,$2,'R1','Line',1,100)`,
      [m.t.orgId, o.id],
    );
    const del = await api.as(m.t.admin).delete(`/v2/store/orders/${o.uuid}`);
    expect(del.status).toBe(204);
    expect((await get(m.t, `/v2/store/orders/${o.uuid}`)).status).toBe(404);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int n FROM wa_order_items WHERE order_id = $1`, [
          o.id,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(await api.auditCount(m.t.orgId, 'wa_orders', 'delete')).toBe(1);
    expect((await api.events(m.t.orgId, 'store.order_deleted'))[0]).toMatchObject({
      orderNo: o.id,
    });
    expect((await api.as(m.t.admin).delete(`/v2/store/orders/${o.uuid}`)).status).toBe(404);
  });
});

// --- the shared workspace gateway -------------------------------------------------------------------------------------------

describe('gateways: catalogue, save, mask, test, default, delete', () => {
  it('lists every driver with its fields and says which can charge and which can send a link', async () => {
    const t = await api.signup('gdrv');
    const res = await get(t, '/v2/store/gateways/drivers');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(33);
    const by = Object.fromEntries(res.body.data.map((d: any) => [d.slug, d]));
    expect(by.razorpay).toMatchObject({
      name: 'Razorpay',
      available: true,
      supportsPaymentLinks: true,
    });
    expect(by.razorpay.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'key_secret', type: 'password', required: true }),
        expect.objectContaining({ key: 'webhook_secret', webhook: true }),
      ]),
    );
    expect(by.stripe.supportsPaymentLinks).toBe(true);
    expect(by.bank_transfer.supportsPaymentLinks).toBe(false);
    expect(by.payu.supportsPaymentLinks).toBe(false);
    expect(res.body.data.every((d: any) => d.available === true)).toBe(true);
  });

  it('saves keys encrypted at rest and never returns them; a blank field keeps, clear removes, an unknown key is refused', async () => {
    const t = await api.signup('gsave');
    const KEY = 'rzp_live_ABCDEFGH1234';
    const SECRET = 'supersecret-value-9999';
    const res = await saveGateway(t, 'razorpay', {
      credentials: { key_id: KEY, key_secret: SECRET, webhook_secret: 'whsec-abcdef' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      slug: 'razorpay',
      name: 'Razorpay',
      scope: 'workspace',
      storefrontId: null,
      mode: 'live',
      active: true,
      isDefault: false,
      configured: true,
      webhookSecretMissing: false,
      migratedFromStorefront: false,
    });
    expect(res.body.webhookUrl).toMatch(/\/v2\/store-public\/webhooks\/gateway\/[0-9a-f-]{36}$/);
    const cred = (b: any, k: string) => b.credentials.find((c: any) => c.key === k);
    expect(cred(res.body, 'key_secret')).toEqual({
      key: 'key_secret',
      hasValue: true,
      masked: '••••••••9999',
    });
    expect(cred(res.body, 'webhook_secret').masked).toBe('••••••••cdef');

    // Not in any response, and not in the table in the clear.
    const list = await get(t, '/v2/store/gateways');
    for (const text of [JSON.stringify(res.body), JSON.stringify(list.body)]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('whsec-abcdef');
      expect(text).not.toContain(KEY);
    }
    const stored = (
      await h.owner.query(`SELECT credentials FROM wa_merchant_gateways WHERE org_id = $1`, [
        t.orgId,
      ])
    ).rows[0].credentials as string;
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain(SECRET);

    // A blank field keeps what is stored.
    const keep = await saveGateway(t, 'razorpay', {
      credentials: { key_id: '', key_secret: '', webhook_secret: 'whsec-newvalue99' },
    });
    expect(cred(keep.body, 'key_id').hasValue).toBe(true);
    expect(cred(keep.body, 'key_secret').masked).toBe('••••••••9999');
    expect(cred(keep.body, 'webhook_secret').masked).toBe('••••••••ue99');
    // clear removes a named field.
    const cleared = await saveGateway(t, 'razorpay', { clear: ['webhook_secret'] });
    expect(cred(cleared.body, 'webhook_secret')).toEqual({
      key: 'webhook_secret',
      hasValue: false,
      masked: null,
    });
    expect(cleared.body.webhookSecretMissing).toBe(true);
    // An unknown field is refused, and so is an unknown gateway.
    const evil = await saveGateway(t, 'razorpay', { credentials: { evil: 'x' } });
    expect(evil.status).toBe(422);
    expect((await saveGateway(t, 'nope', { credentials: {} })).status).toBe(404);
    expect(await api.auditCount(t.orgId, 'wa_merchant_gateways', 'update')).toBeGreaterThanOrEqual(
      2,
    );
    // The audit trail names keys, never values.
    const audit = (
      await h.owner.query(
        `SELECT delta::text d FROM audit_log WHERE org_id = $1 AND module = 'wa_merchant_gateways'`,
        [t.orgId],
      )
    ).rows
      .map((r) => r.d)
      .join(' ');
    expect(audit).not.toContain(SECRET);
    expect(audit).toContain('key_secret');
  });

  it('tests the keys: verified with the provider for Razorpay and Stripe, required fields only for the rest', async () => {
    const t = await api.signup('gtest');
    await saveGateway(t, 'razorpay', { credentials: { key_id: 'rzp_test_1', key_secret: 's' } });
    const ok = await api.as(t.admin).post('/v2/store/gateways/razorpay/test');
    expect(ok.body).toMatchObject({ ok: true, level: 'verified', missing: [] });
    await saveGateway(t, 'razorpay', { credentials: { key_id: 'rzp_fail_1' } });
    const bad = await api.as(t.admin).post('/v2/store/gateways/razorpay/test');
    expect(bad.body).toMatchObject({ ok: false, level: 'verified' });
    expect(bad.body.message).toMatch(/rejected/i);

    await saveGateway(t, 'paypal', { credentials: { client_id: 'cid' } });
    const half = await api.as(t.admin).post('/v2/store/gateways/paypal/test');
    expect(half.body).toMatchObject({ ok: false, level: 'fields', missing: ['client_secret'] });
    await saveGateway(t, 'paypal', { credentials: { client_secret: 'csec' } });
    const fields = await api.as(t.admin).post('/v2/store/gateways/paypal/test');
    expect(fields.body).toMatchObject({ ok: true, level: 'fields' });
    expect((await api.as(t.admin).post('/v2/store/gateways/stripe/test')).status).toBe(404);
  });

  it('toggle, one default per scope, delete, and the resolved view with where it came from', async () => {
    const m = await merchant('gdef');
    await saveGateway(m.t, 'stripe', {
      credentials: { secret_key: 'sk_test_1', webhook_secret: 'whsec_1' },
    });
    await saveGateway(m.t, 'razorpay', {
      credentials: { key_id: 'rzp_test_1', key_secret: 's', webhook_secret: 'w' },
    });
    // Nothing flagged: the lowest sort order (then the oldest) is what applies.
    expect((await get(m.t, '/v2/store/gateways/resolved')).body.resolved).toMatchObject({
      slug: 'stripe',
      source: 'workspace_default',
      storefrontId: null,
    });

    const setR = await api.as(m.t.admin).post('/v2/store/gateways/razorpay/default');
    expect(setR.status, JSON.stringify(setR.body)).toBe(200);
    expect(setR.body.isDefault).toBe(true);
    const setS = await api.as(m.t.admin).post('/v2/store/gateways/stripe/default');
    expect(setS.body.isDefault).toBe(true);
    const list = (await get(m.t, '/v2/store/gateways')).body.data;
    expect(list.filter((g: any) => g.isDefault).map((g: any) => g.slug)).toEqual(['stripe']);

    // A per-shop override wins for its shop and only there.
    await saveGateway(m.t, 'razorpay', {
      storefrontId: m.s.id,
      credentials: { key_id: 'rzp_shop', key_secret: 's' },
    });
    const own = (await get(m.t, `/v2/store/gateways/resolved?storefrontId=${m.s.id}`)).body
      .resolved;
    expect(own).toMatchObject({ slug: 'razorpay', source: 'store_override', storefrontId: m.s.id });
    expect((await get(m.t, '/v2/store/gateways/resolved')).body.resolved.slug).toBe('stripe');
    const scoped = (await get(m.t, `/v2/store/gateways?storefrontId=${m.s.id}`)).body.data;
    expect(scoped.map((g: any) => `${g.scope}:${g.slug}`).sort()).toEqual([
      'store:razorpay',
      'workspace:razorpay',
      'workspace:stripe',
    ]);

    // Switching the default off hands over to the next usable one; delete is real.
    const off = await api.as(m.t.admin).post('/v2/store/gateways/stripe/toggle');
    expect(off.body).toMatchObject({ active: false, isDefault: false });
    expect((await get(m.t, '/v2/store/gateways/resolved')).body.resolved.slug).toBe('razorpay');
    expect((await api.as(m.t.admin).post('/v2/store/gateways/stripe/default')).status).toBe(422);
    expect(
      (await api.as(m.t.admin).delete(`/v2/store/gateways/razorpay?storefrontId=${m.s.id}`)).status,
    ).toBe(204);
    expect(
      (await get(m.t, `/v2/store/gateways/resolved?storefrontId=${m.s.id}`)).body.resolved.source,
    ).toBe('workspace_default');
    expect((await api.as(m.t.admin).delete('/v2/store/gateways/razorpay')).status).toBe(204);
    expect((await get(m.t, '/v2/store/gateways/resolved')).body).toEqual({ resolved: null });
    expect((await api.as(m.t.admin).delete('/v2/store/gateways/razorpay')).status).toBe(404);
    expect((await api.as(m.t.admin).post('/v2/store/gateways/razorpay/toggle')).status).toBe(404);
    expect(
      (
        await get(
          m.t,
          '/v2/store/gateways/resolved?storefrontId=7e57d1b6-0000-4000-8000-000000000000',
        )
      ).status,
    ).toBe(404);
  });

  it('is isolated per workspace: another workspace sees no gateway and cannot use a shop it does not own', async () => {
    const a = await merchant('giso-a');
    const b = await api.signup('giso-b');
    await saveGateway(a.t, 'stripe', { credentials: { secret_key: 'sk_test_a' } });
    expect((await get(b, '/v2/store/gateways')).body.data).toEqual([]);
    expect((await api.as(b.admin).post('/v2/store/gateways/stripe/toggle')).status).toBe(404);
    expect(
      (await saveGateway(b, 'stripe', { storefrontId: a.s.id, credentials: { secret_key: 'x' } }))
        .status,
    ).toBe(404);
    expect((await get(b, '/v2/store/gateways/resolved')).body).toEqual({ resolved: null });
  });

  it("a shop's own Razorpay keys (storefront settings) are mirrored as its override, keep working for the webhook, and yield to a later save here", async () => {
    const m = await merchant('gmirror');
    const cur = (await get(m.t, `/v2/store/shops/${m.s.id}`)).body;
    const set = await api.as(m.t.admin).put(`/v2/store/shops/${m.s.id}/settings`).send({
      slug: cur.slug,
      themeKey: cur.themeKey,
      enabled: true,
      rowVersion: cur.rowVersion,
      paymentProvider: 'razorpay_api',
      rzpKeyId: 'rzp_test_1',
      rzpKeySecret: 'ksec',
      rzpWebhookSecret: 'wh-secret',
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const rows = (await get(m.t, `/v2/store/gateways?storefrontId=${m.s.id}`)).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: 'razorpay',
      scope: 'store',
      configured: true,
      migratedFromStorefront: true,
    });
    expect(
      (await get(m.t, `/v2/store/gateways/resolved?storefrontId=${m.s.id}`)).body.resolved,
    ).toMatchObject({ source: 'store_override', slug: 'razorpay' });

    const p = await h.owner.query(
      `INSERT INTO wa_products (org_id, name, slug, price_minor, in_stock, status, currency_code) VALUES ($1,'P','p-x',5000,true,'active','INR') RETURNING uuid`,
      [m.t.orgId],
    );
    const placed = await api
      .http()
      .post(`/v2/store-public/${m.slug}/checkout`)
      .set('x-forwarded-for', ip())
      .send({ name: 'Asha', phone: '+91 98765 43210', items: [{ id: p.rows[0].uuid, qty: 1 }] });
    const orderNo = placed.body.orderNo as number;
    const event = JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: {
            id: 'plink_1',
            short_url: 'https://rzp.io/i/x',
            amount: 5000,
            currency: 'INR',
            notes: { wa_order_id: String(orderNo), storefront_id: String(m.shopId) },
          },
        },
        payment: { entity: { id: 'pay_1' } },
      },
    });
    const hook = (secret: string) =>
      api
        .http()
        .post('/v2/store-public/webhooks/razorpay')
        .set('x-forwarded-for', ip())
        .set('content-type', 'application/json')
        .set('x-razorpay-signature', signRazorpayBody(event, secret))
        .send(event);

    // The keys typed on the settings page verify the webhook (through the gateway store now).
    expect((await hook('wrong')).status).toBe(400);

    // The gateway screen takes over: its secret is the one that counts from then on.
    await saveGateway(m.t, 'razorpay', {
      storefrontId: m.s.id,
      credentials: { webhook_secret: 'new-secret' },
    });
    expect((await hook('wh-secret')).status).toBe(400);
    const good = await hook('new-secret');
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    expect(good.body).toEqual({ ok: true, order: orderNo });
    expect((await dbOrder(orderNo)).status).toBe('paid');
  });

  it("a disabled or removed gateway no longer verifies the shop's Razorpay webhook (fail closed)", async () => {
    const m = await merchant('gclosed');
    await saveGateway(m.t, 'razorpay', {
      credentials: { key_id: 'rzp_test_1', key_secret: 's', webhook_secret: 'ws' },
    });
    const o = await order(m.t, { shopId: m.shopId, total: 5000 });
    const event = JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: {
            id: 'p',
            short_url: 'https://rzp.io/i/y',
            amount: 5000,
            currency: 'INR',
            notes: { wa_order_id: String(o.id), storefront_id: String(m.shopId) },
          },
        },
        payment: { entity: { id: 'pay' } },
      },
    });
    const hook = () =>
      api
        .http()
        .post('/v2/store-public/webhooks/razorpay')
        .set('x-forwarded-for', ip())
        .set('content-type', 'application/json')
        .set('x-razorpay-signature', signRazorpayBody(event, 'ws'))
        .send(event);
    await api.as(m.t.admin).post('/v2/store/gateways/razorpay/toggle');
    expect((await hook()).status).toBe(400);
    await api.as(m.t.admin).post('/v2/store/gateways/razorpay/toggle');
    expect((await hook()).status).toBe(200);
    expect((await dbOrder(o.id)).status).toBe('paid');
  });
});

describe('payment links and the gateway webhook', () => {
  it('generates a Razorpay link on the workspace gateway, saves it, sends it, and says why when it cannot', async () => {
    const m = await merchant('glink');
    const o = await order(m.t, { shopId: m.shopId, total: 150000, name: 'Asha Rao' });

    const none = await api
      .as(m.t.admin)
      .post(`/v2/store/orders/${o.uuid}/generate-payment-link`)
      .send({});
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('STORE_GATEWAY_NOT_CONFIGURED');
    expect((await dbOrder(o.id)).payment_link).toBeNull();

    await saveGateway(m.t, 'razorpay', {
      credentials: { key_id: 'rzp_test_1', key_secret: 's', webhook_secret: 'ws' },
    });
    const detail = await get(m.t, `/v2/store/orders/${o.uuid}`);
    expect(detail.body.availableGateways).toEqual([{ slug: 'razorpay', name: 'Razorpay' }]);

    bridgeCalls.length = 0;
    const res = await api
      .as(m.t.admin)
      .post(`/v2/store/orders/${o.uuid}/generate-payment-link`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      url: `https://rzp.fixture.test/l/WAORD-${o.id}`,
      sent: true,
      gateway: 'razorpay',
    });
    const row = await dbOrder(o.id);
    expect(row.payment_link).toBe(`https://rzp.fixture.test/l/WAORD-${o.id}`);
    expect(row.meta_json).toMatchObject({
      gateway_slug: 'razorpay',
      payment_link_id: `plink_WAORD-${o.id}`,
    });
    expect(row.payment_method).toBe('prepaid');
    expect(JSON.stringify(bridgeCalls[0]!.body)).toContain(
      "here's your secure payment link for *₹ 1,500.00*",
    );
    const after = await get(m.t, `/v2/store/orders/${o.uuid}`);
    expect(after.body.paymentStatus).toBe('awaiting');
    expect(after.body.payments[0]).toMatchObject({
      kind: 'payment_link',
      gateway: 'razorpay',
      status: 'awaiting',
    });

    // The gateway refusing the keys is a 502 with a code, and the order is left alone.
    await saveGateway(m.t, 'razorpay', { credentials: { key_id: 'rzp_fail_1' } });
    const o2 = await order(m.t, { shopId: m.shopId, total: 5000 });
    const refused = await api
      .as(m.t.admin)
      .post(`/v2/store/orders/${o2.uuid}/generate-payment-link`)
      .send({});
    expect(refused.status).toBe(502);
    expect(refused.body.code).toBe('STORE_PAYMENT_LINK_FAILED');
    expect((await dbOrder(o2.id)).payment_link).toBeNull();
    // A total under Razorpay's minimum cannot make a link either.
    await saveGateway(m.t, 'razorpay', { credentials: { key_id: 'rzp_test_1' } });
    const tiny = await order(m.t, { shopId: m.shopId, total: 50 });
    expect(
      (await api.as(m.t.admin).post(`/v2/store/orders/${tiny.uuid}/generate-payment-link`).send({}))
        .status,
    ).toBe(502);
  });

  it("a shop override is used for that shop's orders, and the operator can pick another gateway", async () => {
    const m = await merchant('gpick');
    await saveGateway(m.t, 'stripe', {
      credentials: { secret_key: 'sk_test_ws', webhook_secret: 'whsec_ws' },
    });
    await saveGateway(m.t, 'razorpay', {
      storefrontId: m.s.id,
      credentials: { key_id: 'rzp_shop', key_secret: 's' },
    });
    const o = await order(m.t, { shopId: m.shopId, total: 20000 });
    const viaShop = await api
      .as(m.t.admin)
      .post(`/v2/store/orders/${o.uuid}/generate-payment-link`)
      .send({});
    expect(viaShop.body.gateway).toBe('razorpay');
    const viaStripe = await api
      .as(m.t.admin)
      .post(`/v2/store/orders/${o.uuid}/generate-payment-link`)
      .send({ gateway: 'stripe' });
    expect(viaStripe.status, JSON.stringify(viaStripe.body)).toBe(200);
    expect(viaStripe.body).toMatchObject({
      gateway: 'stripe',
      url: 'https://stripe.fixture.test/pay/cs_fixture',
    });
    expect((await dbOrder(o.id)).payment_method).toBe('stripe');
    // A gateway that was not configured, or cannot make a link, is a clear 422.
    const unknown = await api
      .as(m.t.admin)
      .post(`/v2/store/orders/${o.uuid}/generate-payment-link`)
      .send({ gateway: 'paypal' });
    expect(unknown.body.code).toBe('STORE_GATEWAY_NOT_CONFIGURED');
    await saveGateway(m.t, 'payu', { credentials: { merchant_key: 'k', merchant_salt: 's' } });
    const noLink = await api
      .as(m.t.admin)
      .post(`/v2/store/orders/${o.uuid}/generate-payment-link`)
      .send({ gateway: 'payu' });
    expect([noLink.status, noLink.body.code]).toEqual([422, 'STORE_GATEWAY_UNAVAILABLE']);
  });

  it('a verified notification of a workspace gateway settles the order once, and refuses what does not add up', async () => {
    const m = await merchant('ghook');
    const save = await saveGateway(m.t, 'stripe', {
      credentials: { secret_key: 'sk_test_1', webhook_secret: 'whsec_hook' },
    });
    const gwUuid = save.body.id as string;
    const o = await order(m.t, { shopId: m.shopId, total: 30000 });

    // Signed by someone else, unsigned, a bad address, a body that is not a payment.
    expect(
      (
        await gatewayHook(
          gwUuid,
          stripePaid(o.id, 30000),
          stripeSign(stripePaid(o.id, 30000), 'wrong'),
        )
      ).status,
    ).toBe(400);
    expect((await gatewayHook(gwUuid, stripePaid(o.id, 30000), '')).status).toBe(400);
    expect(
      (await gatewayHook('7e57d1b6-0000-4000-8000-000000000000', stripePaid(o.id, 30000))).status,
    ).toBe(404);
    expect((await gatewayHook('nope', stripePaid(o.id, 30000))).status).toBe(404);
    expect((await dbOrder(o.id)).status).toBe('new');
    const other = JSON.stringify({ type: 'charge.refunded', data: { object: {} } });
    const ignored = await gatewayHook(gwUuid, other, stripeSign(other, 'whsec_hook'));
    expect(ignored.body).toEqual({ ok: true, ignored: true });

    // A different amount or currency is not this order's payment.
    const wrongAmount = stripePaid(o.id, 29999);
    const r1 = await gatewayHook(gwUuid, wrongAmount, stripeSign(wrongAmount, 'whsec_hook'));
    expect(r1.body).toEqual({ ok: true, outcome: 'rejected:amount_mismatch' });
    const wrongCurrency = stripePaid(o.id, 30000, 'usd');
    expect(
      (await gatewayHook(gwUuid, wrongCurrency, stripeSign(wrongCurrency, 'whsec_hook'))).body
        .outcome,
    ).toBe('rejected:amount_mismatch');
    expect((await dbOrder(o.id)).status).toBe('new');

    const good = stripePaid(o.id, 30000);
    const done = await gatewayHook(gwUuid, good, stripeSign(good, 'whsec_hook'));
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toEqual({ ok: true, outcome: 'applied' });
    const row = await dbOrder(o.id);
    expect(row.status).toBe('paid');
    expect(row.meta_json).toMatchObject({
      paid_via: 'stripe',
      gateway_slug: 'stripe',
      gateway_payment_id: `pi_${o.id}`,
    });
    const replay = await gatewayHook(gwUuid, good, stripeSign(good, 'whsec_hook'));
    expect(replay.body).toEqual({ ok: true, outcome: 'duplicate' });
    const ev = await api.events(m.t.orgId, 'store.order_paid');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ orderNo: o.id, via: 'stripe', totalMinor: 30000 });
    const detail = (await get(m.t, `/v2/store/orders/${o.uuid}`)).body;
    expect(detail.paymentStatus).toBe('paid');
    expect(detail.payments).toEqual([
      expect.objectContaining({
        kind: 'gateway',
        gateway: 'stripe',
        status: 'paid',
        reference: `pi_${o.id}`,
      }),
    ]);
    expect(detail.timeline.map((t: any) => t.kind)).toContain('paid');

    // A cancelled order is not revived, and a reference that is not ours is ignored.
    const c = await order(m.t, { shopId: m.shopId, total: 30000, status: 'cancelled' });
    const cancelled = stripePaid(c.id, 30000);
    expect(
      (await gatewayHook(gwUuid, cancelled, stripeSign(cancelled, 'whsec_hook'))).body.outcome,
    ).toBe('rejected:order_cancelled');
    const foreign = stripePaid(c.id, 30000).replace(`WAORD-${c.id}`, 'SOMETHING-1');
    expect((await gatewayHook(gwUuid, foreign, stripeSign(foreign, 'whsec_hook'))).body).toEqual({
      ok: true,
      ignored: true,
    });
  });

  it("a gateway can settle only its own workspace's orders, and a shop's own gateway only its shop's", async () => {
    const a = await merchant('gscope-a');
    const b = await merchant('gscope-b');
    const ga = (
      await saveGateway(a.t, 'stripe', {
        credentials: { secret_key: 'sk_a', webhook_secret: 'whsec_a' },
      })
    ).body.id as string;
    const gb = (
      await saveGateway(b.t, 'stripe', {
        credentials: { secret_key: 'sk_b', webhook_secret: 'whsec_b' },
      })
    ).body.id as string;
    const orderA = await order(a.t, { shopId: a.shopId, total: 10000 });

    // B's gateway, correctly signed with B's secret, naming A's order: the order is invisible under row-level security.
    const raw = stripePaid(orderA.id, 10000);
    const cross = await gatewayHook(gb, raw, stripeSign(raw, 'whsec_b'));
    expect(cross.body).toEqual({ ok: true, outcome: 'rejected:order_unknown' });
    // B's secret does not open A's gateway either.
    expect((await gatewayHook(ga, raw, stripeSign(raw, 'whsec_b'))).status).toBe(400);
    expect((await dbOrder(orderA.id)).status).toBe('new');

    // A shop override settles its own shop's orders only.
    const second = await shop(a.t, 'Second shop', a.dev);
    const gShop2 = (
      await saveGateway(a.t, 'stripe', {
        storefrontId: second.id,
        credentials: { secret_key: 'sk_2', webhook_secret: 'whsec_2' },
      })
    ).body.id as string;
    const inShop1 = stripePaid(orderA.id, 10000);
    expect((await gatewayHook(gShop2, inShop1, stripeSign(inShop1, 'whsec_2'))).body.outcome).toBe(
      'rejected:order_not_in_shop',
    );
    expect((await dbOrder(orderA.id)).status).toBe('new');
    expect((await gatewayHook(ga, inShop1, stripeSign(inShop1, 'whsec_a'))).body.outcome).toBe(
      'applied',
    );
  });

  it('a gateway with no signing secret, or switched off, refuses every notification', async () => {
    const m = await merchant('gnosecret');
    const gw = (await saveGateway(m.t, 'stripe', { credentials: { secret_key: 'sk_1' } })).body;
    expect(gw.webhookSecretMissing).toBe(true);
    const o = await order(m.t, { shopId: m.shopId, total: 1000 });
    const raw = stripePaid(o.id, 1000);
    const noSecret = await gatewayHook(gw.id, raw, stripeSign(raw, ''));
    expect(noSecret.status).toBe(403);
    expect(
      noSecret.body.detail ?? noSecret.body.message ?? JSON.stringify(noSecret.body),
    ).toContain('webhook_secret_not_configured');
    await saveGateway(m.t, 'stripe', { credentials: { webhook_secret: 'whsec_x' } });
    await api.as(m.t.admin).post('/v2/store/gateways/stripe/toggle');
    expect((await gatewayHook(gw.id, raw, stripeSign(raw, 'whsec_x'))).status).toBe(404);
    expect((await dbOrder(o.id)).status).toBe('new');
  });
});

// --- coupons ---------------------------------------------------------------------------------------------------------------

describe('coupons', () => {
  it("creates, edits, switches and deletes with Reference's rules", async () => {
    const m = await merchant('coup');
    const create = await api
      .as(m.t.admin)
      .post('/v2/store/coupons')
      .send({
        code: ' save10 ',
        type: 'percent',
        amount: 10,
        minSubtotalMinor: 50000,
        maxDiscountMinor: 20000,
        usageLimit: 3,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    expect(create.body).toMatchObject({
      code: 'SAVE10',
      type: 'percent',
      amount: 10,
      minSubtotalMinor: 50000,
      maxDiscountMinor: 20000,
      freeShipping: false,
      active: true,
      usageLimit: 3,
      usedCount: 0,
      state: 'active',
      storefrontId: null,
      startsAt: null,
    });
    expect(create.body.id).toMatch(/^[0-9a-f-]{36}$/);

    // The code is unique ignoring case, on create and on edit.
    const dup = await api
      .as(m.t.admin)
      .post('/v2/store/coupons')
      .send({ code: 'Save10', type: 'flat', amount: 100 });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('STORE_COUPON_CODE_TAKEN');
    const other = await api
      .as(m.t.admin)
      .post('/v2/store/coupons')
      .send({ code: 'flat100', type: 'flat', amount: 10000, freeShipping: true, active: false });
    expect(other.body).toMatchObject({
      code: 'FLAT100',
      amount: 10000,
      freeShipping: true,
      active: false,
      state: 'inactive',
    });
    const clash = await api
      .as(m.t.admin)
      .put(`/v2/store/coupons/${other.body.id}`)
      .send({ code: 'save10', type: 'flat', amount: 1, rowVersion: other.body.rowVersion });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('STORE_COUPON_CODE_TAKEN');

    // A percentage over 100 is clamped; money is rounded; the whole form is guarded by the row version.
    const edit = await api.as(m.t.admin).put(`/v2/store/coupons/${create.body.id}`).send({
      code: 'SAVE10',
      type: 'percent',
      amount: 150,
      usageLimit: null,
      rowVersion: create.body.rowVersion,
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body).toMatchObject({
      amount: 100,
      usageLimit: null,
      minSubtotalMinor: null,
      maxDiscountMinor: null,
      expiresAt: null,
    });
    const stale = await api.as(m.t.admin).put(`/v2/store/coupons/${create.body.id}`).send({
      code: 'SAVE10',
      type: 'percent',
      amount: 5,
      rowVersion: create.body.rowVersion,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');

    // Switch from the list.
    const off = await api.as(m.t.admin).post(`/v2/store/coupons/${create.body.id}/toggle`);
    expect(off.body).toMatchObject({ active: false, state: 'inactive' });
    expect(
      (await api.as(m.t.admin).post(`/v2/store/coupons/${create.body.id}/toggle`)).body.active,
    ).toBe(true);

    // Search and the state filter.
    const q = async (qs: string) =>
      (await get(m.t, `/v2/store/coupons?${qs}`)).body.data.map((c: any) => c.code);
    expect(await q('')).toEqual(['FLAT100', 'SAVE10']);
    expect(await q('q=save')).toEqual(['SAVE10']);
    expect(await q('q=%25')).toEqual([]);
    expect(await q('state=inactive')).toEqual(['FLAT100']);
    expect(await q('state=active')).toEqual(['SAVE10']);
    expect((await get(m.t, `/v2/store/coupons/${create.body.id}`)).body.code).toBe('SAVE10');

    expect(await api.auditCount(m.t.orgId, 'wa_coupons', 'insert')).toBe(2);
    expect((await api.events(m.t.orgId, 'store.coupon_created')).map((e) => e.code)).toEqual([
      'SAVE10',
      'FLAT100',
    ]);

    const del = await api.as(m.t.admin).delete(`/v2/store/coupons/${other.body.id}`);
    expect(del.status).toBe(204);
    expect((await get(m.t, `/v2/store/coupons/${other.body.id}`)).status).toBe(404);
    expect((await api.as(m.t.admin).delete(`/v2/store/coupons/${other.body.id}`)).status).toBe(404);
  });

  it('refuses a bad code, a negative amount, a zero limit and an end before the start', async () => {
    const t = await api.signup('coupbad');
    const post = (b: object) => api.as(t.admin).post('/v2/store/coupons').send(b);
    const ok = { code: 'OKCODE', type: 'flat', amount: 100 };
    expect((await post({ ...ok, code: 'has space' })).status).toBe(422);
    expect((await post({ ...ok, code: '' })).status).toBe(422);
    expect((await post({ ...ok, type: 'bogus' })).status).toBe(422);
    expect((await post({ ...ok, amount: -1 })).status).toBe(422);
    expect((await post({ ...ok, usageLimit: 0 })).status).toBe(422);
    expect(
      (await post({ ...ok, startsAt: '2026-10-10T00:00:00Z', expiresAt: '2026-10-09T00:00:00Z' }))
        .status,
    ).toBe(422);
    expect(
      (await post({ ...ok, storefrontId: '7e57d1b6-0000-4000-8000-000000000000' })).status,
    ).toBe(422);
    expect((await post(ok)).status).toBe(201);
  });

  it('works with the checkout: the code discounts, is counted, is scoped to its shop, and its orders are listed', async () => {
    const m = await merchant('coupco');
    const second = await shop(m.t, 'Other shop', m.dev);
    const p = await h.owner.query(
      `INSERT INTO wa_products (org_id, name, slug, price_minor, in_stock, status, currency_code) VALUES ($1,'P','p-co',100000,true,'active','INR') RETURNING uuid`,
      [m.t.orgId],
    );
    const checkout = (slug: string, coupon: string) =>
      api
        .http()
        .post(`/v2/store-public/${slug}/checkout`)
        .set('x-forwarded-for', ip())
        .send({
          name: 'Asha',
          phone: '+91 98765 43210',
          coupon,
          items: [{ id: p.rows[0].uuid, qty: 1 }],
        });

    const c = await api
      .as(m.t.admin)
      .post('/v2/store/coupons')
      .send({ code: 'save20', type: 'percent', amount: 20, usageLimit: 2 });
    const shopOnly = await api
      .as(m.t.admin)
      .post('/v2/store/coupons')
      .send({ code: 'only-first', type: 'flat', amount: 5000, storefrontId: m.s.id });
    expect(shopOnly.body).toMatchObject({
      storefrontId: m.s.id,
      storefrontName: 'Media City Threads',
    });

    const first = await checkout(m.slug, 'SAVE20');
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const row = await dbOrder(first.body.orderNo);
    expect(Number(row.discount_minor)).toBe(20000);
    expect(row.coupon_code).toBe('SAVE20');
    expect((await get(m.t, `/v2/store/coupons/${c.body.id}`)).body).toMatchObject({
      usedCount: 1,
      state: 'active',
    });

    // The shop-scoped code works in its shop and is ignored in the other.
    expect(
      Number((await dbOrder((await checkout(m.slug, 'ONLY-FIRST')).body.orderNo)).discount_minor),
    ).toBe(5000);
    expect(
      Number(
        (await dbOrder((await checkout(second.slug, 'ONLY-FIRST')).body.orderNo)).discount_minor,
      ),
    ).toBe(0);

    // The second use exhausts it.
    await checkout(second.slug, 'save20');
    expect((await get(m.t, `/v2/store/coupons/${c.body.id}`)).body).toMatchObject({
      usedCount: 2,
      state: 'exhausted',
    });
    expect(
      (await get(m.t, '/v2/store/coupons?state=exhausted')).body.data.map((x: any) => x.code),
    ).toEqual(['SAVE20']);

    const usages = await get(m.t, `/v2/store/coupons/${c.body.id}/usages`);
    expect(usages.status).toBe(200);
    expect(usages.body.data).toHaveLength(2);
    expect(usages.body.data[0]).toMatchObject({
      customerName: 'Asha',
      discountMinor: 20000,
      totalMinor: expect.any(Number),
      currencyCode: 'INR',
      status: 'new',
    });
    expect(
      (await get(m.t, `/v2/store/coupons/${c.body.id}/usages?limit=1`)).body.page.hasMore,
    ).toBe(true);

    // The orders list shows the coupon on its detail.
    const orders = (await get(m.t, `/v2/store/orders?q=${first.body.orderNo}`)).body.data;
    expect((await get(m.t, `/v2/store/orders/${orders[0].id}`)).body).toMatchObject({
      couponCode: 'SAVE20',
      discountMinor: 20000,
    });
  });

  it('is isolated per workspace', async () => {
    const a = await api.signup('cisoa');
    const b = await api.signup('cisob');
    const made = await api
      .as(a.admin)
      .post('/v2/store/coupons')
      .send({ code: 'SHARED', type: 'flat', amount: 1 });
    expect((await get(b, '/v2/store/coupons')).body.data).toEqual([]);
    expect((await get(b, `/v2/store/coupons/${made.body.id}`)).status).toBe(404);
    expect((await api.as(b.admin).delete(`/v2/store/coupons/${made.body.id}`)).status).toBe(404);
    expect((await api.as(b.admin).post(`/v2/store/coupons/${made.body.id}/toggle`)).status).toBe(
      404,
    );
    // The same code is free in another workspace.
    expect(
      (
        await api
          .as(b.admin)
          .post('/v2/store/coupons')
          .send({ code: 'SHARED', type: 'flat', amount: 1 })
      ).status,
    ).toBe(201);
  });
});

// --- customers -----------------------------------------------------------------------------------------------------------------

describe('customers', () => {
  it('saves by phone, lists by last activity with order totals, searches literally, pages, edits and removes', async () => {
    const m = await merchant('cust');
    const save = (b: object) => api.as(m.t.admin).post('/v2/store/customers').send(b);
    const a = await save({
      phone: '+91 98765 43210',
      name: 'Asha Rao',
      company: 'Acme',
      address: '12 MG Road',
    });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body).toMatchObject({
      phone: '919876543210',
      name: 'Asha Rao',
      company: 'Acme',
      address: '12 MG Road',
      orderCount: 0,
      lifetimeTotals: [],
      lastOrderAt: null,
      contactId: null,
      hasProfile: true,
      hasSavedAddress: true,
    });
    const again = await save({ phone: '919876543210', name: 'Asha R.', company: '', address: '' });
    expect(again.body).toMatchObject({
      id: a.body.id,
      name: 'Asha R.',
      company: null,
      address: null,
    });
    await save({ phone: '919811111111', name: 'Bala' });
    await save({ phone: '919800000000' });
    await save({ phone: '919822222222', name: 'Chitra', company: '50% off co' });
    expect((await save({ phone: 'no digits' })).status).toBe(422);
    expect((await save({ phone: '' })).status).toBe(422);

    // Orders are matched on the digits of the phone, in any formatting; cancelled ones are not counted in the money.
    await order(m.t, { phone: '+91 98765 43210', total: 50000 });
    await order(m.t, { phone: '91-98765-43210', total: 25000, ageHours: 5 });
    await order(m.t, { phone: '919876543210', total: 99999, status: 'cancelled' });
    await order(m.t, { phone: '919876543210', total: 1000, currency: 'USD' });
    await order(m.t, { phone: '919811111111', total: 7000 });

    const list = await get(m.t, '/v2/store/customers');
    expect(list.status).toBe(200);
    // Last activity, newest first: customers nobody ordered with sort by their profile's last change (Chitra, then the unnamed one
    // saved just before her), then the buyers by their latest order (Bala, then Asha).
    expect(list.body.data.map((c: any) => c.name)).toEqual(['Chitra', null, 'Bala', 'Asha R.']);
    const asha = list.body.data[3];
    expect(asha.orderCount).toBe(4);
    expect(asha.lifetimeTotals).toEqual([
      { currencyCode: 'INR', totalMinor: 75000, orders: 2 },
      { currencyCode: 'USD', totalMinor: 1000, orders: 1 },
    ]);
    expect(asha.lastOrderAt).toEqual(expect.any(String));
    expect(list.body.data[2]).toMatchObject({
      orderCount: 1,
      lifetimeTotals: [{ currencyCode: 'INR', totalMinor: 7000, orders: 1 }],
    });
    expect(list.body.data[1]).toMatchObject({ orderCount: 0, lifetimeTotals: [] });

    const q = async (term: string) =>
      (await get(m.t, `/v2/store/customers?q=${encodeURIComponent(term)}`)).body.data.map(
        (c: any) => c.phone,
      );
    expect(await q('asha')).toEqual(['919876543210']);
    expect(await q('98111')).toEqual(['919811111111']);
    expect(await q('acme')).toEqual([]);
    expect(await q('%')).toEqual(['919822222222']);
    expect(await q('50% off')).toEqual(['919822222222']);
    expect(await q('_')).toEqual([]);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 6; i++) {
      const res = await get(m.t, `/v2/store/customers?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((c: any) => c.phone));
      if (!res.body.page.hasMore) break;
      cursor = res.body.page.nextCursor;
    }
    expect(seen).toEqual(['919822222222', '919800000000', '919811111111', '919876543210']);

    const detail = await get(m.t, `/v2/store/customers/${a.body.id}`);
    expect(detail.body.recentOrders).toHaveLength(4);
    expect(detail.body.recentOrders[0]).toMatchObject({
      status: 'new',
      totalMinor: expect.any(Number),
    });

    const edit = await api.as(m.t.admin).put(`/v2/store/customers/${a.body.id}`).send({
      name: 'Asha Rao',
      company: 'Acme Ltd',
      address: 'New address',
      rowVersion: detail.body.rowVersion,
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body).toMatchObject({
      phone: '919876543210',
      name: 'Asha Rao',
      company: 'Acme Ltd',
      address: 'New address',
      orderCount: 4,
    });
    const stale = await api
      .as(m.t.admin)
      .put(`/v2/store/customers/${a.body.id}`)
      .send({ name: 'X', rowVersion: detail.body.rowVersion });
    expect(stale.status).toBe(409);

    // Removing a customer keeps their orders.
    expect((await api.as(m.t.admin).delete(`/v2/store/customers/${a.body.id}`)).status).toBe(204);
    expect((await get(m.t, `/v2/store/customers/${a.body.id}`)).status).toBe(404);
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int n FROM wa_orders WHERE org_id = $1 AND customer_phone LIKE '%98765%'`,
          [m.t.orgId],
        )
      ).rows[0].n,
    ).toBe(4);
    expect(await api.auditCount(m.t.orgId, 'wa_customer_profiles', 'delete')).toBe(1);
  });

  it('shows the linked CRM contact, and is isolated per workspace', async () => {
    const a = await api.signup('custlink');
    const b = await api.signup('custiso');
    const [contact] = await api.seedContacts(a, [{ name: 'Linked Buyer', phone: '+919800001111' }]);
    const made = await api
      .as(a.admin)
      .post('/v2/store/customers')
      .send({ phone: '919800001111', name: 'Linked Buyer' });
    await h.owner.query(
      `UPDATE wa_customer_profiles SET contact_id = (SELECT id FROM contacts WHERE uuid = $1) WHERE uuid = $2`,
      [contact, made.body.id],
    );
    expect((await get(a, `/v2/store/customers/${made.body.id}`)).body.contactId).toBe(contact);
    expect((await get(b, '/v2/store/customers')).body.data).toEqual([]);
    expect((await get(b, `/v2/store/customers/${made.body.id}`)).status).toBe(404);
    expect((await api.as(b.admin).delete(`/v2/store/customers/${made.body.id}`)).status).toBe(404);
    expect(
      (await api.as(b.admin).put(`/v2/store/customers/${made.body.id}`).send({ name: 'x' })).status,
    ).toBe(404);
    // The same phone is a different customer in another workspace.
    expect(
      (await api.as(b.admin).post('/v2/store/customers').send({ phone: '919800001111' })).body.id,
    ).not.toBe(made.body.id);
  });
});

// --- groups ----------------------------------------------------------------------------------------------------------------

describe('groups', () => {
  it('lists the directory most recently synced first, searches the subject, summarises, and manages ordering codes', async () => {
    const m = await merchant('grp');
    const g = async (jid: string, subject: string | null, hoursAgo: number | null, code?: string) =>
      (
        await h.owner.query(
          `INSERT INTO wa_groups (org_id, group_jid, subject, size, device_phone, group_code, synced_at)
           VALUES ($1,$2,$3,12,'919812345678',$4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() - ($5 || ' hours')::interval END) RETURNING uuid`,
          [m.t.orgId, jid, subject, code ?? null, hoursAgo],
        )
      ).rows[0].uuid as string;
    const a = await g('1@g.us', 'Wholesale buyers', 1);
    const b = await g('2@g.us', 'Family', 2, 'FAM');
    const c = await g('3@g.us', 'Neighbours', 3);
    const d = await g('4@g.us', null, null);

    const list = await get(m.t, '/v2/store/groups');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(ids(list)).toEqual([a, b, c, d]);
    expect(list.body.data[1]).toEqual({
      id: b,
      jid: '2@g.us',
      subject: 'Family',
      size: 12,
      devicePhone: '919812345678',
      groupCode: 'FAM',
      syncedAt: expect.any(String),
      rowVersion: expect.any(Number),
    });
    expect(ids(await get(m.t, `/v2/store/groups?q=${encodeURIComponent('neigh')}`))).toEqual([c]);
    expect(ids(await get(m.t, '/v2/store/groups?q=%25'))).toEqual([]);
    const p1 = await get(m.t, '/v2/store/groups?limit=3');
    expect(p1.body.page.hasMore).toBe(true);
    const p2 = await get(m.t, `/v2/store/groups?limit=3&cursor=${p1.body.page.nextCursor}`);
    expect([...ids(p1), ...ids(p2)]).toEqual([a, b, c, d]);

    expect((await get(m.t, '/v2/store/groups/summary')).body).toEqual({
      total: 4,
      coded: 1,
      botNumber: '919812345678',
    });

    const set = await api
      .as(m.t.admin)
      .put(`/v2/store/groups/${a}/code`)
      .send({ groupCode: ' wholesale.1 ' });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.groupCode).toBe('wholesale.1');
    const taken = await api
      .as(m.t.admin)
      .put(`/v2/store/groups/${c}/code`)
      .send({ groupCode: 'FAM' });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('STORE_GROUP_CODE_TAKEN');
    // The same group may keep its own code; a blank clears it.
    expect(
      (await api.as(m.t.admin).put(`/v2/store/groups/${b}/code`).send({ groupCode: 'FAM' })).status,
    ).toBe(200);
    const cleared = await api
      .as(m.t.admin)
      .put(`/v2/store/groups/${b}/code`)
      .send({ groupCode: '' });
    expect(cleared.body.groupCode).toBeNull();
    expect(
      (await api.as(m.t.admin).put(`/v2/store/groups/${b}/code`).send({ groupCode: null })).body
        .groupCode,
    ).toBeNull();
    expect((await get(m.t, '/v2/store/groups/summary')).body.coded).toBe(1);
    // Bad characters, too long, and a stale version.
    expect(
      (await api.as(m.t.admin).put(`/v2/store/groups/${c}/code`).send({ groupCode: 'bad code!' }))
        .status,
    ).toBe(422);
    expect(
      (
        await api
          .as(m.t.admin)
          .put(`/v2/store/groups/${c}/code`)
          .send({ groupCode: 'x'.repeat(49) })
      ).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(m.t.admin)
          .put(`/v2/store/groups/${c}/code`)
          .send({ groupCode: 'OK', rowVersion: 999 })
      ).status,
    ).toBe(409);
    expect(
      (
        await api
          .as(m.t.admin)
          .put('/v2/store/groups/7e57d1b6-0000-4000-8000-000000000000/code')
          .send({ groupCode: 'A' })
      ).status,
    ).toBe(404);
    expect(await api.auditCount(m.t.orgId, 'wa_groups', 'update')).toBeGreaterThanOrEqual(3);

    // Another workspace sees nothing and can use the same code.
    const other = await api.signup('grpiso');
    expect((await get(other, '/v2/store/groups')).body.data).toEqual([]);
    expect((await get(other, '/v2/store/groups/summary')).body).toEqual({
      total: 0,
      coded: 0,
      botNumber: null,
    });
    expect((await get(other, `/v2/store/groups/${a}`)).status).toBe(404);
    expect(
      (await api.as(other.admin).put(`/v2/store/groups/${a}/code`).send({ groupCode: 'X' })).status,
    ).toBe(404);
  });
});

// --- payments --------------------------------------------------------------------------------------------------------------

describe('payments overview and WhatsApp Pay', () => {
  it('lists the money side of the orders, filters it, and sums it', async () => {
    const m = await merchant('pay');
    const paid = await order(m.t, {
      status: 'paid',
      total: 100000,
      shopId: m.shopId,
      meta: { paid_via: 'razorpay_link', razorpay_payment: 'pay_1' },
      method: 'prepaid',
      ageHours: 1,
    });
    const stripe = await order(m.t, {
      status: 'paid',
      total: 50000,
      method: 'stripe',
      meta: { paid_via: 'stripe', gateway_payment_id: 'pi_9' },
      ageHours: 2,
    });
    const awaiting = await order(m.t, { link: 'https://pay.example/z', total: 30000, ageHours: 3 });
    const cod = await order(m.t, { method: 'cod', total: 20000, ageHours: 4 });
    const unpaid = await order(m.t, { total: 10000, ageHours: 5 });
    const usd = await order(m.t, { status: 'paid', total: 4000, currency: 'USD', ageHours: 6 });

    const list = await get(m.t, '/v2/store/payments');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data.map((p: any) => p.orderNo)).toEqual([
      paid.id,
      stripe.id,
      awaiting.id,
      cod.id,
      usd.id,
    ]);
    expect(list.body.data[0]).toEqual({
      orderId: paid.uuid,
      orderNo: paid.id,
      customerName: 'Asha Rao',
      customerPhone: '+91 98765 43210',
      status: 'paid',
      method: 'prepaid',
      paidVia: 'razorpay_link',
      reference: 'pay_1',
      waPaymentStatus: null,
      paymentLink: null,
      amountMinor: 100000,
      currencyCode: 'INR',
      storefrontName: 'Media City Threads',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(list.body.data[1]).toMatchObject({
      method: 'stripe',
      paidVia: 'stripe',
      reference: 'pi_9',
    });
    const q = async (qs: string) =>
      (await get(m.t, `/v2/store/payments?${qs}`)).body.data.map((p: any) => p.orderNo);
    expect(await q('status=paid')).toEqual([paid.id, stripe.id, usd.id]);
    expect(await q('status=awaiting')).toEqual([awaiting.id]);
    expect(await q('status=unpaid')).toEqual([unpaid.id]);
    expect(await q('method=stripe')).toEqual([stripe.id]);
    expect(await q('method=cod')).toEqual([cod.id]);
    // `#<number>` finds the order by its number (a bare number also matches phones that contain it, as in Reference).
    expect(await q(`q=%23${paid.id}`)).toEqual([paid.id]);
    expect((await get(m.t, '/v2/store/payments?limit=2')).body.page.hasMore).toBe(true);
    expect((await get(m.t, '/v2/store/payments?status=bogus')).status).toBe(422);

    const summary = (await get(m.t, '/v2/store/payments/summary')).body;
    expect(summary).toMatchObject({ paid: 3, awaiting: 1, cod: 1, unpaid: 1 });
    expect(summary.collected).toEqual(
      expect.arrayContaining([
        { currencyCode: 'INR', totalMinor: 150000 },
        { currencyCode: 'USD', totalMinor: 4000 },
      ]),
    );

    const other = await api.signup('payiso');
    expect((await get(other, '/v2/store/payments')).body.data).toEqual([]);
    expect((await get(other, '/v2/store/payments/summary')).body).toMatchObject({
      paid: 0,
      awaiting: 0,
      cod: 0,
      unpaid: 0,
      collected: [],
    });
  });

  it('keeps the WhatsApp Pay configurations: create or update by name, India only, delete', async () => {
    const t = await api.signup('wapay');
    const other = await api.signup('wapay2');
    expect((await get(t, '/v2/store/payments/whatsapp-pay')).body.data).toEqual([]);
    const put = (b: object) => api.as(t.admin).put('/v2/store/payments/whatsapp-pay').send(b);
    const a = await put({ configName: 'Main Razorpay', paymentType: 'razorpay', autoCharge: true });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body).toMatchObject({
      configName: 'Main Razorpay',
      paymentType: 'razorpay',
      country: 'IN',
      currency: 'INR',
      isActive: true,
      autoCharge: true,
    });
    const again = await put({ configName: 'Main Razorpay', paymentType: 'payu', isActive: false });
    expect(again.body).toMatchObject({
      id: a.body.id,
      paymentType: 'payu',
      isActive: false,
      autoCharge: false,
    });
    await put({ configName: 'Second', paymentType: 'billdesk' });
    expect(
      (await get(t, '/v2/store/payments/whatsapp-pay')).body.data.map((c: any) => c.configName),
    ).toEqual(['Second', 'Main Razorpay']);
    expect((await put({ configName: 'x', paymentType: 'paypal' })).status).toBe(422);
    expect((await put({ configName: '', paymentType: 'razorpay' })).status).toBe(422);
    expect((await put({ configName: 'x'.repeat(61), paymentType: 'razorpay' })).status).toBe(422);
    expect((await get(other, '/v2/store/payments/whatsapp-pay')).body.data).toEqual([]);
    expect(
      (await api.as(other.admin).delete(`/v2/store/payments/whatsapp-pay/${a.body.id}`)).status,
    ).toBe(404);
    expect(
      (await api.as(t.admin).delete(`/v2/store/payments/whatsapp-pay/${a.body.id}`)).status,
    ).toBe(204);
    expect(
      (await api.as(t.admin).delete(`/v2/store/payments/whatsapp-pay/${a.body.id}`)).status,
    ).toBe(404);
    expect((await get(t, '/v2/store/payments/whatsapp-pay')).body.data).toHaveLength(1);
  });
});

// --- Razorpay links settled through the shared gateway, and Sales invoices on the same gateway -------------------------------

const rzpHook = (gatewayUuid: string, raw: string, secret: string) =>
  api
    .http()
    .post(`/v2/store-public/webhooks/gateway/${gatewayUuid}`)
    .set('x-forwarded-for', ip())
    .set('content-type', 'application/json')
    .set('x-razorpay-signature', signRazorpayBody(raw, secret))
    .send(raw);
const linkPaid = (reference: string, amount: number, currency = 'INR') =>
  JSON.stringify({
    event: 'payment_link.paid',
    payload: {
      payment_link: {
        entity: {
          id: 'plink_x',
          reference_id: reference,
          short_url: 'https://rzp.io/i/z',
          amount,
          currency,
        },
      },
      payment: { entity: { id: 'pay_x' } },
    },
  });

describe('a Razorpay link made on the workspace gateway is settled by the gateway webhook', () => {
  it('marks a store order paid from payment_link.paid, with the same guards', async () => {
    const m = await merchant('grzp');
    const gw = (
      await saveGateway(m.t, 'razorpay', {
        credentials: { key_id: 'rzp_test_1', key_secret: 's', webhook_secret: 'rzp-hook' },
      })
    ).body.id as string;
    const o = await order(m.t, { shopId: m.shopId, total: 75000 });
    const made = await api
      .as(m.t.admin)
      .post(`/v2/store/orders/${o.uuid}/generate-payment-link`)
      .send({});
    expect(made.status, JSON.stringify(made.body)).toBe(200);

    const raw = linkPaid(`WAORD-${o.id}`, 75000);
    expect((await rzpHook(gw, raw, 'wrong')).status).toBe(400);
    expect((await dbOrder(o.id)).status).toBe('new');
    expect((await rzpHook(gw, linkPaid(`WAORD-${o.id}`, 1), 'rzp-hook')).body.outcome).toBe(
      'rejected:amount_mismatch',
    );
    const done = await rzpHook(gw, raw, 'rzp-hook');
    expect(done.body).toEqual({ ok: true, outcome: 'applied' });
    expect((await dbOrder(o.id)).meta_json).toMatchObject({
      paid_via: 'razorpay',
      gateway_payment_id: 'pay_x',
    });
    expect((await rzpHook(gw, raw, 'rzp-hook')).body.outcome).toBe('duplicate');
    // The checkout event (payment.captured) with no reference of ours changes nothing.
    const captured = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_y', amount: 1, currency: 'INR', notes: {} } } },
    });
    expect((await rzpHook(gw, captured, 'rzp-hook')).body).toEqual({ ok: true, ignored: true });
  });
});

describe('Sales invoices use the workspace gateway first', () => {
  const invoice = async (t: Tenant, body: Record<string, unknown> = {}) => {
    const made = await api
      .as(t.admin)
      .post('/v2/invoices')
      .send({
        buyerName: 'Acme Ltd',
        currency: 'USD',
        lines: [{ description: 'Consulting', qty: '2', unitPrice: '50.00' }],
        ...body,
      });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const issued = await api.as(t.admin).post(`/v2/invoices/${made.body.id}/issue`).send({});
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    return issued.body as { id: string; publicLink: { token: string } };
  };
  const pay = (token: string, body: object = {}) =>
    api.http().post(`/v2/public/invoices/${token}/pay`).set('x-forwarded-for', ip()).send(body);
  const attemptRow = async (uuid: string) =>
    (await h.owner.query(`SELECT * FROM invoice_payment_attempts WHERE uuid = $1`, [uuid])).rows[0];
  const paymentStatus = async (t: Tenant, id: string) =>
    (await get(t, `/v2/invoices/${id}`)).body.paymentStatus as string;

  it('without any gateway the page is as it was (unavailable with no bank details)', async () => {
    const t = await api.signup('invnone');
    const inv = await invoice(t);
    const res = await pay(inv.publicLink.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ kind: 'unavailable', attemptId: null, url: null });
  });

  it('opens an attempt on the shared gateway, makes the hosted link, and a verified notification records the payment once', async () => {
    const t = await api.signup('invstripe');
    const gw = (
      await saveGateway(t, 'stripe', {
        credentials: { secret_key: 'sk_test_1', webhook_secret: 'whsec_inv' },
      })
    ).body.id as string;
    const inv = await invoice(t);

    const res = await pay(inv.publicLink.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'redirect',
      url: 'https://stripe.fixture.test/pay/cs_fixture',
      amount: '100.00',
      currency: 'USD',
    });
    const attempt = await attemptRow(res.body.attemptId);
    expect(attempt).toMatchObject({
      provider: 'stripe',
      connection_id: null,
      status: 'pending',
      checkout_url: 'https://stripe.fixture.test/pay/cs_fixture',
      external_id: 'cs_fixture',
    });
    expect(Number(attempt.amount_minor)).toBe(10000);

    // Money that does not add up is refused and kept on the trail; the invoice stays open.
    const wrong = stripePaid(0, 9999, 'usd').replace('WAORD-0', `INV-${res.body.attemptId}`);
    const bad = await gatewayHook(gw, wrong, stripeSign(wrong, 'whsec_inv'));
    expect(bad.body).toEqual({ ok: true, outcome: 'rejected:amount_mismatch' });
    expect(await paymentStatus(t, inv.id)).not.toBe('paid');
    expect((await api.events(t.orgId, 'payment.rejected'))[0]).toMatchObject({
      reason: 'amount_or_currency_mismatch',
      gateway: 'stripe',
    });
    // A notification that names no amount is refused too: these are the books.
    const noAmount = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          client_reference_id: `INV-${res.body.attemptId}`,
          payment_status: 'paid',
          payment_intent: 'pi_a',
        },
      },
    });
    expect((await gatewayHook(gw, noAmount, stripeSign(noAmount, 'whsec_inv'))).body.outcome).toBe(
      'rejected:amount_mismatch',
    );

    const good = stripePaid(0, 10000, 'usd')
      .replace('WAORD-0', `INV-${res.body.attemptId}`)
      .replace('pi_0', 'pi_inv1');
    const ok = await gatewayHook(gw, good, stripeSign(good, 'whsec_inv'));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ ok: true, outcome: 'applied' });
    expect(await paymentStatus(t, inv.id)).toBe('paid');
    expect((await attemptRow(res.body.attemptId)).status).toBe('succeeded');
    const ledger = (await get(t, `/v2/payments?invoiceId=${inv.id}`)).body.data;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ method: 'gateway', source: 'gateway' });
    expect((await gatewayHook(gw, good, stripeSign(good, 'whsec_inv'))).body.outcome).toBe(
      'duplicate',
    );
    expect((await get(t, `/v2/payments?invoiceId=${inv.id}`)).body.data).toHaveLength(1);
    // Nothing left to pay.
    expect((await pay(inv.publicLink.token)).status).toBe(409);
  });

  it('makes a Razorpay payment link for an invoice and settles it from payment_link.paid', async () => {
    const t = await api.signup('invrzp');
    const gw = (
      await saveGateway(t, 'razorpay', {
        credentials: { key_id: 'rzp_test_1', key_secret: 's', webhook_secret: 'rzp-inv' },
      })
    ).body.id as string;
    const inv = await invoice(t, { currency: 'INR' });
    const res = await pay(inv.publicLink.token, { amount: '40.00' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'redirect',
      url: `https://rzp.fixture.test/l/INV-${res.body.attemptId}`,
      amount: '40.00',
    });
    expect((await attemptRow(res.body.attemptId)).provider).toBe('razorpay');
    const done = await rzpHook(gw, linkPaid(`INV-${res.body.attemptId}`, 4000), 'rzp-inv');
    expect(done.body).toEqual({ ok: true, outcome: 'applied' });
    expect(await paymentStatus(t, inv.id)).toBe('partially_paid');
  });

  it('when the gateway cannot make a link the attempt is closed and the buyer is never left at a dead end', async () => {
    const t = await api.signup('invfail');
    await saveGateway(t, 'stripe', {
      credentials: { secret_key: 'sk_fail_1', webhook_secret: 'whsec_x' },
    });
    const inv = await invoice(t);
    const res = await pay(inv.publicLink.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.kind).toBe('unavailable');
    expect(
      (
        await h.owner.query(`SELECT status FROM invoice_payment_attempts WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows.map((r) => r.status),
    ).toEqual(['failed']);
  });

  it('an attempt can be settled only by the gateway it was made on, and only in its own workspace', async () => {
    const a = await api.signup('invscope-a');
    const b = await api.signup('invscope-b');
    const gStripe = (
      await saveGateway(a, 'stripe', {
        credentials: { secret_key: 'sk_a', webhook_secret: 'whsec_a' },
      })
    ).body.id as string;
    const gRzp = (
      await saveGateway(a, 'razorpay', {
        credentials: { key_id: 'rzp_a', key_secret: 's', webhook_secret: 'rzp-a' },
      })
    ).body.id as string;
    const gB = (
      await saveGateway(b, 'stripe', {
        credentials: { secret_key: 'sk_b', webhook_secret: 'whsec_b' },
      })
    ).body.id as string;
    // Stripe is the one invoices use here.
    await api.as(a.admin).post('/v2/store/gateways/stripe/default');
    const inv = await invoice(a);
    const res = await pay(inv.publicLink.token);
    expect(res.body.kind).toBe('redirect');
    const attemptId = res.body.attemptId as string;
    const raw = stripePaid(0, 10000, 'usd').replace('WAORD-0', `INV-${attemptId}`);

    // Another gateway of the same workspace cannot settle a Stripe attempt, and another workspace's gateway cannot see it.
    expect(
      (await rzpHook(gRzp, linkPaid(`INV-${attemptId}`, 10000, 'USD'), 'rzp-a')).body.outcome,
    ).toBe('rejected:attempt_unknown');
    expect((await gatewayHook(gB, raw, stripeSign(raw, 'whsec_b'))).body.outcome).toBe(
      'rejected:attempt_unknown',
    );
    expect(await paymentStatus(a, inv.id)).not.toBe('paid');
    expect((await gatewayHook(gStripe, raw, stripeSign(raw, 'whsec_a'))).body.outcome).toBe(
      'applied',
    );
    expect(await paymentStatus(a, inv.id)).toBe('paid');
  });
});
