import { createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * The Shopify embedded app (WD-ECOM-038), against a real Postgres. Tokens are generated and signed here with a made-up client secret:
 * this is NOT tested against a real Shopify partner app or a real App Bridge.
 */
let h: Harness;
let api: Api;
let settings: PlatformSettingsService;
const CLIENT_ID = 'embedded-client-id';
const CLIENT_SECRET = 'embedded-client-secret';

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  settings = h.app.get(PlatformSettingsService);
  await settings.mergeDocument('ecom.shopify', { enabled: true, clientId: CLIENT_ID }, null);
  await settings.setSecret('ecom.shopify.client_secret', CLIENT_SECRET, null);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

function token(shop: string, over: Record<string, unknown> = {}, secret = CLIENT_SECRET): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: CLIENT_ID,
    sub: '7',
    exp: now + 60,
    nbf: now - 5,
    iat: now - 5,
    jti: randomBytes(6).toString('hex'),
    ...over,
  });
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

const ask = (sessionToken: string, shop?: string) =>
  api.http().post('/v2/shopify/embedded/session').send({ sessionToken, shop });

async function store(t: Tenant, token_: string, name = 'Acme') {
  const handle = `emb${randomBytes(4).toString('hex')}`;
  const shop = `${handle}.myshopify.com`;
  await h.owner.query(
    `INSERT INTO shopify_integrations (org_id, user_id, store_url, store_name, shop_plan, access_token, webhook_secret, connected_at, status)
     VALUES ($1, $2, $3, $4, 'basic', $5, $6, now(), 'active')`,
    [t.orgId, t.adminUserId, shop, name, token_, randomBytes(20).toString('hex')],
  );
  return { shop, secret: '' };
}

describe('config (WD-ECOM-038)', () => {
  it('gives the public client id and never the secret', async () => {
    const res = await api.http().get('/v2/shopify/embedded/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ appEnabled: true, clientId: CLIENT_ID });
    expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
  });
});

describe('session token to store status (WD-ECOM-038)', () => {
  it('names the connected store of a valid token, without any credential or webhook address', async () => {
    const t = await api.signup('emb1');
    const { shop } = await store(t, 'shpat_secret_token', 'Acme Wares');
    const res = await ask(token(shop), shop);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      shop,
      connected: true,
      store: { storeName: 'Acme Wares', status: 'active', shopPlan: 'basic' },
    });
    expect(res.body.message).toContain('Acme Wares');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('shpat_secret_token');
    expect(text).not.toContain('webhook');
    // No sign-in happens: no tokens, no cookies.
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body.tokens).toBeUndefined();
  });

  it('works without the page sending the shop, and the shop in the token decides which store', async () => {
    const t = await api.signup('emb2');
    const a = await store(t, 'tok-a', 'Store A');
    const b = await store(t, 'tok-b', 'Store B');
    const ra = await ask(token(a.shop));
    const rb = await ask(token(b.shop));
    expect(ra.body.store.storeName).toBe('Store A');
    expect(rb.body.store.storeName).toBe('Store B');
  });

  it('resolves the right workspace when two workspaces each have a store', async () => {
    const t1 = await api.signup('emb3');
    const t2 = await api.signup('emb4');
    const s1 = await store(t1, 'tok-1', 'Org One Shop');
    const s2 = await store(t2, 'tok-2', 'Org Two Shop');
    expect((await ask(token(s1.shop))).body.store.storeName).toBe('Org One Shop');
    expect((await ask(token(s2.shop))).body.store.storeName).toBe('Org Two Shop');
  });

  it('answers "not connected, open the app to connect" for a shop nobody connected', async () => {
    const shop = `nobody${randomBytes(3).toString('hex')}.myshopify.com`;
    const res = await ask(token(shop), shop);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      shop,
      connected: false,
      store: null,
      message: 'This store is not connected yet. Open the app to connect it.',
    });
  });

  it('reads a store whose app was uninstalled as not connected', async () => {
    const t = await api.signup('emb5');
    const { shop } = await store(t, '', 'Gone Shop');
    const res = await ask(token(shop));
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
    expect(res.body.store.storeName).toBe('Gone Shop');
    expect(res.body.message).toContain('removed');
  });

  it('matches the shop case-insensitively', async () => {
    const t = await api.signup('emb6');
    const { shop } = await store(t, 'tok', 'Cased');
    const res = await ask(token(shop), shop.toUpperCase());
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });

  it('refuses with the stable code: a bad signature', async () => {
    const t = await api.signup('emb7');
    const { shop } = await store(t, 'tok');
    const res = await ask(token(shop, {}, 'not-the-secret'));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ECOM_SESSION_TOKEN_INVALID');
  });

  it('refuses with the stable code: an expired token', async () => {
    const t = await api.signup('emb8');
    const { shop } = await store(t, 'tok');
    const old = Math.floor(Date.now() / 1000) - 3600;
    const res = await ask(token(shop, { exp: old + 60, nbf: old }));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ECOM_SESSION_TOKEN_INVALID');
  });

  it('refuses with the stable code: another app (wrong audience)', async () => {
    const t = await api.signup('emb9');
    const { shop } = await store(t, 'tok');
    const res = await ask(token(shop, { aud: 'another-app' }));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ECOM_SESSION_TOKEN_INVALID');
  });

  it('refuses with the stable code: a token for one shop presented for another', async () => {
    const t = await api.signup('emb10');
    const mine = await store(t, 'tok-mine', 'Mine');
    const other = await store(await api.signup('emb11'), 'tok-other', 'Theirs');
    const res = await ask(token(mine.shop), other.shop);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ECOM_SESSION_TOKEN_INVALID');
    expect(JSON.stringify(res.body)).not.toContain('Theirs');
  });

  it('refuses a token whose destination was changed to another store after signing', async () => {
    const t = await api.signup('emb12');
    const mine = await store(t, 'tok', 'Mine');
    const victim = await store(await api.signup('emb13'), 'tok-v', 'Victim');
    const [head, , sig] = token(mine.shop).split('.');
    const forged = b64({
      iss: `https://${victim.shop}/admin`,
      dest: `https://${victim.shop}`,
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const res = await ask(`${head}.${forged}.${sig}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ECOM_SESSION_TOKEN_INVALID');
  });

  it('refuses garbage and an empty token (a validation error for a missing one, the stable code for a wrong one)', async () => {
    expect((await ask('not-a-token')).body.code).toBe('ECOM_SESSION_TOKEN_INVALID');
    expect((await ask('')).status).toBe(422);
    expect((await api.http().post('/v2/shopify/embedded/session').send({})).status).toBe(422);
  });

  it('is not configured while the platform app is off, for both doors', async () => {
    await settings.mergeDocument('ecom.shopify', { enabled: false }, null);
    try {
      const t = await api.signup('emb14');
      const { shop } = await store(t, 'tok');
      const res = await ask(token(shop));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ECOM_NOT_CONFIGURED');
      const cfg = await api.http().get('/v2/shopify/embedded/config');
      expect(cfg.body).toEqual({ appEnabled: false, clientId: null });
    } finally {
      await settings.mergeDocument('ecom.shopify', { enabled: true }, null);
    }
  });
});
