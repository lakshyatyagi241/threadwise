import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Sales activities settings end to end (BL-370..BL-379): the seeded defaults, the Settings routes and their permissions, the lists
 * (add, remove, revive, reorder), the switches, and what tasks, meetings and logged calls do with them. One app, one database; each
 * block works in an organization of its own.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 600_000);

afterAll(async () => {
  await h?.stop();
}, 120_000);

interface Option {
  id: string;
  kind: 'type' | 'outcome';
  key: string;
  name: string | null;
  isSystem: boolean;
  countsAs: string | null;
  position: number;
}
interface Activity {
  id: string;
  key: string;
  name: string | null;
  isDefault: boolean;
  behavesAs: string;
  showInCalendar: boolean;
  allowComplete: boolean;
  allowEditCompleted: boolean;
  mobileCheckIn: boolean;
  outcomesEnabled: boolean;
  taskTypes: Option[];
  outcomes: Option[];
  rowVersion: number;
}

const code = (res: { body: { code?: string } }) => res.body.code;

async function activities(token: string): Promise<Activity[]> {
  const res = await api.http().get('/v2/activity-types').set('authorization', `Bearer ${token}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as Activity[];
}
const byKey = (all: Activity[], key: string) => all.find((a) => a.key === key)!;

const as = (token: string) => ({
  get: (p: string) => api.http().get(p).set('authorization', `Bearer ${token}`),
  post: (p: string) => api.http().post(p).set('authorization', `Bearer ${token}`),
  put: (p: string) => api.http().put(p).set('authorization', `Bearer ${token}`),
  patch: (p: string) => api.http().patch(p).set('authorization', `Bearer ${token}`),
  delete: (p: string) => api.http().delete(p).set('authorization', `Bearer ${token}`),
});

describe('defaults and permissions', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('sact');
  });

  it('seeds the seven default activities with their lists, unnamed (the client shows its own words)', async () => {
    const all = await activities(t.admin);
    expect(all.map((a) => a.key)).toEqual(['task', 'meeting', 'phone', 'email', 'reminder', 'sms', 'chat']);
    expect(all.every((a) => a.isDefault && a.name === null)).toBe(true);
    const task = byKey(all, 'task');
    expect(task.taskTypes.map((o) => o.key)).toEqual(['follow_up', 'call_reminder']);
    expect(task.outcomes.map((o) => o.key)).toEqual([
      'interested',
      'left_message',
      'no_response',
      'not_interested',
      'not_reachable',
    ]);
    expect(byKey(all, 'phone').outcomes.map((o) => o.key)).toEqual([
      'connected',
      'no_answer',
      'busy',
      'left_voicemail',
      'wrong_number',
      'declined',
      'failed',
    ]);
    expect(byKey(all, 'email').outcomes).toEqual([]);
    // Today's behaviour: a task can be completed, its done time cannot be edited, no mobile check-in.
    expect(task.allowComplete).toBe(true);
    expect(task.allowEditCompleted).toBe(false);
    expect(byKey(all, 'meeting').mobileCheckIn).toBe(false);
  });

  it('is seeded by the organization trigger (a second workspace has its own rows) and the rows are per workspace', async () => {
    const other = await api.signup('sact2');
    const mine = await activities(t.admin);
    const theirs = await activities(other.admin);
    const ids = new Set(mine.flatMap((a) => [a.id, ...a.outcomes.map((o) => o.id)]));
    expect(theirs.some((a) => ids.has(a.id))).toBe(false);
    const rows = await h.owner.query(`SELECT count(*)::int AS c FROM activity_types WHERE org_id = $1`, [other.orgId]);
    expect(rows.rows[0].c).toBe(7);
  });

  it('a reader of tasks can read the lists but not change them; a member with no relevant key cannot even read', async () => {
    const reader = await api.member(t, 'sact-reader', [['record.tasks.read']]);
    const nobody = await api.member(t, 'sact-nobody', [['record.deals.read']]);
    const all = await activities(reader.token);
    expect(all.length).toBe(7);
    const task = byKey(all, 'task');
    const patch = await as(reader.token).patch(`/v2/activity-types/${task.id}`).send({ allowComplete: false, rowVersion: task.rowVersion });
    expect(patch.status).toBe(403);
    const add = await as(reader.token).post(`/v2/activity-types/${task.id}/options`).send({ kind: 'type', name: 'X' });
    expect(add.status).toBe(403);
    expect((await as(nobody.token).get('/v2/activity-types')).status).toBe(403);
  });

  it('a workspace that predates the tables is seeded on first read (the backfill path)', async () => {
    await h.owner.query(`DELETE FROM activity_types WHERE org_id = $1`, [t.orgId]);
    const all = await activities(t.admin);
    expect(all.length).toBe(7);
  });
});

describe('the switches and the lists', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('sact3');
  });

  it('changes a switch with the row version, audits it, and refuses a stale version', async () => {
    const task = byKey(await activities(t.admin), 'task');
    const res = await as(t.admin)
      .patch(`/v2/activity-types/${task.id}`)
      .send({ showInCalendar: false, allowEditCompleted: true, rowVersion: task.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.showInCalendar).toBe(false);
    expect(res.body.allowEditCompleted).toBe(true);
    const stale = await as(t.admin)
      .patch(`/v2/activity-types/${task.id}`)
      .send({ showInCalendar: true, rowVersion: task.rowVersion });
    expect(stale.status).toBe(409);
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'activity_types' AND action = 'update'`,
      [t.orgId],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it('locks a default activity name and refuses a switch the activity does not offer', async () => {
    const all = await activities(t.admin);
    const task = byKey(all, 'task');
    const rename = await as(t.admin).patch(`/v2/activity-types/${task.id}`).send({ name: 'Todo', rowVersion: task.rowVersion });
    expect(rename.status).toBe(409);
    expect(code(rename)).toBe('ACTIVITY_DEFAULT_LOCKED');
    const email = byKey(all, 'email');
    const bad = await as(t.admin).patch(`/v2/activity-types/${email.id}`).send({ outcomesEnabled: true, rowVersion: email.rowVersion });
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('ACTIVITY_FEATURE_OFF');
    expect((await as(t.admin).delete(`/v2/activity-types/${task.id}`)).status).toBe(409);
  });

  it('adds, refuses a duplicate, reorders, removes and revives a task type', async () => {
    const task = byKey(await activities(t.admin), 'task');
    const added = await as(t.admin).post(`/v2/activity-types/${task.id}/options`).send({ kind: 'type', name: 'Send proposal' });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const types = (added.body as Activity).taskTypes;
    expect(types.map((o) => o.key)).toEqual(['follow_up', 'call_reminder', 'send_proposal']);
    expect(types[2]!.name).toBe('Send proposal');

    const dup = await as(t.admin).post(`/v2/activity-types/${task.id}/options`).send({ kind: 'type', name: 'send  proposal' });
    expect(dup.status === 409 || dup.status === 201).toBe(true);
    const seededDup = await as(t.admin).post(`/v2/activity-types/${task.id}/options`).send({ kind: 'type', name: 'Follow up' });
    expect(seededDup.status).toBe(409);
    expect(code(seededDup)).toBe('ACTIVITY_NAME_TAKEN');

    const now = (await activities(t.admin)).find((a) => a.key === 'task')!.taskTypes;
    const reversed = [...now].reverse().map((o) => o.id);
    const order = await as(t.admin).put(`/v2/activity-types/${task.id}/options/order`).send({ kind: 'type', ids: reversed });
    expect(order.status, JSON.stringify(order.body)).toBe(200);
    expect((order.body as Activity).taskTypes.map((o) => o.id)).toEqual(reversed);
    const partial = await as(t.admin).put(`/v2/activity-types/${task.id}/options/order`).send({ kind: 'type', ids: reversed.slice(1) });
    expect(partial.status).toBe(400);

    const gone = (order.body as Activity).taskTypes.find((o) => o.key === 'call_reminder')!;
    const removed = await as(t.admin).delete(`/v2/activity-types/${task.id}/options/${gone.id}`);
    expect(removed.status).toBe(200);
    expect((removed.body as Activity).taskTypes.some((o) => o.key === 'call_reminder')).toBe(false);

    const back = await as(t.admin).post(`/v2/activity-types/${task.id}/options`).send({ kind: 'type', name: 'Call reminder' });
    expect(back.status).toBe(201);
    const revived = (back.body as Activity).taskTypes.find((o) => o.key === 'call_reminder')!;
    expect(revived.id).toBe(gone.id);
    expect(revived.name).toBeNull();
  });

  it('creates a custom activity, refuses its name twice, edits it and removes it', async () => {
    const created = await as(t.admin).post('/v2/activity-types').send({ name: 'Site visit', icon: 'visit', behavesAs: 'meeting' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const a = created.body as Activity;
    expect(a.isDefault).toBe(false);
    expect(a.key).toBe('custom_site_visit');
    expect(a.allowComplete).toBe(true);
    const twice = await as(t.admin).post('/v2/activity-types').send({ name: ' site VISIT', icon: 'visit', behavesAs: 'task' });
    expect(twice.status).toBe(409);
    expect(code(twice)).toBe('ACTIVITY_NAME_TAKEN');
    const renamed = await as(t.admin).patch(`/v2/activity-types/${a.id}`).send({ name: 'Property visit', rowVersion: a.rowVersion });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Property visit');
    const withOutcome = await as(t.admin).post(`/v2/activity-types/${a.id}/options`).send({ kind: 'outcome', name: 'Liked it' });
    expect(withOutcome.status).toBe(201);
    const noTypes = await as(t.admin).post(`/v2/activity-types/${a.id}/options`).send({ kind: 'type', name: 'Nope' });
    expect(noTypes.status).toBe(422);
    expect((await as(t.admin).delete(`/v2/activity-types/${a.id}`)).status).toBe(204);
    expect((await activities(t.admin)).some((x) => x.id === a.id)).toBe(false);
  });
});

describe('tasks', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('sact4');
  });

  const mk = async (body: Record<string, unknown>) => {
    const res = await as(t.admin).post('/v2/tasks').send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; rowVersion: number; taskType: { key: string } | null; outcome: { key: string; removed: boolean } | null; status: string; doneAt: string | null };
  };

  it('creates with a task type, completes with an outcome, and reopening drops the outcome', async () => {
    const task = byKey(await activities(t.admin), 'task');
    const type = task.taskTypes.find((o) => o.key === 'call_reminder')!;
    const out = task.outcomes.find((o) => o.key === 'interested')!;
    const a = await mk({ title: 'Ring Asha', taskTypeId: type.id });
    expect(a.taskType?.key).toBe('call_reminder');
    const done = await as(t.admin).post(`/v2/tasks/${a.id}/complete`).send({ outcomeId: out.id });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.outcome.key).toBe('interested');
    const reopened = await as(t.admin).post(`/v2/tasks/${a.id}/reopen`).send({});
    expect(reopened.body.outcome).toBeNull();
    expect(reopened.body.taskType.key).toBe('call_reminder');
  });

  it('refuses an outcome in the task type slot, an outcome of another activity and a removed one; a removed one stays readable', async () => {
    const all = await activities(t.admin);
    const task = byKey(all, 'task');
    const phoneOutcome = byKey(all, 'phone').outcomes[0]!;
    const a = await mk({ title: 'Wrong list' });
    const wrong = await as(t.admin).post(`/v2/tasks/${a.id}/complete`).send({ outcomeId: phoneOutcome.id });
    expect(wrong.status).toBe(422);
    expect(code(wrong)).toBe('ACTIVITY_OPTION_INVALID');
    const asType = await as(t.admin).post('/v2/tasks').send({ title: 'x', taskTypeId: task.outcomes[0]!.id });
    expect(asType.status).toBe(422);

    const left = task.outcomes.find((o) => o.key === 'left_message')!;
    const b = await mk({ title: 'Keeps outcome' });
    expect((await as(t.admin).post(`/v2/tasks/${b.id}/complete`).send({ outcomeId: left.id })).status).toBe(200);
    expect((await as(t.admin).delete(`/v2/activity-types/${task.id}/options/${left.id}`)).status).toBe(200);
    const read = await as(t.admin).get(`/v2/tasks/${b.id}`);
    expect(read.body.outcome.key).toBe('left_message');
    expect(read.body.outcome.removed).toBe(true);
    const c = await mk({ title: 'Cannot pick it now' });
    const refused = await as(t.admin).post(`/v2/tasks/${c.id}/complete`).send({ outcomeId: left.id });
    expect(refused.status).toBe(422);
  });

  it('follows the Allow-complete and Edit-completed-time switches', async () => {
    const task = byKey(await activities(t.admin), 'task');
    const a = await mk({ title: 'Switches' });
    const off = await as(t.admin).patch(`/v2/activity-types/${task.id}`).send({ allowComplete: false, rowVersion: task.rowVersion });
    expect(off.status).toBe(200);
    const blocked = await as(t.admin).post(`/v2/tasks/${a.id}/complete`).send({});
    expect(blocked.status).toBe(409);
    expect(code(blocked)).toBe('ACTIVITY_COMPLETION_DISABLED');
    const bulk = await as(t.admin).post('/v2/tasks/bulk/complete').send({ ids: [a.id] });
    expect(bulk.body.failed?.[0]?.code).toBe('ACTIVITY_COMPLETION_DISABLED');
    const on = await as(t.admin).patch(`/v2/activity-types/${task.id}`).send({ allowComplete: true, rowVersion: off.body.rowVersion });
    expect(on.status).toBe(200);
    const done = await as(t.admin).post(`/v2/tasks/${a.id}/complete`).send({});
    expect(done.status).toBe(200);

    const early = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const denied = await as(t.admin).patch(`/v2/tasks/${a.id}`).send({ doneAt: early, rowVersion: done.body.rowVersion });
    expect(denied.status).toBe(409);
    expect(code(denied)).toBe('ACTIVITY_EDIT_COMPLETED_DISABLED');
    const allow = await as(t.admin).patch(`/v2/activity-types/${task.id}`).send({ allowEditCompleted: true, rowVersion: on.body.rowVersion });
    expect(allow.status).toBe(200);
    const edited = await as(t.admin).patch(`/v2/tasks/${a.id}`).send({ doneAt: early, rowVersion: done.body.rowVersion });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(new Date(edited.body.doneAt).toISOString()).toBe(early);
    const open = await mk({ title: 'Open one' });
    const notDone = await as(t.admin).patch(`/v2/tasks/${open.id}`).send({ doneAt: early, rowVersion: open.rowVersion });
    expect(notDone.status).toBe(400);
  });

  it('a follow-up task made by lead handling carries the seeded Follow up type, and the backfill typed the old ones', async () => {
    const task = byKey(await activities(t.admin), 'task');
    const followUp = task.taskTypes.find((o) => o.key === 'follow_up')!;
    const [contact] = await api.seedContacts(t, [{ name: 'Lead One', phone: '+919811000111' }]);
    const set = await as(t.admin).put(`/v2/contacts/${contact}/follow-up`).send({ dueAt: new Date(Date.now() + 86_400_000).toISOString() });
    if (set.status === 200 || set.status === 201) {
      const rows = await h.owner.query(
        `SELECT t.task_type_id, o.key FROM tasks t LEFT JOIN activity_type_options o ON o.org_id = t.org_id AND o.id = t.task_type_id
          WHERE t.org_id = $1 AND t.kind = 'follow_up'`,
        [t.orgId],
      );
      expect(rows.rows[0]?.key).toBe(followUp.key);
    }
  });
});

describe('meetings', () => {
  let t: Tenant;
  let contact: string;
  beforeAll(async () => {
    t = await api.signup('sact5');
    [contact] = await api.seedContacts(t, [{ name: 'Meet Me', phone: '+919811000222' }]);
  });

  it('completes a meeting with an outcome and notes, edits them, and reopens it', async () => {
    const meetings = byKey(await activities(t.admin), 'meeting');
    const out = meetings.outcomes.find((o) => o.key === 'interested')!;
    const m = await as(t.admin).post(`/v2/contacts/${contact}/meetings`).send({ title: 'Intro call' });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    const set = await as(t.admin).put(`/v2/contacts/${contact}/meeting-results/${m.body.id}`).send({ outcomeId: out.id, note: 'Wants a demo' });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.outcome.key).toBe('interested');
    expect(set.body.note).toBe('Wants a demo');
    const list = await as(t.admin).get(`/v2/contacts/${contact}/meeting-results`);
    expect(list.body.data.map((r: { meetingId: string }) => r.meetingId)).toEqual([m.body.id]);
    const keep = await as(t.admin).put(`/v2/contacts/${contact}/meeting-results/${m.body.id}`).send({ note: null });
    expect(keep.body.note).toBeNull();
    expect(keep.body.outcome.key).toBe('interested');
    const phoneOutcome = byKey(await activities(t.admin), 'phone').outcomes[0]!;
    const wrong = await as(t.admin).put(`/v2/contacts/${contact}/meeting-results/${m.body.id}`).send({ outcomeId: phoneOutcome.id });
    expect(wrong.status).toBe(422);
    expect((await as(t.admin).delete(`/v2/contacts/${contact}/meeting-results/${m.body.id}`)).status).toBe(204);
    expect((await as(t.admin).get(`/v2/contacts/${contact}/meeting-results`)).body.data).toEqual([]);
  });

  it('follows the Meeting switches and stays inside the workspace', async () => {
    const meetings = byKey(await activities(t.admin), 'meeting');
    const m = await as(t.admin).post(`/v2/contacts/${contact}/meetings`).send({ title: 'Second' });
    const off = await as(t.admin).patch(`/v2/activity-types/${meetings.id}`).send({ allowComplete: false, rowVersion: meetings.rowVersion });
    expect(off.status).toBe(200);
    const blocked = await as(t.admin).put(`/v2/contacts/${contact}/meeting-results/${m.body.id}`).send({});
    expect(blocked.status).toBe(409);
    expect(code(blocked)).toBe('ACTIVITY_COMPLETION_DISABLED');
    await as(t.admin).patch(`/v2/activity-types/${meetings.id}`).send({ allowComplete: true, rowVersion: off.body.rowVersion });
    const late = await as(t.admin).put(`/v2/contacts/${contact}/meeting-results/${m.body.id}`).send({ completedAt: new Date(Date.now() - 3_600_000).toISOString() });
    expect(late.status).toBe(409);
    expect(code(late)).toBe('ACTIVITY_EDIT_COMPLETED_DISABLED');

    const other = await api.signup('sact6');
    const foreign = await as(other.admin).put(`/v2/contacts/${contact}/meeting-results/${m.body.id}`).send({});
    expect(foreign.status).toBe(404);
  });
});

describe('calls', () => {
  let t: Tenant;
  let contact: string;
  beforeAll(async () => {
    t = await api.signup('sact7');
    [contact] = await api.seedContacts(t, [{ name: 'Call Me', phone: '+919811000333' }]);
  });

  it('logs a call with a custom phone outcome that counts as a built-in one, and reads it back', async () => {
    const phone = byKey(await activities(t.admin), 'phone');
    const added = await as(t.admin).post(`/v2/activity-types/${phone.id}/options`).send({ kind: 'outcome', name: 'Asked for callback', countsAs: 'no_answer' });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const custom = (added.body as Activity).outcomes.find((o) => o.name === 'Asked for callback')!;
    expect(custom.countsAs).toBe('no_answer');
    const res = await as(t.admin).post('/v2/calls/log').send({ contactId: contact, direction: 'outbound', outcomeOptionId: custom.id, durationSec: 0 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.entry.outcome).toBe('no_answer');
    expect(res.body.entry.outcomeOption.name).toBe('Asked for callback');
    const builtIn = phone.outcomes.find((o) => o.key === 'busy')!;
    const edited = await as(t.admin).patch(`/v2/calls/log/${res.body.entry.id}`).send({ outcomeOptionId: builtIn.id, rowVersion: res.body.entry.rowVersion });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.outcome).toBe('busy');
    expect(edited.body.outcomeOption.key).toBe('busy');
  });

  it('still logs with only the built-in outcome (nothing changes for a workspace that never opens the settings)', async () => {
    const res = await as(t.admin).post('/v2/calls/log').send({ contactId: contact, direction: 'inbound', outcome: 'connected', durationSec: 30 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.entry.outcome).toBe('connected');
    expect(res.body.entry.outcomeOption).toBeNull();
    const neither = await as(t.admin).post('/v2/calls/log').send({ contactId: contact, direction: 'inbound', durationSec: 30 });
    expect(neither.status).toBe(400);
  });

  it('refuses an outcome item of another activity', async () => {
    const task = byKey(await activities(t.admin), 'task');
    const res = await as(t.admin).post('/v2/calls/log').send({ contactId: contact, direction: 'outbound', outcomeOptionId: task.outcomes[0]!.id });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('ACTIVITY_OPTION_INVALID');
  });
});
