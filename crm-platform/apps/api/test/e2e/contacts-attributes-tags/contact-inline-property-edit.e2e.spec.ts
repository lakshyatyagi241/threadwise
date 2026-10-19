import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * The in-place edit of the job title on the contact header (and every other single-property inline edit) sends
 * `PATCH /contacts/:id { customFields: { job_title }, rowVersion }`. It failed with the generic "could not be saved" toast on workspaces
 * that had OTHER required properties the contact never had a value for, because every save that touched a custom property answered for
 * ALL required properties (CON_REQUIRED_PROPERTY_MISSING naming properties the person never mentioned).
 *
 * The rule now (see `requiredScopeOfEdit`): a save answers for the properties it names (the full contact form sends all of its
 * properties, so it still answers for all of them) and for the properties the edit itself makes required (a dependent whose condition
 * now holds). One shape per case below, each through HTTP.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 600_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;
const paths = (res: { body: { errors?: Array<{ path: string }> } }) =>
  (res.body.errors ?? []).map((e) => e.path);

interface Field {
  id: string;
  rowVersion: number;
  options?: Array<{ id: string; value: string }>;
}

class Workspace {
  sectionId!: string;
  constructor(readonly t: Tenant) {}

  static async create(label: string) {
    const w = new Workspace(await api.signup(label));
    const section = await api
      .as(w.t.admin)
      .post('/v2/field-sections')
      .send({ moduleKey: 'contacts', name: 'Extra' });
    expect(section.status, JSON.stringify(section.body)).toBe(201);
    w.sectionId = section.body.id;
    return w;
  }

  async field(body: Record<string, unknown>): Promise<Field> {
    const res = await api
      .as(this.t.admin)
      .post('/v2/fields')
      .send({ moduleKey: 'contacts', sectionId: this.sectionId, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as Field;
  }

  async patchField(f: Field, patch: Record<string, unknown>): Promise<Field> {
    const res = await api
      .as(this.t.admin)
      .patch(`/v2/fields/${f.id}`)
      .send({ ...patch, rowVersion: f.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Field;
  }

  /** A contact that predates whatever was configured afterwards: arranged straight in the table. */
  async oldContact(
    phone: string,
    data: Record<string, unknown> = {},
    ownerId: number | null = null,
  ) {
    const [uuid] = await api.seedContacts(this.t, [{ name: 'Old contact', phone, data, ownerId }]);
    return uuid!;
  }

  async rowVersion(uuid: string): Promise<number> {
    return (await api.as(this.t.admin).get(`/v2/contacts/${uuid}`)).body.rowVersion as number;
  }

  /** What the header does: one property, the row version it loaded. */
  async inline(
    token: string,
    uuid: string,
    customFields: Record<string, unknown>,
    rowVersion?: number,
  ) {
    // The version is read first: a supertest request starts its own listener when it is created, so two in flight at once collide.
    const version = rowVersion ?? (await this.rowVersion(uuid));
    return api.as(token).patch(`/v2/contacts/${uuid}`).send({ customFields, rowVersion: version });
  }
}

describe('inline job title edit on a workspace with other required properties', () => {
  let w: Workspace;
  let budget: Field;

  beforeAll(async () => {
    w = await Workspace.create('jt');
    await w.field({ key: 'job_title', label: 'Job title', fieldType: 'text' });
    budget = await w.field({ key: 'budget', label: 'Budget', fieldType: 'integer' });
    // Made required after the contacts exist: they never had a value for it.
    budget = await w.patchField(budget, { isRequired: true });
  });

  it('a contact that predates a newly required property keeps an inline edit of another property', async () => {
    const uuid = await w.oldContact('+919820000001');
    const res = await w.inline(w.t.admin, uuid, { job_title: 'Head of Sales' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.customFields.job_title).toBe('Head of Sales');
    expect(res.body.customFields.budget).toBeUndefined();
  });

  it('a contact created without a value for the required property (stored empty) saves it too', async () => {
    const uuid = await w.oldContact('+919820000002', { budget: null });
    const res = await w.inline(w.t.admin, uuid, { job_title: 'Founder' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('the property an edit names is still held to the rule: it may not be blanked', async () => {
    const uuid = await w.oldContact('+919820000003', { budget: 5 });
    const blank = await w.inline(w.t.admin, uuid, { budget: null });
    expect(blank.status).toBe(422);
    expect(code(blank)).toBe('CON_REQUIRED_PROPERTY_MISSING');
    expect(paths(blank)).toEqual(['customFields.budget']);
    const still = await w.inline(w.t.admin, uuid, { budget: 9 });
    expect(still.status, JSON.stringify(still.body)).toBe(200);
  });

  it('the full form (it sends every property, blank ones as null) still answers for all of them', async () => {
    const uuid = await w.oldContact('+919820000004');
    const form = await w.inline(w.t.admin, uuid, { job_title: 'CEO', budget: null });
    expect(form.status).toBe(422);
    expect(code(form)).toBe('CON_REQUIRED_PROPERTY_MISSING');
    expect(paths(form)).toEqual(['customFields.budget']);
    const filled = await w.inline(w.t.admin, uuid, { job_title: 'CEO', budget: 3 });
    expect(filled.status, JSON.stringify(filled.body)).toBe(200);
  });

  it('create still answers for every required property', async () => {
    const res = await api
      .as(w.t.admin)
      .post('/v2/contacts')
      .send({ phone: '+919820000005', customFields: { job_title: 'x' } });
    expect(res.status).toBe(422);
    expect(paths(res)).toEqual(['customFields.budget']);
  });

  it('a contact with no owner can have its job title edited', async () => {
    const uuid = await w.oldContact('+919820000006', {}, null);
    const before = (await api.as(w.t.admin).get(`/v2/contacts/${uuid}`)).body;
    expect(before.ownerId).toBeNull();
    const res = await w.inline(w.t.admin, uuid, { job_title: 'Owner unset' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ownerId).toBeNull();
  });

  it('a stale row version is 409 ROW_VERSION_CONFLICT (the header reloads and says so)', async () => {
    const uuid = await w.oldContact('+919820000007');
    const loaded = await w.rowVersion(uuid);
    const first = await w.inline(w.t.admin, uuid, { job_title: 'First' }, loaded);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const stale = await w.inline(w.t.admin, uuid, { job_title: 'Second' }, loaded);
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
  });
});

describe('a dependent required property', () => {
  let w: Workspace;

  beforeAll(async () => {
    w = await Workspace.create('dep');
    await w.field({ key: 'job_title', label: 'Job title', fieldType: 'text' });
    const needsVisa = await w.field({
      key: 'needs_visa',
      label: 'Needs visa',
      fieldType: 'select',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    });
    const visaType = await w.field({
      key: 'visa_type',
      label: 'Visa type',
      fieldType: 'text',
      isRequired: true,
    });
    const yes = needsVisa.options!.find((o) => o.value === 'yes')!;
    const dep = await api.as(w.t.admin).post('/v2/fields/dependencies').send({
      fieldId: visaType.id,
      dependsOnFieldId: needsVisa.id,
      dependsOnOptionId: yes.id,
    });
    expect(dep.status, JSON.stringify(dep.body)).toBe(201);
  });

  it('a contact already in the "yes" state without the dependent value still saves an unrelated inline edit', async () => {
    const uuid = await w.oldContact('+919830000001', { needs_visa: 'yes' });
    const res = await w.inline(w.t.admin, uuid, { job_title: 'Analyst' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('an edit that makes the dependent required answers for it', async () => {
    const uuid = await w.oldContact('+919830000002');
    const res = await w.inline(w.t.admin, uuid, { needs_visa: 'yes' });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('CON_REQUIRED_PROPERTY_MISSING');
    expect(paths(res)).toEqual(['customFields.visa_type']);
    const both = await w.inline(w.t.admin, uuid, { needs_visa: 'yes', visa_type: 'F1' });
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    const no = await w.inline(w.t.admin, uuid, { needs_visa: 'no' });
    expect(no.status, JSON.stringify(no.body)).toBe(200);
  });
});

describe('the job title property itself', () => {
  it('required: an inline edit may not clear it, and says which property', async () => {
    const w = await Workspace.create('req');
    await w.field({ key: 'job_title', label: 'Job title', fieldType: 'text', isRequired: true });
    const uuid = await w.oldContact('+919840000001', { job_title: 'Lead' });
    const blank = await w.inline(w.t.admin, uuid, { job_title: '' });
    expect(blank.status).toBe(422);
    expect(code(blank)).toBe('CON_REQUIRED_PROPERTY_MISSING');
    expect(paths(blank)).toEqual(['customFields.job_title']);
    const ok = await w.inline(w.t.admin, uuid, { job_title: 'Director' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('read-only: 422 CON_PROPERTY_NOT_EDITABLE naming it', async () => {
    const w = await Workspace.create('ro');
    const f = await w.field({ key: 'job_title', label: 'Job title', fieldType: 'text' });
    await w.patchField(f, { isReadOnly: true });
    const uuid = await w.oldContact('+919840000002', { job_title: 'Set elsewhere' });
    const res = await w.inline(w.t.admin, uuid, { job_title: 'Changed' });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('CON_PROPERTY_NOT_EDITABLE');
    expect(paths(res)).toEqual(['customFields.job_title']);
  });

  it('hidden: 422 CON_PROPERTY_NOT_EDITABLE naming it', async () => {
    const w = await Workspace.create('hid');
    const f = await w.field({ key: 'job_title', label: 'Job title', fieldType: 'text' });
    await w.patchField(f, { isHidden: true });
    const uuid = await w.oldContact('+919840000003');
    const res = await w.inline(w.t.admin, uuid, { job_title: 'Nope' });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('CON_PROPERTY_NOT_EDITABLE');
  });
});

describe('who may make the edit', () => {
  let w: Workspace;
  let reader: { token: string; userId: number };
  let ownScope: { token: string; userId: number };
  let teamScope: { token: string; userId: number };

  beforeAll(async () => {
    w = await Workspace.create('role');
    await w.field({ key: 'job_title', label: 'Job title', fieldType: 'text' });
    reader = await api.member(w.t, 'reader', [['record.contacts.read']]);
    ownScope = await api.member(w.t, 'own', [
      ['record.contacts.read'],
      ['record.contacts.update', 'own'],
    ]);
    teamScope = await api.member(w.t, 'team', [
      ['record.contacts.read'],
      ['record.contacts.update', 'team'],
    ]);
  });

  it('a role without the update permission is 403 FORBIDDEN', async () => {
    const uuid = await w.oldContact('+919850000001', {}, ownScope.userId);
    const res = await w.inline(reader.token, uuid, { job_title: 'x' }, 1);
    expect(res.status).toBe(403);
    expect(code(res)).toBe('FORBIDDEN');
  });

  it('update scope "own": the contact they own saves; an unowned or someone else\'s contact is 404', async () => {
    const mine = await w.oldContact('+919850000002', {}, ownScope.userId);
    const ok = await w.inline(ownScope.token, mine, { job_title: 'Mine' }, 1);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const unowned = await w.oldContact('+919850000003', {}, null);
    const none = await w.inline(ownScope.token, unowned, { job_title: 'x' }, 1);
    expect(none.status).toBe(404);
    const others = await w.oldContact('+919850000004', {}, w.t.adminUserId);
    const other = await w.inline(ownScope.token, others, { job_title: 'x' }, 1);
    expect(other.status).toBe(404);
  });

  it('update scope "team": an unowned contact is outside it (404)', async () => {
    const unowned = await w.oldContact('+919850000005', {}, null);
    const res = await w.inline(teamScope.token, unowned, { job_title: 'x' }, 1);
    expect(res.status).toBe(404);
  });
});
