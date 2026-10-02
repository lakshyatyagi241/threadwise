import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * A contact's Status is a sub-state of its Lifecycle stage: status options may be scoped to one stage (stageOptionId), the
 * contact create / update / bulk-update rules keep the status valid for the stage, and a workspace that never scopes a status
 * behaves exactly as before. End to end through HTTP and the real database.
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

interface Option {
  id: string;
  value: string;
  stageOptionId: string | null;
  isDefault: boolean;
  rowVersion: number;
}

let phoneSeq = 0;
const phone = () => `+9198${String(10_000_000 + phoneSeq++)}`;

async function option(
  t: Tenant,
  group: string,
  value: string,
  extra: Record<string, unknown> = {},
) {
  return api
    .as(t.admin)
    .post('/v2/status-options')
    .send({ moduleKey: 'contacts', optionGroup: group, value, label: value, ...extra });
}

const stage = async (t: Tenant, value: string, extra: Record<string, unknown> = {}) =>
  (await option(t, 'lifecycle_stage', value, extra)).body as Option;

const status = async (t: Tenant, value: string, extra: Record<string, unknown> = {}) =>
  option(t, 'status', value, extra);

async function contact(t: Tenant, body: Record<string, unknown> = {}) {
  const res = await api
    .as(t.admin)
    .post('/v2/contacts')
    .send({ phone: phone(), ...body });
  return res;
}

const move = (t: Tenant, c: { id: string; rowVersion: number }, body: Record<string, unknown>) =>
  api
    .as(t.admin)
    .patch(`/v2/contacts/${c.id}`)
    .send({ ...body, rowVersion: c.rowVersion });

describe('scoping a status to a stage (status options)', () => {
  let t: Tenant;
  let qualified: Option;
  let other: Tenant;
  beforeAll(async () => {
    t = await api.signup('scope');
    other = await api.signup('scopeb');
    qualified = await stage(t, 'qualified');
    await stage(t, 'lost', { isLost: true });
  });

  it('a status can be scoped to a lifecycle stage of the workspace; the answer carries stageOptionId', async () => {
    const res = await status(t, 'quote_sent', { stageOptionId: qualified.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.stageOptionId).toBe(qualified.id);
    const free = await status(t, 'do_not_contact');
    expect(free.body.stageOptionId).toBeNull();
    const list = await api
      .as(t.admin)
      .get('/v2/status-options?moduleKey=contacts&optionGroup=status');
    const byValue = new Map((list.body.data as Option[]).map((o) => [o.value, o]));
    expect(byValue.get('quote_sent')?.stageOptionId).toBe(qualified.id);
    expect(byValue.get('do_not_contact')?.stageOptionId).toBeNull();
  });

  it('the scope must be a lifecycle stage: 422 STATUS_OPTION_STAGE_INVALID otherwise', async () => {
    const notAStage = (await status(t, 'plain_one')).body as Option;
    const toStatus = await status(t, 'bad_scope', { stageOptionId: notAStage.id });
    expect(toStatus.status).toBe(422);
    expect(code(toStatus)).toBe('STATUS_OPTION_STAGE_INVALID');
    // A stage cannot be scoped (only statuses can), and neither can a lost reason.
    const stageScoped = await option(t, 'lifecycle_stage', 'scoped_stage', {
      stageOptionId: qualified.id,
    });
    expect(stageScoped.status).toBe(422);
    expect(code(stageScoped)).toBe('STATUS_OPTION_STAGE_INVALID');
    const reason = await option(t, 'lost_reason', 'scoped_reason', { stageOptionId: qualified.id });
    expect(code(reason)).toBe('STATUS_OPTION_STAGE_INVALID');
  });

  it("another workspace's stage is not found, and the database refuses the cross-workspace reference too", async () => {
    const foreign = await stage(other, 'foreign_stage');
    const res = await status(t, 'to_foreign', { stageOptionId: foreign.id });
    expect(res.status).toBe(404);
    const mine = await api
      .as(t.admin)
      .get('/v2/status-options?moduleKey=contacts&optionGroup=status');
    const row = (mine.body.data as Option[]).find((o) => o.value === 'quote_sent')!;
    const foreignId = (
      await h.owner.query(
        `SELECT id FROM status_options WHERE org_id = $1 AND value = 'foreign_stage'`,
        [other.orgId],
      )
    ).rows[0].id;
    await expect(
      h.owner.query(
        `UPDATE status_options SET stage_option_id = $3 WHERE org_id = $1 AND uuid = $2`,
        [t.orgId, row.id, foreignId],
      ),
    ).rejects.toThrow(/fk_status_options_stage/);
  });

  it('the scope can be changed and cleared; a stale rowVersion is still a 409', async () => {
    const created = (await status(t, 'movable')).body as Option;
    const scoped = await api
      .as(t.admin)
      .patch(`/v2/status-options/${created.id}`)
      .send({ stageOptionId: qualified.id, rowVersion: created.rowVersion });
    expect(scoped.status, JSON.stringify(scoped.body)).toBe(200);
    expect(scoped.body.stageOptionId).toBe(qualified.id);
    const kept = await api
      .as(t.admin)
      .patch(`/v2/status-options/${created.id}`)
      .send({ label: 'Movable!', rowVersion: scoped.body.rowVersion });
    expect(kept.body.stageOptionId).toBe(qualified.id);
    const cleared = await api
      .as(t.admin)
      .patch(`/v2/status-options/${created.id}`)
      .send({ stageOptionId: null, rowVersion: kept.body.rowVersion });
    expect(cleared.body.stageOptionId).toBeNull();
    const stale = await api
      .as(t.admin)
      .patch(`/v2/status-options/${created.id}`)
      .send({ stageOptionId: qualified.id, rowVersion: created.rowVersion });
    expect(stale.status).toBe(409);
  });

  it('each stage keeps at most one default status (the database enforces it), next to the unscoped one', async () => {
    const a = (await status(t, 'q_default_a', { stageOptionId: qualified.id, isDefault: true }))
      .body as Option;
    const b = (await status(t, 'q_default_b', { stageOptionId: qualified.id, isDefault: true }))
      .body as Option;
    const unscoped = (await status(t, 'any_default', { isDefault: true })).body as Option;
    expect(b.isDefault && unscoped.isDefault).toBe(true);
    const list = await api
      .as(t.admin)
      .get('/v2/status-options?moduleKey=contacts&optionGroup=status');
    const defaults = (list.body.data as Option[]).filter((o) => o.isDefault).map((o) => o.value);
    expect(defaults.sort()).toEqual(['any_default', 'q_default_b']);
    expect(a.id).not.toBe(b.id);
    await expect(
      h.owner.query(
        `UPDATE status_options SET is_default = true WHERE org_id = $1 AND value IN ('q_default_a','q_default_b')`,
        [t.orgId],
      ),
    ).rejects.toThrow(/uq_status_options_one_default/);
  });

  it('a default that moves into a scope that already has one gives way, unless asked explicitly', async () => {
    const lostStage = (
      (
        await api
          .as(t.admin)
          .get('/v2/status-options?moduleKey=contacts&optionGroup=lifecycle_stage')
      ).body.data as Option[]
    ).find((o) => o.value === 'lost')!;
    const first = (
      await status(t, 'lost_default', { stageOptionId: lostStage.id, isDefault: true })
    ).body as Option;
    const mover = (await status(t, 'mover_default', { isDefault: false })).body as Option;
    const armed = await api
      .as(t.admin)
      .patch(`/v2/status-options/${mover.id}`)
      .send({ isDefault: true, rowVersion: mover.rowVersion });
    // The unscoped default is now "mover_default"; moving it into Lost (which has one) keeps Lost's.
    const moved = await api
      .as(t.admin)
      .patch(`/v2/status-options/${mover.id}`)
      .send({ stageOptionId: lostStage.id, rowVersion: armed.body.rowVersion });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({ stageOptionId: lostStage.id, isDefault: false });
    const rows = (
      await api.as(t.admin).get('/v2/status-options?moduleKey=contacts&optionGroup=status')
    ).body.data as Option[];
    expect(rows.find((o) => o.id === first.id)?.isDefault).toBe(true);
  });
});

describe('contact create / update / bulk update keep status valid for the stage', () => {
  let t: Tenant;
  let qualifiedId: string;
  beforeAll(async () => {
    t = await api.signup('rules');
    await stage(t, 'new', { isDefault: true });
    qualifiedId = (await stage(t, 'qualified')).id;
    const lostId = (await stage(t, 'lost', { isLost: true })).id;
    await stage(t, 'won', { isWon: true });
    await status(t, 'waiting_for_quote', { stageOptionId: qualifiedId, isDefault: true });
    await status(t, 'quote_sent', { stageOptionId: qualifiedId });
    await status(t, 'not_interested', { stageOptionId: lostId, isDefault: true });
    await status(t, 'do_not_contact');
  });

  it('a new contact starts in the default stage with no status when that stage has no default', async () => {
    const res = await contact(t);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ lifecycleStage: 'new', status: null });
  });

  it('create into a stage with a default status gets it; an explicit status of that stage wins', async () => {
    const res = await contact(t, { lifecycleStage: 'qualified' });
    expect(res.body).toMatchObject({ lifecycleStage: 'qualified', status: 'waiting_for_quote' });
    const explicit = await contact(t, { lifecycleStage: 'qualified', status: 'quote_sent' });
    expect(explicit.body.status).toBe('quote_sent');
    const anywhere = await contact(t, { lifecycleStage: 'new', status: 'do_not_contact' });
    expect(anywhere.body.status).toBe('do_not_contact');
  });

  it('create with a status of another stage is 422 CON_STATUS_STAGE_MISMATCH naming the stage', async () => {
    const res = await contact(t, { lifecycleStage: 'new', status: 'quote_sent' });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('CON_STATUS_STAGE_MISMATCH');
    expect(res.body.errors[0].path).toBe('status');
    expect(res.body.errors[0].message).toContain('qualified');
    expect(res.body.errors[0].message).toContain('new');
  });

  it('moving to a stage resets a status that does not fit to its default, or to none', async () => {
    const c = (await contact(t, { lifecycleStage: 'qualified', status: 'quote_sent' })).body;
    const lost = await move(t, c, { lifecycleStage: 'lost', otherLostReason: 'Went elsewhere' });
    expect(lost.status, JSON.stringify(lost.body)).toBe(200);
    expect(lost.body).toMatchObject({ lifecycleStage: 'lost', status: 'not_interested' });
    const won = await move(t, lost.body, { lifecycleStage: 'won' });
    expect(won.body).toMatchObject({ lifecycleStage: 'won', status: null });
    const back = await move(t, won.body, { lifecycleStage: 'qualified' });
    expect(back.body.status).toBe('waiting_for_quote');
  });

  it('a status that is valid in the new stage (unscoped, or the same stage) is kept', async () => {
    const c = (await contact(t, { lifecycleStage: 'qualified', status: 'do_not_contact' })).body;
    const moved = await move(t, c, { lifecycleStage: 'won' });
    expect(moved.body.status).toBe('do_not_contact');
  });

  it('a request that moves the stage and sends the stale status back still resets (it is not an explicit choice)', async () => {
    const c = (await contact(t, { lifecycleStage: 'qualified', status: 'quote_sent' })).body;
    const moved = await move(t, c, {
      lifecycleStage: 'lost',
      status: 'quote_sent',
      otherLostReason: 'x',
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.status).toBe('not_interested');
  });

  it('setting a status of another stage on update is 422; of the contact stage, or clearing it, is fine', async () => {
    const c = (await contact(t, { lifecycleStage: 'qualified' })).body;
    const bad = await move(t, c, { status: 'not_interested' });
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('CON_STATUS_STAGE_MISMATCH');
    const ok = await move(t, c, { status: 'quote_sent' });
    expect(ok.body.status).toBe('quote_sent');
    const cleared = await move(t, ok.body, { status: null });
    expect(cleared.body.status).toBeNull();
    // Move and set together: the new status is judged against the NEW stage.
    const both = await move(t, cleared.body, {
      lifecycleStage: 'lost',
      status: 'not_interested',
      otherLostReason: 'x',
    });
    expect(both.body).toMatchObject({ lifecycleStage: 'lost', status: 'not_interested' });
    const wrongBoth = await move(t, both.body, { lifecycleStage: 'new', status: 'quote_sent' });
    expect(code(wrongBoth)).toBe('CON_STATUS_STAGE_MISMATCH');
  });

  it('editing other fields of a contact whose status is out of scope is not blocked', async () => {
    const c = (await contact(t, { lifecycleStage: 'qualified', status: 'quote_sent' })).body;
    await h.owner.query(
      `UPDATE contacts SET lifecycle_stage = 'new' WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, c.id],
    );
    const fresh = (await api.as(t.admin).get(`/v2/contacts/${c.id}`)).body;
    const renamed = await move(t, fresh, { firstName: 'Asha', status: 'quote_sent' });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body).toMatchObject({ firstName: 'Asha', status: 'quote_sent' });
  });

  it('bulk update applies the same rules per contact and reports a mismatch in `failed`', async () => {
    const a = (await contact(t, { lifecycleStage: 'qualified', status: 'quote_sent' })).body;
    const b = (await contact(t, { lifecycleStage: 'new', status: 'do_not_contact' })).body;
    const moved = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/update')
      .send({ ids: [a.id, b.id], values: { lifecycleStage: 'lost', otherLostReason: 'bulk' } });
    expect(moved.body.succeeded.sort()).toEqual([a.id, b.id].sort());
    expect((await api.as(t.admin).get(`/v2/contacts/${a.id}`)).body.status).toBe('not_interested');
    expect((await api.as(t.admin).get(`/v2/contacts/${b.id}`)).body.status).toBe('do_not_contact');

    const wrong = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/update')
      .send({ ids: [a.id], values: { status: 'quote_sent' } });
    expect(wrong.body.failed).toHaveLength(1);
    expect(wrong.body.failed[0].code).toBe('CON_STATUS_STAGE_MISMATCH');
    const right = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/update')
      .send({ ids: [a.id], values: { status: 'do_not_contact' } });
    expect(right.body.succeeded).toEqual([a.id]);
  });
});

describe('deleting stages and statuses that are linked', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('del');
  });

  it('deleting a stage keeps its statuses, now valid in every stage, and no longer its default', async () => {
    const doomed = await stage(t, 'doomed');
    const keeper = await stage(t, 'keeper');
    const scoped = (await status(t, 'doomed_sub', { stageOptionId: doomed.id, isDefault: true }))
      .body as Option;
    expect(scoped.stageOptionId).toBe(doomed.id);
    const del = await api.as(t.admin).delete(`/v2/status-options/${doomed.id}`);
    expect(del.status).toBe(204);
    const rows = (
      await api.as(t.admin).get('/v2/status-options?moduleKey=contacts&optionGroup=status')
    ).body.data as Option[];
    expect(rows.find((o) => o.id === scoped.id)).toMatchObject({
      stageOptionId: null,
      isDefault: false,
    });
    const c = await contact(t, { lifecycleStage: 'keeper', status: 'doomed_sub' });
    expect(c.body.status).toBe('doomed_sub');
    expect(keeper.id).toBeTruthy();
  });

  it('deleting a status scoped to a stage and moving its contacts there leaves the other stages with none', async () => {
    const qual = await stage(t, 'qual');
    const lostS = await stage(t, 'lost_s');
    const from = (await status(t, 'old_sub')).body as Option;
    const to = (await status(t, 'new_sub', { stageOptionId: qual.id })).body as Option;
    const inQual = (await contact(t, { lifecycleStage: 'qual', status: 'old_sub' })).body;
    const inLost = (await contact(t, { lifecycleStage: 'lost_s', status: 'old_sub' })).body;
    const del = await api
      .as(t.admin)
      .delete(`/v2/status-options/${from.id}`)
      .query({ moveTo: to.id });
    expect(del.status, JSON.stringify(del.body)).toBe(204);
    expect((await api.as(t.admin).get(`/v2/contacts/${inQual.id}`)).body.status).toBe('new_sub');
    expect((await api.as(t.admin).get(`/v2/contacts/${inLost.id}`)).body.status).toBeNull();
    expect(lostS.id).toBeTruthy();
  });
});

describe('a workspace that never scopes a status behaves exactly as before', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('legacy');
    await stage(t, 'new', { isDefault: true });
    await stage(t, 'lost', { isLost: true });
    await status(t, 'active');
    await status(t, 'inactive');
  });

  it('any status on any stage, and a stage move never touches the status', async () => {
    const c = (await contact(t, { status: 'active' })).body;
    expect(c).toMatchObject({ lifecycleStage: 'new', status: 'active' });
    const moved = await move(t, c, { lifecycleStage: 'lost', otherLostReason: 'x' });
    expect(moved.body).toMatchObject({ lifecycleStage: 'lost', status: 'active' });
    const swapped = await move(t, moved.body, { status: 'inactive' });
    expect(swapped.body.status).toBe('inactive');
    const free = await move(t, swapped.body, { status: 'not_a_configured_status' });
    expect(free.body.status).toBe('not_a_configured_status');
  });

  it('with no status options at all, create and update take any text as before', async () => {
    const bare = await api.signup('bare');
    const c = await contact(bare, { status: 'whatever' });
    expect(c.body.status).toBe('whatever');
    const moved = await move(bare, c.body, { lifecycleStage: 'qualified' });
    expect(moved.body).toMatchObject({ lifecycleStage: 'qualified', status: 'whatever' });
  });
});
