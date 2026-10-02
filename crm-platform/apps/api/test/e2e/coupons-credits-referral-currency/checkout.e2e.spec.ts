import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyCouponResponseSchema, ERROR_CODES, placeOrderResponseSchema } from '@crm/contracts';
import { FulfilmentService } from '../../../src/modules/platform-payment-gateways/fulfilment.service';
import { OrdersRepository } from '../../../src/modules/platform-payment-gateways/orders.repository';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  TEST_COUPON_PREFIX as P,
  TEST_PLAN_PREFIX,
  activateStripe,
  as,
  cleanCpn,
  newTenant,
  ops,
  pay,
  setting,
  startBspHarness,
  stripeThatPays,
  type BspHarness,
  type Tenant,
} from './support';

/**
 * Coupons at checkout (TW-CPN-006, 007, 008) end to end through HTTP: the preview, the binding application on the order, the
 * redemption counted once on the paid transition. Only the far end of Stripe is faked (global fetch).
 */
let h: BspHarness;
let buyer: Tenant;
let stripeId: string;
let savedCatalog: Array<Record<string, unknown>> = [];
const PLAN = `${TEST_PLAN_PREFIX}growth`;
const PLAN2 = `${TEST_PLAN_PREFIX}pro`;
const SETTING_KEYS = ['checkout.tax_enabled', 'checkout.tax_rate', 'checkout.tax_label'];

afterEach(() => vi.restoreAllMocks());

const coupon = async (over: Record<string, unknown> = {}) => {
  const res = await ops(h, 'post', '/coupons').send({
    code: `${P}WELCOME10`,
    type: 'percent',
    amount: '10',
    isActive: true,
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; code: string; rowVersion: number };
};
const preview = (
  code: string,
  body: Record<string, unknown> = {},
  token = buyer.admin,
  plan = PLAN,
) => as(h, token, 'post', `billing/checkout/plans/${plan}/coupon`).send({ code, ...body });
const place = (body: Record<string, unknown>, token = buyer.admin, plan = PLAN) =>
  as(h, token, 'post', `billing/checkout/plans/${plan}/orders`)
    .set('idempotency-key', `cpn-${Math.random().toString(36).slice(2)}`)
    .send({ gatewayId: stripeId, ...body });
const orderBy = async (n: string) =>
  (await h.owner.query(`SELECT * FROM orders WHERE order_number = $1`, [n])).rows[0];
const uses = async (code: string) =>
  Number(
    (await h.owner.query(`SELECT uses_count FROM coupons WHERE code = $1`, [code])).rows[0]
      .uses_count,
  );
const orderCount = async (org: number) =>
  Number(
    (await h.owner.query(`SELECT count(*)::int AS n FROM orders WHERE org_id = $1`, [org])).rows[0]
      .n,
  );

const payOrder = (orderNumber: string) => pay(h, orderNumber);

beforeAll(async () => {
  h = await startBspHarness();
  await cleanCpn(h);
  buyer = await newTenant(h, 'cpnbuy');
  savedCatalog = (await h.owner.query(`SELECT * FROM currencies`)).rows;
  await h.owner.query(`TRUNCATE currencies`);
  await h.owner.query(
    `INSERT INTO currencies (name, code, symbol, "precision", exchange_rate, is_active) VALUES
       ('US Dollar','USD','$',2,1,true), ('Indian Rupee','INR','₹',2,80,true)`,
  );
  await setting(h, 'checkout.tax_enabled', true);
  await setting(h, 'checkout.tax_rate', 18);
  await setting(h, 'checkout.tax_label', 'GST');
  for (const [slug, amount] of [
    [PLAN, '100'],
    [PLAN2, '200'],
  ] as const) {
    const p = await ops(h, 'post', '/plans').send({ name: slug, slug, amount, currency: 'USD' });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
  }
  stripeId = await activateStripe(h);
}, 180_000);

afterAll(async () => {
  await cleanCpn(h);
  await h.owner.query(`DELETE FROM orders WHERE org_id = $1`, [buyer.orgId]);
  await h.owner.query(`TRUNCATE currencies`);
  for (const r of savedCatalog) {
    await h.owner.query(
      `INSERT INTO currencies (name, code, symbol, "precision", exchange_rate, is_active) VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.name, r.code, r.symbol, r.precision, r.exchange_rate, r.is_active],
    );
  }
  await h.owner.query(`DELETE FROM platform_settings WHERE key = ANY($1)`, [SETTING_KEYS]);
  await h.stop();
});

describe('TW-CPN-007 the Apply button (preview)', () => {
  it('prices the plan itself: 10% off 100 with 18% tax is discount 10.00, tax 16.20, total 106.20', async () => {
    await coupon();
    const res = await preview('cpntwelcome10');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(applyCouponResponseSchema.parse(res.body)).toEqual({
      ok: true,
      message: 'Coupon applied.',
      discount: '10.00',
      code: `${P}WELCOME10`,
      currency: 'USD',
      subtotal: '100.00',
      tax: '16.20',
      total: '106.20',
    });
  });

  it('ignores any amount the browser sends (Reference trusted it)', async () => {
    const res = await preview(`${P}WELCOME10`, { amount: '1', subtotal: '1', total: '1' });
    expect(res.body).toMatchObject({ ok: true, discount: '10.00', total: '106.20' });
  });

  it('answers a rejection as ok:false with the reason, discount cleared, summary unchanged', async () => {
    const res = await preview(`${P}NOSUCH`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: false,
      message: `Coupon "${P}NOSUCH" not recognised.`,
      discount: '0.00',
      code: null,
      subtotal: '100.00',
      tax: '18.00',
      total: '118.00',
    });
    expect((await preview('   ')).body).toMatchObject({
      ok: false,
      message: 'Enter a coupon code.',
    });
  });

  it('applies each rule at the checkout: window, disabled, cap, currency lock, minimum, plan restriction', async () => {
    const msg = async (over: Record<string, unknown>, body: Record<string, unknown> = {}) => {
      const c = await coupon({
        code: `${P}R${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        ...over,
      });
      return (await preview(c.code, body)).body.message as string;
    };
    expect(await msg({ expiresAt: '2020-01-01T00:00:00Z' })).toBe('This coupon has expired.');
    expect(await msg({ startsAt: '2099-01-01T00:00:00Z' })).toBe('This coupon is not active yet.');
    expect(await msg({ isActive: false })).toBe('This coupon is disabled.');
    expect(await msg({ currencyCode: 'inr' })).toBe(
      'This coupon is only valid for payments in INR.',
    );
    expect(await msg({ minOrderAmount: '500' })).toBe('Order is below the coupon minimum.');
    expect(await msg({ applicablePlanSlugs: [PLAN2] })).toBe(
      'This coupon does not apply to this plan.',
    );
    // 20% capped at 5: the cap wins
    const capped = await coupon({ code: `${P}CAP`, amount: '20', maxDiscountAmount: '5' });
    expect((await preview(capped.code)).body).toMatchObject({
      discount: '5.00',
      tax: '17.10',
      total: '112.10',
    });
    // fixed 500 on a 100 plan: never more than the order, and a free order has no tax
    const big = await coupon({ code: `${P}BIG`, type: 'fixed', amount: '500' });
    expect((await preview(big.code)).body).toMatchObject({
      discount: '100.00',
      tax: '0.00',
      total: '0.00',
    });
  });

  it('prices in the currency the buyer chose: an INR-locked coupon passes on an INR order', async () => {
    const c = await coupon({ code: `${P}INR`, type: 'fixed', amount: '800', currencyCode: 'INR' });
    const usd = await preview(c.code);
    expect(usd.body.message).toBe('This coupon is only valid for payments in INR.');
    const inr = await preview(c.code, { currency: 'INR' });
    expect(inr.body).toMatchObject({
      ok: true,
      currency: 'INR',
      discount: '800.00',
      subtotal: '8000.00',
      tax: '1296.00',
      total: '8496.00',
    });
  });

  it('is refused for an unknown plan and without a session', async () => {
    expect((await preview(`${P}WELCOME10`, {}, buyer.admin, 'cpnt_missing')).status).toBe(404);
    expect(
      (await h.api.http().post(`/v2/billing/checkout/plans/${PLAN}/coupon`).send({ code: 'x' }))
        .status,
    ).toBe(401);
    expect((await preview(`${P}WELCOME10`, { code: 'x'.repeat(65) })).status).toBe(422);
  });

  it('is throttled per member (a code cannot be enumerated), the counter is not shared with another workspace', async () => {
    const other = await newTenant(h, 'cpnthrottle');
    let throttled: number | undefined;
    for (let i = 0; i < 25; i++) {
      const r = await preview(`${P}GUESS${i}`, {}, other.admin);
      if (r.status === 429) {
        throttled = i;
        expect(r.body.code).toBe(ERROR_CODES.CPN_COUPON_THROTTLED);
        break;
      }
    }
    expect(throttled).toBe(20);
    expect((await preview(`${P}WELCOME10`, {}, buyer.admin)).status).toBe(201);
  });
});

describe('TW-CPN-008 binding application and redemption counting', () => {
  it('creates the order with discount, tax, total and the code snapshot, and does NOT count a use while pending', async () => {
    stripeThatPays();
    const res = await place({ coupon: ` ${P.toLowerCase()}welcome10 ` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const o = await orderBy(placeOrderResponseSchema.parse(res.body).orderNumber);
    expect(o).toMatchObject({ status: 'pending', coupon_code: `${P}WELCOME10`, currency: 'USD' });
    expect(Number(o.discount_amount)).toBe(10);
    expect(Number(o.tax_amount)).toBe(16.2);
    expect(Number(o.total_amount)).toBe(106.2);
    expect(Number(o.amount)).toBe(106.2);
    expect(o.coupon_id).not.toBeNull();
    expect(await uses(`${P}WELCOME10`)).toBe(0);
  });

  it('charges the discounted total at the gateway', async () => {
    let amount = 0;
    stripeThatPays();
    const spy = vi.mocked(globalThis.fetch);
    const res = await place({ coupon: `${P}WELCOME10` });
    expect(res.status).toBe(201);
    for (const call of spy.mock.calls) {
      const init = call[1];
      if (init?.method === 'POST')
        amount = Number(
          new URLSearchParams(String(init.body)).get('line_items[0][price_data][unit_amount]'),
        );
    }
    expect(amount).toBe(10620);
  });

  it('a paid order counts one redemption; the return replayed, or the order finalized again, never counts twice', async () => {
    stripeThatPays();
    const before = await uses(`${P}WELCOME10`);
    const placed = placeOrderResponseSchema.parse((await place({ coupon: `${P}WELCOME10` })).body);
    await payOrder(placed.orderNumber);
    expect(await uses(`${P}WELCOME10`)).toBe(before + 1);
    await payOrder(placed.orderNumber);
    await payOrder(placed.orderNumber);
    expect(await uses(`${P}WELCOME10`)).toBe(before + 1);
    const row = await orderBy(placed.orderNumber);
    expect(row.status).toBe('paid');
    expect(
      await h.owner
        .query(
          `SELECT count(*)::int AS n FROM event_outbox WHERE aggregate_module = 'orders' AND aggregate_id = $1 AND event_type = 'paygw.order.paid'`,
          [row.id],
        )
        .then((r) => r.rows[0].n),
    ).toBe(1);
  });

  it('refuses a rejected code at submit: 422 with the reason, and no order row', async () => {
    stripeThatPays();
    const n = await orderCount(buyer.orgId);
    for (const [code, reason] of [
      [`${P}NOSUCH`, `Coupon "${P}NOSUCH" not recognised.`],
      [`${P}BIG2`, 'This coupon does not apply to this plan.'],
    ] as const) {
      if (code === `${P}BIG2`) await coupon({ code, applicablePlanSlugs: [PLAN2] });
      const res = await place({ coupon: code });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ERROR_CODES.CPN_COUPON_REJECTED);
      expect(res.body.detail).toBe(reason);
    }
    expect(await orderCount(buyer.orgId)).toBe(n);
  });

  it('a coupon that was disabled after the order was placed still counts at payment (no re-validation, Reference parity)', async () => {
    stripeThatPays();
    const c = await coupon({ code: `${P}LATE` });
    const placed = placeOrderResponseSchema.parse((await place({ coupon: c.code })).body);
    await ops(h, 'put', `/coupons/${c.id}/active`).send({ value: false });
    await payOrder(placed.orderNumber);
    expect(await uses(c.code)).toBe(1);
  });

  it('two buyers can both hold the last use before either pays (no reservation, documented), and both paid orders count', async () => {
    stripeThatPays();
    const c = await coupon({ code: `${P}LAST`, maxUses: 1 });
    const other = await newTenant(h, 'cpnlast');
    const a = placeOrderResponseSchema.parse((await place({ coupon: c.code })).body);
    const b = placeOrderResponseSchema.parse((await place({ coupon: c.code }, other.admin)).body);
    await payOrder(a.orderNumber);
    await payOrder(b.orderNumber);
    expect(await uses(c.code)).toBe(2);
    // once the cap is reached the resolver refuses further orders
    expect((await preview(c.code)).body.message).toBe('This coupon is fully used.');
  });

  it('first purchase only: refused once the buyer has any paid order; accepted for a buyer with none', async () => {
    const c = await coupon({ code: `${P}FIRST`, firstPurchaseOnly: true });
    const fresh = await newTenant(h, 'cpnfirst');
    expect((await preview(c.code, {}, fresh.admin)).body).toMatchObject({ ok: true });
    expect((await preview(c.code)).body).toMatchObject({
      ok: false,
      message: 'This coupon is valid on your first purchase only.',
    });
    stripeThatPays();
    const placed = placeOrderResponseSchema.parse(
      (await place({ coupon: c.code }, fresh.admin)).body,
    );
    expect((await preview(c.code, {}, fresh.admin)).body.ok).toBe(true); // a pending order uses nothing
    await payOrder(placed.orderNumber);
    expect((await preview(c.code, {}, fresh.admin)).body.message).toBe(
      'This coupon is valid on your first purchase only.',
    );
  });

  it("per-user limit counts the buyer's paid orders with the code; a deleted and re-created code keeps the history", async () => {
    const c = await coupon({ code: `${P}ONCE`, perUserLimit: 1 });
    const user = await newTenant(h, 'cpnonce');
    stripeThatPays();
    const placed = placeOrderResponseSchema.parse(
      (await place({ coupon: c.code }, user.admin)).body,
    );
    expect((await preview(c.code, {}, user.admin)).body.ok).toBe(true);
    await payOrder(placed.orderNumber);
    expect((await preview(c.code, {}, user.admin)).body.message).toBe(
      'You have already used this coupon the maximum number of times.',
    );
    await ops(h, 'delete', `/coupons/${c.id}`);
    await coupon({ code: c.code, perUserLimit: 1 });
    expect((await preview(c.code, {}, user.admin)).body.message).toBe(
      'You have already used this coupon the maximum number of times.',
    );
    // the paid order keeps its snapshot after the coupon is gone
    const row = await orderBy(placed.orderNumber);
    expect(row.coupon_code).toBe(c.code);
  });

  it("deleting a coupon keeps past orders' discount and code, and the order link nulls out", async () => {
    const c = await coupon({ code: `${P}GONE` });
    stripeThatPays();
    const placed = placeOrderResponseSchema.parse((await place({ coupon: c.code })).body);
    await payOrder(placed.orderNumber);
    await ops(h, 'delete', `/coupons/${c.id}`);
    const row = await orderBy(placed.orderNumber);
    expect(row).toMatchObject({ coupon_code: c.code, coupon_id: null });
    expect(Number(row.discount_amount)).toBe(10);
  });

  it('a coupon that takes the whole price off needs no gateway: the order is fulfilled at once', async () => {
    stripeThatPays();
    const c = await coupon({ code: `${P}FREE`, type: 'percent', amount: '100' });
    const res = await place({ coupon: c.code }, (await newTenant(h, 'cpnfree')).admin);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = placeOrderResponseSchema.parse(res.body);
    expect(body.next).toEqual({ type: 'paid' });
    const o = await orderBy(body.orderNumber);
    expect(o.status).toBe('paid');
    expect(Number(o.total_amount)).toBe(0);
    expect(await uses(c.code)).toBe(1);
    const stripeCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter((call) => String(call[0]).includes('stripe'));
    expect(stripeCalls).toHaveLength(0);
  });

  it('a wallet top-up never takes a coupon, and an order without a coupon is unaffected', async () => {
    stripeThatPays();
    const plain = placeOrderResponseSchema.parse((await place({})).body);
    const o = await orderBy(plain.orderNumber);
    expect(o.coupon_id).toBeNull();
    expect(o.coupon_code).toBeNull();
    expect(Number(o.discount_amount)).toBe(0);
    expect(Number(o.total_amount)).toBe(118);
    const topup = await as(h, buyer.admin, 'post', 'billing/checkout/wallet/orders')
      .set('idempotency-key', `cpn-topup-${Math.random()}`)
      .send({ gatewayId: stripeId, amount: '10', coupon: `${P}WELCOME10` });
    expect(topup.status, JSON.stringify(topup.body)).toBe(201);
    const t = await orderBy(placeOrderResponseSchema.parse(topup.body).orderNumber);
    expect(t.coupon_code).toBeNull();
  });
});

describe("FulfilmentService applied straight to an order (the receivers' path)", () => {
  it('counts the redemption in the same transaction as the paid transition, once', async () => {
    stripeThatPays();
    const c = await coupon({ code: `${P}DIRECT` });
    const placed = placeOrderResponseSchema.parse((await place({ coupon: c.code })).body);
    const repo = h.app.get(OrdersRepository);
    const fulfilment = h.app.get(FulfilmentService);
    const token = (await orderBy(placed.orderNumber)).return_token as string;
    const order = (await h.app
      .get(DatabaseService)
      .privileged((tx) => repo.byReturnToken(tx, token)))!;
    expect(order.couponId).not.toBeNull();
    expect((await fulfilment.fulfil(order, {})).applied).toBe(true);
    expect((await fulfilment.fulfil(order, {})).applied).toBe(false);
    expect(await uses(c.code)).toBe(1);
  });
});
