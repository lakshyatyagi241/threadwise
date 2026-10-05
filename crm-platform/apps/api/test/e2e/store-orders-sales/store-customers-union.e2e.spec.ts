import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The harness first: it loads the app graph in the order the application itself does (a domain barrel first hits an import cycle).
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { phoneKey, phoneKeySql } from '../../../src/common/sql/phone-key';

/**
 * The store Customers list is every buyer, not only saved addresses (owner decision 2026-10-05): saved profiles plus the distinct buyers
 * found in wa_orders, grouped by normalised phone, with real Postgres and the real app. Covers profile-only, order-only and both, the
 * same buyer typed three ways, search, paging by last activity, the shop filter, detail and edit of an order-only buyer, workspace
 * isolation, and the profile every order writer now keeps in step without overwriting what somebody edited.
 */
process.env.STORE_PROVIDER_MODE = 'fixture';

let h: Harness;
let api: Api;

let ipSeq = 0;
const ip = () => `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const q = async (sql: string, params: unknown[] = []) => (await h.owner.query(sql, params)).rows;
const get = (t: Tenant, path: string) => api.as(t.admin).get(path);

async function shopFor(t: Tenant, name = 'Media City Threads', devicePhone = '9812345678') {
  const dev = await q(
    `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
     VALUES ($1, 'Counter phone', '91', $2, 'connected', true) RETURNING uuid`,
    [t.orgId, devicePhone],
  );
  const res = await api
    .as(t.admin)
    .post('/v2/store/shops')
    .send({ shopName: name, deviceId: dev[0].uuid });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = Number(
    (await q(`SELECT id FROM wa_storefronts WHERE uuid = $1`, [res.body.id]))[0].id,
  );
  return { uuid: res.body.id as string, id, slug: res.body.slug as string };
}

async function order(
  t: Tenant,
  o: {
    phone: string | null;
    name?: string | null;
    total?: number;
    currency?: string;
    status?: string;
    ageHours?: number;
    shopId?: number | null;
    contactId?: number | null;
  },
) {
  const r = await q(
    `INSERT INTO wa_orders (org_id, source, customer_phone, customer_name, items_json, total_minor, currency_code, status,
                            storefront_id, contact_id, created_at)
     VALUES ($1, 'storefront', $2, $3, '[]'::jsonb, $4, $5, $6, $7, $8, now() - ($9 || ' hours')::interval) RETURNING id`,
    [
      t.orgId,
      o.phone,
      o.name === undefined ? null : o.name,
      o.total ?? 10000,
      o.currency ?? 'INR',
      o.status ?? 'new',
      o.shopId ?? null,
      o.contactId ?? null,
      String(o.ageHours ?? 1),
    ],
  );
  return Number(r[0].id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response rows are checked field by field below
const byPhone = (rows: Array<Record<string, any>>, phone: string) =>
  rows.find((r) => r.phone === phone);

describe('phone key: the SQL the list groups on is the TypeScript the save uses', () => {
  const samples = [
    '7999834066',
    '07999834066',
    '79998 34066',
    '+91 79998-34066',
    '917999834066',
    '0091 7999834066',
    '00917999834066',
    '+44 7700 900123',
    '07700 900123',
    '(415) 555-2671',
    '+1 415 555 2671',
    '123',
    'n/a',
    '',
    '123456789012345678',
  ];
  it.each(['91', '44', ''])('agrees on every sample with default country "%s"', async (cc) => {
    const q = new PgDialect().sqlToQuery(sql`${phoneKeySql(sql`v.phone`, cc)}`);
    for (const raw of samples) {
      const res = await h.owner.query(
        `SELECT ${q.sql} AS key FROM (SELECT $${q.params.length + 1}::text AS phone) v`,
        [...q.params, raw],
      );
      expect(res.rows[0].key, `${raw} / ${cc}`).toBe(phoneKey(raw, cc ? `+${cc}` : null));
    }
    const nul = await h.owner.query(
      `SELECT ${q.sql} AS key FROM (SELECT $${q.params.length + 1}::text AS phone) v`,
      [...q.params, null],
    );
    expect(nul.rows[0].key).toBe('');
  });
});

describe('GET /v2/store/customers: every buyer', () => {
  it('lists profile-only, order-only and both buyers, with the buyer flags, totals and last order', async () => {
    const t = await api.signup('union');
    const [contact] = await api.seedContacts(t, [{ name: 'Linked Buyer', phone: '+919800004444' }]);
    const contactId = Number((await q(`SELECT id FROM contacts WHERE uuid = $1`, [contact]))[0].id);

    // profile only: saved, nobody ordered with it
    const solo = await api.as(t.admin).post('/v2/store/customers').send({
      phone: '919800001111',
      name: 'Saved Sam',
      company: 'Sam & Co',
      address: '1 High St',
    });
    // both: saved with a name, no address, and two orders (one cancelled)
    const both = await api
      .as(t.admin)
      .post('/v2/store/customers')
      .send({ phone: '919800002222', name: 'Profile Name' });
    await order(t, { phone: '919800002222', name: 'Order Name', total: 5000 });
    await order(t, {
      phone: '+91 98000 02222',
      name: 'Order Name',
      total: 7000,
      status: 'cancelled',
    });
    // order only: three orders typed three ways, two currencies, the latest linked to a CRM contact and the name from the latest order
    await order(t, { phone: '9800003333', name: 'Old Name', total: 1000, ageHours: 30 });
    await order(t, { phone: '+91 98000 03333', name: 'Latest Name', total: 2000, ageHours: 20 });
    await order(t, {
      phone: '919800003333',
      name: null,
      total: 300,
      currency: 'USD',
      ageHours: 10,
      contactId,
    });
    // an order with no usable phone is no buyer
    await order(t, { phone: null, name: 'Nobody' });
    await order(t, { phone: 'n/a', name: 'Nobody' });

    const list = await get(t, '/v2/store/customers');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const rows = list.body.data as Array<Record<string, any>>;
    expect(rows).toHaveLength(3);

    const sam = byPhone(rows, '919800001111')!;
    expect(sam).toMatchObject({
      id: solo.body.id,
      name: 'Saved Sam',
      company: 'Sam & Co',
      address: '1 High St',
      hasProfile: true,
      hasSavedAddress: true,
      orderCount: 0,
      lifetimeTotals: [],
      lastOrderAt: null,
      contactId: null,
    });

    const prof = byPhone(rows, '919800002222')!;
    expect(prof).toMatchObject({
      id: both.body.id,
      name: 'Profile Name',
      hasProfile: true,
      hasSavedAddress: false,
      orderCount: 2,
      // the cancelled order counts as an order but not in the money
      lifetimeTotals: [{ currencyCode: 'INR', totalMinor: 5000, orders: 1 }],
    });
    expect(prof.lastOrderAt).toEqual(expect.any(String));

    const only = byPhone(rows, '919800003333')!;
    expect(only).toMatchObject({
      id: 'phone:919800003333',
      name: 'Latest Name',
      company: null,
      address: null,
      hasProfile: false,
      hasSavedAddress: false,
      orderCount: 3,
      rowVersion: 0,
      contactId: contact,
    });
    expect(only.lifetimeTotals).toEqual([
      { currencyCode: 'INR', totalMinor: 3000, orders: 2 },
      { currencyCode: 'USD', totalMinor: 300, orders: 1 },
    ]);

    // last activity first: the latest order, else the profile's last change: Sam (saved just now), then the 1h-old order, then 10h
    expect(rows.map((r) => r.phone)).toEqual(['919800001111', '919800002222', '919800003333']);
  });

  it('searches name (profile or latest order), company and phone in any form, and pages by last activity without repeats', async () => {
    const t = await api.signup('search');
    await api
      .as(t.admin)
      .post('/v2/store/customers')
      .send({ phone: '919810000001', name: 'Alpha', company: '50% off co' });
    await order(t, { phone: '919810000002', name: 'Beta Buyer', ageHours: 2 });
    await order(t, { phone: '9810000003', name: 'Gamma Buyer', ageHours: 3 });
    await order(t, { phone: '+91 98100 00004', name: 'Delta', ageHours: 4 });
    await order(t, { phone: '919810000005', name: 'Epsilon', ageHours: 5 });

    const names = async (term: string) =>
      ((await get(t, `/v2/store/customers?q=${encodeURIComponent(term)}`)).body.data as any[]).map(
        (c) => c.name,
      );
    expect(await names('buyer')).toEqual(['Beta Buyer', 'Gamma Buyer']);
    expect(await names('50% off')).toEqual(['Alpha']);
    expect(await names('%')).toEqual(['Alpha']);
    expect(await names('_')).toEqual([]);
    // phone, as typed on the order, as normalised, and a fragment
    expect(await names('98100 00003')).toEqual(['Gamma Buyer']);
    expect(await names('+919810000004')).toEqual(['Delta']);
    expect(await names('0000005')).toEqual(['Epsilon']);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 8; i++) {
      const res = await get(t, `/v2/store/customers?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((c: any) => c.phone));
      if (!res.body.page.hasMore) break;
      cursor = res.body.page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    // Alpha (saved now, nobody ordered with it) first, then the buyers by their latest order, newest first
    expect(seen).toEqual([
      '919810000001',
      '919810000002',
      '919810000003',
      '919810000004',
      '919810000005',
    ]);
    expect((await get(t, '/v2/store/customers?cursor=garbage')).status).toBe(422);
  });

  it('can be narrowed to one shop: only buyers who ordered there', async () => {
    const t = await api.signup('shopfilter');
    const a = await shopFor(t, 'Shop A');
    const b = await shopFor(t, 'Shop B', '9812345679');
    await api
      .as(t.admin)
      .post('/v2/store/customers')
      .send({ phone: '919820000001', name: 'Saved only' });
    await order(t, { phone: '919820000002', name: 'In A', shopId: a.id });
    await order(t, { phone: '919820000003', name: 'In B', shopId: b.id });
    await order(t, { phone: '919820000003', name: 'In B', shopId: a.id });
    const inA = await get(t, `/v2/store/customers?storefrontId=${a.uuid}`);
    expect(inA.body.data.map((c: any) => c.name).sort()).toEqual(['In A', 'In B']);
    const inB = await get(t, `/v2/store/customers?storefrontId=${b.uuid}`);
    expect(inB.body.data.map((c: any) => c.name)).toEqual(['In B']);
    expect(
      (await get(t, '/v2/store/customers?storefrontId=00000000-0000-4000-8000-000000000000')).body
        .data,
    ).toEqual([]);
  });

  it('opens an order-only buyer by phone:<digits>, edits it into a saved profile, and has nothing to delete before that', async () => {
    const t = await api.signup('orderonly');
    await order(t, { phone: '7999834066', name: 'SHubham', total: 4500 });

    const detail = await get(t, '/v2/store/customers/phone:917999834066');
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body).toMatchObject({
      id: 'phone:917999834066',
      phone: '917999834066',
      name: 'SHubham',
      hasProfile: false,
      orderCount: 1,
    });
    expect(detail.body.recentOrders).toHaveLength(1);
    expect((await get(t, '/v2/store/customers/phone:919000000000')).status).toBe(404);
    expect((await get(t, '/v2/store/customers/not-an-id')).status).toBe(422);

    // nothing saved, nothing to delete
    expect((await api.as(t.admin).delete('/v2/store/customers/phone:917999834066')).status).toBe(
      404,
    );

    const edit = await api
      .as(t.admin)
      .put('/v2/store/customers/phone:917999834066')
      .send({ name: 'Shubham P', company: 'Acme', address: '5 Park Lane' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body).toMatchObject({
      phone: '917999834066',
      name: 'Shubham P',
      company: 'Acme',
      address: '5 Park Lane',
      hasProfile: true,
      hasSavedAddress: true,
      orderCount: 1,
    });
    expect(edit.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await api.auditCount(t.orgId, 'wa_customer_profiles', 'insert')).toBe(1);

    // still one row, now a profile; the order is untouched; the same edit again updates (no second profile)
    const list = await get(t, '/v2/store/customers');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: edit.body.id, hasProfile: true, orderCount: 1 });
    const again = await api
      .as(t.admin)
      .put('/v2/store/customers/phone:917999834066')
      .send({ name: 'Shubham P', address: 'Moved' });
    expect(again.body).toMatchObject({ id: edit.body.id, address: 'Moved', company: null });
    expect(
      await q(`SELECT count(*)::int n FROM wa_customer_profiles WHERE org_id = $1`, [t.orgId]),
    ).toEqual([{ n: 1 }]);
    // saving the same number as typed locally lands on the same profile
    const saved = await api
      .as(t.admin)
      .post('/v2/store/customers')
      .send({ phone: '79998 34066', name: 'Typed locally' });
    expect(saved.body).toMatchObject({ id: edit.body.id, name: 'Typed locally' });

    expect((await api.as(t.admin).delete(`/v2/store/customers/${edit.body.id}`)).status).toBe(204);
    // the buyer is still listed from the order
    const after = await get(t, '/v2/store/customers');
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0]).toMatchObject({ id: 'phone:917999834066', hasProfile: false });
  });

  it('merges a profile saved as a bare local number with the same buyer typed with a country code', async () => {
    const t = await api.signup('localprofile');
    await q(
      `INSERT INTO wa_customer_profiles (org_id, phone, name) VALUES ($1, '9800009999', 'Local Lee')`,
      [t.orgId],
    );
    await order(t, { phone: '+91 98000 09999', name: 'Lee order' });
    const list = await get(t, '/v2/store/customers');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      phone: '9800009999',
      name: 'Local Lee',
      hasProfile: true,
      orderCount: 1,
    });
  });

  it('is isolated per workspace: the same number is a different buyer, and another workspace sees nothing', async () => {
    const a = await api.signup('isoa');
    const b = await api.signup('isob');
    await order(a, { phone: '919830000001', name: 'Only in A' });
    await api
      .as(a.admin)
      .post('/v2/store/customers')
      .send({ phone: '919830000002', name: 'Saved in A' });
    expect((await get(b, '/v2/store/customers')).body.data).toEqual([]);
    expect((await get(b, '/v2/store/customers/phone:919830000001')).status).toBe(404);
    const aList = await get(a, '/v2/store/customers');
    const savedId = aList.body.data.find((c: any) => c.phone === '919830000002').id;
    expect((await get(b, `/v2/store/customers/${savedId}`)).status).toBe(404);
    // B can order and save the same numbers independently
    await order(b, { phone: '919830000001', name: 'Only in B' });
    const bList = await get(b, '/v2/store/customers');
    expect(bList.body.data.map((c: any) => c.name)).toEqual(['Only in B']);
    const edit = await api
      .as(b.admin)
      .put('/v2/store/customers/phone:919830000001')
      .send({ name: 'B edit' });
    expect(edit.status).toBe(200);
    expect((await get(a, '/v2/store/customers')).body.data.map((c: any) => c.name).sort()).toEqual([
      'Only in A',
      'Saved in A',
    ]);
    expect(await q(`SELECT org_id FROM wa_customer_profiles WHERE phone = '919830000001'`)).toEqual(
      [{ org_id: Number(b.orgId) }],
    );
  });
});

describe('order writers keep the saved profile in step', () => {
  async function merchant(label: string) {
    const t = await api.signup(label);
    const s = await shopFor(t);
    const product = await q(
      `INSERT INTO wa_products (org_id, name, slug, price_minor, stock_qty, in_stock, status, currency_code)
       VALUES ($1,'Tea','tea-' || $2,10000,NULL,true,'active','INR') RETURNING uuid`,
      [t.orgId, Math.random().toString(36).slice(2, 7)],
    );
    return { t, slug: s.slug, product: product[0].uuid as string };
  }
  const checkout = async (
    m: { slug: string; product: string },
    body: { name?: string; phone: string; address?: string },
  ) => {
    const res = await api
      .http()
      .post(`/v2/store-public/${m.slug}/checkout`)
      .set('x-forwarded-for', ip())
      .send({ name: 'Asha', items: [{ id: m.product, qty: 1 }], ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };

  it('a public checkout saves the buyer (name, phone, address) in the same transaction, fills only empty fields later, and lists them', async () => {
    const m = await merchant('chk');
    await checkout(m, { phone: '9876543210', address: '12 Main St' });
    const profiles = await q(`SELECT * FROM wa_customer_profiles WHERE org_id = $1`, [m.t.orgId]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      phone: '919876543210',
      name: 'Asha',
      address: '12 Main St',
    });
    expect(profiles[0].contact_id).not.toBeNull();
    const row = (await get(m.t, '/v2/store/customers')).body.data[0];
    expect(row).toMatchObject({
      phone: '919876543210',
      hasProfile: true,
      hasSavedAddress: true,
      orderCount: 1,
      name: 'Asha',
    });
    expect(row.contactId).toEqual(expect.any(String));

    // the merchant edits the profile; a later order with other details never overwrites it
    await api
      .as(m.t.admin)
      .put(`/v2/store/customers/${row.id}`)
      .send({ name: 'Asha Rao (VIP)', company: 'Acme', address: 'Edited address' });
    const versionBefore = (
      await q(`SELECT row_version FROM wa_customer_profiles WHERE org_id = $1`, [m.t.orgId])
    )[0].row_version;
    await checkout(m, {
      name: 'Someone Else',
      phone: '+91 98765 43210',
      address: 'Another address',
    });
    const after = (await q(`SELECT * FROM wa_customer_profiles WHERE org_id = $1`, [m.t.orgId]))[0];
    expect(after).toMatchObject({
      name: 'Asha Rao (VIP)',
      company: 'Acme',
      address: 'Edited address',
    });
    // nothing to fill: the row was not even rewritten
    expect(after.row_version).toBe(versionBefore);
    expect((await get(m.t, '/v2/store/customers')).body.data).toHaveLength(1);

    // an empty address IS filled by the next order
    await api.as(m.t.admin).put(`/v2/store/customers/${row.id}`).send({ name: 'Asha Rao (VIP)' });
    await checkout(m, { name: 'Asha', phone: '919876543210', address: 'Filled in' });
    expect(
      (await q(`SELECT address, name FROM wa_customer_profiles WHERE org_id = $1`, [m.t.orgId]))[0],
    ).toMatchObject({ address: 'Filled in', name: 'Asha Rao (VIP)' });
  });
});
