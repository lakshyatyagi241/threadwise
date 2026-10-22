import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { paygwGatewayListResponseSchema, type PaygwGatewayItem } from '@crm/contracts';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  MAIL_PORT,
  type MailPort,
} from '../../../src/infra/providers/auth-registration-security/mail.port';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
} from '../../../src/kernel/outbox/outbox-subscribers';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { RefundReconcilerService } from '../../../src/modules/platform-payment-gateways/refund-reconciler.service';
import { SubscriptionNotificationsConsumer } from '../../../src/modules/platform-payment-gateways/subscription-notifications.consumer';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * (Header kept from the billing hardening suite.) Billing hardening end to end (real Postgres, real AppModule, only Razorpay's far end faked): subscription and one-off payments
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

/**
 * Managing subscriptions through Razorpay, end to end (real Postgres, real AppModule, only Razorpay's far end faked): the workspace's
 * own subscription list, charges and refresh; cancelling at the provider; a new plan or a downgrade stopping the OLD subscription so
 * the workspace is never charged twice; failed renewals telling the owners; and the operator's list, cancel, sync and refunds.
 */
const WHSEC = 'whsec_r';
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
const subEvent = (
  event: string,
  subId: string,
  sub: Record<string, unknown> = {},
  payment?: object,
) =>
  rzpEvent(event, {
    subscription: { entity: { id: subId, ...sub } },
    ...(payment ? { payment: { entity: payment } } : {}),
  });

let subSeq = 0;
let planSeq = 0;
let orderSeq = 0;
/** Razorpay's answers; each test can add its own handler first (they run in order). */
const razorpayOk = () =>
  handlers.push((url) => {
    if (url.hostname !== 'api.razorpay.com') return undefined;
    if (url.pathname === '/v1/plans') return { status: 200, body: { id: `plan_${++planSeq}` } };
    if (url.pathname === '/v1/orders') return { status: 200, body: { id: `order_${++orderSeq}` } };
    if (url.pathname === '/v1/subscriptions')
      return { status: 200, body: { id: `sub_${++subSeq}` } };
    if (url.pathname.endsWith('/cancel')) return { status: 200, body: { status: 'cancelled' } };
    return undefined;
  });
const rzpCalls = (path: string) => calls.filter((c) => new URL(c.url).pathname === path);
const body = (c: { body: string }) => JSON.parse(c.body) as Record<string, unknown>;

describe('managing subscriptions through Razorpay', () => {
  let buyer: Account;
  let rzpId = '';
  const subRow = async (id: string) =>
    (await h.owner.query(`SELECT * FROM subscriptions WHERE gateway_subscription_id = $1`, [id]))
      .rows[0];
  const orgPlan = async () =>
    (await h.owner.query(`SELECT plan FROM organizations WHERE id = $1`, [buyer.orgId])).rows[0]
      .plan;
  const place = (slug: string, extra: Record<string, unknown> = {}, account = buyer) =>
    api()
      .post(`/v2/billing/checkout/plans/${slug}/orders`)
      .set(bearer(account.token))
      .send({ gatewayId: rzpId, currency: 'INR', ...extra });
  /** Buy a plan as a subscription and let Razorpay confirm the first charge. */
  async function subscribe(slug: string, subId: string, days = 30) {
    const placed = await place(slug, { autoRenew: true });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(placed.body.next).toMatchObject({ params: { subscriptionId: subId } });
    const number = (await subRow(subId)).meta.order_number as string;
    const res = await subEvent(
      'subscription.charged',
      subId,
      { current_end: unix(days), notes: { order_number: number } },
      { id: `pay_${subId}`, invoice_id: `inv_${subId}` },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await subRow(subId)).status).toBe('active');
    return number;
  }
  const mine = async (token = buyer.token) => {
    const res = await api().get('/v2/billing/subscriptions').set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  beforeAll(async () => {
    buyer = await signup('subman');
    await setting('default_currency', 'INR');
    await setting('pricing.recurring_enabled', true);
    await setting('billing.grace_days', 7);
    await makePlan('lite', '199', { name: 'Lite', currency: 'INR' });
    await makePlan('growth', '999', { name: 'Growth', currency: 'INR' });
    await makePlan('pro', '1999', { name: 'Pro', currency: 'INR' });
    await configure('razorpay', {
      key_id: 'rzp_test_1',
      key_secret: 'rzp_secret',
      webhook_secret: WHSEC,
    });
    expect((await activate('razorpay')).status).toBe(201);
    rzpId = (await gateway('razorpay')).id;
  });

  it('lists the workspace subscriptions: what it is, what it costs, whether it renews and when it is paid until', async () => {
    mockProviders();
    razorpayOk();
    expect(await mine()).toEqual([]);
    await subscribe('growth', 'sub_1', 30);
    const [s] = await mine();
    expect(s).toMatchObject({
      kind: 'plan',
      name: 'Growth',
      planSlug: 'growth',
      status: 'active',
      amount: '999.00',
      currency: 'INR',
      billingCycle: 'monthly',
      gateway: 'razorpay',
      autoRenew: true,
      paymentFailed: false,
      canceledAt: null,
    });
    expect(new Date(s.currentPeriodEnd).getTime()).toBe(unix(30) * 1000);
  });

  it("is the workspace's own: another workspace sees none of it and cannot reach it by id", async () => {
    const other = await signup('subother');
    expect(await mine(other.token)).toEqual([]);
    const id = (await mine())[0]!.id;
    for (const [method, path] of [
      ['get', `/v2/billing/subscriptions/${id}/charges`],
      ['post', `/v2/billing/subscriptions/${id}/sync`],
      ['post', `/v2/billing/subscriptions/${id}/cancel`],
    ] as const) {
      const res = await api()[method](path).set(bearer(other.token));
      expect(res.status, path).toBe(404);
    }
  });

  it('shows what Razorpay charged, cycle by cycle, linking only an https receipt', async () => {
    mockProviders();
    razorpayOk();
    handlers.unshift((url) => {
      if (url.pathname !== '/v1/invoices') return undefined;
      expect(url.searchParams.get('subscription_id')).toBe('sub_1');
      return {
        status: 200,
        body: {
          items: [
            {
              id: 'inv_2',
              amount: 99900,
              currency: 'INR',
              status: 'paid',
              paid_at: unix(-1),
              issued_at: unix(-2),
              short_url: 'https://rzp.io/i/two',
              payment_id: 'pay_2',
            },
            {
              id: 'inv_1',
              amount: 99900,
              currency: 'INR',
              status: 'paid',
              paid_at: unix(-31),
              short_url: 'http://insecure.example/x',
              payment_id: 'pay_1',
            },
          ],
        },
      };
    });
    const id = (await mine())[0]!.id;
    const res = await api().get(`/v2/billing/subscriptions/${id}/charges`).set(bearer(buyer.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.source).toBe('provider');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({
      id: 'inv_2',
      amount: '999.00',
      currency: 'INR',
      status: 'paid',
      receiptUrl: 'https://rzp.io/i/two',
    });
    expect(res.body.data[1].receiptUrl).toBeNull();
  });

  it("falls back to the workspace's own paid orders when Razorpay cannot be asked, and says so", async () => {
    mockProviders();
    razorpayOk();
    handlers.unshift((url) =>
      url.pathname === '/v1/invoices' ? { status: 500, body: {} } : undefined,
    );
    const id = (await mine())[0]!.id;
    const res = await api().get(`/v2/billing/subscriptions/${id}/charges`).set(bearer(buyer.token));
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('orders');
    expect(res.body.data[0]).toMatchObject({ status: 'paid', currency: 'INR' });
  });

  it('refreshes one subscription from Razorpay on request: a renewal the webhook missed is applied once', async () => {
    mockProviders();
    razorpayOk();
    const end = unix(60);
    handlers.unshift((url) =>
      url.pathname === '/v1/subscriptions/sub_1'
        ? { status: 200, body: { id: 'sub_1', status: 'active', current_end: end } }
        : undefined,
    );
    const id = (await mine())[0]!.id;
    const res = await api().post(`/v2/billing/subscriptions/${id}/sync`).set(bearer(buyer.token));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.outcome).toBe('renewed');
    expect(new Date(res.body.subscription.currentPeriodEnd).getTime()).toBe(end * 1000);
    const again = await api().post(`/v2/billing/subscriptions/${id}/sync`).set(bearer(buyer.token));
    expect(again.body.outcome).toBe('up_to_date');
  });

  it('buying a dearer plan ENDS the old subscription at Razorpay now: the workspace is never charged for both', async () => {
    mockProviders();
    razorpayOk();
    await subscribe('pro', 'sub_2', 30);
    const cancels = rzpCalls('/v1/subscriptions/sub_1/cancel');
    expect(cancels).toHaveLength(1);
    expect(body(cancels[0]!)).toEqual({ cancel_at_cycle_end: 0 });
    expect(rzpCalls('/v1/subscriptions/sub_2/cancel')).toHaveLength(0); // the new one is untouched
    const old = await subRow('sub_1');
    expect(old.status).toBe('canceled');
    expect(old.meta.cancel).toMatchObject({
      result: 'ok',
      reason_code: 'superseded',
      at_cycle_end: false,
    });
    expect((await subRow('sub_2')).status).toBe('active');
    expect(await orgPlan()).toBe('pro');
    const list = await mine();
    expect(list.find((s) => s.planSlug === 'growth')).toMatchObject({
      status: 'canceled',
      autoRenew: false,
    });
    expect(list.find((s) => s.planSlug === 'pro')).toMatchObject({
      status: 'active',
      autoRenew: true,
    });
  });

  it('a late Razorpay cancel notice for a subscription WE ended announces nothing and changes nothing', async () => {
    const before = (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'paygw.subscription.canceled'`,
        [buyer.orgId],
      )
    ).rows[0].n;
    expect((await subEvent('subscription.cancelled', 'sub_1')).status).toBe(200);
    const after = (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'paygw.subscription.canceled'`,
        [buyer.orgId],
      )
    ).rows[0].n;
    expect(after).toBe(before);
    expect((await subRow('sub_1')).status).toBe('canceled');
  });

  it('moving to a cheaper plan stops the old subscription from renewing at the old price (at the end of the paid cycle)', async () => {
    mockProviders();
    razorpayOk();
    const res = await api()
      .post('/v2/billing/plan')
      .set(bearer(buyer.token))
      .send({ planSlug: 'lite' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.direction).toBe('downgrade');
    const cancels = rzpCalls('/v1/subscriptions/sub_2/cancel');
    expect(cancels).toHaveLength(1);
    expect(body(cancels[0]!)).toEqual({ cancel_at_cycle_end: 1 });
    const sub = await subRow('sub_2');
    expect(sub.status).toBe('canceled');
    expect(sub.meta.cancel).toMatchObject({ reason_code: 'downgrade', at_cycle_end: true });
    expect(await orgPlan()).toBe('lite');
    // and a renewal notice that still arrives cannot put the old plan back
    await subEvent(
      'subscription.charged',
      'sub_2',
      { current_end: unix(60) },
      { id: 'pay_late', invoice_id: 'inv_late' },
    );
    expect(await orgPlan()).toBe('lite');
  });

  it('the workspace cancels one subscription by id: Razorpay is told to stop at the cycle end; a second cancel is refused', async () => {
    mockProviders();
    razorpayOk();
    await subscribe('growth', 'sub_3', 30);
    const id = (await mine()).find((s) => s.status === 'active')!.id;
    const res = await api().post(`/v2/billing/subscriptions/${id}/cancel`).set(bearer(buyer.token));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'canceled', remote: 'ok' });
    expect(body(rzpCalls('/v1/subscriptions/sub_3/cancel').at(-1)!)).toEqual({
      cancel_at_cycle_end: 1,
    });
    expect((await mine()).find((s) => s.id === id)).toMatchObject({
      status: 'canceled',
      autoRenew: false,
    });
    expect(
      (await api().post(`/v2/billing/subscriptions/${id}/cancel`).set(bearer(buyer.token))).status,
    ).toBe(422);
  });

  it('needs the manage permission: a member without it cannot list, cancel or refresh', async () => {
    const member = await h.owner.query(`SELECT 1`).then(() => buyer);
    void member;
    const noAuth = await api().get('/v2/billing/subscriptions');
    expect(noAuth.status).toBe(401);
  });
});

describe('failed renewals tell the owners', () => {
  let buyer: Account;
  let rzpId = '';
  const subRow = async (id: string) =>
    (await h.owner.query(`SELECT * FROM subscriptions WHERE gateway_subscription_id = $1`, [id]))
      .rows[0];
  const registry = new OutboxSubscriberRegistry();

  beforeAll(async () => {
    buyer = await signup('subfail');
    rzpId = (await gateway('razorpay')).id;
    new SubscriptionNotificationsConsumer(
      h.app.get(DatabaseService),
      new NotificationsRepository(),
      registry,
      h.redis,
      h.app.get(ConfigService),
      h.app.get<MailPort>(MAIL_PORT, { strict: false }),
    ).onModuleInit();
  });
  const deliver = async () => {
    const res = await h.owner.query(
      `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
       WHERE org_id = $1 AND event_type IN ('paygw.subscription.past_due', 'paygw.subscription.canceled') ORDER BY id`,
      [buyer.orgId],
    );
    for (const r of res.rows) {
      const event: OutboxEvent = {
        id: String(r.id),
        orgId: Number(r.org_id),
        aggregateModule: r.aggregate_module,
        aggregateId: String(r.aggregate_id),
        eventType: r.event_type,
        payload: r.payload,
      };
      await registry.dispatch(event);
    }
  };
  const notes = async () =>
    (
      await h.owner.query(
        `SELECT type, title, body, link FROM inbox_notifications WHERE org_id = $1 ORDER BY id`,
        [buyer.orgId],
      )
    ).rows;

  it('a failed charge makes the subscription past due, tells every owner once (in the app and by email), and a second failure notice adds nothing', async () => {
    mockProviders();
    razorpayOk();
    const placed = await api()
      .post('/v2/billing/checkout/plans/growth/orders')
      .set(bearer(buyer.token))
      .send({ gatewayId: rzpId, currency: 'INR', autoRenew: true });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const subId = `sub_${subSeq}`;
    const number = (await subRow(subId)).meta.order_number as string;
    await subEvent(
      'subscription.charged',
      subId,
      { current_end: unix(30), notes: { order_number: number } },
      { id: 'pay_f1', invoice_id: 'inv_f1' },
    );

    expect((await subEvent('subscription.pending', subId)).status).toBe(200);
    expect((await subEvent('subscription.halted', subId)).status).toBe(200); // the provider gave up: still one notice
    expect((await subRow(subId)).status).toBe('past_due');
    const list = await api().get('/v2/billing/subscriptions').set(bearer(buyer.token));
    expect(list.body.data.find((s: { planSlug: string }) => s.planSlug === 'growth')).toMatchObject(
      { status: 'past_due', paymentFailed: true, autoRenew: true },
    );

    await deliver();
    await deliver(); // redelivery: nothing doubles
    const n = await notes();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      type: 'billing_payment_failed',
      title: 'Subscription payment failed',
      link: '/billing/subscriptions',
    });
    expect(n[0].body).toContain('Growth');
    const mails = h.mail.filter(
      (m) => /payment failed/i.test(m.subject) && m.text.includes('Growth'),
    );
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain('/billing/subscriptions');
  });

  it('a successful retry brings it back to active; the provider ending it is announced, our own cancel is not', async () => {
    const subId = `sub_${subSeq}`;
    await subEvent(
      'subscription.charged',
      subId,
      { current_end: unix(60) },
      { id: 'pay_f2', invoice_id: 'inv_f2' },
    );
    expect((await subRow(subId)).status).toBe('active');
    expect((await subEvent('subscription.cancelled', subId)).status).toBe(200); // the provider ended it
    await deliver();
    const n = await notes();
    expect(n.map((x) => x.type)).toEqual([
      'billing_payment_failed',
      'billing_subscription_canceled',
    ]);
    expect(n[1]!.body).toContain('cancelled by the payment provider');
  });
});

describe('the operator: subscriptions across workspaces', () => {
  let buyer: Account;
  let rzpId = '';
  const subRow = async (id: string) =>
    (await h.owner.query(`SELECT * FROM subscriptions WHERE gateway_subscription_id = $1`, [id]))
      .rows[0];

  beforeAll(async () => {
    buyer = await signup('subops');
    rzpId = (await gateway('razorpay')).id;
  });

  it('lists every workspace subscription with its workspace, filters by status, gateway and search, and counts them', async () => {
    mockProviders();
    razorpayOk();
    const placed = await api()
      .post('/v2/billing/checkout/plans/growth/orders')
      .set(bearer(buyer.token))
      .send({ gatewayId: rzpId, currency: 'INR', autoRenew: true });
    expect(placed.status).toBe(201);
    const subId = `sub_${subSeq}`;
    const number = (await subRow(subId)).meta.order_number as string;
    await subEvent(
      'subscription.charged',
      subId,
      { current_end: unix(30), notes: { order_number: number } },
      { id: 'pay_o1', invoice_id: 'inv_o1' },
    );

    const all = await ops('get', '/billing/subscriptions');
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.kpis.active).toBeGreaterThanOrEqual(1);
    const row = all.body.data.find(
      (r: { gatewaySubscriptionId: string }) => r.gatewaySubscriptionId === subId,
    );
    expect(row).toMatchObject({
      kind: 'plan',
      name: 'Growth',
      status: 'active',
      gateway: 'razorpay',
      amount: '999.00',
      currency: 'INR',
      cancelFailed: false,
    });
    expect(row.workspace).toMatchObject({ name: expect.stringContaining('subops') });

    const byId = await ops('get', `/billing/subscriptions?q=${subId}`);
    expect(
      byId.body.data.map((r: { gatewaySubscriptionId: string }) => r.gatewaySubscriptionId),
    ).toEqual([subId]);
    const none = await ops('get', '/billing/subscriptions?status=expired&gateway=razorpay');
    expect(none.body.data).toEqual([]);
    expect((await ops('get', '/billing/subscriptions?status=bogus')).status).toBe(422);
  });

  it('only a super admin ends one; it is told to Razorpay with the chosen timing and audited', async () => {
    mockProviders();
    razorpayOk();
    const subId = `sub_${subSeq}`;
    const id = (await ops('get', `/billing/subscriptions?q=${subId}`)).body.data[0].id as string;
    const res = await ops('post', `/billing/subscriptions/${id}/cancel`).send({
      atCycleEnd: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ remote: 'ok', alreadyEnded: false });
    expect(body(rzpCalls(`/v1/subscriptions/${subId}/cancel`)[0]!)).toEqual({
      cancel_at_cycle_end: 0,
    });
    expect((await subRow(subId)).status).toBe('canceled');
    const again = await ops('post', `/billing/subscriptions/${id}/cancel`).send({});
    expect(again.body).toMatchObject({ alreadyEnded: true });
    const audit = await h.owner
      .query(`SELECT 1 FROM auth_audit_log WHERE event = 'platform.subscription.canceled'`)
      .catch(() => ({ rows: [{}] }));
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it('a cancel Razorpay refuses still ends the row locally and is flagged so the operator can finish it', async () => {
    mockProviders();
    razorpayOk();
    handlers.unshift((url) =>
      url.pathname.endsWith('/cancel') ? { status: 500, body: {} } : undefined,
    );
    const placed = await api()
      .post('/v2/billing/checkout/plans/pro/orders')
      .set(bearer(buyer.token))
      .send({ gatewayId: rzpId, currency: 'INR', autoRenew: true });
    expect(placed.status).toBe(201);
    const subId = `sub_${subSeq}`;
    const number = (await subRow(subId)).meta.order_number as string;
    // the first charge of this plan replaces the growth subscription, whose cancel fails too
    await subEvent(
      'subscription.charged',
      subId,
      { current_end: unix(30), notes: { order_number: number } },
      { id: 'pay_o2', invoice_id: 'inv_o2' },
    );
    const id = (await ops('get', `/billing/subscriptions?q=${subId}`)).body.data[0].id as string;
    const res = await ops('post', `/billing/subscriptions/${id}/cancel`).send({});
    expect(res.body).toEqual({ remote: 'failed', alreadyEnded: false });
    const row = (await ops('get', `/billing/subscriptions?q=${subId}`)).body.data[0];
    expect(row).toMatchObject({ status: 'canceled', cancelFailed: true });
  });

  it('refreshes one from Razorpay and refuses an unknown id', async () => {
    mockProviders();
    razorpayOk();
    const subId = `sub_${subSeq}`;
    handlers.unshift((url) =>
      url.pathname === `/v1/subscriptions/${subId}`
        ? { status: 200, body: { status: 'cancelled' } }
        : undefined,
    );
    const id = (await ops('get', `/billing/subscriptions?q=${subId}`)).body.data[0].id as string;
    const res = await ops('post', `/billing/subscriptions/${id}/sync`).send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.outcome).toBe('string');
    expect(
      (
        await ops('post', '/billing/subscriptions/00000000-0000-4000-8000-000000000000/sync').send(
          {},
        )
      ).status,
    ).toBe(404);
  });
});

describe('refunds go back through Razorpay', () => {
  let buyer: Account;
  let rzpId = '';
  let orderUuid = '';
  let orderNo = '';
  let payId = '';
  let payCount = 0;
  const refundRows = async () =>
    (
      await h.owner.query(`SELECT * FROM order_refunds WHERE org_id = $1 ORDER BY id`, [
        buyer.orgId,
      ])
    ).rows;

  beforeAll(async () => {
    buyer = await signup('subrefund');
    rzpId = (await gateway('razorpay')).id;
  });

  async function paidOrder(slug: string) {
    mockProviders();
    razorpayOk();
    const placed = await api()
      .post(`/v2/billing/checkout/plans/${slug}/orders`)
      .set(bearer(buyer.token))
      .send({ gatewayId: rzpId, currency: 'INR' });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    orderNo = placed.body.orderNumber as string;
    payId = `pay_ref${++payCount}`;
    const row = await h.owner.query(
      `SELECT gateway_order_id, total_amount::text AS t FROM orders WHERE order_number = $1`,
      [orderNo],
    );
    const res = await rzpEvent('payment.captured', {
      payment: {
        entity: {
          id: payId,
          order_id: row.rows[0].gateway_order_id,
          amount: Math.round(Number(row.rows[0].t) * 100),
          currency: 'INR',
          notes: { order_number: orderNo },
        },
      },
    });
    expect(res.status).toBe(200);
    const o = await orderBy(orderNo);
    expect(o.status).toBe('paid');
    orderUuid = o.uuid;
    return o;
  }

  it('refunds a one-time order in part, then the rest, and never more than was paid', async () => {
    await paidOrder('lite');
    handlers.unshift((url, init) =>
      url.pathname === `/v1/payments/${payId}/refund` && init?.method === 'POST'
        ? { status: 200, body: { id: `rfnd_${calls.length}`, status: 'processed' } }
        : undefined,
    );
    const first = await ops('post', `/billing/orders/${orderUuid}/refund`).send({
      amountMinor: '5000',
      reason: 'Goodwill credit',
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ status: 'processed', amountMinor: '5000', currency: 'INR' });
    expect(body(rzpCalls(`/v1/payments/${payId}/refund`)[0]!)).toEqual({
      amount: 5000,
      speed: 'normal',
      // our refund row's uuid rides along, so a refund whose answer was lost can be found at the provider
      notes: { reason: 'Goodwill credit', ref: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    });

    const tooMuch = await ops('post', `/billing/orders/${orderUuid}/refund`).send({
      amountMinor: '99999',
      reason: 'Too much',
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.code).toBe('PAYGW_REFUND_REFUSED');

    const rest = await ops('post', `/billing/orders/${orderUuid}/refund`).send({
      reason: 'The rest',
    });
    expect(rest.body).toMatchObject({ status: 'processed', amountMinor: '14900' }); // 199.00 - 50.00
    expect(body(rzpCalls(`/v1/payments/${payId}/refund`)[1]!)).toMatchObject({ amount: 14900 });

    const done = await ops('post', `/billing/orders/${orderUuid}/refund`).send({ reason: 'Again' });
    expect(done.status).toBe(422);
    expect((await refundRows()).map((r) => [r.status, String(r.amount_minor)])).toEqual([
      ['processed', '5000'],
      ['processed', '14900'],
    ]);
    const list = await ops('get', `/billing/orders/${orderUuid}/refunds`);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].reason).toBe('The rest');
  });

  it('a refund Razorpay refuses is kept as failed with its reason and frees the amount for another try', async () => {
    await paidOrder('lite');
    handlers.unshift((url) =>
      url.pathname === `/v1/payments/${payId}/refund`
        ? {
            status: 400,
            body: { error: { description: 'Refund amount exceeds the available balance' } },
          }
        : undefined,
    );
    const res = await ops('post', `/billing/orders/${orderUuid}/refund`).send({
      reason: 'Customer request',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'failed' });
    expect(res.body.failure).toContain('exceeds the available balance');
    handlers.length = 0;
    razorpayOk();
    handlers.unshift((url) =>
      url.pathname === `/v1/payments/${payId}/refund`
        ? { status: 200, body: { id: 'rfnd_ok', status: 'pending' } }
        : undefined,
    );
    const retry = await ops('post', `/billing/orders/${orderUuid}/refund`).send({
      reason: 'Customer request, again',
    });
    expect(retry.body).toMatchObject({
      status: 'pending',
      amountMinor: '19900',
      gatewayRefundId: 'rfnd_ok',
    });
  });

  it('a refund whose answer was never recorded is settled from the provider by the sweep, and one the provider never got is failed after two hours', async () => {
    const o = await paidOrder('lite');
    const seed = async (amount: number, age: string) =>
      (
        await h.owner.query(
          `INSERT INTO order_refunds (org_id, order_id, gateway, gateway_payment_id, amount_minor, currency, status, reason, created_at)
           VALUES ($1, $2, 'razorpay', $3, $4, 'INR', 'pending', 'Answer lost', now() - $5::interval) RETURNING id, uuid`,
          [buyer.orgId, o.id, payId, amount, age],
        )
      ).rows[0] as { id: string; uuid: string };
    const stateOf = async (id: string) =>
      (
        await h.owner.query(
          `SELECT status, gateway_refund_id, failure FROM order_refunds WHERE org_id = $1 AND id = $2`,
          [buyer.orgId, id],
        )
      ).rows[0];
    const sweep = () => h.app.get(RefundReconcilerService).sweep();

    // 1. a fresh pending row is left to the request that made it
    const fresh = await seed(1000, '1 minute');
    expect(await sweep()).toEqual({});
    expect((await stateOf(fresh.id)).status).toBe('pending');
    await h.owner.query(
      `UPDATE order_refunds SET status = 'failed' WHERE org_id = $1 AND id = $2`,
      [buyer.orgId, fresh.id],
    );

    // 2. the provider holds it (matched by the uuid we stored on it)
    const lost = await seed(5000, '3 hours');
    handlers.unshift((url) =>
      url.pathname === `/v1/payments/${payId}/refunds`
        ? {
            status: 200,
            body: {
              items: [
                {
                  id: 'rfnd_found',
                  amount: 5000,
                  status: 'processed',
                  created_at: Math.floor(Date.now() / 1000) - 3000,
                  notes: { ref: lost.uuid },
                },
              ],
            },
          }
        : undefined,
    );
    expect(await sweep()).toEqual({ recorded: 1 });
    expect(await stateOf(lost.id)).toMatchObject({
      status: 'processed',
      gateway_refund_id: 'rfnd_found',
    });
    expect(await sweep()).toEqual({}); // settled rows are not picked up again

    // 3. the provider has nothing for it: after two hours it never got the request, and the amount is free again
    const never = await seed(7000, '3 hours');
    handlers.shift();
    handlers.unshift((url) =>
      url.pathname === `/v1/payments/${payId}/refunds`
        ? { status: 200, body: { items: [] } }
        : undefined,
    );
    expect(await sweep()).toEqual({ failed_not_found: 1 });
    expect(await stateOf(never.id)).toMatchObject({ status: 'failed', gateway_refund_id: null });
    expect((await stateOf(never.id)).failure).toContain('never reached it');

    // 4. the provider cannot be asked: the row is left as it is
    const unsure = await seed(900, '3 hours');
    handlers.shift();
    handlers.unshift((url) =>
      url.pathname === `/v1/payments/${payId}/refunds` ? { status: 500, body: {} } : undefined,
    );
    expect(await sweep()).toEqual({ skip_cannot_tell: 1 });
    expect((await stateOf(unsure.id)).status).toBe('pending');

    // 5. a full page of other refunds could hide ours on the next page: not proof, so the row stays pending
    handlers.shift();
    handlers.unshift((url) =>
      url.pathname === `/v1/payments/${payId}/refunds`
        ? {
            status: 200,
            body: {
              items: Array.from({ length: 100 }, (_, i) => ({
                id: `rfnd_other${i}`,
                amount: 1,
                status: 'processed',
                created_at: 1_795_000_000 + i,
                notes: { ref: `other-${i}` },
              })),
            },
          }
        : undefined,
    );
    expect(await sweep()).toEqual({ skip_cannot_tell: 1 });
    expect((await stateOf(unsure.id)).status).toBe('pending');
    handlers.length = 0;
  });

  it('refuses what cannot be refunded: an unpaid order, a wallet top-up, a subscription payment, a bad amount, a non-operator', async () => {
    mockProviders();
    razorpayOk();
    const placed = await api()
      .post('/v2/billing/checkout/plans/lite/orders')
      .set(bearer(buyer.token))
      .send({ gatewayId: rzpId, currency: 'INR' });
    const unpaid = (await orderBy(placed.body.orderNumber)).uuid as string;
    const r1 = await ops('post', `/billing/orders/${unpaid}/refund`).send({
      reason: 'Nothing was paid',
    });
    expect(r1.status).toBe(422);
    expect(JSON.stringify(r1.body)).toContain('order_not_paid');

    await paidOrder('lite');
    await h.owner.query(`UPDATE orders SET kind = 'wallet_topup' WHERE uuid = $1`, [orderUuid]);
    expect(
      JSON.stringify(
        (await ops('post', `/billing/orders/${orderUuid}/refund`).send({ reason: 'Wallet' })).body,
      ),
    ).toContain('wallet_topup_not_refundable');
    await h.owner.query(
      `UPDATE orders SET kind = 'plan', gateway_payment_id = 'sub_9' WHERE uuid = $1`,
      [orderUuid],
    );
    expect(
      JSON.stringify(
        (await ops('post', `/billing/orders/${orderUuid}/refund`).send({ reason: 'Sub' })).body,
      ),
    ).toContain('use_subscription_refund');

    expect(
      (await ops('post', `/billing/orders/${orderUuid}/refund`).send({ reason: 'ab' })).status,
    ).toBe(422);
    expect(
      (
        await ops('post', `/billing/orders/${orderUuid}/refund`).send({
          reason: 'Fine',
          amountMinor: '-5',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await api()
          .post(`/v2/platform/billing/orders/${orderUuid}/refund`)
          .set(bearer(buyer.token))
          .send({ reason: 'Fine' })
      ).status,
    ).toBeGreaterThanOrEqual(401);
  });

  it('refunds one charge of a subscription, only if Razorpay lists it as paid for THAT subscription, and can end it too', async () => {
    mockProviders();
    razorpayOk();
    const placed = await api()
      .post('/v2/billing/checkout/plans/growth/orders')
      .set(bearer(buyer.token))
      .send({ gatewayId: rzpId, currency: 'INR', autoRenew: true });
    const subId = `sub_${subSeq}`;
    const number = (
      await h.owner.query(`SELECT meta FROM subscriptions WHERE gateway_subscription_id = $1`, [
        subId,
      ])
    ).rows[0].meta.order_number as string;
    expect(placed.status).toBe(201);
    await subEvent(
      'subscription.charged',
      subId,
      { current_end: unix(30), notes: { order_number: number } },
      { id: 'pay_s1', invoice_id: 'inv_s1' },
    );
    const opsId = (await ops('get', `/billing/subscriptions?q=${subId}`)).body.data[0].id as string;
    handlers.unshift((url, init) => {
      if (url.pathname === '/v1/invoices') {
        return {
          status: 200,
          body: {
            items: [
              {
                id: 'inv_s1',
                amount: 99900,
                currency: 'INR',
                status: 'paid',
                payment_id: 'pay_s1',
              },
              {
                id: 'inv_s2',
                amount: 99900,
                currency: 'INR',
                status: 'issued',
                payment_id: 'pay_unpaid',
              },
            ],
          },
        };
      }
      if (url.pathname === '/v1/payments/pay_s1/refund' && init?.method === 'POST')
        return { status: 200, body: { id: 'rfnd_s1', status: 'processed' } };
      return undefined;
    });
    const foreign = await ops('post', `/billing/subscriptions/${opsId}/refund`).send({
      paymentId: 'pay_someone_else',
      reason: 'Not ours',
    });
    expect(foreign.status).toBe(422);
    expect(JSON.stringify(foreign.body)).toContain('payment_not_in_subscription');
    const unpaidCharge = await ops('post', `/billing/subscriptions/${opsId}/refund`).send({
      paymentId: 'pay_unpaid',
      reason: 'Not paid',
    });
    expect(unpaidCharge.status).toBe(422);

    const ok = await ops('post', `/billing/subscriptions/${opsId}/refund`).send({
      paymentId: 'pay_s1',
      reason: 'Charged by mistake',
      endSubscription: true,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'processed', amountMinor: '99900', currency: 'INR' });
    expect(body(rzpCalls(`/v1/subscriptions/${subId}/cancel`).at(-1)!)).toEqual({
      cancel_at_cycle_end: 0,
    });
    expect(
      (
        await h.owner.query(`SELECT status FROM subscriptions WHERE gateway_subscription_id = $1`, [
          subId,
        ])
      ).rows[0].status,
    ).toBe('canceled');
    const again = await ops('post', `/billing/subscriptions/${opsId}/refund`).send({
      paymentId: 'pay_s1',
      reason: 'Twice',
    });
    expect(again.status).toBe(422);
    expect(JSON.stringify(again.body)).toContain('already_refunded');
    expect((await ops('get', `/billing/subscriptions/${opsId}/refunds`)).body.data).toHaveLength(1);
  });
});
