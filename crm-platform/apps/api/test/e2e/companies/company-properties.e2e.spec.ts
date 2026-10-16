import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DealsApi, startHarness, type Harness, type Tenant } from '../deals-pipelines/support';

/**
 * Company properties end to end through HTTP (BL-034): the workspace defines its own fields for companies in the shared field
 * registry (`moduleKey: companies`), and a company stores and returns their values as `customFields`. A value must fit its
 * property, a required property must be answered, a property that is not editable is refused, the usage count reads the companies,
 * and the front-line presets can read the definitions (so the company form can draw them). One app, one database.
 */
let h: Harness;
let api: DealsApi;

beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;

interface Company {
  id: string;
  name: string;
  customFields: Record<string, unknown>;
  rowVersion: number;
}

async function section(token: string, name = 'Billing') {
  const res = await api.as(token).post('/v2/field-sections').send({ moduleKey: 'companies', name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string };
}

async function property(token: string, sectionId: string, body: Record<string, unknown>) {
  const res = await api
    .as(token)
    .post('/v2/fields')
    .send({ moduleKey: 'companies', sectionId, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; key: string; rowVersion: number };
}

async function company(token: string, body: Record<string, unknown>) {
  const res = await api.as(token).post('/v2/companies').send(body);
  return res;
}

const ok = async (token: string, body: Record<string, unknown>): Promise<Company> => {
  const res = await company(token, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Company;
};

describe('values of company properties', () => {
  let t: Tenant;
  let sec: { id: string };
  beforeAll(async () => {
    t = await api.signup('cpv');
    sec = await section(t.admin);
    await property(t.admin, sec.id, {
      key: 'tier',
      label: 'Tier',
      fieldType: 'select',
      options: [
        { value: 'gold', label: 'Gold' },
        { value: 'silver', label: 'Silver' },
      ],
    });
    await property(t.admin, sec.id, { key: 'seats', label: 'Seats', fieldType: 'integer' });
    await property(t.admin, sec.id, { key: 'renewal', label: 'Renewal', fieldType: 'date' });
    await property(t.admin, sec.id, { key: 'vip', label: 'VIP', fieldType: 'checkbox' });
    await property(t.admin, sec.id, {
      key: 'channels',
      label: 'Channels',
      fieldType: 'multiselect',
      options: [
        { value: 'email', label: 'Email' },
        { value: 'phone', label: 'Phone' },
      ],
    });
    await property(t.admin, sec.id, {
      key: 'locked',
      label: 'Locked',
      fieldType: 'text',
      isReadOnly: true,
    });
  });

  it('a company is created with values, and they come back on the create, the read and the list', async () => {
    const co = await ok(t.admin, {
      name: 'With values',
      customFields: {
        tier: 'gold',
        seats: 12,
        renewal: '2027-01-31',
        vip: true,
        channels: ['email'],
      },
    });
    expect(co.customFields).toEqual({
      tier: 'gold',
      seats: 12,
      renewal: '2027-01-31',
      vip: true,
      channels: ['email'],
    });
    const read = await api.as(t.admin).get(`/v2/companies/${co.id}`);
    expect(read.body.customFields).toEqual(co.customFields);
    const list = await api.as(t.admin).get('/v2/companies?q=With%20values');
    expect(list.body.data[0].customFields).toEqual(co.customFields);
    const plain = await ok(t.admin, { name: 'No values' });
    expect(plain.customFields).toEqual({});
  });

  it('an edit merges: a key sent changes, null or blank clears it, a key left out keeps its value; it is audited by key, never by value', async () => {
    const co = await ok(t.admin, {
      name: 'Merge me',
      customFields: { tier: 'gold', seats: 5, vip: true },
    });
    const res = await api
      .as(t.admin)
      .patch(`/v2/companies/${co.id}`)
      .send({
        customFields: { seats: null, tier: 'silver', vip: false },
        rowVersion: co.rowVersion,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.customFields).toEqual({ tier: 'silver' });
    expect(res.body.rowVersion).toBe(co.rowVersion + 1);

    const rows = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'companies' AND action = 'update'
        AND record_id = (SELECT id FROM companies WHERE uuid = $2) ORDER BY id DESC LIMIT 1`,
      [t.orgId, co.id],
    );
    const delta = rows.rows[0].delta as Record<string, { old: unknown; new: unknown }>;
    expect(delta.customFieldKeys!.new).toEqual(['seats', 'tier', 'vip']);
    expect(JSON.stringify(delta)).not.toContain('silver');
    const events = await api.events(t.orgId, 'company.updated');
    expect(
      events.some((e) => (e.changed as string[] | undefined)?.includes('customFieldKeys')),
    ).toBe(true);
  });

  it('an edit that sends the values it loaded changes nothing: no new version, no audit row', async () => {
    const co = await ok(t.admin, { name: 'Same again', customFields: { tier: 'gold', seats: 2 } });
    const before = await api.count(
      t.orgId,
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'companies' AND action = 'update'`,
    );
    const res = await api
      .as(t.admin)
      .patch(`/v2/companies/${co.id}`)
      .send({ customFields: co.customFields, rowVersion: co.rowVersion });
    expect(res.status).toBe(200);
    expect(res.body.rowVersion).toBe(co.rowVersion);
    expect(
      await api.count(
        t.orgId,
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'companies' AND action = 'update'`,
      ),
    ).toBe(before);
  });

  it('a key that is not an editable property is 422 COMPANY_PROPERTY_NOT_EDITABLE, naming it, and nothing is written', async () => {
    const co = await ok(t.admin, { name: 'Strict', customFields: { tier: 'gold' } });
    for (const key of ['ghost', 'locked']) {
      const res = await api
        .as(t.admin)
        .patch(`/v2/companies/${co.id}`)
        .send({ customFields: { seats: 9, [key]: 'x' }, rowVersion: co.rowVersion });
      expect(res.status, key).toBe(422);
      expect(code(res)).toBe('COMPANY_PROPERTY_NOT_EDITABLE');
      expect(res.body.errors).toEqual([expect.objectContaining({ path: `customFields.${key}` })]);
    }
    const after = await api.as(t.admin).get(`/v2/companies/${co.id}`);
    expect(after.body.customFields).toEqual({ tier: 'gold' });
    expect(after.body.rowVersion).toBe(co.rowVersion);
    const create = await company(t.admin, { name: 'Strict create', customFields: { ghost: 'x' } });
    expect(create.status).toBe(422);
  });

  it('a value that does not fit its property is 422 COMPANY_PROPERTY_INVALID, naming each key', async () => {
    const res = await company(t.admin, {
      name: 'Bad values',
      customFields: {
        tier: 'bronze',
        seats: 1.5,
        renewal: '2027-02-30',
        channels: ['email', 'fax'],
      },
    });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('COMPANY_PROPERTY_INVALID');
    expect((res.body.errors as Array<{ path: string }>).map((e) => e.path).sort()).toEqual([
      'customFields.channels',
      'customFields.renewal',
      'customFields.seats',
      'customFields.tier',
    ]);
    // a value of the wrong JSON type is refused by the contract before it gets that far
    const wrongShape = await company(t.admin, {
      name: 'Bad shape',
      customFields: { seats: { n: 1 } },
    });
    expect(wrongShape.status).toBe(422);
    expect(code(wrongShape)).toBe('VALIDATION_FAILED');
  });

  it('a deactivated property can no longer be written, but its stored values stay and a save that does not touch it works', async () => {
    const tt = await api.signup('cpd');
    const s = await section(tt.admin);
    const note = await property(tt.admin, s.id, {
      key: 'note_x',
      label: 'Note',
      fieldType: 'text',
    });
    const co = await ok(tt.admin, { name: 'Keeps value', customFields: { note_x: 'hello' } });
    const off = await api.as(tt.admin).delete(`/v2/fields/${note.id}`);
    expect(off.status).toBe(204);
    const touch = await api
      .as(tt.admin)
      .patch(`/v2/companies/${co.id}`)
      .send({ customFields: { note_x: 'changed' }, rowVersion: co.rowVersion });
    expect(touch.status).toBe(422);
    expect(code(touch)).toBe('COMPANY_PROPERTY_NOT_EDITABLE');
    const rename = await api
      .as(tt.admin)
      .patch(`/v2/companies/${co.id}`)
      .send({ name: 'Renamed', customFields: { note_x: 'hello' }, rowVersion: co.rowVersion });
    expect(rename.status, JSON.stringify(rename.body)).toBe(200);
    expect(rename.body.customFields).toEqual({ note_x: 'hello' });
  });

  it('the properties screen’s usage count reads the companies that hold a value', async () => {
    const tt = await api.signup('cpu');
    const s = await section(tt.admin);
    const used = await property(tt.admin, s.id, { key: 'tier', label: 'Tier', fieldType: 'text' });
    const unused = await property(tt.admin, s.id, {
      key: 'other',
      label: 'Other',
      fieldType: 'text',
    });
    await ok(tt.admin, { name: 'A', customFields: { tier: 'x' } });
    await ok(tt.admin, { name: 'B', customFields: { tier: 'y' } });
    await ok(tt.admin, { name: 'C' });
    const res = await api.as(tt.admin).get('/v2/fields/usage?moduleKey=companies');
    expect(res.status).toBe(200);
    const byId = new Map(
      (res.body.data as Array<{ id: string; count: number }>).map((r) => [r.id, r.count]),
    );
    expect(byId.get(used.id)).toBe(2);
    expect(byId.get(unused.id)).toBe(0);
    // contacts keep their own count
    const contacts = await api.as(tt.admin).get('/v2/fields/usage?moduleKey=contacts');
    expect((contacts.body.data as Array<{ id: string }>).some((r) => r.id === used.id)).toBe(false);
  });
});

describe('required company properties', () => {
  let t: Tenant;
  let sec: { id: string };
  beforeAll(async () => {
    t = await api.signup('cpr');
    sec = await section(t.admin);
  });

  it('a company cannot be created without an answer, and cannot lose it; an edit that sends no properties is not held to them', async () => {
    const before = await ok(t.admin, { name: 'Before the rule' });
    await property(t.admin, sec.id, {
      key: 'vat',
      label: 'VAT number',
      fieldType: 'text',
      isRequired: true,
    });

    const missing = await company(t.admin, { name: 'No VAT' });
    expect(missing.status).toBe(422);
    expect(code(missing)).toBe('COMPANY_REQUIRED_PROPERTY_MISSING');
    expect(missing.body.errors).toEqual([{ path: 'customFields.vat', message: 'required' }]);
    const blank = await company(t.admin, { name: 'Blank VAT', customFields: { vat: '   ' } });
    expect(blank.status).toBe(422);

    const made = await ok(t.admin, { name: 'With VAT', customFields: { vat: 'DE123' } });
    const cleared = await api
      .as(t.admin)
      .patch(`/v2/companies/${made.id}`)
      .send({ customFields: { vat: null }, rowVersion: made.rowVersion });
    expect(cleared.status).toBe(422);
    expect(code(cleared)).toBe('COMPANY_REQUIRED_PROPERTY_MISSING');

    // a company that predates the rule stays editable until a save answers for the properties
    const rename = await api
      .as(t.admin)
      .patch(`/v2/companies/${before.id}`)
      .send({ name: 'Still editable', rowVersion: before.rowVersion });
    expect(rename.status).toBe(200);
    const withProps = await api
      .as(t.admin)
      .patch(`/v2/companies/${before.id}`)
      .send({ customFields: { vat: 'FR1' }, rowVersion: rename.body.rowVersion });
    expect(withProps.status).toBe(200);
  });

  it('a property with a "show only when" rule is required only when the rule holds', async () => {
    const tt = await api.signup('cpc');
    const s = await section(tt.admin);
    const region = await property(tt.admin, s.id, {
      key: 'region',
      label: 'Region',
      fieldType: 'select',
      options: [
        { value: 'eu', label: 'EU' },
        { value: 'us', label: 'US' },
      ],
    });
    const vat = await property(tt.admin, s.id, {
      key: 'vat',
      label: 'VAT',
      fieldType: 'text',
      isRequired: true,
    });
    const dep = await api
      .as(tt.admin)
      .post('/v2/fields/dependencies')
      .send({ fieldId: vat.id, dependsOnFieldId: region.id, dependsOnValue: 'eu' });
    expect(dep.status, JSON.stringify(dep.body)).toBe(201);

    expect((await company(tt.admin, { name: 'No region' })).status).toBe(201);
    expect((await company(tt.admin, { name: 'US', customFields: { region: 'us' } })).status).toBe(
      201,
    );
    const eu = await company(tt.admin, { name: 'EU', customFields: { region: 'eu' } });
    expect(eu.status).toBe(422);
    expect(eu.body.errors).toEqual([{ path: 'customFields.vat', message: 'required' }]);
    expect(
      (await company(tt.admin, { name: 'EU ok', customFields: { region: 'eu', vat: 'DE1' } }))
        .status,
    ).toBe(201);
  });
});

describe('who may define and read company properties', () => {
  it('the Agent and Manager presets read the definitions (so the form can draw them); only the Owner and Admin define them', async () => {
    const t = await api.signup('cpp');
    const agent = await api.memberWithRole(t, 'cpagent', 'Agent');
    const manager = await api.memberWithRole(t, 'cpmanager', 'Manager');
    const s = await section(t.admin);
    await property(t.admin, s.id, { key: 'tier', label: 'Tier', fieldType: 'text' });
    for (const who of [agent, manager]) {
      const read = await api.as(who.token).get('/v2/fields?moduleKey=companies');
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect((read.body.data as Array<{ key: string }>).map((f) => f.key)).toContain('tier');
      const create = await api.as(who.token).post('/v2/fields').send({
        moduleKey: 'companies',
        sectionId: s.id,
        key: 'mine',
        label: 'Mine',
        fieldType: 'text',
      });
      expect(create.status).toBe(403);
    }
    // the Agent can create a company carrying a value of a property it can see
    const made = await api
      .as(agent.token)
      .post('/v2/companies')
      .send({ name: 'Agent made', customFields: { tier: 'gold' } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    // contact properties are untouched by this grant
    expect((await api.as(agent.token).get('/v2/fields?moduleKey=contacts')).status).toBe(403);
  });

  it('company properties and contact properties are separate capabilities', async () => {
    const t = await api.signup('cps');
    const onlyContacts = await api.member(t, 'cponly', [['record.contact-properties.read']]);
    expect((await api.as(onlyContacts.token).get('/v2/fields?moduleKey=contacts')).status).toBe(
      200,
    );
    expect((await api.as(onlyContacts.token).get('/v2/fields?moduleKey=companies')).status).toBe(
      403,
    );
  });
});
