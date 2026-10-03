import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { FixtureCatalogState } from '../../../src/infra/providers/catalog-products/fixture.catalog.provider';
import { InventoryService } from '../../../src/modules/catalog-products/inventory.service';
import { CatalogResyncSweepService } from '../../../src/modules/catalog-products/catalog-sweeps.service';
import { StorefrontProductsReader } from '../../../src/modules/catalog-products/storefront-reader';
import { Api, startHarness, uuidRe, type Harness, type Tenant } from '../deals-pipelines/support';

/**
 * Catalog and products end to end through HTTP (TW-CAT-001..029) against the fixture provider (CAT_PROVIDER_MODE=fixture):
 * Meta and the Node bridge are in-memory stand-ins, everything else (Postgres with RLS, Redis, the real app) is real.
 */
let h: Harness;
let api: Api;
let fx: FixtureCatalogState;

beforeAll(async () => {
  process.env.CAT_PROVIDER_MODE = 'fixture';
  h = await startHarness();
  api = new Api(h);
  fx = h.app.get(FixtureCatalogState, { strict: false });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const TOKEN = 'EAAG-test-token-0123456789-abcdef';
const code = (res: { body: { code?: string } }) => res.body.code;
const product = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  priceMajor: '1299.50',
  currencyCode: 'INR',
  ...extra,
});

async function createProduct(t: Tenant, name: string, extra: Record<string, unknown> = {}) {
  const res = await api.as(t.admin).post('/v2/catalog/products').send(product(name, extra));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as {
    id: string;
    slug: string;
    rowVersion: number;
    priceMinor: number;
    metaSyncStatus: string | null;
    metaLastError: string | null;
    retailerId: string;
  };
}
async function connect(t: Tenant, over: Record<string, unknown> = {}) {
  return api
    .as(t.admin)
    .post('/v2/catalog/connect')
    .send({
      provider: 'meta_cloud',
      catalogId: '555001',
      catalogName: 'Main',
      phoneNumberId: '100200',
      accessToken: TOKEN,
      ...over,
    });
}
async function fresh(label: string) {
  fx.reset();
  return api.signup(label);
}
async function device(t: Tenant, phone = '919800000001') {
  await h.owner.query(
    `INSERT INTO devices (org_id, device_name, phone_number, country_code, status, active) VALUES ($1,'Phone',$2,NULL,'connected',true)`,
    [t.orgId, phone],
  );
}

describe('TW-CAT-001: gate and plan flag', () => {
  it('a member without the key is refused 403, with it is let in; the plan flag locks the catalog area but not products or reviews', async () => {
    const t = await fresh('gate');
    const none = await api.member(t, 'nobody', [['record.deals.read']]);
    expect((await api.as(none.token).get('/v2/catalog/overview')).status).toBe(403);
    expect((await api.as(none.token).get('/v2/catalog/products')).status).toBe(403);
    expect((await api.as(none.token).get('/v2/catalog/reviews')).status).toBe(403);
    const reader = await api.member(t, 'reader', [['cat.catalog.read']]);
    expect((await api.as(reader.token).get('/v2/catalog/overview')).status).toBe(200);
    expect((await api.as(reader.token).post('/v2/catalog/disconnect')).status).toBe(403);

    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"wa_storefront":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    try {
      const get = await api.as(t.admin).get('/v2/catalog/overview');
      expect(get.status).toBe(422);
      expect(code(get)).toBe('PLAN_FEATURE_LOCKED');
      const post = await connect(t);
      expect(post.status).toBe(422);
      expect(code(post)).toBe('PLAN_FEATURE_LOCKED');
      expect(
        (await h.owner.query(`SELECT count(*)::int n FROM wa_catalogs WHERE org_id=$1`, [t.orgId]))
          .rows[0].n,
      ).toBe(0);
      expect((await api.as(t.admin).get('/v2/catalog/collections')).status).toBe(422);
      expect((await api.as(t.admin).get('/v2/catalog/products')).status).toBe(200);
      expect((await api.as(t.admin).get('/v2/catalog/reviews')).status).toBe(200);
    } finally {
      await h.owner.query(`UPDATE org_plan_state SET overrides = '{}' WHERE org_id = $1`, [
        t.orgId,
      ]);
    }
  });
});

describe('TW-CAT-002..006: connect, link, disconnect, settings', () => {
  it('TW-CAT-002 #1: valid credentials create the row with cart and catalog visible, the token encrypted and never returned', async () => {
    const t = await fresh('conn');
    const res = await connect(t);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      provider: 'meta_cloud',
      catalogId: '555001',
      isCartEnabled: true,
      isCatalogVisible: true,
    });
    expect(res.body.id).toMatch(uuidRe);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    const row = (
      await h.owner.query(`SELECT access_token_enc FROM wa_catalogs WHERE org_id=$1`, [t.orgId])
    ).rows[0];
    expect(row.access_token_enc).toMatch(/^v1:/);
    expect(row.access_token_enc).not.toContain(TOKEN);
    const overview = await api.as(t.admin).get('/v2/catalog/overview');
    expect(JSON.stringify(overview.body)).not.toContain(TOKEN);
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id=$1 AND module='catalog'`,
      [t.orgId],
    );
    expect(JSON.stringify(audit.rows)).not.toContain(TOKEN);
    expect(await api.auditCount(t.orgId, 'catalog', 'insert')).toBe(1);
    expect((await api.events(t.orgId, 'catalog.connected')).length).toBe(1);
  });

  it("TW-CAT-002 #2: Meta code 100 leaves no row and answers Meta's message, the code and the catalog_management hint", async () => {
    const t = await fresh('connbad');
    const res = await connect(t, { catalogId: 'bad-1' });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('CAT_META_REJECTED');
    expect(res.body.detail).toContain('Unsupported get request');
    expect(res.body.detail).toContain('(code 100)');
    expect(res.body.detail).toContain('catalog_management');
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        { path: 'metaCode', message: '100' },
        expect.objectContaining({ path: 'accessToken' }),
      ]),
    );
    expect(
      (await h.owner.query(`SELECT count(*)::int n FROM wa_catalogs WHERE org_id=$1`, [t.orgId]))
        .rows[0].n,
    ).toBe(0);
  });

  it('TW-CAT-002 #3: a 10-character token fails validation and writes nothing', async () => {
    const t = await fresh('conntok');
    const res = await connect(t, { accessToken: '0123456789' });
    expect(res.status).toBe(422);
    expect(
      (await h.owner.query(`SELECT count(*)::int n FROM wa_catalogs WHERE org_id=$1`, [t.orgId]))
        .rows[0].n,
    ).toBe(0);
  });

  it('TW-CAT-002 #4: a network failure answers the generic retry message and writes nothing', async () => {
    const t = await fresh('connnet');
    const { CatalogProviderError } =
      await import('../../../src/infra/providers/catalog-products/catalog-provider.port');
    fx.failNext.set('verifyCatalog', new CatalogProviderError('boom', 'network'));
    const res = await connect(t);
    expect(res.status).toBe(422);
    expect(code(res)).toBe('CAT_PROVIDER_FAILED');
    expect(res.body.detail).toContain('Could not verify the catalog right now');
    expect(
      (await h.owner.query(`SELECT count(*)::int n FROM wa_catalogs WHERE org_id=$1`, [t.orgId]))
        .rows[0].n,
    ).toBe(0);
  });

  it('TW-CAT-002 (intended): a failed re-connect keeps the working connection; a good one overwrites it and keeps the automation', async () => {
    const t = await fresh('connre');
    await connect(t);
    await api
      .as(t.admin)
      .post('/v2/catalog/automation')
      .send({ conciergeEnabled: true, conciergeHeader: 'Hello' });
    expect((await connect(t, { catalogId: 'bad-2' })).status).toBe(422);
    expect(
      (await h.owner.query(`SELECT catalog_id FROM wa_catalogs WHERE org_id=$1`, [t.orgId])).rows[0]
        .catalog_id,
    ).toBe('555001');
    const ok = await connect(t, { catalogId: '777002' });
    expect(ok.body.catalogId).toBe('777002');
    expect(ok.body.automation).toMatchObject({ conciergeEnabled: true, conciergeHeader: 'Hello' });
  });

  it('TW-CAT-003: autodetect with no WABA number says to connect one; with a WABA config and a catalog id it links; without one it creates and links', async () => {
    const t = await fresh('auto');
    const none = await api.as(t.admin).post('/v2/catalog/autodetect');
    expect(none.status).toBe(422);
    expect(code(none)).toBe('CAT_NO_WABA');

    const { CryptoService } = await import('../../../src/common/crypto/crypto.service');
    const crypto = h.app.get(CryptoService, { strict: false });
    const seedWaba = async (creds: Record<string, string>, meta: Record<string, string> = {}) =>
      h.owner.query(
        `INSERT INTO wa_provider_configs (org_id, provider, status, credentials_json, meta_json, phone_number, is_primary, connected_at)
         VALUES ($1,'waba','connected',$2,$3::jsonb,'919811111111',true,now()) RETURNING id`,
        [t.orgId, crypto.encrypt(JSON.stringify(creds)), JSON.stringify(meta)],
      );
    const noToken = await seedWaba({ waba_id: 'w1' });
    expect(code(await api.as(t.admin).post('/v2/catalog/autodetect'))).toBe(
      'CAT_WABA_TOKEN_MISSING',
    );
    await h.owner.query(`DELETE FROM wa_provider_configs WHERE org_id=$1 AND id=$2`, [
      t.orgId,
      noToken.rows[0].id,
    ]);

    await seedWaba(
      { access_token: TOKEN, waba_id: 'w1', phone_number_id: '100200' },
      { catalog_id: 'known-1' },
    );
    const linked = await api.as(t.admin).post('/v2/catalog/autodetect');
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body).toMatchObject({
      provider: 'meta_cloud',
      catalogId: 'known-1',
      phoneNumberId: '100200',
    });

    const t2 = await fresh('auto2');
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, credentials_json, meta_json, phone_number, is_primary, connected_at)
       VALUES ($1,'waba','connected',$2,'{}'::jsonb,'919822222222',true,now())`,
      [
        t2.orgId,
        crypto.encrypt(JSON.stringify({ access_token: TOKEN, waba_id: 'w2', business_id: 'biz9' })),
      ],
    );
    const created = await api.as(t2.admin).post('/v2/catalog/autodetect');
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(fx.createdCatalogs).toHaveLength(1);
    expect(fx.linked).toEqual([{ wabaId: 'w2', catalogId: created.body.catalogId }]);
    const cfg = await h.owner.query(`SELECT meta_json FROM wa_provider_configs WHERE org_id=$1`, [
      t2.orgId,
    ]);
    expect(cfg.rows[0].meta_json.catalog_id).toBe(created.body.catalogId);

    const t3 = await fresh('auto3');
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, credentials_json, meta_json, is_primary, connected_at)
       VALUES ($1,'waba','connected',$2,'{}'::jsonb,true,now())`,
      [t3.orgId, crypto.encrypt(JSON.stringify({ access_token: TOKEN, waba_id: 'w3' }))],
    );
    expect(code(await api.as(t3.admin).post('/v2/catalog/autodetect'))).toBe(
      'CAT_NO_CATALOG_LINKED',
    );
  });

  it("TW-CAT-004: disconnect removes the binding, nulls every product's sync state, keeps the retailer ids; with no catalog it still succeeds", async () => {
    const t = await fresh('disc');
    await connect(t);
    const p = await createProduct(t, 'Tee', { sku: 'TEE-1' });
    expect(p.metaSyncStatus).toBe('pending');
    const res = await api.as(t.admin).post('/v2/catalog/disconnect');
    expect(res.status).toBe(204);
    expect(
      (await h.owner.query(`SELECT count(*)::int n FROM wa_catalogs WHERE org_id=$1`, [t.orgId]))
        .rows[0].n,
    ).toBe(0);
    const row = (
      await h.owner.query(
        `SELECT meta_sync_status, meta_batch_handle, meta_synced_at, meta_last_error, meta_retailer_id FROM wa_products WHERE org_id=$1`,
        [t.orgId],
      )
    ).rows[0];
    expect(row).toMatchObject({
      meta_sync_status: null,
      meta_batch_handle: null,
      meta_synced_at: null,
      meta_last_error: null,
      meta_retailer_id: 'TEE-1',
    });
    expect((await api.as(t.admin).post('/v2/catalog/disconnect')).status).toBe(204);
    await connect(t);
    expect(
      (await api.as(t.admin).get('/v2/catalog/overview')).body.catalog.automation.conciergeEnabled,
    ).toBe(false);
  });

  it('TW-CAT-005: commerce settings go to Meta first and are stored after; no phone number id or a Meta error leaves the flags unchanged', async () => {
    const t = await fresh('comm');
    expect((await api.as(t.admin).post('/v2/catalog/commerce').send({})).status).toBe(404);
    await connect(t);
    const ok = await api
      .as(t.admin)
      .post('/v2/catalog/commerce')
      .send({ isCatalogVisible: true, isCartEnabled: false });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ isCartEnabled: false, isCatalogVisible: true });
    expect(fx.commerceSettings.at(-1)).toMatchObject({
      phoneNumberId: '100200',
      cartEnabled: false,
      catalogVisible: true,
    });

    const { CatalogProviderError } =
      await import('../../../src/infra/providers/catalog-products/catalog-provider.port');
    fx.failNext.set(
      'setCommerceSettings',
      new CatalogProviderError('Meta says no', 'meta', {
        code: 10,
        subcode: null,
        httpStatus: 400,
        raw: 'Meta says no',
      }),
    );
    const bad = await api
      .as(t.admin)
      .post('/v2/catalog/commerce')
      .send({ isCatalogVisible: false, isCartEnabled: true });
    expect(bad.status).toBe(422);
    expect(bad.body.detail).toBe('Meta says no');
    expect(
      (
        await h.owner.query(
          `SELECT is_cart_enabled, is_catalog_visible FROM wa_catalogs WHERE org_id=$1`,
          [t.orgId],
        )
      ).rows[0],
    ).toEqual({ is_cart_enabled: false, is_catalog_visible: true });

    const t2 = await fresh('comm2');
    await connect(t2, { phoneNumberId: null });
    const none = await api
      .as(t2.admin)
      .post('/v2/catalog/commerce')
      .send({ isCatalogVisible: true, isCartEnabled: true });
    expect(none.status).toBe(422);
    expect(code(none)).toBe('CAT_NO_PHONE_NUMBER');
  });

  it('TW-CAT-006: automation saves the switches, validates max 30, keeps keys without a control and answers 404 without a catalog', async () => {
    const t = await fresh('autom');
    expect((await api.as(t.admin).post('/v2/catalog/automation').send({})).status).toBe(404);
    await connect(t);
    await h.owner.query(
      `UPDATE wa_catalogs SET meta_json = '{"order_ack_template_id": 7, "concierge_footer": "bye"}'::jsonb WHERE org_id=$1`,
      [t.orgId],
    );
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/catalog/automation')
          .send({ conciergeEnabled: true, conciergeMax: 50 })
      ).status,
    ).toBe(422);
    const saved = await api
      .as(t.admin)
      .post('/v2/catalog/automation')
      .send({ conciergeEnabled: true, conciergeMax: 12, orderAckPayUrl: 'https://pay.test/c' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.automation).toMatchObject({
      conciergeEnabled: true,
      conciergeMax: 12,
      orderAckEnabled: false,
      orderAckPayUrl: 'https://pay.test/c',
    });
    const meta = (
      await h.owner.query(`SELECT meta_json FROM wa_catalogs WHERE org_id=$1`, [t.orgId])
    ).rows[0].meta_json;
    expect(meta).toMatchObject({
      order_ack_template_id: 7,
      concierge_footer: 'bye',
      concierge_max: 12,
    });
    const blank = await api.as(t.admin).post('/v2/catalog/automation').send({});
    expect(blank.body.automation).toEqual({
      orderAckEnabled: false,
      orderAckPayUrl: null,
      conciergeEnabled: false,
      conciergeHeader: null,
      conciergeMax: 10,
      conciergeReplyOnEmpty: false,
      conciergeEmptyText: null,
    });
  });
});

describe('TW-CAT-007, 008: the Setup read', () => {
  it('buckets, health score and samples, senders, shops; a workspace with nothing still answers (no connect dead end)', async () => {
    const t = await fresh('over');
    const empty = await api.as(t.admin).get('/v2/catalog/overview');
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({
      catalog: null,
      totalProducts: 0,
      hasSender: false,
      senders: [],
      health: { score: null, total: 0 },
    });

    await device(t);
    // 10 products: 2 without image, 1 with price 0 (a different one), the rest healthy.
    for (let i = 0; i < 7; i++)
      await createProduct(t, `Ok ${i}`, { imageUrl: 'https://cdn.test/a.jpg' });
    await createProduct(t, 'No img A');
    await createProduct(t, 'No img B');
    await createProduct(t, 'No price', { priceMajor: '0', imageUrl: 'https://cdn.test/a.jpg' });
    const res = await api.as(t.admin).get('/v2/catalog/overview');
    expect(res.body.totalProducts).toBe(10);
    expect(res.body.statusBuckets).toEqual({ unsynced: 10 });
    expect(res.body.health).toMatchObject({
      score: 70,
      total: 10,
      noImage: 2,
      noPrice: 1,
      flagged: 3,
    });
    expect(res.body.health.samples).toHaveLength(3);
    expect(res.body.hasSender).toBe(true);
    expect(res.body.senders[0]).toMatchObject({ engine: 'baileys', phone: '919800000001' });
    expect(res.body.senders[0].key).toMatch(/^baileys:[0-9a-f-]{36}$/);
  });

  it('TW-CAT-007 #2: 12 flagged products show only the 8 most recently changed; a failed push counts as unhealthy (intended)', async () => {
    const t = await fresh('health');
    for (let i = 0; i < 12; i++) await createProduct(t, `Flag ${i}`);
    const res = await api.as(t.admin).get('/v2/catalog/overview');
    expect(res.body.health.flagged).toBe(12);
    expect(res.body.health.samples).toHaveLength(8);
    expect(res.body.health.samples[0].name).toBe('Flag 11');
    const t2 = await fresh('health2');
    await createProduct(t2, 'Healthy', { imageUrl: 'https://cdn.test/a.jpg' });
    await h.owner.query(`UPDATE wa_products SET meta_sync_status='failed' WHERE org_id=$1`, [
      t2.orgId,
    ]);
    expect((await api.as(t2.admin).get('/v2/catalog/overview')).body.health).toMatchObject({
      errored: 1,
      flagged: 1,
      score: 0,
    });
  });
});

describe('TW-CAT-009..013: sync', () => {
  it('TW-CAT-009 #1: 3 unsynced active products are pushed in one batch, become pending with handles, hasMore false', async () => {
    const t = await fresh('sync');
    for (const n of ['A', 'B', 'C']) await createProduct(t, `Prod ${n}`, { sku: `S-${n}` });
    await connect(t);
    const res = await api.as(t.admin).post('/v2/catalog/sync').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      pushed: 3,
      hasMore: false,
      totalPending: 3,
      totalSynced: 0,
      totalFailed: 0,
    });
    const rows = (
      await h.owner.query(
        `SELECT meta_sync_status, meta_batch_handle, meta_retailer_id FROM wa_products WHERE org_id=$1 ORDER BY id`,
        [t.orgId],
      )
    ).rows;
    expect(rows.every((r) => r.meta_sync_status === 'pending' && r.meta_batch_handle)).toBe(true);
    expect(rows.map((r) => r.meta_retailer_id)).toEqual(['S-A', 'S-B', 'S-C']);
    const sent = fx.pushed.get('555001')!;
    expect([...sent.keys()].sort()).toEqual(['S-A', 'S-B', 'S-C']);
    expect(sent.get('S-A')).toMatchObject({
      price: 129_950,
      currency: 'INR',
      availability: 'in stock',
    });
  });

  it('TW-CAT-009 #2: Meta rejecting the batch answers 502 with the text and marks every row failed with the truncated message', async () => {
    const t = await fresh('syncfail');
    await createProduct(t, 'One');
    await connect(t);
    const { CatalogProviderError } =
      await import('../../../src/infra/providers/catalog-products/catalog-provider.port');
    fx.failNext.set(
      'upsertProductsBatch',
      new CatalogProviderError('x'.repeat(700), 'meta', {
        code: 100,
        subcode: null,
        httpStatus: 400,
        raw: 'x',
      }),
    );
    const res = await api.as(t.admin).post('/v2/catalog/sync').send({});
    expect(res.status).toBe(502);
    expect(code(res)).toBe('CAT_META_REJECTED');
    expect(res.body.errors).toEqual(
      expect.arrayContaining([{ path: 'pushedFailed', message: '1' }]),
    );
    const row = (
      await h.owner.query(
        `SELECT meta_sync_status, meta_last_error FROM wa_products WHERE org_id=$1`,
        [t.orgId],
      )
    ).rows[0];
    expect(row.meta_sync_status).toBe('failed');
    expect(row.meta_last_error).toHaveLength(500);
  });

  it('TW-CAT-009 #3: an explicit id of a draft pushes nothing and sends nothing to Meta', async () => {
    const t = await fresh('syncdraft');
    await connect(t);
    const draft = await createProduct(t, 'Draft', { status: 'draft' });
    fx.pushed.clear();
    const res = await api
      .as(t.admin)
      .post('/v2/catalog/sync')
      .send({ productIds: [draft.id] });
    expect(res.status).toBe(200);
    expect(res.body.pushed).toBe(0);
    expect(fx.pushed.size).toBe(0);
  });

  it('TW-CAT-009 #4: with no catalog every Meta action answers 422 CAT_NOT_CONNECTED', async () => {
    const t = await fresh('syncnone');
    for (const path of ['sync', 'import', 'poll']) {
      const res = await api.as(t.admin).post(`/v2/catalog/${path}`).send({});
      expect(res.status, path).toBe(422);
      expect(code(res), path).toBe('CAT_NOT_CONNECTED');
    }
  });

  it('TW-CAT-009 #5 (fixed): 1,001 never-synced products finish in two chunks instead of looping', async () => {
    const t = await fresh('sync1k');
    await connect(t);
    await h.owner.query(
      `INSERT INTO wa_products (org_id, name, slug, price_minor) SELECT $1, 'P'||g, 'p-'||g, 100 FROM generate_series(1,1001) g`,
      [t.orgId],
    );
    const first = await api.as(t.admin).post('/v2/catalog/sync').send({});
    expect(first.body).toMatchObject({ pushed: 1000, hasMore: true, totalPending: 1000 });
    const second = await api.as(t.admin).post('/v2/catalog/sync').send({});
    expect(second.body).toMatchObject({ pushed: 1, hasMore: false, totalPending: 1001 });
    const third = await api.as(t.admin).post('/v2/catalog/sync').send({});
    expect(third.body.pushed).toBe(0);
  }, 60_000);

  it('TW-CAT-010: poll flips finished to synced (handle cleared) and errored to failed (handle kept, message stored); in progress stays pending; nothing pending does not call Meta', async () => {
    const t = await fresh('poll');
    expect((await connect(t)).status).toBe(200);
    expect((await api.as(t.admin).post('/v2/catalog/poll').send({})).body).toEqual({
      pending: 0,
      synced: 0,
      failed: 0,
    });
    for (const n of ['A', 'B', 'C']) await createProduct(t, `Poll ${n}`, { sku: `P-${n}` });
    const handles = (
      await h.owner.query(
        `SELECT sku, meta_batch_handle FROM wa_products WHERE org_id=$1 ORDER BY id`,
        [t.orgId],
      )
    ).rows;
    fx.erroredHandles.set(handles[1].meta_batch_handle, 'Price is invalid');
    fx.inProgressHandles.add(handles[2].meta_batch_handle);
    const res = await api.as(t.admin).post('/v2/catalog/poll').send({});
    expect(res.body).toEqual({ pending: 1, synced: 1, failed: 1 });
    const rows = (
      await h.owner.query(
        `SELECT sku, meta_sync_status, meta_batch_handle, meta_last_error FROM wa_products WHERE org_id=$1 ORDER BY id`,
        [t.orgId],
      )
    ).rows;
    expect(rows[0]).toMatchObject({ meta_sync_status: 'synced', meta_batch_handle: null });
    expect(rows[1]).toMatchObject({
      meta_sync_status: 'failed',
      meta_last_error: 'Price is invalid',
    });
    expect(rows[1].meta_batch_handle).toBeTruthy();
    expect(rows[2].meta_sync_status).toBe('pending');
  });

  it('TW-CAT-011: import creates and updates by retailer id with the right price, skips rows without a name, keeps a currency Meta did not send', async () => {
    const t = await fresh('imp');
    await connect(t);
    await createProduct(t, 'Existing', { sku: 'R2', currencyCode: 'USD' });
    fx.pushed.clear();
    fx.metaProducts.set('555001', [
      {
        metaId: '1',
        retailerId: 'R1',
        name: 'Batik',
        description: null,
        price: 'Rp33.900.000',
        currency: 'IDR',
        availability: 'in stock',
        imageUrl: 'https://i/b.jpg',
        url: 'https://s/b',
      },
      {
        metaId: '2',
        retailerId: 'R2',
        name: 'Existing renamed',
        description: 'd',
        price: '1,234.56',
        currency: null,
        availability: 'out of stock',
        imageUrl: null,
        url: null,
      },
      {
        metaId: '3',
        retailerId: 'R3',
        name: '',
        description: null,
        price: 1,
        currency: 'USD',
        availability: null,
        imageUrl: null,
        url: null,
      },
      {
        metaId: '4',
        retailerId: 'R4',
        name: 'Odd',
        description: null,
        price: null,
        currency: 'USD',
        availability: 'preorder',
        imageUrl: null,
        url: null,
      },
    ]);
    await h.owner.query(`UPDATE wa_products SET meta_retailer_id='R2' WHERE org_id=$1`, [t.orgId]);
    const res = await api.as(t.admin).post('/v2/catalog/import').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ imported: 2, updated: 1, skipped: 1, total: 4 });
    const q = async (rid: string) =>
      (
        await h.owner.query(`SELECT * FROM wa_products WHERE org_id=$1 AND meta_retailer_id=$2`, [
          t.orgId,
          rid,
        ])
      ).rows[0];
    expect(await q('R1')).toMatchObject({
      price_minor: 3390000000,
      currency_code: 'IDR',
      meta_sync_status: 'synced',
      sku: 'R1',
      in_stock: true,
      slug: 'batik',
    });
    const r2 = await q('R2');
    expect(r2).toMatchObject({
      price_minor: 123456,
      currency_code: 'USD',
      name: 'Existing renamed',
      in_stock: false,
      availability: 'out of stock',
    });
    expect(await q('R4')).toMatchObject({ price_minor: 0, availability: 'available for order' });
    expect(fx.pushed.size).toBe(0); // an import never re-pushes what it read
  });

  it('TW-CAT-012: a create pushes (pending), a price change pushes again, a sort order change does not, a draft is never pushed; Meta down fails the push but not the save', async () => {
    const t = await fresh('auto');
    await connect(t);
    const p = await createProduct(t, 'Auto', { sku: 'AUTO-1' });
    expect(p.metaSyncStatus).toBe('pending');
    expect((await api.as(t.admin).get('/v2/catalog/overview')).status).toBe(200);
    const batches = () => fx.batches.length;
    const body = (over: Record<string, unknown>, v: number) => ({
      ...product('Auto', { sku: 'AUTO-1' }),
      rowVersion: v,
      ...over,
    });
    const before = batches();
    const sort = await api
      .as(t.admin)
      .put(`/v2/catalog/products/${p.id}`)
      .send(body({ sortOrder: 5 }, p.rowVersion));
    expect(sort.status, JSON.stringify(sort.body)).toBe(200);
    expect(batches()).toBe(before);
    const price = await api
      .as(t.admin)
      .put(`/v2/catalog/products/${p.id}`)
      .send(body({ priceMajor: '10' }, sort.body.rowVersion));
    expect(price.body.metaSyncStatus).toBe('pending');
    expect(batches()).toBe(before + 1);
    const draft = await createProduct(t, 'Draft one', { status: 'draft' });
    expect(draft.metaSyncStatus).toBeNull();

    const { CatalogProviderError } =
      await import('../../../src/infra/providers/catalog-products/catalog-provider.port');
    fx.failNext.set('upsertProductsBatch', new CatalogProviderError('Meta unreachable', 'network'));
    const down = await createProduct(t, 'During outage');
    expect(down.metaSyncStatus).toBe('failed');
    expect(down.metaLastError).toContain('Meta unreachable');
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int n FROM wa_products WHERE org_id=$1 AND name='During outage'`,
          [t.orgId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect((await api.events(t.orgId, 'catalog.product_changed')).length).toBeGreaterThanOrEqual(3);
  });

  it('TW-CAT-013: the sweep pushes the dirty products of one organization, settles pending ones, runs the others even when one fails; poll-only makes no push', async () => {
    const a = await fresh('sweepa');
    const b = await api.signup('sweepb');
    await connect(a);
    await connect(b, { catalogId: 'bad-sweep' }).catch(() => undefined);
    // Organization b gets a catalog row directly so only its Meta call fails.
    await h.owner.query(
      `INSERT INTO wa_catalogs (org_id, provider, catalog_id, access_token_enc) SELECT $1,'meta_cloud','bad-sweep', access_token_enc FROM wa_catalogs WHERE org_id=$2`,
      [b.orgId, a.orgId],
    );
    await h.owner.query(
      `INSERT INTO wa_products (org_id, name, slug, price_minor) VALUES ($1,'A1','a1',1),($1,'A2','a2',1),($1,'A3','a3',1),($1,'A4','a4',1),($1,'A5','a5',1)`,
      [a.orgId],
    );
    await h.owner.query(
      `INSERT INTO wa_products (org_id, name, slug, price_minor) VALUES ($1,'B1','b1',1)`,
      [b.orgId],
    );
    const { CatalogSyncService } =
      await import('../../../src/modules/catalog-products/catalog-sync.service');
    const { CatalogsRepository } =
      await import('../../../src/modules/catalog-products/catalogs.repository');
    const sweep = new CatalogResyncSweepService(
      h.app.get(DatabaseService, { strict: false }),
      h.app.get(CatalogsRepository, { strict: false }),
      h.app.get(CatalogSyncService, { strict: false }),
    );
    const pollOnly = await sweep.sweep({ orgId: a.orgId, pollOnly: true });
    expect(pollOnly).toMatchObject({ catalogs: 1, pushed: 0 });
    expect(fx.pushed.size).toBe(0);
    const only = await sweep.sweep({ orgId: a.orgId });
    // One pass pushes the dirty rows and settles them (the fixture finishes every batch).
    expect(only).toMatchObject({ catalogs: 1, pushed: 5, synced: 5, errors: 0 });
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int n FROM wa_products WHERE org_id=$1 AND meta_sync_status='synced'`,
          [a.orgId],
        )
      ).rows[0].n,
    ).toBe(5);
    const all = await sweep.sweep();
    expect(all.errors).toBeGreaterThanOrEqual(1); // b is refused, the others still run
    expect(
      (await h.owner.query(`SELECT meta_sync_status FROM wa_products WHERE org_id=$1`, [b.orgId]))
        .rows[0].meta_sync_status,
    ).toBe('failed');
  });
});

describe('TW-CAT-014..016: send and activity', () => {
  async function ready(label: string) {
    const t = await fresh(label);
    await connect(t);
    const [p1, p2] = [
      await createProduct(t, 'Shirt', { sku: 'SH', category: 'Tops', imageUrl: 'https://i/s.jpg' }),
      await createProduct(t, 'Jeans', { sku: 'JE' }),
    ];
    return { t, p1, p2 };
  }

  it('TW-CAT-015 #1: pasted numbers are de-duplicated (a duplicate, a 6-digit one dropped); mode link needs no products', async () => {
    const { t } = await ready('sendlink');
    const res = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: '919800000001\n+919800000001; 123456, 447700900123', mode: 'link' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ ok: true, sent: 2, failed: 0, total: 2, errors: [] });
    expect(fx.sent.map((s) => s.kind)).toEqual(['link', 'link']);
    expect(
      (fx.sent[0]!.payload.body as string).startsWith('Check out our catalog: https://wa.me/c/'),
    ).toBe(true);
  });

  it('TW-CAT-015 #2..#3: 501 recipients is 422 CAT_TOO_MANY_RECIPIENTS, none is CAT_NO_RECIPIENTS, mpm without products is CAT_NO_PRODUCTS, and nothing is sent', async () => {
    const { t } = await ready('sendrules');
    const many = Array.from({ length: 501 }, (_, i) => `91${String(9000000000 + i)}`).join(',');
    const tooMany = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: many, mode: 'link' });
    expect(tooMany.status).toBe(422);
    expect(code(tooMany)).toBe('CAT_TOO_MANY_RECIPIENTS');
    expect(code(await api.as(t.admin).post('/v2/catalog/send').send({ mode: 'link' }))).toBe(
      'CAT_NO_RECIPIENTS',
    );
    const noProducts = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: '919800000001', mode: 'mpm' });
    expect(noProducts.status).toBe(422);
    expect(code(noProducts)).toBe('CAT_NO_PRODUCTS');
    expect(fx.sent).toHaveLength(0);
  });

  it('TW-CAT-015 #5: Meta rejecting one of two recipients gives sent 1, failed 1, ok true and one error naming the number; both attempts are logged and audited', async () => {
    const { t, p1 } = await ready('sendpartial');
    fx.rejectRecipients.add('919800000002');
    const res = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({
        manualNumbers: '919800000001 919800000002',
        mode: 'spm',
        productIds: [p1.id],
        body: 'Look',
      });
    expect(res.body).toMatchObject({ ok: true, sent: 1, failed: 1, total: 2 });
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toContain('919800000002: ');
    expect(res.body.errors[0]).toContain('131047');
    const rows = (
      await h.owner.query(
        `SELECT recipient, status, mode FROM cat_catalog_sends WHERE org_id=$1 ORDER BY recipient`,
        [t.orgId],
      )
    ).rows;
    expect(rows).toEqual([
      { recipient: '919800000001', status: 'sent', mode: 'spm' },
      { recipient: '919800000002', status: 'failed', mode: 'spm' },
    ]);
    expect(await api.auditCount(t.orgId, 'catalog_sends', 'insert')).toBe(2);
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id=$1 AND module='catalog_sends'`,
      [t.orgId],
    );
    expect(JSON.stringify(audit.rows)).not.toContain('919800000001');
  });

  it('TW-CAT-015: all recipients failing is still HTTP 200 with ok false; SPM sends the first product only; MPM groups by category', async () => {
    const { t, p1, p2 } = await ready('sendall');
    fx.rejectRecipients.add('919800000001');
    const bad = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: '919800000001', mode: 'link' });
    expect(bad.status).toBe(200);
    expect(bad.body).toMatchObject({ ok: false, sent: 0, failed: 1 });
    fx.reset();
    await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: '919800000003', mode: 'spm', productIds: [p2.id, p1.id] });
    expect(fx.sent[0]).toMatchObject({ kind: 'spm', payload: { retailerId: 'JE' } });
    await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({
        manualNumbers: '919800000003',
        mode: 'mpm',
        productIds: [p1.id, p2.id],
        header: 'Sale',
      });
    expect(fx.sent[1]).toMatchObject({
      kind: 'mpm',
      payload: {
        header: 'Sale',
        sections: [
          { title: 'Tops', productRetailerIds: ['SH'] },
          { title: 'Featured', productRetailerIds: ['JE'] },
        ],
      },
    });
  });

  it('TW-CAT-015 #4/#7: without a Meta catalog a carousel goes through the connected device; with none, CAT_NO_SENDER; a link needs a shop (CAT_NO_SHOP)', async () => {
    const t = await fresh('sendbaileys');
    const p = await createProduct(t, 'Mug', { sku: 'MUG' });
    const noDevice = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: '919800000001', mode: 'spm', productIds: [p.id] });
    expect(noDevice.status).toBe(422);
    expect(code(noDevice)).toBe('CAT_NO_SENDER');
    await device(t);
    const res = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: '919800000001', mode: 'mpm', productIds: [p.id] });
    expect(res.body).toMatchObject({ ok: true, sent: 1 });
    expect(fx.sent[0]).toMatchObject({ via: 'baileys', kind: 'carousel' });
    expect(
      (fx.sent[0]!.payload as { cards: Array<{ retailer_id: string }> }).cards[0]!.retailer_id,
    ).toBe('MUG');
    const link = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: '919800000001', mode: 'link' });
    expect(link.status).toBe(422);
    expect(code(link)).toBe('CAT_NO_SHOP');
    await h.owner.query(
      `INSERT INTO wa_storefronts (org_id, shop_name, slug) VALUES ($1,'Shop',$2)`,
      [t.orgId, `shop-${t.orgId}`],
    );
    const ok = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: '919800000001', mode: 'link', body: 'Browse:' });
    expect(ok.body.sent).toBe(1);
    expect((fx.sent.at(-1)!.payload as { text: string }).text).toContain(`/s/shop-${t.orgId}`);
  });

  it("TW-CAT-015: contact and group recipients are expanded server side, de-duplicated with pasted numbers, and only this workspace's are used", async () => {
    const { t, p1 } = await ready('sendaud');
    const other = await fresh('sendaudother');
    const [c1, c2] = await api.seedContacts(t, [
      { name: 'Asha', phone: '+91 98000 00010' },
      { name: 'Ben', phone: '919800000011' },
    ]);
    const [foreign] = await api.seedContacts(other, [{ name: 'Foreign', phone: '919800000099' }]);
    const g = await h.owner.query(
      `INSERT INTO contact_groups (org_id, name) VALUES ($1,'VIPs') RETURNING id, uuid`,
      [t.orgId],
    );
    const ids = await h.owner.query(`SELECT id FROM contacts WHERE org_id=$1 AND uuid = $2`, [
      t.orgId,
      c2,
    ]);
    await h.owner.query(
      `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$3)`,
      [t.orgId, ids.rows[0].id, g.rows[0].id],
    );
    const options = await api.as(t.admin).get('/v2/catalog/send-options');
    expect(options.body.groups).toEqual([{ id: g.rows[0].uuid, name: 'VIPs', count: 1 }]);
    expect(options.body.contacts.map((c: { name: string }) => c.name).sort()).toEqual([
      'Asha',
      'Ben',
    ]);
    expect(
      (await api.as(t.admin).get('/v2/catalog/send-options?q=ash')).body.contacts,
    ).toHaveLength(1);
    const res = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({
        contactIds: [c1, foreign],
        groupIds: [g.rows[0].uuid],
        manualNumbers: '919800000011',
        mode: 'spm',
        productIds: [p1.id],
      });
    expect(res.body).toMatchObject({ sent: 2, total: 2 });
    expect(fx.sent.map((s) => s.to).sort()).toEqual(['919800000011', '919800000010'].sort());
  });

  it("TW-CAT-016: the activity lists the sends newest first, 50 by default, sent and failed, and never another workspace's", async () => {
    const { t, p1 } = await ready('act');
    expect((await api.as(t.admin).get('/v2/catalog/activity')).body).toEqual({ data: [] });
    await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: '919800000001', mode: 'spm', productIds: [p1.id], body: 'first' });
    fx.rejectRecipients.add('919800000002');
    await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: '919800000002', mode: 'link' });
    const res = await api.as(t.admin).get('/v2/catalog/activity');
    expect(res.body.data.map((r: { recipient: string }) => r.recipient)).toEqual([
      '919800000002',
      '919800000001',
    ]);
    expect(res.body.data[1]).toMatchObject({
      mode: 'spm',
      status: 'sent',
      body: 'first',
      productCount: 1,
      productNames: ['Shirt'],
      sentBy: 'Admin Person',
    });
    expect(res.body.data[0]).toMatchObject({ status: 'failed' });
    const other = await fresh('actother');
    expect((await api.as(other.admin).get('/v2/catalog/activity')).body.data).toEqual([]);
    await h.owner.query(
      `INSERT INTO cat_catalog_sends (org_id, recipient, mode, status) SELECT $1, 'x'||g, 'link', 'sent' FROM generate_series(1,60) g`,
      [t.orgId],
    );
    expect((await api.as(t.admin).get('/v2/catalog/activity')).body.data).toHaveLength(50);
    expect((await api.as(t.admin).get('/v2/catalog/activity?limit=5')).body.data).toHaveLength(5);
  });

  it('send needs cat.catalog.send; a member with only manage cannot send', async () => {
    const { t } = await ready('sendperm');
    const m = await api.member(t, 'manager', [['cat.catalog.manage']]);
    expect(
      (
        await api
          .as(m.token)
          .post('/v2/catalog/send')
          .send({ manualNumbers: '919800000001', mode: 'link' })
      ).status,
    ).toBe(403);
  });
});

describe('TW-CAT-017, 018: collections', () => {
  it('create keeps the submitted order and a unique slug; foreign ids are dropped; only foreign ids is 422; 31 ids is refused', async () => {
    const t = await fresh('col');
    const other = await api.signup('colother');
    const ids: string[] = [];
    for (const n of ['A', 'B', 'C']) ids.push((await createProduct(t, `Item ${n}`)).id);
    const foreign = (await createProduct(other, 'Foreign')).id;
    const first = await api
      .as(t.admin)
      .post('/v2/catalog/collections')
      .send({ name: 'Summer Sale', productIds: [ids[2], ids[0], ids[1]] });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.slug).toBe('summer-sale');
    expect(first.body.products.map((p: { name: string }) => p.name)).toEqual([
      'Item C',
      'Item A',
      'Item B',
    ]);
    const stored = (
      await h.owner.query(`SELECT product_ids FROM wa_product_sets WHERE org_id=$1`, [t.orgId])
    ).rows[0].product_ids;
    expect(stored).toHaveLength(3);
    const second = await api
      .as(t.admin)
      .post('/v2/catalog/collections')
      .send({ name: 'Summer Sale', productIds: [ids[0], foreign] });
    expect(second.body.slug).toBe('summer-sale-2');
    expect(second.body.productCount).toBe(1);
    const none = await api
      .as(t.admin)
      .post('/v2/catalog/collections')
      .send({ name: 'Nope', productIds: [foreign] });
    expect(none.status).toBe(422);
    expect(code(none)).toBe('CAT_COLLECTION_PRODUCTS_INVALID');
    const many = Array.from({ length: 31 }, () => ids[0]);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/catalog/collections')
          .send({ name: 'Big', productIds: many })
      ).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/catalog/collections')
          .send({ name: 'Empty', productIds: [] })
      ).status,
    ).toBe(422);
  });

  it('update regenerates the slug only when the name changed; rowVersion guards; delete is idempotent and leaves the products; a draft member stays but is inactive', async () => {
    const t = await fresh('colupd');
    const a = await createProduct(t, 'Alpha');
    const b = await createProduct(t, 'Beta', { status: 'draft' });
    const created = await api
      .as(t.admin)
      .post('/v2/catalog/collections')
      .send({ name: 'Set One', productIds: [a.id, b.id] });
    expect(created.body.products.map((p: { active: boolean }) => p.active)).toEqual([true, false]);
    const sameName = await api
      .as(t.admin)
      .put(`/v2/catalog/collections/${created.body.id}`)
      .send({ name: 'Set One', description: 'new', productIds: [a.id] });
    expect(sameName.body).toMatchObject({ slug: 'set-one', description: 'new', productCount: 1 });
    const renamed = await api
      .as(t.admin)
      .put(`/v2/catalog/collections/${created.body.id}`)
      .send({ name: 'Set Two', productIds: [a.id] });
    expect(renamed.body.slug).toBe('set-two');
    const stale = await api
      .as(t.admin)
      .put(`/v2/catalog/collections/${created.body.id}`)
      .send({ name: 'Set Two', productIds: [a.id], rowVersion: 1 });
    expect(stale.status).toBe(409);
    expect(
      (
        await api
          .as(t.admin)
          .put(`/v2/catalog/collections/00000000-0000-4000-8000-000000000001`)
          .send({ name: 'x', productIds: [a.id] })
      ).status,
    ).toBe(404);
    const list = await api.as(t.admin).get('/v2/catalog/collections');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.pickProducts.map((p: { name: string }) => p.name)).toEqual(['Alpha']);
    expect(list.body.totalProducts).toBe(2);
    expect(
      (await api.as(t.admin).delete(`/v2/catalog/collections/${created.body.id}`)).status,
    ).toBe(204);
    expect(
      (await api.as(t.admin).delete(`/v2/catalog/collections/${created.body.id}`)).status,
    ).toBe(204);
    expect(
      (await h.owner.query(`SELECT count(*)::int n FROM wa_products WHERE org_id=$1`, [t.orgId]))
        .rows[0].n,
    ).toBe(2);
  });

  it('collections are tenant isolated and need their own key; the same Idempotency-Key creates one collection', async () => {
    const t = await fresh('colperm');
    const other = await api.signup('colpermother');
    const p = await createProduct(t, 'Only');
    const key = `col-${Date.now()}`;
    const one = await api
      .as(t.admin)
      .post('/v2/catalog/collections')
      .set('Idempotency-Key', key)
      .send({ name: 'Once', productIds: [p.id] });
    const two = await api
      .as(t.admin)
      .post('/v2/catalog/collections')
      .set('Idempotency-Key', key)
      .send({ name: 'Once', productIds: [p.id] });
    expect(two.body.id).toBe(one.body.id);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int n FROM wa_product_sets WHERE org_id=$1`, [
          t.orgId,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect((await api.as(other.admin).get('/v2/catalog/collections')).body.data).toEqual([]);
    expect(
      (await api.as(other.admin).delete(`/v2/catalog/collections/${one.body.id}`)).status,
    ).toBe(204);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int n FROM wa_product_sets WHERE org_id=$1`, [
          t.orgId,
        ])
      ).rows[0].n,
    ).toBe(1);
    const reader = await api.member(t, 'colreader', [['cat.catalog.read']]);
    expect((await api.as(reader.token).get('/v2/catalog/collections')).status).toBe(200);
    expect(
      (
        await api
          .as(reader.token)
          .post('/v2/catalog/collections')
          .send({ name: 'x', productIds: [p.id] })
      ).status,
    ).toBe(403);
  });
});

describe('TW-CAT-019..024, 026: products', () => {
  it('TW-CAT-020: create stores price x100, a unique slug per workspace, tags and gallery normalised; the response carries the readable forms', async () => {
    const t = await fresh('prod');
    const a = await api
      .as(t.admin)
      .post('/v2/catalog/products')
      .send(
        product('Spring Tee', {
          tags: [' a ', 'b', 'a', ''],
          galleryUrls: ['https://x/1', '', 'https://x/1'],
          comparePriceMajor: '1999',
          sku: ' SKU-1 ',
          description: '',
        }),
      );
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body).toMatchObject({
      slug: 'spring-tee',
      priceMinor: 129_950,
      priceMajor: '1299.5',
      priceDisplay: '₹ 1,299.50',
      comparePriceMinor: 199_900,
      onSale: true,
      tags: ['a', 'b'],
      galleryUrls: ['https://x/1'],
      sku: 'SKU-1',
      description: null,
      retailerId: 'SKU-1',
      status: 'active',
      inStock: true,
      availability: 'in stock',
      metaSyncStatus: null,
    });
    expect(a.body.id).toMatch(uuidRe);
    const b = await createProduct(t, 'Spring Tee');
    expect(b.slug).toBe('spring-tee-2');
    const zero = await createProduct(t, '夏のセール', { comparePriceMajor: '0' });
    expect(zero.slug).toBe('product');
    expect(
      (await api.as(t.admin).get(`/v2/catalog/products/${zero.id}`)).body.comparePriceMinor,
    ).toBeNull();
    expect(b.retailerId).toMatch(/^wsn-\d+$/);
    expect(await api.auditCount(t.orgId, 'products', 'insert')).toBe(3);
    expect((await api.events(t.orgId, 'product.created')).length).toBe(3);
  });

  it('TW-CAT-020: validation follows the form (name required, currency in the list, price 0..1,000,000, status, gallery up to 12)', async () => {
    const t = await fresh('prodval');
    const post = (b: Record<string, unknown>) =>
      api.as(t.admin).post('/v2/catalog/products').send(b);
    expect((await post({ priceMajor: '1', currencyCode: 'INR' })).status).toBe(422);
    expect((await post(product('x', { currencyCode: 'JPY' }))).status).toBe(422);
    expect((await post(product('x', { priceMajor: '1000001' }))).status).toBe(422);
    expect((await post(product('x', { priceMajor: '-1' }))).status).toBe(422);
    expect((await post(product('x', { status: 'gone' }))).status).toBe(422);
    expect((await post(product('x', { stockQty: -1 }))).status).toBe(422);
    expect(
      (
        await post(
          product('x', { galleryUrls: Array.from({ length: 13 }, (_, i) => `https://x/${i}`) }),
        )
      ).status,
    ).toBe(422);
    expect((await post(product('x', { imageUrl: 'not a url' }))).status).toBe(422);
    expect((await post(product('x', { priceMajor: '0' }))).status).toBe(201);
  });

  it('TW-CAT-020: update needs the row version (409 when stale), keeps the slug, writes an audit delta and no-ops when nothing changed', async () => {
    const t = await fresh('produpd');
    const p = await createProduct(t, 'Old name');
    const body = (over: Record<string, unknown>, v: number) => ({
      ...product('Old name'),
      rowVersion: v,
      ...over,
    });
    const renamed = await api
      .as(t.admin)
      .put(`/v2/catalog/products/${p.id}`)
      .send(body({ name: 'New name', stockQty: 4, aliases: ['Naya', ' naya '] }, p.rowVersion));
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body).toMatchObject({
      name: 'New name',
      slug: 'old-name',
      stockQty: 4,
      availableQty: 4,
      aliases: ['naya'],
    });
    const stale = await api
      .as(t.admin)
      .put(`/v2/catalog/products/${p.id}`)
      .send(body({ name: 'X' }, p.rowVersion));
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    const same = await api
      .as(t.admin)
      .put(`/v2/catalog/products/${p.id}`)
      .send(body({ name: 'New name', stockQty: 4, aliases: ['naya'] }, renamed.body.rowVersion));
    expect(same.body.rowVersion).toBe(renamed.body.rowVersion);
    const delta = (
      await h.owner.query(
        `SELECT delta FROM audit_log WHERE org_id=$1 AND module='products' AND action='update'`,
        [t.orgId],
      )
    ).rows;
    expect(delta).toHaveLength(1);
    expect(delta[0].delta.name).toEqual({ old: 'Old name', new: 'New name' });
    expect(
      (
        await api
          .as(t.admin)
          .put(`/v2/catalog/products/00000000-0000-4000-8000-000000000001`)
          .send(body({}, 1))
      ).status,
    ).toBe(404);
  });

  it("TW-CAT-019: the list pages by cursor in Reference's order (sort order, then newest), searches name and SKU, counts on request, and is tenant isolated", async () => {
    const t = await fresh('prodlist');
    const other = await api.signup('prodlistother');
    await createProduct(other, 'Zebra secret', { sku: 'ZEB' });
    for (let i = 1; i <= 5; i++)
      await createProduct(t, `Item ${i}`, { sku: `SKU-${i}`, sortOrder: i === 3 ? 0 : 10 });
    const p1 = await api.as(t.admin).get('/v2/catalog/products?limit=2&includeTotal=true');
    expect(p1.body.data.map((p: { name: string }) => p.name)).toEqual(['Item 3', 'Item 5']);
    expect(p1.body.page).toMatchObject({ hasMore: true, limit: 2 });
    expect(p1.body.meta).toEqual({ total: 5 });
    const p2 = await api
      .as(t.admin)
      .get(`/v2/catalog/products?limit=2&cursor=${p1.body.page.nextCursor}`);
    expect(p2.body.data.map((p: { name: string }) => p.name)).toEqual(['Item 4', 'Item 2']);
    expect(p2.body.meta).toBeUndefined();
    const p3 = await api
      .as(t.admin)
      .get(`/v2/catalog/products?limit=2&cursor=${p2.body.page.nextCursor}`);
    expect(p3.body.data.map((p: { name: string }) => p.name)).toEqual(['Item 1']);
    expect(p3.body.page).toMatchObject({ hasMore: false, nextCursor: null });
    expect(
      (await api.as(t.admin).get('/v2/catalog/products?q=sku-4')).body.data.map(
        (p: { name: string }) => p.name,
      ),
    ).toEqual(['Item 4']);
    expect((await api.as(t.admin).get('/v2/catalog/products?q=zeb')).body.data).toEqual([]);
    expect((await api.as(t.admin).get('/v2/catalog/products?cursor=garbage')).status).toBe(400);
    expect((await api.as(t.admin).get('/v2/catalog/products')).body.page.limit).toBe(25);
  });

  it("TW-CAT-021: delete removes the product and its reviews, is audited, and another workspace's product is a 404", async () => {
    const t = await fresh('proddel');
    const other = await api.signup('proddelother');
    const p = await createProduct(t, 'Gone soon');
    const foreign = await createProduct(other, 'Not yours');
    await h.owner.query(
      `INSERT INTO wa_product_reviews (org_id, product_id, customer_name, rating, status) SELECT $1, id, 'Zed', 4, 'pending' FROM wa_products WHERE uuid=$2`,
      [t.orgId, p.id],
    );
    expect((await api.as(t.admin).delete(`/v2/catalog/products/${foreign.id}`)).status).toBe(404);
    expect((await api.as(t.admin).get(`/v2/catalog/products/${foreign.id}`)).status).toBe(404);
    expect((await api.as(t.admin).delete(`/v2/catalog/products/${p.id}`)).status).toBe(204);
    expect(
      (await h.owner.query(`SELECT count(*)::int n FROM wa_products WHERE org_id=$1`, [t.orgId]))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int n FROM wa_product_reviews WHERE org_id=$1`, [
          t.orgId,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(await api.auditCount(t.orgId, 'products', 'delete')).toBe(1);
    expect((await api.as(t.admin).delete(`/v2/catalog/products/${p.id}`)).status).toBe(404);
    const member = await api.member(t, 'noDelete', [
      ['cat.products.read'],
      ['cat.products.update'],
    ]);
    expect((await api.as(member.token).delete(`/v2/catalog/products/${foreign.id}`)).status).toBe(
      403,
    );
  });

  it('TW-CAT-022: share links give the shop product page and a wa.me link with the order text; null without a shop or number', async () => {
    const t = await fresh('share');
    const p = await createProduct(t, 'Linkable', { imageUrl: 'https://i/x.jpg' });
    expect(
      (await api.as(t.admin).get(`/v2/catalog/products/${p.id}/share-links`)).body,
    ).toMatchObject({
      publicUrl: null,
      waLink: null,
      product: { id: p.id, name: 'Linkable', image: 'https://i/x.jpg' },
    });
    await h.owner.query(`INSERT INTO wa_storefronts (org_id, shop_name, slug) VALUES ($1,'S',$2)`, [
      t.orgId,
      `sh-${t.orgId}`,
    ]);
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, is_primary) VALUES ($1,'waba','connected','+91 98000 00000',true)`,
      [t.orgId],
    );
    const res = await api.as(t.admin).get(`/v2/catalog/products/${p.id}/share-links`);
    expect(res.body.publicUrl).toMatch(new RegExp(`/s/sh-${t.orgId}/p/linkable$`));
    expect(res.body.waLink.startsWith('https://wa.me/919800000000?text=')).toBe(true);
    expect(decodeURIComponent(res.body.waLink.split('text=')[1])).toBe(
      'Hi! I want to order:\n\n*Linkable* — ₹ 1,299.50\nhttps://i/x.jpg\n\nQty: 1',
    );
  });

  it('TW-CAT-023: send one product needs a number of 7+ digits and a connected device, sends the image with a caption, and reports a refusal as 502', async () => {
    const t = await fresh('prodsend');
    const p = await createProduct(t, 'Gift', { imageUrl: 'https://i/g.jpg', description: 'Nice' });
    const send = (phone: string) =>
      api.as(t.admin).post(`/v2/catalog/products/${p.id}/send`).send({ phone });
    const short = await send('12345');
    expect(short.status).toBe(422);
    expect(code(short)).toBe('VALIDATION_FAILED');
    const none = await send('919800000005');
    expect(none.status).toBe(422);
    expect(code(none)).toBe('CAT_NO_SENDER');
    await device(t);
    const ok = await send('+91 98000 00005');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ message: 'Product sent to 919800000005.' });
    expect(fx.sent[0]).toMatchObject({
      via: 'baileys',
      kind: 'image',
      to: '919800000005',
      payload: { imageUrl: 'https://i/g.jpg' },
    });
    expect(String(fx.sent[0]!.payload.caption)).toContain('*Gift* — ₹ 1,299.50\n\nNice');
    const { CatalogProviderError } =
      await import('../../../src/infra/providers/catalog-products/catalog-provider.port');
    fx.failNext.set(
      'sendBridgeImage',
      new CatalogProviderError('Baileys image send failed: closed', 'meta', {
        code: 500,
        subcode: null,
        httpStatus: 500,
        raw: 'session closed',
      }),
    );
    const refused = await send('919800000005');
    expect(refused.status).toBe(502);
    expect(code(refused)).toBe('CAT_SEND_FAILED');
    expect(
      (
        await h.owner.query(`SELECT count(*)::int n FROM cat_catalog_sends WHERE org_id=$1`, [
          t.orgId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('TW-CAT-024: the picker lists only active, in-stock products (120 at most), filters by name or SKU, and a shop keeps its own plus the shared ones', async () => {
    const t = await fresh('picker');
    await createProduct(t, 'Visible', { sku: 'VIS', category: 'Cat' });
    await createProduct(t, 'Draft', { status: 'draft' });
    await createProduct(t, 'Sold out', { inStock: false });
    const shop = await h.owner.query(
      `INSERT INTO wa_storefronts (org_id, shop_name, slug) VALUES ($1,'S',$2) RETURNING id, uuid`,
      [t.orgId, `pk-${t.orgId}`],
    );
    const mine = await createProduct(t, 'In shop');
    await h.owner.query(`UPDATE wa_products SET storefront_id=$2 WHERE org_id=$1 AND uuid=$3`, [
      t.orgId,
      shop.rows[0].id,
      mine.id,
    ]);
    const otherShop = await h.owner.query(
      `INSERT INTO wa_storefronts (org_id, shop_name, slug) VALUES ($1,'S2',$2) RETURNING id, uuid`,
      [t.orgId, `pk2-${t.orgId}`],
    );
    const theirs = await createProduct(t, 'Elsewhere');
    await h.owner.query(`UPDATE wa_products SET storefront_id=$2 WHERE org_id=$1 AND uuid=$3`, [
      t.orgId,
      otherShop.rows[0].id,
      theirs.id,
    ]);
    const all = await api.as(t.admin).get('/v2/catalog/products/picker');
    expect(all.body.products.map((p: { name: string }) => p.name).sort()).toEqual([
      'Elsewhere',
      'In shop',
      'Visible',
    ]);
    expect(all.body.products.find((p: { name: string }) => p.name === 'Visible')).toMatchObject({
      sku: 'VIS',
      retailerId: 'VIS',
      priceDisplay: '₹ 1,299.50',
      currency: 'INR',
      synced: false,
      storefrontId: null,
    });
    const filtered = await api
      .as(t.admin)
      .get(`/v2/catalog/products/picker?shopId=${shop.rows[0].uuid}`);
    expect(filtered.body.products.map((p: { name: string }) => p.name).sort()).toEqual([
      'In shop',
      'Visible',
    ]);
    expect(
      (await api.as(t.admin).get('/v2/catalog/products/picker?q=vis')).body.products,
    ).toHaveLength(1);
    await h.owner.query(
      `INSERT INTO wa_products (org_id, name, slug, price_minor) SELECT $1, 'Bulk '||g, 'bulk-'||g, 1 FROM generate_series(1,150) g`,
      [t.orgId],
    );
    expect((await api.as(t.admin).get('/v2/catalog/products/picker')).body.products).toHaveLength(
      120,
    );
  });
});

describe('TW-CAT-027: review moderation', () => {
  it('lists one status at a time with the three counts, newest first with a cursor; moderates, deletes silently when missing; isolated and permission-gated', async () => {
    const t = await fresh('rev');
    const other = await api.signup('revother');
    const p = await createProduct(t, 'Reviewed');
    const pid = (await h.owner.query(`SELECT id FROM wa_products WHERE uuid=$1`, [p.id])).rows[0]
      .id;
    for (let i = 1; i <= 3; i++) {
      await h.owner.query(
        `INSERT INTO wa_product_reviews (org_id, product_id, customer_name, rating, body, status) VALUES ($1,$2,$3,$4,$5,'pending')`,
        [t.orgId, pid, `Cust ${i}`, i + 2, `body ${i}`],
      );
    }
    await h.owner.query(
      `INSERT INTO wa_product_reviews (org_id, product_id, customer_name, rating, status) VALUES ($1,$2,'Done',5,'approved')`,
      [t.orgId, pid],
    );
    const foreignP = await createProduct(other, 'Other product');
    await h.owner.query(
      `INSERT INTO wa_product_reviews (org_id, product_id, customer_name, rating, status) SELECT $1, id, 'Spy', 1, 'pending' FROM wa_products WHERE uuid=$2`,
      [other.orgId, foreignP.id],
    );

    const page1 = await api.as(t.admin).get('/v2/catalog/reviews?limit=2');
    expect(page1.body.data.map((r: { customerName: string }) => r.customerName)).toEqual([
      'Cust 3',
      'Cust 2',
    ]);
    expect(page1.body.meta.counts).toEqual({ pending: 3, approved: 1, rejected: 0 });
    expect(page1.body.data[0].product).toMatchObject({
      id: p.id,
      name: 'Reviewed',
      slug: 'reviewed',
    });
    const page2 = await api
      .as(t.admin)
      .get(`/v2/catalog/reviews?limit=2&cursor=${page1.body.page.nextCursor}`);
    expect(page2.body.data.map((r: { customerName: string }) => r.customerName)).toEqual([
      'Cust 1',
    ]);
    expect((await api.as(t.admin).get('/v2/catalog/reviews?status=bogus')).body.data).toHaveLength(
      3,
    );
    expect(
      (await api.as(t.admin).get('/v2/catalog/reviews?status=approved')).body.data[0].customerName,
    ).toBe('Done');

    const target = page1.body.data[0].id as string;
    const approved = await api
      .as(t.admin)
      .put(`/v2/catalog/reviews/${target}`)
      .send({ status: 'approved' });
    expect(approved.body.status).toBe('approved');
    expect(
      (await api.as(t.admin).put(`/v2/catalog/reviews/${target}`).send({ status: 'weird' })).status,
    ).toBe(422);
    expect((await api.as(t.admin).get('/v2/catalog/reviews')).body.meta.counts).toEqual({
      pending: 2,
      approved: 2,
      rejected: 0,
    });
    expect(await api.auditCount(t.orgId, 'product_reviews', 'update')).toBe(1);

    const spy = (await api.as(other.admin).get('/v2/catalog/reviews')).body.data[0].id as string;
    expect(
      (await api.as(t.admin).put(`/v2/catalog/reviews/${spy}`).send({ status: 'approved' })).status,
    ).toBe(404);
    expect((await api.as(t.admin).delete(`/v2/catalog/reviews/${spy}`)).status).toBe(204);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int n FROM wa_product_reviews WHERE org_id=$1`, [
          other.orgId,
        ])
      ).rows[0].n,
    ).toBe(1);

    expect((await api.as(t.admin).delete(`/v2/catalog/reviews/${target}`)).status).toBe(204);
    expect((await api.as(t.admin).delete(`/v2/catalog/reviews/${target}`)).status).toBe(204);
    const viewer = await api.member(t, 'revviewer', [['cat.reviews.read']]);
    expect((await api.as(viewer.token).get('/v2/catalog/reviews')).status).toBe(200);
    expect(
      (await api.as(viewer.token).put(`/v2/catalog/reviews/${spy}`).send({ status: 'approved' }))
        .status,
    ).toBe(403);
  });
});

describe('TW-CAT-025: stock ledger and the reader the shop uses', () => {
  it('hold, commit, release, by ref and the expired sweep move stock exactly; two holds cannot oversell the last unit', async () => {
    const t = await fresh('inv');
    const inv = h.app.get(InventoryService, { strict: false });
    const db = h.app.get(DatabaseService, { strict: false });
    const p = await createProduct(t, 'Scarce', { stockQty: 5 });
    const pid = Number(
      (await h.owner.query(`SELECT id FROM wa_products WHERE uuid=$1`, [p.id])).rows[0].id,
    );
    const stock = async () =>
      (await h.owner.query(`SELECT stock_qty, reserved_qty FROM wa_products WHERE id=$1`, [pid]))
        .rows[0];
    const tx = <T>(fn: Parameters<typeof db.txAs>[1]) =>
      db.txAs({ orgId: t.orgId, userId: null }, fn) as Promise<T>;

    const hold = await tx<{ id: number; qty: number; status: string } | null>((x) =>
      inv.hold(x, t.orgId, pid, 3, 'order-1'),
    );
    expect(hold).toMatchObject({ qty: 3, status: 'held' });
    expect(await stock()).toEqual({ stock_qty: 5, reserved_qty: 3 });
    expect(await tx((x) => inv.hold(x, t.orgId, pid, 3, 'order-2'))).toBeNull();
    expect(await tx((x) => inv.hold(x, t.orgId, pid, 0, 'zero'))).toBeNull();
    expect(await tx((x) => inv.commit(x, t.orgId, hold!.id))).toBe(true);
    expect(await stock()).toEqual({ stock_qty: 2, reserved_qty: 0 });
    expect(await tx((x) => inv.commit(x, t.orgId, hold!.id))).toBe(false);

    await tx((x) => inv.hold(x, t.orgId, pid, 1, 'cart-A'));
    await tx((x) => inv.hold(x, t.orgId, pid, 1, 'cart-A'));
    expect(await stock()).toEqual({ stock_qty: 2, reserved_qty: 2 });
    expect(await tx((x) => inv.releaseByRef(x, t.orgId, 'cart-A'))).toBe(2);
    expect(await stock()).toEqual({ stock_qty: 2, reserved_qty: 0 });
    await tx((x) => inv.hold(x, t.orgId, pid, 2, 'cart-B'));
    expect(await tx((x) => inv.commitByRef(x, t.orgId, 'cart-B', null))).toBe(1);
    expect(await stock()).toEqual({ stock_qty: 0, reserved_qty: 0 });

    // Concurrency: 6 buyers of the last 4 units: exactly 4 get one.
    await h.owner.query(`UPDATE wa_products SET stock_qty=4 WHERE id=$1`, [pid]);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => tx((x) => inv.hold(x, t.orgId, pid, 1, `race-${i}`))),
    );
    expect(results.filter(Boolean)).toHaveLength(4);
    expect(await stock()).toEqual({ stock_qty: 4, reserved_qty: 4 });

    await h.owner.query(
      `UPDATE wa_stock_reservations SET expires_at = now() - interval '1 minute' WHERE org_id=$1 AND status='held'`,
      [t.orgId],
    );
    expect(await inv.sweepExpired()).toBe(4);
    expect(await stock()).toEqual({ stock_qty: 4, reserved_qty: 0 });
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int n FROM wa_stock_reservations WHERE org_id=$1 AND status='released'`,
          [t.orgId],
        )
      ).rows[0].n,
    ).toBe(6);
    // Unlimited stock holds without a ceiling.
    const free = await createProduct(t, 'Endless');
    const fid = Number(
      (await h.owner.query(`SELECT id FROM wa_products WHERE uuid=$1`, [free.id])).rows[0].id,
    );
    expect(await tx((x) => inv.hold(x, t.orgId, fid, 900, 'big'))).toMatchObject({ qty: 900 });
  });

  it("the storefront reader: available means in stock, active and the shop's own or shared; takeStock locks and never goes below 0; reviews; the reset deletes everything", async () => {
    const t = await fresh('reader');
    const other = await api.signup('readerother');
    const reader = h.app.get(StorefrontProductsReader, { strict: false });
    const db = h.app.get(DatabaseService, { strict: false });
    const run = <T>(orgId: number, fn: (tx: never) => Promise<T>) =>
      db.txAs({ orgId, userId: null }, fn as never) as Promise<T>;
    const shopA = (
      await h.owner.query(
        `INSERT INTO wa_storefronts (org_id, shop_name, slug) VALUES ($1,'A',$2) RETURNING id`,
        [t.orgId, `ra-${t.orgId}`],
      )
    ).rows[0].id;
    const shopB = (
      await h.owner.query(
        `INSERT INTO wa_storefronts (org_id, shop_name, slug) VALUES ($1,'B',$2) RETURNING id`,
        [t.orgId, `rb-${t.orgId}`],
      )
    ).rows[0].id;
    const shared = await createProduct(t, 'Shared', { category: 'C', stockQty: 3 });
    const mine = await createProduct(t, 'Mine', { category: 'C' });
    const theirs = await createProduct(t, 'Theirs');
    await createProduct(t, 'Hidden draft', { status: 'draft' });
    await createProduct(t, 'Out', { inStock: false });
    await h.owner.query(`UPDATE wa_products SET storefront_id=$2 WHERE org_id=$1 AND uuid=$3`, [
      t.orgId,
      shopA,
      mine.id,
    ]);
    await h.owner.query(`UPDATE wa_products SET storefront_id=$2 WHERE org_id=$1 AND uuid=$3`, [
      t.orgId,
      shopB,
      theirs.id,
    ]);
    await createProduct(other, 'Foreign');

    const list = await run(t.orgId, (tx) =>
      reader.listAvailable(tx, t.orgId, Number(shopA), { offset: 0, limit: 10 }),
    );
    expect(list.rows.map((r) => r.name).sort()).toEqual(['Mine', 'Shared']);
    expect(list.total).toBe(2);
    expect(
      (
        await run(t.orgId, (tx) =>
          reader.listAvailable(tx, t.orgId, Number(shopA), { offset: 1, limit: 1 }),
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      await run(t.orgId, (tx) => reader.findAvailableBySlug(tx, t.orgId, Number(shopA), 'theirs')),
    ).toBeUndefined();
    expect(
      (await run(t.orgId, (tx) => reader.findAvailableBySlug(tx, t.orgId, Number(shopA), 'mine')))
        ?.uuid,
    ).toBe(mine.id);
    const byUuid = await run(t.orgId, (tx) =>
      reader.findAvailableByUuids(tx, t.orgId, Number(shopA), [mine.id, theirs.id, shared.id]),
    );
    expect(byUuid.map((r) => r.name).sort()).toEqual(['Mine', 'Shared']);
    const sharedP = (await run(t.orgId, (tx) =>
      reader.findAvailableBySlug(tx, t.orgId, Number(shopA), 'shared'),
    ))!;
    const related = await run(t.orgId, (tx) =>
      reader.related(tx, t.orgId, Number(shopA), sharedP, 5),
    );
    expect(related.map((r) => r.name)).toEqual(['Mine']);
    expect(await run(t.orgId, (tx) => reader.countProducts(tx, t.orgId))).toBe(5);

    expect(await run(t.orgId, (tx) => reader.takeStock(tx, t.orgId, sharedP.id, 2))).toBe(2);
    expect(await run(t.orgId, (tx) => reader.takeStock(tx, t.orgId, sharedP.id, 5))).toBe(1);
    expect(await run(t.orgId, (tx) => reader.takeStock(tx, t.orgId, sharedP.id, 1))).toBe(0);
    const unlimited = (await run(t.orgId, (tx) =>
      reader.findAvailableBySlug(tx, t.orgId, Number(shopA), 'mine'),
    ))!;
    expect(await run(t.orgId, (tx) => reader.takeStock(tx, t.orgId, unlimited.id, 7))).toBe(7);
    expect(
      (await h.owner.query(`SELECT stock_qty FROM wa_products WHERE id=$1`, [sharedP.id])).rows[0]
        .stock_qty,
    ).toBe(0);
    // Concurrent buyers of the last 3 units never take more than 3 together.
    await h.owner.query(`UPDATE wa_products SET stock_qty=3 WHERE id=$1`, [sharedP.id]);
    const taken = await Promise.all(
      Array.from({ length: 5 }, () =>
        run(t.orgId, (tx) => reader.takeStock(tx, t.orgId, sharedP.id, 1)),
      ),
    );
    expect(taken.reduce((a, b) => a + b, 0)).toBe(3);

    expect(
      await run(t.orgId, (tx) =>
        reader.createPendingReview(tx, t.orgId, {
          storefrontId: Number(shopA),
          productUuid: mine.id,
          customerName: 'Cy',
          rating: 5,
          body: null,
        }),
      ),
    ).toBe(true);
    expect(
      await run(t.orgId, (tx) =>
        reader.createPendingReview(tx, t.orgId, {
          storefrontId: Number(shopA),
          productUuid: '00000000-0000-4000-8000-000000000000',
          customerName: 'Cy',
          rating: 5,
          body: null,
        }),
      ),
    ).toBe(false);
    expect(
      await run(t.orgId, (tx) => reader.approvedReviews(tx, t.orgId, unlimited.id, 5)),
    ).toEqual([]);
    await h.owner.query(`UPDATE wa_product_reviews SET status='approved' WHERE org_id=$1`, [
      t.orgId,
    ]);
    expect(
      (await run(t.orgId, (tx) => reader.approvedReviews(tx, t.orgId, unlimited.id, 5))).map(
        (r) => r.customerName,
      ),
    ).toEqual(['Cy']);

    expect(await run(t.orgId, (tx) => reader.deleteAllProducts(tx, t.orgId))).toBe(5);
    expect(
      (await h.owner.query(`SELECT count(*)::int n FROM wa_products WHERE org_id=$1`, [t.orgId]))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int n FROM wa_product_reviews WHERE org_id=$1`, [
          t.orgId,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int n FROM wa_products WHERE org_id=$1`, [
          other.orgId,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('tenant isolation of the send log (RLS)', () => {
  it("the application role sees only its own organization's cat_catalog_sends rows, and cannot insert into another's", async () => {
    const a = await fresh('rlsa');
    const b = await api.signup('rlsb');
    await h.owner.query(
      `INSERT INTO cat_catalog_sends (org_id, recipient, mode, status) VALUES ($1,'111','link','sent'),($2,'222','link','sent')`,
      [a.orgId, b.orgId],
    );
    const db = h.app.get(DatabaseService, { strict: false });
    const { sql } = await import('drizzle-orm');
    const seen = await db.txAs({ orgId: a.orgId, userId: null }, (tx) =>
      tx.execute(sql`SELECT recipient FROM cat_catalog_sends`),
    );
    expect(seen.rows.map((r) => (r as { recipient: string }).recipient)).toEqual(['111']);
    await expect(
      db.txAs({ orgId: a.orgId, userId: null }, (tx) =>
        tx.execute(
          sql`INSERT INTO cat_catalog_sends (org_id, recipient, mode, status) VALUES (${b.orgId}, '333', 'link', 'sent')`,
        ),
      ),
    ).rejects.toThrow();
  });
});
