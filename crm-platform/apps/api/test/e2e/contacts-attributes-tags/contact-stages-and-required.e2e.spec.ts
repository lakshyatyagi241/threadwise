import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * Two follow-ups on the contact registry, end to end through HTTP:
 *  - won / lost flags on lifecycle stages (status options), and what a contact gets for entering one;
 *  - required properties from the registry enforced on POST / PATCH /contacts, honouring dependencies.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;

interface StageOption {
  id: string;
  value: string;
  isWon: boolean;
  isLost: boolean;
  isDefault: boolean;
  rowVersion: number;
}

async function stage(
  t: Tenant,
  value: string,
  extra: Record<string, unknown> = {},
  group = 'lifecycle_stage',
) {
  const res = await api
    .as(t.admin)
    .post('/v2/status-options')
    .send({ moduleKey: 'contacts', optionGroup: group, value, label: value, ...extra });
  return res;
}

describe('won / lost stage flags', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('stg');
  });

  it('flags are stored and returned, default false', async () => {
    const plain = await stage(t, 'plain_stage');
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);
    expect(plain.body).toMatchObject({ isWon: false, isLost: false });
    const won = await stage(t, 'closed_won', { isWon: true });
    expect(won.body).toMatchObject({ isWon: true, isLost: false });
    const lost = await stage(t, 'closed_lost', { isLost: true });
    expect(lost.body).toMatchObject({ isWon: false, isLost: true });
  });

  it('both flags at once, or a flag outside lifecycle stages, is 422 STATUS_OPTION_FLAG_INVALID', async () => {
    const both = await stage(t, 'both_flags', { isWon: true, isLost: true });
    expect(both.status).toBe(422);
    expect(code(both)).toBe('STATUS_OPTION_FLAG_INVALID');
    const wrongGroup = await stage(t, 'lost_reason_x', { isLost: true }, 'lost_reason');
    expect(wrongGroup.status).toBe(422);
    expect(code(wrongGroup)).toBe('STATUS_OPTION_FLAG_INVALID');
    const patch = await api
      .as(t.admin)
      .patch(`/v2/status-options/${(await stage(t, 'to_patch')).body.id}`)
      .send({ isWon: true, isLost: true, rowVersion: 1 });
    expect(patch.status).toBe(422);
  });

  it('setting one flag on an update clears the other', async () => {
    const created = (await stage(t, 'swap_me', { isWon: true })).body as StageOption;
    const res = await api
      .as(t.admin)
      .patch(`/v2/status-options/${created.id}`)
      .send({ isLost: true, rowVersion: created.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ isWon: false, isLost: true });
  });

  it('a group keeps at most one default (the database enforces it, not just the service)', async () => {
    const a = (await stage(t, 'def_a', { isDefault: true })).body as StageOption;
    const b = (await stage(t, 'def_b', { isDefault: true })).body as StageOption;
    expect(b.isDefault).toBe(true);
    const list = await api
      .as(t.admin)
      .get('/v2/status-options?moduleKey=contacts&optionGroup=lifecycle_stage');
    const defaults = (list.body.data as StageOption[]).filter((o) => o.isDefault);
    expect(defaults.map((o) => o.value)).toEqual(['def_b']);
    expect(a.id).not.toBe(b.id);
    await expect(
      h.owner.query(
        `UPDATE status_options SET is_default = true WHERE org_id = $1 AND value IN ('def_a','def_b')`,
        [t.orgId],
      ),
    ).rejects.toThrow(/uq_status_options_one_default/);
  });

  it('a contact entering a won stage gets wonAt; leaving it clears the stamp', async () => {
    const created = await api.as(t.admin).post('/v2/contacts').send({ phone: '+919800000101' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.wonAt).toBeNull();
    const won = await api
      .as(t.admin)
      .patch(`/v2/contacts/${created.body.id}`)
      .send({ lifecycleStage: 'closed_won', rowVersion: created.body.rowVersion });
    expect(won.status, JSON.stringify(won.body)).toBe(200);
    expect(won.body.wonAt).not.toBeNull();
    expect(won.body.lostAt).toBeNull();
    const back = await api
      .as(t.admin)
      .patch(`/v2/contacts/${created.body.id}`)
      .send({ lifecycleStage: 'plain_stage', rowVersion: won.body.rowVersion });
    expect(back.body.wonAt).toBeNull();
  });

  it('a contact entering a lost stage needs a reason: 422 without, stamped and stored with', async () => {
    const created = await api.as(t.admin).post('/v2/contacts').send({ phone: '+919800000102' });
    const refused = await api
      .as(t.admin)
      .patch(`/v2/contacts/${created.body.id}`)
      .send({ lifecycleStage: 'closed_lost', rowVersion: created.body.rowVersion });
    expect(refused.status).toBe(422);
    expect(code(refused)).toBe('CON_LOST_REASON_REQUIRED');
    expect(refused.body.errors).toEqual([{ path: 'lostReason', message: 'required' }]);

    const ok = await api.as(t.admin).patch(`/v2/contacts/${created.body.id}`).send({
      lifecycleStage: 'closed_lost',
      otherLostReason: 'Went with a competitor',
      rowVersion: created.body.rowVersion,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      lifecycleStage: 'closed_lost',
      otherLostReason: 'Went with a competitor',
      wonAt: null,
    });
    expect(ok.body.lostAt).not.toBeNull();

    // Leaving lost drops the reason that described the loss.
    const reopened = await api
      .as(t.admin)
      .patch(`/v2/contacts/${created.body.id}`)
      .send({ lifecycleStage: 'plain_stage', rowVersion: ok.body.rowVersion });
    expect(reopened.body).toMatchObject({ lostAt: null, lostReason: null, otherLostReason: null });
  });

  it('a stage that is not flagged behaves exactly as before: no reason, no stamps', async () => {
    const created = await api.as(t.admin).post('/v2/contacts').send({ phone: '+919800000103' });
    const moved = await api
      .as(t.admin)
      .patch(`/v2/contacts/${created.body.id}`)
      .send({ lifecycleStage: 'plain_stage', rowVersion: created.body.rowVersion });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ wonAt: null, lostAt: null });
  });

  it('create straight into a lost stage needs the reason too; bulk reports the refusal per contact', async () => {
    const refused = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ phone: '+919800000104', lifecycleStage: 'closed_lost' });
    expect(refused.status).toBe(422);
    expect(code(refused)).toBe('CON_LOST_REASON_REQUIRED');
    const created = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ phone: '+919800000105', lifecycleStage: 'closed_lost', lostReason: 'price' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.lostAt).not.toBeNull();

    const target = await api.as(t.admin).post('/v2/contacts').send({ phone: '+919800000106' });
    const bulk = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/update')
      .send({ ids: [target.body.id], values: { lifecycleStage: 'closed_lost' } });
    expect(bulk.status, JSON.stringify(bulk.body)).toBeLessThan(300);
    expect(bulk.body.failed).toHaveLength(1);
    expect(bulk.body.failed[0].code).toBe('CON_LOST_REASON_REQUIRED');
    const bulkOk = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/update')
      .send({
        ids: [target.body.id],
        values: { lifecycleStage: 'closed_lost', otherLostReason: 'No budget' },
      });
    expect(bulkOk.body.succeeded).toEqual([target.body.id]);
    const after = await api.as(t.admin).get(`/v2/contacts/${target.body.id}`);
    expect(after.body).toMatchObject({ otherLostReason: 'No budget' });
    expect(after.body.lostAt).not.toBeNull();
  });

  it('deleting a stage and moving its contacts into a won stage stamps them', async () => {
    const doomed = (await stage(t, 'doomed')).body as StageOption;
    const c = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ phone: '+919800000107', lifecycleStage: 'doomed' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const target = (
      await api.as(t.admin).get('/v2/status-options?moduleKey=contacts&optionGroup=lifecycle_stage')
    ).body.data.find((o: StageOption) => o.value === 'closed_won') as StageOption;
    const del = await api.as(t.admin).delete(`/v2/status-options/${doomed.id}?moveTo=${target.id}`);
    expect(del.status, JSON.stringify(del.body)).toBeLessThan(300);
    const after = await api.as(t.admin).get(`/v2/contacts/${c.body.id}`);
    expect(after.body.lifecycleStage).toBe('closed_won');
    expect(after.body.wonAt).not.toBeNull();
  });
});

describe('required properties on create and update', () => {
  let t: Tenant;
  let sectionId: string;
  const fieldIds: Record<string, string> = {};

  async function field(body: Record<string, unknown>) {
    const res = await api
      .as(t.admin)
      .post('/v2/fields')
      .send({ moduleKey: 'contacts', sectionId, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    fieldIds[body.key as string] = res.body.id;
    return res.body as { id: string; options?: Array<{ id: string; value: string }> };
  }

  beforeAll(async () => {
    t = await api.signup('req');
    const section = await api
      .as(t.admin)
      .post('/v2/field-sections')
      .send({ moduleKey: 'contacts', name: 'Extra' });
    expect(section.status, JSON.stringify(section.body)).toBe(201);
    sectionId = section.body.id;

    await field({ key: 'budget', label: 'Budget', fieldType: 'integer', isRequired: true });
    const needsVisa = await field({
      key: 'needs_visa',
      label: 'Needs visa',
      fieldType: 'select',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    });
    const visaType = await field({
      key: 'visa_type',
      label: 'Visa type',
      fieldType: 'text',
      isRequired: true,
    });
    const yes = needsVisa.options!.find((o) => o.value === 'yes')!;
    const dep = await api.as(t.admin).post('/v2/fields/dependencies').send({
      fieldId: visaType.id,
      dependsOnFieldId: needsVisa.id,
      dependsOnOptionId: yes.id,
    });
    expect(dep.status, JSON.stringify(dep.body)).toBe(201);
    await field({ key: 'agree', label: 'Agrees', fieldType: 'checkbox', isRequired: true });
    await field({
      key: 'hidden_req',
      label: 'Hidden',
      fieldType: 'text',
      isRequired: true,
      isHidden: true,
    });
  });

  const create = (customFields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    api
      .as(t.admin)
      .post('/v2/contacts')
      .send({
        phone: `+9198${Math.floor(10000000 + Math.random() * 89999999)}`,
        customFields,
        ...extra,
      });

  it('create without a required property is 422 CON_REQUIRED_PROPERTY_MISSING naming the key', async () => {
    const res = await create({});
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(code(res)).toBe('CON_REQUIRED_PROPERTY_MISSING');
    expect(res.body.errors).toEqual([{ path: 'customFields.budget', message: 'required' }]);
    expect(String(res.body.detail)).toContain('Budget');
    const blank = await create({ budget: '   ' });
    expect(blank.status).toBe(422);
  });

  it('a value satisfies it, including zero; hidden fields and checkboxes are not enforced', async () => {
    const res = await create({ budget: 0 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.customFields.budget).toBe(0);
  });

  it('a dependent required property is required only when its condition holds', async () => {
    const no = await create({ budget: 10, needs_visa: 'no' });
    expect(no.status, JSON.stringify(no.body)).toBe(201);
    const yes = await create({ budget: 10, needs_visa: 'yes' });
    expect(yes.status).toBe(422);
    expect(yes.body.errors).toEqual([{ path: 'customFields.visa_type', message: 'required' }]);
    const both = await create({ needs_visa: 'yes' });
    expect(both.body.errors.map((e: { path: string }) => e.path)).toEqual([
      'customFields.budget',
      'customFields.visa_type',
    ]);
    const filled = await create({ budget: 10, needs_visa: 'yes', visa_type: 'F1' });
    expect(filled.status).toBe(201);
  });

  it('a save is held to the properties it names; a stage or owner change, or an edit of another property, is not', async () => {
    // A contact that predates the rule (arranged straight in the table).
    const [uuid] = await api.seedContacts(t, [{ name: 'Old contact', phone: '+919811100001' }]);
    const row = (await api.as(t.admin).get(`/v2/contacts/${uuid}`)).body;

    const stageOnly = await api
      .as(t.admin)
      .patch(`/v2/contacts/${uuid}`)
      .send({ source: 'import', rowVersion: row.rowVersion });
    expect(stageOnly.status, JSON.stringify(stageOnly.body)).toBe(200);

    // An inline edit of one property (the job title on the header) does not answer for a required property it never mentioned.
    const editsOther = await api
      .as(t.admin)
      .patch(`/v2/contacts/${uuid}`)
      .send({ customFields: { needs_visa: 'no' }, rowVersion: stageOnly.body.rowVersion });
    expect(editsOther.status, JSON.stringify(editsOther.body)).toBe(200);

    // The contact form sends every property, the blank required one as null: that save answers for it.
    const formSave = await api
      .as(t.admin)
      .patch(`/v2/contacts/${uuid}`)
      .send({
        customFields: { needs_visa: 'no', budget: null },
        rowVersion: editsOther.body.rowVersion,
      });
    expect(formSave.status).toBe(422);
    expect(formSave.body.errors).toEqual([{ path: 'customFields.budget', message: 'required' }]);

    const fixed = await api
      .as(t.admin)
      .patch(`/v2/contacts/${uuid}`)
      .send({ customFields: { budget: 5 }, rowVersion: editsOther.body.rowVersion });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);

    const clears = await api
      .as(t.admin)
      .patch(`/v2/contacts/${uuid}`)
      .send({ customFields: { budget: null }, rowVersion: fixed.body.rowVersion });
    expect(clears.status).toBe(422);
  });

  it('bulk edit may not blank a required property it sets, and reports it per contact', async () => {
    const ok = (await create({ budget: 1 })).body;
    const bulk = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/update')
      .send({ ids: [ok.id], values: { customFields: { budget: '' } } });
    expect(bulk.body.failed).toHaveLength(1);
    expect(bulk.body.failed[0].code).toBe('CON_REQUIRED_PROPERTY_MISSING');
  });

  it('turning a property required later does not break contacts that lack it', async () => {
    const [uuid] = await api.seedContacts(t, [{ name: 'Lacks city', phone: '+919811100002' }]);
    const city = await field({ key: 'city', label: 'City', fieldType: 'text' });
    const res = await api
      .as(t.admin)
      .patch(`/v2/fields/${city.id}`)
      .send({ isRequired: true, rowVersion: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (await api.as(t.admin).get(`/v2/contacts/${uuid}`)).body;
    const touch = await api
      .as(t.admin)
      .patch(`/v2/contacts/${uuid}`)
      .send({ source: 'x', rowVersion: row.rowVersion });
    expect(touch.status).toBe(200);
  });
});
