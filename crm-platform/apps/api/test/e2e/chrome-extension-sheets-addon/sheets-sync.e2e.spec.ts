import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  FULL_GRANTS,
  addon,
  generateKey,
  installSheets,
  memberWithKey,
  rows,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from './support';

/**
 * What the add-on reads and writes (WD-EXT-008 to 014): shops and products as WaDesk's add-on does, and contacts in and out, each row on its
 * own, every write as the key's owner. Real Postgres and Redis, the real app.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);
afterAll(async () => h?.stop());

/** A workspace with the add-on installed and an admin key. */
async function workspace(label: string) {
  const t = await api.signup(label);
  await installSheets(h, t);
  const key = await generateKey(api, t.admin);
  return { t, key, call: addon(h, key) };
}

const contactRows = (t: Tenant) => rows(h, 'contacts', t);
const grantsWithout = (...drop: string[]): Grant[] =>
  FULL_GRANTS.filter(([k]) => !drop.includes(k));

describe('contacts in: bulk upsert from sheet rows (WD-EXT-012)', () => {
  it('creates a contact per row, owned by the key owner, with phones made E.164 and the source stamped', async () => {
    const { t, call } = await workspace('es-create');
    const res = await call.post('/contacts/sync', {
      default_country_code: '+91',
      rows: [
        { ref: 2, name: 'Ann Lee', email: 'Ann@Example.com' },
        { ref: 3, phone: 9876543210, first_name: 'Raj' },
        {
          ref: 4,
          email: 'both@example.com',
          phone: '+1 415 555 0101',
          source: 'webinar',
          attributes: { city: 'Pune' },
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.summary).toEqual({ created: 3, updated: 0, unchanged: 0, failed: 0, total: 3 });
    expect(res.body.results.map((r: { ref: number; status: string }) => [r.ref, r.status])).toEqual(
      [
        [2, 'created'],
        [3, 'created'],
        [4, 'created'],
      ],
    );
    for (const r of res.body.results) expect(r.id).toMatch(/^[0-9a-f-]{36}$/);

    const stored = await contactRows(t);
    expect(stored.map((c) => c.email ?? c.phone)).toEqual([
      'ann@example.com',
      '+919876543210',
      'both@example.com',
    ]);
    expect(stored[2].phone).toBe('+14155550101');
    expect(stored.map((c) => c.source)).toEqual(['google_sheets', 'google_sheets', 'webinar']);
    expect(new Set(stored.map((c) => c.owner_id))).toEqual(new Set([t.adminUserId]));
  });

  it('writes the usual audit rows as the member, plus one summary row and one event for the call', async () => {
    const { t, call } = await workspace('es-audit');
    await call.post('/contacts/sync', {
      rows: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
    });
    const perRow = await rows(h, 'audit_log', t, `module = 'contacts'`);
    expect(perRow).toHaveLength(2);
    expect(new Set(perRow.map((a) => `${a.actor_type}:${a.actor_id}`))).toEqual(
      new Set([`user:${t.adminUserId}`]),
    );
    const run = await rows(h, 'audit_log', t, `module = 'ext_sheets_sync'`);
    expect(run).toHaveLength(1);
    expect(run[0].delta).toMatchObject({
      kind: { new: 'contacts' },
      rows: { new: 2 },
      created: { new: 2 },
      failed: { new: 0 },
    });
    const events = await rows(h, 'event_outbox', t, `event_type = 'ext.sheets.synced'`);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ kind: 'contacts', rows: 2, created: 2 });
    expect(JSON.stringify([run, events])).not.toContain('a@example.com');
  });

  it('updates the contact a row matches by email or phone, leaves blank cells alone and reports "unchanged" for a repeat', async () => {
    const { t, call } = await workspace('es-update');
    await call.post('/contacts/sync', {
      rows: [
        {
          email: 'keep@example.com',
          phone: '+919811111111',
          name: 'Keep Me',
          attributes: { tier: 'gold' },
        },
      ],
    });
    const again = await call.post('/contacts/sync', {
      rows: [
        { ref: 'a', email: 'keep@example.com', name: '', attributes: { city: 'Delhi', tier: '' } },
        { ref: 'b', phone: '919811111111', first_name: 'Keeper' },
        { ref: 'c', email: 'keep@example.com' },
      ],
    });
    expect(
      again.body.results.map((r: { ref: string; status: string }) => [r.ref, r.status]),
    ).toEqual([
      ['a', 'updated'],
      ['b', 'updated'],
      ['c', 'unchanged'],
    ]);
    const [c] = await contactRows(t);
    expect(c.name).toBe('Keep Me');
    expect(c.first_name).toBe('Keeper');
    expect(c.data).toEqual({ tier: 'gold', city: 'Delhi' });
    expect(await contactRows(t)).toHaveLength(1);

    const repeat = await call.post('/contacts/sync', {
      rows: [{ email: 'keep@example.com', attributes: { city: 'Delhi' } }],
    });
    expect(repeat.body.summary).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  });

  it('reports each bad row on its own and still saves the good ones', async () => {
    const { t, call } = await workspace('es-partial');
    const res = await call.post('/contacts/sync', {
      rows: [
        { ref: 2, email: 'good1@example.com' },
        { ref: 3, email: 'not-an-email' },
        { ref: 4, name: 'No way to reach' },
        { ref: 5, phone: '12' },
        'a string, not a row',
        { ref: 7, email: 'good2@example.com', phone: '+91 98765 00000' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ created: 2, updated: 0, unchanged: 0, failed: 4, total: 2 });
    const byIndex = res.body.results as Array<{
      index: number;
      ref?: number;
      status: string;
      error?: { code: string; field?: string; message: string };
    }>;
    expect(byIndex.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(byIndex[1]).toMatchObject({
      ref: 3,
      status: 'failed',
      error: { code: 'VALIDATION_FAILED', field: 'email' },
    });
    expect(byIndex[2]).toMatchObject({
      ref: 4,
      status: 'failed',
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(byIndex[3]).toMatchObject({ ref: 5, error: { field: 'phone' } });
    expect(byIndex[4]).toMatchObject({ status: 'failed' });
    expect(byIndex[5]).toMatchObject({ ref: 7, status: 'created' });
    expect(await contactRows(t)).toHaveLength(2);
    const run = await rows(h, 'audit_log', t, `module = 'ext_sheets_sync'`);
    expect(run[0].delta).toMatchObject({
      rows: { new: 6 },
      created: { new: 2 },
      failed: { new: 4 },
    });
  });

  it('refuses a row whose email and phone belong to two different contacts, and changes neither', async () => {
    const { t, call } = await workspace('es-conflict');
    await call.post('/contacts/sync', {
      rows: [{ email: 'one@example.com' }, { phone: '+919822222222' }],
    });
    const res = await call.post('/contacts/sync', {
      rows: [{ email: 'one@example.com', phone: '+919822222222', name: 'Mixed' }],
    });
    expect(res.body.results[0]).toMatchObject({ status: 'failed', error: { code: 'CONFLICT' } });
    expect((await contactRows(t)).every((c) => c.name !== 'Mixed')).toBe(true);
  });

  it('lets a later row for the same person see the earlier one in the same call', async () => {
    const { t, call } = await workspace('es-dup');
    const res = await call.post('/contacts/sync', {
      rows: [
        { email: 'dup@example.com', name: 'First' },
        { email: 'dup@example.com', first_name: 'Second' },
        { email: 'dup@example.com', name: 'First' },
      ],
    });
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'created',
      'updated',
      'unchanged',
    ]);
    expect(await contactRows(t)).toHaveLength(1);
  });

  it('sets the opt-out flag from the sheet and stamps the time', async () => {
    const { t, call } = await workspace('es-optout');
    await call.post('/contacts/sync', { rows: [{ email: 'o@example.com' }] });
    await call.post('/contacts/sync', {
      rows: [{ email: 'o@example.com', is_unsubscribed: 'yes' }],
    });
    const [c] = await contactRows(t);
    expect(c.is_unsubscribed).toBe(true);
    expect(c.unsubscribed_at).not.toBeNull();
  });

  it('holds each row to what the role may do: create-only cannot edit, update-only cannot create', async () => {
    const { t, call } = await workspace('es-role');
    await call.post('/contacts/sync', {
      rows: [{ name: 'Existing', email: 'existing@example.com' }],
    });
    const createOnly = await memberWithKey(
      api,
      t,
      'creator',
      grantsWithout('record.contacts.update'),
    );
    const updateOnly = await memberWithKey(
      api,
      t,
      'editor',
      grantsWithout('record.contacts.create'),
    );
    const body = {
      rows: [
        { ref: 1, email: 'existing@example.com', name: 'Renamed' },
        { ref: 2, email: 'fresh@example.com' },
      ],
    };

    const a = await addon(h, createOnly.key).post('/contacts/sync', body);
    expect(a.status).toBe(200);
    expect(a.body.results).toMatchObject([
      {
        ref: 1,
        status: 'failed',
        error: { code: 'FORBIDDEN', message: expect.stringContaining('edit') },
      },
      { ref: 2, status: 'created' },
    ]);
    const b = await addon(h, updateOnly.key).post('/contacts/sync', {
      rows: [
        { ref: 1, email: 'existing@example.com', name: 'Renamed' },
        { ref: 3, email: 'another@example.com' },
      ],
    });
    expect(b.body.results).toMatchObject([
      { ref: 1, status: 'updated' },
      {
        ref: 3,
        status: 'failed',
        error: { code: 'FORBIDDEN', message: expect.stringContaining('create') },
      },
    ]);
    const stored = await contactRows(t);
    expect(stored.find((c) => c.email === 'existing@example.com')?.name).toBe('Renamed');
    expect(stored.find((c) => c.email === 'another@example.com')).toBeUndefined();
  });

  it("does not let an own-scope member edit someone else's contact", async () => {
    const { t, call } = await workspace('es-scope');
    const made = await call.post('/contacts/sync', {
      rows: [{ name: 'Admin owns', email: 'theirs@example.com' }],
    });
    const theirs = made.body.results[0].id as string;
    const grants: Grant[] = FULL_GRANTS.map(([k]) =>
      k === 'record.contacts.update' ? [k, 'own'] : [k],
    );
    const m = await memberWithKey(api, t, 'scoped', grants);
    const res = await addon(h, m.key).post('/contacts/sync', {
      rows: [{ email: 'theirs@example.com', name: 'Taken over' }],
    });
    expect(res.body.results[0]).toMatchObject({ status: 'failed', error: { code: 'NOT_FOUND' } });
    const [row] = await h.owner
      .query(`SELECT name FROM contacts WHERE uuid = $1`, [theirs])
      .then((r) => r.rows);
    expect(row.name).toBe('Admin owns');
  });

  it("never touches another workspace's contacts, even for the same email", async () => {
    const a = await workspace('es-iso-a');
    const b = await workspace('es-iso-b');
    await b.call.post('/contacts/sync', {
      rows: [{ email: 'same@example.com', name: 'B person' }],
    });
    const res = await a.call.post('/contacts/sync', {
      rows: [{ email: 'same@example.com', name: 'A person' }],
    });
    expect(res.body.results[0].status).toBe('created');
    expect((await contactRows(b.t)).map((c) => c.name)).toEqual(['B person']);
    expect((await contactRows(a.t)).map((c) => c.name)).toEqual(['A person']);
  });
});

describe('contacts out: pull into the sheet (WD-EXT-011)', () => {
  it('pages through the workspace with a cursor, newest first, in the add-on shape', async () => {
    const { t, call } = await workspace('ep-page');
    await api.seedContacts(
      t,
      ['a', 'b', 'c', 'd', 'e'].map((n) => ({
        name: `Person ${n}`,
        email: `${n}@example.com`,
        data: { city: `City ${n}` },
      })),
    );
    const first = await call.get('/contacts?limit=2');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, has_more: true, next_cursor: expect.any(String) });
    expect(first.body.contacts.map((c: { name: string }) => c.name)).toEqual([
      'Person e',
      'Person d',
    ]);
    expect(first.body.contacts[0]).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Person e',
      first_name: null,
      last_name: null,
      email: 'e@example.com',
      phone: null,
      source: null,
      is_unsubscribed: false,
      attributes: { city: 'City e' },
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    const seen = [...first.body.contacts];
    let cursor = first.body.next_cursor as string | null;
    while (cursor) {
      const page = await call.get(`/contacts?limit=2&cursor=${encodeURIComponent(cursor)}`);
      seen.push(...page.body.contacts);
      cursor = page.body.next_cursor;
      if (!page.body.has_more) break;
    }
    expect(seen.map((c) => c.name)).toEqual([
      'Person e',
      'Person d',
      'Person c',
      'Person b',
      'Person a',
    ]);
    expect(new Set(seen.map((c) => c.id)).size).toBe(5);
  });

  it('searches, and refuses a page size over the cap or a bad cursor', async () => {
    const { t, call } = await workspace('ep-search');
    await api.seedContacts(t, [
      { name: 'Zed Zephyr', email: 'zed@example.com' },
      { name: 'Other', email: 'other@example.com' },
    ]);
    expect(
      (await call.get('/contacts?q=zephyr')).body.contacts.map((c: { name: string }) => c.name),
    ).toEqual(['Zed Zephyr']);
    expect((await call.get('/contacts?limit=501')).status).toBe(422);
    expect((await call.get('/contacts?limit=0')).status).toBe(422);
    const bad = await call.get('/contacts?cursor=not-a-cursor');
    expect([400, 422]).toContain(bad.status);
    expect(bad.body.ok).toBe(false);
  });

  it('round-trips: what a pull returns, a sync of it leaves unchanged', async () => {
    const { call } = await workspace('ep-round');
    await call.post('/contacts/sync', {
      rows: [
        {
          email: 'rt@example.com',
          name: 'Round Trip',
          phone: '+919833333333',
          attributes: { city: 'Goa' },
        },
      ],
    });
    const pulled = (await call.get('/contacts')).body.contacts[0];
    const back = await call.post('/contacts/sync', {
      rows: [
        {
          name: pulled.name,
          email: pulled.email,
          phone: pulled.phone,
          attributes: pulled.attributes,
          is_unsubscribed: pulled.is_unsubscribed,
        },
      ],
    });
    expect(back.body.results[0].status).toBe('unchanged');
  });
});

describe('shops and products: the WaDesk add-on behaviour (WD-EXT-008 to 010)', () => {
  const product = (over: Record<string, unknown> = {}) => ({
    name: 'Blue Tee',
    price: 499,
    sku: 'TEE-1',
    ...over,
  });

  it('creates the shop and its products from a sheet, and reads them back', async () => {
    const { t, call } = await workspace('ec-first');
    const res = await call.post('/sync', {
      shop_name: 'Corner Store',
      description: 'Everything for the corner',
      currency: 'inr',
      products: [
        product({ ref: 2, category: 'Tops', description: 'Soft', stock: 10 }),
        product({
          ref: 3,
          name: 'Red Cap',
          sku: 'CAP-1',
          price: '19.999',
          active: 'no',
          stock: '',
        }),
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      shop: {
        shop_name: 'Corner Store',
        slug: 'corner-store',
        currency: 'INR',
        created: true,
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        public_url: expect.stringContaining('corner-store'),
      },
      products: { created: 2, updated: 0, unchanged: 0, failed: 0, total: 2 },
    });
    const [shop] = await rows(h, 'wa_storefronts', t);
    expect(shop).toMatchObject({
      shop_name: 'Corner Store',
      slug: 'corner-store',
      theme_key: 'aurora',
      enabled: true,
      currency_code: 'INR',
    });
    expect(shop.settings_json).toMatchObject({ hero_text: 'Everything for the corner' });

    const products = await rows(h, 'wa_products', t);
    expect(products.map((p) => [p.sku, p.price_minor, p.status, p.in_stock, p.stock_qty])).toEqual([
      ['TEE-1', 49900, 'active', true, 10],
      ['CAP-1', 2000, 'draft', false, null],
    ]);
    expect(products[0]).toMatchObject({
      name: 'Blue Tee',
      category: 'Tops',
      description: 'Soft',
      currency_code: 'INR',
      user_id: t.adminUserId,
    });
    const audit = await rows(h, 'audit_log', t, `module = 'products'`);
    expect(audit.map((a) => a.actor_id)).toEqual([t.adminUserId, t.adminUserId]);

    const list = await call.get('/shops');
    expect(list.body).toMatchObject({
      ok: true,
      product_count_total: 2,
      workspace: expect.any(String),
    });
    expect(list.body.shops).toHaveLength(1);
    expect(list.body.shops[0]).toMatchObject({
      shop_name: 'Corner Store',
      slug: 'corner-store',
      currency: 'INR',
      enabled: true,
      theme_key: 'aurora',
      custom_domain: null,
      product_count: 2,
    });
  });

  it('updates in place on a second sync: the shop by id, products by SKU then name, and the slug never changes', async () => {
    const { t, call } = await workspace('ec-again');
    const first = await call.post('/sync', {
      shop_name: 'First Name',
      products: [product(), product({ name: 'No SKU Item', sku: undefined, price: 5 })],
    });
    const shopId = first.body.shop.id as string;

    const second = await call.post('/sync', {
      shop_id: shopId,
      shop_name: 'Renamed Shop',
      theme_key: 'aurora',
      products: [
        product({ price: 599, description: 'New text' }),
        product({ name: 'no sku item', sku: undefined, price: 5 }),
        product({ name: 'Brand New', sku: 'NEW-1', price: 1 }),
      ],
    });
    expect(second.body.shop).toMatchObject({
      id: shopId,
      shop_name: 'Renamed Shop',
      slug: 'first-name',
      created: false,
    });
    // The second row matches by name in any case and takes the sheet's spelling (WaDesk overwrote the name too), so it counts as updated.
    expect(second.body.products).toMatchObject({
      created: 1,
      updated: 2,
      unchanged: 0,
      failed: 0,
      total: 3,
    });
    expect(second.body.products.results.map((r: { status: string }) => r.status)).toEqual([
      'updated',
      'updated',
      'created',
    ]);
    const repeat = await call.post('/sync', {
      shop_id: shopId,
      shop_name: 'Renamed Shop',
      products: [
        product({ price: 599, description: 'New text' }),
        product({ name: 'no sku item', sku: undefined, price: 5 }),
      ],
    });
    expect(repeat.body.products).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(await rows(h, 'wa_storefronts', t)).toHaveLength(1);
    const products = await rows(h, 'wa_products', t);
    expect(products).toHaveLength(3);
    expect(products.find((p) => p.sku === 'TEE-1')).toMatchObject({
      price_minor: 59900,
      description: 'New text',
    });
  });

  it('keeps what a row leaves out: description, category and stock stay; absent active means active again', async () => {
    const { t, call } = await workspace('ec-keep');
    await call.post('/sync', {
      shop_name: 'Keepers',
      products: [product({ description: 'Keep me', category: 'Tops', stock: 7, active: false })],
    });
    await call.post('/sync', { shop_name: 'Keepers', products: [product({ price: 450 })] });
    const [p] = await rows(h, 'wa_products', t);
    expect(p).toMatchObject({
      description: 'Keep me',
      category: 'Tops',
      stock_qty: 7,
      price_minor: 45000,
      status: 'active',
      in_stock: true,
    });
    await call.post('/sync', {
      shop_name: 'Keepers',
      products: [product({ price: 450, stock: null })],
    });
    expect((await rows(h, 'wa_products', t))[0].stock_qty).toBeNull();
  });

  it('reports bad product rows one by one and saves the others, with the shop saved first', async () => {
    const { t, call } = await workspace('ec-partial');
    const res = await call.post('/sync', {
      shop_name: 'Partial',
      products: [
        product({ ref: 2 }),
        { ref: 3, name: 'No price' },
        { ref: 4, name: 'Bad price', price: 'free' },
        { ref: 5, name: 'Bad image', price: 1, image_url: 'nope' },
        { ref: 6, name: '', price: 1 },
        product({ ref: 7, name: 'Fine', sku: 'F-1', price: 2 }),
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.products).toMatchObject({ created: 2, failed: 4, total: 2 });
    const failed = res.body.products.results.filter(
      (r: { status: string }) => r.status === 'failed',
    );
    expect(
      failed.map((r: { ref: number; error: { field?: string } }) => [r.ref, r.error.field]),
    ).toEqual([
      [3, 'price'],
      [4, 'price'],
      [5, 'image_url'],
      [6, 'name'],
    ]);
    expect(await rows(h, 'wa_products', t)).toHaveLength(2);
  });

  it('treats the shop part as one thing: a missing name, a bad currency or theme, or no products is a 422 and writes nothing', async () => {
    const { t, call } = await workspace('ec-422');
    for (const body of [
      { products: [product()] },
      { shop_name: 'X', products: [] },
      { shop_name: 'X', currency: 'ZZZ', products: [product()] },
      { shop_name: 'X', theme_key: 'neon-pink', products: [product()] },
      { shop_name: 'X', shop_id: 'nope', products: [product()] },
      { shop_name: 'X', products: new Array(501).fill(product()) },
    ]) {
      const res = await call.post('/sync', body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(422);
      expect(res.body).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    }
    expect(await rows(h, 'wa_storefronts', t)).toHaveLength(0);
  });

  it("makes a new shop when the id is not one of this workspace's, and never touches another workspace's shop or products", async () => {
    const a = await workspace('ec-iso-a');
    const b = await workspace('ec-iso-b');
    const made = await b.call.post('/sync', {
      shop_name: 'B Shop',
      products: [product({ price: 100 })],
    });
    const bShop = made.body.shop.id as string;

    const res = await a.call.post('/sync', {
      shop_id: bShop,
      shop_name: 'A Shop',
      products: [product({ price: 999 })],
    });
    expect(res.body.shop).toMatchObject({ created: true, shop_name: 'A Shop' });
    expect(res.body.shop.id).not.toBe(bShop);
    expect(res.body.products).toMatchObject({ created: 1, updated: 0 });
    expect((await rows(h, 'wa_storefronts', b.t)).map((s) => s.shop_name)).toEqual(['B Shop']);
    expect((await rows(h, 'wa_products', b.t)).map((p) => p.price_minor)).toEqual([10000]);
    expect(
      (await a.call.get('/shops')).body.shops.map((s: { shop_name: string }) => s.shop_name),
    ).toEqual(['A Shop']);
  });

  it('holds each product row to the role: create-only cannot edit a product, and a role without the shop permission cannot sync', async () => {
    const { t, call } = await workspace('ec-role');
    await call.post('/sync', { shop_name: 'Shared', products: [product()] });
    const creator = await memberWithKey(
      api,
      t,
      'prodcreator',
      grantsWithout('cat.products.update'),
    );
    const res = await addon(h, creator.key).post('/sync', {
      shop_name: 'Shared',
      products: [
        product({ ref: 1, price: 1 }),
        product({ ref: 2, name: 'Other', sku: 'O-1', price: 3 }),
      ],
    });
    expect(res.body.products.results).toMatchObject([
      {
        ref: 1,
        status: 'failed',
        error: { code: 'FORBIDDEN', message: expect.stringContaining('edit products') },
      },
      { ref: 2, status: 'created' },
    ]);
    expect((await rows(h, 'wa_products', t, `sku = 'TEE-1'`))[0].price_minor).toBe(49900);

    const noShop = await memberWithKey(api, t, 'noshop', grantsWithout('store.shops.manage'));
    const denied = await addon(h, noShop.key).post('/sync', {
      shop_name: 'Hijack',
      products: [product()],
    });
    expect(denied.status).toBe(403);
    // A sync with no shop_id makes a shop of its own (as in WaDesk), so the creator's call above made a second one; the refused call made none.
    expect(await rows(h, 'wa_storefronts', t)).toHaveLength(2);
  });

  it("holds product rows to the plan's product cap, per row", async () => {
    const { t, call } = await workspace('ec-cap');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = jsonb_build_object('limits', jsonb_build_object('catalog_products', 2)) WHERE org_id = $1`,
      [t.orgId],
    );
    await h.redis.flushall();
    const res = await call.post('/sync', {
      shop_name: 'Capped',
      products: [
        product({ name: 'One', sku: '1' }),
        product({ name: 'Two', sku: '2' }),
        product({ name: 'Three', sku: '3' }),
      ],
    });
    expect(res.body.products).toMatchObject({ created: 2, failed: 1 });
    expect(res.body.products.results[2]).toMatchObject({
      status: 'failed',
      error: { code: 'PLAN_LIMIT_REACHED' },
    });
    expect(await rows(h, 'wa_products', t)).toHaveLength(2);
  });

  it('writes a summary audit row and an event for the call', async () => {
    const { t, call } = await workspace('ec-audit');
    await call.post('/sync', { shop_name: 'Audited', products: [product(), { name: 'bad' }] });
    const run = await rows(h, 'audit_log', t, `module = 'ext_sheets_sync'`);
    expect(run).toHaveLength(1);
    expect(run[0].delta).toMatchObject({
      kind: { new: 'products' },
      rows: { new: 2 },
      created: { new: 1 },
      failed: { new: 1 },
    });
    const shopAudit = await rows(h, 'audit_log', t, `module = 'storefronts'`);
    expect(shopAudit.map((a) => a.action)).toEqual(['insert']);
  });
});
