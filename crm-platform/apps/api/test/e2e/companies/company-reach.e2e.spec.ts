import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DealsApi,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../deals-pipelines/support';
import { mintKey, v1 } from '../developer-rest-api-v1/support';

/**
 * The reach of company properties (BL-196) end to end through HTTP: a condition and an order on the companies list, the CSV export and
 * import, a rule on the company of a contact in a segment, `{{company.*}}` merge tags, and the company resource of the customer API.
 * One app, one database; the blocks share one organization with the same companies.
 */
let h: Harness;
let api: DealsApi;
let t: Tenant;

beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
  t = await api.signup('reach');
  const section = await api
    .as(t.admin)
    .post('/v2/field-sections')
    .send({ moduleKey: 'companies', name: 'Account' });
  expect(section.status, JSON.stringify(section.body)).toBe(201);
  const make = async (body: Record<string, unknown>) => {
    const res = await api
      .as(t.admin)
      .post('/v2/fields')
      .send({ moduleKey: 'companies', sectionId: section.body.id, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  };
  await make({
    key: 'tier',
    label: 'Tier',
    fieldType: 'select',
    options: ['gold', 'silver', 'bronze'].map((v) => ({ value: v, label: v })),
  });
  await make({ key: 'seats', label: 'Seats', fieldType: 'integer' });
  await make({ key: 'renewal', label: 'Renewal', fieldType: 'date' });
  await make({ key: 'vip', label: 'VIP', fieldType: 'checkbox' });
  await make({
    key: 'channels',
    label: 'Channels',
    fieldType: 'multiselect',
    options: ['email', 'sms'].map((v) => ({ value: v, label: v })),
  });
  await make({ key: 'secret', label: 'Secret', fieldType: 'text', isMasked: true });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;
let phone = 7_000_000;
const nextPhone = () => `+9198${String(phone++).padStart(8, '0')}`;

interface Company {
  id: string;
  name: string;
  customFields: Record<string, unknown>;
}

async function company(body: Record<string, unknown>): Promise<Company> {
  const res = await api.as(t.admin).post('/v2/companies').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Company;
}
const ids = (r: { body: { data: Array<{ name: string }> } }) => r.body.data.map((c) => c.name);
const props = (...conds: Array<Record<string, unknown>>) => JSON.stringify(conds);
const list = (qs: string) => api.as(t.admin).get(`/v2/companies?${qs}`);

let acme: Company;
let cargo: Company;

beforeAll(async () => {
  acme = await company({
    name: 'Acme',
    website: 'acme.example',
    industry: 'Logistics',
    customFields: { tier: 'gold', seats: 50, renewal: '2026-12-01', vip: true, channels: ['email'] },
  });
  await company({
    name: 'Bolt',
    industry: 'Retail',
    customFields: { tier: 'silver', seats: 10, renewal: '2026-03-01' },
  });
  cargo = await company({
    name: 'Cargo',
    customFields: { tier: 'gold', seats: 200, channels: ['email', 'sms'], secret: 'hunter2' },
  });
  await company({ name: 'Delta' });
}, 120_000);

describe('a condition on a company property', () => {
  it('filters by the operators of the property kind, all conditions together', async () => {
    expect(ids(await list(`props=${encodeURIComponent(props({ key: 'tier', operator: 'equals', value: 'gold' }))}&sort=name`))).toEqual([
      'Acme',
      'Cargo',
    ]);
    const big = await list(
      `props=${encodeURIComponent(props({ key: 'seats', operator: 'between', value: { from: 20, to: 100 } }))}`,
    );
    expect(ids(big)).toEqual(['Acme']);
    const both = await list(
      `sort=name&props=${encodeURIComponent(
        props(
          { key: 'tier', operator: 'equals', value: 'gold' },
          { key: 'channels', operator: 'has_all', value: ['email', 'sms'] },
        ),
      )}`,
    );
    expect(ids(both)).toEqual(['Cargo']);
    const empty = await list(
      `props=${encodeURIComponent(props({ key: 'seats', operator: 'is_empty' }))}`,
    );
    expect(ids(empty)).toEqual(['Delta']);
    const renew = await list(
      `props=${encodeURIComponent(props({ key: 'renewal', operator: 'before', value: '2026-06-01' }))}`,
    );
    expect(ids(renew)).toEqual(['Bolt']);
    const vip = await list(`props=${encodeURIComponent(props({ key: 'vip', operator: 'is_true' }))}`);
    expect(ids(vip)).toEqual(['Acme']);
  });

  it('the tiles follow the same conditions', async () => {
    const res = await api
      .as(t.admin)
      .get(
        `/v2/companies/stats?props=${encodeURIComponent(props({ key: 'tier', operator: 'equals', value: 'gold' }))}`,
      );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it('refuses a property that does not exist, an operator that does not suit it, a masked property and broken JSON', async () => {
    for (const bad of [
      props({ key: 'ghost', operator: 'equals', value: 'x' }),
      props({ key: 'seats', operator: 'contains', value: '5' }),
      props({ key: 'secret', operator: 'equals', value: 'hunter2' }),
    ]) {
      const res = await list(`props=${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(422);
      expect(code(res)).toBe('COMPANY_FILTER_INVALID');
    }
    const broken = await list('props=%7Bnot-json');
    expect(broken.status).toBe(400);
    const tooMany = await list(
      `props=${encodeURIComponent(props(...Array.from({ length: 11 }, () => ({ key: 'tier', operator: 'is_empty' }))))}`,
    );
    expect(tooMany.status).toBe(400);
  });
});

describe('an order by a company property', () => {
  it('orders by a number, empty values lowest, in both directions', async () => {
    expect(ids(await list('sort=property&sortKey=seats'))).toEqual(['Delta', 'Bolt', 'Acme', 'Cargo']);
    expect(ids(await list('sort=property&sortKey=seats&sortDir=desc'))).toEqual([
      'Cargo',
      'Acme',
      'Bolt',
      'Delta',
    ]);
  });

  it('orders by an option and by a date', async () => {
    expect(ids(await list('sort=property&sortKey=tier&sortDir=desc')).slice(0, 1)).toEqual(['Bolt']);
    expect(ids(await list('sort=property&sortKey=renewal'))).toEqual(['Cargo', 'Delta', 'Bolt', 'Acme']);
  });

  it('pages by cursor without skipping or repeating a company, whatever the order', async () => {
    for (const q of ['sort=property&sortKey=seats', 'sort=property&sortKey=tier&sortDir=desc']) {
      const all = ids(await list(`${q}&limit=10`));
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 6; guard += 1) {
        const page = await list(`${q}&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
        expect(page.status, JSON.stringify(page.body)).toBe(200);
        seen.push(...ids(page));
        cursor = page.body.page.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual(all);
    }
  });

  it('a cursor cannot be replayed against another order, and a list of values has no order', async () => {
    const page = await list('sort=property&sortKey=seats&limit=1');
    const cursor = page.body.page.nextCursor as string;
    expect((await list(`sort=property&sortKey=tier&limit=1&cursor=${cursor}`)).status).toBe(400);
    expect((await list(`sort=name&limit=1&cursor=${cursor}`)).status).toBe(400);
    const multi = await list('sort=property&sortKey=channels');
    expect(multi.status).toBe(422);
    expect(code(multi)).toBe('COMPANY_FILTER_INVALID');
    expect((await list('sort=property')).status).toBe(400);
  });
});

describe('the CSV export', () => {
  const exportOf = (qs = '') => api.as(t.admin).get(`/v2/companies/export${qs}`);

  it('holds the list as filtered and ordered, with the properties as columns and no masked one', async () => {
    const res = await exportOf(
      `?sort=name&props=${encodeURIComponent(props({ key: 'tier', operator: 'equals', value: 'gold' }))}`,
    );
    expect(res.status, res.text).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.replace(/^﻿/, '').trim().split('\n');
    expect(lines[0]).toBe('name,website,email,phone,industry,sizeRange,address,notes,owner,createdAt,Tier,Seats,Renewal,VIP,Channels');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^Acme,acme\.example,,,Logistics,,,,.+,.+,gold,50,2026-12-01,true,email$/);
    expect(lines[2]).toMatch(/^Cargo,.*,gold,200,,,email; sms$/);
    expect(res.text).not.toContain('hunter2');
  });

  it('chooses the columns and their order, and refuses an unknown one', async () => {
    const res = await exportOf('?sort=name&columns=property:seats,name');
    expect(res.text.replace(/^﻿/, '').split('\n').slice(0, 2)).toEqual(['Seats,name', '50,Acme']);
    const bad = await exportOf('?columns=name,property:secret');
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('COMPANY_FILTER_INVALID');
  });

  it('does not let a spreadsheet read a name as a formula', async () => {
    await company({ name: '=HYPERLINK("http://x")' });
    const res = await exportOf('?columns=name&sort=created');
    expect(res.text).toContain("'=HYPERLINK");
  });

  it('is audited, and needs its own permission and its record scope', async () => {
    const audit = await h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'company_exports' AND action = 'export'`,
      [t.orgId],
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);

    const reader = await api.member(t, 'reader', [['record.companies.read']] as Grant[]);
    expect((await api.as(reader.token).get('/v2/companies/export')).status).toBe(403);
    const own = await api.member(t, 'ownexp', [
      ['record.companies.read', 'own'],
      ['record.companies.create'],
      ['record.companies.export', 'own'],
    ] as Grant[]);
    const mine = await api.as(own.token).post('/v2/companies').send({ name: 'Only Mine' });
    expect(mine.status).toBe(201);
    const file = await api.as(own.token).get('/v2/companies/export?columns=name');
    expect(file.status).toBe(200);
    expect(file.text.replace(/^﻿/, '').trim().split('\n')).toEqual(['name', 'Only Mine']);
  });
});

describe('the CSV import', () => {
  const importCsv = (csv: string, matchExisting = true, token = t.admin) =>
    api.as(token).post('/v2/companies/import').send({ csv, matchExisting });

  it('creates, fills the blanks of a company that exists, and reports each bad row with its line', async () => {
    const csv = [
      'Name,Website,Industry,Tier,Seats,VIP,Channels,Owner,Mystery',
      'Zenith,zenith.example,Energy,GOLD,"1,200",yes,Email;SMS,,x',
      'Acme Renamed,https://www.acme.example/about,Other,silver,5,,,,x',
      'Broken Tier,,,platinum,,,,,x',
      ',,,,,,,,x',
      'Bad Email Co,,,,,,,,x',
    ].join('\n');
    const res = await importCsv(csv.replace('Bad Email Co,,,,,,,,x', 'Bad Email Co,,,,,,,nobody@nowhere.test,x'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ total: 5, created: 1, updated: 1, unchanged: 0 });
    expect(res.body.ignoredColumns).toEqual(['Mystery']);
    expect(res.body.failed.map((f: { line: number }) => f.line)).toEqual([4, 5, 6]);
    expect(res.body.failed[0]).toMatchObject({ field: 'tier' });
    expect(res.body.failed[2]).toMatchObject({ field: 'owner' });

    const zenith = (await list('q=Zenith')).body.data[0];
    expect(zenith.customFields).toMatchObject({
      tier: 'gold',
      seats: 1200,
      vip: true,
      channels: ['email', 'sms'],
    });
    // The company that exists kept what a person typed and only had its blanks filled.
    const after = (await api.as(t.admin).get(`/v2/companies/${acme.id}`)).body;
    expect(after.name).toBe('Acme');
    expect(after.industry).toBe('Logistics');
    expect(after.customFields.tier).toBe('gold');
    expect(after.customFields.seats).toBe(50);
  });

  it('with matchExisting off it always creates, and a same-name company is a second company (as on the form)', async () => {
    const res = await importCsv('Name,Website\nAcme,acme.example', false);
    expect(res.body).toMatchObject({ created: 1, updated: 0 });
    expect((await list('q=Acme&limit=50')).body.data.filter((c: { name: string }) => c.name === 'Acme')).toHaveLength(2);
  });

  it('refuses a file it cannot read at all', async () => {
    for (const csv of ['Industry\nRetail', 'Tier\ngold']) {
      const res = await importCsv(csv);
      expect(res.status, csv).toBe(422);
      expect(code(res)).toBe('COMPANY_IMPORT_INVALID');
    }
    const many = `Name\n${Array.from({ length: 1001 }, (_, i) => `Co ${i}`).join('\n')}`;
    expect(code(await importCsv(many))).toBe('COMPANY_IMPORT_INVALID');
  });

  it('needs the import permission and the right to create', async () => {
    const maker = await api.member(t, 'maker', [['record.companies.create']] as Grant[]);
    expect((await importCsv('Name\nNope', true, maker.token)).status).toBe(403);
    const importer = await api.member(t, 'importer', [['record.companies.import']] as Grant[]);
    expect((await importCsv('Name\nNope', true, importer.token)).status).toBe(403);
    expect((await list('q=Nope')).body.data).toHaveLength(0);
  });

  it('does not fill a company outside the importer scope (it makes a new one)', async () => {
    const rep = await api.member(t, 'rep', [
      ['record.companies.read', 'own'],
      ['record.companies.create'],
      ['record.companies.update', 'own'],
      ['record.companies.import'],
    ] as Grant[]);
    const res = await importCsv('Name,Website,Industry\nCargo Copy,cargo-copy.example,Rail\nBolt,,Hacked', true, rep.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ created: 2, updated: 0 });
    const bolt = (await list('q=Bolt')).body.data[0];
    expect(bolt.industry).toBe('Retail');
  });
});

describe('a rule on the company of a contact', () => {
  let goldPeople = 0;
  beforeAll(async () => {
    for (const [name, co] of [
      ['Anya', acme],
      ['Bram', cargo],
      ['Chen', null],
    ] as const) {
      const res = await api
        .as(t.admin)
        .post('/v2/contacts')
        .send({ name, phone: nextPhone(), ...(co ? { companyId: co.id } : {}) });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      if (co) goldPeople += 1;
    }
  }, 60_000);

  const rules = (field: string, operator: string, value?: unknown) => ({
    type: 'group',
    combinator: 'and',
    children: [{ type: 'condition', field, operator, ...(value === undefined ? {} : { value }) }],
  });
  const preview = (r: object) => api.as(t.admin).post('/v2/segments/preview').send({ rules: r });

  it('counts the contacts whose company has the value, and treats a contact with no company as empty', async () => {
    const gold = await preview(rules('company.tier', 'equals', 'gold'));
    expect(gold.status, JSON.stringify(gold.body)).toBe(200);
    expect(gold.body.count).toBe(goldPeople);
    expect(gold.body.invalidConditions).toEqual([]);
    const none = await preview(rules('company.tier', 'is_empty'));
    expect(none.body.count).toBe(1);
    const notGold = await preview(rules('company.tier', 'not_equals', 'gold'));
    expect(notGold.body.count).toBe(1);
  });

  it('a property that does not exist is refused on save and flagged when it was deleted later', async () => {
    const ghost = await preview(rules('company.ghost', 'equals', 'x'));
    expect(ghost.status).toBe(422);
    const saved = await api
      .as(t.admin)
      .post('/v2/segments')
      .send({ name: 'Gold companies', rules: rules('company.tier', 'equals', 'gold') });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    const tier = (await api.as(t.admin).get('/v2/fields?moduleKey=companies')).body.data.find(
      (f: { key: string }) => f.key === 'tier',
    );
    const usage = await api.as(t.admin).get('/v2/fields/usage?moduleKey=companies');
    expect(usage.body.data.find((u: { key: string }) => u.key === 'tier').segments).toBe(1);
    const del = await api.as(t.admin).delete(`/v2/fields/${tier.id}`);
    expect(del.status, JSON.stringify(del.body)).toBeLessThan(300);
    const after = await api.as(t.admin).get(`/v2/segments/${saved.body.id}`);
    expect(after.body.invalidConditions?.[0]?.field ?? after.body.invalid?.[0]?.field).toBe('company.tier');
  });

  it('a person who may not read companies cannot filter on them', async () => {
    const contactsOnly = await api.member(t, 'contactsonly', [
      ['record.contacts.read'],
      ['record.segments.read'],
      ['record.segments.create'],
    ] as Grant[]);
    const res = await api
      .as(contactsOnly.token)
      .post('/v2/segments/preview')
      .send({ rules: rules('company.seats', 'gt', 10) });
    expect(res.status).toBe(403);
  });
});

describe('merge tags from the company of a contact', () => {
  it('fills {{company.*}} for a contact with a company, and leaves nothing for one without', async () => {
    const withCo = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Tag Person', phone: nextPhone(), companyId: acme.id });
    expect(withCo.status).toBe(201);
    const without = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Solo Person', phone: nextPhone() });
    const template = '[{{company.industry}}][{{company.seats}}][{{company}}][{{company.secret}}]';
    const a = await api.as(t.admin).post('/v2/attributes/resolve').send({ template, contactId: withCo.body.id });
    expect(a.body.rendered).toBe('[Logistics][50][Acme][]');
    const b = await api.as(t.admin).post('/v2/attributes/resolve').send({ template, contactId: without.body.id });
    expect(b.body.rendered).toBe('[][][][]');
  });

  it('lists the tokens in the picker catalogue for someone who may read companies', async () => {
    const res = await api.as(t.admin).get('/v2/attributes/catalog');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const group = res.body.groups.find((g: { group: string }) => g.group === 'company');
    const keys = group.items.map((i: { key: string }) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['company', 'company.industry', 'company.tier', 'company.seats']));
    const blind = await api.member(t, 'blind', [['record.contacts.read']] as Grant[]);
    const none = await api.as(blind.token).get('/v2/attributes/catalog');
    expect(none.body.groups.find((g: { group: string }) => g.group === 'company').items).toEqual([]);
  });
});

describe('the company resource of the customer API', () => {
  it('reads and writes companies with their custom fields, under companies scopes and the sales pipeline plan', async () => {
    const tenant = await api.signup('reach-v1');
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb) ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
      [tenant.orgId, JSON.stringify({ features: { sales_pipeline: true } })],
    );
    const section = await api
      .as(tenant.admin)
      .post('/v2/field-sections')
      .send({ moduleKey: 'companies', name: 'Account' });
    await api
      .as(tenant.admin)
      .post('/v2/fields')
      .send({
        moduleKey: 'companies',
        sectionId: section.body.id,
        key: 'seats',
        label: 'Seats',
        fieldType: 'integer',
      });
    const key = await mintKey(api, tenant, 'companies key', ['companies:write']);
    const call = v1(h, key.secret);

    const made = await call.post('/companies', {
      name: 'Via API',
      industry: 'Retail',
      size_range: '11-50',
      custom_fields: { seats: 12 },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const id = made.body.data.id as string;
    expect(made.body.data).toMatchObject({
      name: 'Via API',
      size_range: '11-50',
      custom_fields: { seats: 12 },
    });

    const bad = await call.post('/companies', { name: 'Bad', custom_fields: { seats: 'many' } });
    expect(bad.status).toBe(422);

    const changed = await call.put(`/companies/${id}`, { industry: null, custom_fields: { seats: 40 } });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.data).toMatchObject({ name: 'Via API', industry: null, custom_fields: { seats: 40 } });

    const listed = await call.get('/companies?search=via');
    expect(listed.body.data.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await call.get(`/companies/${id}`)).status).toBe(200);
    expect((await call.get('/companies/not-a-uuid')).status).toBe(404);

    // read-only key: reads, never writes
    await h.owner.query(`UPDATE api_keys SET scopes = ARRAY['companies:read'] WHERE org_id = $1`, [tenant.orgId]);
    expect((await call.get('/companies')).status).toBe(200);
    expect((await call.post('/companies', { name: 'Nope' })).status).toBe(403);
    expect((await call.delete(`/companies/${id}`)).status).toBe(403);

    // another scope never reaches companies
    await h.owner.query(`UPDATE api_keys SET scopes = ARRAY['contacts:read'] WHERE org_id = $1`, [tenant.orgId]);
    expect((await call.get('/companies')).status).toBe(403);

    // a plan without the sales pipeline refuses every route
    await h.owner.query(`UPDATE api_keys SET scopes = '{}' WHERE org_id = $1`, [tenant.orgId]);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`,
      [tenant.orgId, JSON.stringify({ features: { sales_pipeline: false } })],
    );
    expect((await call.get('/companies')).status).toBe(403);
  });
});
