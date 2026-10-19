import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';
import { race, statuses } from './support';

/**
 * QA Sheet3 #15, D-06. A coupon with N uses left must not be handed to more than N buyers who check out at the same moment.
 * Real checkout over HTTP (only Stripe's far end is faked). Scenario CC-CPN-04.
 *
 * Deliberate deviation from the Reference product: Reference let every concurrent buyer through. A pending order now holds one use
 * for 30 minutes; a failed or cancelled order gives it back. The coupons owner must confirm.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let superToken = '';
let stripeId = '';
let ip = 120;

const ops = (method: 'get' | 'post' | 'patch', path: string) =>
  api()[method](`/v2/platform${path}`).set(bearer(superToken));

async function signup(label: string): Promise<{ token: string; orgId: number }> {
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', `10.9.1.${ip++}`)
    .send({
      orgName: `Cpn ${label}`,
      fullName: 'Buyer',
      email: `${label}${Date.now()}@example.test`,
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

const realFetch = globalThis.fetch;
function stripeAcceptsEverything() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, init);
    if (url.hostname === 'api.stripe.com') {
      return new Response(
        JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
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
    .send({ code: hotp(base32Decode(setup.body.secret), totpStep(Date.now())) });
  expect(enabled.status).toBe(201);
  superToken = token;
  const list = await ops('get', '/payment-gateways');
  const g = list.body.data.find((x: { slug: string }) => x.slug === 'stripe');
  const saved = await ops('patch', `/payment-gateways/${g.id}`).send({
    mode: 'sandbox',
    credentials: {
      secret_key: 'sk_test_x',
      publishable_key: 'pk_test_x',
      webhook_secret: 'whsec_1',
    },
    rowVersion: g.rowVersion,
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const on = await ops('post', `/payment-gateways/${g.id}/active`).send({
    isActive: true,
    rowVersion: saved.body.rowVersion,
  });
  expect(on.status, JSON.stringify(on.body)).toBe(201);
  stripeId = g.id;
  const plan = await ops('post', '/plans').send({ name: 'Growth', slug: 'growth', amount: '49' });
  expect(plan.status, JSON.stringify(plan.body)).toBe(201);
}, 240_000);
afterAll(async () => {
  await h?.stop();
});
afterEach(() => vi.restoreAllMocks());

const mkCoupon = async (code: string, maxUses: number | null) =>
  Number(
    (
      await h.owner.query(
        `INSERT INTO coupons (code, type, amount, max_uses) VALUES ($1, 'percent', 20, $2) RETURNING id`,
        [code, maxUses],
      )
    ).rows[0].id,
  );
const place = (token: string, coupon?: string) =>
  api()
    .post('/v2/billing/checkout/plans/growth/orders')
    .set(bearer(token))
    .send({ gatewayId: stripeId, ...(coupon ? { coupon } : {}) });

describe('CC-CPN-04 a coupon with few uses left, many buyers at once', () => {
  it('8 buyers check out with a coupon that has 3 uses left: 3 orders are placed, 5 are refused as fully used', async () => {
    stripeAcceptsEverything();
    const id = await mkCoupon('LASTTHREE', 3);
    const buyers = await Promise.all(Array.from({ length: 8 }, (_, i) => signup(`cpn${i}`)));
    const res = await race(8, (i) => place(buyers[i]!.token, 'LASTTHREE'));
    expect(
      res.filter((r) => r.status === 201),
      JSON.stringify(statuses(res)),
    ).toHaveLength(3);
    for (const r of res.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(422);
      expect(r.body).toMatchObject({
        code: 'PAYGW_COUPON_REJECTED',
        detail: 'This coupon is fully used.',
      });
    }
    const held = await h.owner.query(`SELECT count(*)::int AS n FROM orders WHERE coupon_id = $1`, [
      id,
    ]);
    expect(held.rows[0].n).toBe(3);
  });

  it('a buyer without a coupon is not affected, and an unlimited coupon is never refused', async () => {
    stripeAcceptsEverything();
    await mkCoupon('NOLIMIT', null);
    const buyers = await Promise.all(Array.from({ length: 4 }, (_, i) => signup(`cpnu${i}`)));
    const res = await race(4, (i) => place(buyers[i]!.token, i % 2 === 0 ? 'NOLIMIT' : undefined));
    for (const r of res) expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('a failed order gives its use back', async () => {
    stripeAcceptsEverything();
    const id = await mkCoupon('ONEUSE', 1);
    const [a, b] = await Promise.all([signup('cpnf1'), signup('cpnf2')]);
    const first = await place(a.token, 'ONEUSE');
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((await place(b.token, 'ONEUSE')).status).toBe(422);
    await h.owner.query(`UPDATE orders SET status = 'failed' WHERE coupon_id = $1`, [id]);
    expect((await place(b.token, 'ONEUSE')).status).toBe(201);
  });
});
