import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { paygwGatewayListResponseSchema, type PaygwGatewayItem } from '@crm/contracts';
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

const signPaytr = (f: { merchant_oid: string; status: string; total_amount: string }) =>
  createHmac('sha256', 'KEY')
    .update(`${f.merchant_oid}SALT${f.status}${f.total_amount}`)
    .digest('base64');

describe('P2 gateways through the real checkout (TW-PAYGW-018..025, 033)', () => {
  let buyer: Account;

  beforeAll(async () => {
    buyer = await signup('p2buyer');
    await makePlan('growth', '49', { name: 'Growth' });
  });

  const place = (gatewayId: string, extra: Record<string, unknown> = {}) =>
    api()
      .post('/v2/billing/checkout/plans/growth/orders')
      .set(bearer(buyer.token))
      .send({ gatewayId, ...extra });

  it('every gateway that used to lack a driver can now be configured and activated (Mollie)', async () => {
    await configure('mollie', { api_key: 'test_x' });
    const on = await activate('mollie');
    expect(on.status, JSON.stringify(on.body)).toBe(201);
    expect((await gateway('mollie')).driverAvailable).toBe(true);
    expect((await activate('mollie', false)).body.isActive).toBe(false);
  });

  it('Coinbase: the order starts pending with the charge code, only the signed charge:confirmed pays it, once, for the right amount', async () => {
    await configure('coinbase', { api_key: 'cb_key', webhook_secret: 'whsec' });
    expect((await activate('coinbase')).status).toBe(201);
    mockProviders();
    handlers.push((url) =>
      url.hostname === 'api.commerce.coinbase.com'
        ? {
            status: 201,
            body: {
              data: {
                id: 'uuid-1',
                code: 'CHG1',
                hosted_url: 'https://commerce.coinbase.com/charges/CHG1',
              },
            },
          }
        : undefined,
    );
    const placed = await place((await gateway('coinbase')).id);
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(placed.body.next).toEqual({
      type: 'redirect',
      url: 'https://commerce.coinbase.com/charges/CHG1',
    });
    const number = placed.body.orderNumber as string;
    expect(await orderBy(number)).toMatchObject({ status: 'pending', gateway_order_id: 'CHG1' });

    // the buyer coming back proves nothing: it stays pending (Reference marked it failed)
    const back = await api()
      .get(`/v2/payments/return/coinbase?o=${(await orderBy(number)).return_token}&status=success`)
      .redirects(0);
    expect(back.status).toBe(303);
    expect(back.headers.location).toContain('payment=pending');
    expect((await orderBy(number)).status).toBe('pending');

    const event = (amount: string, orderNumber = number) =>
      Buffer.from(
        JSON.stringify({
          event: {
            type: 'charge:confirmed',
            data: {
              id: 'uuid-1',
              code: 'CHG1',
              metadata: { order_number: orderNumber },
              pricing: { local: { amount, currency: 'USD' } },
            },
          },
        }),
      );
    const send = (raw: Buffer, sig?: string) =>
      api()
        .post('/v2/payments/webhook/coinbase')
        .set('content-type', 'application/json')
        .set(
          'x-cc-webhook-signature',
          sig ?? createHmac('sha256', 'whsec').update(raw).digest('hex'),
        )
        .send(raw.toString());
    expect((await send(event('49.00'), 'bad')).status).toBe(403);
    expect((await orderBy(number)).status).toBe('pending');
    expect((await send(event('1.00'))).status).toBe(200); // signed but the wrong amount: acknowledged, not applied
    expect((await orderBy(number)).status).toBe('pending');
    expect((await send(event('49.00'))).status).toBe(200);
    expect((await send(event('49.00'))).status).toBe(200); // provider retry
    const o = await orderBy(number);
    expect(o.status).toBe('paid');
    expect(await outboxCount(Number(o.id), 'paygw.order.paid')).toBe(1);
  });

  it('PayTR: a valid server notification is answered with the plain body OK (JSON made PayTR retry forever); a bad hash is 403', async () => {
    await configure('paytr', { merchant_id: 'M1', merchant_key: 'KEY', merchant_salt: 'SALT' });
    expect((await activate('paytr')).status).toBe(201);
    const f = { merchant_oid: 'PAYTR_UNKNOWN_1', status: 'success', total_amount: '4900' };
    const ok = await api()
      .post('/v2/payments/webhook/paytr')
      .type('form')
      .send({ ...f, hash: signPaytr(f) });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('OK');
    expect(ok.headers['content-type']).toContain('text/plain');
    const bad = await api()
      .post('/v2/payments/webhook/paytr')
      .type('form')
      .send({ ...f, hash: 'x' });
    expect(bad.status).toBe(403);
  });

  it('a form-post gateway (Skrill) and a widget gateway (HyperPay) return plain data for the browser to render, never server HTML', async () => {
    await configure('skrill', { merchant_id: 'merchant@example.test', secret_word: 'secret' });
    expect((await activate('skrill')).status).toBe(201);
    const skrill = await place((await gateway('skrill')).id);
    expect(skrill.status, JSON.stringify(skrill.body)).toBe(201);
    expect(skrill.body.next).toMatchObject({ type: 'form_post', url: 'https://pay.skrill.com' });
    expect(skrill.body.next.fields).toMatchObject({
      pay_to_email: 'merchant@example.test',
      amount: '49.00',
      currency: 'USD',
      order_number: skrill.body.orderNumber,
    });
    expect(JSON.stringify(skrill.body)).not.toContain('<form');

    await configure('hyperpay', { access_token: 'tok', entity_id: 'ent' });
    expect((await activate('hyperpay')).status).toBe(201);
    mockProviders();
    handlers.push((url) =>
      url.hostname === 'eu-test.oppwa.com' ? { status: 200, body: { id: 'CHK9' } } : undefined,
    );
    const hp = await place((await gateway('hyperpay')).id);
    expect(hp.status, JSON.stringify(hp.body)).toBe(201);
    expect(hp.body.next).toMatchObject({ type: 'client_action', provider: 'hyperpay' });
    expect(hp.body.next.params.scriptUrl).toContain('checkoutId=CHK9');
    expect(hp.body.next.params.returnUrl).toContain('/v2/payments/return/hyperpay?o=');
  });

  it('LigdiCash refuses a non-XOF order (Reference relabelled it) and leaves the order failed with the reason', async () => {
    await configure('ligdicash', { api_key: 'ak', api_token: 'at' });
    expect((await activate('ligdicash')).status).toBe(201);
    const res = await place((await gateway('ligdicash')).id);
    expect(res.status).toBe(502);
    const row = (
      await h.owner.query(
        `SELECT status, failure_reason FROM orders WHERE org_id = $1 AND gateway_slug = 'ligdicash'`,
        [buyer.orgId],
      )
    ).rows[0];
    expect(row.status).toBe('failed');
    expect(row.failure_reason).toContain('ligdicash_currency_unsupported');
  });

  it('TW-PAYGW-033: there is no endpoint that credits a wallet or activates a plan without a confirmed payment', async () => {
    const before = (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM orders WHERE org_id = $1 AND status = 'paid'`,
        [buyer.orgId],
      )
    ).rows[0].n;
    for (const path of [
      '/v2/checkout/complete',
      '/v2/billing/checkout/complete',
      '/v2/checkout/success',
    ]) {
      for (const method of ['post', 'get'] as const) {
        const r = await api()
          [method](path)
          .set(bearer(buyer.token))
          .send({ package_slug: 'x', payment_ref: 'free' });
        expect(r.status, `${method} ${path}`).toBe(404);
      }
    }
    const after = (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM orders WHERE org_id = $1 AND status = 'paid'`,
        [buyer.orgId],
      )
    ).rows[0].n;
    expect(after).toBe(before);
  });
});
