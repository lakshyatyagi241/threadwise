import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SHOPIFY,
  WOOCOMMERCE,
  type EcomResult,
  type ShopInfo,
  type ShopifyFactory,
  type WooFactory,
  type WooStoreInfo,
} from '../../../src/infra/providers/ecom/ecom.port';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { phpUrlencode } from '../../../src/modules/shopify-woocommerce/ecom-rules';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';
import { Api, bearer, type Tenant } from '../contacts-attributes-tags/support';

/** Connecting a Shopify or WooCommerce store (TW-ECOM-001 to 007, 025, 026), against a real Postgres and fake stores. */
let h: Harness;
let api: Api;
let settings: PlatformSettingsService;
let superToken = '';

const SECRET = 'shpss_platform_secret';
const calls: Array<{ what: string; args: unknown[] }> = [];
let exchange: EcomResult<{ accessToken: string; scope: string }> = {
  ok: true,
  data: { accessToken: 'shpat_token_1', scope: 'read_orders' },
};
let shopInfo: EcomResult<ShopInfo> = {
  ok: true,
  data: {
    id: '555',
    name: 'My Store',
    email: 'owner@store.test',
    owner: 'Owner',
    plan: 'basic',
    currency: 'INR',
    country: 'India',
  },
};
let hookCounter = 0;
let wooProbe: EcomResult<WooStoreInfo> = {
  ok: true,
  data: { name: 'Woo Shop', currency: 'USD', country: 'US', version: '9.1.0' },
};

const operator = () => request(h.app.getHttpServer());
const ops = (m: 'get' | 'put', p: string) =>
  operator()[m](`/v2/platform/ecom${p}`).set(bearer(superToken));

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h as never);
  settings = h.app.get(PlatformSettingsService);

  const first = await operator()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await operator().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  await operator()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: hotp(base32Decode(setup.body.secret), totpStep(Date.now())) });
  superToken = token;

  const shopify = h.app.get<ShopifyFactory>(SHOPIFY);
  shopify.app = () => ({
    exchangeCode: (shop, code) => {
      calls.push({ what: 'exchange', args: [shop, code] });
      return Promise.resolve(exchange);
    },
  });
  shopify.store = (shop, token2) => ({
    counts: () => Promise.resolve({ products: 0, orders: 0, customers: 0 }),
    products: () => Promise.resolve({ items: [], complete: true }),
    orders: () => Promise.resolve({ items: [], complete: true }),
    customers: () => Promise.resolve({ items: [], complete: true }),
    shop: () => {
      calls.push({ what: 'shop', args: [shop, token2] });
      return Promise.resolve(shopInfo);
    },
    registerWebhooks: (address, topics) => {
      calls.push({ what: 'register', args: [shop, address, topics.length] });
      const ids: Record<string, string> = {};
      for (const t of topics) ids[t] = `hook-${++hookCounter}`;
      return Promise.resolve(ids);
    },
    deleteWebhooks: (ids) => {
      calls.push({ what: 'delete', args: [shop, [...ids]] });
      return Promise.resolve();
    },
  });

  const woo = h.app.get<WooFactory>(WOOCOMMERCE);
  woo.store = (url, key, secret) => ({
    counts: () => Promise.resolve({ products: 0, orders: 0, customers: 0 }),
    products: () => Promise.resolve({ items: [], complete: true }),
    orders: () => Promise.resolve({ items: [], complete: true }),
    customers: () => Promise.resolve({ items: [], complete: true }),
    test: () => {
      calls.push({ what: 'wooTest', args: [url, key, secret] });
      return Promise.resolve(wooProbe);
    },
    registerWebhooks: (a) => {
      calls.push({
        what: 'wooRegister',
        args: [url, a.deliveryUrl, a.topics.length, a.nameOf('order.created')],
      });
      const ids: Record<string, string> = {};
      for (const t of a.topics) ids[t] = `wh-${++hookCounter}`;
      return Promise.resolve(ids);
    },
    deleteWebhooks: (ids) => {
      calls.push({ what: 'wooDelete', args: [url, [...ids]] });
      return Promise.resolve();
    },
    updateOrder: () => Promise.resolve(true),
    recent: () => Promise.resolve([]),
    salesReport: () => Promise.resolve({}),
    createPendingOrder: () => Promise.resolve(null),
  });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

async function configureShopify(on: boolean): Promise<void> {
  await settings.mergeDocument(
    'ecom.shopify',
    { enabled: on, clientId: on ? 'client-123' : '' },
    null,
  );
  if (on) await settings.setSecret('ecom.shopify.client_secret', SECRET, null);
}

async function configureWoo(on: boolean): Promise<void> {
  await settings.mergeDocument('ecom.woocommerce', { enabled: on }, null);
}

beforeEach(async () => {
  calls.length = 0;
  exchange = { ok: true, data: { accessToken: 'shpat_token_1', scope: 'read_orders' } };
  shopInfo = {
    ok: true,
    data: {
      id: '555',
      name: 'My Store',
      email: 'owner@store.test',
      owner: 'Owner',
      plan: 'basic',
      currency: 'INR',
      country: 'India',
    },
  };
  wooProbe = {
    ok: true,
    data: { name: 'Woo Shop', currency: 'USD', country: 'US', version: '9.1.0' },
  };
  await configureShopify(true);
  await configureWoo(true);
});

const rows = async (table: string, t: Tenant) =>
  (await h.owner.query(`SELECT * FROM ${table} WHERE org_id = $1 ORDER BY id`, [t.orgId])).rows;

/** Starts the connection as the workspace and returns the state Shopify would hand back. */
async function startShopify(t: Tenant, shop = 'my-store'): Promise<{ state: string; url: URL }> {
  const res = await api
    .http()
    .post('/v2/shopify/connect/start')
    .set(bearer(t.admin))
    .send({ shop });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const url = new URL(res.body.url as string);
  return { state: url.searchParams.get('state') as string, url };
}

/** The signed query Shopify sends the browser back with. */
function signed(params: Record<string, string>, secret = SECRET): Record<string, string> {
  const msg = Object.keys(params)
    .sort()
    .map((k) => `${phpUrlencode(k)}=${phpUrlencode(params[k]!)}`)
    .join('&');
  return { ...params, hmac: createHmac('sha256', secret).update(msg).digest('hex') };
}

const callback = (query: Record<string, string>) =>
  api.http().get('/v2/shopify/oauth/callback').query(query).redirects(0);

const outcome = (res: { headers: Record<string, string> }) => {
  const u = new URL(res.headers.location!);
  return {
    shopify: u.searchParams.get('shopify'),
    message: u.searchParams.get('message'),
    path: u.pathname,
  };
};

describe('platform settings (TW-ECOM-001, 002)', () => {
  it('shows the Shopify app without ever returning the secret, and a blank secret keeps the saved one', async () => {
    const save = await ops('put', '/shopify').send({
      enabled: true,
      clientId: 'client-abc',
      clientSecret: 'top-secret-value',
      scopes: 'read_orders',
    });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    expect(save.body).toMatchObject({
      enabled: true,
      clientId: 'client-abc',
      hasSecret: true,
      scopes: 'read_orders',
    });
    expect(JSON.stringify(save.body)).not.toContain('top-secret-value');

    const blank = await ops('put', '/shopify').send({ clientSecret: '', clientId: 'client-def' });
    expect(blank.body).toMatchObject({ clientId: 'client-def', hasSecret: true });
    expect(await settings.getSecret('ecom.shopify.client_secret')).toBe('top-secret-value');

    const page = await ops('get', '/shopify');
    expect(page.body.redirectUri).toMatch(/\/v2\/shopify\/oauth\/callback$/);
    expect(page.body).toMatchObject({
      integrationsCount: expect.any(Number),
      logsCount: expect.any(Number),
    });
    await configureShopify(true);
  });

  it('turns WooCommerce on and off, and an empty scopes box falls back to the default', async () => {
    expect((await ops('put', '/woocommerce').send({ enabled: false })).body.enabled).toBe(false);
    expect((await ops('get', '/woocommerce')).body.enabled).toBe(false);
    expect((await ops('put', '/woocommerce').send({ enabled: true })).body.enabled).toBe(true);
    const s = await ops('put', '/shopify').send({ scopes: '' });
    expect(s.body.scopes).toContain('read_products');
    await configureShopify(true);
  });

  it('refuses a body it cannot read and a caller who is not an operator', async () => {
    expect((await ops('put', '/woocommerce').send({ enabled: 'yes' })).status).toBe(422);
    const t = await api.signup('ecs');
    const res = await api.http().get('/v2/platform/ecom/shopify').set(bearer(t.admin));
    expect([401, 403]).toContain(res.status);
  });
});

describe('Shopify: start (TW-ECOM-005)', () => {
  it('sends the merchant to their own store with the app, scopes and a sealed state; a bare handle is completed', async () => {
    const t = await api.signup('ecsa');
    const { url } = await startShopify(t, 'My-Store');
    expect(url.origin).toBe('https://my-store.myshopify.com');
    expect(url.pathname).toBe('/admin/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('scope')).toContain('read_orders');
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/v2\/shopify\/oauth\/callback$/);
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('refuses a domain that is not a Shopify store, and says when the platform app is off', async () => {
    const t = await api.signup('ecsb');
    const bad = await api
      .http()
      .post('/v2/shopify/connect/start')
      .set(bearer(t.admin))
      .send({ shop: 'shop.example.com' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('ECOM_SHOP_INVALID');
    await configureShopify(false);
    const off = await api
      .http()
      .post('/v2/shopify/connect/start')
      .set(bearer(t.admin))
      .send({ shop: 'my-store' });
    expect(off.status).toBe(422);
    expect(off.body.code).toBe('ECOM_NOT_CONFIGURED');
  });

  it('needs ecom.connect to start', async () => {
    const t = await api.signup('ecsc');
    const viewer = await api.member(t, 'viewer', [['ecom.read']]);
    const res = await api
      .http()
      .post('/v2/shopify/connect/start')
      .set(bearer(viewer.token))
      .send({ shop: 'my-store' });
    expect(res.status).toBe(403);
  });
});

describe('Shopify: the callback (TW-ECOM-006, 007)', () => {
  it('saves the store with an encrypted token, registers every webhook and shows it without any secret', async () => {
    const t = await api.signup('ecsd');
    const { state } = await startShopify(t);
    const res = await callback(
      signed({ code: 'abc123', shop: 'my-store.myshopify.com', state, timestamp: '1700000000' }),
    );
    expect(res.status).toBe(303);
    expect(outcome(res)).toMatchObject({
      shopify: 'connected',
      message: 'Shopify store connected.',
      path: '/shopify',
    });

    const [row] = await rows('shopify_integrations', t);
    expect(row).toMatchObject({
      store_url: 'my-store.myshopify.com',
      store_name: 'My Store',
      shop_id: '555',
      shop_currency: 'INR',
      status: 'active',
      scopes: 'read_orders',
      user_id: t.adminUserId,
    });
    expect(row.access_token).not.toContain('shpat_token_1');
    expect(row.webhook_secret).toMatch(/^[A-Za-z0-9_-]{40}$/);
    expect(Object.keys(row.metadata.webhook_ids)).toHaveLength(12);
    expect(calls.find((c) => c.what === 'exchange')!.args).toEqual([
      'my-store.myshopify.com',
      'abc123',
    ]);
    const reg = calls.find((c) => c.what === 'register')!;
    expect(String(reg.args[1])).toContain(`/v2/shopify/webhook/${row.webhook_secret}`);

    const view = await api.http().get('/v2/shopify').set(bearer(t.admin));
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ appEnabled: true });
    expect(view.body.eventTopics).toHaveLength(12);
    expect(view.body.store).toMatchObject({
      connected: true,
      storeName: 'My Store',
      shopPlan: 'basic',
    });
    expect(JSON.stringify(view.body)).not.toContain('shpat_token_1');
    expect(JSON.stringify(view.body)).not.toContain(row.access_token);
  });

  it('refuses a bad signature, an unknown or expired state and another store, and saves nothing', async () => {
    const t = await api.signup('ecse');
    const { state } = await startShopify(t);
    const base = { code: 'abc123', shop: 'my-store.myshopify.com', state, timestamp: '1' };

    const badSig = await callback({ ...signed(base), hmac: 'f'.repeat(64) });
    expect(outcome(badSig)).toMatchObject({
      shopify: 'error',
      message: 'Invalid Shopify signature. Try again.',
    });

    const forged = await callback(signed({ ...base, state: 'forged' }));
    expect(outcome(forged).message).toBe('Session expired. Please reconnect.');

    const otherShop = await callback(signed({ ...base, shop: 'other-store.myshopify.com' }));
    expect(outcome(otherShop).message).toBe('Shop mismatch during callback.');

    const noSecret = await callback(signed(base, 'someone-elses-secret'));
    expect(outcome(noSecret).message).toBe('Invalid Shopify signature. Try again.');

    expect(await rows('shopify_integrations', t)).toHaveLength(0);
    expect(calls.some((c) => c.what === 'exchange')).toBe(false);
  });

  it('shows Shopify’s reason when the code is refused, and a store without details still connects', async () => {
    const t = await api.signup('ecsf');
    exchange = { ok: false, error: 'invalid_request' };
    const first = await startShopify(t);
    const refused = await callback(
      signed({ code: 'x', shop: 'my-store.myshopify.com', state: first.state, timestamp: '1' }),
    );
    expect(outcome(refused).message).toBe('OAuth failed: invalid_request');
    expect(await rows('shopify_integrations', t)).toHaveLength(0);

    exchange = { ok: true, data: { accessToken: 'shpat_2', scope: '' } };
    shopInfo = { ok: false, error: 'HTTP 500' };
    const second = await startShopify(t);
    const ok = await callback(
      signed({ code: 'y', shop: 'my-store.myshopify.com', state: second.state, timestamp: '2' }),
    );
    expect(outcome(ok).shopify).toBe('connected');
    expect((await rows('shopify_integrations', t))[0]).toMatchObject({
      store_name: 'my-store.myshopify.com',
      shop_id: null,
    });
  });

  it('connecting the same store again keeps the row, tears down the old webhooks and issues a new secret', async () => {
    const t = await api.signup('ecsg');
    const a = await startShopify(t);
    await callback(
      signed({ code: '1', shop: 'my-store.myshopify.com', state: a.state, timestamp: '1' }),
    );
    const [before] = await rows('shopify_integrations', t);
    const oldIds = Object.values(before.metadata.webhook_ids as Record<string, string>);

    calls.length = 0;
    exchange = { ok: true, data: { accessToken: 'shpat_new', scope: 'read_orders,write_orders' } };
    const b = await startShopify(t);
    await callback(
      signed({ code: '2', shop: 'my-store.myshopify.com', state: b.state, timestamp: '2' }),
    );
    const after = await rows('shopify_integrations', t);
    expect(after).toHaveLength(1);
    expect(after[0].uuid).toBe(before.uuid);
    expect(after[0].webhook_secret).not.toBe(before.webhook_secret);
    expect(after[0].scopes).toBe('read_orders,write_orders');
    const del = calls.find((c) => c.what === 'delete')!;
    expect([...(del.args[1] as string[])].sort()).toEqual([...oldIds].sort());
  });

  it('is public: it needs no session, and a store of another workspace is never touched', async () => {
    const a = await api.signup('ecsh');
    const b = await api.signup('ecsi');
    const { state } = await startShopify(a);
    await callback(signed({ code: '1', shop: 'my-store.myshopify.com', state, timestamp: '1' }));
    expect(await rows('shopify_integrations', a)).toHaveLength(1);
    expect(await rows('shopify_integrations', b)).toHaveLength(0);
    const view = await api.http().get('/v2/shopify').set(bearer(b.admin));
    expect(view.body.store).toBeNull();
  });
});

describe('Shopify: disconnect (TW-ECOM-013)', () => {
  it('removes the webhooks and the row, and answers 404 for another workspace’s store', async () => {
    const t = await api.signup('ecsj');
    const other = await api.signup('ecsk');
    const { state } = await startShopify(t);
    await callback(signed({ code: '1', shop: 'my-store.myshopify.com', state, timestamp: '1' }));
    const view = await api.http().get('/v2/shopify').set(bearer(t.admin));
    const id = view.body.store.id as string;

    const foreign = await api.http().delete(`/v2/shopify/stores/${id}`).set(bearer(other.admin));
    expect(foreign.status).toBe(404);
    expect(await rows('shopify_integrations', t)).toHaveLength(1);

    calls.length = 0;
    const res = await api.http().delete(`/v2/shopify/stores/${id}`).set(bearer(t.admin));
    expect(res.status).toBe(204);
    expect(await rows('shopify_integrations', t)).toHaveLength(0);
    expect((calls.find((c) => c.what === 'delete')!.args[1] as string[]).length).toBe(12);
  });
});

describe('WooCommerce: test and connect (TW-ECOM-025, 026)', () => {
  const body = { storeUrl: 'Example.com/shop', consumerKey: 'ck_1', consumerSecret: 'cs_1' };

  it('checks the keys without saving: a failure is an answer, not an error', async () => {
    const t = await api.signup('ecwa');
    const ok = await api.http().post('/v2/woocommerce/test').set(bearer(t.admin)).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, message: 'Connection verified. Store: Woo Shop' });
    expect(calls.find((c) => c.what === 'wooTest')!.args[0]).toBe('https://example.com');

    wooProbe = { ok: false, error: 'HTTP 401: Invalid key' };
    const bad = await api.http().post('/v2/woocommerce/test').set(bearer(t.admin)).send(body);
    expect(bad.body).toEqual({ ok: false, message: 'HTTP 401: Invalid key' });
    const url = await api
      .http()
      .post('/v2/woocommerce/test')
      .set(bearer(t.admin))
      .send({ ...body, storeUrl: 'https://' });
    expect(url.body).toEqual({ ok: false, message: 'Invalid URL.' });
    expect(await rows('woocommerce_integrations', t)).toHaveLength(0);
  });

  it('saves the store with encrypted keys, registers the seven webhooks and shows it without any key', async () => {
    const t = await api.signup('ecwb');
    const res = await api.http().post('/v2/woocommerce/connect').set(bearer(t.admin)).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      connected: true,
      storeUrl: 'https://example.com',
      storeName: 'Woo Shop',
      storeCurrency: 'USD',
      storeVersion: '9.1.0',
    });
    expect(Object.keys(res.body.webhookIds)).toHaveLength(7);
    expect(JSON.stringify(res.body)).not.toContain('ck_1');
    expect(JSON.stringify(res.body)).not.toContain('cs_1');

    const [row] = await rows('woocommerce_integrations', t);
    expect(row.consumer_key).not.toContain('ck_1');
    expect(row.consumer_secret).not.toContain('cs_1');
    expect(row.webhook_secret).toMatch(/^[A-Za-z0-9_-]{40}$/);
    const reg = calls.find((c) => c.what === 'wooRegister')!;
    expect(String(reg.args[1])).toContain(`/v2/woocommerce/webhook/${row.webhook_secret}`);
    expect(reg.args[2]).toBe(7);
    expect(String(reg.args[3])).toMatch(/ order\.created$/);

    const view = await api.http().get('/v2/woocommerce').set(bearer(t.admin));
    expect(view.body).toMatchObject({ appEnabled: true });
    expect(view.body.store.id).toBe(res.body.id);
  });

  it('refuses while the platform has it off, a bad address and keys the store rejects', async () => {
    const t = await api.signup('ecwc');
    wooProbe = { ok: false, error: 'HTTP 401: nope' };
    const rejected = await api
      .http()
      .post('/v2/woocommerce/connect')
      .set(bearer(t.admin))
      .send(body);
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe('ECOM_STORE_UNREACHABLE');
    expect(JSON.stringify(rejected.body)).toContain('Could not reach WooCommerce: HTTP 401: nope');

    const addr = await api
      .http()
      .post('/v2/woocommerce/connect')
      .set(bearer(t.admin))
      .send({ ...body, storeUrl: 'https://' });
    expect(addr.body.code).toBe('ECOM_STORE_INVALID');

    await configureWoo(false);
    const off = await api.http().post('/v2/woocommerce/connect').set(bearer(t.admin)).send(body);
    expect(off.status).toBe(422);
    expect(off.body.code).toBe('ECOM_DISABLED');
    expect(await rows('woocommerce_integrations', t)).toHaveLength(0);
  });

  it('connecting the same store again keeps the row and mapping, tears down the old webhooks and issues a new secret', async () => {
    const t = await api.signup('ecwd');
    const first = await api.http().post('/v2/woocommerce/connect').set(bearer(t.admin)).send(body);
    const [before] = await rows('woocommerce_integrations', t);
    const oldIds = Object.values(first.body.webhookIds as Record<string, string>);

    calls.length = 0;
    const second = await api
      .http()
      .post('/v2/woocommerce/connect')
      .set(bearer(t.admin))
      .send({ ...body, consumerKey: 'ck_2' });
    expect(second.body.id).toBe(first.body.id);
    const after = await rows('woocommerce_integrations', t);
    expect(after).toHaveLength(1);
    expect(after[0].webhook_secret).not.toBe(before.webhook_secret);
    expect([...(calls.find((c) => c.what === 'wooDelete')!.args[1] as string[])].sort()).toEqual(
      [...oldIds].sort(),
    );
  });

  it('disconnects, removing the webhooks and the row; another workspace gets 404; ecom.connect is needed', async () => {
    const t = await api.signup('ecwe');
    const other = await api.signup('ecwf');
    const made = await api.http().post('/v2/woocommerce/connect').set(bearer(t.admin)).send(body);
    const id = made.body.id as string;

    const viewer = await api.member(t, 'viewer', [['ecom.read']]);
    expect(
      (await api.http().delete(`/v2/woocommerce/stores/${id}`).set(bearer(viewer.token))).status,
    ).toBe(403);
    expect(
      (await api.http().delete(`/v2/woocommerce/stores/${id}`).set(bearer(other.admin))).status,
    ).toBe(404);

    calls.length = 0;
    expect(
      (await api.http().delete(`/v2/woocommerce/stores/${id}`).set(bearer(t.admin))).status,
    ).toBe(204);
    expect(await rows('woocommerce_integrations', t)).toHaveLength(0);
    expect((calls.find((c) => c.what === 'wooDelete')!.args[1] as string[]).length).toBe(7);
  });
});
