import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { marketAppDetailSchema, type MarketAppDetail } from '@crm/contracts';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { MarketSubscriptionLifecycle } from '../../../src/modules/marketplace/subscription-lifecycle.service';
import { MarketSubscriptionNotificationsConsumer } from '../../../src/modules/marketplace/subscription-notifications.consumer';
import {
  Api,
  bearer,
  code,
  marketApi,
  miniManifest,
  operatorLogin,
  platformApi,
  publishListing,
  startHarness,
  superOperator,
  type Harness,
  type Tenant,
} from './support';
import { OPERATOR_EMAIL } from '../auth-registration-security/harness';

/**
 * Apps whose card renewal is automatic (BL-070), end to end against a real Postgres (forced row-level security), the real AppModule and the
 * real checkout. Only the far end of the payment provider is faked (Razorpay: global fetch and its signed webhooks), so the order, the
 * provider subscription row, the add-on term, the Marketplace ledger, the sweep, the audit rows and the outbox events are real.
 *
 * Nothing here runs against a real payment gateway.
 */
let h: Harness;
let api: Api;
let superToken = '';
let reviewerToken = '';
const ops = () => platformApi(h, superToken);
const mp = (t: Tenant) => marketApi(h, t.admin);
const http = () => request(h.app.getHttpServer());
const SLUG = 'recur-app';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async (q: string, p: unknown[] = []): Promise<Row[]> =>
  (await h.owner.query(q, p)).rows;
const one = async (q: string, p: unknown[] = []): Promise<Row> => (await rows(q, p))[0]!;
const count = async (q: string, p: unknown[] = []): Promise<number> => Number((await one(q, p)).n);

// --- the far end of the provider ----------------------------------------------------------------------------------------------------

type Handler = (url: URL, init?: RequestInit) => { status: number; body: unknown } | undefined;
const handlers: Handler[] = [];
const calls: Array<{ url: string; body: string }> = [];
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
let subSeq = 0;
let planSeq = 0;
let cancelFails = false;
function mockProviders() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, init);
    calls.push({ url: url.href, body: String(init?.body ?? '') });
    if (url.hostname === 'api.razorpay.com') {
      if (url.pathname === '/v1/plans') return jsonRes(200, { id: `plan_${++planSeq}` });
      if (url.pathname === '/v1/subscriptions') return jsonRes(200, { id: `sub_${++subSeq}` });
      if (url.pathname.endsWith('/cancel'))
        return cancelFails
          ? jsonRes(500, { error: { description: 'down' } })
          : jsonRes(200, { status: 'cancelled' });
    }
    for (const hnd of handlers) {
      const r = hnd(url, init);
      if (r) return jsonRes(r.status, r.body);
    }
    throw new Error(`unexpected provider call ${url.href}`);
  });
}
const cancelCalls = () =>
  calls.filter((c) => new URL(c.url).pathname.endsWith('/cancel')).map((c) => JSON.parse(c.body));

const WHSEC = 'whsec_recur';
const signRzp = (raw: string) => createHmac('sha256', WHSEC).update(raw).digest('hex');
const rzpEvent = (event: string, payload: Record<string, unknown>) => {
  const raw = JSON.stringify({ event, payload });
  return http()
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
let payment = 0;
const charged = (subId: string, endDays: number, orderNumber?: string) =>
  subEvent('subscription.charged', subId, {
    sub: {
      current_end: unix(endDays),
      ...(orderNumber ? { notes: { order_number: orderNumber } } : {}),
    },
    payment: { id: `pay_${++payment}`, invoice_id: `inv_${payment}` },
  });

let gatewayId = '';
let packSlug = '';
const events = (orgId: number, type: string) =>
  count(`SELECT count(*) AS n FROM event_outbox WHERE org_id = $1 AND event_type = $2`, [
    orgId,
    type,
  ]);
const ledger = (t: Tenant) =>
  one(
    `SELECT s.* FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id WHERE s.org_id = $1 AND a.slug = $2`,
    [t.orgId, SLUG],
  );
const providerSub = (id: string) =>
  one(`SELECT * FROM subscriptions WHERE gateway_subscription_id = $1`, [id]);
const detail = async (t: Tenant): Promise<MarketAppDetail> => {
  const res = await mp(t).get(`/apps/${SLUG}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return marketAppDetailSchema.parse(res.body);
};
const installation = (t: Tenant) =>
  one(
    `SELECT i.* FROM workspace_app_installations i JOIN marketplace_apps a ON a.id = i.app_id WHERE i.org_id = $1 AND a.slug = $2`,
    [t.orgId, SLUG],
  );
async function installApp(t: Tenant): Promise<void> {
  await h.owner.query(
    `INSERT INTO workspace_app_installations (org_id, app_id, installed_version_id, status)
     SELECT $1, a.id, v.id, 'active' FROM marketplace_apps a JOIN marketplace_app_versions v ON v.app_id = a.id
      WHERE a.slug = $2 ORDER BY v.id DESC LIMIT 1 ON CONFLICT (org_id, app_id) DO NOTHING`,
    [t.orgId, SLUG],
  );
}
async function setting(key: string, value: unknown) {
  await h.owner.query(
    `INSERT INTO platform_settings (key, value, is_secret) VALUES ($1, $2::jsonb, false)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
  h.app.get(PlatformSettingsService).invalidate();
  h.app.get(PlanEntitlementService).forgetGrace();
}

/** Places the order for the app's recurring add-on and sends the provider's first-charge notice. Returns the provider subscription id. */
async function subscribe(
  t: Tenant,
  endDays = 30,
  pack = packSlug,
): Promise<{ subId: string; order: string }> {
  mockProviders();
  const placed = await http()
    .post(`/v2/billing/checkout/plans/${pack}/orders`)
    .set(bearer(t.admin))
    .send({ gatewayId, currency: 'INR' });
  expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  const order = placed.body.orderNumber as string;
  const sub = await one(
    `SELECT gateway_subscription_id AS id FROM subscriptions WHERE meta ->> 'order_number' = $1`,
    [order],
  );
  const res = await charged(sub.id as string, endDays, order);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { subId: sub.id as string, order };
}

beforeAll(async () => {
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/marketplace')).MarketplaceWorkerModule,
    ],
  });
  api = new Api(h);
  superToken = await superOperator(h);
  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role)
     SELECT 'reviewer@platform.test', 'Reviewer', password_hash, 'auditor' FROM platform_operators WHERE email = $1`,
    [OPERATOR_EMAIL],
  );
  const role = await http()
    .post('/v2/platform/roles')
    .set(bearer(superToken))
    .send({ name: 'Market reviewer', permissions: ['platform.market.review'] });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  const staff = await http().get('/v2/platform/staff').set(bearer(superToken));
  const rv = (staff.body.data as Array<{ id: string; email: string }>).find(
    (s) => s.email === 'reviewer@platform.test',
  )!;
  expect(
    (
      await http()
        .put(`/v2/platform/staff/${rv.id}/roles`)
        .set(bearer(superToken))
        .send({ roleIds: [role.body.id] })
    ).status,
  ).toBe(200);
  reviewerToken = await operatorLogin(h, 'reviewer@platform.test');

  await setting('default_currency', 'INR');
  await setting('pricing.recurring_enabled', true);
  await setting('billing.grace_days', 7);
  const list = await http().get('/v2/platform/payment-gateways').set(bearer(superToken));
  const g = (list.body.data as Array<{ id: string; slug: string; rowVersion: number }>).find(
    (x) => x.slug === 'razorpay',
  )!;
  const conf = await http()
    .patch(`/v2/platform/payment-gateways/${g.id}`)
    .set(bearer(superToken))
    .send({
      mode: 'sandbox',
      credentials: { key_id: 'rzp_test_1', key_secret: 'rzp_secret', webhook_secret: WHSEC },
      rowVersion: g.rowVersion,
    });
  expect(conf.status, JSON.stringify(conf.body)).toBe(200);
  const act = await http()
    .post(`/v2/platform/payment-gateways/${g.id}/active`)
    .set(bearer(superToken))
    .send({ isActive: true, rowVersion: conf.body.rowVersion });
  expect(act.status, JSON.stringify(act.body)).toBe(201);
  gatewayId = g.id;

  await h.owner.query(
    `INSERT INTO plans (slug, kind, name, amount, currency, sort_order, is_free) VALUES ('freebie', 'plan', 'Freebie', 0, 'INR', 1, true)`,
  );
  await publishListing(
    h,
    { manage: superToken, review: reviewerToken },
    {
      manifest: miniManifest({ id: SLUG, name: 'Recur App', scopes: ['contacts.read'] }),
    },
  );
}, 600_000);

afterAll(async () => {
  await h?.stop();
});
afterEach(() => {
  vi.restoreAllMocks();
  handlers.length = 0;
  calls.length = 0;
  cancelFails = false;
});

const tenants: Record<string, Tenant> = {};
async function tenant(label: string): Promise<Tenant> {
  const t = await api.signup(`rec${label}`);
  await h.owner.query(`UPDATE organizations SET plan = 'freebie' WHERE id = $1`, [t.orgId]);
  tenants[label] = t;
  return t;
}
const sweep = () => h.app.get(MarketSubscriptionLifecycle).sweep();

describe('the operator makes an app renew by card', () => {
  it('a recurring listing creates a recurring add-on; a free one cannot be recurring', async () => {
    const free = await ops().put(`/apps/${SLUG}/pricing`, {
      rowVersion: (await one(`SELECT row_version FROM marketplace_apps WHERE slug = $1`, [SLUG]))
        .row_version,
      model: 'free',
      billingMode: 'recurring',
    });
    expect(free.status).toBe(422);
    const res = await ops().put(`/apps/${SLUG}/pricing`, {
      rowVersion: (await one(`SELECT row_version FROM marketplace_apps WHERE slug = $1`, [SLUG]))
        .row_version,
      model: 'paid_monthly',
      amount: '499',
      currency: 'INR',
      billingMode: 'recurring',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pricing).toMatchObject({ billingMode: 'recurring', amount: '499.00' });
    const pack = await one(
      `SELECT p.* FROM plans p JOIN marketplace_apps a ON a.id = p.marketplace_app_id WHERE a.slug = $1`,
      [SLUG],
    );
    expect(pack.billing_mode).toBe('recurring');
    packSlug = pack.slug as string;
    await h.owner.query(
      `INSERT INTO plan_visible_addons (plan_id, addon_plan_id) SELECT p.id, $1 FROM plans p WHERE p.kind = 'plan' ON CONFLICT DO NOTHING`,
      [pack.id],
    );
  });
});

describe('the card renews the app and the ledger follows the provider', () => {
  let A: Tenant;
  let subId = '';

  it('the first charge starts the subscription: it renews on its own, until the provider period end', async () => {
    A = await tenant('A');
    await installApp(A);
    const quote = await http()
      .get(`/v2/billing/checkout/plans/${packSlug}/quote?currency=INR`)
      .set(bearer(A.admin));
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(quote.body.gateways.find((g: { name: string }) => g.name === 'Razorpay').autoRenew).toBe(
      true,
    );
    ({ subId } = await subscribe(A, 35));
    const s = await ledger(A);
    expect(s).toMatchObject({
      status: 'active',
      source: 'purchase',
      autorenew: true,
      renewals_count: 0,
    });
    // the provider's end (seconds), give or take the seconds the test itself took
    expect(Math.abs(new Date(s.current_period_end).getTime() - unix(35) * 1000)).toBeLessThan(
      10_000,
    );
    const d = await detail(A);
    expect(d.subscription).toMatchObject({ status: 'active', autoRenew: true });
    expect(d.subscription!.actions.canRenew).toBe(false);
    expect(d.pricing.billingMode).toBe('recurring');
    expect(await events(A.orgId, 'marketplace.subscription.started')).toBe(1);
  });

  it('a renewal updates the ledger (period end, renewals count); the same payment delivered twice counts once', async () => {
    const send = () =>
      subEvent('subscription.charged', subId, {
        sub: { current_end: unix(65) },
        payment: { id: 'pay_renew', invoice_id: 'inv_renew' },
      });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const s = await ledger(A);
    expect(s.renewals_count).toBe(1);
    expect(s.last_renewed_at).not.toBeNull();
    expect(new Date(s.current_period_end).getTime()).toBe(unix(65) * 1000);
    expect(await events(A.orgId, 'marketplace.subscription.renewed')).toBe(1);
  });

  it('a failed renewal is past due with the grace days: the app keeps working, the sweep leaves it alone, then it lapses', async () => {
    expect((await subEvent('subscription.pending', subId)).status).toBe(200);
    expect((await subEvent('subscription.pending', subId)).status).toBe(200);
    let s = await ledger(A);
    expect(s.payment_failed_at).not.toBeNull();
    expect(new Date(s.grace_ends_at).getTime() - new Date(s.current_period_end).getTime()).toBe(
      7 * 86_400_000,
    );
    expect(await events(A.orgId, 'marketplace.subscription.payment_failed')).toBe(1);
    expect((await detail(A)).subscription).toMatchObject({
      status: 'past_due',
      actions: { canRenew: true, canCancel: true },
    });

    // the paid period ended two days ago; the 7 grace days have not run out
    await h.owner.query(
      `UPDATE workspace_addons SET starts_at = now() - interval '40 days', ends_at = now() - interval '2 days' WHERE org_id = $1`,
      [A.orgId],
    );
    await h.owner.query(
      `UPDATE marketplace_subscriptions SET current_period_end = now() - interval '2 days', grace_ends_at = now() + interval '5 days' WHERE org_id = $1`,
      [A.orgId],
    );
    expect(await sweep()).toMatchObject({ lapsed: 0 });
    expect((await installation(A)).status).toBe('active');
    expect((await detail(A)).subscription!.status).toBe('past_due');

    // grace over
    await h.owner.query(
      `UPDATE workspace_addons SET ends_at = now() - interval '8 days' WHERE org_id = $1`,
      [A.orgId],
    );
    await h.owner.query(
      `UPDATE marketplace_subscriptions SET current_period_end = now() - interval '8 days', grace_ends_at = now() - interval '1 day' WHERE org_id = $1`,
      [A.orgId],
    );
    expect(await sweep()).toMatchObject({ lapsed: 1, paused: 1 });
    s = await ledger(A);
    expect(s.status).toBe('lapsed');
    expect((await installation(A)).status).toBe('disabled');
    expect((await detail(A)).subscription!.status).toBe('ended');
  });

  it('a late recovered charge revives the subscription and switches the installation back on', async () => {
    const res = await subEvent('subscription.charged', subId, {
      sub: { current_end: unix(30) },
      payment: { id: 'pay_recover', invoice_id: 'inv_recover' },
    });
    expect(res.status).toBe(200);
    const s = await ledger(A);
    expect(s).toMatchObject({
      status: 'active',
      autorenew: true,
      payment_failed_at: null,
      grace_ends_at: null,
    });
    expect((await installation(A)).status).toBe('active');
    expect(await events(A.orgId, 'marketplace.subscription.resubscribed')).toBe(1);
  });

  it('cancelling ends the provider subscription at the period end first; it cannot be taken back, paying again can', async () => {
    mockProviders();
    const res = await mp(A).post(`/apps/${SLUG}/subscription/cancel`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(cancelCalls()).toEqual([{ cancel_at_cycle_end: 1 }]);
    expect(res.body.subscription).toMatchObject({
      status: 'canceling',
      autoRenew: false,
      actions: { canResume: false, canRenew: true, canCancel: false },
    });
    expect((await providerSub(subId)).status).toBe('canceled');
    const s = await ledger(A);
    expect(s).toMatchObject({ cancel_at_period_end: true, autorenew: false });
    expect(s.autorenew_stopped_at).not.toBeNull();
    const resume = await mp(A).post(`/apps/${SLUG}/subscription/resume`);
    expect(resume.status).toBe(409);
    expect(code(resume)).toBe('MKT_SUBSCRIPTION_STATE');
    // the provider confirming what we did changes nothing
    expect((await subEvent('subscription.cancelled', subId)).status).toBe(200);
    expect(await events(A.orgId, 'marketplace.subscription.canceled')).toBe(1);

    // paying again starts a new card subscription and takes the cancellation back
    const again = await subscribe(A, 60);
    const s2 = await ledger(A);
    expect(s2).toMatchObject({
      cancel_at_period_end: false,
      autorenew: true,
      autorenew_stopped_at: null,
    });
    expect((await providerSub(again.subId)).status).toBe('active');
  });

  it('paying again while a card subscription is live replaces it: one provider subscription charges, never two', async () => {
    const live = (
      await one(
        `SELECT gateway_subscription_id AS id FROM subscriptions WHERE org_id = $1 AND status = 'active' AND kind = 'addon'`,
        [A.orgId],
      )
    ).id as string;
    // checkout refuses paying more than about two months ahead: let the time already paid for run down to ten days first
    await h.owner.query(
      `UPDATE workspace_addons SET starts_at = now() - interval '20 days', ends_at = now() + interval '10 days' WHERE org_id = $1`,
      [A.orgId],
    );
    const next = await subscribe(A, 90);
    expect((await providerSub(live)).status).toBe('canceled');
    expect((await providerSub(next.subId)).status).toBe('active');
    expect(cancelCalls().at(-1)).toEqual({ cancel_at_cycle_end: 0 });
    // the replaced subscription's end must not undo the new one on the ledger
    expect(await ledger(A)).toMatchObject({ autorenew: true, autorenew_stopped_at: null });
    expect(
      await count(
        `SELECT count(*) AS n FROM subscriptions WHERE org_id = $1 AND status IN ('active','past_due') AND kind = 'addon'`,
        [A.orgId],
      ),
    ).toBe(1);
  });
});

describe('what must never happen: saying cancelled while the card is still charged', () => {
  it('when the provider cannot confirm, nothing changes and the person is told to try again', async () => {
    const B = await tenant('B');
    await installApp(B);
    const { subId } = await subscribe(B, 30);
    cancelFails = true;
    mockProviders();
    const res = await mp(B).post(`/apps/${SLUG}/subscription/cancel`);
    expect(res.status).toBe(502);
    expect(code(res)).toBe('MKT_RENEWAL_NOT_STOPPED');
    expect(await ledger(B)).toMatchObject({ cancel_at_period_end: false, autorenew: true });
    expect((await providerSub(subId)).status).toBe('active');
    // a second try, with the provider back, works
    cancelFails = false;
    const ok = await mp(B).post(`/apps/${SLUG}/subscription/cancel`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await providerSub(subId)).status).toBe('canceled');
  });

  it('the provider ending the subscription on its own makes the app not renew, without anyone asking', async () => {
    const C = await tenant('C');
    await installApp(C);
    const { subId } = await subscribe(C, 30);
    expect((await subEvent('subscription.cancelled', subId)).status).toBe(200);
    expect(await ledger(C)).toMatchObject({ cancel_at_period_end: true, autorenew: false });
    expect((await detail(C)).subscription).toMatchObject({ status: 'canceling', autoRenew: false });
    expect(await events(C.orgId, 'marketplace.subscription.canceled')).toBe(1);
  });
});

describe('a year at a time (BL-072)', () => {
  const YEAR = 'year-app';
  let Y: Tenant;
  let yearPack = '';

  it('the operator sets a yearly price: the add-on carries it, and a monthly-only app offers no year', async () => {
    await publishListing(
      h,
      { manage: superToken, review: reviewerToken },
      {
        manifest: miniManifest({ id: YEAR, name: 'Year App', scopes: ['contacts.read'] }),
      },
    );
    const rv = async () =>
      (await one(`SELECT row_version FROM marketplace_apps WHERE slug = $1`, [YEAR])).row_version;
    const bad = await ops().put(`/apps/${YEAR}/pricing`, {
      rowVersion: await rv(),
      model: 'paid_monthly',
      amount: '499',
      currency: 'INR',
      annualAmount: '0',
    });
    expect(bad.status).toBe(422);
    const res = await ops().put(`/apps/${YEAR}/pricing`, {
      rowVersion: await rv(),
      model: 'paid_monthly',
      amount: '499',
      currency: 'INR',
      annualAmount: '4990',
      billingMode: 'recurring',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const pack = await one(
      `SELECT p.* FROM plans p JOIN marketplace_apps a ON a.id = p.marketplace_app_id WHERE a.slug = $1`,
      [YEAR],
    );
    expect(pack.annual_amount).toBe('4990.00');
    yearPack = pack.slug as string;
    await h.owner.query(
      `INSERT INTO plan_visible_addons (plan_id, addon_plan_id) SELECT p.id, $1 FROM plans p WHERE p.kind = 'plan' ON CONFLICT DO NOTHING`,
      [pack.id],
    );
    Y = await tenant('Y');
    const monthlyOnly = await mp(Y).post(`/apps/${SLUG}/subscribe`, { period: 'yearly' });
    expect(monthlyOnly.status).toBe(422);
  });

  it('Subscribe yearly answers with the yearly checkout; the quote is the listing yearly price, not twelve months', async () => {
    const sub = await mp(Y).post(`/apps/${YEAR}/subscribe`, { period: 'yearly' });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.checkout.path).toContain('period=yearly');
    expect(sub.body.checkout.path).toContain('return=%2Fmarketplace%2Fapp%2Fyear-app');
    const monthly = await http()
      .get(`/v2/billing/checkout/plans/${yearPack}/quote?currency=INR`)
      .set(bearer(Y.admin));
    expect(monthly.body).toMatchObject({
      billingPeriod: 'monthly',
      subtotal: '499.00',
      periods: ['monthly', 'yearly'],
    });
    const yearly = await http()
      .get(`/v2/billing/checkout/plans/${yearPack}/quote?currency=INR&period=yearly`)
      .set(bearer(Y.admin));
    expect(yearly.status, JSON.stringify(yearly.body)).toBe(200);
    expect(yearly.body).toMatchObject({
      billingPeriod: 'yearly',
      subtotal: '4990.00',
      total: '4990.00',
    });
    expect(
      yearly.body.gateways.find((g: { name: string }) => g.name === 'Razorpay').autoRenew,
    ).toBe(true);
  });

  it('paying yearly asks the provider for a yearly plan, grants a year, and the ledger keeps the yearly price', async () => {
    mockProviders();
    const placed = await http()
      .post(`/v2/billing/checkout/plans/${yearPack}/orders`)
      .set(bearer(Y.admin))
      .send({ gatewayId, currency: 'INR', period: 'yearly' });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const planCall = calls.find((c) => new URL(c.url).pathname === '/v1/plans')!;
    const body = JSON.parse(planCall.body);
    expect(body).toMatchObject({ period: 'yearly', interval: 1, item: { amount: 499000 } });
    const order = placed.body.orderNumber as string;
    const sub = await one(
      `SELECT gateway_subscription_id AS id, billing_cycle FROM subscriptions WHERE meta ->> 'order_number' = $1`,
      [order],
    );
    expect(sub.billing_cycle).toBe('yearly');
    const res = await charged(sub.id as string, 365, order);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = await one(
      `SELECT s.* FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id WHERE s.org_id = $1 AND a.slug = $2`,
      [Y.orgId, YEAR],
    );
    expect(s).toMatchObject({ billing_period: 'yearly', amount: '4990.00', autorenew: true });
    // the add-on runs a full year from the payment; the provider's date is never allowed to shorten it
    expect(new Date(s.current_period_end).getTime()).toBeGreaterThanOrEqual(
      unix(365) * 1000 - 10_000,
    );
    const addon = await one(`SELECT starts_at, ends_at FROM workspace_addons WHERE org_id = $1`, [
      Y.orgId,
    ]);
    const days =
      (new Date(addon.ends_at).getTime() - new Date(addon.starts_at).getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(364);
    const view = await mp(Y).get(`/apps/${YEAR}`);
    expect(view.body.subscription).toMatchObject({
      period: 'yearly',
      amount: '4990.00',
      autoRenew: true,
    });
    // a yearly renewal extends by the provider's date, and the operator's monthly figure counts a twelfth
    const renew = await subEvent('subscription.charged', sub.id as string, {
      sub: { current_end: unix(730) },
      payment: { id: 'pay_year2', invoice_id: 'inv_year2' },
    });
    expect(renew.status).toBe(200);
    const summary = await ops().get('/subscriptions/summary');
    const row = (summary.body.data as Array<{ slug: string; mrr: Array<{ amount: string }> }>).find(
      (r) => r.slug === YEAR,
    )!;
    expect(row.mrr).toEqual([{ currency: 'INR', amount: '415.83' }]);
  });
});

describe('a coupon for one app (BL-078)', () => {
  it('a coupon naming the add-on of one app applies to that app only, and the picker lists the add-on by the app name', async () => {
    const K = await tenant('K');
    const options = await http().get('/v2/platform/billing-options').set(bearer(superToken));
    expect(options.status, JSON.stringify(options.body)).toBe(200);
    expect(
      (options.body.plans as Array<{ slug: string; name: string; kind: string }>).find(
        (p) => p.slug === packSlug,
      ),
    ).toMatchObject({ kind: 'addon', name: 'Recur App (Marketplace)' });

    const created = await http()
      .post('/v2/platform/coupons')
      .set(bearer(superToken))
      .send({ code: 'APP20', type: 'percent', amount: '20', applicablePlans: [packSlug] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const onApp = await http()
      .get(`/v2/billing/checkout/plans/${packSlug}/quote?currency=INR&coupon=APP20`)
      .set(bearer(K.admin));
    expect(onApp.status, JSON.stringify(onApp.body)).toBe(200);
    expect(onApp.body.coupon).toMatchObject({ code: 'APP20', ok: true, discount: '99.80' });
    expect(onApp.body).toMatchObject({ subtotal: '499.00', discount: '99.80', total: '399.20' });

    const other = await one(
      `SELECT p.slug FROM plans p JOIN marketplace_apps a ON a.id = p.marketplace_app_id WHERE a.slug = 'year-app'`,
    );
    const onOtherApp = await http()
      .get(`/v2/billing/checkout/plans/${other.slug}/quote?currency=INR&coupon=APP20`)
      .set(bearer(K.admin));
    expect(onOtherApp.status, JSON.stringify(onOtherApp.body)).toBe(200);
    expect(onOtherApp.body.coupon).toMatchObject({ ok: false });
    expect(onOtherApp.body.discount).toBe('0.00');
  });
});

describe('renewal reminders (BL-076)', () => {
  let R: Tenant;
  const notices = (type: string) =>
    count(`SELECT count(*) AS n FROM inbox_notifications WHERE org_id = $1 AND type = $2`, [
      R.orgId,
      type,
    ]);

  it('a few days before the period ends the admins are told, once per period; a renewal earns a fresh reminder', async () => {
    R = await tenant('R');
    await installApp(R);
    await subscribe(R, 30);
    const lifecycle = h.app.get(MarketSubscriptionLifecycle);
    // 30 days to go: nothing is due yet
    await lifecycle.remindDue();
    expect(await events(R.orgId, 'marketplace.subscription.renewal_due')).toBe(0);
    await h.owner.query(
      `UPDATE marketplace_subscriptions SET current_period_end = now() + interval '3 days' WHERE org_id = $1`,
      [R.orgId],
    );
    expect(await lifecycle.remindDue()).toBeGreaterThanOrEqual(1);
    expect(await lifecycle.remindDue()).toBe(0);
    expect(await events(R.orgId, 'marketplace.subscription.renewal_due')).toBe(1);
    const ev = await one(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'marketplace.subscription.renewal_due'`,
      [R.orgId],
    );
    expect(ev.payload).toMatchObject({
      app: SLUG,
      autorenew: true,
      canceling: false,
      by: 'system',
    });
    // the period moves (a renewal): the next period is reminded again
    await h.owner.query(
      `UPDATE marketplace_subscriptions SET current_period_end = now() + interval '2 days' WHERE org_id = $1`,
      [R.orgId],
    );
    await lifecycle.remindDue();
    expect(await events(R.orgId, 'marketplace.subscription.renewal_due')).toBe(2);
    // a failed renewal has its own notice: no reminder on top
    await h.owner.query(
      `UPDATE marketplace_subscriptions SET current_period_end = now() + interval '1 day', payment_failed_at = now() WHERE org_id = $1`,
      [R.orgId],
    );
    await lifecycle.remindDue();
    expect(await events(R.orgId, 'marketplace.subscription.renewal_due')).toBe(2);
    await h.owner.query(
      `UPDATE marketplace_subscriptions SET payment_failed_at = NULL WHERE org_id = $1`,
      [R.orgId],
    );
  });

  it('the consumer writes one in-app notice per admin per event, however many times the event is delivered', async () => {
    const consumer = h.app.get(MarketSubscriptionNotificationsConsumer);
    const ev = await one(
      `SELECT id::text AS id, payload FROM event_outbox WHERE org_id = $1 AND event_type = 'marketplace.subscription.renewal_due' ORDER BY id LIMIT 1`,
      [R.orgId],
    );
    const event = {
      id: ev.id as string,
      orgId: R.orgId,
      aggregateModule: 'marketplace_subscriptions',
      aggregateId: '1',
      eventType: 'marketplace.subscription.renewal_due',
      payload: ev.payload as Record<string, unknown>,
    };
    await consumer.handle(event);
    await consumer.handle(event);
    expect(await notices('marketplace_renewal_due')).toBe(1);
    const row = await one(
      `SELECT title, link, data FROM inbox_notifications WHERE org_id = $1 AND type = 'marketplace_renewal_due'`,
      [R.orgId],
    );
    expect(row.title).toMatch(/renews on/);
    expect(row.link).toBe(`/marketplace/app/${SLUG}`);
    expect(row.data).toMatchObject({ appSlug: SLUG, autoRenew: true });

    // a failed payment and a clock lapse each notify; an operator's own cancel does not
    const grace = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await consumer.handle({
      ...event,
      id: '9001',
      eventType: 'marketplace.subscription.payment_failed',
      payload: { app: SLUG, by: 'system', graceEndsAt: grace },
    });
    await consumer.handle({
      ...event,
      id: '9002',
      eventType: 'marketplace.subscription.lapsed',
      payload: { app: SLUG, by: 'system' },
    });
    await consumer.handle({
      ...event,
      id: '9003',
      eventType: 'marketplace.subscription.lapsed',
      payload: { app: SLUG, by: 'operator:1' },
    });
    expect(await notices('marketplace_payment_failed')).toBe(1);
    expect(await notices('marketplace_subscription_ended')).toBe(1);
  });
});

/** Prices an app through the real operator API and makes its add-on visible to every plan, as an operator who wants everyone to see it would. */
async function priceApp(slug: string, body: Record<string, unknown>): Promise<string> {
  const rv = (await one(`SELECT row_version FROM marketplace_apps WHERE slug = $1`, [slug]))
    .row_version;
  const res = await ops().put(`/apps/${slug}/pricing`, {
    rowVersion: rv,
    model: 'paid_monthly',
    currency: 'INR',
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const pack = await one(
    `SELECT p.id, p.slug FROM plans p JOIN marketplace_apps a ON a.id = p.marketplace_app_id WHERE a.slug = $1`,
    [slug],
  );
  await h.owner.query(
    `INSERT INTO plan_visible_addons (plan_id, addon_plan_id) SELECT p.id, $1 FROM plans p WHERE p.kind = 'plan' ON CONFLICT DO NOTHING`,
    [pack.id],
  );
  return pack.slug as string;
}
const ledgerOf = (t: Tenant, slug: string) =>
  one(
    `SELECT s.* FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id WHERE s.org_id = $1 AND a.slug = $2`,
    [t.orgId, slug],
  );
const quoteOf = async (t: Tenant, pack: string) => {
  const res = await http()
    .get(`/v2/billing/checkout/plans/${pack}/quote?currency=INR`)
    .set(bearer(t.admin));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { subtotal: string; total: string };
};

describe('a subscriber keeps the price they first paid (BL-071)', () => {
  const LOCK = 'lock-app';
  let pack = '';
  let L: Tenant;
  let N: Tenant;

  it('with the lock on, a price rise reaches new subscribers only: the next order of a locked subscriber is priced at what they paid', async () => {
    await publishListing(
      h,
      { manage: superToken, review: reviewerToken },
      {
        manifest: miniManifest({ id: LOCK, name: 'Lock App', scopes: ['contacts.read'] }),
      },
    );
    pack = await priceApp(LOCK, { amount: '499', billingMode: 'recurring', priceLock: true });
    L = await tenant('L');
    await installApp(L);
    await subscribe(L, 30, pack);
    expect(await ledgerOf(L, LOCK)).toMatchObject({ price_locked: true, amount: '499.00' });

    await priceApp(LOCK, { amount: '699', billingMode: 'recurring', priceLock: true });
    const M = await tenant('M');
    expect((await quoteOf(M, pack)).subtotal).toBe('699.00');
    expect((await quoteOf(L, pack)).subtotal).toBe('499.00');
    const view = await mp(L).get(`/apps/${LOCK}`);
    expect(view.body.subscription).toMatchObject({
      priceLocked: true,
      amount: '499.00',
      nextAmount: null,
    });

    // paying again (replacing the live card subscription) is priced at the locked amount and keeps the lock
    mockProviders();
    const placed = await http()
      .post(`/v2/billing/checkout/plans/${pack}/orders`)
      .set(bearer(L.admin))
      .send({ gatewayId, currency: 'INR' });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const order = await one(
      `SELECT total_amount::text AS total FROM orders WHERE order_number = $1`,
      [placed.body.orderNumber],
    );
    expect(Number(order.total)).toBe(499);
  });

  it('turning the lock on locks today subscribers at their last payment; turning it off unlocks nobody', async () => {
    const slug = 'lock-late';
    await publishListing(
      h,
      { manage: superToken, review: reviewerToken },
      {
        manifest: miniManifest({ id: slug, name: 'Lock Late', scopes: ['contacts.read'] }),
      },
    );
    const latePack = await priceApp(slug, {
      amount: '499',
      billingMode: 'recurring',
      priceLock: false,
    });
    N = await tenant('N');
    await installApp(N);
    mockProviders();
    await subscribe(N, 30, latePack);
    expect((await ledgerOf(N, slug)).price_locked).toBe(false);
    await priceApp(slug, { amount: '599', billingMode: 'recurring', priceLock: true });
    expect(await ledgerOf(N, slug)).toMatchObject({ price_locked: true, amount: '499.00' });
    await priceApp(slug, { amount: '599', billingMode: 'recurring', priceLock: false });
    expect((await ledgerOf(N, slug)).price_locked).toBe(true);
    // the lock ends with the subscription: a lapse releases it, so subscribing again is the listing price
    await h.owner.query(
      `UPDATE workspace_addons SET starts_at = now() - interval '40 days', ends_at = now() - interval '9 days' WHERE org_id = $1`,
      [N.orgId],
    );
    await h.owner.query(
      `UPDATE subscriptions SET status = 'canceled' WHERE org_id = $1 AND kind = 'addon'`,
      [N.orgId],
    );
    await h.owner.query(
      `UPDATE marketplace_subscriptions SET current_period_end = now() - interval '9 days' WHERE org_id = $1`,
      [N.orgId],
    );
    await sweep();
    expect(await ledgerOf(N, slug)).toMatchObject({ status: 'lapsed', price_locked: false });
    expect((await quoteOf(N, latePack)).subtotal).toBe('599.00');
  });

  it('the operator can release one subscriber: their card renewal ends at the period end and the next price is the listing price', async () => {
    mockProviders();
    const live = await ledgerOf(L, LOCK);
    const reviewerTry = await http()
      .post(`/v2/platform/marketplace/subscriptions/${live.uuid}/unlock-price`)
      .set(bearer(reviewerToken))
      .send({ reason: 'goodwill review' });
    expect(reviewerTry.status).toBe(403);
    const res = await ops().post(`/subscriptions/${live.uuid}/unlock-price`, {
      reason: 'repricing agreed with the customer',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      priceLocked: false,
      autoRenew: false,
      cancelAtPeriodEnd: true,
    });
    expect(cancelCalls().every((c) => c.cancel_at_cycle_end === 1)).toBe(true);
    expect(await ledgerOf(L, LOCK)).toMatchObject({ price_locked: false, autorenew: false });
    expect((await quoteOf(L, pack)).subtotal).toBe('699.00');
    const again = await ops().post(`/subscriptions/${live.uuid}/unlock-price`, {
      reason: 'second attempt here',
    });
    expect(again.status).toBe(409);
    expect(await events(L.orgId, 'marketplace.subscription.price_unlocked')).toBe(1);
  });
});

describe('returning the unused time (BL-077)', () => {
  const RF = 'refund-app';
  let rfPack = '';
  let Q: Tenant;
  let S: Tenant;
  const refundCalls = () =>
    calls.filter((c) => /\/payments\/[^/]+\/refund$/.test(new URL(c.url).pathname));

  /** The far end for the refund door: the invoices of a subscription (one paid charge of 499.00) and the refund itself. */
  const refundProvider = () =>
    handlers.push((url) => {
      if (url.hostname !== 'api.razorpay.com') return undefined;
      if (url.pathname === '/v1/invoices')
        return {
          status: 200,
          body: {
            items: [
              {
                id: 'inv_pro',
                amount: 49900,
                currency: 'INR',
                status: 'paid',
                paid_at: Math.floor(Date.now() / 1000) - 86_400,
                payment_id: `pay_${url.searchParams.get('subscription_id')}`,
              },
            ],
          },
        };
      if (/\/payments\/[^/]+\/refund$/.test(url.pathname))
        return { status: 200, body: { id: `rfnd_${Date.now()}`, status: 'processed' } };
      return undefined;
    });

  it('works out the unused share of the last payment (dry run), returns it once, and a second run returns nothing more', async () => {
    await publishListing(
      h,
      { manage: superToken, review: reviewerToken },
      {
        manifest: miniManifest({ id: RF, name: 'Refund App', scopes: ['contacts.read'] }),
      },
    );
    rfPack = await priceApp(RF, { amount: '499', billingMode: 'recurring' });
    Q = await tenant('Q');
    await installApp(Q);
    await subscribe(Q, 30, rfPack);
    await h.owner.query(
      `UPDATE marketplace_subscriptions SET current_period_end = now() + interval '15 days' WHERE org_id = $1`,
      [Q.orgId],
    );
    const uuid = (await ledgerOf(Q, RF)).uuid as string;
    mockProviders();
    refundProvider();

    const dry = await ops().post(`/subscriptions/${uuid}/prorate`, {});
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({
      dryRun: true,
      paidMinor: '49900',
      source: 'charge',
      currency: 'INR',
      refund: null,
    });
    const owed = BigInt(dry.body.refundableMinor as string);
    expect(owed > 20_000n && owed < 28_000n).toBe(true);
    expect(refundCalls()).toHaveLength(0);

    const reviewer = await http()
      .post(`/v2/platform/marketplace/subscriptions/${uuid}/prorate`)
      .set(bearer(reviewerToken))
      .send({ dryRun: false, reason: 'not allowed' });
    expect(reviewer.status).toBe(403);
    const noReason = await ops().post(`/subscriptions/${uuid}/prorate`, { dryRun: false });
    expect(noReason.status).toBe(422);

    const real = await ops().post(`/subscriptions/${uuid}/prorate`, {
      dryRun: false,
      reason: 'cancelled early, goodwill',
    });
    expect(real.status, JSON.stringify(real.body)).toBe(200);
    expect(real.body.refund).toMatchObject({
      status: 'processed',
      amountMinor: owed.toString(),
      currency: 'INR',
    });
    const sent = refundCalls();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.body)).toMatchObject({ amount: Number(owed) });
    expect(
      await count(
        `SELECT count(*) AS n FROM order_refunds WHERE org_id = $1 AND status <> 'failed'`,
        [Q.orgId],
      ),
    ).toBe(1);
    expect(await events(Q.orgId, 'marketplace.subscription.refunded')).toBe(1);

    // the same tool again returns nothing more
    const second = await ops().post(`/subscriptions/${uuid}/prorate`, {
      dryRun: false,
      reason: 'cancelled early, goodwill',
    });
    expect(second.body).toMatchObject({ refundableMinor: '0', refund: null });
    expect(refundCalls()).toHaveLength(1);
  });

  it('a withdrawn app: every subscriber is owed the share from the moment it was withdrawn; only a killed app can be refunded in bulk', async () => {
    S = await tenant('S');
    await installApp(S);
    mockProviders();
    await subscribe(S, 30, rfPack);
    await h.owner.query(
      `UPDATE marketplace_subscriptions SET current_period_end = now() + interval '20 days' WHERE org_id = $1`,
      [S.orgId],
    );
    refundProvider();
    const early = await ops().post(`/apps/${RF}/refund-unused`, {});
    expect(early.status).toBe(409);

    const kill = await ops().post(`/apps/${RF}/kill`, {
      reason: 'withdrawn after a licence problem',
    });
    expect(kill.status, JSON.stringify(kill.body)).toBe(200);
    calls.length = 0;
    const dry = await ops().post(`/apps/${RF}/refund-unused`, {});
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, hasMore: false });
    expect(dry.body.refundable).toBeGreaterThanOrEqual(1);
    expect(dry.body.totals).toEqual([{ currency: 'INR', amountMinor: expect.any(String) }]);
    expect(refundCalls()).toHaveLength(0);

    const real = await ops().post(`/apps/${RF}/refund-unused`, {
      dryRun: false,
      reason: 'app withdrawn by the platform',
    });
    expect(real.status, JSON.stringify(real.body)).toBe(200);
    expect(real.body).toMatchObject({ dryRun: false, failed: 0 });
    expect(real.body.refunded).toBeGreaterThanOrEqual(1);
    expect(refundCalls()).toHaveLength(real.body.refunded as number);
    // S is fully served by the run; running it again returns nothing
    const again = await ops().post(`/apps/${RF}/refund-unused`, {
      dryRun: false,
      reason: 'app withdrawn by the platform',
    });
    expect(again.body).toMatchObject({ refunded: 0, refundable: 0 });
    expect(await events(S.orgId, 'marketplace.subscription.refunded')).toBe(1);
  });
});

describe('the operator and the kill switch end card renewals too', () => {
  it('cancelling a subscription for the operator ends the provider subscription (now, or at the period end)', async () => {
    const D = await tenant('D');
    await installApp(D);
    const { subId } = await subscribe(D, 30);
    mockProviders();
    const uuid = (await ledger(D)).uuid as string;
    const res = await ops().post(`/subscriptions/${uuid}/cancel`, {
      immediate: true,
      reason: 'chargeback review',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(cancelCalls()).toEqual([{ cancel_at_cycle_end: 0 }]);
    expect((await providerSub(subId)).status).toBe('canceled');
    expect(await ledger(D)).toMatchObject({ status: 'lapsed', autorenew: false });
  });

  it('the kill switch stops every card renewal of the withdrawn app at the end of what each paid for', async () => {
    const E = await tenant('E');
    await installApp(E);
    const { subId } = await subscribe(E, 30);
    mockProviders();
    const res = await ops().post(`/apps/${SLUG}/kill`, {
      reason: 'security incident under review',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.renewalsStopped).toBeGreaterThanOrEqual(1);
    expect(
      res.body.renewalsNotStopped,
      JSON.stringify(
        await rows(
          `SELECT org_id, status, gateway_subscription_id, plan_id, workspace_addon_id, meta FROM subscriptions WHERE kind = 'addon' ORDER BY id`,
        ),
      ),
    ).toBe(0);
    expect((await providerSub(subId)).status).toBe('canceled');
    expect(cancelCalls().every((c) => c.cancel_at_cycle_end === 1)).toBe(true);
    // no card still charges for the withdrawn app (other apps' subscriptions are untouched)
    expect(
      await count(
        `SELECT count(*) AS n FROM subscriptions s JOIN plans p ON p.slug = s.plan_id
          WHERE s.status IN ('active','past_due') AND s.kind = 'addon'
            AND p.marketplace_app_id = (SELECT id FROM marketplace_apps WHERE slug = $1)`,
        [SLUG],
      ),
    ).toBe(0);
  });
});
