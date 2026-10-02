import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  paygwGatewayListResponseSchema,
  paygwOrdersResponseSchema,
  placeOrderResponseSchema,
  type PaygwGatewayItem,
} from '@crm/contracts';
import { PlatformSettingsService } from '../../../src/modules/auth';
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
let supportToken = '';
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
const onPlan = (orgId: number, slug: string) =>
  h.owner.query(`UPDATE organizations SET plan = $2 WHERE id = $1`, [orgId, slug]);

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
  const sup = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});
afterEach(() => {
  vi.restoreAllMocks();
  handlers.length = 0;
  calls.length = 0;
});

describe('gateway catalogue and configuration (WD-PAYGW-001..005)', () => {
  it('first load creates all 33 gateways inactive, in sandbox, with the whitelist, and never touches them again', async () => {
    const list = await gateways();
    expect(list).toHaveLength(33);
    expect(list.every((g) => !g.isActive && g.mode === 'sandbox')).toBe(true);
    expect(list[0]).toMatchObject({ slug: 'stripe', sortOrder: 1 });
    expect(list.find((g) => g.slug === 'razorpay')?.supportedCurrencies).toEqual(['INR']);
    expect(list.find((g) => g.slug === 'offline')?.supportedCurrencies).toEqual([]);
    const second = await ops('get', '/payment-gateways');
    expect(second.body.data).toHaveLength(33);
    expect(second.body.summary).toEqual({ total: 33, active: 0, india: 6, crypto: 1 });
  });

  it('a gateway deleted from the table reappears on the next load', async () => {
    await h.owner.query(`DELETE FROM payment_gateways WHERE slug = 'ligdicash'`);
    expect((await gateways()).some((g) => g.slug === 'ligdicash')).toBe(true);
  });

  it('saving stores the credential encrypted, never returns it, and a blank keeps it', async () => {
    const saved = await configure(
      'stripe',
      { secret_key: 'sk_test_SECRET', publishable_key: 'pk_test_1', evil_key: 'x' },
      { mode: 'live' },
    );
    expect(JSON.stringify(saved)).not.toContain('sk_test_SECRET');
    expect(saved).toMatchObject({ mode: 'live', keysSaved: true });
    expect(saved.fields.find((f) => f.key === 'secret_key')?.hasValue).toBe(true);
    expect(saved.fields.find((f) => f.key === 'webhook_secret')?.hasValue).toBe(false);
    const row = (
      await h.owner.query(`SELECT credentials FROM payment_gateways WHERE slug = 'stripe'`)
    ).rows[0];
    expect(row.credentials).toMatch(/^v1:/);
    expect(row.credentials).not.toContain('sk_test');

    const again = await configure('stripe', { secret_key: '', webhook_secret: 'whsec_1' });
    expect(again.fields.find((f) => f.key === 'secret_key')?.hasValue).toBe(true);
    expect(again.fields.find((f) => f.key === 'webhook_secret')?.hasValue).toBe(true);
    expect(again.fields.some((f) => f.key === 'evil_key')).toBe(false);

    const events = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.payment_gateway.updated' AND payload->>'gateway' = 'stripe' ORDER BY id`,
    );
    expect(events.rows[0].payload.fieldsSet).toEqual(['secret_key', 'publishable_key']);
    expect(JSON.stringify(events.rows)).not.toContain('sk_test_SECRET');
    expect(events.rows[1].payload.fieldsSet).toEqual(['webhook_secret']);
  });

  it('an explicit clear removes a credential; a stale rowVersion is a 409; a bad mode is refused and nothing is written', async () => {
    const g = await gateway('stripe');
    const cleared = await ops('patch', `/payment-gateways/${g.id}`).send({
      mode: 'live',
      clearCredentials: ['publishable_key'],
      rowVersion: g.rowVersion,
    });
    expect(
      cleared.body.fields.find((f: { key: string }) => f.key === 'publishable_key').hasValue,
    ).toBe(false);
    const stale = await ops('patch', `/payment-gateways/${g.id}`).send({
      mode: 'live',
      rowVersion: g.rowVersion,
    });
    expect(stale.status).toBe(409);
    const bad = await ops('patch', `/payment-gateways/${g.id}`).send({
      mode: 'production',
      rowVersion: cleared.body.rowVersion,
    });
    expect(bad.status).toBe(422);
    expect((await gateway('stripe')).mode).toBe('live');
  });

  it('activation is refused without the required fields (audited), without a driver, and for a support operator', async () => {
    const blocked = await activate('razorpay');
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('PAYGW_GATEWAY_NOT_CONFIGURED');
    expect(blocked.body.detail).toContain('key_id, key_secret');
    expect((await gateway('razorpay')).isActive).toBe(false);
    const audit = await h.owner.query(
      `SELECT status, payload FROM security_events WHERE event = 'platform.payment_gateway.toggle_blocked' AND payload->>'gateway' = 'razorpay'`,
    );
    expect(audit.rows[0]).toMatchObject({
      status: 'failure',
      payload: { missingFields: ['key_id', 'key_secret'] },
    });

    await configure('mollie', { api_key: 'test_x' });
    const noDriver = await activate('mollie');
    expect(noDriver.status).toBe(422);
    expect(noDriver.body.code).toBe('PAYGW_GATEWAY_UNAVAILABLE');

    const g = await gateway('stripe');
    const asSupport = await api()
      .post(`/v2/platform/payment-gateways/${g.id}/active`)
      .set(bearer(supportToken))
      .send({ isActive: true, rowVersion: g.rowVersion });
    expect(asSupport.status).toBe(403);
    expect(
      (await api().get('/v2/platform/payment-gateways').set(bearer(supportToken))).status,
    ).toBe(200);
    expect((await api().get('/v2/platform/payment-gateways')).status).toBe(401);
  });

  it('activates a configured gateway and deactivation always works', async () => {
    const on = await activate('stripe');
    expect(on.status, JSON.stringify(on.body)).toBe(201);
    expect(on.body.isActive).toBe(true);
    const off = await activate('stripe', false);
    expect(off.body.isActive).toBe(false);
    expect((await activate('stripe')).body.isActive).toBe(true);
    const events = await h.owner.query(
      `SELECT event FROM security_events WHERE event LIKE 'platform.payment_gateway.%activated' ORDER BY id`,
    );
    expect(events.rows.map((r) => r.event)).toEqual([
      'platform.payment_gateway.activated',
      'platform.payment_gateway.deactivated',
      'platform.payment_gateway.activated',
    ]);
  });
});

describe('checkout, return, webhook and fulfilment (WD-PAYGW-009, 011, 026..028, 031, 035)', () => {
  let buyer: Account;
  let stripeId: string;
  const WEBHOOK_SECRET = 'whsec_1';

  const stripeSession = (over: Record<string, unknown> = {}) => ({
    id: 'cs_1',
    url: 'https://checkout.stripe.com/c/cs_1',
    client_reference_id: '',
    payment_status: 'paid',
    payment_intent: 'pi_1',
    amount_total: 0,
    currency: 'usd',
    ...over,
  });
  /** Stripe: creating a session returns a url; reading it returns the paid session for the last created order. */
  function stripeThatPays() {
    let created: { ref: string; amount: number; currency: string } | undefined;
    handlers.push((url, init) => {
      if (url.hostname !== 'api.stripe.com') return undefined;
      if (init?.method === 'POST') {
        const f = new URLSearchParams(String(init.body));
        created = {
          ref: f.get('client_reference_id')!,
          amount: Number(f.get('line_items[0][price_data][unit_amount]')),
          currency: f.get('line_items[0][price_data][currency]')!,
        };
        return { status: 200, body: { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' } };
      }
      return {
        status: 200,
        body: stripeSession({
          client_reference_id: created!.ref,
          amount_total: created!.amount,
          currency: created!.currency,
        }),
      };
    });
  }
  const placePlan = (slug: string, body: Record<string, unknown>, token = buyer.token) =>
    api().post(`/v2/billing/checkout/plans/${slug}/orders`).set(bearer(token)).send(body);
  const placeWallet = (body: Record<string, unknown>, token = buyer.token) =>
    api().post('/v2/billing/checkout/wallet/orders').set(bearer(token)).send(body);
  const returnUrlOf = (redirect: string) => new URL(redirect);
  const tokenOf = async (orderNumber: string) =>
    (await orderBy(orderNumber)).return_token as string;

  const signStripe = (raw: string, t = Math.floor(Date.now() / 1000), secret = WEBHOOK_SECRET) =>
    `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
  const stripeWebhook = (
    orderNumber: string,
    amount: number,
    over: Record<string, unknown> = {},
  ) => {
    const raw = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: stripeSession({ client_reference_id: orderNumber, amount_total: amount, ...over }),
      },
    });
    return {
      raw,
      post: (sig = signStripe(raw)) =>
        api()
          .post('/v2/payments/webhook/stripe')
          .set('content-type', 'application/json')
          .set('stripe-signature', sig)
          .send(raw),
    };
  };

  beforeAll(async () => {
    buyer = await signup('buyer');
    await makePlan('growth', '49', { name: 'Growth' });
    await makePlan('pro', '99', { name: 'Pro' });
    await makePlan('lifetime', '500', { name: 'Lifetime', isLifetime: true });
    await makePlan('freebie', '0', { name: 'Freebie', isFree: true });
    stripeId = (await gateway('stripe')).id;
    await setting('checkout.tax_enabled', true);
    await setting('checkout.tax_rate', 18);
    await setting('checkout.tax_label', 'GST');
  });

  it('quotes a plan: price, tax, total and only the gateways that accept the currency', async () => {
    const res = await api().get('/v2/billing/checkout/plans/growth/quote').set(bearer(buyer.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'plan',
      itemName: 'Growth',
      currency: 'USD',
      subtotal: '49.00',
      discount: '0.00',
      taxRate: '18',
      taxLabel: 'GST',
      tax: '8.82',
      total: '57.82',
      billingPeriod: 'monthly',
    });
    expect(res.body.gateways.map((g: { id: string }) => g.id)).toEqual([stripeId]);
    expect(res.body.gateways[0]).not.toHaveProperty('credentials');
    expect((await api().get('/v2/billing/checkout/plans/growth/quote')).status).toBe(401);
  });

  it('yearly is 12 months less the discount; free and unknown plans are not purchasable', async () => {
    const y = await api()
      .get('/v2/billing/checkout/plans/growth/quote?period=yearly')
      .set(bearer(buyer.token));
    expect(y.body).toMatchObject({
      billingPeriod: 'yearly',
      subtotal: '470.40',
      tax: '84.67',
      total: '555.07',
    });
    const free = await api()
      .get('/v2/billing/checkout/plans/freebie/quote')
      .set(bearer(buyer.token));
    expect(free.status).toBe(422);
    expect(free.body.code).toBe('PAYGW_PLAN_NOT_PURCHASABLE');
    expect(
      (await api().get('/v2/billing/checkout/plans/nothere/quote').set(bearer(buyer.token))).status,
    ).toBe(404);
  });

  it('refuses a downgrade server-side, on the quote and on a direct POST', async () => {
    const other = await signup('downgrader');
    await onPlan(other.orgId, 'pro');
    const quote = await api()
      .get('/v2/billing/checkout/plans/growth/quote')
      .set(bearer(other.token));
    expect(quote.status).toBe(422);
    expect(quote.body.code).toBe('PAYGW_DOWNGRADE_NOT_ALLOWED');
    const post = await placePlan('growth', { gatewayId: stripeId }, other.token);
    expect(post.body.code).toBe('PAYGW_DOWNGRADE_NOT_ALLOWED');
    expect(
      Number(
        (
          await h.owner.query(`SELECT count(*)::int AS n FROM orders WHERE org_id = $1`, [
            other.orgId,
          ])
        ).rows[0].n,
      ),
    ).toBe(0);
    expect(
      (await api().get('/v2/billing/checkout/plans/pro/quote').set(bearer(other.token))).status,
    ).toBe(200); // renewal
  });

  it('place order: stores the breakdown, charges the exact total at Stripe, carries our order number, redirects', async () => {
    mockProviders();
    stripeThatPays();
    const res = await placePlan('growth', {
      gatewayId: stripeId,
      billing: { customerName: 'Ada', company: 'Acme', country: 'IN', taxId: 'GST1' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = placeOrderResponseSchema.parse(res.body);
    expect(body.next).toEqual({ type: 'redirect', url: 'https://checkout.stripe.com/c/cs_1' });
    expect(body.orderNumber).toMatch(/^WSN-\d{6}-[A-Z0-9]{6}$/);

    const o = await orderBy(body.orderNumber);
    expect(o).toMatchObject({
      status: 'pending',
      kind: 'plan',
      plan_slug: 'growth',
      currency: 'USD',
      gateway_slug: 'stripe',
      gateway_order_id: 'cs_1',
      billing_period: 'monthly',
      customer_name: 'Ada',
      billing_company: 'Acme',
      billing_tax_id: 'GST1',
    });
    expect(Number(o.total_amount)).toBe(57.82);
    expect(Number(o.tax_amount)).toBe(8.82);
    expect(Number(o.tax_rate)).toBe(18);
    const form = new URLSearchParams(calls.find((c) => c.method === 'POST')!.body);
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('5782');
    expect(form.get('client_reference_id')).toBe(body.orderNumber);
    expect(form.get('success_url')).toContain(`/v2/payments/return/stripe?o=${o.return_token}`);
    expect(await outboxCount(Number(o.id), 'paygw.order.created')).toBe(1);
    const audit = await h.owner.query(
      `SELECT action FROM audit_log WHERE module = 'orders' AND record_id = $1`,
      [o.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['insert']);
  });

  it('refuses an inactive gateway before creating anything, an unsupported currency, and a coupon (CPN not built)', async () => {
    const razorpay = await gateway('razorpay');
    const before = Number((await h.owner.query(`SELECT count(*)::int AS n FROM orders`)).rows[0].n);
    const inactive = await placePlan('growth', { gatewayId: razorpay.id });
    expect(inactive.status).toBe(422);
    expect(inactive.body).toMatchObject({
      code: 'PAYGW_GATEWAY_UNAVAILABLE',
      detail: 'That gateway is not currently available.',
    });
    const coupon = await placePlan('growth', { gatewayId: stripeId, coupon: 'SAVE10' });
    expect(coupon.body.code).toBe('PAYGW_COUPON_UNAVAILABLE');
    const missing = await placePlan('growth', {
      gatewayId: '00000000-0000-4000-8000-000000000000',
    });
    expect(missing.body.code).toBe('PAYGW_GATEWAY_UNAVAILABLE');
    expect(Number((await h.owner.query(`SELECT count(*)::int AS n FROM orders`)).rows[0].n)).toBe(
      before,
    );
  });

  it('a provider failure ends the order failed with the reason and tells the buyer to retry or pick another gateway', async () => {
    mockProviders();
    handlers.push(() => ({ status: 500, body: { error: { message: 'boom' } } }));
    const res = await placePlan('growth', { gatewayId: stripeId });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('PAYGW_PROVIDER_ERROR');
    const o = (
      await h.owner.query(`SELECT * FROM orders WHERE status = 'failed' ORDER BY id DESC LIMIT 1`)
    ).rows[0];
    expect(o.failure_reason).toContain('stripe_http_500');
    expect(await outboxCount(Number(o.id), 'paygw.order.failed')).toBe(1);
  });

  it('return: confirms with Stripe, marks the order paid, applies the plan (trial lifted, window set), and a replay changes nothing', async () => {
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, trial_ends_at) VALUES ($1, now() + interval '5 days') ON CONFLICT (org_id) DO UPDATE SET trial_ends_at = now() + interval '5 days'`,
      [buyer.orgId],
    );
    mockProviders();
    stripeThatPays();
    const placed = (await placePlan('growth', { gatewayId: stripeId })).body;
    const token = await tokenOf(placed.orderNumber);
    const res = await api()
      .get(`/v2/payments/return/stripe?o=${token}&session_id=cs_1`)
      .redirects(0);
    expect(res.status).toBe(303);
    expect(returnUrlOf(res.headers.location).searchParams.get('payment')).toBe('success');

    const o = await orderBy(placed.orderNumber);
    expect(o).toMatchObject({ status: 'paid', gateway_payment_id: 'pi_1', failure_reason: null });
    expect(o.paid_at).not.toBeNull();
    const state = (
      await h.owner.query(
        `SELECT o.plan, s.trial_ends_at, s.plan_ends_at, s.billing_cycle FROM organizations o JOIN org_plan_state s ON s.org_id = o.id WHERE o.id = $1`,
        [buyer.orgId],
      )
    ).rows[0];
    expect(state.plan).toBe('growth');
    expect(state.trial_ends_at).toBeNull();
    const days = (new Date(state.plan_ends_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    expect(await outboxCount(Number(o.id), 'paygw.order.paid')).toBe(1);

    // replay of the return, then a cancelled replay: neither re-applies nor downgrades a paid order
    const end1 = state.plan_ends_at.getTime();
    await api().get(`/v2/payments/return/stripe?o=${token}&session_id=cs_1`).redirects(0);
    const cancel = await api()
      .get(`/v2/payments/return/stripe?o=${token}&cancelled=1`)
      .redirects(0);
    expect(returnUrlOf(cancel.headers.location).searchParams.get('payment')).toBe('success');
    expect((await orderBy(placed.orderNumber)).status).toBe('paid');
    const again = (
      await h.owner.query(`SELECT plan_ends_at FROM org_plan_state WHERE org_id = $1`, [
        buyer.orgId,
      ])
    ).rows[0];
    expect(again.plan_ends_at.getTime()).toBe(end1);
    expect(await outboxCount(Number(o.id), 'paygw.order.paid')).toBe(1);
  });

  it('a second purchase stacks on the unexpired window instead of replacing it', async () => {
    const before = (
      await h.owner.query(`SELECT plan_ends_at FROM org_plan_state WHERE org_id = $1`, [
        buyer.orgId,
      ])
    ).rows[0].plan_ends_at as Date;
    mockProviders();
    stripeThatPays();
    const placed = (await placePlan('growth', { gatewayId: stripeId })).body;
    await api()
      .get(`/v2/payments/return/stripe?o=${await tokenOf(placed.orderNumber)}&session_id=cs_1`)
      .redirects(0);
    const after = (
      await h.owner.query(`SELECT plan_ends_at FROM org_plan_state WHERE org_id = $1`, [
        buyer.orgId,
      ])
    ).rows[0].plan_ends_at as Date;
    const gain = (after.getTime() - before.getTime()) / 86_400_000;
    expect(gain).toBeGreaterThan(27);
    expect(gain).toBeLessThan(32);
  });

  it('return: an unpaid session stays pending, the buyer cancelling is cancelled, a wrong amount fails, an unknown token lands on not-found', async () => {
    mockProviders();
    handlers.push((url, init) => {
      if (url.hostname !== 'api.stripe.com') return undefined;
      if (init?.method === 'POST')
        return { status: 200, body: { id: 'cs_9', url: 'https://checkout.stripe.com/c/cs_9' } };
      return {
        status: 200,
        body: stripeSession({
          id: 'cs_9',
          client_reference_id: (globalThis as { __ref?: string }).__ref ?? '',
          payment_status: 'unpaid',
        }),
      };
    });
    const a = (await placePlan('growth', { gatewayId: stripeId })).body;
    (globalThis as { __ref?: string }).__ref = a.orderNumber;
    const pend = await api()
      .get(`/v2/payments/return/stripe?o=${await tokenOf(a.orderNumber)}&session_id=cs_9`)
      .redirects(0);
    expect(returnUrlOf(pend.headers.location).searchParams.get('payment')).toBe('pending');
    expect((await orderBy(a.orderNumber)).status).toBe('pending'); // WaDesk marked this failed

    const cancel = await api()
      .get(`/v2/payments/return/stripe?o=${await tokenOf(a.orderNumber)}&cancelled=1`)
      .redirects(0);
    expect(returnUrlOf(cancel.headers.location).searchParams.get('payment')).toBe('cancelled');
    expect((await orderBy(a.orderNumber)).status).toBe('cancelled');
    expect(
      await outboxCount(Number((await orderBy(a.orderNumber)).id), 'paygw.order.cancelled'),
    ).toBe(1);

    const nf = await api().get('/v2/payments/return/stripe?o=nope&session_id=cs_9').redirects(0);
    expect(returnUrlOf(nf.headers.location).searchParams.get('payment')).toBe('notfound');
    const nogw = await api().get('/v2/payments/return/nonesuch?o=nope').redirects(0);
    expect(returnUrlOf(nogw.headers.location).searchParams.get('payment')).toBe('notfound');
    // a token of a stripe order presented at another gateway is not an order there
    const wrong = await api()
      .get(`/v2/payments/return/razorpay?o=${await tokenOf(a.orderNumber)}`)
      .redirects(0);
    expect(returnUrlOf(wrong.headers.location).searchParams.get('payment')).toBe('notfound');
  });

  it('webhook: unknown gateway 404; no signing secret 403 webhook_secret_not_configured; tampered body 403; stale timestamp 403', async () => {
    expect((await api().post('/v2/payments/webhook/nope').send({})).status).toBe(404);
    const g = await gateway('stripe');
    const cleared = await ops('patch', `/payment-gateways/${g.id}`).send({
      mode: g.mode,
      clearCredentials: ['webhook_secret'],
      rowVersion: g.rowVersion,
    });
    expect(cleared.status).toBe(200);
    const noSecret = await api()
      .post('/v2/payments/webhook/stripe')
      .set('content-type', 'application/json')
      .send('{}');
    expect(noSecret.status).toBe(403);
    expect(noSecret.body.detail).toBe('webhook_secret_not_configured');
    await configure('stripe', { webhook_secret: WEBHOOK_SECRET });
    const w = stripeWebhook('WSN-000000-AAAAAA', 100);
    expect((await w.post(signStripe(w.raw + ' ', undefined))).status).toBe(403);
    expect((await w.post(signStripe(w.raw, Math.floor(Date.now() / 1000) - 3600))).status).toBe(
      403,
    );
    expect((await w.post('')).status).toBe(403);
    const ok = await w.post();
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ ok: true }); // valid, matches no order: still acknowledged
  });

  it('webhook finalises an order whose buyer never returned, once, and ignores a wrong amount', async () => {
    mockProviders();
    stripeThatPays();
    const placed = (await placePlan('growth', { gatewayId: stripeId })).body;
    const o = await orderBy(placed.orderNumber);

    const wrong = stripeWebhook(placed.orderNumber, 100);
    expect((await wrong.post()).body).toEqual({ ok: true });
    expect((await orderBy(placed.orderNumber)).status).toBe('pending');

    const good = stripeWebhook(placed.orderNumber, 5782);
    expect((await good.post()).body).toEqual({ ok: true });
    expect((await good.post()).body).toEqual({ ok: true }); // provider retry
    expect((await orderBy(placed.orderNumber)).status).toBe('paid');
    expect(await outboxCount(Number(o.id), 'paygw.order.paid')).toBe(1);
  });

  it('wallet top-up: tax on top, the wallet gains the PRE-tax amount once even when return and webhook race', async () => {
    const quote = await api()
      .get('/v2/billing/checkout/wallet/quote?amount=10')
      .set(bearer(buyer.token));
    expect(quote.body).toMatchObject({
      kind: 'wallet_topup',
      subtotal: '10.00',
      tax: '1.80',
      total: '11.80',
      walletCreditMinor: 1000,
    });
    const low = await api()
      .get('/v2/billing/checkout/wallet/quote?amount=0.5')
      .set(bearer(buyer.token));
    expect(low.status).toBe(422);
    expect(low.body.code).toBe('PAYGW_AMOUNT_TOO_LOW');

    mockProviders();
    stripeThatPays();
    const placed = (await placeWallet({ gatewayId: stripeId, amount: '10' })).body;
    const o = await orderBy(placed.orderNumber);
    expect(o).toMatchObject({ kind: 'wallet_topup', plan_slug: null });
    expect(Number(o.wallet_topup_minor)).toBe(1000);
    expect(Number(o.total_amount)).toBe(11.8);

    const token = await tokenOf(placed.orderNumber);
    const hook = stripeWebhook(placed.orderNumber, 1180);
    await Promise.all([
      api().get(`/v2/payments/return/stripe?o=${token}&session_id=cs_1`).redirects(0),
      hook.post(),
      hook.post(),
    ]);
    const wallet = (
      await h.owner.query(
        `SELECT balance::text AS balance FROM wallets WHERE org_id = $1 AND unit = 'credits'`,
        [buyer.orgId],
      )
    ).rows;
    expect(wallet).toHaveLength(1);
    expect(Number(wallet[0].balance)).toBe(1000);
    const ledger = await h.owner.query(
      `SELECT amount::text AS amount, balance_after::text AS after, idempotency_key FROM wallet_transactions WHERE org_id = $1`,
      [buyer.orgId],
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].idempotency_key).toBe(`order:${o.uuid}`);
    expect(await outboxCount(Number(o.id), 'paygw.order.paid')).toBe(1);
    // the plan is untouched by a wallet order
    expect(
      (await h.owner.query(`SELECT plan FROM organizations WHERE id = $1`, [buyer.orgId])).rows[0]
        .plan,
    ).toBe('growth');
  });

  it('razorpay: INR order through the widget parameters; a good signature pays, a bad one fails', async () => {
    await h.owner.query(
      `INSERT INTO currencies (name, code, symbol, exchange_rate) VALUES ('US Dollar','USD','$',1), ('Indian Rupee','INR','Rs',83.5) ON CONFLICT (code) DO NOTHING`,
    );
    await configure('razorpay', {
      key_id: 'rzp_test_1',
      key_secret: 'rzp_secret',
      webhook_secret: 'rzp_wh',
    });
    expect((await activate('razorpay')).status).toBe(201);
    const razorpayId = (await gateway('razorpay')).id;

    const quote = await api()
      .get('/v2/billing/checkout/plans/growth/quote?currency=INR')
      .set(bearer(buyer.token));
    expect(quote.body).toMatchObject({
      currency: 'INR',
      subtotal: '4091.50',
      tax: '736.47',
      total: '4827.97',
    });
    expect(quote.body.gateways.map((g: { name: string }) => g.name)).toEqual([
      'Stripe',
      'Razorpay',
    ]);
    const usd = await placePlan('growth', { gatewayId: razorpayId, currency: 'USD' });
    expect(usd.status).toBe(422);
    expect(usd.body).toMatchObject({
      code: 'PAYGW_CURRENCY_UNSUPPORTED',
      detail: 'Razorpay does not support USD.',
    });

    mockProviders();
    let n = 0;
    handlers.push((url) =>
      url.hostname === 'api.razorpay.com'
        ? { status: 200, body: { id: `order_${++n}` } }
        : undefined,
    );
    const placed = (await placePlan('growth', { gatewayId: razorpayId, currency: 'INR' })).body;
    expect(placed.next).toMatchObject({
      type: 'client_action',
      provider: 'razorpay',
      params: { keyId: 'rzp_test_1', orderId: 'order_1', amountMinor: 482797, currency: 'INR' },
    });
    expect(JSON.parse(calls[0]!.body)).toMatchObject({
      amount: 482797,
      currency: 'INR',
      receipt: placed.orderNumber,
    });

    const token = await tokenOf(placed.orderNumber);
    const sig = (secret: string) =>
      createHmac('sha256', secret).update('order_1|pay_1').digest('hex');
    const bad = await api()
      .post(`/v2/payments/return/razorpay?o=${token}`)
      .type('form')
      .send({
        razorpay_order_id: 'order_1',
        razorpay_payment_id: 'pay_1',
        razorpay_signature: sig('wrong'),
      })
      .redirects(0);
    expect(returnUrlOf(bad.headers.location).searchParams.get('payment')).toBe('failed');
    const failed = await orderBy(placed.orderNumber);
    expect(failed).toMatchObject({
      status: 'failed',
      failure_reason: 'razorpay_signature_mismatch',
    });

    // a late good signature still pays it (the buyer retried inside the modal)
    const good = await api()
      .post(`/v2/payments/return/razorpay?o=${token}`)
      .type('form')
      .send({
        razorpay_order_id: 'order_1',
        razorpay_payment_id: 'pay_1',
        razorpay_signature: sig('rzp_secret'),
      })
      .redirects(0);
    expect(returnUrlOf(good.headers.location).searchParams.get('payment')).toBe('success');
    expect(await orderBy(placed.orderNumber)).toMatchObject({
      status: 'paid',
      gateway_payment_id: 'pay_1',
    });
  });

  it('buyer order history: own orders only, newest first, cursor pages, lifetime spend per currency', async () => {
    const all = await api().get('/v2/billing/orders').set(bearer(buyer.token));
    expect(all.status).toBe(200);
    const parsed = paygwOrdersResponseSchema.parse(all.body);
    expect(parsed.data.length).toBeGreaterThanOrEqual(6);
    expect(parsed.data[0]!.createdAt >= parsed.data[1]!.createdAt).toBe(true);
    expect(JSON.stringify(all.body)).not.toMatch(/return_token|returnToken|org_id|"orgId"/);
    const usd = parsed.lifetimeSpend.find((s) => s.currency === 'USD')!;
    const inr = parsed.lifetimeSpend.find((s) => s.currency === 'INR')!;
    expect(usd.total).toBe('185.26'); // 3 plan orders x 57.82 + the 11.80 top-up
    expect(inr).toMatchObject({ total: '4827.97', orders: 1 });
    const wallet = parsed.data.find((o) => o.kind === 'wallet_topup')!;
    expect(wallet).toMatchObject({ itemName: 'Wallet top-up', status: 'paid', amount: '11.80' });

    const p1 = await api().get('/v2/billing/orders?limit=2').set(bearer(buyer.token));
    expect(p1.body.page).toMatchObject({ hasMore: true, limit: 2 });
    const p2 = await api()
      .get(`/v2/billing/orders?limit=2&cursor=${p1.body.page.nextCursor}`)
      .set(bearer(buyer.token));
    const ids = [...p1.body.data, ...p2.body.data].map((o: { id: string }) => o.id);
    expect(new Set(ids).size).toBe(4);

    const stranger = await signup('stranger');
    const theirs = await api().get('/v2/billing/orders').set(bearer(stranger.token));
    expect(theirs.body.data).toEqual([]);
    expect(theirs.body.lifetimeSpend).toEqual([]);
    expect((await api().get('/v2/billing/orders')).status).toBe(401);
  });

  it('RLS: a tenant transaction sees only its own orders; the order table refuses a cross-tenant write', async () => {
    const stranger = await signup('rlsprobe');
    const { Client } = await import('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.org_id', $1, true)`, [String(stranger.orgId)]);
      const seen = await c.query(`SELECT count(*)::int AS n FROM orders`);
      expect(seen.rows[0].n).toBe(0);
      await c.query('ROLLBACK');

      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.org_id', $1, true)`, [String(buyer.orgId)]);
      expect((await c.query(`SELECT count(*)::int AS n FROM orders`)).rows[0].n).toBeGreaterThan(0);
      await expect(
        c.query(
          `INSERT INTO orders (org_id, order_number, currency, amount, kind, plan_slug) VALUES ($1, 'WSN-X', 'USD', 1, 'plan', 'growth')`,
          [stranger.orgId],
        ),
      ).rejects.toThrow(/row-level security/);
      await c.query('ROLLBACK');
      // payment_gateways (credentials) is invisible to a tenant transaction
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.org_id', $1, true)`, [String(buyer.orgId)]);
      expect((await c.query(`SELECT count(*)::int AS n FROM payment_gateways`)).rows[0].n).toBe(0);
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });
});
