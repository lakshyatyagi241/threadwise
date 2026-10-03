import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  paygwGatewayListResponseSchema,
  placeOrderResponseSchema,
  type PaygwGatewayItem,
} from '@crm/contracts';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { SubscriptionReconcilerService } from '../../../src/modules/platform-payment-gateways';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * Platform payment gateways end to end through HTTP, against a real Postgres and the real AppModule. Only the far end of the
 * provider calls is faked (global fetch), so signatures, amounts, the conditional paid transition, RLS and the audit trail
 * are the real ones.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let superToken = '';
const ops = (method: 'get' | 'post' | 'patch', path: string) =>
  api()[method](`/v2/platform${path}`).set(bearer(superToken));

interface Account {
  token: string;
  orgId: number;
}
let ipCounter = 40;
async function signup(label: string): Promise<Account> {
  const email = `${label}${Date.now()}@example.test`;
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', `10.9.0.${ipCounter++}`)
    .send({
      orgName: `Pay ${label}`,
      fullName: 'Pay Person',
      email,
      password: 'Str0ngPassw0rd#1',
      acceptTerms: true,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const token = res.body.tokens.accessToken as string;
  const session = await api().get('/v2/auth/session').set(bearer(token));
  const row = await h.owner.query(`SELECT id FROM organizations WHERE slug = $1`, [
    session.body.org.slug,
  ]);
  return { token, orgId: Number(row.rows[0].id) };
}

async function gateways(): Promise<PaygwGatewayItem[]> {
  const res = await ops('get', '/payment-gateways');
  expect(res.status).toBe(200);
  return paygwGatewayListResponseSchema.parse(res.body).data;
}
async function gateway(slug: string): Promise<PaygwGatewayItem> {
  return (await gateways()).find((g) => g.slug === slug)!;
}
async function configure(
  slug: string,
  credentials: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  const g = await gateway(slug);
  const res = await ops('patch', `/payment-gateways/${g.id}`).send({
    mode: 'sandbox',
    credentials,
    rowVersion: g.rowVersion,
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as PaygwGatewayItem;
}
async function activate(slug: string, isActive = true) {
  const g = await gateway(slug);
  return ops('post', `/payment-gateways/${g.id}/active`).send({
    isActive,
    rowVersion: g.rowVersion,
  });
}

async function setting(key: string, value: unknown) {
  await h.owner.query(
    `INSERT INTO platform_settings (key, value, is_secret) VALUES ($1, $2::jsonb, false)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
  // the service reads a 5-second snapshot; a direct SQL write has to drop it
  h.app.get(PlatformSettingsService).invalidate();
}

async function makePlan(slug: string, amount: string, extra: Record<string, unknown> = {}) {
  const res = await ops('post', '/plans').send({ name: slug, slug, amount, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}
const orderBy = async (number: string) =>
  (await h.owner.query(`SELECT * FROM orders WHERE order_number = $1`, [number])).rows[0];
const outboxCount = async (orderId: number, type: string) =>
  Number(
    (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM event_outbox WHERE aggregate_module = 'orders' AND aggregate_id = $1 AND event_type = $2`,
        [orderId, type],
      )
    ).rows[0].n,
  );

/** The far end of the providers: canned answers by URL. */
type Handler = (url: URL, init?: RequestInit) => { status: number; body: unknown } | undefined;
const handlers: Handler[] = [];
const calls: Array<{ url: string; method: string; body: string }> = [];
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = globalThis.fetch;
function mockProviders() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, init);
    calls.push({ url: url.href, method: init?.method ?? 'GET', body: String(init?.body ?? '') });
    for (const hnd of handlers) {
      const r = hnd(url, init);
      if (r) return jsonRes(r.status, r.body);
    }
    throw new Error(`unexpected provider call ${url.href}`);
  });
}

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  superToken = token;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});
afterEach(() => {
  vi.restoreAllMocks();
  handlers.length = 0;
  calls.length = 0;
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452', 'hex'),
  Buffer.alloc(40),
]);
const WEBHOOK_SECRET = 'whsec_2';
const signStripe = (raw: string, secret = WEBHOOK_SECRET) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
};
const stripeEvent = (type: string, object: Record<string, unknown>) => {
  const raw = JSON.stringify({ type, data: { object } });
  return api()
    .post('/v2/payments/webhook/stripe')
    .set('content-type', 'application/json')
    .set('stripe-signature', signStripe(raw))
    .send(raw);
};
const subOf = async (orderNumber: string) =>
  (
    await h.owner.query(`SELECT * FROM subscriptions WHERE meta->>'order_number' = $1`, [
      orderNumber,
    ])
  ).rows[0];
const planEnd = async (orgId: number): Promise<number> =>
  new Date(
    (await h.owner.query(`SELECT plan_ends_at FROM org_plan_state WHERE org_id = $1`, [orgId]))
      .rows[0].plan_ends_at,
  ).getTime();

describe('offline gateways, proof, invoice and in-app confirmation (TW-PAYGW-013, 034, 036)', () => {
  let buyer: Account;
  let other: Account;
  let bankId: string;
  let number = '';
  let uuid = '';
  const upload = (
    token: string,
    id: string,
    file: Buffer | null,
    name = 'receipt.png',
    fields: Record<string, string> = {},
  ) => {
    const r = api().post(`/v2/billing/orders/${id}/proof`).set(bearer(token));
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    return file ? r.attach('proof', file, name) : r.field('x', 'y');
  };
  const place = (gatewayId: string, token = buyer.token, extra: Record<string, unknown> = {}) =>
    api()
      .post('/v2/billing/checkout/plans/growth/orders')
      .set(bearer(token))
      .send({ gatewayId, ...extra });

  beforeAll(async () => {
    buyer = await signup('offbuyer');
    other = await signup('offother');
    await makePlan('growth', '49', { name: 'Growth' });
    await configure('bank_transfer', {
      beneficiary_name: 'Acme Ltd',
      ifsc_or_swift: 'FIRSUS33',
      bank_name: 'First Bank',
      account_number: '1234567890',
      notes: 'Use the order number as the reference',
    });
    const act = await activate('bank_transfer');
    expect(act.status, JSON.stringify(act.body)).toBe(201);
    bankId = (await gateway('bank_transfer')).id;
    await configure('offline', { instructions: 'Pay at the counter' });
    expect((await activate('offline')).status).toBe(201);
  });

  it('a bank-transfer order returns the instructions and stays pending, the order number being the reference', async () => {
    const res = await place(bankId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = placeOrderResponseSchema.parse(res.body);
    expect(body.next).toMatchObject({
      type: 'instructions',
      kind: 'bank_transfer',
      notes: 'Use the order number as the reference',
      currency: 'USD',
    });
    expect((body.next as { rows: unknown }).rows).toEqual([
      { label: 'Beneficiary', value: 'Acme Ltd' },
      { label: 'Bank', value: 'First Bank' },
      { label: 'Account number', value: '1234567890' },
      { label: 'IFSC / SWIFT', value: 'FIRSUS33' },
    ]);
    number = body.orderNumber;
    const o = await orderBy(number);
    uuid = o.uuid;
    expect(o).toMatchObject({
      status: 'pending',
      gateway_slug: 'bank_transfer',
      gateway_order_id: number,
    });
  });

  it('the offline gateway shows its free-text instructions and no rows', async () => {
    const res = await place((await gateway('offline')).id);
    expect(res.body.next).toMatchObject({
      type: 'instructions',
      kind: 'offline',
      rows: [],
      notes: 'Pay at the counter',
    });
  });

  it('proof: a real PNG is stored with its reference and note, the order stays pending and the operator can open the file', async () => {
    const res = await upload(buyer.token, uuid, PNG, 'x.png', {
      paymentReference: 'UTR123',
      proofNote: 'paid today',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ orderNumber: number, status: 'pending' });
    const o = await orderBy(number);
    expect(o).toMatchObject({
      status: 'pending',
      payment_reference: 'UTR123',
      proof_note: 'paid today',
    });
    expect(o.proof_submitted_at).not.toBeNull();
    expect(await outboxCount(Number(o.id), 'paygw.order.proof_submitted')).toBe(1);
    const mine = await api().get('/v2/billing/orders').set(bearer(buyer.token));
    expect(mine.body.data.find((o: { id: string }) => o.id === uuid).acceptsProof).toBe(true);
    const file = await ops('get', `/billing/orders/${uuid}/proof`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('image/png');
  });

  it('proof: a re-upload replaces the file; a type spoof, no file, an oversized file and a missing order are refused', async () => {
    expect((await upload(buyer.token, uuid, Buffer.from('%PDF-1.4 stub'), 'a.pdf')).status).toBe(
      201,
    );
    const rows = await h.owner.query(
      `SELECT mime FROM order_proof_blobs WHERE order_id = (SELECT id FROM orders WHERE uuid = $1)`,
      [uuid],
    );
    expect(rows.rows).toEqual([{ mime: 'application/pdf' }]);
    expect(
      (await upload(buyer.token, uuid, Buffer.from('<?php echo 1;'), 'shell.png')).status,
    ).toBe(422);
    expect((await upload(buyer.token, uuid, null)).status).toBe(422);
    const big = await upload(
      buyer.token,
      uuid,
      Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]),
      'big.png',
    );
    expect([413, 422]).toContain(big.status);
    expect((await upload(buyer.token, '00000000-0000-4000-8000-000000000000', PNG)).status).toBe(
      404,
    );
    // the failed attempts did not disturb the stored file
    const still = await h.owner.query(
      `SELECT mime FROM order_proof_blobs WHERE order_id = (SELECT id FROM orders WHERE uuid = $1)`,
      [uuid],
    );
    expect(still.rows).toEqual([{ mime: 'application/pdf' }]);
  });

  it('proof: another workspace cannot reach the order, the buyer invoice opens for any status, and a paid order refuses proof', async () => {
    expect((await upload(other.token, uuid, PNG)).status).toBe(404);
    const inv = await api().get(`/v2/billing/orders/${uuid}/invoice`).set(bearer(buyer.token));
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    expect(JSON.stringify(inv.body)).toContain(number);
    expect(JSON.stringify(inv.body)).not.toContain('"workspace"');
    expect(
      (await api().get(`/v2/billing/orders/${uuid}/invoice`).set(bearer(other.token))).status,
    ).toBe(404);
    expect((await api().get(`/v2/billing/orders/${uuid}/invoice`)).status).toBe(401);

    const approve = await ops('post', `/billing/orders/${uuid}/approve`);
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    const after = await api().get('/v2/billing/orders').set(bearer(buyer.token));
    expect(after.body.data.find((o: { id: string }) => o.id === uuid).acceptsProof).toBe(false);
    const late = await upload(buyer.token, uuid, PNG);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('PAYGW_ORDER_STATE');
  });

  it('buyer invoice: a colleague in the same workspace gets 403 "Not your order."', async () => {
    const mate = await h.owner.query(
      `INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Mate') RETURNING id`,
      [buyer.orgId, `mate${Date.now()}@example.test`],
    );
    const mine = (await orderBy(number)).user_id;
    await h.owner.query(`UPDATE orders SET user_id = $2 WHERE uuid = $1`, [uuid, mate.rows[0].id]);
    const res = await api().get(`/v2/billing/orders/${uuid}/invoice`).set(bearer(buyer.token));
    expect(res.status).toBe(403);
    await h.owner.query(`UPDATE orders SET user_id = $2 WHERE uuid = $1`, [uuid, mine]);
  });

  it('proof is refused for an online-gateway order', async () => {
    mockProviders();
    handlers.push((url) =>
      url.hostname === 'api.stripe.com'
        ? { status: 200, body: { id: 'cs_9', url: 'https://checkout.stripe.com/c/cs_9' } }
        : undefined,
    );
    await configure('stripe', { secret_key: 'sk_test_1', webhook_secret: WEBHOOK_SECRET });
    expect((await activate('stripe')).status).toBe(201);
    const placed = await place((await gateway('stripe')).id);
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const o = await orderBy(placed.body.orderNumber);
    expect((await upload(buyer.token, o.uuid, PNG)).status).toBe(409);
  });

  it('in-app confirmation: an offline order stays pending, a paid order answers alreadyPaid, a stranger gets 404, nothing the client says pays', async () => {
    const placed = await place((await gateway('offline')).id);
    const o = await orderBy(placed.body.orderNumber);
    const confirm = (token: string, id: string, payload: Record<string, string> = {}) =>
      api().post(`/v2/billing/orders/${id}/confirm`).set(bearer(token)).send({ payload });
    const pend = await confirm(buyer.token, o.uuid, { status: 'paid', paid: 'true' });
    expect(pend.status).toBe(200);
    expect(pend.body).toMatchObject({ status: 'pending', alreadyPaid: false });
    expect((await orderBy(placed.body.orderNumber)).status).toBe('pending');
    expect((await confirm(other.token, o.uuid)).status).toBe(404);
    const stripeOrder = await orderBy(
      (
        await h.owner.query(
          `SELECT order_number FROM orders WHERE org_id = $1 AND gateway_slug = 'stripe' LIMIT 1`,
          [buyer.orgId],
        )
      ).rows[0].order_number,
    );
    const lie = await confirm(buyer.token, stripeOrder.uuid, { payment_status: 'paid' });
    expect(lie.body.status).not.toBe('paid');
    const paid = await confirm(buyer.token, uuid);
    expect(paid.body).toMatchObject({ status: 'paid', alreadyPaid: true });
  });
});

describe('subscriptions: auto-renew, lifecycle events and the reconciler (TW-PAYGW-012, 029, 030)', () => {
  let buyer: Account;
  let stripeId: string;
  let number = '';
  const place = (body: Record<string, unknown>) =>
    api()
      .post('/v2/billing/checkout/plans/growth/orders')
      .set(bearer(buyer.token))
      .send({ gatewayId: stripeId, ...body });
  const stripeOk = () =>
    handlers.push((url) =>
      url.hostname === 'api.stripe.com'
        ? { status: 200, body: { id: 'cs_sub', url: 'https://checkout.stripe.com/c/cs_sub' } }
        : undefined,
    );

  beforeAll(async () => {
    buyer = await signup('subbuyer');
    await makePlan('growth', '49', { name: 'Growth' });
    await configure('stripe', { secret_key: 'sk_test_1', webhook_secret: WEBHOOK_SECRET });
    expect((await activate('stripe')).status).toBe(201);
    stripeId = (await gateway('stripe')).id;
    await setting('pricing.recurring_enabled', true);
  });

  it('the quote offers auto-renew only where the gateway, the plan and the period allow it', async () => {
    const monthly = await api()
      .get('/v2/billing/checkout/plans/growth/quote')
      .set(bearer(buyer.token));
    expect(monthly.body.gateways.find((g: { name: string }) => g.name === 'Stripe').autoRenew).toBe(
      true,
    );
    const yearly = await api()
      .get('/v2/billing/checkout/plans/growth/quote?period=yearly')
      .set(bearer(buyer.token));
    expect(yearly.body.gateways.every((g: { autoRenew: boolean }) => g.autoRenew === false)).toBe(
      true,
    );
  });

  it('auto-renew asks Stripe for a subscription-mode session and records one pending subscription for the order', async () => {
    mockProviders();
    stripeOk();
    const res = await place({ autoRenew: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    number = res.body.orderNumber;
    const form = new URLSearchParams(calls.find((c) => c.method === 'POST')!.body);
    expect(form.get('mode')).toBe('subscription');
    expect(form.get('line_items[0][price_data][recurring][interval]')).toBe('month');
    expect(await subOf(number)).toMatchObject({
      status: 'pending',
      gateway: 'stripe',
      billing_cycle: 'monthly',
    });
  });

  it('yearly, not-ticked and platform-switch-off purchases are plain one-time checkouts', async () => {
    mockProviders();
    stripeOk();
    const yearly = await place({ autoRenew: true, period: 'yearly' });
    expect(yearly.status, JSON.stringify(yearly.body)).toBe(201);
    expect(await subOf(yearly.body.orderNumber)).toBeUndefined();
    expect(await subOf((await place({})).body.orderNumber)).toBeUndefined();
    await setting('pricing.recurring_enabled', false);
    expect(await subOf((await place({ autoRenew: true })).body.orderNumber)).toBeUndefined();
    await setting('pricing.recurring_enabled', true);
  });

  it('the first invoice.paid finalises the order before activating (one cycle, not two), the provider date sets the window, a replay changes nothing', async () => {
    const end = Math.floor(Date.now() / 1000) + 45 * 86400;
    const evt = () =>
      stripeEvent('invoice.paid', {
        id: 'in_1',
        subscription: 'sub_1',
        billing_reason: 'subscription_create',
        payment_intent: 'pi_a',
        lines: { data: [{ period: { end }, metadata: { order_number: number } }] },
      });
    expect((await evt()).status).toBe(200);
    expect((await orderBy(number)).status).toBe('paid');
    expect(await subOf(number)).toMatchObject({
      status: 'active',
      gateway_subscription_id: 'sub_1',
    });
    const ends = await planEnd(buyer.orgId);
    expect(Math.abs(ends - end * 1000)).toBeLessThan(2000);
    expect((await evt()).status).toBe(200);
    expect(Number((await subOf(number)).renewals_count)).toBe(0);
    expect(await planEnd(buyer.orgId)).toBe(ends);
  });

  it('a renewal extends the window and counts once per provider payment; a failed charge is past_due and a good one recovers it', async () => {
    const end = Math.floor(Date.now() / 1000) + 60 * 86400;
    const renew = (id: string, pi: string, e: number) =>
      stripeEvent('invoice.paid', {
        id,
        subscription: 'sub_1',
        billing_reason: 'subscription_cycle',
        payment_intent: pi,
        lines: { data: [{ period: { end: e } }] },
      });
    await renew('in_2', 'pi_b', end);
    await renew('in_2', 'pi_b', end);
    expect(Number((await subOf(number)).renewals_count)).toBe(1);
    expect(Math.abs((await planEnd(buyer.orgId)) - end * 1000)).toBeLessThan(2000);
    await stripeEvent('invoice.payment_failed', { id: 'in_3', subscription: 'sub_1' });
    expect((await subOf(number)).status).toBe('past_due');
    await renew('in_4', 'pi_c', end + 30 * 86400);
    expect(await subOf(number)).toMatchObject({ status: 'active', renewals_count: 2 });
  });

  it('cancellation keeps the paid window; a late renewal does not revive it; an unknown subscription is acknowledged; every step is on the outbox', async () => {
    const before = await planEnd(buyer.orgId);
    expect((await stripeEvent('customer.subscription.deleted', { id: 'sub_1' })).status).toBe(200);
    const sub = await subOf(number);
    expect(sub.status).toBe('canceled');
    expect(sub.canceled_at).not.toBeNull();
    expect(await planEnd(buyer.orgId)).toBe(before);
    await stripeEvent('invoice.paid', {
      id: 'in_5',
      subscription: 'sub_1',
      billing_reason: 'subscription_cycle',
      payment_intent: 'pi_late',
      lines: { data: [{ period: { end: 4102444800 } }] },
    });
    expect((await subOf(number)).status).toBe('canceled');
    expect(await planEnd(buyer.orgId)).toBe(before);
    expect((await stripeEvent('customer.subscription.deleted', { id: 'sub_none' })).status).toBe(
      200,
    );
    const events = await h.owner.query(
      `SELECT event_type FROM event_outbox WHERE aggregate_module = 'subscriptions' AND aggregate_id = $1 ORDER BY id`,
      [sub.id],
    );
    expect(events.rows.map((r) => r.event_type)).toEqual([
      'paygw.subscription.activated',
      'paygw.subscription.renewed',
      'paygw.subscription.past_due',
      'paygw.subscription.renewed',
      'paygw.subscription.canceled',
    ]);
  });

  it('reconciler (Razorpay): polls a due subscription once per window, applies a renewal the webhook missed, and a provider cancellation', async () => {
    await configure('razorpay', { key_id: 'rzp_test_1', key_secret: 'secret' });
    const reconciler = h.app.get(SubscriptionReconcilerService);
    const acct = await signup('rzp');
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, plan_ends_at) VALUES ($1, now() + interval '1 day')
       ON CONFLICT (org_id) DO UPDATE SET plan_ends_at = EXCLUDED.plan_ends_at`,
      [acct.orgId],
    );
    await h.owner.query(`UPDATE organizations SET plan = 'growth' WHERE id = $1`, [acct.orgId]);
    await h.owner.query(
      `INSERT INTO subscriptions (org_id, plan_id, gateway, gateway_subscription_id, billing_cycle, status, amount, currency)
       VALUES ($1, 'growth', 'razorpay', 'sub_rz', 'monthly', 'active', 49, 'INR')`,
      [acct.orgId],
    );
    const newEnd = Math.floor(Date.now() / 1000) + 40 * 86400;
    mockProviders();
    handlers.push((url) =>
      url.pathname === '/v1/subscriptions/sub_rz'
        ? { status: 200, body: { id: 'sub_rz', status: 'active', current_end: newEnd } }
        : undefined,
    );
    const first = await reconciler.sweep();
    expect(first.renewed ?? 0).toBeGreaterThanOrEqual(1);
    expect(Math.abs((await planEnd(acct.orgId)) - newEnd * 1000)).toBeLessThan(2000);
    const polls = calls.length;
    await reconciler.sweep();
    expect(calls.length).toBe(polls);

    await h.owner.query(
      `UPDATE subscriptions SET meta = meta - 'last_polled_at' WHERE gateway_subscription_id = 'sub_rz'`,
    );
    await h.owner.query(
      `UPDATE org_plan_state SET plan_ends_at = now() + interval '1 day' WHERE org_id = $1`,
      [acct.orgId],
    );
    handlers.length = 0;
    handlers.push((url) =>
      url.pathname === '/v1/subscriptions/sub_rz'
        ? { status: 200, body: { id: 'sub_rz', status: 'cancelled' } }
        : undefined,
    );
    const second = await reconciler.sweep();
    expect(second.gateway_canceled ?? 0).toBeGreaterThanOrEqual(1);
    const row = (
      await h.owner.query(
        `SELECT status FROM subscriptions WHERE gateway_subscription_id = 'sub_rz'`,
      )
    ).rows[0];
    expect(row.status).toBe('canceled');
  });
});
