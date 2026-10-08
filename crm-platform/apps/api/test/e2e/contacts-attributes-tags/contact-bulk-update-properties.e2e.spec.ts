import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';

/** Bulk update of custom properties: POST /v2/contacts/bulk/update with `values.customFields`. */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('bulk update: custom properties', () => {
  let t: Tenant;
  let other: Tenant;
  let sectionId: string;
  let a: string;
  let b: string;
  let foreign: string;
  let inactiveId: string;

  async function field(tenant: Tenant, body: Record<string, unknown>, section = sectionId) {
    const res = await api
      .as(tenant.admin)
      .post('/v2/fields')
      .send({ moduleKey: 'contacts', sectionId: section, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; rowVersion: number };
  }
  const update = (token: string, ids: string[], customFields: Record<string, unknown>) =>
    api.as(token).post('/v2/contacts/bulk/update').send({ ids, values: { customFields } });
  const read = async (id: string) =>
    (await api.as(t.admin).get(`/v2/contacts/${id}`)).body as {
      customFields: Record<string, unknown>;
    };

  beforeAll(async () => {
    t = await api.signup('bp');
    other = await api.signup('bpo');
    const section = await api
      .as(t.admin)
      .post('/v2/field-sections')
      .send({ moduleKey: 'contacts', name: 'Extra' });
    sectionId = section.body.id;
    await field(t, { key: 'city', label: 'City', fieldType: 'text' });
    await field(t, { key: 'budget', label: 'Budget', fieldType: 'integer' });
    await field(t, {
      key: 'tier',
      label: 'Tier',
      fieldType: 'select',
      options: [
        { value: 'gold', label: 'Gold' },
        { value: 'silver', label: 'Silver' },
      ],
    });
    await field(t, { key: 'vip', label: 'VIP', fieldType: 'checkbox' });
    inactiveId = (await field(t, { key: 'old_prop', label: 'Old', fieldType: 'text' })).id;
    const off = await api
      .as(t.admin)
      .patch(`/v2/fields/${inactiveId}`)
      .send({ isActive: false, rowVersion: 1 });
    expect(off.status, JSON.stringify(off.body)).toBe(200);

    const osection = await api
      .as(other.admin)
      .post('/v2/field-sections')
      .send({ moduleKey: 'contacts', name: 'Extra' });
    await field(other, { key: 'city', label: 'City', fieldType: 'text' }, osection.body.id);

    [a, b] = await api.seedContacts(t, [
      { name: 'A', phone: '+919811200001', data: { city: 'Delhi', budget: 5, note: 'keep-a' } },
      { name: 'B', phone: '+919811200002', data: { budget: 9, note: 'keep-b' } },
    ]);
    [foreign] = await api.seedContacts(other, [
      { name: 'Foreign', phone: '+919811200003', data: { city: 'Mumbai' } },
    ]);
  });

  it('sets typed values on every selected contact and keeps their other keys', async () => {
    const res = await update(t.admin, [a, b], { city: 'Pune', tier: 'gold', vip: true });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(res.body.succeeded.sort()).toEqual([a, b].sort());
    expect(res.body.failed).toEqual([]);
    expect((await read(a)).customFields).toMatchObject({
      city: 'Pune',
      tier: 'gold',
      vip: true,
      budget: 5,
      note: 'keep-a',
    });
    expect((await read(b)).customFields).toMatchObject({
      city: 'Pune',
      tier: 'gold',
      vip: true,
      budget: 9,
      note: 'keep-b',
    });
  });

  it('records which keys changed (not their values) in the audit trail and the event', async () => {
    await update(t.admin, [a], { budget: 77 });
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND action = 'update'
         AND delta->'customFieldKeys' IS NOT NULL ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(audit.rows[0].delta.customFieldKeys.new).toEqual(['budget']);
    expect(JSON.stringify(audit.rows[0].delta)).not.toContain('77');
    const events = await api.events(t.orgId, 'contact.updated');
    expect(events.some((e) => JSON.stringify(e.customFieldKeys) === '["budget"]')).toBe(true);
  });

  it('null clears only the chosen key, on every selected contact', async () => {
    const res = await update(t.admin, [a, b], { city: null });
    expect(res.body.succeeded).toHaveLength(2);
    for (const id of [a, b]) {
      const cf = (await read(id)).customFields;
      expect(cf).not.toHaveProperty('city');
      expect(cf).toMatchObject({ tier: 'gold', vip: true, note: expect.any(String) });
    }
    expect((await read(a)).customFields.budget).toBe(77);
  });

  it("another workspace's contact is never touched, even when its id is sent", async () => {
    const res = await update(t.admin, [a, foreign], { city: 'Goa' });
    expect(res.body.succeeded).toEqual([a]);
    expect(res.body.failed.map((f: { id: string }) => f.id)).toEqual([foreign]);
    const row = await h.owner.query(`SELECT data FROM contacts WHERE uuid = $1`, [foreign]);
    expect(row.rows[0].data).toEqual({ city: 'Mumbai' });
  });

  it('an unknown, inactive or system key is 422 CON_PROPERTY_NOT_EDITABLE and nothing is written', async () => {
    for (const key of ['ghost', 'old_prop', 'first_name']) {
      const res = await update(t.admin, [a, b], { city: 'Nowhere', [key]: 'x' });
      expect(res.status, key).toBe(422);
      expect(res.body.code).toBe('CON_PROPERTY_NOT_EDITABLE');
      expect(res.body.errors).toEqual([
        { path: `customFields.${key}`, message: expect.any(String) },
      ]);
    }
    expect((await read(a)).customFields.city).toBe('Goa');
    expect((await read(b)).customFields).not.toHaveProperty('city');
  });

  it('a value of the wrong type is 422 VALIDATION_FAILED for the whole request, no partial write', async () => {
    const before = [await read(a), await read(b)];
    for (const bad of [
      { city: 'Fine', budget: 'lots' },
      { city: 'Fine', tier: 'bronze' },
      { city: 'Fine', vip: 'maybe' },
    ]) {
      const res = await update(t.admin, [a, b], bad);
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    expect([await read(a), await read(b)]).toEqual(before);
  });

  it('a member without the update capability is refused', async () => {
    const reader = await api.member(t, 'bpread', [['record.contacts.read']]);
    const res = await update(reader.token, [a], { city: 'Blocked' });
    expect(res.status).toBe(403);
    expect((await read(a)).customFields.city).toBe('Goa');
  });
});
