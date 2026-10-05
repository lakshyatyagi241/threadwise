import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { paygwGatewayListResponseSchema, type PaygwGatewayItem } from '@crm/contracts';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { AddonEntitlementService } from '../../../src/modules/addons-extension-registry';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * Billing hardening end to end (real Postgres, real AppModule, only Razorpay's far end faked): subscription and one-off payments
 * stay apart, a provider plan is reused, recurring add-ons renew and cancel on their own subscription, and a failed autopay
 * charge keeps the plan or add-on active for `billing.grace_days` before it lapses.
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
  // the services read a short-lived snapshot; a direct SQL write has to drop it
  h.app.get(PlatformSettingsService).invalidate();
  h.app.get(PlanEntitlementService).forgetGrace();
}

async function makePlan(slug: string, amount: string, extra: Record<string, unknown> = {}) {
  const res = await ops('post', '/plans').send({ name: slug, slug, amount, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}
const orderBy = async (number: string) =>
  (await h.owner.query(`SELECT * FROM orders WHERE order_number = $1`, [number])).rows[0];
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

const WHSEC = 'whsec_r';
const KEY_SECRET = 'rzp_secret';
const signRzp = (raw: string) => createHmac('sha256', WHSEC).update(raw).digest('hex');
const rzpEvent = (event: string, payload: Record<string, unknown>) => {
  const raw = JSON.stringify({ event, payload });
  return api()
    .post('/v2/payments/webhook/razorpay')
    .set('content-type', 'application/json')
    .set('x-razorpay-signature', signRzp(raw))
    .send(raw);
};
const unix = (days: number) => Math.floor((Date.now() + days * 86_400_000) / 1000);
const subEvent = (event: string, subId: string, extra: Record<string, unknown> = {}) =>
  rzpEvent(event, {
    subscription: { entity: { id: subId, ...(extra.sub as object) } },
    ...(extra.payment ? { payment: { entity: extra.payment } } : {}),
  });

describe('razorpay subscriptions, recurring add-ons and the grace period', () => {
  let buyer: Account;
  let rzpId = '';
  let addonSlug = '';
  let addonUuid = '';
  let subSeq = 0;
  let planSeq = 0;

  const razorpayOk = () =>
    handlers.push((url, init) => {
      if (url.hostname !== 'api.razorpay.com') return undefined;
      if (url.pathname === '/v1/plans') return { status: 200, body: { id: `plan_${++planSeq}` } };
      if (url.pathname === '/v1/subscriptions')
        return { status: 200, body: { id: `sub_${++subSeq}` } };
      if (url.pathname.endsWith('/cancel')) return { status: 200, body: { status: 'cancelled' } };
      void init;
      return undefined;
    });
  const rzpCalls = (path: string) => calls.filter((c) => new URL(c.url).pathname === path);
  const placeAddon = () =>
    api()
      .post(`/v2/billing/checkout/plans/${addonSlug}/orders`)
      .set(bearer(buyer.token))
      .send({ gatewayId: rzpId, currency: 'INR' });
  const addonRow = async () =>
    (
      await h.owner.query(
        `SELECT * FROM workspace_addons WHERE org_id = $1 ORDER BY id DESC LIMIT 1`,
        [buyer.orgId],
      )
    ).rows[0];
  const subRow = async (id: string) =>
    (await h.owner.query(`SELECT * FROM subscriptions WHERE gateway_subscription_id = $1`, [id]))
      .rows[0];
  const live = async () =>
    (await h.app.get(AddonEntitlementService).activeGrants(buyer.orgId)).length;

  beforeAll(async () => {
    buyer = await signup('rzpbuyer');
    await setting('default_currency', 'INR');
    await setting('pricing.recurring_enabled', true);
    await setting('billing.grace_days', 7);
    await makePlan('growth', '999', { name: 'Growth', currency: 'INR' });
    await configure('razorpay', {
      key_id: 'rzp_test_1',
      key_secret: KEY_SECRET,
      webhook_secret: WHSEC,
    });
    expect((await activate('razorpay')).status).toBe(201);
    rzpId = (await gateway('razorpay')).id;
    // the workspace is on an active paid plan, which an add-on needs
    await h.owner.query(`UPDATE organizations SET plan = 'growth' WHERE id = $1`, [buyer.orgId]);
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, plan_ends_at) VALUES ($1, now() + interval '30 days')
       ON CONFLICT (org_id) DO UPDATE SET plan_ends_at = EXCLUDED.plan_ends_at, trial_ends_at = NULL`,
      [buyer.orgId],
    );
    const created = await ops('post', '/addons').send({
      name: 'Extra seats',
      amount: '499',
      currency: 'INR',
      billingUnit: 'months',
      billingDuration: 1,
      billingMode: 'recurring',
      limits: { users: 1 },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ billingMode: 'recurring' });
    addonSlug = created.body.slug;
  });

  it('a recurring add-on is sold as a subscription with no auto-renew tick, on its own subscription row', async () => {
    mockProviders();
    razorpayOk();
    const quote = await api()
      .get(`/v2/billing/checkout/plans/${addonSlug}/quote?currency=INR`)
      .set(bearer(buyer.token));
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(quote.body.gateways.find((g: { name: string }) => g.name === 'Razorpay').autoRenew).toBe(
      true,
    );

    const placed = await placeAddon();
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(placed.body.next).toMatchObject({
      type: 'client_action',
      provider: 'razorpay',
      params: { subscriptionId: 'sub_1' },
    });
    const sub = await subRow('sub_1');
    expect(sub).toMatchObject({
      kind: 'addon',
      status: 'pending',
      plan_id: addonSlug,
      gateway: 'razorpay',
    });
    expect(sub.meta.order_number).toBe(placed.body.orderNumber);
    expect(rzpCalls('/v1/plans')).toHaveLength(1);
  });

  it('a second checkout for the same price reuses the Razorpay plan instead of creating another', async () => {
    mockProviders();
    razorpayOk();
    const placed = await placeAddon();
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(rzpCalls('/v1/plans')).toHaveLength(0);
    expect(rzpCalls('/v1/subscriptions')).toHaveLength(1);
    const cached = await h.owner.query(
      `SELECT gateway_plan_id, amount_minor::text AS amt FROM gateway_plan_cache`,
    );
    expect(cached.rows).toEqual([{ gateway_plan_id: 'plan_1', amt: '49900' }]);
    expect((await subRow('sub_2')).gateway_plan_id).toBe('plan_1');
  });

  it('the payment of a subscription charge is not a one-off payment: payment.captured with an invoice id changes nothing', async () => {
    const before = await h.owner.query(
      `SELECT count(*)::int AS n FROM orders WHERE org_id = $1 AND status = 'paid'`,
      [buyer.orgId],
    );
    const number = (await subRow('sub_1')).meta.order_number as string;
    const res = await rzpEvent('payment.captured', {
      payment: {
        entity: {
          id: 'pay_x',
          order_id: 'order_x',
          invoice_id: 'inv_x',
          amount: 49900,
          currency: 'INR',
          notes: { order_number: number },
        },
      },
    });
    expect(res.status).toBe(200);
    const after = await h.owner.query(
      `SELECT count(*)::int AS n FROM orders WHERE org_id = $1 AND status = 'paid'`,
      [buyer.orgId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect((await orderBy(number)).status).not.toBe('paid');
  });

  it('the first charge pays the order, grants the add-on until the provider period end and activates the subscription', async () => {
    const number = (await subRow('sub_1')).meta.order_number as string;
    // a provider period end later than the purchase's own one-month term wins; an earlier one never shortens it
    const end = unix(35);
    const res = await subEvent('subscription.charged', 'sub_1', {
      sub: { current_end: end, notes: { order_number: number } },
      payment: { id: 'pay_1', invoice_id: 'inv_1' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await orderBy(number)).status).toBe('paid');
    const sub = await subRow('sub_1');
    expect(sub.status).toBe('active');
    const a = await addonRow();
    expect(a.status).toBe('active');
    expect(String(sub.workspace_addon_id)).toBe(String(a.id));
    expect(new Date(a.ends_at).getTime()).toBe(end * 1000);
    expect(await live()).toBe(1);
    // the workspace plan was not touched by the add-on's subscription
    const plan = (
      await h.owner.query(`SELECT o.plan FROM organizations o WHERE o.id = $1`, [buyer.orgId])
    ).rows[0].plan;
    expect(plan).toBe('growth');
  });

  it('a renewal extends the add-on to the provider period end; a redelivery of the same payment counts once', async () => {
    const end = unix(60);
    const send = () =>
      subEvent('subscription.charged', 'sub_1', {
        sub: { current_end: end },
        payment: { id: 'pay_2', invoice_id: 'inv_2' },
      });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const sub = await subRow('sub_1');
    expect(sub.renewals_count).toBe(1);
    expect(new Date((await addonRow()).ends_at).getTime()).toBe(end * 1000);
  });

  it('a failed charge keeps the add-on for the grace days, then the entitlement drops', async () => {
    expect((await subEvent('subscription.pending', 'sub_1')).status).toBe(200);
    expect((await subRow('sub_1')).status).toBe('past_due');
    const set = (days: number) =>
      h.owner.query(
        `UPDATE workspace_addons SET starts_at = now() - interval '90 days', ends_at = now() + ($2 || ' days')::interval WHERE org_id = $1`,
        [buyer.orgId, String(days)],
      );
    await set(-2);
    expect(await live()).toBe(1); // inside the 7 grace days
    await set(-8);
    expect(await live()).toBe(0); // grace over
    await set(-2);
    await setting('billing.grace_days', 0);
    expect(await live()).toBe(0); // no grace configured
    await setting('billing.grace_days', 7);
    expect(await live()).toBe(1);
    // a recovered charge brings it back to a full period
    expect(
      (
        await subEvent('subscription.charged', 'sub_1', {
          sub: { current_end: unix(30) },
          payment: { id: 'pay_3', invoice_id: 'inv_3' },
        })
      ).status,
    ).toBe(200);
    expect((await subRow('sub_1')).status).toBe('active');
    expect(await live()).toBe(1);
  });

  it('without a live subscription an expired add-on gets no grace', async () => {
    await h.owner.query(
      `UPDATE subscriptions SET status = 'canceled' WHERE gateway_subscription_id = 'sub_1'`,
    );
    await h.owner.query(
      `UPDATE workspace_addons SET starts_at = now() - interval '90 days', ends_at = now() - interval '1 day' WHERE org_id = $1`,
      [buyer.orgId],
    );
    expect(await live()).toBe(0);
    await h.owner.query(
      `UPDATE subscriptions SET status = 'active' WHERE gateway_subscription_id = 'sub_1'`,
    );
  });

  it('cancelling the plan renewal never touches the add-on subscription, and the add-on has its own cancel', async () => {
    mockProviders();
    razorpayOk();
    await h.owner.query(
      `UPDATE workspace_addons SET starts_at = now() - interval '10 days', ends_at = now() + interval '20 days' WHERE org_id = $1`,
      [buyer.orgId],
    );
    const planCancel = await api().post('/v2/billing/subscription/cancel').set(bearer(buyer.token));
    expect(planCancel.status).toBe(422); // only an add-on subscription exists, so there is no plan subscription
    expect((await subRow('sub_1')).status).toBe('active');

    addonUuid = (await addonRow()).uuid;
    const res = await api()
      .post(`/v2/billing/subscription/addons/${addonUuid}/cancel`)
      .set(bearer(buyer.token));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'canceled', remote: 'ok' });
    expect(JSON.parse(rzpCalls('/v1/subscriptions/sub_1/cancel')[0]!.body)).toEqual({
      cancel_at_cycle_end: 1,
    });
    expect((await subRow('sub_1')).status).toBe('canceled');
    expect(await live()).toBe(1); // the paid term keeps running
    // another workspace cannot cancel it
    const other = await signup('rzpother');
    expect(
      (
        await api()
          .post(`/v2/billing/subscription/addons/${addonUuid}/cancel`)
          .set(bearer(other.token))
      ).status,
    ).toBe(422);
  });

  it('the plan itself: a past-due autopay subscription holds the plan in grace, then it lapses to free', async () => {
    await h.owner.query(
      `INSERT INTO subscriptions (org_id, plan_id, kind, gateway, gateway_subscription_id, billing_cycle, status, amount, currency)
       VALUES ($1, 'growth', 'plan', 'razorpay', 'sub_plan', 'monthly', 'past_due', 999, 'INR')`,
      [buyer.orgId],
    );
    const stateAt = async (days: number) => {
      await h.owner.query(
        `UPDATE org_plan_state SET plan_ends_at = now() + ($2 || ' days')::interval WHERE org_id = $1`,
        [buyer.orgId, String(days)],
      );
      const res = await api().get('/v2/billing/status').set(bearer(buyer.token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body as { state: string; graceEndsAt: string | null; daysLeft: number | null };
    };
    expect(await stateAt(5)).toMatchObject({ state: 'paid_active', graceEndsAt: null });
    const g = await stateAt(-2);
    expect(g.state).toBe('paid_grace');
    expect(g.graceEndsAt).not.toBeNull();
    expect(g.daysLeft).toBe(5);
    expect((await stateAt(-8)).state).toBe('paid_lapsed');
    await h.owner.query(
      `UPDATE subscriptions SET status = 'canceled' WHERE gateway_subscription_id = 'sub_plan'`,
    );
    expect((await stateAt(-2)).state).toBe('paid_lapsed');
  });
});
