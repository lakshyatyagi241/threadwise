import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  marketAppDetailSchema,
  marketAppListSchema,
  marketInstallationListSchema,
  marketInstallResultSchema,
  marketOperatorAppSchema,
  marketOperatorSubscriptionListSchema,
  marketOperatorSubscriptionSchema,
  marketSubscribeResultSchema,
  marketSubscriptionSummarySchema,
  marketWorkspaceSubscriptionListSchema,
  type MarketAppDetail,
  type MarketInstallation,
  type MarketOperatorApp,
} from '@crm/contracts';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { MarketSubscriptionLifecycle } from '../../../src/modules/marketplace/subscription-lifecycle.service';
import { SubscriptionSweepService } from '../../../src/modules/marketplace/subscription-sweep.worker';
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
 * Paid and free apps, end to end through HTTP against a real Postgres (row-level security forced), the real AppModule, the real checkout
 * and the real add-ons entitlement service. Only the far end of the payment provider is faked (global fetch), so the order, the paid
 * transition, the add-on purchase row, the subscription ledger, the entitlement merge, the audit rows and the outbox events are real.
 *
 * Nothing here runs against a real payment gateway.
 */
let h: Harness;
let api: Api;
let superToken = '';
let reviewerToken = '';
let supportToken = '';
let A: Tenant; // subscribes, renews, cancels, lapses, resubscribes, uninstalls
let B: Tenant; // never subscribes: isolation, not-for-sale, no plan
let C: Tenant; // comped
let D: Tenant; // trial
let E: Tenant; // admin pause, then lapse, then resubscribe
let F: Tenant; // on a plan that includes an app
const tokens = () => ({ manage: superToken, review: reviewerToken });
const ops = () => platformApi(h, superToken);
const mp = (t: Tenant) => marketApi(h, t.admin);
const http = () => request(h.app.getHttpServer());

const rows = async <T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> => (await h.owner.query(query, params)).rows as T[];
const one = async <T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T> => (await rows<T>(query, params))[0]!;
const count = async (query: string, params: unknown[] = []): Promise<number> =>
  Number((await one<{ n: string }>(query, params)).n);

// --- the far end of the payment provider ----------------------------------------------------------------------------------------------

type Handler = (url: URL, init?: RequestInit) => { status: number; body: unknown } | undefined;
const handlers: Handler[] = [];
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
function mockProviders() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, init);
    for (const hnd of handlers) {
      const r = hnd(url, init);
      if (r) return jsonRes(r.status, r.body);
    }
    throw new Error(`unexpected provider call ${url.href}`);
  });
}
/** Stripe: creating a session returns a url; reading it returns the session as paid, for the order just created. */
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
      body: {
        id: 'cs_1',
        payment_status: 'paid',
        payment_intent: `pi_${created!.ref}`,
        client_reference_id: created!.ref,
        amount_total: created!.amount,
        currency: created!.currency,
      },
    };
  });
}
const WEBHOOK_SECRET = 'whsec_mkt';
const signStripe = (raw: string) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex')}`;
};
let stripeId = '';

const orderRow = async (number: string) =>
  one<{
    id: string;
    status: string;
    return_token: string;
    total_amount: string;
    kind: string;
    plan_slug: string;
  }>(`SELECT * FROM orders WHERE order_number = $1`, [number]);

/** Places an order for the app's add-on through the real checkout, then the buyer returns and Stripe confirms. Returns the order number. */
async function pay(t: Tenant, packSlug: string): Promise<string> {
  mockProviders();
  handlers.length = 0;
  stripeThatPays();
  const placed = await http()
    .post(`/v2/billing/checkout/plans/${packSlug}/orders`)
    .set(bearer(t.admin))
    .send({ gatewayId: stripeId });
  expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  const number = placed.body.orderNumber as string;
  const o = await orderRow(number);
  const ret = await http()
    .get(`/v2/payments/return/stripe?o=${o.return_token}&session_id=cs_1`)
    .redirects(0);
  expect(ret.status).toBe(303);
  expect((await orderRow(number)).status).toBe('paid');
  return number;
}
const quote = (t: Tenant, packSlug: string) =>
  http().get(`/v2/billing/checkout/plans/${packSlug}/quote`).set(bearer(t.admin));

// --- fixtures and helpers -----------------------------------------------------------------------------------------------------------------

const packOf = async (slug: string) =>
  one<{
    id: string;
    slug: string;
    amount: string;
    currency: string;
    is_active: boolean;
    features: Record<string, boolean>;
    billing_unit: string;
    billing_duration: number;
    kind: string;
  }>(
    `SELECT p.* FROM plans p JOIN marketplace_apps a ON a.id = p.marketplace_app_id WHERE a.slug = $1`,
    [slug],
  );
const appRow = (slug: string) =>
  one<{ id: string; uuid: string; row_version: number; price_changed_at: string | null }>(
    `SELECT * FROM marketplace_apps WHERE slug = $1`,
    [slug],
  );
const rv = async (slug: string): Promise<number> => (await appRow(slug)).row_version;
// A row as the owner connection returns it: columns are read by name in the assertions below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const subOf = (t: Tenant, slug: string) =>
  one<Row>(
    `SELECT s.* FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id WHERE s.org_id = $1 AND a.slug = $2`,
    [t.orgId, slug],
  );
const installOf = (t: Tenant, slug: string) =>
  one<Row>(
    `SELECT i.* FROM workspace_app_installations i JOIN marketplace_apps a ON a.id = i.app_id WHERE i.org_id = $1 AND a.slug = $2`,
    [t.orgId, slug],
  );
const events = (orgId: number, type: string) =>
  count(`SELECT count(*) AS n FROM event_outbox WHERE org_id = $1 AND event_type = $2`, [
    orgId,
    type,
  ]);
const detail = async (t: Tenant, slug: string): Promise<MarketAppDetail> => {
  const res = await mp(t).get(`/apps/${slug}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return marketAppDetailSchema.parse(res.body);
};
const setPricing = async (slug: string, body: Record<string, unknown>) =>
  ops().put(`/apps/${slug}/pricing`, { rowVersion: await rv(slug), ...body });
const setPaid = async (
  slug: string,
  body: Record<string, unknown> = {},
): Promise<MarketOperatorApp> => {
  const res = await setPricing(slug, {
    model: 'paid_monthly',
    amount: '9',
    currency: 'USD',
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return marketOperatorAppSchema.parse(res.body);
};
const install = async (t: Tenant, slug: string, scopes = ['contacts.read', 'deals.read']) =>
  mp(t).post(`/apps/${slug}/install`, { acceptedScopes: scopes });
/** Moves a workspace's paid period into the past, as the passing of time would. */
async function runOut(t: Tenant, slug: string): Promise<void> {
  const pack = await packOf(slug);
  await h.owner.query(
    `UPDATE workspace_addons SET starts_at = now() - interval '40 days', ends_at = now() - interval '1 minute'
      WHERE org_id = $1 AND package_id = $2 AND status = 'active'`,
    [t.orgId, pack.id],
  );
  await h.owner.query(
    `UPDATE marketplace_subscriptions SET current_period_end = now() - interval '1 minute' WHERE org_id = $1 AND app_id = (SELECT id FROM marketplace_apps WHERE slug = $2)`,
    [t.orgId, slug],
  );
}
const sweep = () => h.app.get(MarketSubscriptionLifecycle).sweep();
const daysFromNow = (iso: string | Date) => (new Date(iso).getTime() - Date.now()) / 86_400_000;

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
  const rvStaff = (staff.body.data as Array<{ id: string; email: string }>).find(
    (s) => s.email === 'reviewer@platform.test',
  )!;
  expect(
    (
      await http()
        .put(`/v2/platform/staff/${rvStaff.id}/roles`)
        .set(bearer(superToken))
        .send({ roleIds: [role.body.id] })
    ).status,
  ).toBe(200);
  reviewerToken = await operatorLogin(h, 'reviewer@platform.test');
  supportToken = await operatorLogin(h, 'support@platform.test');

  // The payment gateway: Stripe in test mode, configured and switched on by the operator, exactly as in production.
  const list = await http().get('/v2/platform/payment-gateways').set(bearer(superToken));
  const g = (list.body.data as Array<{ id: string; slug: string; rowVersion: number }>).find(
    (x) => x.slug === 'stripe',
  )!;
  const conf = await http()
    .patch(`/v2/platform/payment-gateways/${g.id}`)
    .set(bearer(superToken))
    .send({
      mode: 'sandbox',
      credentials: {
        secret_key: 'sk_test_mkt',
        publishable_key: 'pk_test_mkt',
        webhook_secret: WEBHOOK_SECRET,
      },
      rowVersion: g.rowVersion,
    });
  expect(conf.status, JSON.stringify(conf.body)).toBe(200);
  const act = await http()
    .post(`/v2/platform/payment-gateways/${g.id}/active`)
    .set(bearer(superToken))
    .send({ isActive: true, rowVersion: conf.body.rowVersion });
  expect(act.status, JSON.stringify(act.body)).toBe(201);
  stripeId = g.id;
  await h.owner.query(
    `INSERT INTO platform_settings (key, value, is_secret) VALUES ('checkout.recurring_enabled', 'false'::jsonb, false)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
  h.app.get(PlatformSettingsService).invalidate();

  for (const l of ['A', 'B', 'C', 'D', 'E', 'F'] as const) {
    const t = await api.signup(`price${l}`);
    if (l === 'A') A = t;
    if (l === 'B') B = t;
    if (l === 'C') C = t;
    if (l === 'D') D = t;
    if (l === 'E') E = t;
    if (l === 'F') F = t;
  }
  // The catalogue of plans a workspace can be on (the seeded database has none): a free starter and a Growth plan above it.
  await h.owner.query(
    `INSERT INTO plans (slug, kind, name, amount, currency, sort_order, is_free) VALUES ('freebie', 'plan', 'Freebie', 0, 'USD', 1, true)`,
  );
  await h.owner.query(
    `INSERT INTO plans (slug, kind, name, amount, currency, sort_order) VALUES ('growth', 'plan', 'Growth', 49, 'USD', 20)`,
  );
  await h.owner.query(`UPDATE organizations SET plan = 'freebie' WHERE id = ANY($1::bigint[])`, [
    [A, B, C, D, E].map((t) => t.orgId),
  ]);
  await h.owner.query(`UPDATE organizations SET plan = 'growth' WHERE id = $1`, [F.orgId]);
  await h.owner.query(
    `INSERT INTO org_plan_state (org_id, plan_ends_at) VALUES ($1, now() + interval '60 days') ON CONFLICT (org_id) DO UPDATE SET plan_ends_at = now() + interval '60 days'`,
    [F.orgId],
  );

  // Listings: three mini apps (the developer's manifest proposes an add-on price in one of them; the operator decides).
  await publishListing(h, tokens(), {
    manifest: miniManifest({
      id: 'quote-pro',
      name: 'Quote Pro',
      pricing: { model: 'addon', note: 'Developer proposes 5 USD' },
    }),
  });
  await publishListing(h, tokens(), {
    manifest: miniManifest({ id: 'trial-app', name: 'Trial App', scopes: ['contacts.read'] }),
    firstParty: true,
  });
  await publishListing(h, tokens(), {
    manifest: miniManifest({ id: 'plan-app', name: 'Plan App', scopes: ['contacts.read'] }),
  });
  await publishListing(h, tokens(), {
    manifest: miniManifest({ id: 'free-app', name: 'Free App', scopes: ['contacts.read'] }),
  });
}, 600_000);

afterAll(async () => {
  await h?.stop();
});
afterEach(() => {
  vi.restoreAllMocks();
  handlers.length = 0;
});

// ============================================================================================================================================
describe('the operator decides what an app costs', () => {
  it('a new listing is free; the list filters by pricing; the manifest keeps only a proposal', async () => {
    const free = await ops().get('/apps?pricing=free&limit=100');
    expect(free.status).toBe(200);
    const mine = ['free-app', 'plan-app', 'quote-pro', 'trial-app'];
    expect(
      (free.body.data as Array<{ slug: string }>)
        .map((a) => a.slug)
        .filter((s) => mine.includes(s))
        .sort(),
    ).toEqual(mine);
    expect(free.body.data[0].pricing).toMatchObject({
      model: 'free',
      amount: null,
      packSlug: null,
      purchasable: true,
    });
    // only the seeded Appointments listing is paid (draft, price unset)
    expect(
      (await ops().get('/apps?pricing=paid')).body.data.map((a: { slug: string }) => a.slug),
    ).toEqual(['appointments']);
    const cardFree = await detail(A, 'quote-pro');
    expect(cardFree.pricing).toMatchObject({
      model: 'free',
      access: 'free',
      checkoutPath: null,
      trialAvailable: false,
    });
    expect(cardFree.subscription).toBeNull();
  });

  it('refuses a pricing that is not valid, naming the field, and a stale edit', async () => {
    const bare = await setPricing('quote-pro', { model: 'paid_monthly' });
    expect(bare.status).toBe(422);
    expect(code(bare)).toBe('VALIDATION_FAILED');
    expect((bare.body.errors as Array<{ path: string }>).map((e) => e.path).sort()).toEqual([
      'amount',
      'currency',
    ]);
    expect(
      (await setPricing('quote-pro', { model: 'paid_monthly', amount: '0', currency: 'USD' }))
        .status,
    ).toBe(422);
    expect(
      (await setPricing('quote-pro', { model: 'paid_monthly', amount: '9.999', currency: 'USD' }))
        .status,
    ).toBe(422);
    expect((await setPricing('quote-pro', { model: 'free', amount: '9' })).status).toBe(422);
    const noCurrency = await setPricing('quote-pro', {
      model: 'paid_monthly',
      amount: '9',
      currency: 'ZZZ',
    });
    expect(noCurrency.status).toBe(422);
    expect(noCurrency.body.errors).toEqual([
      { path: 'currency', message: 'This currency is not enabled on the platform.' },
    ]);
    const noPlan = await setPricing('quote-pro', {
      model: 'paid_monthly',
      amount: '9',
      currency: 'USD',
      includedMinPlan: 'nothere',
    });
    expect(noPlan.body.errors).toEqual([
      { path: 'includedMinPlan', message: 'There is no such plan.' },
    ]);
    const noFeature = await setPricing('quote-pro', {
      model: 'paid_monthly',
      amount: '9',
      currency: 'USD',
      includedPlanFeature: 'not_a_feature',
    });
    expect(noFeature.body.errors).toEqual([
      { path: 'includedPlanFeature', message: 'This is not a plan feature.' },
    ]);
    const stale = await ops().put('/apps/quote-pro/pricing', {
      rowVersion: 1,
      model: 'paid_monthly',
      amount: '9',
      currency: 'USD',
    });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    expect(
      (await ops().put('/apps/nothere/pricing', { rowVersion: 1, model: 'free' })).status,
    ).toBe(404);
    // nothing was written by any of the refusals
    expect((await appRow('quote-pro')).price_changed_at).toBeNull();
    expect(
      await count(`SELECT count(*) AS n FROM plans WHERE marketplace_app_id IS NOT NULL`),
    ).toBe(0);
  });

  it('needs its own platform permission: review and support operators cannot price, anonymous is refused', async () => {
    const body = {
      rowVersion: await rv('quote-pro'),
      model: 'paid_monthly',
      amount: '9',
      currency: 'USD',
    };
    const asReviewer = await platformApi(h, reviewerToken).put('/apps/quote-pro/pricing', body);
    expect(asReviewer.status).toBe(403);
    expect((await platformApi(h, supportToken).put('/apps/quote-pro/pricing', body)).status).toBe(
      403,
    );
    expect(
      (await http().put('/v2/platform/marketplace/apps/quote-pro/pricing').send(body)).status,
    ).toBe(401);
    const comp = { workspaceId: '8a6f0c3e-3b8e-4d0e-8f43-0d0f3f3f3f3f', note: 'Launch partner' };
    expect(
      (await platformApi(h, reviewerToken).post('/apps/quote-pro/subscriptions/comp', comp)).status,
    ).toBe(403);
    expect(
      (
        await platformApi(h, reviewerToken).post(
          '/subscriptions/8a6f0c3e-3b8e-4d0e-8f43-0d0f3f3f3f3f/cancel',
          { reason: 'Fraud review' },
        )
      ).status,
    ).toBe(403);
    // reading the money pages needs one of the three keys: review reads, support does not
    expect((await platformApi(h, reviewerToken).get('/subscriptions')).status).toBe(200);
    expect((await platformApi(h, supportToken).get('/subscriptions')).status).toBe(403);
    expect((await platformApi(h, supportToken).get('/subscriptions/summary')).status).toBe(403);
    // the workspace API is not the operator's
    expect(
      (await http().put('/v2/marketplace/apps/quote-pro/pricing').set(bearer(A.admin)).send(body))
        .status,
    ).toBe(404);
  });

  it('sets a monthly price: the listing is the authority, and a billing add-on is created to sell it', async () => {
    const app = await setPaid('quote-pro', { trialDays: 0 });
    expect(app.pricing).toMatchObject({
      model: 'paid_monthly',
      amount: '9.00',
      currency: 'USD',
      annualAmount: null,
      trialDays: 0,
      purchasable: true,
      includedPlanFeature: null,
      includedMinPlan: null,
    });
    expect(app.pricing.packSlug).toMatch(/^mkt_[0-9a-f]{20}$/);
    expect(app.pricing.priceChangedAt).not.toBeNull();

    const pack = await packOf('quote-pro');
    expect(pack).toMatchObject({
      slug: app.pricing.packSlug,
      kind: 'addon',
      is_active: true,
      billing_unit: 'months',
      billing_duration: 1,
      currency: 'USD',
    });
    expect(Number(pack.amount)).toBe(9);
    expect(pack.features).toEqual({ mkt_quote_pro: true });
    const audit = await rows(
      `SELECT payload FROM security_events WHERE event = 'platform.market.pricing_set' ORDER BY id DESC LIMIT 1`,
    );
    expect(audit[0]).toMatchObject({
      payload: {
        app: 'quote-pro',
        from: { model: 'free' },
        to: { model: 'paid_monthly', amount: '9.00', currency: 'USD' },
      },
    });

    // the developer's proposal is untouched; the listing's pricing is what counts
    const op = await ops().get('/apps/quote-pro');
    expect(op.body.manifest.pricing).toEqual({ model: 'addon', note: 'Developer proposes 5 USD' });
    expect(op.body.pricing.model).toBe('paid_monthly');
    // the filter follows
    expect(
      (await ops().get('/apps?pricing=paid')).body.data.map((a: { slug: string }) => a.slug),
    ).toEqual(['quote-pro', 'appointments']);
    expect(
      (await ops().get('/apps?pricing=free&limit=100')).body.data.map(
        (a: { slug: string }) => a.slug,
      ),
    ).not.toContain('quote-pro');
  });

  it('keeps the add-on out of the add-ons console and out of the workspace add-on catalogue', async () => {
    const consoleList = await http().get('/v2/platform/addons').set(bearer(superToken));
    expect(consoleList.status).toBe(200);
    expect(JSON.stringify(consoleList.body)).not.toContain('mkt_');
    const pack = await packOf('quote-pro');
    const uuid = (await one<{ uuid: string }>(`SELECT uuid FROM plans WHERE id = $1`, [pack.id]))
      .uuid;
    // not addressable from there either: it is "not an add-on" to that console
    expect((await http().get(`/v2/platform/addons/${uuid}`).set(bearer(superToken))).status).toBe(
      404,
    );
    // an ordinary add-on still shows in both (the filter is only for the Marketplace's own)
    await h.owner.query(
      `INSERT INTO plans (slug, kind, name, amount, currency, features, limits) VALUES ('boost', 'addon', 'Boost', 5, 'USD', '{}'::jsonb, '{"installed_apps": 3}'::jsonb)`,
    );
    expect(
      JSON.stringify((await http().get('/v2/platform/addons').set(bearer(superToken))).body),
    ).toContain('Boost');
    const mine = await http().get('/v2/addons').set(bearer(F.admin));
    expect(mine.status).toBe(200);
    expect(mine.body.eligible).toBe(true);
    expect(mine.body.catalog.map((c: { name: string }) => c.name)).toEqual(['Boost']);
    expect(JSON.stringify(mine.body)).not.toContain('Quote Pro');
  });
});

// ============================================================================================================================================
describe('a workspace sees the price and has to subscribe', () => {
  it('the app page and the cards show the price, the access state and where to pay; never the manifest proposal', async () => {
    const d = await detail(A, 'quote-pro');
    expect(d.pricing).toMatchObject({
      model: 'paid_monthly',
      amount: '9.00',
      currency: 'USD',
      trialDays: 0,
      trialAvailable: false,
      access: 'subscription_required',
      includedBy: null,
    });
    expect(d.pricing.checkoutPath).toMatch(/^\/billing\/checkout\/mkt_[0-9a-f]{20}$/);
    expect(JSON.stringify(d)).not.toContain('Developer proposes');
    const list = marketAppListSchema.parse((await mp(A).get('/apps?kind=mini_app')).body);
    expect(list.data.find((c) => c.slug === 'quote-pro')!.pricing.access).toBe(
      'subscription_required',
    );
    expect(list.data.find((c) => c.slug === 'free-app')!.pricing).toMatchObject({
      model: 'free',
      access: 'free',
    });
    const shelves = await mp(A).get('/shelves?kind=mini_app');
    expect(shelves.status).toBe(200);
  });

  it('refuses to install a paid app without a subscription, and says where to pay', async () => {
    const res = await install(A, 'quote-pro');
    expect(res.status).toBe(422);
    expect(code(res)).toBe('MKT_SUBSCRIPTION_REQUIRED');
    const path = (res.body.errors as Array<{ path: string; message: string }>).find(
      (e) => e.path === 'checkoutPath',
    )!.message;
    expect(path).toBe((await detail(A, 'quote-pro')).pricing.checkoutPath);
    expect(
      await count(`SELECT count(*) AS n FROM workspace_app_installations WHERE org_id = $1`, [
        A.orgId,
      ]),
    ).toBe(0);
    // a free app is unchanged
    const freeInstall = await mp(A).post('/apps/free-app/install', {
      acceptedScopes: ['contacts.read'],
    });
    expect(freeInstall.status, JSON.stringify(freeInstall.body)).toBe(201);
    expect(marketInstallResultSchema.parse(freeInstall.body).installation.pricing).toMatchObject({
      model: 'free',
      access: 'free',
    });
    expect(marketInstallResultSchema.parse(freeInstall.body).installation.subscription).toBeNull();
  });

  it('Subscribe answers with the existing checkout page of the add-on', async () => {
    const res = await mp(A).post('/apps/quote-pro/subscribe', {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = marketSubscribeResultSchema.parse(res.body);
    expect(out).toMatchObject({ outcome: 'checkout', subscription: null });
    expect(out.checkout!.path).toBe(`/billing/checkout/${out.checkout!.packSlug}`);
    expect((await mp(A).post('/apps/free-app/subscribe', {})).body.outcome).toBe('free');
    expect((await mp(A).post('/apps/nothere/subscribe', {})).status).toBe(404);
    // the trial the app does not offer is refused, and nothing is granted
    const trial = await mp(A).post('/apps/quote-pro/subscribe', { startTrial: true });
    expect(trial.status).toBe(422);
    expect(code(trial)).toBe('MKT_TRIAL_UNAVAILABLE');
    expect(
      await count(`SELECT count(*) AS n FROM workspace_addons WHERE org_id = $1`, [A.orgId]),
    ).toBe(0);
  });

  it('a workspace without the install permission cannot subscribe or cancel', async () => {
    const viewer = await api.member(A, 'viewer', [['market.apps.read', 'all']]);
    const asViewer = marketApi(h, viewer.token);
    expect((await asViewer.get('/apps/quote-pro')).status).toBe(200);
    expect((await asViewer.post('/apps/quote-pro/subscribe', {})).status).toBe(403);
    expect((await asViewer.post('/apps/quote-pro/subscription/cancel', {})).status).toBe(403);
    expect((await asViewer.get('/subscriptions')).status).toBe(200);
  });

  it('the checkout quotes the add-on with no paid plan needed, at the operator price', async () => {
    const pack = await packOf('quote-pro');
    const q = await quote(A, pack.slug);
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body).toMatchObject({
      kind: 'addon',
      itemName: 'Quote Pro (Marketplace)',
      currency: 'USD',
      subtotal: '9.00',
      total: '9.00',
    });
    // a plan-less, free-plan workspace could buy it: that is the point of a subscription of its own
    expect((await quote(B, pack.slug)).status).toBe(200);
  });
});

// ============================================================================================================================================
describe('subscribing through the existing checkout (Stripe in test mode, faked at the provider)', () => {
  let orderNumber = '';

  it('an order paid and confirmed creates the entitlement and the subscription in one transaction', async () => {
    const pack = await packOf('quote-pro');
    orderNumber = await pay(A, pack.slug);
    const o = await orderRow(orderNumber);
    expect(o).toMatchObject({ kind: 'addon', plan_slug: pack.slug, status: 'paid' });
    expect(Number(o.total_amount)).toBe(9);

    // the entitlement: one purchase row of the add-on, about a month long
    const purchases = await rows<{
      order_id: string;
      status: string;
      starts_at: string;
      ends_at: string;
    }>(`SELECT * FROM workspace_addons WHERE org_id = $1 AND package_id = $2`, [A.orgId, pack.id]);
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ order_id: o.id, status: 'active' });
    expect(daysFromNow(purchases[0]!.ends_at)).toBeGreaterThan(27);
    expect(daysFromNow(purchases[0]!.ends_at)).toBeLessThan(32);

    // the ledger follows it: source purchase, what was paid, the same period end
    const sub = await subOf(A, 'quote-pro');
    expect(sub).toMatchObject({
      status: 'active',
      source: 'purchase',
      cancel_at_period_end: false,
      currency: 'USD',
      renewals_count: 0,
    });
    expect(Number(sub.amount)).toBe(9);
    expect(new Date(sub.current_period_end).getTime()).toBe(
      new Date(purchases[0]!.ends_at).getTime(),
    );

    // audit and outbox in the same transaction
    expect(await events(A.orgId, 'marketplace.subscription.started')).toBe(1);
    expect(await events(A.orgId, 'addon.activated')).toBe(1);
    expect(
      await count(
        `SELECT count(*) AS n FROM audit_log WHERE org_id = $1 AND module = 'marketplace_subscriptions' AND record_id = $2`,
        [A.orgId, sub.id],
      ),
    ).toBe(1);

    // what the workspace sees
    const d = await detail(A, 'quote-pro');
    expect(d.pricing.access).toBe('entitled');
    expect(d.subscription).toMatchObject({
      status: 'active',
      source: 'purchase',
      amount: '9.00',
      currency: 'USD',
      renewals: 0,
      nextAmount: null,
      actions: { canCancel: true, canResume: false, canRenew: false },
    });
    const mine = marketWorkspaceSubscriptionListSchema.parse(
      (await mp(A).get('/subscriptions')).body,
    );
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0]).toMatchObject({
      app: { slug: 'quote-pro' },
      status: 'active',
      installationId: null,
    });
  });

  it('a replay of the payment (the buyer returning again, the provider repeating its notification) changes nothing', async () => {
    const o = await orderRow(orderNumber);
    await http().get(`/v2/payments/return/stripe?o=${o.return_token}&session_id=cs_1`).redirects(0);
    const raw = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          client_reference_id: orderNumber,
          payment_status: 'paid',
          payment_intent: 'pi_x',
          amount_total: 900,
          currency: 'usd',
        },
      },
    });
    const hook = await http()
      .post('/v2/payments/webhook/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', signStripe(raw))
      .send(raw);
    expect(hook.status).toBe(200);
    const pack = await packOf('quote-pro');
    expect(
      await count(
        `SELECT count(*) AS n FROM workspace_addons WHERE org_id = $1 AND package_id = $2`,
        [A.orgId, pack.id],
      ),
    ).toBe(1);
    expect((await subOf(A, 'quote-pro')).renewals_count).toBe(0);
    expect(await events(A.orgId, 'marketplace.subscription.started')).toBe(1);
    expect(await events(A.orgId, 'marketplace.subscription.renewed')).toBe(0);
  });

  it('the install now succeeds with the normal consent step, and only because the entitlement exists', async () => {
    // consent still counts: the permission list must be confirmed exactly
    const noConsent = await install(A, 'quote-pro', []);
    expect(noConsent.status).toBe(422);
    expect(code(noConsent)).toBe('MKT_CONSENT_REQUIRED');
    const res = await install(A, 'quote-pro');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inst: MarketInstallation = marketInstallResultSchema.parse(res.body).installation;
    expect(inst).toMatchObject({
      status: 'active',
      pauseReason: null,
      pricing: { access: 'entitled', amount: '9.00' },
      subscription: { status: 'active', source: 'purchase' },
    });
    // a second tenant that has not paid is still refused
    expect(code(await install(B, 'quote-pro'))).toBe('MKT_SUBSCRIPTION_REQUIRED');
    const listed = marketInstallationListSchema.parse((await mp(A).get('/installations')).body);
    expect(listed.data.find((i) => i.app.slug === 'quote-pro')!.subscription).toMatchObject({
      status: 'active',
    });
    expect(listed.usage.installed).toBe(2); // free-app and quote-pro
    const view = await detail(A, 'quote-pro');
    expect(view.install).toMatchObject({ status: 'active' });
  });

  it('is isolated per workspace: another tenant sees no subscription, cannot cancel it, and the database refuses it', async () => {
    const d = await detail(B, 'quote-pro');
    expect(d.subscription).toBeNull();
    expect(d.pricing.access).toBe('subscription_required');
    expect(
      marketWorkspaceSubscriptionListSchema.parse((await mp(B).get('/subscriptions')).body).data,
    ).toEqual([]);
    const cancel = await mp(B).post('/apps/quote-pro/subscription/cancel', {});
    expect(cancel.status).toBe(404);
    expect(code(cancel)).toBe('MKT_SUBSCRIPTION_NOT_FOUND');
    expect((await mp(B).post('/apps/quote-pro/subscription/resume', {})).status).toBe(404);

    // row-level security under each tenant's own context
    const db = h.app.get(DatabaseService);
    const seen = (orgId: number) =>
      db.txAs({ orgId, userId: null }, async (tx) =>
        Number(
          (
            (await tx.execute(sql`SELECT count(*)::int AS n FROM marketplace_subscriptions`))
              .rows[0] as { n: number }
          ).n,
        ),
      );
    expect(await seen(A.orgId)).toBe(1);
    expect(await seen(B.orgId)).toBe(0);
    // a tenant cannot write its own subscription (no comping itself, no extending its period), and cannot insert one
    const forged = await db.txAs(
      { orgId: A.orgId, userId: null },
      async (tx) =>
        (
          await tx.execute(
            sql`UPDATE marketplace_subscriptions SET source = 'comp', current_period_end = now() + interval '10 years' RETURNING id`,
          )
        ).rows.length,
    );
    expect(forged).toBe(0);
    const appId = Number((await appRow('quote-pro')).id);
    const packId = Number((await packOf('quote-pro')).id);
    await expect(
      db.txAs({ orgId: B.orgId, userId: null }, (tx) =>
        tx.execute(
          sql`INSERT INTO marketplace_subscriptions (org_id, app_id, pack_id, source) VALUES (${B.orgId}, ${appId}, ${packId}, 'comp')`,
        ),
      ),
    ).rejects.toThrow();
    // nor an add-on purchase row
    await expect(
      db.txAs({ orgId: B.orgId, userId: null }, (tx) =>
        tx.execute(
          sql`INSERT INTO workspace_addons (org_id, package_id, status) VALUES (${B.orgId}, ${packId}, 'active')`,
        ),
      ),
    ).rejects.toThrow();
    expect(
      await count(`SELECT count(*) AS n FROM workspace_addons WHERE org_id = $1`, [B.orgId]),
    ).toBe(0);
  });

  it('renewing early extends from the end of the period already paid for, so no day is lost', async () => {
    const pack = await packOf('quote-pro');
    const before = await subOf(A, 'quote-pro');
    await pay(A, pack.slug);
    const after = await subOf(A, 'quote-pro');
    expect(after.renewals_count).toBe(1);
    expect(after.status).toBe('active');
    const month = new Date(before.current_period_end);
    month.setUTCMonth(month.getUTCMonth() + 1);
    // one calendar month after the previous end (end-of-month clamping may move it by a day or three)
    expect(Math.abs(new Date(after.current_period_end).getTime() - month.getTime())).toBeLessThan(
      3 * 86_400_000,
    );
    expect(new Date(after.current_period_end).getTime()).toBeGreaterThan(
      new Date(before.current_period_end).getTime() + 27 * 86_400_000,
    );
    expect(await events(A.orgId, 'marketplace.subscription.renewed')).toBe(1);
    expect(
      await count(
        `SELECT count(*) AS n FROM workspace_addons WHERE org_id = $1 AND package_id = $2`,
        [A.orgId, pack.id],
      ),
    ).toBe(2);
    // still one subscription for the pair
    expect(
      await count(`SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = $1`, [
        A.orgId,
      ]),
    ).toBe(1);
  });

  it('refuses to pay more than about two months ahead, on the quote and on a direct order', async () => {
    const pack = await packOf('quote-pro');
    // about 60 days are paid for now
    const days = daysFromNow((await subOf(A, 'quote-pro')).current_period_end);
    expect(days).toBeGreaterThan(55);
    const q = await quote(A, pack.slug);
    expect(q.status).toBe(422);
    expect(code(q)).toBe('PAYGW_PLAN_NOT_PURCHASABLE');
    expect(q.body.errors).toEqual([{ path: 'marketplace', message: 'paid_ahead' }]);
    mockProviders();
    stripeThatPays();
    const direct = await http()
      .post(`/v2/billing/checkout/plans/${pack.slug}/orders`)
      .set(bearer(A.admin))
      .send({ gatewayId: stripeId });
    expect(direct.status).toBe(422);
    expect(direct.body.errors).toEqual([{ path: 'marketplace', message: 'paid_ahead' }]);
  });
});

// ============================================================================================================================================
describe('cancel, the period runs out, the installation is paused, the workspace resubscribes', () => {
  it('cancelling keeps the app running until the period ends; resuming takes it back; it is idempotent', async () => {
    const c1 = await mp(A).post('/apps/quote-pro/subscription/cancel', {});
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(c1.body.subscription).toMatchObject({
      status: 'canceling',
      actions: { canCancel: false, canResume: true },
    });
    expect(c1.body.subscription.canceledAt).not.toBeNull();
    expect((await subOf(A, 'quote-pro')).cancel_at_period_end).toBe(true);
    expect(await events(A.orgId, 'marketplace.subscription.canceled')).toBe(1);

    // still entitled and still running
    expect((await installOf(A, 'quote-pro')).status).toBe('active');
    expect((await detail(A, 'quote-pro')).pricing.access).toBe('entitled');
    const again = await mp(A).post('/apps/quote-pro/subscription/cancel', {});
    expect(again.status).toBe(200);
    expect(await events(A.orgId, 'marketplace.subscription.canceled')).toBe(1);

    const resumed = await mp(A).post('/apps/quote-pro/subscription/resume', {});
    expect(resumed.body.subscription.status).toBe('active');
    expect((await subOf(A, 'quote-pro')).cancel_at_period_end).toBe(false);
    expect(await events(A.orgId, 'marketplace.subscription.resumed')).toBe(1);
    const notCancelled = await mp(A).post('/apps/quote-pro/subscription/resume', {});
    expect(notCancelled.status).toBe(409);
    expect(code(notCancelled)).toBe('MKT_SUBSCRIPTION_STATE');
    expect(
      (await mp(A).post('/apps/quote-pro/subscription/cancel', {})).body.subscription.status,
    ).toBe('canceling');
  });

  it('when the period ends the sweep lapses the subscription and pauses the installation, keeping its data, once', async () => {
    // some data the app holds: its configuration
    const inst = await installOf(A, 'quote-pro');
    await h.owner.query(
      `UPDATE workspace_app_installations SET config = '{"theme":"dark"}'::jsonb WHERE id = $1 AND org_id = $2`,
      [inst.id, A.orgId],
    );
    await runOut(A, 'quote-pro');

    // access does not wait for the sweep: the workspace is already seen as ended
    const early = await detail(A, 'quote-pro');
    expect(early.subscription!.status).toBe('ended');
    expect(early.pricing.access).toBe('subscription_required');

    await sweep();
    const sub = await subOf(A, 'quote-pro');
    expect(sub.status).toBe('lapsed');
    expect(sub.lapsed_at).not.toBeNull();
    const paused = await installOf(A, 'quote-pro');
    expect(paused).toMatchObject({ status: 'disabled', paused_by_subscription: true });
    expect(paused.config).toEqual({ theme: 'dark' }); // data kept
    expect(await events(A.orgId, 'marketplace.subscription.lapsed')).toBe(1);
    expect(
      await count(
        `SELECT count(*) AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'marketplace.app.disabled' AND payload->>'reason' = 'subscription_ended'`,
        [A.orgId],
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*) AS n FROM audit_log WHERE org_id = $1 AND module = 'marketplace' AND record_id = $2 AND delta->'reason'->>'new' = 'subscription_ended'`,
        [A.orgId, inst.id],
      ),
    ).toBe(1);

    // a second sweep finds nothing to do: nothing is emitted twice
    await sweep();
    await h.app.get(SubscriptionSweepService, { strict: false }).run();
    expect(await events(A.orgId, 'marketplace.subscription.lapsed')).toBe(1);
    expect(await events(A.orgId, 'marketplace.app.disabled')).toBe(1);

    // what the manage page says
    const view = marketInstallationListSchema
      .parse((await mp(A).get('/installations')).body)
      .data.find((i) => i.app.slug === 'quote-pro')!;
    expect(view).toMatchObject({
      status: 'disabled',
      pauseReason: 'subscription_ended',
      subscription: { status: 'ended', actions: { canRenew: true, canCancel: false } },
      pricing: { access: 'subscription_required' },
    });
  });

  it('an admin cannot switch a subscription-paused app back on without paying, and a paused app answers deliveries 409', async () => {
    const inst = await installOf(A, 'quote-pro');
    const on = await mp(A).post(`/installations/${inst.uuid}/enable`, {
      rowVersion: inst.row_version,
    });
    expect(on.status).toBe(422);
    expect(code(on)).toBe('MKT_SUBSCRIPTION_REQUIRED');
    expect((await installOf(A, 'quote-pro')).status).toBe('disabled');
  });

  it('resubscribing (a new payment) revives the subscription and switches the installation back on, data intact', async () => {
    const pack = await packOf('quote-pro');
    await pay(A, pack.slug);
    const sub = await subOf(A, 'quote-pro');
    expect(sub).toMatchObject({
      status: 'active',
      source: 'purchase',
      cancel_at_period_end: false,
      lapsed_at: null,
      canceled_at: null,
    });
    expect(daysFromNow(sub.current_period_end)).toBeGreaterThan(27);
    const back = await installOf(A, 'quote-pro');
    expect(back).toMatchObject({ status: 'active', paused_by_subscription: false });
    expect(back.config).toEqual({ theme: 'dark' });
    expect(await events(A.orgId, 'marketplace.subscription.resubscribed')).toBe(1);
    expect(await events(A.orgId, 'marketplace.app.enabled')).toBe(1);
    expect((await detail(A, 'quote-pro')).subscription).toMatchObject({ status: 'active' });
    // still exactly one row for the pair
    expect(
      await count(`SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = $1`, [
        A.orgId,
      ]),
    ).toBe(1);
  });

  it("an admin's own pause is never undone by a payment or by the lapse", async () => {
    const pack = await packOf('quote-pro');
    await pay(E, pack.slug);
    expect((await install(E, 'quote-pro')).status).toBe(201);
    const inst = await installOf(E, 'quote-pro');
    // the admin pauses it by hand
    expect(
      (await mp(E).post(`/installations/${inst.uuid}/disable`, { rowVersion: inst.row_version }))
        .status,
    ).toBe(200);
    expect(await installOf(E, 'quote-pro')).toMatchObject({
      status: 'disabled',
      paused_by_subscription: false,
    });
    await runOut(E, 'quote-pro');
    await sweep();
    expect((await subOf(E, 'quote-pro')).status).toBe('lapsed');
    expect(await installOf(E, 'quote-pro')).toMatchObject({
      status: 'disabled',
      paused_by_subscription: false,
    });
    expect(await events(E.orgId, 'marketplace.app.disabled')).toBe(1); // only the admin's own, no second one from the sweep
    await pay(E, pack.slug);
    expect(await installOf(E, 'quote-pro')).toMatchObject({
      status: 'disabled',
      paused_by_subscription: false,
    });
    expect(await events(E.orgId, 'marketplace.app.enabled')).toBe(0);
  });
});

// ============================================================================================================================================
describe('the free trial', () => {
  beforeAll(async () => {
    await setPaid('trial-app', { amount: '5', currency: 'EUR', trialDays: 14 });
  });

  it('is offered on the page once, and starts without a payment: a time-limited entitlement and a trialing subscription', async () => {
    const d = await detail(D, 'trial-app');
    expect(d.pricing).toMatchObject({
      trialDays: 14,
      trialAvailable: true,
      access: 'subscription_required',
    });
    const res = await mp(D).post('/apps/trial-app/subscribe', { startTrial: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = marketSubscribeResultSchema.parse(res.body);
    expect(out).toMatchObject({
      outcome: 'trial_started',
      checkout: null,
      subscription: { status: 'trialing', source: 'trial', amount: null },
    });
    const pack = await packOf('trial-app');
    const grant = await one<{ order_id: string | null; ends_at: string }>(
      `SELECT * FROM workspace_addons WHERE org_id = $1 AND package_id = $2`,
      [D.orgId, pack.id],
    );
    expect(grant.order_id).toBeNull();
    expect(daysFromNow(grant.ends_at)).toBeGreaterThan(13);
    expect(daysFromNow(grant.ends_at)).toBeLessThan(14.1);
    expect(await events(D.orgId, 'marketplace.subscription.started')).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM orders WHERE org_id = $1`, [D.orgId])).toBe(0);

    // entitled now, so it installs; and the trial is gone from the page
    const after = await detail(D, 'trial-app');
    expect(after.pricing).toMatchObject({ access: 'entitled', trialAvailable: false });
    expect(
      (await mp(D).post('/apps/trial-app/install', { acceptedScopes: ['contacts.read'] })).status,
    ).toBe(201);
    // one trial per workspace and app
    const second = await mp(D).post('/apps/trial-app/subscribe', { startTrial: true });
    expect(second.status).toBe(422);
    expect(code(second)).toBe('MKT_TRIAL_UNAVAILABLE');
    expect(
      await count(`SELECT count(*) AS n FROM workspace_addons WHERE org_id = $1`, [D.orgId]),
    ).toBe(1);
  });

  it('is refused to a workspace that already has had a subscription, and to a free app', async () => {
    const pack = await packOf('trial-app');
    await pay(B, pack.slug);
    expect((await subOf(B, 'trial-app')).source).toBe('purchase');
    await runOut(B, 'trial-app');
    await sweep();
    expect((await subOf(B, 'trial-app')).status).toBe('lapsed');
    expect((await detail(B, 'trial-app')).pricing.trialAvailable).toBe(false);
    expect((await mp(B).post('/apps/trial-app/subscribe', { startTrial: true })).status).toBe(422);
    expect((await mp(B).post('/apps/free-app/subscribe', { startTrial: true })).body.outcome).toBe(
      'free',
    );
  });

  it('a trial that ends lapses and pauses like any subscription, and paying converts a running one', async () => {
    await runOut(D, 'trial-app');
    await sweep();
    expect(await subOf(D, 'trial-app')).toMatchObject({ status: 'lapsed', source: 'trial' });
    expect(await installOf(D, 'trial-app')).toMatchObject({
      status: 'disabled',
      paused_by_subscription: true,
    });
    // paying afterwards revives it as a paid subscription and switches the app on again
    await pay(D, (await packOf('trial-app')).slug);
    expect(await subOf(D, 'trial-app')).toMatchObject({ status: 'active', source: 'purchase' });
    expect(await installOf(D, 'trial-app')).toMatchObject({
      status: 'active',
      paused_by_subscription: false,
    });
    // EUR was the price: it is what the order and the subscription carry
    expect((await subOf(D, 'trial-app')).currency).toBe('EUR');
  });
});

// ============================================================================================================================================
describe('the operator comps and cancels, with an audit trail', () => {
  let compId = '';

  it('comps a workspace for some months: an entitlement with no order, a comped subscription, audited', async () => {
    const res = await ops().post('/apps/quote-pro/subscriptions/comp', {
      workspaceId: await orgUuid(C),
      months: 2,
      note: 'Launch partner',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sub = marketOperatorSubscriptionSchema.parse(res.body);
    compId = sub.id;
    expect(sub).toMatchObject({
      status: 'comped',
      source: 'comp',
      amount: null,
      workspace: { name: expect.stringContaining('priceC') },
      app: { slug: 'quote-pro' },
      compNote: 'Launch partner',
      compBy: 'Ops',
    });
    expect(daysFromNow(sub.currentPeriodEnd!)).toBeGreaterThan(58);
    const grant = await one<{ order_id: string | null; status: string }>(
      `SELECT * FROM workspace_addons WHERE org_id = $1`,
      [C.orgId],
    );
    expect(grant).toMatchObject({ order_id: null, status: 'active' });
    expect(await events(C.orgId, 'marketplace.subscription.comped')).toBe(1);
    expect(
      await count(
        `SELECT count(*) AS n FROM security_events WHERE event = 'platform.market.subscription_comped' AND subject_org_id = $1`,
        [C.orgId],
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*) AS n FROM audit_log WHERE org_id = $1 AND module = 'marketplace_subscriptions' AND delta->'event'->>'new' = 'comped'`,
        [C.orgId],
      ),
    ).toBe(1);
    // the workspace can use it, and sees it as comped; it cannot cancel what the operator granted
    expect((await detail(C, 'quote-pro')).subscription).toMatchObject({
      status: 'comped',
      actions: { canCancel: false, canRenew: false },
    });
    expect((await install(C, 'quote-pro')).status).toBe(201);
    const cancel = await mp(C).post('/apps/quote-pro/subscription/cancel', {});
    expect(cancel.status).toBe(409);
    expect(code(cancel)).toBe('MKT_SUBSCRIPTION_STATE');
  });

  it('refuses to comp what is free, an unknown workspace, a workspace that pays, and a comp with no note', async () => {
    const ws = await orgUuid(F);
    expect(
      code(
        await ops().post('/apps/free-app/subscriptions/comp', {
          workspaceId: ws,
          note: 'Launch partner',
        }),
      ),
    ).toBe('MKT_SUBSCRIPTION_STATE');
    expect(
      (
        await ops().post('/apps/quote-pro/subscriptions/comp', {
          workspaceId: '8a6f0c3e-3b8e-4d0e-8f43-0d0f3f3f3f3f',
          note: 'Launch partner',
        })
      ).status,
    ).toBe(404);
    expect(
      (await ops().post('/apps/quote-pro/subscriptions/comp', { workspaceId: ws, note: 'ok' }))
        .status,
    ).toBe(422);
    const paying = await ops().post('/apps/quote-pro/subscriptions/comp', {
      workspaceId: await orgUuid(A),
      months: 1,
      note: 'Launch partner',
    });
    expect(paying.status).toBe(409);
    expect(code(paying)).toBe('MKT_SUBSCRIPTION_STATE');
    expect(
      await count(`SELECT count(*) AS n FROM workspace_addons WHERE org_id = $1`, [A.orgId]),
    ).toBe(3); // untouched
  });

  it('who subscribes to what: filters, paging, and the monthly recurring revenue per app', async () => {
    const all = marketOperatorSubscriptionListSchema.parse(
      (await ops().get('/subscriptions?limit=100')).body,
    );
    const quote = all.data.filter((s) => s.app.slug === 'quote-pro');
    expect(quote.map((s) => /price[ACE]/.exec(s.workspace.name)![0]).sort()).toEqual([
      'priceA',
      'priceC',
      'priceE',
    ]);
    expect(all.data.every((s) => typeof s.workspace.id === 'string')).toBe(true);
    const comped = marketOperatorSubscriptionListSchema.parse(
      (await ops().get('/subscriptions?status=comped')).body,
    );
    expect(comped.data.map((s) => s.id)).toEqual([compId]);
    // the trial of D became a paid subscription when D paid, so no trial is left; the one comp is
    expect((await ops().get('/subscriptions?source=trial')).body.data).toEqual([]);
    expect(
      (await ops().get('/subscriptions?source=comp')).body.data.map((s: { id: string }) => s.id),
    ).toEqual([compId]);
    expect(
      (await ops().get('/subscriptions?status=ended')).body.data.map(
        (s: { app: { slug: string } }) => s.app.slug,
      ),
    ).toEqual(['trial-app']);
    expect(
      (await ops().get('/subscriptions?app=trial-app')).body.data.every(
        (s: { app: { slug: string } }) => s.app.slug === 'trial-app',
      ),
    ).toBe(true);
    expect(
      (await ops().get('/subscriptions?q=priceC')).body.data.map((s: { id: string }) => s.id),
    ).toEqual([compId]);
    const page1 = await ops().get('/subscriptions?limit=2');
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.page.hasMore).toBe(true);
    const page2 = await ops().get(
      `/subscriptions?limit=2&cursor=${encodeURIComponent(page1.body.page.nextCursor)}`,
    );
    expect(page2.status).toBe(200);
    expect(page2.body.data.map((s: { id: string }) => s.id)).not.toContain(page1.body.data[0].id);
    expect((await ops().get('/subscriptions?cursor=%25%25')).status).toBe(422);

    // MRR: the active paid subscriptions at list price, per currency, never trials or comps
    const summary = marketSubscriptionSummarySchema.parse(
      (await ops().get('/subscriptions/summary')).body,
    );
    const q = summary.data.find((r) => r.slug === 'quote-pro')!;
    expect(q.pricing).toEqual({ model: 'paid_monthly', amount: '9.00', currency: 'USD' });
    expect(q.counts).toMatchObject({ active: 2, comped: 1, trialing: 0, canceling: 0 });
    expect(q.mrr).toEqual([{ currency: 'USD', amount: '18.00' }]); // A and E at 9.00; the comp is free
    const t = summary.data.find((r) => r.slug === 'trial-app')!;
    expect(t.counts).toMatchObject({ active: 1, ended: 1, total: 2 }); // D pays; B's subscription ended
    expect(t.mrr).toEqual([{ currency: 'EUR', amount: '5.00' }]);
    expect(summary.totals).toEqual([
      { currency: 'EUR', amount: '5.00' },
      { currency: 'USD', amount: '18.00' },
    ]);
    expect(summary.data.find((r) => r.slug === 'free-app')).toBeUndefined();
  });

  it('cancels a subscription at the end of its period without touching what was paid, then now with the installation paused', async () => {
    const asA = (await ops().get('/subscriptions?q=priceA')).body.data.find(
      (s: { app: { slug: string } }) => s.app.slug === 'quote-pro',
    );
    const soft = await ops().post(`/subscriptions/${asA.id}/cancel`, {
      reason: 'Fraud review',
      immediate: false,
    });
    expect(soft.status, JSON.stringify(soft.body)).toBe(200);
    expect(soft.body).toMatchObject({ status: 'canceling' });
    expect(new Date(soft.body.currentPeriodEnd).getTime()).toBe(
      new Date(asA.currentPeriodEnd).getTime(),
    );
    expect((await installOf(A, 'quote-pro')).status).toBe('active');

    // the comp has no period to wait for, so cancelling it ends it now: the entitlement is withdrawn and the installation paused
    const hard = await ops().post(`/subscriptions/${compId}/cancel`, {
      reason: 'Partnership ended',
      immediate: true,
    });
    expect(hard.status, JSON.stringify(hard.body)).toBe(200);
    expect(hard.body.status).toBe('ended');
    expect(
      await one(`SELECT status FROM workspace_addons WHERE org_id = $1`, [C.orgId]),
    ).toMatchObject({ status: 'cancelled' });
    expect(await installOf(C, 'quote-pro')).toMatchObject({
      status: 'disabled',
      paused_by_subscription: true,
    });
    expect((await detail(C, 'quote-pro')).pricing.access).toBe('subscription_required');
    expect(
      await count(
        `SELECT count(*) AS n FROM security_events WHERE event = 'platform.market.subscription_canceled' AND subject_org_id = $1`,
        [C.orgId],
      ),
    ).toBe(1);
    // repeating "now" re-runs the pause and changes nothing else; asking to wait on an ended one is refused
    expect(
      (
        await ops().post(`/subscriptions/${compId}/cancel`, {
          reason: 'Partnership ended',
          immediate: true,
        })
      ).status,
    ).toBe(200);
    expect(await events(C.orgId, 'marketplace.app.disabled')).toBe(1);
    expect(
      code(await ops().post(`/subscriptions/${compId}/cancel`, { reason: 'Partnership ended' })),
    ).toBe('MKT_SUBSCRIPTION_STATE');
    expect(
      (
        await ops().post('/subscriptions/8a6f0c3e-3b8e-4d0e-8f43-0d0f3f3f3f3f/cancel', {
          reason: 'Partnership ended',
        })
      ).status,
    ).toBe(404);
    // A resumes its own cancellation, so later steps see it active
    expect(
      (await mp(A).post('/apps/quote-pro/subscription/resume', {})).body.subscription.status,
    ).toBe('active');
  });
});

const orgUuid = async (t: Tenant): Promise<string> =>
  (await one<{ uuid: string }>(`SELECT uuid FROM organizations WHERE id = $1`, [t.orgId])).uuid;

// ============================================================================================================================================
describe('a price change applies to new subscriptions and the next payment, never to a period already paid for', () => {
  it('keeps what a subscriber paid, tells them the next payment, and prices the next order at the new price', async () => {
    const before = await subOf(A, 'quote-pro');
    const app = await setPaid('quote-pro', { amount: '12.50', trialDays: 0 });
    expect(app.pricing.amount).toBe('12.50');
    expect(Number((await packOf('quote-pro')).amount)).toBe(12.5);
    const after = await subOf(A, 'quote-pro');
    expect(Number(after.amount)).toBe(9); // what the last payment was
    expect(new Date(after.current_period_end).getTime()).toBe(
      new Date(before.current_period_end).getTime(),
    ); // the paid period is untouched
    const d = await detail(A, 'quote-pro');
    expect(d.pricing.amount).toBe('12.50');
    expect(d.subscription).toMatchObject({
      amount: '9.00',
      nextAmount: '12.50',
      nextCurrency: 'USD',
      status: 'active',
    });
    expect(d.pricing.access).toBe('entitled');
    // a workspace buying now (B, who had nothing) pays the new price
    expect((await quote(B, (await packOf('quote-pro')).slug)).body.subtotal).toBe('12.50');
    // saving the same price again does not move the "price changed" date
    const changedAt = (await appRow('quote-pro')).price_changed_at;
    await setPaid('quote-pro', { amount: '12.50', trialDays: 0 });
    expect((await appRow('quote-pro')).price_changed_at).toEqual(changedAt);
    // the renewal of A is at the new price once paid (the period far ahead is refused, so move it near its end first)
    await h.owner.query(
      `UPDATE workspace_addons SET ends_at = now() + interval '3 days', starts_at = now() - interval '27 days' WHERE org_id = $1`,
      [A.orgId],
    );
    await h.owner.query(
      `UPDATE marketplace_subscriptions SET current_period_end = now() + interval '3 days' WHERE org_id = $1`,
      [A.orgId],
    );
    expect((await detail(A, 'quote-pro')).subscription!.actions.canRenew).toBe(true);
    await pay(A, (await packOf('quote-pro')).slug);
    const renewed = await subOf(A, 'quote-pro');
    expect(Number(renewed.amount)).toBe(12.5);
    expect((await detail(A, 'quote-pro')).subscription!.nextAmount).toBeNull();
  });
});

// ============================================================================================================================================
describe('stopping sales and plans that include an app', () => {
  it('purchasable off: newcomers cannot subscribe or pay, a workspace that already pays may renew', async () => {
    await setPaid('quote-pro', { amount: '12.50', purchasable: false });
    const pack = await packOf('quote-pro');
    const d = await detail(B, 'quote-pro');
    expect(d.pricing).toMatchObject({
      access: 'not_for_sale',
      checkoutPath: null,
      trialAvailable: false,
    });
    const sub = await mp(B).post('/apps/quote-pro/subscribe', {});
    expect(sub.status).toBe(409);
    expect(code(sub)).toBe('MKT_NOT_FOR_SALE');
    const q = await quote(B, pack.slug);
    expect(q.status).toBe(422);
    expect(q.body.errors).toEqual([{ path: 'marketplace', message: 'not_for_sale' }]);
    expect(code(await install(B, 'quote-pro'))).toBe('MKT_NOT_FOR_SALE');
    // A has an active subscription: it may still renew (move its period near its end first)
    await h.owner.query(
      `UPDATE workspace_addons SET ends_at = now() + interval '3 days', starts_at = now() - interval '27 days' WHERE org_id = $1`,
      [A.orgId],
    );
    expect((await quote(A, pack.slug)).status).toBe(200);
    expect((await detail(A, 'quote-pro')).pricing.access).toBe('entitled');
    await setPaid('quote-pro', { amount: '12.50', purchasable: true });
  });

  it('a plan that includes the app makes it free for that workspace, and only for that one', async () => {
    await setPaid('plan-app', { amount: '7', includedMinPlan: 'growth' });
    const f = await detail(F, 'plan-app');
    expect(f.pricing).toMatchObject({
      access: 'included',
      includedBy: 'min_plan',
      checkoutPath: null,
    });
    expect((await detail(A, 'plan-app')).pricing.access).toBe('subscription_required');
    // install needs no subscription for F, and none exists
    const res = await mp(F).post('/apps/plan-app/install', { acceptedScopes: ['contacts.read'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(marketInstallResultSchema.parse(res.body).installation).toMatchObject({
      pricing: { access: 'included', includedBy: 'min_plan' },
      subscription: null,
    });
    expect(
      await count(`SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = $1`, [
        F.orgId,
      ]),
    ).toBe(0);
    // paying for what the plan already includes is refused, on the quote and on the order
    const pack = await packOf('plan-app');
    const q = await quote(F, pack.slug);
    expect(q.status).toBe(422);
    expect(q.body.errors).toEqual([{ path: 'marketplace', message: 'included' }]);
    expect((await mp(F).post('/apps/plan-app/subscribe', {})).body.outcome).toBe('included');
    // the sweep never touches it: there is no subscription to lapse
    await sweep();
    expect((await installOf(F, 'plan-app')).status).toBe('active');
    // the workspace on the free plan is not covered
    expect(
      code(await mp(A).post('/apps/plan-app/install', { acceptedScopes: ['contacts.read'] })),
    ).toBe('MKT_SUBSCRIPTION_REQUIRED');
  });

  it('a subscription that ends while the plan includes the app lapses without pausing the installation', async () => {
    // E subscribes to plan-app, then moves to the Growth plan; when its period ends the app stays on
    const pack = await packOf('plan-app');
    await h.owner.query(`UPDATE organizations SET plan = 'freebie' WHERE id = $1`, [E.orgId]);
    await pay(E, pack.slug);
    expect(
      (await mp(E).post('/apps/plan-app/install', { acceptedScopes: ['contacts.read'] })).status,
    ).toBe(201);
    await h.owner.query(`UPDATE organizations SET plan = 'growth' WHERE id = $1`, [E.orgId]);
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, plan_ends_at) VALUES ($1, now() + interval '60 days') ON CONFLICT (org_id) DO UPDATE SET plan_ends_at = now() + interval '60 days'`,
      [E.orgId],
    );
    await runOut(E, 'plan-app');
    await sweep();
    expect((await subOf(E, 'plan-app')).status).toBe('lapsed');
    expect(await installOf(E, 'plan-app')).toMatchObject({
      status: 'active',
      paused_by_subscription: false,
    });
  });

  it('a free app stays free: no subscription, no checkout, no entitlement lookup', async () => {
    const d = await detail(A, 'free-app');
    expect(d.pricing).toMatchObject({
      model: 'free',
      access: 'free',
      amount: null,
      checkoutPath: null,
    });
    expect(
      await count(
        `SELECT count(*) AS n FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id WHERE a.slug = 'free-app'`,
      ),
    ).toBe(0);
  });
});

// ============================================================================================================================================
describe('uninstall and the kill switch meet subscriptions', () => {
  it('uninstalling stops the renewal but the period paid for stays, so reinstalling inside it costs nothing', async () => {
    const inst = await installOf(A, 'quote-pro');
    const canceledBefore = await events(A.orgId, 'marketplace.subscription.canceled');
    expect(
      (await mp(A).post(`/installations/${inst.uuid}/uninstall`, { dataChoice: 'keep' })).status,
    ).toBe(204);
    const sub = await subOf(A, 'quote-pro');
    expect(sub).toMatchObject({ status: 'active', cancel_at_period_end: true });
    expect(await events(A.orgId, 'marketplace.subscription.canceled')).toBe(canceledBefore + 1);
    expect(
      await one(
        `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'marketplace.app.uninstalled' ORDER BY id DESC LIMIT 1`,
        [A.orgId],
      ),
    ).toMatchObject({ payload: { renewalStopped: true } });
    expect((await detail(A, 'quote-pro')).subscription).toMatchObject({ status: 'canceling' });
    expect((await install(A, 'quote-pro')).status).toBe(201);
    // a free app has no subscription to stop
    const free = await installOf(A, 'free-app');
    expect(
      (await mp(A).post(`/installations/${free.uuid}/uninstall`, { dataChoice: 'keep' })).status,
    ).toBe(204);
    expect(await events(A.orgId, 'marketplace.subscription.canceled')).toBe(canceledBefore + 1);
    // a comp is the operator's: uninstalling does not cancel it
    const compInst = await installOf(C, 'quote-pro');
    expect(
      (await mp(C).post(`/installations/${compInst.uuid}/uninstall`, { dataChoice: 'keep' }))
        .status,
    ).toBe(204);
  });

  it('the kill switch withdraws the app: nothing renews, checkout refuses it, installations are off', async () => {
    const res = await ops().post('/apps/quote-pro/kill', {
      reason: "Security incident in the developer's service",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await installOf(A, 'quote-pro')).toMatchObject({
      status: 'killed',
      paused_by_subscription: false,
    });
    expect(await installOf(E, 'quote-pro')).toMatchObject({ status: 'killed' });
    const subs = await rows<{ cancel_at_period_end: boolean; status: string }>(
      `SELECT s.* FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id WHERE a.slug = 'quote-pro' AND s.status = 'active'`,
    );
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every((s) => s.cancel_at_period_end)).toBe(true);
    // a workspace that has it installed can see it, but cannot pay for a withdrawn app; one that never had it cannot see it at all
    const pack = await packOf('quote-pro');
    const q = await quote(A, pack.slug);
    expect(q.status).toBe(422);
    expect(q.body.errors).toEqual([{ path: 'marketplace', message: 'unavailable' }]);
    expect((await quote(F, pack.slug)).body.errors).toEqual([
      { path: 'marketplace', message: 'unavailable' },
    ]);
    const sub = await mp(A).post('/apps/quote-pro/subscribe', {});
    expect(sub.status).toBe(409);
    expect(code(sub)).toBe('MKT_APP_UNAVAILABLE');
    // killed installations stay off, even if the paid period would let them run
    const inst = await installOf(A, 'quote-pro');
    const enable = await mp(A).post(`/installations/${inst.uuid}/enable`, {
      rowVersion: inst.row_version,
    });
    expect(code(enable)).toBe('MKT_INSTALLATION_KILLED');
    await sweep();
    expect((await installOf(A, 'quote-pro')).status).toBe('killed');
  });
});

describe('free again, and the sweep on its own schedule', () => {
  it("switching a paid app back to free keeps subscribers' time, retires the add-on from sale, and never pauses anything", async () => {
    const res = await setPricing('plan-app', { model: 'free' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pricing).toMatchObject({
      model: 'free',
      amount: null,
      currency: null,
      trialDays: 0,
      includedMinPlan: null,
    });
    expect((await packOf('plan-app')).is_active).toBe(false);
    expect((await detail(A, 'plan-app')).pricing).toMatchObject({ model: 'free', access: 'free' });
    expect(
      (await mp(A).post('/apps/plan-app/install', { acceptedScopes: ['contacts.read'] })).status,
    ).toBe(201);
    // the app is free: the checkout no longer sells its add-on
    expect((await quote(A, (await packOf('plan-app')).slug)).status).toBe(404);
  });

  it("the worker's own schedule runs the same idempotent sweep", async () => {
    const out = await h.app.get(SubscriptionSweepService, { strict: false }).run();
    expect(out).toEqual({ lapsed: 0, paused: 0 });
  });
});

// ============================================================================================================================================
describe('a first-party app that owns an existing plan feature (the first paid first-party app, e.g. booking)', () => {
  let G: Tenant;
  const analytics = (t: Tenant) => http().get('/v2/analytics/overview').set(bearer(t.admin));

  beforeAll(async () => {
    G = await api.signup('priceG');
    await h.owner.query(`UPDATE organizations SET plan = 'freebie' WHERE id = $1`, [G.orgId]);
    // the fake first-party app; the feature it will own is gated by RequirePlanFeature('analytics') on the analytics routes
    await publishListing(h, tokens(), {
      manifest: miniManifest({
        id: 'booking-lite',
        name: 'Booking Lite',
        scopes: ['contacts.read'],
      }),
      firstParty: true,
    });
    await h.owner.query(
      `UPDATE plans SET features = '{"analytics": true}'::jsonb WHERE slug = 'growth'`,
    );
  });

  it('only a first-party app, a known feature whose registry default is off, a paid app, and never the feature that includes it', async () => {
    const fieldErrors = async (slug: string, body: Record<string, unknown>) => {
      const res = await setPricing(slug, {
        model: 'paid_monthly',
        amount: '9',
        currency: 'USD',
        ...body,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      return res.body.errors as Array<{ path: string; message: string }>;
    };
    // a third-party app can never switch on a core capability
    expect(await fieldErrors('quote-pro', { grantsPlanFeatures: ['analytics'] })).toEqual([
      { path: 'grantsPlanFeatures', message: 'Only a first-party app can grant plan features.' },
    ]);
    // a feature that is on by default for every plan: the default must be switched off before an app owns it
    const onByDefault = await fieldErrors('booking-lite', {
      grantsPlanFeatures: ['sales_pipeline'],
    });
    expect(onByDefault).toHaveLength(1);
    expect(onByDefault[0]!.message).toContain('on by default');
    expect(await fieldErrors('booking-lite', { grantsPlanFeatures: ['not_a_feature'] })).toEqual([
      { path: 'grantsPlanFeatures', message: 'not_a_feature is not a plan feature.' },
    ]);
    expect(
      (await fieldErrors('booking-lite', { grandfatherExisting: true })).map((e) => e.path),
    ).toEqual(['grandfatherExisting']);
    expect(
      (
        await fieldErrors('booking-lite', {
          grantsPlanFeatures: ['analytics'],
          includedPlanFeature: 'analytics',
        })
      ).map((e) => e.path),
    ).toEqual(['includedPlanFeature']);
    const free = await setPricing('booking-lite', {
      model: 'free',
      grantsPlanFeatures: ['analytics'],
    });
    expect(free.status).toBe(422);
    expect((await packOf('booking-lite').catch(() => null)) ?? null).toBeNull(); // nothing was written
  });

  it('a listing still being prepared may name a feature that is on for everyone, so existing users can be comped first; publishing refuses it until the default is off', async () => {
    const created = await ops().post('/apps', {
      tagline: 'Booking: the first paid first-party app.',
      firstParty: true,
      manifest: miniManifest({
        id: 'draft-booking',
        name: 'Draft Booking',
        scopes: ['contacts.read'],
      }),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const paid = await setPaid('draft-booking', {
      amount: '19',
      grantsPlanFeatures: ['sales_pipeline'],
      grandfatherExisting: true,
    });
    expect(paid.pricing).toMatchObject({
      grantsPlanFeatures: ['sales_pipeline'],
      grandfatherExisting: true,
      includedMinPlan: null,
    });
    // sales_pipeline is ON by default today, so every workspace on a catalogue plan already has it: the dry run finds them all
    const dry = await ops().post('/apps/draft-booking/subscriptions/grandfather', {
      note: 'Existing users keep it',
    });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, comped: 0 });
    expect(dry.body.matched).toBe(
      await count(
        `SELECT count(*) AS n FROM organizations o JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'`,
      ),
    );
    expect(dry.body.matched).toBeGreaterThanOrEqual(7);
    // it cannot go on sale while every plan still grants the feature by default
    const reviewer = platformApi(h, reviewerToken);
    expect(
      (await reviewer.post(`/apps/draft-booking/versions/${created.body.versionId}/approve`, {}))
        .status,
    ).toBe(200);
    const publish = await reviewer.post('/apps/draft-booking/publish', {});
    expect(publish.status, JSON.stringify(publish.body)).toBe(409);
    expect(code(publish)).toBe('MKT_VERSION_STATE');
    expect(publish.body.errors).toEqual([
      { path: 'grantsPlanFeatures', message: 'sales_pipeline' },
    ]);
    expect((await appRow('draft-booking')).status).toBe('draft');
    // once the feature it owns is off by default (here: a different feature) there is nothing left to refuse
    const ready = await setPaid('draft-booking', {
      amount: '19',
      grantsPlanFeatures: ['analytics'],
    });
    expect(ready.pricing.grantsPlanFeatures).toEqual(['analytics']);
  });

  it('the add-on that sells the app carries the granted feature next to its own key; the listing says what it grants', async () => {
    const app = await setPaid('booking-lite', {
      amount: '15',
      grantsPlanFeatures: ['analytics'],
      grandfatherExisting: true,
    });
    expect(app.pricing).toMatchObject({
      model: 'paid_monthly',
      grantsPlanFeatures: ['analytics'],
      grandfatherExisting: true,
      includedPlanFeature: null,
      includedMinPlan: null,
    });
    expect((await packOf('booking-lite')).features).toEqual({
      mkt_booking_lite: true,
      analytics: true,
    });
    // not included in any plan by default: nobody gets it free
    expect((await detail(G, 'booking-lite')).pricing).toMatchObject({
      access: 'subscription_required',
      includedBy: null,
    });
    // the first-party flag cannot be removed while the app owns a feature
    const unflag = await ops().patch('/apps/booking-lite', {
      rowVersion: await rv('booking-lite'),
      firstParty: false,
    });
    expect(unflag.status).toBe(422);
    expect(unflag.body.errors).toEqual([
      { path: 'firstParty', message: 'Remove the plan features this app grants first.' },
    ]);
  });

  it('the existing gate keeps working UNCHANGED: locked before, open while subscribed, locked again when the subscription lapses', async () => {
    const locked = await analytics(G);
    expect(locked.status).toBe(422);
    expect(code(locked)).toBe('PLAN_FEATURE_LOCKED');
    expect(locked.body.errors).toContainEqual({ path: 'feature', message: 'analytics' });

    await pay(G, (await packOf('booking-lite')).slug);
    expect((await detail(G, 'booking-lite')).pricing.access).toBe('entitled');
    const open = await analytics(G);
    expect(open.status, JSON.stringify(open.body)).toBe(200);

    // the entitlement is the subscription's: when the period runs out and the sweep lapses it, the gate closes again
    await runOut(G, 'booking-lite');
    expect((await analytics(G)).status).toBe(422); // at once, before the sweep
    await sweep();
    expect((await subOf(G, 'booking-lite')).status).toBe('lapsed');
    expect((await analytics(G)).status).toBe(422);

    // resubscribing opens it again; the workspace's own override still beats the subscription
    await pay(G, (await packOf('booking-lite')).slug);
    expect((await analytics(G)).status).toBe(200);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features": {"analytics": false}}'::jsonb WHERE org_id = $1`,
      [G.orgId],
    );
    expect((await analytics(G)).status).toBe(422);
    await h.owner.query(`UPDATE org_plan_state SET overrides = '{}'::jsonb WHERE org_id = $1`, [
      G.orgId,
    ]);
    expect((await analytics(G)).status).toBe(200);
    // another workspace on the same plan, without the subscription, is still locked
    expect((await analytics(A)).status).toBe(422);
  });

  it('grandfather: a dry run lists who already has the feature, the real run comps them, and nobody loses it when the plan changes', async () => {
    const run = (body: Record<string, unknown>) =>
      ops().post('/apps/booking-lite/subscriptions/grandfather', body);
    // the Growth plan has analytics on explicitly: its workspaces (E and F in this spec) already have the feature
    const dry = await run({ note: 'Existing users keep it' });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, comped: 0 });
    expect(
      (dry.body.sample as Array<{ name: string }>).map((s) => /price[A-Z]/.exec(s.name)![0]).sort(),
    ).toEqual(['priceE', 'priceF']);
    expect(dry.body.matched).toBe(2);
    expect(
      await count(
        `SELECT count(*) AS n FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id WHERE a.slug = 'booking-lite'`,
      ),
    ).toBe(1); // only G's
    expect(
      (
        await ops().post('/apps/booking-lite/subscriptions/grandfather', {
          note: 'x',
          dryRun: true,
        })
      ).status,
    ).toBe(422);

    const real = await run({ note: 'Existing users keep it', dryRun: false, months: 12 });
    expect(real.status, JSON.stringify(real.body)).toBe(200);
    expect(real.body).toMatchObject({ dryRun: false, matched: 2, comped: 2 });
    const comped = await rows<{ source: string; comp_note: string }>(
      `SELECT s.source, s.comp_note FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id WHERE a.slug = 'booking-lite' AND s.org_id = ANY($1::bigint[])`,
      [[E.orgId, F.orgId]],
    );
    expect(comped).toEqual([
      { source: 'comp', comp_note: 'Existing users keep it' },
      { source: 'comp', comp_note: 'Existing users keep it' },
    ]);
    expect(
      await count(
        `SELECT count(*) AS n FROM security_events WHERE event = 'platform.market.subscriptions_grandfathered'`,
      ),
    ).toBe(1);
    expect(await events(F.orgId, 'marketplace.subscription.comped')).toBe(1);
    // running it again finds nobody: they have a subscription now
    expect((await run({ note: 'Existing users keep it' })).body.matched).toBe(0);

    // now the feature stops being a plan feature of Growth (the registry default and the plan rows are changed): they keep it, by comp
    await h.owner.query(
      `UPDATE plans SET features = '{"analytics": false}'::jsonb WHERE slug = 'growth'`,
    );
    expect((await analytics(F)).status).toBe(200);
    expect((await analytics(E)).status).toBe(200);
    // and a workspace that never had it still does not
    expect((await analytics(B)).status).toBe(422);
  });

  it('the grandfather action needs a paid listing that grants features and is marked for it, and its own permission', async () => {
    expect(
      code(
        await ops().post('/apps/free-app/subscriptions/grandfather', { note: 'Existing users' }),
      ),
    ).toBe('MKT_SUBSCRIPTION_STATE');
    await setPaid('booking-lite', {
      amount: '15',
      grantsPlanFeatures: ['analytics'],
      grandfatherExisting: false,
    });
    const unmarked = await ops().post('/apps/booking-lite/subscriptions/grandfather', {
      note: 'Existing users',
    });
    expect(unmarked.status).toBe(409);
    expect(code(unmarked)).toBe('MKT_SUBSCRIPTION_STATE');
    expect(
      (
        await platformApi(h, reviewerToken).post('/apps/booking-lite/subscriptions/grandfather', {
          note: 'Existing users',
        })
      ).status,
    ).toBe(403);
    expect(
      (await ops().post('/apps/nothere/subscriptions/grandfather', { note: 'Existing users' }))
        .status,
    ).toBe(404);
  });

  it('taking a feature away from the listing takes it away from its subscribers at once; a free listing grants nothing', async () => {
    expect((await analytics(G)).status).toBe(200);
    await setPaid('booking-lite', {
      amount: '15',
      grantsPlanFeatures: [],
      grandfatherExisting: false,
    });
    expect((await packOf('booking-lite')).features).toEqual({ mkt_booking_lite: true });
    expect((await analytics(G)).status).toBe(422);
    await setPaid('booking-lite', { amount: '15', grantsPlanFeatures: ['analytics'] });
    expect((await analytics(G)).status).toBe(200);
    const res = await setPricing('booking-lite', { model: 'free' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pricing).toMatchObject({
      model: 'free',
      grantsPlanFeatures: [],
      grandfatherExisting: false,
    });
    expect((await packOf('booking-lite')).is_active).toBe(false);
  });
});

// ============================================================================================================================================
describe('Appointments, the first paid first-party app (seeded as a draft, price unset)', () => {
  let H: Tenant;
  let I: Tenant;
  const has = (t: Tenant) =>
    h.app.get(PlanEntitlementService).featureEnabled(t.orgId, 'appointment_booking');

  beforeAll(async () => {
    H = await api.signup('priceH');
    I = await api.signup('priceI');
    await h.owner.query(`UPDATE organizations SET plan = 'freebie' WHERE id = ANY($1::bigint[])`, [
      [H.orgId, I.orgId],
    ]);
    // H already uses booking: it has a booking type
    await h.owner.query(
      `INSERT INTO booking_types (org_id, name, slug) VALUES ($1, 'Consultation', 'consultation')`,
      [H.orgId],
    );
  });

  it('is seeded as a draft first-party paid app with no price, granting appointment_booking, not in any plan', async () => {
    const op = await ops().get('/apps/appointments');
    expect(op.status, JSON.stringify(op.body)).toBe(200);
    expect(op.body).toMatchObject({
      status: 'draft',
      firstParty: true,
      kind: 'mini_app',
      pricing: {
        model: 'paid_monthly',
        amount: null,
        currency: null,
        grantsPlanFeatures: ['appointment_booking'],
        grandfatherExisting: true,
        includedPlanFeature: null,
        includedMinPlan: null,
        packSlug: null,
      },
    });
    // no plan includes it: the registry default is off and the seeded plan rows say so
    expect(await has(H)).toBe(false);
    expect(await has(I)).toBe(false);
    expect((await mp(H).get('/apps/appointments')).status).toBe(404); // a draft is invisible to workspaces
    expect(
      await count(
        `SELECT count(*) AS n FROM plans WHERE kind = 'plan' AND features ->> 'appointment_booking' = 'true'`,
      ),
    ).toBe(0);
  });

  it('cannot be published or grandfathered before the operator sets the price', async () => {
    const created = await ops().get('/apps/appointments');
    const reviewer = platformApi(h, reviewerToken);
    expect(
      (await reviewer.post(`/apps/appointments/versions/${created.body.versionId}/approve`, {}))
        .status,
    ).toBe(200);
    const publish = await reviewer.post('/apps/appointments/publish', {});
    expect(publish.status, JSON.stringify(publish.body)).toBe(409);
    expect(publish.body.errors).toEqual([{ path: 'pricing', message: 'price_not_set' }]);
    const early = await ops().post('/apps/appointments/subscriptions/grandfather', {
      note: 'Existing users keep it',
    });
    expect(code(early)).toBe('MKT_SUBSCRIPTION_STATE');
  });

  it('the operator sets the price, comps the workspaces already using booking, and publishes; nobody else gets it free', async () => {
    const priced = await setPaid('appointments', {
      amount: '20',
      grantsPlanFeatures: ['appointment_booking'],
      grandfatherExisting: true,
    });
    expect(priced.pricing).toMatchObject({ amount: '20.00', currency: 'USD' });
    const dry = await ops().post('/apps/appointments/subscriptions/grandfather', {
      note: 'Existing users keep it',
    });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect((dry.body.sample as Array<{ name: string }>).map((s) => s.name)).toEqual([
      expect.stringContaining('priceH'),
    ]);
    const real = await ops().post('/apps/appointments/subscriptions/grandfather', {
      note: 'Existing users keep it',
      dryRun: false,
    });
    expect(real.body).toMatchObject({ matched: 1, comped: 1 });
    expect(await has(H)).toBe(true);
    expect(await has(I)).toBe(false);
    expect((await subOf(H, 'appointments')).source).toBe('comp');

    expect(
      (await platformApi(h, reviewerToken).post('/apps/appointments/publish', {})).status,
    ).toBe(200);
    expect((await detail(I, 'appointments')).pricing).toMatchObject({
      access: 'subscription_required',
      includedBy: null,
      amount: '20.00',
    });
    expect((await detail(H, 'appointments')).pricing.access).toBe('entitled');
    // I pays and the existing appointment gates (the plan resolver) open
    await pay(I, (await packOf('appointments')).slug);
    expect(await has(I)).toBe(true);
  });
});
