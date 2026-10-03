import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { fixtureCnames } from '../../../src/infra/providers/storefront-builder/dns-resolver.adapters';
import { signRazorpayBody } from '../../../src/infra/providers/storefront-builder/razorpay-payloads';
import { ShopsService } from '../../../src/modules/storefront-builder';
import { CartRecoveryRepository } from '../../../src/modules/storefront-builder/recovery/cart-recovery.repository';
import { CartRecoverySweepService } from '../../../src/modules/storefront-builder/recovery/cart-recovery-sweep.service';
import { ShopsRepository } from '../../../src/modules/storefront-builder/shops/shops.repository';
import {
  RECOVERY_NUDGE_SENDER,
  SENDER_DIRECTORY,
} from '../../../src/modules/storefront-builder/_shims/tokens';
import { STOREFRONT_ENV } from '../../../src/config/domains/storefront-builder.env';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * The storefront end to end (TW-STORE-001..031, backend): wizard, settings, public shop, checkout, coupons, reviews, tracking,
 * the Razorpay webhook and the cart-recovery sweep, through the real app with real Postgres and Redis. Razorpay and DNS are
 * the fixture adapters (STORE_PROVIDER_MODE=fixture) and the Node bridge is a local HTTP stub.
 */
let h: Harness;
let api: Api;
let bridge: Server;
const bridgeCalls: Array<{
  path: string;
  token: string | undefined;
  body: Record<string, string>;
}> = [];

process.env.STORE_PROVIDER_MODE = 'fixture';
process.env.BAILEYS_NODE_TOKEN = 'node-token-1';

let ipSeq = 0;
const ip = () => `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(async () => {
  bridge = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      bridgeCalls.push({
        path: req.url ?? '',
        token: req.headers['x-node-token'] as string | undefined,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, string>,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"success":true}');
    });
  });
  await new Promise<void>((r) => bridge.listen(0, '127.0.0.1', r));
  process.env.BAILEYS_SERVER_URL = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
  await new Promise((r) => bridge?.close(r));
});

// --- arranging ----------------------------------------------------------------------------------------------------------

async function device(t: Tenant, phone = '9812345678'): Promise<string> {
  const r = await h.owner.query(
    `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
     VALUES ($1, 'Counter phone', '91', $2, 'connected', true) RETURNING uuid`,
    [t.orgId, phone],
  );
  return r.rows[0].uuid as string;
}

async function shop(
  t: Tenant,
  name = 'Media City Threads',
  deviceId?: string,
): Promise<Record<string, any>> {
  const res = await api
    .as(t.admin)
    .post('/v2/store/shops')
    .send({ shopName: name, ...(deviceId ? { deviceId } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** A tenant with a connected device and one shop. */
async function merchant(label: string, name?: string) {
  const t = await api.signup(label);
  const deviceUuid = await device(t);
  const s = await shop(t, name, deviceUuid);
  return { t, deviceUuid, s, slug: s.slug as string };
}

async function product(
  t: Tenant,
  o: {
    name: string;
    price: number;
    stock?: number | null;
    status?: string;
    slug?: string;
    storefrontId?: number | null;
  },
): Promise<{ uuid: string; id: number }> {
  const r = await h.owner.query(
    `INSERT INTO wa_products (org_id, name, slug, price_minor, stock_qty, in_stock, status, currency_code, storefront_id)
     VALUES ($1,$2,$3,$4,$5,true,$6,'INR',$7) RETURNING uuid, id`,
    [
      t.orgId,
      o.name,
      o.slug ??
        o.name.toLowerCase().replace(/\W+/g, '-') + '-' + Math.random().toString(36).slice(2, 7),
      o.price,
      o.stock === undefined ? null : o.stock,
      o.status ?? 'active',
      o.storefrontId ?? null,
    ],
  );
  return { uuid: r.rows[0].uuid, id: Number(r.rows[0].id) };
}

const pub = (path: string) =>
  api.http().get(`/v2/store-public${path}`).set('x-forwarded-for', ip());
const post = (path: string) =>
  api.http().post(`/v2/store-public${path}`).set('x-forwarded-for', ip());

const buyer = { name: 'Asha', phone: '+91 98765 43210' };

async function stockOf(id: number): Promise<number | null> {
  const r = await h.owner.query(`SELECT stock_qty FROM wa_products WHERE id = $1`, [id]);
  return r.rows[0].stock_qty === null ? null : Number(r.rows[0].stock_qty);
}

async function orderRow(orderNo: number) {
  const r = await h.owner.query(`SELECT * FROM wa_orders WHERE id = $1`, [orderNo]);
  return r.rows[0];
}

async function setShipping(m: { t: Tenant; s: any }, body: Record<string, unknown>) {
  const cur = (await api.as(m.t.admin).get(`/v2/store/shops/${m.s.id}`)).body;
  const res = await api
    .as(m.t.admin)
    .put(`/v2/store/shops/${m.s.id}/settings`)
    .send({
      slug: cur.slug,
      themeKey: cur.themeKey,
      enabled: true,
      rowVersion: cur.rowVersion,
      ...body,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

// --- wizard, permissions, tenancy (TW-STORE-003, 004, 005, 024, 029) -------------------------------------------------

describe('shops and the wizard', () => {
  it('a member without the keys is refused (403) and one with only read can list but not create', async () => {
    const t = await api.signup('perm');
    const nobody = await api.member(t, 'nobody', []);
    expect((await api.as(nobody.token).get('/v2/store/shops')).status).toBe(403);
    expect((await api.as(nobody.token).get('/v2/store/overview')).status).toBe(403);
    const reader = await api.member(t, 'reader', [['store.storefront.read']]);
    expect((await api.as(reader.token).get('/v2/store/shops')).status).toBe(200);
    const create = await api.as(reader.token).post('/v2/store/shops').send({ shopName: 'X' });
    expect(create.status).toBe(403);
    const manage = await api.member(t, 'manager', [['store.shops.manage']]);
    expect(
      (
        await api
          .as(manage.token)
          .put('/v2/store/shops/7e57d1b6-0000-4000-8000-000000000000/settings')
          .send({})
      ).status,
    ).toBe(403);
  });

  it('without a connected number a shop cannot be saved (422 STORE_NO_SENDER) and the wizard says hasSender false', async () => {
    const t = await api.signup('nosender');
    const w = await api.as(t.admin).get('/v2/store/shops');
    expect(w.status).toBe(200);
    expect(w.body).toMatchObject({ shops: [], devices: [], hasSender: false });
    const res = await api.as(t.admin).post('/v2/store/shops').send({ shopName: 'Nope' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('STORE_NO_SENDER');
  });

  it('creates a shop: slug from the name, theme aurora, enabled, the chosen device; a repeat name gets -2 even across workspaces', async () => {
    const a = await api.signup('create');
    const dev = await device(a);
    const res = await api
      .as(a.admin)
      .post('/v2/store/shops')
      .send({ shopName: 'Media City Threads', deviceId: dev });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      shopName: 'Media City Threads',
      themeKey: 'aurora',
      enabled: true,
      deviceId: dev,
      customDomainVerified: false,
      hasUsableConnection: true,
      currencyCode: 'INR',
    });
    expect(res.body.slug).toMatch(/^media-city-threads(-\d+)?$/);
    expect(res.body.sendingLabel).toBe('+91 9812345678');
    expect(res.body.publicUrl).toBe(`http://localhost:3001/s/${res.body.slug}`);
    expect(JSON.stringify(res.body)).not.toMatch(/"orgId"|org_id/);

    const b = await api.signup('create-b');
    await device(b);
    const second = await shop(b, 'Media City Threads');
    expect(second.slug).not.toBe(res.body.slug);
    expect(second.slug).toMatch(/^media-city-threads-\d+$/);
    expect(await api.events(a.orgId, 'storefront.created')).toHaveLength(1);
    expect(await api.auditCount(a.orgId, 'storefronts', 'insert')).toBe(1);
  });

  it('a long name is cut to 64 characters before the suffix', async () => {
    const a = await api.signup('long');
    await device(a);
    const s1 = await shop(a, 'W'.repeat(150));
    const s2 = await shop(a, 'W'.repeat(150));
    expect(s1.slug.length).toBeLessThanOrEqual(64);
    expect(s2.slug.length).toBeLessThanOrEqual(64);
    expect(s2.slug).not.toBe(s1.slug);
  });

  it('a device of another workspace or one that is not connected is refused (STORE_DEVICE_INVALID)', async () => {
    const a = await api.signup('dev-a');
    const b = await api.signup('dev-b');
    await device(a);
    const foreign = await device(b);
    const res = await api
      .as(a.admin)
      .post('/v2/store/shops')
      .send({ shopName: 'S', deviceId: foreign });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('STORE_DEVICE_INVALID');
    const off = await h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, status) VALUES ($1,'Off','111','disconnected') RETURNING uuid`,
      [a.orgId],
    );
    const res2 = await api
      .as(a.admin)
      .post('/v2/store/shops')
      .send({ shopName: 'S', deviceId: off.rows[0].uuid });
    expect(res2.body.code).toBe('STORE_DEVICE_INVALID');
  });

  it('editing keeps the slug, resets the verification of a changed domain, and a taken domain is a field error', async () => {
    const m = await merchant('edit', 'Old Name');
    const res = await api.as(m.t.admin).put(`/v2/store/shops/${m.s.id}`).send({
      shopName: 'Brand New Name',
      customDomain: 'shop.example.org',
      deviceId: m.deviceUuid,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.slug).toBe(m.slug);
    expect(res.body.shopName).toBe('Brand New Name');
    expect(res.body.customDomain).toBe('shop.example.org');
    expect(res.body.customDomainVerified).toBe(false);

    const other = await merchant('edit-other');
    const clash = await api
      .as(other.t.admin)
      .put(`/v2/store/shops/${other.s.id}`)
      .send({ shopName: 'Other', customDomain: 'shop.example.org' });
    expect(clash.status).toBe(422);
    expect(clash.body.code).toBe('VALIDATION_FAILED');
    const bad = await api
      .as(m.t.admin)
      .put(`/v2/store/shops/${m.s.id}`)
      .send({ shopName: 'x', customDomain: 'Shop.Example.com' });
    expect(bad.status).toBe(422);
    const bad2 = await api
      .as(m.t.admin)
      .put(`/v2/store/shops/${m.s.id}`)
      .send({ shopName: 'x', customDomain: 'https://shop.example.com' });
    expect(bad2.status).toBe(422);
  });

  it('another workspace cannot read, edit, delete or see a shop (tenant isolation)', async () => {
    const a = await merchant('iso-a');
    const b = await merchant('iso-b');
    expect((await api.as(b.t.admin).get(`/v2/store/shops/${a.s.id}`)).status).toBe(404);
    expect(
      (await api.as(b.t.admin).put(`/v2/store/shops/${a.s.id}`).send({ shopName: 'hijack' }))
        .status,
    ).toBe(404);
    expect((await api.as(b.t.admin).delete(`/v2/store/shops/${a.s.id}`)).status).toBe(404);
    const list = await api.as(b.t.admin).get('/v2/store/shops');
    expect(list.body.shops.map((x: any) => x.id)).not.toContain(a.s.id);
    const ov = await api.as(b.t.admin).get(`/v2/store/overview?shopId=${a.s.id}`);
    expect(ov.body.shop.id).toBe(b.s.id);
  });

  it('delete removes the shop and its orders, products stay; reset needs confirm=yes and clears everything', async () => {
    const m = await merchant('del');
    const p = await product(m.t, { name: 'Tee', price: 10000, stock: 10 });
    const placed = await post(`/${m.slug}/checkout`).send({
      ...buyer,
      items: [{ id: p.uuid, qty: 1 }],
    });
    expect(placed.status).toBe(201);
    expect((await api.as(m.t.admin).delete(`/v2/store/shops/${m.s.id}`)).status).toBe(204);
    expect(
      (await h.owner.query(`SELECT count(*)::int n FROM wa_orders WHERE org_id=$1`, [m.t.orgId]))
        .rows[0].n,
    ).toBe(0);
    expect(
      (await h.owner.query(`SELECT count(*)::int n FROM wa_products WHERE org_id=$1`, [m.t.orgId]))
        .rows[0].n,
    ).toBe(1);
    expect(await api.auditCount(m.t.orgId, 'storefronts', 'delete')).toBe(1);

    await shop(m.t, 'Again');
    const no = await api.as(m.t.admin).post('/v2/store/shops/reset').send({});
    expect(no.status).toBe(422);
    expect(no.body.code).toBe('STORE_RESET_NOT_CONFIRMED');
    const wrong = await api.as(m.t.admin).post('/v2/store/shops/reset').send({ confirm: 'no' });
    expect(wrong.body.code).toBe('STORE_RESET_NOT_CONFIRMED');
    const ok = await api.as(m.t.admin).post('/v2/store/shops/reset').send({ confirm: 'yes' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ shops: 1, products: 1 });
    expect(
      (await h.owner.query(`SELECT count(*)::int n FROM wa_products WHERE org_id=$1`, [m.t.orgId]))
        .rows[0].n,
    ).toBe(0);
  });

  it('ensureDefaultShop creates one named after the workspace only when there is none', async () => {
    const t = await api.signup('acmetraders');
    const svc = h.app.get(ShopsService);
    const first = await svc.ensureDefaultShop(t.orgId);
    expect(first).toBeTruthy();
    expect(await svc.ensureDefaultShop(t.orgId)).toBeNull();
    const rows = await h.owner.query(
      `SELECT shop_name, slug, theme_key, enabled, device_id FROM wa_storefronts WHERE org_id=$1`,
      [t.orgId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      shop_name: null,
      theme_key: 'aurora',
      enabled: true,
      device_id: null,
    });
    expect(rows.rows[0].slug).toMatch(/^org-acmetraders/);
  });
});

// --- settings (TW-STORE-006, 007, 008) -----------------------------------------------------------------------------

describe('storefront settings', () => {
  it('saves the design, shipping and recovery settings and returns them', async () => {
    const m = await merchant('settings');
    const res = await setShipping(m, {
      themeKey: 'noir',
      brandColor: '#12ab9F',
      heroText: 'Hello',
      shippingFlat: '49.50',
      shippingFreeAbove: '999',
      shippingNote: '2-5 days',
      cartRecoveryEnabled: true,
      cartRecoveryDelayMin: 15,
      currencyCode: 'USD',
    });
    expect(res).toMatchObject({
      themeKey: 'noir',
      currencyCode: 'USD',
      shipping: { flat: '49.50', freeAbove: '999', note: '2-5 days' },
      settings: {
        brandColor: '#12ab9F',
        heroText: 'Hello',
        cartRecoveryEnabled: true,
        cartRecoveryDelayMin: 15,
      },
    });
    const row = await h.owner.query(`SELECT shipping_json FROM wa_storefronts WHERE uuid=$1`, [
      m.s.id,
    ]);
    expect(row.rows[0].shipping_json).toEqual({
      flat_minor: 4950,
      free_above_minor: 99900,
      note: '2-5 days',
    });
    // all blank clears shipping
    const cleared = await setShipping(m, {
      shippingFlat: '',
      shippingFreeAbove: '',
      shippingNote: '',
    });
    expect(cleared.shipping).toEqual({ flat: null, freeAbove: null, note: null });
  });

  it('rejects a bad colour, a currency outside the list, long hero text and a bad slug (422)', async () => {
    const m = await merchant('validate');
    const base = { slug: m.slug, themeKey: 'aurora', enabled: true };
    const put = (b: Record<string, unknown>) =>
      api
        .as(m.t.admin)
        .put(`/v2/store/shops/${m.s.id}/settings`)
        .send({ ...base, ...b });
    expect((await put({ brandColor: 'red' })).status).toBe(422);
    expect((await put({ brandColor: '#12ab9' })).status).toBe(422);
    expect((await put({ currencyCode: 'JPY' })).status).toBe(422);
    expect((await put({ heroText: 'x'.repeat(281) })).status).toBe(422);
    expect((await put({ slug: 'Bad Slug' })).status).toBe(422);
    expect((await put({ themeKey: 'neon' })).status).toBe(422);
  });

  it('a slug another shop owns is 409 STORE_SLUG_TAKEN; a stale rowVersion is 409 ROW_VERSION_CONFLICT', async () => {
    const a = await merchant('slug-a');
    const b = await merchant('slug-b');
    const res = await api
      .as(b.t.admin)
      .put(`/v2/store/shops/${b.s.id}/settings`)
      .send({ slug: a.slug, themeKey: 'aurora', enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STORE_SLUG_TAKEN');
    const stale = await api
      .as(b.t.admin)
      .put(`/v2/store/shops/${b.s.id}/settings`)
      .send({ slug: b.slug, themeKey: 'aurora', enabled: true, rowVersion: 999 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
  });

  it('Razorpay secrets are stored encrypted, never returned, kept when blank and dropped when the provider changes', async () => {
    const m = await merchant('rzp');
    const set = await setShipping(m, {
      paymentProvider: 'razorpay_api',
      rzpKeyId: 'rzp_live_abc',
      rzpKeySecret: 'topsecret',
      rzpWebhookSecret: 'whsecret',
    });
    expect(set.razorpay).toEqual({
      keyId: 'rzp_live_abc',
      hasKeySecret: true,
      hasWebhookSecret: true,
    });
    expect(JSON.stringify(set)).not.toMatch(/topsecret|whsecret/);
    let row = (
      await h.owner.query(`SELECT payment_config_json c FROM wa_storefronts WHERE uuid=$1`, [
        m.s.id,
      ])
    ).rows[0].c;
    expect(row.key_id).toBe('rzp_live_abc');
    expect(row.key_secret).not.toBe('topsecret');
    expect(row.key_secret.startsWith('v1:')).toBe(true);
    const before = row.key_secret;

    await setShipping(m, {
      paymentProvider: 'razorpay_api',
      rzpKeyId: '',
      rzpKeySecret: '',
      rzpWebhookSecret: '',
    });
    row = (
      await h.owner.query(`SELECT payment_config_json c FROM wa_storefronts WHERE uuid=$1`, [
        m.s.id,
      ])
    ).rows[0].c;
    expect(row.key_secret).toBe(before);

    const upi = await setShipping(m, { paymentProvider: 'upi', paymentHandle: 'shop@upi' });
    expect(upi.razorpay).toEqual({ keyId: null, hasKeySecret: false, hasWebhookSecret: false });
    expect(upi.paymentHandle).toBe('shop@upi');
    row = (
      await h.owner.query(`SELECT payment_config_json c FROM wa_storefronts WHERE uuid=$1`, [
        m.s.id,
      ])
    ).rows[0].c;
    expect(row).toEqual({ handle: 'shop@upi' });
  });

  it('verify-domain: 422 without a domain; ok only when the CNAME equals the target; the result is stored each time', async () => {
    const m = await merchant('dns');
    const none = await api.as(m.t.admin).post(`/v2/store/shops/${m.s.id}/verify-domain`).send({});
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('STORE_DOMAIN_NOT_SET');

    await api
      .as(m.t.admin)
      .put(`/v2/store/shops/${m.s.id}`)
      .send({ shopName: 'S', customDomain: 'shop.acme.test' });
    fixtureCnames.set('shop.acme.test', ['app.example.com.attacker.net.']);
    const bad = await api.as(m.t.admin).post(`/v2/store/shops/${m.s.id}/verify-domain`).send({});
    expect(bad.status).toBe(200);
    expect(bad.body).toMatchObject({
      ok: false,
      expected: 'localhost',
      message: 'CNAME not pointing to localhost',
    });

    fixtureCnames.set('shop.acme.test', ['Localhost.']);
    const ok = await api.as(m.t.admin).post(`/v2/store/shops/${m.s.id}/verify-domain`).send({});
    expect(ok.body).toMatchObject({ ok: true, message: 'Domain verified ✓' });
    expect(
      (await api.as(m.t.admin).get(`/v2/store/shops/${m.s.id}`)).body.customDomainVerified,
    ).toBe(true);
    expect((await api.as(m.t.admin).get(`/v2/store/shops/${m.s.id}`)).body.publicUrl).toBe(
      'https://shop.acme.test',
    );

    // the host now serves the shop; an unverified one does not
    const host = await pub(`/host?host=shop.acme.test`);
    expect(host.status).toBe(200);
    expect(host.body).toEqual({ slug: m.slug });
    fixtureCnames.delete('shop.acme.test');
    await api.as(m.t.admin).post(`/v2/store/shops/${m.s.id}/verify-domain`).send({});
    expect((await pub(`/host?host=shop.acme.test`)).status).toBe(404);
  });
});

// --- the public shop (TW-STORE-009, 010, 020) ------------------------------------------------------------------------

describe('public shop pages', () => {
  it('home works without a token, lists only active in-stock products of the shop, 48 per page, and counts a view', async () => {
    const m = await merchant('home');
    for (let i = 0; i < 50; i += 1)
      await product(m.t, { name: `Item ${i}`, price: 1000 + i, stock: 5 });
    await product(m.t, { name: 'Draft', price: 100, status: 'draft' });
    await product(m.t, { name: 'Sold', price: 100, stock: 0 }).then((p) =>
      h.owner.query(`UPDATE wa_products SET in_stock=false WHERE id=$1`, [p.id]),
    );
    const res = await pub(`/${m.slug}/home`);
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(48);
    expect(res.body).toMatchObject({ total: 50, hasMore: true, page: 1 });
    expect(res.body.products.map((p: any) => p.name)).not.toContain('Draft');
    expect(res.body.shop).toMatchObject({
      slug: m.slug,
      themeKey: 'aurora',
      brandColor: '#075E54',
      waNumber: '919812345678',
    });
    const p2 = await pub(`/${m.slug}/home?page=2`);
    expect(p2.body.products).toHaveLength(2);
    expect(p2.body.hasMore).toBe(false);
    const views = await h.owner.query(
      `SELECT sum(views)::int v FROM wa_storefront_views WHERE org_id=$1`,
      [m.t.orgId],
    );
    expect(views.rows[0].v).toBe(1);
  });

  it('a shop with products scoped to another shop shows only its own and the shared ones', async () => {
    const m = await merchant('scope');
    const other = await shop(m.t, 'Second shop');
    const otherId = Number(
      (await h.owner.query(`SELECT id FROM wa_storefronts WHERE uuid=$1`, [other.id])).rows[0].id,
    );
    await product(m.t, { name: 'Shared', price: 100 });
    await product(m.t, { name: 'OnlySecond', price: 100, storefrontId: otherId });
    const first = await pub(`/${m.slug}/home`);
    expect(first.body.products.map((p: any) => p.name)).toEqual(['Shared']);
    const second = await pub(`/${other.slug}/home`);
    expect(second.body.products.map((p: any) => p.name).sort()).toEqual(['OnlySecond', 'Shared']);
  });

  it('an unknown or disabled shop is 404 STORE_NOT_AVAILABLE', async () => {
    const m = await merchant('off');
    expect((await pub(`/no-such-shop/home`)).status).toBe(404);
    expect((await pub(`/no-such-shop/home`)).body.code).toBe('STORE_NOT_AVAILABLE');
    await setShipping(m, { enabled: false });
    const res = await pub(`/${m.slug}/home`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('STORE_NOT_AVAILABLE');
    expect(
      (
        await post(`/${m.slug}/checkout`).send({
          ...buyer,
          items: [{ id: '7e57d1b6-0000-4000-8000-000000000000', qty: 1 }],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await post(`/${m.slug}/abandon`).send({
          ...buyer,
          items: [{ id: '7e57d1b6-0000-4000-8000-000000000000', qty: 1 }],
        })
      ).status,
    ).toBe(404);
  });

  it('serves what the cards need: the New flag (14 days), weight and tags, and the strip and hero copy nothing writes', async () => {
    const m = await merchant('cardfields');
    await product(m.t, { name: 'Fresh', price: 1000 });
    const old = await product(m.t, { name: 'Old', price: 1000 });
    await h.owner.query(
      `UPDATE wa_products SET created_at = now() - interval '15 days', weight_grams = 250, tags_json = '["a","b"]'::jsonb WHERE id = $1`,
      [old.id],
    );
    await h.owner.query(
      `UPDATE wa_storefronts SET settings_json = COALESCE(settings_json, '{}'::jsonb) || '{"top_strip":"Free delivery today","hero_sub":""}'::jsonb WHERE uuid = $1`,
      [m.s.id],
    );
    const res = await pub(`/${m.slug}/home`);
    const byName = Object.fromEntries(res.body.products.map((p: any) => [p.name, p]));
    expect(byName.Fresh).toMatchObject({ isNew: true, tags: [], weightGrams: null });
    expect(byName.Old).toMatchObject({ isNew: false, tags: ['a', 'b'], weightGrams: 250 });
    // Reference shows top_strip when set and hero_sub even when it is empty
    expect(res.body.shop).toMatchObject({ topStrip: 'Free delivery today', heroSub: '' });
  });

  it('hero and footer text are sanitised before they are served', async () => {
    const m = await merchant('hero');
    await setShipping(m, {
      heroText: 'Hi <script>alert(1)</script><em>there</em>',
      footerText: '<img src=x onerror=1>bye',
    });
    const res = await pub(`/${m.slug}/home`);
    expect(res.body.shop.heroText).toBe('Hi <em>there</em>');
    expect(res.body.shop.footerText).toBe('bye');
  });

  it('a product page shows the product, related items and only approved reviews with the average', async () => {
    const m = await merchant('pdp');
    const p = await product(m.t, { name: 'Tee', price: 19900, slug: 'tee', stock: 3 });
    await product(m.t, { name: 'Cap', price: 5000 });
    const ins = (status: string, rating: number) =>
      h.owner.query(
        `INSERT INTO wa_product_reviews (org_id, product_id, customer_name, rating, body, status) VALUES ($1,$2,'A',$3,'b',$4)`,
        [m.t.orgId, p.id, rating, status],
      );
    await ins('approved', 5);
    await ins('approved', 4);
    await ins('pending', 1);
    const res = await pub(`/${m.slug}/products/tee`);
    expect(res.status).toBe(200);
    expect(res.body.product).toMatchObject({
      name: 'Tee',
      priceMinor: 19900,
      priceDisplay: '₹ 199',
      stockQty: 3,
    });
    expect(res.body.related.map((r: any) => r.name)).toEqual(['Cap']);
    expect(res.body.reviews).toHaveLength(2);
    expect(res.body).toMatchObject({ ratingAvg: 4.5, ratingCount: 2 });
    expect((await pub(`/${m.slug}/products/missing`)).status).toBe(404);
  });

  it('a review lands pending and is not shown; an unknown product is 422; rating 0 or 6 is 422', async () => {
    const m = await merchant('review');
    const p = await product(m.t, { name: 'Tee', price: 100, slug: 'tee2' });
    const ok = await post(`/${m.slug}/review`).send({
      productId: p.uuid,
      name: 'Asha',
      rating: 4,
      body: 'Nice',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.message).toBe('Thanks! Your review will appear once approved.');
    const row = await h.owner.query(
      `SELECT status, customer_name, rating FROM wa_product_reviews WHERE org_id=$1`,
      [m.t.orgId],
    );
    expect(row.rows).toEqual([{ status: 'pending', customer_name: 'Asha', rating: 4 }]);
    expect((await pub(`/${m.slug}/products/tee2`)).body.reviews).toHaveLength(0);
    const unknown = await post(`/${m.slug}/review`).send({
      productId: '7e57d1b6-0000-4000-8000-000000000000',
      name: 'A',
      rating: 3,
    });
    expect(unknown.status).toBe(422);
    expect(JSON.stringify(unknown.body)).toMatch(/Unknown product/);
    const other = await merchant('review-other');
    const foreign = await product(other.t, { name: 'F', price: 1 });
    expect(
      (await post(`/${m.slug}/review`).send({ productId: foreign.uuid, name: 'A', rating: 3 }))
        .status,
    ).toBe(422);
    expect(
      (await post(`/${m.slug}/review`).send({ productId: p.uuid, name: 'A', rating: 6 })).status,
    ).toBe(422);
    expect(
      (await post(`/${m.slug}/review`).send({ productId: p.uuid, name: 'A', rating: 0 })).status,
    ).toBe(422);
  });
});

// --- checkout and coupons (TW-STORE-013, 014, 019) --------------------------------------------------------------------

describe('checkout', () => {
  it('re-prices from the database (a tampered client price is ignored), takes stock, stores the order and answers with the hand-off', async () => {
    const m = await merchant('co');
    await setShipping(m, { shippingFlat: '30', shippingFreeAbove: '1000' });
    const a = await product(m.t, { name: 'A', price: 10000, stock: 5 });
    const b = await product(m.t, { name: 'B', price: 5000, stock: null });
    const res = await post(`/${m.slug}/checkout`).send({
      ...buyer,
      email: 'asha@example.com',
      address: '12 Main St',
      note: 'ring twice',
      items: [
        { id: a.uuid, qty: 2, price: 1, priceMinor: 1 },
        { id: b.uuid, qty: 1, price_minor: 1 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.orderNo).toBeGreaterThan(0);
    expect(res.body.message).toBe('Order placed! Opening WhatsApp…');
    const token = res.body.trackUrl.split('/order/')[1] as string;
    expect(token).toMatch(/^[A-Za-z0-9]{40}$/);
    expect(res.body.waUrl.startsWith('https://wa.me/919812345678?text=')).toBe(true);
    expect(decodeURIComponent(res.body.waUrl)).toContain(`order #${res.body.orderNo} (₹ 280.00)`);
    expect(decodeURIComponent(res.body.waUrl)).toContain(
      `Track: http://localhost:3001/s/${m.slug}/order/${token}`,
    );

    const o = await orderRow(res.body.orderNo);
    expect(o).toMatchObject({
      source: 'storefront',
      status: 'new',
      payment_method: 'prepaid',
      customer_phone: '+919876543210',
      customer_name: 'Asha',
      customer_email: 'asha@example.com',
      customer_address: '12 Main St',
      notes: 'Delivery address: 12 Main St\nring twice',
      rto_score: null,
      rto_band: null,
      coupon_code: null,
      recovery_token: token,
    });
    expect([Number(o.total_minor), Number(o.shipping_minor), Number(o.discount_minor)]).toEqual([
      28000, 3000, 0,
    ]);
    expect(o.items_json).toEqual([
      { product_id: a.id, name: 'A', qty: 2, price_minor: 10000, image: null, retailer_id: null },
      { product_id: b.id, name: 'B', qty: 1, price_minor: 5000, image: null, retailer_id: null },
    ]);
    expect(await stockOf(a.id)).toBe(3);
    expect(await stockOf(b.id)).toBeNull();
    const ev = await api.events(m.t.orgId, 'store.order_placed');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      orderNo: res.body.orderNo,
      totalMinor: 28000,
      customerPhone: '919876543210',
    });
  });

  it('clamps a quantity to the stock and decrements it; nothing available is 422 and creates no order', async () => {
    const m = await merchant('clamp');
    const p = await product(m.t, { name: 'Last', price: 1000, stock: 2 });
    const res = await post(`/${m.slug}/checkout`).send({
      ...buyer,
      items: [{ id: p.uuid, qty: 5 }],
    });
    expect(res.status).toBe(201);
    expect((await orderRow(res.body.orderNo)).items_json[0].qty).toBe(2);
    expect(await stockOf(p.id)).toBe(0);
    const again = await post(`/${m.slug}/checkout`).send({
      ...buyer,
      items: [{ id: p.uuid, qty: 1 }],
    });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('STORE_ITEMS_UNAVAILABLE');
    const ghost = await post(`/${m.slug}/checkout`).send({
      ...buyer,
      items: [{ id: '7e57d1b6-0000-4000-8000-000000000000', qty: 1 }],
    });
    expect(ghost.body.code).toBe('STORE_ITEMS_UNAVAILABLE');
    expect(
      (await h.owner.query(`SELECT count(*)::int n FROM wa_orders WHERE org_id=$1`, [m.t.orgId]))
        .rows[0].n,
    ).toBe(1);
  });

  it('two buyers racing for the last unit: one gets it, the other is told it is gone', async () => {
    const m = await merchant('race');
    const p = await product(m.t, { name: 'One', price: 1000, stock: 1 });
    const go = () =>
      post(`/${m.slug}/checkout`).send({ ...buyer, items: [{ id: p.uuid, qty: 1 }] });
    const [r1, r2] = await Promise.all([go(), go()]);
    expect([r1.status, r2.status].sort()).toEqual([201, 422]);
    expect(await stockOf(p.id)).toBe(0);
  });

  it('a phone under 7 digits is 422; a missing name is 422; a product of another workspace is dropped', async () => {
    const m = await merchant('valid');
    const p = await product(m.t, { name: 'P', price: 1000 });
    const bad = await post(`/${m.slug}/checkout`).send({
      name: 'A',
      phone: '12-34',
      items: [{ id: p.uuid, qty: 1 }],
    });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toMatch(/valid phone number/);
    expect(
      (
        await post(`/${m.slug}/checkout`).send({
          phone: buyer.phone,
          items: [{ id: p.uuid, qty: 1 }],
        })
      ).status,
    ).toBe(422);
    const other = await merchant('valid-other');
    const foreign = await product(other.t, { name: 'F', price: 1 });
    const res = await post(`/${m.slug}/checkout`).send({
      ...buyer,
      items: [{ id: foreign.uuid, qty: 1 }],
    });
    expect(res.body.code).toBe('STORE_ITEMS_UNAVAILABLE');
  });

  it('coupon: the quote answers 422 for a bad code while checkout silently ignores it; a valid one discounts, is recorded and counted', async () => {
    const m = await merchant('coupon');
    const p = await product(m.t, { name: 'P', price: 40000, stock: 20 });
    await h.owner.query(
      `INSERT INTO wa_coupons (org_id, code, type, amount, max_discount_minor) VALUES ($1,'Save20','percent',20,5000)`,
      [m.t.orgId],
    );
    await h.owner.query(
      `INSERT INTO wa_coupons (org_id, code, type, amount, expires_at) VALUES ($1,'OLD','flat',100,now() - interval '1 day')`,
      [m.t.orgId],
    );
    const items = [{ id: p.uuid, qty: 1 }];

    const quote = await post(`/${m.slug}/coupon`).send({ code: 'save20', items });
    expect(quote.status).toBe(200);
    expect(quote.body).toEqual({
      code: 'Save20',
      discountMinor: 5000,
      shippingMinor: 0,
      totalMinor: 35000,
      freeShipping: false,
    });
    const bad = await post(`/${m.slug}/coupon`).send({ code: 'NOPE', items });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('STORE_COUPON_INVALID');
    expect((await post(`/${m.slug}/coupon`).send({ code: 'OLD', items })).body.code).toBe(
      'STORE_COUPON_INVALID',
    );

    const ignored = await post(`/${m.slug}/checkout`).send({ ...buyer, coupon: 'NOPE', items });
    expect(ignored.status).toBe(201);
    const o1 = await orderRow(ignored.body.orderNo);
    expect([Number(o1.total_minor), o1.coupon_code]).toEqual([40000, null]);

    const used = await post(`/${m.slug}/checkout`).send({ ...buyer, coupon: 'SAVE20', items });
    const o2 = await orderRow(used.body.orderNo);
    expect([Number(o2.discount_minor), Number(o2.total_minor), o2.coupon_code]).toEqual([
      5000,
      35000,
      'Save20',
    ]);
    expect(
      (
        await h.owner.query(`SELECT used_count FROM wa_coupons WHERE org_id=$1 AND code='Save20'`, [
          m.t.orgId,
        ])
      ).rows[0].used_count,
    ).toBe(1);
  });

  it('a coupon scoped to another shop is not valid here; a usage limit stops at the limit', async () => {
    const m = await merchant('coupon2');
    const other = await shop(m.t, 'Other');
    const otherId = Number(
      (await h.owner.query(`SELECT id FROM wa_storefronts WHERE uuid=$1`, [other.id])).rows[0].id,
    );
    const p = await product(m.t, { name: 'P', price: 10000 });
    await h.owner.query(
      `INSERT INTO wa_coupons (org_id, code, type, amount, storefront_id) VALUES ($1,'ELSE','flat',100,$2)`,
      [m.t.orgId, otherId],
    );
    await h.owner.query(
      `INSERT INTO wa_coupons (org_id, code, type, amount, usage_limit) VALUES ($1,'ONCE','flat',100,1)`,
      [m.t.orgId],
    );
    const items = [{ id: p.uuid, qty: 1 }];
    expect((await post(`/${m.slug}/coupon`).send({ code: 'ELSE', items })).status).toBe(422);
    expect((await post(`/${other.slug}/coupon`).send({ code: 'ELSE', items })).status).toBe(200);
    await post(`/${m.slug}/checkout`).send({ ...buyer, coupon: 'ONCE', items });
    await post(`/${m.slug}/checkout`).send({ ...buyer, coupon: 'ONCE', items });
    expect(
      (
        await h.owner.query(`SELECT used_count FROM wa_coupons WHERE code='ONCE' AND org_id=$1`, [
          m.t.orgId,
        ])
      ).rows[0].used_count,
    ).toBe(1);
  });

  it('COD stores the RTO score and band (a returning buyer who typed a plus is recognised); prepaid stores none', async () => {
    const m = await merchant('rto');
    const p = await product(m.t, { name: 'P', price: 10000 });
    const items = [{ id: p.uuid, qty: 1 }];
    const first = await post(`/${m.slug}/checkout`).send({ ...buyer, paymentMethod: 'cod', items });
    const o1 = await orderRow(first.body.orderNo);
    // first-time buyer +30; the only order so far is this one, so total == average
    expect([o1.rto_score, o1.rto_band]).toEqual([30, 'medium']);
    await h.owner.query(`UPDATE wa_orders SET status='paid' WHERE id=$1`, [first.body.orderNo]);
    await post(`/${m.slug}/checkout`).send({ ...buyer, paymentMethod: 'cod', items });
    const second = await post(`/${m.slug}/checkout`).send({
      ...buyer,
      paymentMethod: 'cod',
      items,
    });
    const o2 = await orderRow(second.body.orderNo);
    // one paid prior order found through the digits: not first-time, so no +30
    expect(o2.rto_score).toBeLessThan(30);
    const prepaid = await post(`/${m.slug}/checkout`).send({ ...buyer, items });
    const o3 = await orderRow(prepaid.body.orderNo);
    expect([o3.rto_score, o3.rto_band, o3.payment_method]).toEqual([null, null, 'prepaid']);
  });

  it('an Idempotency-Key makes a repeat return the first order and no second one', async () => {
    const m = await merchant('idem');
    const p = await product(m.t, { name: 'P', price: 1000, stock: 10 });
    const send = () =>
      post(`/${m.slug}/checkout`)
        .set('idempotency-key', 'key-123')
        .send({ ...buyer, items: [{ id: p.uuid, qty: 2 }] });
    const a = await send();
    const b = await send();
    expect(a.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(await stockOf(p.id)).toBe(8);
    expect(
      (await h.owner.query(`SELECT count(*)::int n FROM wa_orders WHERE org_id=$1`, [m.t.orgId]))
        .rows[0].n,
    ).toBe(1);
  });

  it('the 21st checkout from one address in a minute is throttled (429)', async () => {
    const m = await merchant('throttle');
    const p = await product(m.t, { name: 'P', price: 1000 });
    const addr = '10.99.99.99';
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      const r = await api
        .http()
        .post(`/v2/store-public/${m.slug}/checkout`)
        .set('x-forwarded-for', addr)
        .send({ ...buyer, items: [{ id: p.uuid, qty: 1 }] });
      last = r.status;
      if (i < 20) expect(r.status).toBe(201);
    }
    expect(last).toBe(429);
  });
});

// --- tracking page (TW-STORE-017) -----------------------------------------------------------------------------------

describe('order tracking', () => {
  it('the token opens the order with a safe projection; a wrong token, another shop and a disabled shop are 404', async () => {
    const m = await merchant('track');
    const p = await product(m.t, { name: 'P', price: 12000 });
    const placed = await post(`/${m.slug}/checkout`).send({
      ...buyer,
      items: [{ id: p.uuid, qty: 1 }],
    });
    const token = placed.body.trackUrl.split('/order/')[1] as string;
    const res = await pub(`/${m.slug}/orders/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject({
      orderNo: placed.body.orderNo,
      status: 'new',
      totalMinor: 12000,
      customerName: 'Asha',
    });
    // the "Delivery to" card needs the address the buyer typed
    expect(res.body.order).toHaveProperty('customerAddress');
    expect(JSON.stringify(res.body)).not.toMatch(/9876543210|recovery|org_id/);
    expect((await pub(`/${m.slug}/orders/${'x'.repeat(40)}`)).status).toBe(404);
    const other = await merchant('track-other');
    expect((await pub(`/${other.slug}/orders/${token}`)).status).toBe(404);
    await setShipping(m, { enabled: false });
    expect((await pub(`/${m.slug}/orders/${token}`)).status).toBe(404);
  });
});

// --- the dashboard (TW-STORE-001, 020) ---------------------------------------------------------------------------------

describe('store overview', () => {
  it('sums the last 30 days workspace-wide, ranks best sellers, lists the newest orders and counts visits', async () => {
    const m = await merchant('overview');
    const a = await product(m.t, { name: 'Alpha', price: 100000 });
    const b = await product(m.t, { name: 'Beta', price: 100000 });
    for (const [p, q] of [
      [a, 2],
      [b, 1],
    ] as const) {
      await post(`/${m.slug}/checkout`).send({ ...buyer, items: [{ id: p.uuid, qty: q }] });
    }
    // one order older than 30 days contributes to nothing
    await h.owner.query(
      `INSERT INTO wa_orders (org_id, source, items_json, total_minor, created_at) VALUES ($1,'waba','[{"name":"Old","qty":9}]'::jsonb,500000, now() - interval '40 days')`,
      [m.t.orgId],
    );
    await pub(`/${m.slug}/home`);
    await pub(`/${m.slug}/home`);
    const res = await api.as(m.t.admin).get('/v2/store/overview');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.stats).toMatchObject({
      revenue30: 300000,
      orders30: 2,
      aov: 150000,
      products: 2,
      storefrontViews30: 2,
    });
    expect(res.body.topProducts).toEqual([
      { name: 'Alpha', qty: 2 },
      { name: 'Beta', qty: 1 },
    ]);
    // Reference's newest-eight list has no 30-day window (the inventory text says it does; the source does not).
    expect(res.body.recentOrders).toHaveLength(3);
    expect(res.body.recentOrders.at(-1).source).toBe('waba');
    expect(res.body.recentOrders[0].itemsCount).toBe(1);
    expect(res.body.shop.cnameTarget).toBe('localhost');
    // the numbers beside the sidebar entries (workspace-wide) and how the store reaches WhatsApp
    expect(res.body.counts).toEqual({
      orders: 3,
      products: 2,
      groups: 0,
      coupons: 0,
      reviewsPending: 0,
      payments: 0,
      gateways: 0,
      customers: 0,
    });
    expect(res.body.connection).toEqual({ kind: 'device', label: '91 9812345678', live: true });
    expect(res.body.salesByDay.labels).toHaveLength(30);
    expect(res.body.salesByDay.revenue.at(-1)).toBe(3000);
    expect(res.body.salesByDay.orders.at(-1)).toBe(2);
    expect(res.body.shops).toHaveLength(1);
  });

  it('counts pending reviews and reports other connection kinds', async () => {
    const t = await api.signup('counts');
    // a shop on no device while another device is connected: Live through that device, label by kind
    const deviceUuid = await device(t);
    const s = await shop(t, 'Counts Shop', deviceUuid);
    await h.owner.query(`UPDATE wa_storefronts SET device_id = NULL WHERE uuid = $1`, [s.id]);
    const p = await product(t, { name: 'Rated', price: 1000 });
    await h.owner.query(
      `INSERT INTO wa_product_reviews (org_id, product_id, rating, status) VALUES ($1,$2,5,'pending'), ($1,$2,4,'approved')`,
      [t.orgId, p.id],
    );
    const res = await api.as(t.admin).get('/v2/store/overview');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.counts.reviewsPending).toBe(1);
    expect(res.body.connection).toEqual({ kind: 'other_device', label: null, live: true });
    await h.owner.query(`UPDATE devices SET status = 'disconnected' WHERE org_id = $1`, [t.orgId]);
    const off = await api.as(t.admin).get('/v2/store/overview');
    expect(off.body.connection).toEqual({ kind: 'none', label: null, live: false });
  });

  it('a workspace with no shop answers 404 STORE_NO_SHOP', async () => {
    const t = await api.signup('noshop');
    const res = await api.as(t.admin).get('/v2/store/overview');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('STORE_NO_SHOP');
  });
});

// --- the Razorpay webhook (TW-STORE-018) ------------------------------------------------------------------------------

describe('razorpay webhook', () => {
  async function paidSetup(label: string) {
    const m = await merchant(label);
    await setShipping(m, {
      paymentProvider: 'razorpay_api',
      rzpKeyId: 'rzp_test_1',
      rzpKeySecret: 'ksec',
      rzpWebhookSecret: 'wh-secret',
    });
    const p = await product(m.t, { name: 'P', price: 5000 });
    const placed = await post(`/${m.slug}/checkout`).send({
      ...buyer,
      items: [{ id: p.uuid, qty: 1 }],
    });
    const shopId = Number(
      (await h.owner.query(`SELECT id FROM wa_storefronts WHERE uuid=$1`, [m.s.id])).rows[0].id,
    );
    return { m, orderNo: placed.body.orderNo as number, shopId };
  }
  const event = (o: {
    orderNo: number;
    shopId: number;
    amount?: number;
    currency?: string;
    name?: string;
  }) => ({
    event: o.name ?? 'payment_link.paid',
    payload: {
      payment_link: {
        entity: {
          id: 'plink_1',
          short_url: 'https://rzp.io/i/x',
          amount: o.amount ?? 5000,
          currency: o.currency ?? 'INR',
          notes: { wa_order_id: String(o.orderNo), storefront_id: String(o.shopId) },
        },
      },
      payment: { entity: { id: 'pay_1' } },
    },
  });
  const hook = (body: unknown, secret = 'wh-secret', sig?: string) => {
    const raw = JSON.stringify(body);
    return api
      .http()
      .post('/v2/store-public/webhooks/razorpay')
      .set('x-forwarded-for', ip())
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', sig ?? signRazorpayBody(raw, secret))
      .send(raw);
  };
  const status = async (n: number) => (await orderRow(n)).status as string;

  it('a signed paid event marks the order paid with the payment ids, and a replay changes nothing', async () => {
    const { orderNo, shopId, m } = await paidSetup('wh1');
    const res = await hook(event({ orderNo, shopId }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ ok: true, order: orderNo });
    const o = await orderRow(orderNo);
    expect(o.status).toBe('paid');
    expect(o.payment_link).toBe('https://rzp.io/i/x');
    expect(o.meta_json).toMatchObject({
      paid_via: 'razorpay_link',
      razorpay_payment: 'pay_1',
      razorpay_plink: 'plink_1',
      placed_via: 'storefront_checkout',
    });
    const again = await hook(event({ orderNo, shopId }));
    expect(again.body).toEqual({ ok: true, order: orderNo });
    expect(await api.events(m.t.orgId, 'store.order_paid')).toHaveLength(1);
  });

  it('a wrong signature is 400 and nothing changes; a shop without a webhook secret fails closed', async () => {
    const { orderNo, shopId, m } = await paidSetup('wh2');
    const bad = await hook(event({ orderNo, shopId }), 'wrong-secret');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('STORE_WEBHOOK_REJECTED');
    expect(await status(orderNo)).toBe('new');
    const missing = await hook(event({ orderNo, shopId }), 'wh-secret', 'deadbeef');
    expect(missing.status).toBe(400);
    const noHeader = await api
      .http()
      .post('/v2/store-public/webhooks/razorpay')
      .set('x-forwarded-for', ip())
      .set('content-type', 'application/json')
      .send(JSON.stringify(event({ orderNo, shopId })));
    expect(noHeader.status).toBe(400);

    await setShipping(m, { paymentProvider: 'razorpay_api', rzpWebhookSecret: '' });
    await h.owner.query(
      `UPDATE wa_storefronts SET payment_config_json = payment_config_json - 'webhook_secret' WHERE uuid=$1`,
      [m.s.id],
    );
    expect((await hook(event({ orderNo, shopId }))).status).toBe(400);
    expect(await status(orderNo)).toBe('new');
  });

  it('an unknown shop id is 404 and invalid JSON is 400', async () => {
    expect((await hook(event({ orderNo: 1, shopId: 987654321 }))).status).toBe(404);
    const bad = await api
      .http()
      .post('/v2/store-public/webhooks/razorpay')
      .set('x-forwarded-for', ip())
      .set('content-type', 'application/json')
      .send('not json');
    expect(bad.status).toBe(400);
  });

  it('a wrong amount or currency does not settle the order', async () => {
    const { orderNo, shopId } = await paidSetup('wh3');
    const amount = await hook(event({ orderNo, shopId, amount: 4999 }));
    expect(amount.status).toBe(200);
    expect(amount.body).toEqual({ ok: true, order: null, rejected: 'amount_mismatch' });
    const currency = await hook(event({ orderNo, shopId, currency: 'USD' }));
    expect(currency.body.rejected).toBe('amount_mismatch');
    expect(await status(orderNo)).toBe('new');
  });

  it('a cancelled order is refused; an order of another shop (even of another workspace) is refused', async () => {
    const { orderNo, shopId } = await paidSetup('wh4');
    await h.owner.query(`UPDATE wa_orders SET status='cancelled' WHERE id=$1`, [orderNo]);
    expect((await hook(event({ orderNo, shopId }))).body).toEqual({
      ok: true,
      order: null,
      rejected: 'order_cancelled',
    });
    expect(await status(orderNo)).toBe('cancelled');

    const victim = await paidSetup('wh5-victim');
    const attacker = await paidSetup('wh5-attacker');
    // The attacker signs with their own valid secret but names the victim's order.
    const forged = await hook(event({ orderNo: victim.orderNo, shopId: attacker.shopId }));
    expect(forged.status).toBe(200);
    // Another workspace's order is invisible under the attacker's tenant: it is simply not found.
    expect(forged.body).toEqual({ ok: true, order: null });
    expect(await status(victim.orderNo)).toBe('new');

    // Same workspace, order of no shop (or another one): refused with the reason.
    await h.owner.query(`UPDATE wa_orders SET storefront_id = NULL WHERE id=$1`, [victim.orderNo]);
    const other = await hook(event({ orderNo: victim.orderNo, shopId: victim.shopId }));
    expect(other.body).toEqual({ ok: true, order: null, rejected: 'order_not_in_shop' });
    expect(await status(victim.orderNo)).toBe('new');
  });

  it('other events are acknowledged and ignored', async () => {
    const { orderNo, shopId } = await paidSetup('wh6');
    const res = await hook(event({ orderNo, shopId, name: 'payment.failed' }));
    expect(res.body).toEqual({ ok: true, ignored: 'payment.failed' });
    expect(await status(orderNo)).toBe('new');
  });
});

// --- cart recovery (TW-STORE-015) --------------------------------------------------------------------------------------

describe('abandoned-cart recovery', () => {
  function sweeper() {
    const get = <T>(t: unknown) => h.app.get<T>(t as never, { strict: false });
    return new CartRecoverySweepService(
      get(DatabaseService),
      get(CartRecoveryRepository),
      get(ShopsRepository),
      get(SENDER_DIRECTORY),
      get(RECOVERY_NUDGE_SENDER),
      get(STOREFRONT_ENV),
    );
  }
  async function enableRecovery(m: { t: Tenant; s: any }, extra: Record<string, unknown> = {}) {
    await setShipping(m, { cartRecoveryEnabled: true, cartRecoveryDelayMin: 15, ...extra });
  }
  const beacon = (slug: string, p: { uuid: string }, phone = buyer.phone) =>
    post(`/${slug}/abandon`).send({ name: 'Asha Rao', phone, items: [{ id: p.uuid, qty: 2 }] });

  it('does nothing when recovery is off or the phone is short; schedules once per phone when on', async () => {
    const m = await merchant('rec1');
    const p = await product(m.t, { name: 'P', price: 12900 });
    const off = await beacon(m.slug, p);
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ scheduled: false });
    await enableRecovery(m);
    expect(
      (await post(`/${m.slug}/abandon`).send({ phone: '12', items: [{ id: p.uuid, qty: 1 }] }))
        .status,
    ).toBe(422);
    const on = await beacon(m.slug, p);
    expect(on.body).toEqual({ scheduled: true });
    expect((await beacon(m.slug, p)).body).toEqual({ scheduled: false });
    const rows = await h.owner.query(
      `SELECT customer_phone, customer_name, subtotal_minor, status, nudge_at > now() + interval '14 minutes' AS later FROM storefront_cart_recoveries WHERE org_id=$1`,
      [m.t.orgId],
    );
    expect(rows.rows).toEqual([
      {
        customer_phone: '919876543210',
        customer_name: 'Asha Rao',
        subtotal_minor: 25800,
        status: 'active',
        later: true,
      },
    ]);
  });

  it('a delay under 5 minutes is raised to 5 in the stored schedule', async () => {
    const m = await merchant('rec2');
    const p = await product(m.t, { name: 'P', price: 100 });
    await enableRecovery(m);
    await h.owner.query(
      `UPDATE wa_storefronts SET settings_json = jsonb_set(settings_json, '{cart_recovery_delay_min}', '3') WHERE uuid=$1`,
      [m.s.id],
    );
    await beacon(m.slug, p);
    const r = await h.owner.query(
      `SELECT nudge_at BETWEEN now() + interval '4 minutes' AND now() + interval '6 minutes' AS ok FROM storefront_cart_recoveries WHERE org_id=$1`,
      [m.t.orgId],
    );
    expect(r.rows[0].ok).toBe(true);
  });

  it('an order from the same phone marks the recovery recovered and it is never nudged', async () => {
    const m = await merchant('rec3');
    const p = await product(m.t, { name: 'P', price: 100 });
    await enableRecovery(m);
    await beacon(m.slug, p);
    const placed = await post(`/${m.slug}/checkout`).send({
      ...buyer,
      items: [{ id: p.uuid, qty: 1 }],
    });
    expect(placed.status).toBe(201);
    const r = await h.owner.query(`SELECT status FROM storefront_cart_recoveries WHERE org_id=$1`, [
      m.t.orgId,
    ]);
    expect(r.rows[0].status).toBe('recovered');
    await h.owner.query(
      `UPDATE storefront_cart_recoveries SET nudge_at = now() - interval '1 minute' WHERE org_id=$1`,
      [m.t.orgId],
    );
    const before = bridgeCalls.length;
    await sweeper().sweep();
    expect(bridgeCalls.length).toBe(before);
  });

  it('the sweep sends the templated nudge once from the shop number, moves the row to sent, and a later cart can start again', async () => {
    const m = await merchant('rec4', 'Acme Shop');
    const p = await product(m.t, { name: 'P', price: 129900 });
    await enableRecovery(m, { cartRecoveryMessage: 'Hi {name}, {total} waits at {shop}: {url}' });
    await beacon(m.slug, p);
    await h.owner.query(
      `UPDATE storefront_cart_recoveries SET nudge_at = now() - interval '1 minute' WHERE org_id=$1`,
      [m.t.orgId],
    );
    const before = bridgeCalls.length;
    const claimed = await sweeper().sweep();
    expect(claimed).toBeGreaterThanOrEqual(1);
    const mine = bridgeCalls
      .slice(before)
      .filter((c) => c.body.targetPhoneNumber === '919876543210');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.path).toBe('/api/send-message/919812345678');
    expect(mine[0]!.token).toBe('node-token-1');
    expect(mine[0]!.body.message).toBe(
      `Hi Asha Rao, ₹ 2,598 waits at Acme Shop: http://localhost:3001/s/${m.slug}`,
    );
    const row = await h.owner.query(
      `SELECT status, nudged_at IS NOT NULL AS stamped FROM storefront_cart_recoveries WHERE org_id=$1`,
      [m.t.orgId],
    );
    expect(row.rows[0]).toEqual({ status: 'sent', stamped: true });

    // a second pass sends nothing more
    const mid = bridgeCalls.length;
    await sweeper().sweep();
    expect(bridgeCalls.length).toBe(mid);
    // the same phone can start a new recovery now
    expect((await beacon(m.slug, p)).body).toEqual({ scheduled: true });
  });

  it('with no sender nothing is scheduled', async () => {
    const t = await api.signup('rec5');
    await device(t);
    const s = await shop(t, 'No sender later');
    await h.owner.query(`UPDATE devices SET status='disconnected' WHERE org_id=$1`, [t.orgId]);
    const p = await product(t, { name: 'P', price: 100 });
    await enableRecovery({ t, s });
    expect((await beacon(s.slug, p)).body).toEqual({ scheduled: false });
  });
});
