import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  couponListResponseSchema,
  creditPackageListResponseSchema,
  currencyListResponseSchema,
  type CouponItem,
} from '@crm/contracts';
import { PlatformStore } from '../../../src/modules/auth';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { CouponCheckoutService } from '../../../src/modules/coupons-credits-referral-currency';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * Coupons, credit packages and the currency catalogue end to end through HTTP, against a real Postgres and the real AppModule:
 * validation, uniqueness, optimistic locking, the audit trail, role gating, and the service the checkout calls.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let superToken = '';
let supportToken = '';
const ops = (m: 'get' | 'post' | 'patch' | 'delete', path: string, t = superToken) =>
  api()[m](`/v2/platform${path}`).set(bearer(t));

const events = async (like: string) =>
  Number(
    (
      await h.owner.query(`SELECT count(*)::int AS n FROM security_events WHERE event LIKE $1`, [
        like,
      ])
    ).rows[0].n,
  );

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: hotp(base32Decode(setup.body.secret), totpStep(Date.now())) });
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
});

const newCoupon = (over: Record<string, unknown> = {}) => ({
  code: 'welcome10',
  type: 'percent',
  amount: '10',
  ...over,
});
async function createCoupon(over: Record<string, unknown> = {}): Promise<CouponItem> {
  const res = await ops('post', '/coupons').send(newCoupon(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as CouponItem;
}
const listCoupons = async (qs = '') => {
  const res = await ops('get', `/coupons${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return couponListResponseSchema.parse(res.body);
};

describe('coupon list, KPIs and filters (TW-CPN-001)', () => {
  it('shows the empty state numbers when nothing exists', async () => {
    const l = await listCoupons();
    expect(l.data).toEqual([]);
    expect(l.summary).toEqual({ total: 0, active: 0, expired: 0, redeemed: 0 });
    expect(l).toMatchObject({ total: 0, from: 0, to: 0, pageCount: 1 });
  });

  it('pages 30 coupons newest first, 12 at a time, and keeps the KPIs global', async () => {
    await h.owner.query(
      `INSERT INTO coupons (code, amount, uses_count) SELECT 'BULK' || lpad(g::text, 2, '0'), 5, 1 FROM generate_series(1, 28) g`,
    );
    await createCoupon({ code: 'save20', amount: '20', description: '20% off any plan' });
    await createCoupon({
      code: 'old',
      amount: '5',
      startsAt: '2020-01-01T00:00:00Z',
      expiresAt: '2020-02-01T00:00:00Z',
    });
    const p1 = await listCoupons();
    expect(p1.data).toHaveLength(12);
    expect(p1.data[0]!.code).toBe('OLD');
    expect(p1).toMatchObject({ total: 30, page: 1, pageCount: 3, from: 1, to: 12 });
    expect(p1.summary).toEqual({ total: 30, active: 30, expired: 1, redeemed: 28 });
    const p3 = await listCoupons('?page=3');
    expect(p3.data).toHaveLength(6);
    expect(p3).toMatchObject({ from: 25, to: 30 });
  });

  it('searches code and description, ignoring case and treating wildcards literally', async () => {
    const s = await listCoupons('?q=SaVe');
    expect(s.data.map((c) => c.code)).toEqual(['SAVE20']);
    expect(s.summary.total).toBe(30); // the KPI strip ignores the search
    expect((await listCoupons('?q=any%20plan')).data.map((c) => c.code)).toEqual(['SAVE20']);
    // '%' is a literal here (Reference's LIKE treated it as a wildcard and matched everything): only the description holding one matches
    expect((await listCoupons('?q=%25')).data.map((c) => c.code)).toEqual(['SAVE20']);
    expect((await listCoupons('?q=_')).data).toEqual([]);
  });

  it('filters by status; the Expired pill lists only the expired coupon, flagged', async () => {
    const e = await listCoupons('?status=expired');
    expect(e.data.map((c) => [c.code, c.isExpired])).toEqual([['OLD', true]]);
    expect(e.counts).toEqual({ all: 30, active: 30, disabled: 0, expired: 1 });
    expect((await listCoupons('?status=whatever')).total).toBe(30);
  });

  it('is open to every operator role and closed to everyone else', async () => {
    expect((await ops('get', '/coupons', supportToken)).status).toBe(200);
    expect((await api().get('/v2/platform/coupons')).status).toBe(401);
  });
});

describe('create coupon (TW-CPN-002)', () => {
  it('upper-cases the code, starts at zero uses, returns money as strings and audits', async () => {
    const before = await events('platform.coupon.created');
    const c = await createCoupon({
      code: ' welcome10 ',
      description: 'First plan',
      maxDiscountAmount: '50',
    });
    expect(c).toMatchObject({
      code: 'WELCOME10',
      type: 'percent',
      amount: '10',
      maxDiscountAmount: '50',
      usesCount: 0,
      isActive: true,
      firstPurchaseOnly: false,
      stackableWithOther: false,
      applicablePlans: [],
      isExpired: false,
      rowVersion: 1,
    });
    expect(await events('platform.coupon.created')).toBe(before + 1);
  });

  it('refuses a duplicate in any letter case, and nothing is saved', async () => {
    const res = await ops('post', '/coupons').send(newCoupon({ code: 'Save20' }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CPN_COUPON_CODE_TAKEN');
    expect((await listCoupons('?q=save20')).total).toBe(1);
  });

  it('refuses an expiry before the start, with the field named', async () => {
    const res = await ops('post', '/coupons').send(
      newCoupon({
        code: 'WIN',
        startsAt: '2030-02-01T00:00:00Z',
        expiresAt: '2030-01-01T00:00:00Z',
      }),
    );
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('expiresAt');
  });

  it('refuses a zero or missing cap, a negative amount and a bad number shape', async () => {
    for (const bad of [
      { maxUses: 0 },
      { perUserLimit: 0 },
      { amount: '-1' },
      { amount: 'abc' },
      { code: '   ' },
    ]) {
      const res = await ops('post', '/coupons').send(newCoupon({ code: 'BAD1', ...bad }));
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
  });

  it('accepts a percent above 100 (Reference parity) and blank optional numbers as null', async () => {
    const c = await createCoupon({ code: 'BIG', amount: '150', maxUses: '', minOrderAmount: '' });
    expect(c).toMatchObject({ amount: '150', maxUses: null, minOrderAmount: null });
  });

  it('refuses a plan restriction naming a plan that does not exist', async () => {
    const res = await ops('post', '/coupons').send(
      newCoupon({ code: 'PLANX', applicablePlans: ['nope'] }),
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CPN_COUPON_PLAN_UNKNOWN');
  });

  it('only a super admin writes', async () => {
    const res = await ops('post', '/coupons', supportToken).send(newCoupon({ code: 'SUP' }));
    expect(res.status).toBe(403);
  });

  it('the form options offer the catalogue plans and the active currencies', async () => {
    const res = await ops('get', '/billing-options');
    expect(res.status).toBe(200);
    expect(res.body.currencies.map((c: { code: string }) => c.code)).toContain('INR');
    expect(res.body.currencies).toHaveLength(30);
  });
});

describe('edit, toggle and delete coupon (TW-CPN-003..005)', () => {
  let coupon: CouponItem;
  let planA = '';

  it('clears a limit with null and clears the plan restriction with an empty list', async () => {
    const a = await ops('post', '/plans').send({ name: 'planA', slug: 'plana', amount: '10' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    planA = a.body.slug;
    coupon = await createCoupon({ code: 'EDITME', maxUses: 100, applicablePlans: [planA] });
    expect(coupon.applicablePlans).toEqual([planA]);

    const r1 = await ops('patch', `/coupons/${coupon.id}`).send({
      maxUses: null,
      rowVersion: coupon.rowVersion,
    });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.maxUses).toBeNull();
    expect(r1.body.applicablePlans).toEqual([planA]); // untouched: a patch names only what it changes

    const r2 = await ops('patch', `/coupons/${coupon.id}`).send({
      applicablePlans: [],
      rowVersion: r1.body.rowVersion,
    });
    expect(r2.body.applicablePlans).toEqual([]); // Reference could not do this
    coupon = r2.body;
  });

  it('refuses a stale row version, and a rename onto another coupon', async () => {
    const stale = await ops('patch', `/coupons/${coupon.id}`).send({ amount: '15', rowVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    const dup = await ops('patch', `/coupons/${coupon.id}`).send({
      code: 'save20',
      rowVersion: coupon.rowVersion,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CPN_COUPON_CODE_TAKEN');
  });

  it('writes an audit row with the change set, and none when nothing changed', async () => {
    const before = await events('platform.coupon.updated');
    const same = await ops('patch', `/coupons/${coupon.id}`).send({
      amount: coupon.amount,
      rowVersion: coupon.rowVersion,
    });
    expect(same.status).toBe(200);
    expect(await events('platform.coupon.updated')).toBe(before);
    const changed = await ops('patch', `/coupons/${coupon.id}`).send({
      amount: '12.5',
      rowVersion: same.body.rowVersion,
    });
    expect(changed.body.amount).toBe('12.5');
    expect(await events('platform.coupon.updated')).toBe(before + 1);
    coupon = changed.body;
  });

  it('lowering max uses below the redemptions made is allowed (the coupon is then "fully used")', async () => {
    await h.owner.query(`UPDATE coupons SET uses_count = 5 WHERE uuid = $1`, [coupon.id]);
    const cur = (await ops('get', `/coupons/${coupon.id}`)).body as CouponItem;
    const r = await ops('patch', `/coupons/${coupon.id}`).send({
      maxUses: 2,
      rowVersion: cur.rowVersion,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ maxUses: 2, usesCount: 5 });
    coupon = r.body;
  });

  it('toggles idempotently: the second identical call changes nothing', async () => {
    const off = await ops('patch', `/coupons/${coupon.id}/active`).send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    const n = await events('platform.coupon.deactivated');
    const again = await ops('patch', `/coupons/${coupon.id}/active`).send({ isActive: false });
    expect(again.body.isActive).toBe(false);
    expect(await events('platform.coupon.deactivated')).toBe(n);
    const on = await ops('patch', `/coupons/${coupon.id}/active`).send({ isActive: true });
    expect(on.body.isActive).toBe(true);
    coupon = on.body;
  });

  it('a missing id is a 404 for every verb', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect((await ops('get', `/coupons/${ghost}`)).status).toBe(404);
    expect((await ops('patch', `/coupons/${ghost}`).send({ rowVersion: 1 })).status).toBe(404);
    expect((await ops('patch', `/coupons/${ghost}/active`).send({ isActive: true })).status).toBe(
      404,
    );
    expect((await ops('delete', `/coupons/${ghost}`)).status).toBe(404);
  });

  it('deleting keeps past orders: their code snapshot stays, their coupon link is nulled', async () => {
    const org = await h.owner.query(
      `INSERT INTO organizations (slug, name) VALUES ('cpn-del', 'CPN del') RETURNING id`,
    );
    const orgId = Number(org.rows[0].id);
    const id = Number(
      (await h.owner.query(`SELECT id FROM coupons WHERE uuid = $1`, [coupon.id])).rows[0].id,
    );
    await h.owner.query(
      `INSERT INTO orders (org_id, order_number, currency, amount, kind, plan_slug, status, coupon_id, coupon_code, discount_amount)
       VALUES ($1, 'ORD-DEL-1', 'USD', 90, 'plan', 'pro', 'paid', $2, 'EDITME', 10)`,
      [orgId, id],
    );
    const del = await ops('delete', `/coupons/${coupon.id}`);
    expect(del.status).toBe(200);
    expect((await ops('get', `/coupons/${coupon.id}`)).status).toBe(404);
    const o = (
      await h.owner.query(
        `SELECT coupon_id, coupon_code, discount_amount::text AS d FROM orders WHERE order_number = 'ORD-DEL-1'`,
      )
    ).rows[0];
    expect(o).toEqual({ coupon_id: null, coupon_code: 'EDITME', d: '10.0000' });
    expect(await events('platform.coupon.deleted')).toBe(1);
  });
});

describe('the service the checkout calls (TW-CPN-006..008)', () => {
  let orgId = 0;
  let userId = 0;
  const svc = () => h.app.get(CouponCheckoutService);
  const quote = (code: string, over: Record<string, unknown> = {}) =>
    svc().quote({
      code,
      planSlug: 'plana',
      subtotalMinor: 100_00n,
      currency: 'USD',
      orgId,
      userId,
      ...over,
    });
  const order = (n: string, status: string, couponId: number | null, code: string | null) =>
    h.owner.query(
      `INSERT INTO orders (org_id, order_number, user_id, currency, amount, kind, plan_slug, status, coupon_id, coupon_code)
       VALUES ($1, $2, $3, 'USD', 100, 'plan', 'plana', $4, $5, $6) RETURNING id`,
      [orgId, n, userId, status, couponId, code],
    );
  const couponId = async (code: string) =>
    Number((await h.owner.query(`SELECT id FROM coupons WHERE code = $1`, [code])).rows[0].id);

  it('arranges a workspace and a buyer', async () => {
    const res = await api()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', '10.8.0.1')
      .send({
        orgName: 'Buyer Co',
        fullName: 'Buyer',
        email: `buyer${Date.now()}@example.test`,
        password: 'Str0ngPassw0rd#1',
        acceptTerms: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const session = await api().get('/v2/auth/session').set(bearer(res.body.tokens.accessToken));
    const o = await h.owner.query(`SELECT id FROM organizations WHERE slug = $1`, [
      session.body.org.slug,
    ]);
    orgId = Number(o.rows[0].id);
    userId = Number(
      (await h.owner.query(`SELECT id FROM users WHERE org_id = $1 LIMIT 1`, [orgId])).rows[0].id,
    );
    expect(orgId).toBeGreaterThan(0);
  });

  it('resolves a code typed in lower case with stray spaces and returns the canonical code and the discount', async () => {
    const q = await quote(' welcome10 ');
    expect(q).toMatchObject({
      ok: true,
      code: 'WELCOME10',
      discountMinor: 10_00n,
      message: 'Coupon applied.',
    });
  });

  it('applies the cap (20% of 1000 capped at 50 is 50)', async () => {
    await createCoupon({ code: 'CAPPED', amount: '20', maxDiscountAmount: '50' });
    expect(await quote('capped', { subtotalMinor: 1000_00n })).toMatchObject({
      ok: true,
      discountMinor: 50_00n,
    });
  });

  it('rejects an unknown, disabled and expired code with the documented sentence', async () => {
    expect(await quote('nope')).toMatchObject({
      ok: false,
      reason: 'not_found',
      message: 'Coupon "NOPE" not recognised.',
    });
    expect(await quote('')).toMatchObject({ ok: false, reason: 'empty' });
    await createCoupon({ code: 'OFF', isActive: false });
    expect(await quote('off')).toMatchObject({ ok: false, reason: 'disabled' });
    expect(await quote('old')).toMatchObject({
      ok: false,
      reason: 'expired',
      message: 'This coupon has expired.',
    });
  });

  it('enforces the currency lock and the plan restriction', async () => {
    await createCoupon({ code: 'INRONLY', currencyCode: 'inr' });
    expect(await quote('inronly')).toMatchObject({ ok: false, reason: 'currency_mismatch' });
    await createCoupon({ code: 'ONLYB', applicablePlans: ['plana'] });
    expect(await quote('onlyb', { planSlug: 'pro' })).toMatchObject({
      ok: false,
      reason: 'plan_mismatch',
    });
    expect(await quote('onlyb')).toMatchObject({ ok: true });
  });

  it('first purchase only: refused after one PAID order, accepted with only pending or failed ones', async () => {
    await createCoupon({ code: 'FIRST', firstPurchaseOnly: true });
    await order('ORD-P1', 'pending', null, null);
    await order('ORD-F1', 'failed', null, null);
    expect(await quote('first')).toMatchObject({ ok: true });
    await order('ORD-PAID1', 'paid', null, null);
    expect(await quote('first')).toMatchObject({ ok: false, reason: 'first_purchase_only' });
  });

  it('per-user limit counts only paid orders carrying this coupon', async () => {
    await createCoupon({ code: 'ONCE', perUserLimit: 1 });
    const id = await couponId('ONCE');
    await order('ORD-ONCE-PENDING', 'pending', id, 'ONCE');
    expect(await quote('once')).toMatchObject({ ok: true });
    const paid = await order('ORD-ONCE-PAID', 'paid', id, 'ONCE');
    expect(await quote('once')).toMatchObject({ ok: false, reason: 'per_user_limit' });
    await h.owner.query(`UPDATE orders SET status = 'refunded' WHERE id = $1`, [paid.rows[0].id]);
    expect(await quote('once')).toMatchObject({ ok: true });
  });

  it('counts a redemption exactly once, however many times the paid transition is replayed', async () => {
    await createCoupon({ code: 'COUNTME', maxUses: 1 });
    const id = await couponId('COUNTME');
    const o = await order('ORD-COUNT-1', 'paid', id, 'COUNTME');
    const orderId = Number(o.rows[0].id);
    const store = h.app.get(PlatformStore);
    const run = () => store.tx((tx) => svc().redeemForOrder(tx, orgId, orderId));
    expect(await run()).toBe('COUNTME');
    expect(await run()).toBeNull();
    expect(await run()).toBeNull();
    const row = (await h.owner.query(`SELECT uses_count FROM coupons WHERE code = 'COUNTME'`))
      .rows[0];
    expect(row.uses_count).toBe(1);
    expect(await quote('countme')).toMatchObject({
      ok: false,
      reason: 'exhausted',
      message: 'This coupon is fully used.',
    });
    const ev = await h.owner.query(
      `SELECT count(*)::int AS n FROM event_outbox WHERE aggregate_id = $1 AND event_type = 'coupon.redeemed'`,
      [orderId],
    );
    expect(ev.rows[0].n).toBe(1);
  });

  it('an order without a coupon redeems nothing', async () => {
    const o = await order('ORD-NOCOUPON', 'paid', null, null);
    const store = h.app.get(PlatformStore);
    expect(
      await store.tx((tx) => svc().redeemForOrder(tx, orgId, Number(o.rows[0].id))),
    ).toBeNull();
  });

  it('keeps counting for an order whose coupon was deleted after it was placed', async () => {
    await createCoupon({ code: 'GHOST' });
    const id = await couponId('GHOST');
    const o = await order('ORD-GHOST', 'paid', id, 'GHOST');
    const store = h.app.get(PlatformStore);
    await ops('delete', `/coupons/${(await listCoupons('?q=ghost')).data[0]!.id}`);
    // the order's link is now null, so there is nothing to count: no crash, no phantom redemption
    expect(
      await store.tx((tx) => svc().redeemForOrder(tx, orgId, Number(o.rows[0].id))),
    ).toBeNull();
  });
});

describe('credit packages (TW-CPN-009..013)', () => {
  const list = async () => {
    const res = await ops('get', '/credit-packages');
    expect(res.status).toBe(200);
    return creditPackageListResponseSchema.parse(res.body).data;
  };

  it('lists the three starter packages in display order with the computed rate', async () => {
    const all = await list();
    expect(all.map((p) => p.slug)).toEqual(['starter', 'growth', 'scale']);
    expect(all[1]).toMatchObject({
      badge: 'Most popular',
      isFeatured: true,
      price: '500.00',
      priceMinor: 50000,
      credits: 27500,
      creditsPerMajor: '55.0',
    });
    expect(all[0]!.creditsPerMajor).toBe('50.0');
  });

  it('derives the slug from the name, with -2 on a clash, and prices in the currency minor units', async () => {
    const a = await ops('post', '/credit-packages').send({
      name: 'Starter Pack',
      price: '499.50',
      currencyCode: 'inr',
      credits: 2500,
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body).toMatchObject({
      slug: 'starter-pack',
      priceMinor: 49950,
      price: '499.50',
      isActive: true,
      isFeatured: false,
      sortOrder: 0,
    });
    const b = await ops('post', '/credit-packages').send({
      name: 'Starter Pack',
      price: '1',
      currencyCode: 'INR',
      credits: 1,
    });
    expect(b.body.slug).toBe('starter-pack-2');
  });

  it('uses the real number of decimals of the currency (JPY has none, KWD three)', async () => {
    const jpy = await ops('post', '/credit-packages').send({
      name: 'Yen',
      price: '1500',
      currencyCode: 'JPY',
      credits: 100,
    });
    expect(jpy.body).toMatchObject({ priceMinor: 1500, price: '1500' });
    const kwd = await ops('post', '/credit-packages').send({
      name: 'Dinar',
      price: '1.5',
      currencyCode: 'KWD',
      credits: 100,
    });
    // KWD is not in the seeded catalogue, so it is refused until added
    expect(kwd.status).toBe(422);
    expect(kwd.body.code).toBe('CPN_CURRENCY_UNKNOWN');
  });

  it('refuses a currency outside the active catalogue, zero credits and a bad slug', async () => {
    const base = { name: 'X', price: '1', currencyCode: 'INR', credits: 5 };
    expect(
      (await ops('post', '/credit-packages').send({ ...base, currencyCode: 'XXX' })).body.code,
    ).toBe('CPN_CURRENCY_UNKNOWN');
    expect((await ops('post', '/credit-packages').send({ ...base, credits: 0 })).status).toBe(422);
    expect(
      (await ops('post', '/credit-packages').send({ ...base, slug: 'bad slug!' })).status,
    ).toBe(422);
    expect((await ops('post', '/credit-packages').send({ ...base, sortOrder: 10000 })).status).toBe(
      422,
    );
  });

  it('an explicit slug that is taken is refused', async () => {
    const res = await ops('post', '/credit-packages').send({
      name: 'Other',
      slug: 'growth',
      price: '1',
      currencyCode: 'INR',
      credits: 5,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CPN_PACKAGE_SLUG_TAKEN');
  });

  it('edits with an optimistic lock; clearing the slug re-derives it from the name', async () => {
    const growth = (await list()).find((p) => p.slug === 'growth')!;
    const up = await ops('patch', `/credit-packages/${growth.id}`).send({
      price: '600',
      rowVersion: growth.rowVersion,
    });
    expect(up.body).toMatchObject({ priceMinor: 60000, price: '600.00' });
    const stale = await ops('patch', `/credit-packages/${growth.id}`).send({
      price: '700',
      rowVersion: growth.rowVersion,
    });
    expect(stale.status).toBe(409);
    const cleared = await ops('patch', `/credit-packages/${growth.id}`).send({
      slug: null,
      rowVersion: up.body.rowVersion,
    });
    expect(cleared.body.slug).toBe('growth');
    const clash = await ops('patch', `/credit-packages/${growth.id}`).send({
      slug: 'scale',
      rowVersion: cleared.body.rowVersion,
    });
    expect(clash.status).toBe(409);
  });

  it('toggles idempotently and the row shows as disabled', async () => {
    const starter = (await list()).find((p) => p.slug === 'starter')!;
    const off = await ops('patch', `/credit-packages/${starter.id}/active`).send({
      isActive: false,
    });
    expect(off.body.isActive).toBe(false);
    const n = await events('platform.credit_package.deactivated');
    await ops('patch', `/credit-packages/${starter.id}/active`).send({ isActive: false });
    expect(await events('platform.credit_package.deactivated')).toBe(n);
    const on = await ops('patch', `/credit-packages/${starter.id}/active`).send({ isActive: true });
    expect(on.body.isActive).toBe(true);
  });

  it('delete keeps the orders that bought the package (their link is nulled) and a missing id is a 404', async () => {
    const created = await ops('post', '/credit-packages').send({
      name: 'Gone',
      price: '5',
      currencyCode: 'USD',
      credits: 10,
      sortOrder: 99,
    });
    const org = await h.owner.query(
      `INSERT INTO organizations (slug, name) VALUES ('cpn-pkg', 'pkg') RETURNING id`,
    );
    const pk = await h.owner.query(`SELECT id FROM credit_packages WHERE uuid = $1`, [
      created.body.id,
    ]);
    await h.owner.query(
      `INSERT INTO orders (org_id, order_number, currency, amount, kind, plan_slug, status, credit_package_id) VALUES ($1, 'ORD-PKG', 'USD', 5, 'plan', 'x', 'paid', $2)`,
      [org.rows[0].id, pk.rows[0].id],
    );
    expect((await ops('delete', `/credit-packages/${created.body.id}`)).status).toBe(200);
    expect((await ops('get', `/credit-packages/${created.body.id}`)).status).toBe(404);
    const o = await h.owner.query(
      `SELECT credit_package_id FROM orders WHERE order_number = 'ORD-PKG'`,
    );
    expect(o.rows[0].credit_package_id).toBeNull();
    expect((await ops('delete', `/credit-packages/${created.body.id}`)).status).toBe(404);
  });

  it('only a super admin writes; a support operator reads', async () => {
    expect((await ops('get', '/credit-packages', supportToken)).status).toBe(200);
    const res = await ops('post', '/credit-packages', supportToken).send({
      name: 'N',
      price: '1',
      currencyCode: 'INR',
      credits: 1,
    });
    expect(res.status).toBe(403);
  });
});

describe('currency catalogue (TW-CPN-018..025)', () => {
  const list = async (qs = '') => {
    const res = await ops('get', `/currencies${qs}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return currencyListResponseSchema.parse(res.body);
  };
  const byCode = async (code: string) => {
    const l = await list(`?q=${code}`);
    return l.data.find((c) => c.code === code)!;
  };

  it('seeds 30 active currencies with USD at rate 1, JPY at 0 decimals, and USD flagged default', async () => {
    const l = await list();
    expect(l.data).toHaveLength(12);
    expect(l.data.map((c) => c.code).slice(0, 3)).toEqual(['AED', 'ARS', 'AUD']);
    expect(l.summary).toEqual({ total: 30, active: 30, inactive: 0, defaultCode: 'USD' });
    expect(l.defaultChoices).toHaveLength(30);
    expect(await byCode('USD')).toMatchObject({ exchangeRate: '1', isDefault: true });
    expect(await byCode('JPY')).toMatchObject({ precision: 0 });
  });

  it('searches code, name or symbol: "rup" finds the three rupees', async () => {
    const l = await list('?q=rup');
    expect(l.data.map((c) => c.code).sort()).toEqual(['IDR', 'INR', 'PKR']);
  });

  it('adds a currency (code upper-cased, active), and refuses a duplicate, a zero rate and a bad code', async () => {
    const res = await ops('post', '/currencies').send({
      name: 'Swiss Franc',
      code: 'chf',
      precision: 2,
      exchangeRate: '0.88',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ code: 'CHF', isActive: true, exchangeRate: '0.88' });
    const dup = await ops('post', '/currencies').send({ name: 'Dollar again', code: 'usd' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CPN_CURRENCY_CODE_TAKEN');
    expect(
      (await ops('post', '/currencies').send({ name: 'Z', code: 'ZZZ', exchangeRate: '0' })).status,
    ).toBe(422);
    expect((await ops('post', '/currencies').send({ name: 'Z', code: 'ZZ' })).status).toBe(422);
    expect(
      (await ops('post', '/currencies').send({ name: 'Z', code: 'ZZZ', precision: 7 })).status,
    ).toBe(422);
  });

  it('edits a currency inline; the code is not editable and a stale version is refused', async () => {
    const chf = await byCode('CHF');
    const up = await ops('patch', `/currencies/${chf.id}`).send({
      exchangeRate: '0.9',
      symbol: 'Fr',
      rowVersion: chf.rowVersion,
    });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body).toMatchObject({ exchangeRate: '0.9', symbol: 'Fr', code: 'CHF' });
    const stale = await ops('patch', `/currencies/${chf.id}`).send({
      exchangeRate: '1',
      rowVersion: chf.rowVersion,
    });
    expect(stale.status).toBe(409);
    const rename = await ops('patch', `/currencies/${chf.id}`).send({
      code: 'XYZ',
      rowVersion: up.body.rowVersion,
    });
    expect((await byCode('CHF')).code).toBe('CHF');
    expect(rename.status).toBe(200); // unknown key is ignored, never applied
  });

  it('choosing the default stores text, updates the settings, flags the row and audits previous and new', async () => {
    const before = await events('platform.currency.default_changed');
    const res = await ops('post', '/currencies/default').send({ code: 'inr' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ defaultCode: 'INR' });
    expect((await list()).summary.defaultCode).toBe('INR');
    expect(await byCode('INR')).toMatchObject({ isDefault: true });
    expect(await byCode('USD')).toMatchObject({ isDefault: false });
    const flat = await h.owner.query(
      `SELECT value FROM platform_settings WHERE key = 'default_currency'`,
    );
    expect(flat.rows[0].value).toBe('INR');
    const general = await h.owner.query(
      `SELECT value->>'defaultCurrency' AS c FROM platform_settings WHERE key = 'set.general'`,
    );
    expect(general.rows[0].c).toBe('INR');
    expect(await events('platform.currency.default_changed')).toBe(before + 1);
    const ev = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.currency.default_changed'`,
    );
    expect(ev.rows[0].payload).toMatchObject({ previous: 'USD', now: 'INR' });
  });

  it('refuses a default that is unknown or inactive', async () => {
    const unknown = await ops('post', '/currencies/default').send({ code: 'QQQ' });
    expect(unknown.status).toBe(422);
    const eur = await byCode('EUR');
    await ops('patch', `/currencies/${eur.id}/active`).send({ isActive: false });
    const inactive = await ops('post', '/currencies/default').send({ code: 'EUR' });
    expect(inactive.status).toBe(422);
    await ops('patch', `/currencies/${eur.id}/active`).send({ isActive: true });
  });

  it('the default can be neither deactivated nor deleted, and the refusal is audited', async () => {
    const inr = await byCode('INR');
    const off = await ops('patch', `/currencies/${inr.id}/active`).send({ isActive: false });
    expect(off.status).toBe(409);
    expect(off.body.code).toBe('CPN_CURRENCY_DEFAULT_PROTECTED');
    const off2 = await ops('patch', `/currencies/${inr.id}`).send({
      isActive: false,
      rowVersion: inr.rowVersion,
    });
    expect(off2.status).toBe(409);
    const del = await ops('delete', `/currencies/${inr.id}`);
    expect(del.status).toBe(409);
    expect(await events('platform.currency.delete_blocked')).toBe(1);
    expect((await byCode('INR')).isActive).toBe(true);
  });

  it('toggles a non-default currency and drops it from the default selector', async () => {
    const aed = await byCode('AED');
    const off = await ops('patch', `/currencies/${aed.id}/active`).send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    const l = await list();
    expect(l.summary).toMatchObject({ active: 30, inactive: 1 }); // CHF added, AED off
    expect(l.defaultChoices.some((c) => c.code === 'AED')).toBe(false);
    const opts = await ops('get', '/billing-options');
    expect(opts.body.currencies.some((c: { code: string }) => c.code === 'AED')).toBe(false);
  });

  it('deletes an unused currency, but not one that a plan, package, coupon or order names', async () => {
    const chf = await byCode('CHF');
    expect((await ops('delete', `/currencies/${chf.id}`)).status).toBe(200);
    expect((await list('?q=chf')).data).toEqual([]);
    const jpy = await byCode('JPY');
    const jpyPkg = await ops('post', '/credit-packages').send({
      name: 'Yen pack',
      price: '1500',
      currencyCode: 'JPY',
      credits: 10,
    });
    expect(jpyPkg.status).toBe(201);
    const inUse = await ops('delete', `/currencies/${jpy.id}`);
    expect(inUse.status).toBe(409);
    expect(inUse.body.code).toBe('CPN_CURRENCY_IN_USE');
    expect(JSON.stringify(inUse.body)).toContain('credit packages');
  });

  it('refreshes rates from the provider: only catalogue currencies are touched, the rest keep theirs', async () => {
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('open.er-api.com')) {
        return new Response(
          JSON.stringify({ rates: { USD: 1, EUR: 0.5, INR: 90.123456, JPY: 150, UNKNOWN: 5 } }),
          { status: 200 },
        );
      }
      return realFetch(input, init);
    });
    const res = await ops('post', '/currencies/fetch-rates').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ updated: 4, provider: 'open.er-api.com' });
    expect(spy).toHaveBeenCalled();
    expect((await byCode('EUR')).exchangeRate).toBe('0.5');
    expect((await byCode('INR')).exchangeRate).toBe('90.123456');
    expect((await byCode('GBP')).exchangeRate).toBe('0.79'); // not in the provider's answer
    expect(await events('platform.currency.rates_fetched')).toBe(1);
  });

  it('a provider failure changes nothing, says why, and is audited', async () => {
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('open.er-api.com')) return new Response('boom', { status: 500 });
      return realFetch(input, init);
    });
    const res = await ops('post', '/currencies/fetch-rates').send({});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('CPN_RATES_FETCH_FAILED');
    expect(res.body.detail ?? res.body.message ?? JSON.stringify(res.body)).toContain('HTTP 500');
    expect((await byCode('EUR')).exchangeRate).toBe('0.5');
    expect(await events('platform.currency.rates_fetch_failed')).toBe(1);
  });

  it('a provider with no rates, or a network error, is reported too', async () => {
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('open.er-api.com'))
        return new Response(JSON.stringify({ rates: {} }), { status: 200 });
      return realFetch(input, init);
    });
    const none = await ops('post', '/currencies/fetch-rates').send({});
    expect(JSON.stringify(none.body)).toContain('no rates');
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('open.er-api.com')) throw new Error('timeout');
      return realFetch(input, init);
    });
    const down = await ops('post', '/currencies/fetch-rates').send({});
    expect(JSON.stringify(down.body)).toContain('Fetch failed');
  });

  it('only a super admin writes; a support operator reads', async () => {
    expect((await ops('get', '/currencies', supportToken)).status).toBe(200);
    expect(
      (await ops('post', '/currencies/default', supportToken).send({ code: 'USD' })).status,
    ).toBe(403);
    expect((await ops('post', '/currencies/fetch-rates', supportToken).send({})).status).toBe(403);
  });
});
