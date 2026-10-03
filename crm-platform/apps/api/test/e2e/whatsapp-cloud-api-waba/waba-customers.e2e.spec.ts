import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness } from '../contacts-attributes-tags/support';

/** Saved customer profiles end to end (WD-WABA-055, 056): the real API over a real Postgres, RLS and permission keys included. */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

const put = (token: string, body: Record<string, unknown>) =>
  api.as(token).put('/v2/waba/customers').send(body);

describe('saved customers', () => {
  it('stores the digits of a phone, and saving the same phone again updates instead of duplicating', async () => {
    const t = await api.signup('cu1');
    const first = await put(t.admin, {
      phone: '+91 98765-43210',
      name: 'Asha',
      address: '12 MG Road',
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      phone: '919876543210',
      name: 'Asha',
      address: '12 MG Road',
      company: null,
    });
    const again = await put(t.admin, {
      phone: '919876543210',
      name: 'Asha K',
      company: '  ',
      address: '',
    });
    expect(again.body.id).toBe(first.body.id);
    expect(again.body).toMatchObject({ name: 'Asha K', company: null, address: null });
    const list = await api.as(t.admin).get('/v2/waba/customers');
    expect(list.body.total).toBe(1);
  });

  it('refuses a phone with no digits', async () => {
    const t = await api.signup('cu2');
    const res = await put(t.admin, { phone: 'call me' });
    expect(res.status).toBe(422);
  });

  it('searches name, phone and company with the term taken literally, and pages by 20', async () => {
    const t = await api.signup('cu3');
    await put(t.admin, { phone: '9100000001', name: 'Acme Traders', company: 'Acme' });
    await put(t.admin, { phone: '9100000002', name: '100% Honey', company: 'Bee' });
    await put(t.admin, { phone: '9100000003', name: 'Zed' });
    const byName = await api.as(t.admin).get('/v2/waba/customers').query({ q: 'acme' });
    expect(byName.body.items.map((i: { phone: string }) => i.phone)).toEqual(['9100000001']);
    const literal = await api.as(t.admin).get('/v2/waba/customers').query({ q: '%' });
    expect(literal.body.items.map((i: { phone: string }) => i.phone)).toEqual(['9100000002']);
    const byPhone = await api.as(t.admin).get('/v2/waba/customers').query({ q: '0003' });
    expect(byPhone.body.items).toHaveLength(1);
    for (let i = 0; i < 22; i++)
      await put(t.admin, { phone: `92000000${String(i).padStart(2, '0')}`, name: `N${i}` });
    const page2 = await api.as(t.admin).get('/v2/waba/customers').query({ page: 2 });
    expect(page2.body).toMatchObject({ page: 2, pageSize: 20, total: 25 });
    expect(page2.body.items).toHaveLength(5);
  });

  it('is private to the workspace: another workspace sees nothing and cannot delete the profile', async () => {
    const a = await api.signup('cu4');
    const b = await api.signup('cu5');
    const saved = await put(a.admin, { phone: '9300000001', name: 'Mine' });
    expect((await api.as(b.admin).get('/v2/waba/customers')).body.total).toBe(0);
    expect((await api.as(b.admin).delete(`/v2/waba/customers/${saved.body.id}`)).status).toBe(404);
    expect((await api.as(a.admin).get('/v2/waba/customers')).body.total).toBe(1);
  });

  it('removes only the profile and keeps the orders; reading and managing are separate keys', async () => {
    const t = await api.signup('cu6');
    const saved = await put(t.admin, { phone: '9400000001', name: 'Gone' });
    await h.owner.query(
      `INSERT INTO wa_orders (org_id, source, customer_phone, total_minor, items_json) VALUES ($1, 'waba', '9400000001', 1000, '[]')`,
      [t.orgId],
    );
    const reader = await api.member(t, 'reader', [['waba.customers.read']]);
    expect((await api.as(reader.token).get('/v2/waba/customers')).status).toBe(200);
    expect((await api.as(reader.token).delete(`/v2/waba/customers/${saved.body.id}`)).status).toBe(
      403,
    );
    expect((await put(reader.token, { phone: '9400000002' })).status).toBe(403);
    expect((await api.as(t.admin).delete(`/v2/waba/customers/${saved.body.id}`)).status).toBe(204);
    expect((await api.as(t.admin).get('/v2/waba/customers')).body.total).toBe(0);
    const orders = await h.owner.query(`SELECT 1 FROM wa_orders WHERE org_id = $1`, [t.orgId]);
    expect(orders.rows).toHaveLength(1);
  });
});
