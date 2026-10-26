import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminOrdersResponseSchema,
  billingAnalyticsResponseSchema,
  billingHistoryResponseSchema,
  billingSettingsResponseSchema,
  invoiceViewSchema,
  invoicesResponseSchema,
  orderAnalyticsResponseSchema,
} from '@crm/contracts';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';
import { pngOfSize } from '../../support/images';

/**
 * The operator billing screens end to end (TW-PAYGW-037..046, 007) through HTTP, against a real Postgres and the real AppModule:
 * order history with its approval queue, billing history, invoices, the three analytics, the CSV exports and the billing settings.
 * Orders are arranged with SQL (owner connection) so every status, window and currency can be set up exactly.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let superToken = '';
let supportToken = '';
type Method = 'get' | 'post' | 'put' | 'delete';
const ops = (method: Method, path: string, token = superToken) =>
  api()[method](`/v2/platform/billing${path}`).set(bearer(token));

interface Account {
  token: string;
  orgId: number;
  slug: string;
}
let ip = 120;
async function signup(label: string): Promise<Account> {
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', `10.8.0.${ip++}`)
    .send({
      orgName: `${label} Industries`,
      fullName: 'Bill Payer',
      email: `${label}${Date.now()}@example.test`,
      password: 'Str0ngPassw0rd#1',
      acceptTerms: true,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const token = res.body.tokens.accessToken as string;
  const session = await api().get('/v2/auth/session').set(bearer(token));
  const row = await h.owner.query(`SELECT id, slug FROM organizations WHERE slug = $1`, [
    session.body.org.slug,
  ]);
  return { token, orgId: Number(row.rows[0].id), slug: row.rows[0].slug as string };
}

let seq = 0;
interface O {
  kind?: string;
  plan?: string | null;
  status?: string;
  gateway?: string | null;
  currency?: string;
  total?: string;
  daysAgo?: number;
  paidDaysAgo?: number | null;
  proof?: boolean;
  email?: string;
  discount?: string;
  tax?: string;
  taxRate?: string;
  coupon?: string;
  description?: string;
  userId?: number | null;
  period?: string;
}
async function mkOrder(
  orgId: number,
  o: O = {},
): Promise<{ id: number; uuid: string; number: string }> {
  const status = o.status ?? 'paid';
  const kind = o.kind ?? 'plan';
  const number = `WSN-T${String(++seq).padStart(6, '0')}`;
  const created = o.daysAgo ?? 1;
  const paidAgo = status === 'paid' ? (o.paidDaysAgo ?? created) : null;
  const r = await h.owner.query(
    `INSERT INTO orders (org_id, user_id, order_number, kind, plan_slug, billing_period, currency, amount, total_amount, discount_amount,
       tax_amount, tax_rate, status, gateway_slug, customer_email, coupon_code, description, created_at, updated_at, paid_at,
       proof_submitted_at, payment_proof_path, payment_reference)
     VALUES ($1, $2, $3, $4, $5, $13, $6, $7, $7, $8, $9, $10, $11, $12, $14, $15, $16,
       now() - ($17 || ' days')::interval, now() - ($17 || ' days')::interval,
       CASE WHEN $18::int IS NULL THEN NULL ELSE now() - ($18 || ' days')::interval END,
       CASE WHEN $19 THEN now() - interval '1 hour' END, CASE WHEN $19 THEN 'proofs/x.png' END, CASE WHEN $19 THEN 'REF-1' END)
     RETURNING id, uuid`,
    [
      orgId,
      o.userId ?? null,
      number,
      kind,
      kind === 'wallet_topup' || kind === 'manual' ? null : (o.plan ?? 'growth'),
      o.currency ?? 'USD',
      o.total ?? '49.00',
      o.discount ?? '0',
      o.tax ?? '0',
      o.taxRate ?? '0',
      status,
      o.gateway === undefined ? 'stripe' : o.gateway,
      o.period ?? 'monthly',
      o.email ?? 'buyer@example.test',
      o.coupon ?? null,
      o.description ?? (kind === 'manual' ? 'Custom work' : null),
      String(created),
      paidAgo === null ? null : String(paidAgo),
      o.proof ?? false,
    ],
  );
  return { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string, number };
}
const clearOrders = () => h.owner.query(`DELETE FROM orders`);
const rowOf = async (uuid: string) =>
  (await h.owner.query(`SELECT * FROM orders WHERE uuid = $1`, [uuid])).rows[0];

async function setting(key: string, value: unknown) {
  await h.owner.query(
    `INSERT INTO platform_settings (key, value, is_secret) VALUES ($1, $2::jsonb, false)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
  h.app.get(PlatformSettingsService).invalidate();
}

async function got<T>(schema: { parse(v: unknown): T }, path: string): Promise<T> {
  const res = await ops('get', path);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return schema.parse(res.body);
}

let acme: Account;
let globex: Account;

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

  acme = await signup('acme');
  globex = await signup('globex');
  // Plans with real prices, so upgrade and downgrade can be told apart by price.
  for (const [slug, amount] of [
    ['starter_t', '9'],
    ['growth', '49'],
    ['scale', '99'],
  ] as const) {
    const res = await api()
      .post('/v2/platform/plans')
      .set(bearer(superToken))
      .send({ name: slug, slug, amount });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
  // One base currency (rate 1) and EUR worth two base units per euro-less: 1 USD = 0.5 EUR.
  await h.owner.query(
    `INSERT INTO currencies (name, code, symbol, exchange_rate, is_active) VALUES
       ('US dollar', 'USD', '$', 1, true), ('Euro', 'EUR', 'E', 0.5, true)
     ON CONFLICT (code) DO UPDATE SET exchange_rate = EXCLUDED.exchange_rate, is_active = true`,
  );
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  await clearOrders();
});

describe('access', () => {
  it('every operator role reads, only a super admin changes, and a workspace user or anonymous caller is refused', async () => {
    const o = await mkOrder(acme.orgId, { status: 'pending' });
    expect((await ops('get', '/orders', supportToken)).status).toBe(200);
    expect((await ops('post', `/orders/${o.uuid}/approve`, supportToken)).status).toBe(403);
    expect((await ops('post', `/orders/${o.uuid}/cancel`, supportToken)).status).toBe(403);
    expect((await ops('put', '/settings', supportToken).send({})).status).toBe(403);
    expect((await api().get('/v2/platform/billing/orders')).status).toBe(401);
    const ws = await api().get('/v2/platform/billing/orders').set(bearer(acme.token));
    expect([401, 403]).toContain(ws.status);
    expect((await rowOf(o.uuid)).status).toBe('pending');
  });
});

describe('order history (TW-PAYGW-037)', () => {
  it('30 orders in the window show 12 per page over 3 pages with a header count of 30; an old order is excluded', async () => {
    for (let i = 0; i < 30; i++) await mkOrder(acme.orgId, { daysAgo: 2 + (i % 20) });
    await mkOrder(acme.orgId, { daysAgo: 200 });
    const p1 = await got(adminOrdersResponseSchema, '/orders');
    expect(p1.total).toBe(30);
    expect(p1.data).toHaveLength(12);
    expect(p1.pageSize).toBe(12);
    expect((await got(adminOrdersResponseSchema, '/orders?page=3')).data).toHaveLength(6);
    expect(p1.kpis.total).toBe(30);
    const all = await got(adminOrdersResponseSchema, '/orders?window=all');
    expect(all.total).toBe(31);
    const newestFirst = p1.data.map((r) => r.createdAt);
    expect([...newestFirst].sort().reverse()).toEqual(newestFirst);
  });

  it('search matches the order number, the customer email, the workspace name and the plan name', async () => {
    const a = await mkOrder(acme.orgId, { email: 'zed@example.test' });
    await mkOrder(globex.orgId, { email: 'other@example.test', plan: 'scale' });
    const q = async (s: string) =>
      await got(adminOrdersResponseSchema, `/orders?q=${encodeURIComponent(s)}`);
    expect((await q('acme ind')).data.map((r) => r.orderNumber)).toEqual([a.number]);
    expect((await q('zed@')).total).toBe(1);
    expect((await q(a.number.slice(-4))).data[0]?.orderNumber).toBe(a.number);
    expect((await q('scale')).total).toBe(1);
    expect((await q('50%')).total).toBe(0);
  });

  it('derives real order types from the workspace history and the filter pills select them', async () => {
    await mkOrder(acme.orgId, { plan: 'starter_t', total: '9', daysAgo: 60 }); // new
    await mkOrder(acme.orgId, { plan: 'starter_t', total: '9', daysAgo: 40 }); // renewal
    await mkOrder(acme.orgId, { plan: 'growth', total: '49', daysAgo: 30 }); // upgrade
    await mkOrder(acme.orgId, { plan: 'starter_t', total: '9', daysAgo: 20 }); // downgrade
    await mkOrder(acme.orgId, { kind: 'wallet_topup', plan: null, total: '10', daysAgo: 5 });
    await mkOrder(acme.orgId, { status: 'failed', plan: 'starter_t', daysAgo: 3 });
    const list = await got(adminOrdersResponseSchema, '/orders');
    const types = list.data.map((r) => `${r.status}:${r.type}`);
    expect(types).toContain('paid:new');
    expect(types).toContain('paid:renewal');
    expect(types).toContain('paid:upgrade');
    expect(types).toContain('paid:downgrade');
    expect(types).toContain('paid:wallet_topup');
    const only = async (t: string) =>
      (await got(adminOrdersResponseSchema, `/orders?type=${t}`)).data;
    expect((await only('upgrade')).map((r) => r.type)).toEqual(['upgrade']);
    expect((await only('downgrade')).map((r) => r.type)).toEqual(['downgrade']);
    expect((await only('addon')).map((r) => r.type)).toEqual(['wallet_topup']);
    expect((await only('cancel')).map((r) => r.status)).toEqual(['failed']);
  });

  it('KPIs: counts and money in ONE reporting currency (a EUR order is converted), the delta against the previous window', async () => {
    await mkOrder(acme.orgId, { total: '100', daysAgo: 5 }); // new, 100 USD
    await mkOrder(acme.orgId, { currency: 'EUR', total: '50', plan: 'scale', daysAgo: 4 }); // 50 EUR = 100 USD, upgrade? same-slug rule below
    await mkOrder(acme.orgId, { status: 'failed', total: '20', daysAgo: 3 });
    await mkOrder(globex.orgId, { daysAgo: 120 }); // previous window, another workspace
    const r = await got(adminOrdersResponseSchema, '/orders');
    expect(r.reportingCurrency).toBe('USD');
    expect(r.kpis.total).toBe(3);
    expect(r.kpis.totalDeltaPct).toBe(200);
    expect(r.kpis.upgrades.count).toBe(2);
    expect(r.kpis.upgrades.money).toEqual({ currency: 'USD', amount: '200.00' });
    expect(r.kpis.cancellations).toMatchObject({ count: 1, money: { amount: '20.00' } });
  });

  it('a pending order older than the window is out of the table but a proof-bearing one stays in the approval queue', async () => {
    const old = await mkOrder(acme.orgId, {
      status: 'pending',
      daysAgo: 200,
      proof: true,
      gateway: 'offline',
    });
    const noProof = await mkOrder(acme.orgId, {
      status: 'pending',
      daysAgo: 200,
      gateway: 'offline',
    });
    const r = await got(adminOrdersResponseSchema, '/orders');
    expect(r.data).toHaveLength(0);
    expect(r.awaiting.map((a) => a.orderNumber)).toEqual([old.number]);
    expect(r.awaiting[0]).toMatchObject({ paymentReference: 'REF-1', hasProof: true });
    expect(r.awaiting.map((a) => a.orderNumber)).not.toContain(noProof.number);
  });
});

describe('approve, reject, cancel (TW-PAYGW-038, 039)', () => {
  it('approve pays the order, applies the plan once with the right end date, drops it from the queue, and a second approve changes nothing', async () => {
    const o = await mkOrder(acme.orgId, {
      status: 'pending',
      proof: true,
      gateway: 'offline',
      plan: 'growth',
    });
    const first = await ops('post', `/orders/${o.uuid}/approve`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ status: 'paid', unchanged: false });
    const row = await rowOf(o.uuid);
    expect(row.status).toBe('paid');
    expect(row.paid_at).not.toBeNull();
    expect(row.gateway_payment_id).toBe('REF-1');
    const org = (await h.owner.query(`SELECT plan FROM organizations WHERE id = $1`, [acme.orgId]))
      .rows[0];
    expect(org.plan).toBe('growth');
    const st = (
      await h.owner.query(
        `SELECT plan_ends_at, trial_ends_at FROM org_plan_state WHERE org_id = $1`,
        [acme.orgId],
      )
    ).rows[0];
    expect(st.trial_ends_at).toBeNull();
    const days = (new Date(st.plan_ends_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    const queue = await got(adminOrdersResponseSchema, '/orders');
    expect(queue.awaiting).toHaveLength(0);

    const second = await ops('post', `/orders/${o.uuid}/approve`);
    expect(second.body).toMatchObject({ unchanged: true });
    expect(second.body.message).toContain('already paid');
    const st2 = (
      await h.owner.query(`SELECT plan_ends_at FROM org_plan_state WHERE org_id = $1`, [acme.orgId])
    ).rows[0];
    expect(st2.plan_ends_at).toEqual(st.plan_ends_at);
    const audit = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.order.approved'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].payload).toMatchObject({ order: o.number, applied: 'plan_applied' });
  });

  it('approving a failed order works, a refunded one is refused with 409, an unknown id is 404', async () => {
    const failed = await mkOrder(acme.orgId, { status: 'failed' });
    expect((await ops('post', `/orders/${failed.uuid}/approve`)).body.status).toBe('paid');
    const refunded = await mkOrder(acme.orgId, { status: 'refunded' });
    const r = await ops('post', `/orders/${refunded.uuid}/approve`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PAYGW_ORDER_STATE');
    expect((await ops('post', '/orders/00000000-0000-4000-8000-000000000000/approve')).status).toBe(
      404,
    );
  });

  it('reject fails the order with the note and an audit row; a paid order cannot be rejected', async () => {
    const o = await mkOrder(acme.orgId, { status: 'pending', proof: true, gateway: 'offline' });
    const res = await ops('post', `/orders/${o.uuid}/reject`).send({
      reviewNote: 'Amount mismatch',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'failed', unchanged: false });
    const row = await rowOf(o.uuid);
    expect(row).toMatchObject({
      status: 'failed',
      failure_reason: 'rejected_by_admin',
      review_note: 'Amount mismatch',
    });
    const queue = await got(adminOrdersResponseSchema, '/orders');
    expect(queue.awaiting).toHaveLength(0);
    const paid = await mkOrder(acme.orgId, {});
    const bad = await ops('post', `/orders/${paid.uuid}/reject`).send({});
    expect(bad.status).toBe(409);
    expect((await rowOf(paid.uuid)).status).toBe('paid');
    expect(
      (await ops('post', `/orders/${o.uuid}/reject`).send({ reviewNote: 'x'.repeat(501) })).status,
    ).toBe(422);
  });

  it('cancel marks a pending order cancelled and the Cancellations KPI counts it; a paid or already-cancelled order is unchanged with a message', async () => {
    const pending = await mkOrder(acme.orgId, { status: 'pending' });
    const res = await ops('post', `/orders/${pending.uuid}/cancel`);
    expect(res.body).toMatchObject({ status: 'cancelled', unchanged: false });
    expect(await rowOf(pending.uuid)).toMatchObject({
      status: 'cancelled',
      failure_reason: 'cancelled_by_admin',
    });
    const k = (await got(adminOrdersResponseSchema, '/orders')).kpis;
    expect(k.cancellations.count).toBe(1);
    const paid = await mkOrder(acme.orgId, {});
    const p = await ops('post', `/orders/${paid.uuid}/cancel`);
    expect(p.body).toMatchObject({ unchanged: true, status: 'paid' });
    expect(p.body.message).toContain('already paid');
    expect((await rowOf(paid.uuid)).status).toBe('paid');
    const again = await ops('post', `/orders/${pending.uuid}/cancel`);
    expect(again.body).toMatchObject({ unchanged: true });
    expect(again.body.message).toContain('is not pending');
    const events = await h.owner.query(
      `SELECT event_type FROM event_outbox WHERE aggregate_module = 'orders' AND aggregate_id = $1`,
      [pending.id],
    );
    expect(events.rows.map((e) => e.event_type)).toContain('paygw.order.cancelled');
  });
});

describe('order analytics (TW-PAYGW-040)', () => {
  it('conversion is paid orders over sign-ups, the window all is bucketed by quarter, and an empty add-on list is empty', async () => {
    const users = Number(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM users WHERE created_at > now() - interval '90 days'`,
        )
      ).rows[0].n,
    );
    expect(users).toBeGreaterThan(0);
    for (let i = 0; i < users; i++) await mkOrder(acme.orgId, { daysAgo: 2 + i });
    const r = await got(orderAnalyticsResponseSchema, '/orders/analytics');
    expect(r.kpis.conversionPct).toBe(100);
    expect(r.kpis.paidCount).toBe(users);
    expect(r.addons).toEqual([]);
    expect(r.typeMix.map((m) => m.label)).toEqual(['Renewal', 'Add-on', 'Cancel']);
    const all = await got(orderAnalyticsResponseSchema, '/orders/analytics?window=all');
    expect(all.motion.labels[0]).toMatch(/^Q[1-4] \d{4}$/);
    expect(r.cohorts).toHaveLength(6);
    expect(r.funnel.map((f) => f.label)).toEqual(['Sign-ups', 'Converted to paid']);
  });

  it('lists the top add-on SKUs by paid spend', async () => {
    await mkOrder(acme.orgId, { kind: 'wallet_topup', plan: null, total: '30', gateway: 'stripe' });
    await mkOrder(acme.orgId, {
      kind: 'wallet_topup',
      plan: null,
      total: '10',
      gateway: 'razorpay',
    });
    const r = await got(orderAnalyticsResponseSchema, '/orders/analytics');
    expect(r.addons.map((a) => a.label)).toEqual(['Stripe add-on', 'Razorpay add-on']);
    expect(r.addons[0]).toMatchObject({ count: 1, total: '30.00' });
    expect(r.kpis.attachPct).toBe(100);
  });
});

describe('billing history (TW-PAYGW-041, 042)', () => {
  it('100 paid and 20 failed orders in 30 days give a success rate of 83.3%; gateway+status filters persist; window=all is quarterly', async () => {
    for (let i = 0; i < 25; i++)
      await mkOrder(acme.orgId, {
        daysAgo: 2 + (i % 20),
        gateway: i % 4 === 0 ? 'razorpay' : 'stripe',
      });
    for (let i = 0; i < 5; i++)
      await mkOrder(acme.orgId, { status: 'failed', daysAgo: 2 + i, gateway: 'stripe' });
    const r = await got(billingHistoryResponseSchema, '/history?window=30d');
    expect(r.kpis.charges).toBe(25);
    expect(r.kpis.failed).toBe(5);
    expect(r.kpis.successPct).toBe(83.3);
    expect(r.kpis.chargebacks).toBe(0);
    expect(r.gateways).toEqual(['razorpay', 'stripe']);
    const f = await got(
      billingHistoryResponseSchema,
      '/history?window=30d&gateway=stripe&status=failed',
    );
    expect(f.total).toBe(5);
    expect(f.data.every((x) => x.status === 'failed' && x.gatewaySlug === 'stripe')).toBe(true);
    const all = await got(billingHistoryResponseSchema, '/history?window=all');
    expect(all.trend.labels[0]).toMatch(/^Q[1-4] \d{4}$/);
    expect(all.trend.labels).toHaveLength(all.trend.charges.length);
  });

  it('refunded orders show in Refunds, the Failed bucket includes admin-cancelled orders, a refund is negative money', async () => {
    await mkOrder(acme.orgId, { status: 'refunded', total: '40', daysAgo: 3 });
    await mkOrder(acme.orgId, { status: 'cancelled', total: '15', daysAgo: 3 });
    await mkOrder(acme.orgId, { status: 'pending', daysAgo: 3 });
    const r = await got(billingHistoryResponseSchema, '/history');
    expect(r.kpis.refunds).toBe(1);
    expect(r.kpis.refundsMoney.amount).toBe('40.00');
    expect(r.kpis.failed).toBe(1);
    expect((await got(billingHistoryResponseSchema, '/history?status=pending')).total).toBe(1);
    expect((await got(billingHistoryResponseSchema, '/history?status=failed')).total).toBe(1);
  });

  it('analytics: the gateway share is 75/25 in descending order and a workspace with 3 paid orders is a top payer with count 3', async () => {
    for (let i = 0; i < 3; i++)
      await mkOrder(acme.orgId, { total: '100', gateway: 'stripe', daysAgo: 2 + i });
    await mkOrder(globex.orgId, { total: '100', gateway: 'razorpay' });
    const r = await got(billingAnalyticsResponseSchema, '/history/analytics');
    expect(r.gatewayMix).toEqual([
      { label: 'Stripe', value: 300 },
      { label: 'Razorpay', value: 100 },
    ]);
    expect(r.topWorkspaces[0]).toMatchObject({ orders: 3, total: '300.00' });
    expect(r.topWorkspaces[0]?.workspace?.name).toBe('acme Industries');
    expect(r.kpis.gross.amount).toBe('400.00');
    expect(r.kpis.net.amount).toBe('400.00');
    expect(r.statusMix).toEqual([{ label: 'Paid', value: 4 }]);
  });
});

describe('invoices (TW-PAYGW-043..046)', () => {
  it('badges: paid, outstanding, overdue after 15 days (counting days past the due date), refunded, void; the default window is all time', async () => {
    await mkOrder(acme.orgId, { status: 'paid', daysAgo: 100 });
    await mkOrder(acme.orgId, { status: 'pending', daysAgo: 2 });
    await mkOrder(acme.orgId, { status: 'pending', daysAgo: 20.5 }); // half a day of slack so DB and API clock skew cannot flip the floor
    await mkOrder(acme.orgId, { status: 'refunded', daysAgo: 5 });
    await mkOrder(acme.orgId, { status: 'failed', daysAgo: 5 });
    await mkOrder(acme.orgId, { status: 'cancelled', daysAgo: 5 });
    const r = await got(invoicesResponseSchema, '/invoices');
    expect(r.total).toBe(6);
    const by = (b: string) => r.data.filter((x) => x.badge === b);
    expect(by('paid')).toHaveLength(1);
    expect(by('outstanding')).toHaveLength(1);
    expect(by('overdue')).toHaveLength(1);
    expect(by('overdue')[0]?.daysLate).toBe(5);
    expect(by('refunded')).toHaveLength(1);
    expect(by('void')).toHaveLength(2);
    expect(r.kpis).toMatchObject({ total: 6, paid: 1, outstanding: 2, overdue: 1 });
    const filtered = async (s: string) =>
      await got(invoicesResponseSchema, `/invoices?status=${s}`);
    expect((await filtered('void')).total).toBe(2);
    expect((await filtered('overdue')).total).toBe(1);
    expect((await filtered('outstanding')).total).toBe(2);
    expect(
      (await got(invoicesResponseSchema, '/invoices?window=this_month')).total,
    ).toBeLessThanOrEqual(6);
    expect(r.workspaces.map((w) => w.name)).toContain('acme Industries');
  });

  it('manual invoice: validation, back-dated issue date, a pending manual order with no plan applied', async () => {
    expect(
      (
        await ops('post', '/invoices').send({
          workspaceId: acme.slug,
          amount: '5',
          currency: 'USD',
          status: 'pending',
          description: 'x',
        })
      ).status,
    ).toBe(422);
    const ws = (await got(invoicesResponseSchema, '/invoices')).workspaces.find(
      (w) => w.name === 'acme Industries',
    )!;
    const zero = await ops('post', '/invoices').send({
      workspaceId: ws.id,
      amount: '0',
      currency: 'EUR',
      status: 'pending',
      description: 'Custom quote',
    });
    expect(zero.status).toBe(422);
    const planBefore = (
      await h.owner.query(`SELECT plan FROM organizations WHERE id = $1`, [acme.orgId])
    ).rows[0].plan;
    const lastMonth = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    const made = await ops('post', '/invoices').send({
      workspaceId: ws.id,
      amount: '250',
      currency: 'eur',
      status: 'pending',
      description: 'Custom quote',
      issuedAt: lastMonth,
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const row = await rowOf(made.body.id);
    expect(row).toMatchObject({
      kind: 'manual',
      gateway_slug: 'manual',
      status: 'pending',
      currency: 'EUR',
      description: 'Custom quote',
    });
    expect(String(row.total_amount)).toBe('250.0000');
    expect(new Date(row.created_at).toISOString().slice(0, 10)).toBe(lastMonth);
    expect(row.plan_slug).toBeNull();
    const org = (await h.owner.query(`SELECT plan FROM organizations WHERE id = $1`, [acme.orgId]))
      .rows[0];
    expect(org.plan).toBe(planBefore);
    const view = await got(invoiceViewSchema, `/invoices/${made.body.id}`);
    expect(view.line.description).toBe('Custom quote');
    expect(view).toMatchObject({
      manual: true,
      badge: 'overdue',
      amountPaid: '0.00',
      balanceDue: '250.00',
      total: '250.00',
    });
    const audit = await h.owner.query(
      `SELECT 1 FROM security_events WHERE event = 'platform.invoice.created'`,
    );
    expect(audit.rows).toHaveLength(1);
    const paid = await ops('post', '/invoices').send({
      workspaceId: ws.id,
      amount: '99.50',
      currency: 'USD',
      status: 'paid',
      description: 'Setup',
    });
    expect((await rowOf(paid.body.id)).paid_at).not.toBeNull();
  });

  it('mark paid only records the payment for a manual invoice; with fulfilment it applies the plan; void and delete refuse a paid invoice and change a pending one', async () => {
    const manual = await mkOrder(acme.orgId, {
      kind: 'manual',
      status: 'pending',
      gateway: 'manual',
      total: '10',
    });
    const res = await ops('post', `/invoices/${manual.uuid}/mark-paid`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await rowOf(manual.uuid)).toMatchObject({ status: 'paid' });
    expect((await rowOf(manual.uuid)).paid_at).not.toBeNull();

    const planOrder = await mkOrder(globex.orgId, {
      status: 'pending',
      plan: 'scale',
      total: '99',
    });
    await ops('post', `/invoices/${planOrder.uuid}/mark-paid`).send({ applyFulfilment: true });
    const org = (
      await h.owner.query(`SELECT plan FROM organizations WHERE id = $1`, [globex.orgId])
    ).rows[0];
    expect(org.plan).toBe('scale');

    const paidVoid = await ops('post', `/invoices/${manual.uuid}/void`);
    expect(paidVoid.status).toBe(409);
    expect(paidVoid.body.detail).toContain('cannot be voided');
    const paidDelete = await ops('delete', `/invoices/${manual.uuid}`);
    expect(paidDelete.status).toBe(409);
    expect(await rowOf(manual.uuid)).toMatchObject({ status: 'paid' });

    const pending = await mkOrder(acme.orgId, { status: 'pending' });
    const voided = await ops('post', `/invoices/${pending.uuid}/void`);
    expect(voided.body).toMatchObject({ badge: 'void' });
    expect((await rowOf(pending.uuid)).status).toBe('cancelled');
    const gone = await ops('delete', `/invoices/${pending.uuid}`);
    expect(gone.status).toBe(200);
    expect(await rowOf(pending.uuid)).toBeUndefined();
    const events = await h.owner.query(
      `SELECT event FROM security_events WHERE event LIKE 'platform.invoice.%' ORDER BY id`,
    );
    expect(events.rows.map((e) => e.event).filter((e) => e !== 'platform.invoice.created')).toEqual(
      ['platform.invoice.marked_paid', 'platform.invoice.voided', 'platform.invoice.deleted'],
    );
  });

  it('the view of a paid order with a coupon and 18% tax shows discount, tax, amount paid = total and balance 0; a pending order owes the total', async () => {
    const paid = await mkOrder(acme.orgId, {
      total: '70.80',
      discount: '10',
      tax: '10.80',
      taxRate: '18',
      coupon: 'SAVE10',
    });
    const v = await got(invoiceViewSchema, `/invoices/${paid.uuid}`);
    expect(v).toMatchObject({
      discount: '10.00',
      taxAmount: '10.80',
      taxRate: '18',
      total: '70.80',
      subtotal: '70.00',
      amountPaid: '70.80',
      balanceDue: '0.00',
      badge: 'paid',
    });
    expect(v.payment).toMatchObject({ method: 'Stripe', couponCode: 'SAVE10' });
    expect(v.line.description).toBe('growth');
    const pending = await mkOrder(acme.orgId, { status: 'pending', total: '30' });
    const p = await got(invoiceViewSchema, `/invoices/${pending.uuid}`);
    expect(p).toMatchObject({ amountPaid: '0.00', balanceDue: '30.00' });
    const refunded = await mkOrder(acme.orgId, { status: 'refunded', total: '30' });
    expect(await got(invoiceViewSchema, `/invoices/${refunded.uuid}`)).toMatchObject({
      amountPaid: '0.00',
      balanceDue: '30.00',
    });
  });
});

describe('CSV export', () => {
  it('exports the filtered list with a header and neutralises formula-looking cells', async () => {
    await mkOrder(acme.orgId, { email: '=cmd@example.test', total: '12.50' });
    const orders = await ops('get', '/orders/export');
    expect(orders.status).toBe(200);
    expect(orders.body.filename).toBe('order-history-90d.csv');
    const lines = (orders.body.csv as string).trim().split('\n');
    expect(lines[0]).toBe(
      'Order #,Date,Workspace,Type,Item,Status,Currency,Total,Gateway,Customer email',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("'=cmd@example.test");
    expect(orders.body).toMatchObject({ rows: 1, truncated: false });
    expect((await ops('get', '/history/export')).body.csv).toContain('Order #');
    expect((await ops('get', '/invoices/export?status=paid')).body.rows).toBe(1);
  });
});

describe('billing settings (TW-PAYGW-007)', () => {
  const base = {
    taxEnabled: true,
    taxRate: 18,
    taxLabel: 'GST',
    refundEnabled: true,
    refundDays: 7,
    yearlyToggleEnabled: true,
    yearlyDiscountPct: 20,
    recurringEnabled: true,
    countries: ['India', 'India', ' Germany '],
    companyName: 'Acme Pvt Ltd',
    companyAddress: '1 Main St',
    companyTaxId: 'GSTIN1',
    companyRegNo: 'CIN1',
    companyEmail: 'billing@acme.test',
    companyPhone: '+91 1',
  };

  it('a fresh platform shows one set of defaults; saving stores Reference-named keys, de-duplicates countries, audits, and checkout reads them', async () => {
    await h.owner.query(
      `DELETE FROM platform_settings WHERE key LIKE 'checkout.%' OR key LIKE 'pricing.refund%' OR key LIKE 'billing.%' OR key = 'pricing.recurring_enabled'`,
    );
    h.app.get(PlatformSettingsService).invalidate();
    const fresh = await got(billingSettingsResponseSchema, '/settings');
    expect(fresh).toMatchObject({
      taxEnabled: false,
      taxRate: 0,
      refundEnabled: true,
      refundDays: 7,
      recurringEnabled: true,
      hasInvoiceLogo: false,
      invoiceLogoUrl: null,
    });
    expect(fresh.countries).toEqual(['India', 'United States', 'United Kingdom', 'Other']);

    const saved = await ops('put', '/settings').send({ ...base, version: fresh.version });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const s = billingSettingsResponseSchema.parse(saved.body);
    expect(s.countries).toEqual(['India', 'Germany']);
    expect(s).toMatchObject({
      taxEnabled: true,
      taxRate: 18,
      taxLabel: 'GST',
      companyName: 'Acme Pvt Ltd',
    });
    const keys = await h.owner.query(
      `SELECT key, value FROM platform_settings WHERE key IN ('checkout.tax_rate', 'checkout.countries', 'billing.company', 'pricing.refund_days')`,
    );
    const map = Object.fromEntries(keys.rows.map((r) => [r.key, r.value]));
    expect(map).toEqual({
      'checkout.tax_rate': 18,
      'checkout.countries': ['India', 'Germany'],
      'billing.company': 'Acme Pvt Ltd',
      'pricing.refund_days': 7,
    });
    const audit = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.checkout_settings.updated'`,
    );
    expect(audit.rows[0].payload).toMatchObject({ taxRate: 18, countryCount: 2 });
    expect(JSON.stringify(audit.rows[0].payload)).not.toContain('Acme Pvt Ltd');
  });

  it('rejects an out-of-range rate, a bad email and a stale version, and saves nothing', async () => {
    const cur = await got(billingSettingsResponseSchema, '/settings');
    expect(
      (await ops('put', '/settings').send({ ...base, taxRate: 101, version: cur.version })).status,
    ).toBe(422);
    expect(
      (await ops('put', '/settings').send({ ...base, companyEmail: 'nope', version: cur.version }))
        .status,
    ).toBe(422);
    expect(
      (await ops('put', '/settings').send({ ...base, taxLabel: '', version: cur.version })).status,
    ).toBe(422);
    const stale = await ops('put', '/settings').send({ ...base, taxRate: 5, version: 'none' });
    expect(stale.status).toBe(409);
    const after = await got(billingSettingsResponseSchema, '/settings');
    expect(after.taxRate).toBe(18);
  });

  it('a logo over 1 MB is refused and changes nothing; a png is accepted, served back, and removable; a fake png is refused', async () => {
    const png = pngOfSize(8 + 200);
    const big = pngOfSize(8 + 1024 * 1024 + 10);
    const tooBig = await ops('post', '/settings/logo').attach('file', big, 'logo.png');
    expect([413, 422]).toContain(tooBig.status);
    expect((await got(billingSettingsResponseSchema, '/settings')).hasInvoiceLogo).toBe(false);
    const fake = await ops('post', '/settings/logo').attach(
      'file',
      Buffer.from('<?php echo 1;'),
      'logo.png',
    );
    expect(fake.status).toBe(422);
    const ok = await ops('post', '/settings/logo').attach('file', png, 'logo.png');
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const s = billingSettingsResponseSchema.parse(ok.body);
    expect(s.hasInvoiceLogo).toBe(true);
    expect(s.invoiceLogoUrl).toMatch(/^\/api\/platform\/billing\/settings\/logo\?v=[0-9a-f]{8}$/);
    const served = await ops('get', '/settings/logo')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(served.headers['content-type']).toContain('image/png');
    expect(served.headers['content-security-policy']).toContain('sandbox');
    expect((served.body as Buffer).equals(png)).toBe(true);
    const cur = await got(billingSettingsResponseSchema, '/settings');
    const view = await mkOrder(acme.orgId, {});
    const inv = await got(invoiceViewSchema, `/invoices/${view.uuid}`);
    expect(inv.billing).toMatchObject({ company: cur.companyName, hasLogo: true });
    const removed = await ops('delete', '/settings/logo');
    expect(removed.status).toBe(200);
    expect(billingSettingsResponseSchema.parse(removed.body).hasInvoiceLogo).toBe(false);
    expect((await ops('get', '/settings/logo')).status).toBe(404);
  });

  it('the saved settings feed the checkout quote: tax rate and label, the country list and the refund line; tax off removes the tax line', async () => {
    await setting('checkout.tax_enabled', true);
    await setting('checkout.tax_rate', 18);
    await setting('checkout.tax_label', 'VAT');
    await setting('checkout.countries', ['India', 'Germany']);
    await setting('pricing.refund_days', 14);
    const q = await api().get('/v2/billing/checkout/plans/growth/quote').set(bearer(acme.token));
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body).toMatchObject({
      taxRate: '18',
      taxLabel: 'VAT',
      subtotal: '49.00',
      tax: '8.82',
      total: '57.82',
    });
    expect(q.body.countries).toEqual(['India', 'Germany']);
    expect(q.body.refund).toEqual({ enabled: true, days: 14 });
    await setting('checkout.tax_enabled', false);
    const off = await api().get('/v2/billing/checkout/plans/growth/quote').set(bearer(acme.token));
    expect(off.body).toMatchObject({ taxRate: '0', tax: '0.00', total: '49.00' });
    await setting('pricing.refund_enabled', false);
    const noRefund = await api()
      .get('/v2/billing/checkout/plans/growth/quote')
      .set(bearer(acme.token));
    expect(noRefund.body.refund.enabled).toBe(false);
  });
});
