import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { TaskDueSweepService } from '../../../src/modules/crm/tasks/task-due-sweep.service';
import {
  DealsApi,
  startHarness,
  uuidRe,
  type Harness,
  type Tenant,
} from '../deals-pipelines/support';

/**
 * Tasks end to end through HTTP (TW-TASK-001..014): plan gate and permissions, create / edit / complete / reopen / delete,
 * links, filters and cursor paging, the bucket counts, bulk actions, the deal timeline mirror and the due sweep, with the
 * audit, outbox and tenant properties every write must have. One app, one database; each block works in organizations of
 * its own.
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

const HOUR = 3_600_000;
const code = (res: { body: { code?: string } }) => res.body.code;

interface Task {
  id: string;
  title: string;
  notes: string | null;
  priority: string;
  status: 'open' | 'done';
  dueAt: string | null;
  doneAt: string | null;
  remindedAt: string | null;
  bucket: string | null;
  overdue: boolean;
  assignee: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  contact: { id: string; name: string | null } | null;
  deal: { id: string; title: string } | null;
  company: { id: string; name: string } | null;
  source: string;
  rowVersion: number;
}

const TASK_VIEWER = [['record.tasks.read']] as Array<[string, ('all' | 'team' | 'own')?]>;
const TASK_WORKER = [
  ['record.tasks.read', 'own'],
  ['record.tasks.create'],
  ['record.tasks.update', 'own'],
  ['record.tasks.delete', 'own'],
] as Array<[string, ('all' | 'team' | 'own')?]>;

async function task(token: string, body: Record<string, unknown>): Promise<Task> {
  const res = await api.as(token).post('/v2/tasks').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Task;
}

async function list(
  token: string,
  qs = '',
): Promise<{ data: Task[]; page: { nextCursor: string | null; hasMore: boolean; limit: number } }> {
  const res = await api.as(token).get(`/v2/tasks${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

const titles = (r: { data: Task[] }) => r.data.map((t) => t.title);

/** Where "today" ends for a workspace in UTC, and moments that are safely in each bucket. */
function moments() {
  const now = Date.now();
  const d = new Date(now);
  const dayEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return {
    overdue: new Date(now - HOUR).toISOString(),
    // The middle of what is left of today, so it is "today" however late the test runs.
    today: new Date(Math.floor((now + dayEnd) / 2)).toISOString(),
    upcoming: new Date(dayEnd + HOUR).toISOString(),
  };
}

describe('plan gate and permissions (TW-TASK-001, D-01, D-02)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('tpg');
  });

  it('TW-TASK-001 #1: a workspace whose plan lacks the sales pipeline is refused with 422 PLAN_FEATURE_LOCKED on every route, reads included', async () => {
    const own = await task(t.admin, { title: 'Before the lock' });
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"sales_pipeline":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    try {
      for (const [verb, path] of [
        ['get', '/v2/tasks'],
        ['get', '/v2/tasks/my'],
        ['get', '/v2/tasks/counts'],
        ['get', `/v2/tasks/${own.id}`],
      ] as const) {
        const res = await api.as(t.admin)[verb](path);
        expect(res.status, path).toBe(422);
        expect(code(res), path).toBe('PLAN_FEATURE_LOCKED');
      }
      const create = await api.as(t.admin).post('/v2/tasks').send({ title: 'Locked' });
      expect(create.status).toBe(422);
    } finally {
      await h.owner.query(`UPDATE org_plan_state SET overrides = '{}' WHERE org_id = $1`, [
        t.orgId,
      ]);
    }
    expect((await list(t.admin)).data.map((x) => x.title)).toEqual(['Before the lock']);
  });

  it('TW-TASK-001 #2 / D-02: a viewer can read tasks but cannot create, edit, complete, reopen, link, bulk or delete', async () => {
    const viewer = await api.member(t, 'tviewer', TASK_VIEWER);
    const mine = await task(t.admin, { title: 'Viewer cannot touch' });
    expect((await api.as(viewer.token).get('/v2/tasks')).status).toBe(200);
    expect((await api.as(viewer.token).get(`/v2/tasks/${mine.id}`)).status).toBe(200);
    const writes = [
      api.as(viewer.token).post('/v2/tasks').send({ title: 'x' }),
      api
        .as(viewer.token)
        .patch(`/v2/tasks/${mine.id}`)
        .send({ title: 'x', rowVersion: mine.rowVersion }),
      api.as(viewer.token).post(`/v2/tasks/${mine.id}/complete`).send({}),
      api.as(viewer.token).post(`/v2/tasks/${mine.id}/reopen`).send({}),
      api.as(viewer.token).put(`/v2/tasks/${mine.id}/links`).send({ contactId: null }),
      api
        .as(viewer.token)
        .post('/v2/tasks/bulk/complete')
        .send({ ids: [mine.id] }),
      api
        .as(viewer.token)
        .post('/v2/tasks/bulk/assign')
        .send({ ids: [mine.id], assigneeId: null }),
      api
        .as(viewer.token)
        .post('/v2/tasks/bulk/delete')
        .send({ ids: [mine.id] }),
      api.as(viewer.token).delete(`/v2/tasks/${mine.id}`),
    ];
    for (const res of await Promise.all(writes)) expect(res.status, res.text).toBe(403);
    const row = await h.owner.query(`SELECT status, title FROM tasks WHERE uuid = $1`, [mine.id]);
    expect(row.rows[0]).toMatchObject({ status: 'open', title: 'Viewer cannot touch' });
  });

  it('TW-TASK-001 #3: a caller with no tasks permission at all gets 403 on the list and the counts', async () => {
    const nobody = await api.member(t, 'tnobody', [['record.contacts.read']]);
    for (const path of ['/v2/tasks', '/v2/tasks/counts', '/v2/tasks/my']) {
      expect((await api.as(nobody.token).get(path)).status, path).toBe(403);
    }
  });

  it('D-02: scope own is "assigned to me or created by me", team adds teammates, all is everyone; an outside task is 404, never 403', async () => {
    const a = await api.member(t, 'town-a', TASK_WORKER);
    const b = await api.member(t, 'town-b', TASK_WORKER);
    const aUuid = await api.userUuid(a.userId);
    const bUuid = await api.userUuid(b.userId);

    const forB = await task(t.admin, { title: 'For B', assigneeId: bUuid });
    const byA = await task(a.token, { title: 'A hands to B', assigneeId: bUuid });
    const forA = await task(t.admin, { title: 'For A', assigneeId: aUuid });
    const nobodys = await task(t.admin, { title: 'Nobody', assigneeId: null });

    // A: the one assigned to A and the one A created (even though it sits with B); nothing else.
    expect(titles(await list(a.token)).sort()).toEqual(['A hands to B', 'For A']);
    expect(titles(await list(b.token)).sort()).toEqual(['A hands to B', 'For B']);
    for (const hidden of [forB.id, nobodys.id]) {
      const res = await api.as(a.token).get(`/v2/tasks/${hidden}`);
      expect(res.status).toBe(404);
      expect((await api.as(a.token).post(`/v2/tasks/${hidden}/complete`).send({})).status).toBe(
        404,
      );
      expect(
        (await api.as(a.token).patch(`/v2/tasks/${hidden}`).send({ title: 'x', rowVersion: 1 }))
          .status,
      ).toBe(404);
      expect((await api.as(a.token).delete(`/v2/tasks/${hidden}`)).status).toBe(404);
    }
    expect((await api.as(a.token).get(`/v2/tasks/${byA.id}`)).status).toBe(200);
    expect((await api.as(a.token).get(`/v2/tasks/${forA.id}`)).status).toBe(200);

    // Team scope: a shared team makes the teammate's tasks visible.
    const team = await h.owner.query(
      `INSERT INTO teams (org_id, name) VALUES ($1,'T1') RETURNING id`,
      [t.orgId],
    );
    for (const uid of [a.userId, b.userId]) {
      await h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
        t.orgId,
        team.rows[0].id,
        uid,
      ]);
    }
    const lead = await api.member(t, 'tteam', [['record.tasks.read', 'team']]);
    await h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      team.rows[0].id,
      lead.userId,
    ]);
    expect(titles(await list(lead.token)).sort()).toEqual(['A hands to B', 'For A', 'For B']);
    // An admin (all) sees every one of them, including the unassigned.
    expect(titles(await list(t.admin))).toEqual(
      expect.arrayContaining(['For A', 'For B', 'Nobody']),
    );
  });
});

describe('create (TW-TASK-003, 004, 013)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('tcr');
  });

  it('TW-TASK-003 #1: a title alone makes an open, medium task assigned to the caller, with a uuid id and no internal id', async () => {
    const x = await task(t.admin, { title: '  Call back  ' });
    expect(x.id).toMatch(uuidRe);
    expect(x).toMatchObject({
      title: 'Call back',
      status: 'open',
      priority: 'medium',
      dueAt: null,
      doneAt: null,
      bucket: 'no_date',
      overdue: false,
      source: 'manual',
      rowVersion: 1,
      contact: null,
      deal: null,
      company: null,
    });
    expect(x.assignee?.id).toBe(await api.userUuid(t.adminUserId));
    expect(x.createdBy?.id).toBe(x.assignee?.id);
    expect(JSON.stringify(x)).not.toMatch(/"(org_?id|internal)/i);
  });

  it('TW-TASK-003 #2: invalid bodies are rejected, a due date needs an offset, nothing is written', async () => {
    const before = (
      await h.owner.query(`SELECT count(*)::int AS n FROM tasks WHERE org_id = $1`, [t.orgId])
    ).rows[0].n;
    for (const body of [
      {},
      { title: '   ' },
      { title: 'x'.repeat(256) },
      { title: 'x', priority: 'urgent' },
      { title: 'x', dueAt: '2026-10-05' },
      { title: 'x', dueAt: 'tomorrow' },
      { title: 'x', notes: 'n'.repeat(5001) },
      { title: 'x', assigneeId: 'not-a-uuid' },
    ]) {
      const res = await api.as(t.admin).post('/v2/tasks').send(body);
      expect([400, 422], JSON.stringify(body)).toContain(res.status);
    }
    const after = (
      await h.owner.query(`SELECT count(*)::int AS n FROM tasks WHERE org_id = $1`, [t.orgId])
    ).rows[0].n;
    expect(after).toBe(before);
  });

  it('TW-TASK-004 #1 / D-03: an assignee outside the workspace, or no longer active, is 422 TASK_ASSIGNEE_INVALID (Reference silently used the caller)', async () => {
    const other = await api.signup('toth');
    const outsider = await api.userUuid(other.adminUserId);
    const res = await api.as(t.admin).post('/v2/tasks').send({ title: 'x', assigneeId: outsider });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('TASK_ASSIGNEE_INVALID');

    const gone = await api.member(t, 'tgone', TASK_WORKER);
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [gone.userId]);
    const res2 = await api
      .as(t.admin)
      .post('/v2/tasks')
      .send({ title: 'x', assigneeId: await api.userUuid(gone.userId) });
    expect(res2.status).toBe(422);
    expect(code(res2)).toBe('TASK_ASSIGNEE_INVALID');
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM tasks WHERE org_id = $1 AND title = 'x'`,
          [t.orgId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('TW-TASK-004 #2: null assignee means nobody; an assignee other than the caller emits task.assigned', async () => {
    const nobody = await task(t.admin, { title: 'Nobody', assigneeId: null });
    expect(nobody.assignee).toBeNull();
    const m = await api.member(t, 'tassign', TASK_WORKER);
    const mUuid = await api.userUuid(m.userId);
    const x = await task(t.admin, { title: 'For M', assigneeId: mUuid });
    expect(x.assignee?.id).toBe(mUuid);
    const assigned = (await api.events(t.orgId, 'task.assigned')).filter((e) => e.uuid === x.id);
    expect(assigned).toHaveLength(1);
    expect(assigned[0]).toMatchObject({
      assigneeId: mUuid,
      previousAssigneeId: null,
      title: 'For M',
    });
    // Assigning to yourself is not an announcement.
    const self = await task(t.admin, { title: 'Self' });
    expect(
      (await api.events(t.orgId, 'task.assigned')).filter((e) => e.uuid === self.id),
    ).toHaveLength(0);
  });

  it('D-05: a contact, deal or company that is not in the workspace is 404 (Reference stored any id), and a deal brings its contact and company', async () => {
    const other = await api.signup('toc');
    const [foreignContact] = await api.seedContacts(other, [{ name: 'Foreign' }]);
    for (const body of [
      { title: 'x', contactId: foreignContact },
      { title: 'x', contactId: '3a341df7-0add-4dba-9735-a9d45d0bf407' },
      { title: 'x', dealId: '3a341df7-0add-4dba-9735-a9d45d0bf407' },
      { title: 'x', companyId: '3a341df7-0add-4dba-9735-a9d45d0bf407' },
    ]) {
      const res = await api.as(t.admin).post('/v2/tasks').send(body);
      expect(res.status, JSON.stringify(body)).toBe(404);
    }
    const [contactId] = await api.seedContacts(t, [{ name: 'Ada' }]);
    const deal = await api.deal(t.admin, { title: 'Big deal', contactId });
    const x = await task(t.admin, { title: 'Follow up', dealId: deal.id });
    expect(x.deal).toEqual({ id: deal.id, title: 'Big deal' });
    expect(x.contact).toEqual({ id: contactId, name: 'Ada' });
    // Naming the contact as null opts out of the inheritance.
    const y = await task(t.admin, { title: 'No contact', dealId: deal.id, contactId: null });
    expect(y.contact).toBeNull();
  });

  it('TW-TASK-013: notes are encrypted at rest and come back as written; the audit row and the event never carry them', async () => {
    const x = await task(t.admin, { title: 'Secret', notes: 'the launch code is 0000' });
    expect(x.notes).toBe('the launch code is 0000');
    const raw = await h.owner.query(`SELECT notes FROM tasks WHERE uuid = $1`, [x.id]);
    expect(raw.rows[0].notes).not.toContain('launch');
    expect(raw.rows[0].notes).toMatch(/^v1:/);
    const evs = await api.events(t.orgId, 'task.created');
    expect(JSON.stringify(evs)).not.toContain('launch code');
    const audit = await h.owner.query(
      `SELECT delta::text AS d FROM audit_log WHERE org_id = $1 AND module = 'tasks'`,
      [t.orgId],
    );
    expect(audit.rows.map((r) => r.d).join('')).not.toContain('launch code');
  });

  it('every create writes one audit row and one task.created event in the same transaction', async () => {
    const t2 = await api.signup('tae');
    const x = await task(t2.admin, { title: 'Audited' });
    expect(await api.auditCount(t2.orgId, 'tasks', 'insert')).toBe(1);
    const evs = await api.events(t2.orgId, 'task.created');
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      uuid: x.id,
      title: 'Audited',
      status: 'open',
      source: 'manual',
    });
  });
});

describe('edit, complete, reopen, delete (TW-TASK-005..007, D-07, D-09, D-10, D-11)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ted');
  });

  it('TW-TASK-005 #1 / D-10: an edit needs the rowVersion you read; a stale one is 409 ROW_VERSION_CONFLICT and changes nothing', async () => {
    const x = await task(t.admin, { title: 'Edit me' });
    const missing = await api.as(t.admin).patch(`/v2/tasks/${x.id}`).send({ title: 'No version' });
    expect([400, 422]).toContain(missing.status);
    const ok = await api
      .as(t.admin)
      .patch(`/v2/tasks/${x.id}`)
      .send({ title: 'Edited', priority: 'high', rowVersion: x.rowVersion });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      title: 'Edited',
      priority: 'high',
      rowVersion: x.rowVersion + 1,
    });
    const stale = await api
      .as(t.admin)
      .patch(`/v2/tasks/${x.id}`)
      .send({ title: 'Stale write', rowVersion: x.rowVersion });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    expect((await api.as(t.admin).get(`/v2/tasks/${x.id}`)).body.title).toBe('Edited');
  });

  it('TW-TASK-005 #2: absent keeps, null clears; status is not editable here; an audit row records the changed fields only', async () => {
    const x = await task(t.admin, {
      title: 'Fields',
      notes: 'n1',
      dueAt: moments().upcoming,
      priority: 'low',
    });
    const res = await api
      .as(t.admin)
      .patch(`/v2/tasks/${x.id}`)
      .send({ notes: null, dueAt: null, rowVersion: x.rowVersion });
    expect(res.body).toMatchObject({
      notes: null,
      dueAt: null,
      priority: 'low',
      title: 'Fields',
      bucket: 'no_date',
    });
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'tasks' AND action = 'update' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(Object.keys(audit.rows[0].delta).sort()).toEqual(['dueAt', 'notes']);
    const sneak = await api
      .as(t.admin)
      .patch(`/v2/tasks/${x.id}`)
      .send({ status: 'done', rowVersion: res.body.rowVersion });
    expect((await api.as(t.admin).get(`/v2/tasks/${x.id}`)).body.status).toBe('open');
    expect([200, 400, 422]).toContain(sneak.status);
  });

  it('TW-TASK-006 / D-07: complete stamps doneAt, is idempotent (one event, one audit row), reopen clears it; both are explicit, not a toggle', async () => {
    const x = await task(t.admin, { title: 'Finish' });
    const done = await api.as(t.admin).post(`/v2/tasks/${x.id}/complete`).send({});
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'done', bucket: null, overdue: false });
    expect(done.body.doneAt).toMatch(/T/);
    const again = await api.as(t.admin).post(`/v2/tasks/${x.id}/complete`).send({});
    expect(again.body.doneAt).toBe(done.body.doneAt);
    expect(again.body.rowVersion).toBe(done.body.rowVersion);
    expect(
      (await api.events(t.orgId, 'task.completed')).filter((e) => e.uuid === x.id),
    ).toHaveLength(1);

    const reopened = await api.as(t.admin).post(`/v2/tasks/${x.id}/reopen`).send({});
    expect(reopened.body).toMatchObject({ status: 'open', doneAt: null, bucket: 'no_date' });
    await api.as(t.admin).post(`/v2/tasks/${x.id}/reopen`).send({});
    expect(
      (await api.events(t.orgId, 'task.reopened')).filter((e) => e.uuid === x.id),
    ).toHaveLength(1);
  });

  it('TW-TASK-006: complete with a stale rowVersion is 409; without one it is last write wins', async () => {
    const x = await task(t.admin, { title: 'Versioned' });
    const stale = await api
      .as(t.admin)
      .post(`/v2/tasks/${x.id}/complete`)
      .send({ rowVersion: x.rowVersion + 5 });
    expect(stale.status).toBe(409);
    const ok = await api
      .as(t.admin)
      .post(`/v2/tasks/${x.id}/complete`)
      .send({ rowVersion: x.rowVersion });
    expect(ok.body.status).toBe('done');
  });

  it('D-09: a new due date, and a reopen, arm the reminder again (Reference never re-reminded)', async () => {
    const x = await task(t.admin, { title: 'Rearm', dueAt: moments().overdue });
    await h.owner.query(`UPDATE tasks SET reminded_at = now() WHERE uuid = $1`, [x.id]);
    const cur = (await api.as(t.admin).get(`/v2/tasks/${x.id}`)).body as Task;
    expect(cur.remindedAt).not.toBeNull();
    const moved = await api
      .as(t.admin)
      .patch(`/v2/tasks/${x.id}`)
      .send({ dueAt: moments().upcoming, rowVersion: cur.rowVersion });
    expect(moved.body.remindedAt).toBeNull();

    await h.owner.query(`UPDATE tasks SET reminded_at = now() WHERE uuid = $1`, [x.id]);
    // Editing something else leaves the stamp alone.
    const cur2 = (await api.as(t.admin).get(`/v2/tasks/${x.id}`)).body as Task;
    const same = await api
      .as(t.admin)
      .patch(`/v2/tasks/${x.id}`)
      .send({ priority: 'high', rowVersion: cur2.rowVersion });
    expect(same.body.remindedAt).not.toBeNull();
    await api.as(t.admin).post(`/v2/tasks/${x.id}/complete`).send({});
    const re = await api.as(t.admin).post(`/v2/tasks/${x.id}/reopen`).send({});
    expect(re.body.remindedAt).toBeNull();
  });

  it('TW-TASK-008 / D-05: links are set and cleared with PUT /links (no version); a changed assignee emits task.assigned', async () => {
    const [contactId] = await api.seedContacts(t, [{ name: 'Link me' }]);
    const deal = await api.deal(t.admin, { title: 'Link deal' });
    const x = await task(t.admin, { title: 'Linkable' });
    const linked = await api
      .as(t.admin)
      .put(`/v2/tasks/${x.id}/links`)
      .send({ contactId, dealId: deal.id });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.contact).toEqual({ id: contactId, name: 'Link me' });
    expect(linked.body.deal).toEqual({ id: deal.id, title: 'Link deal' });
    const part = await api.as(t.admin).put(`/v2/tasks/${x.id}/links`).send({ contactId: null });
    expect(part.body.contact).toBeNull();
    expect(part.body.deal?.id).toBe(deal.id);
    const bad = await api
      .as(t.admin)
      .put(`/v2/tasks/${x.id}/links`)
      .send({ dealId: '3a341df7-0add-4dba-9735-a9d45d0bf407' });
    expect(bad.status).toBe(404);

    const m = await api.member(t, 'tlink', TASK_WORKER);
    const mUuid = await api.userUuid(m.userId);
    const cur = (await api.as(t.admin).get(`/v2/tasks/${x.id}`)).body as Task;
    const re = await api
      .as(t.admin)
      .patch(`/v2/tasks/${x.id}`)
      .send({ assigneeId: mUuid, rowVersion: cur.rowVersion });
    expect(re.body.assignee?.id).toBe(mUuid);
    const ev = (await api.events(t.orgId, 'task.assigned')).filter((e) => e.uuid === x.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      assigneeId: mUuid,
      previousAssigneeId: await api.userUuid(t.adminUserId),
    });
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'tasks' AND action = 'update' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    // The trail names people by uuid, never by internal id.
    expect(audit.rows[0].delta.assignee).toEqual({
      old: await api.userUuid(t.adminUserId),
      new: mUuid,
    });
  });

  it('TW-TASK-007 / D-11: delete removes the row, audits what was deleted, emits task.deleted; a second delete is 404', async () => {
    const x = await task(t.admin, { title: 'Delete me' });
    const res = await api.as(t.admin).delete(`/v2/tasks/${x.id}`);
    expect(res.status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/tasks/${x.id}`)).status).toBe(404);
    expect((await api.as(t.admin).delete(`/v2/tasks/${x.id}`)).status).toBe(404);
    expect((await api.events(t.orgId, 'task.deleted')).filter((e) => e.uuid === x.id)).toHaveLength(
      1,
    );
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'tasks' AND action = 'delete' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(audit.rows[0].delta.title).toEqual({ old: 'Delete me', new: null });
  });

  it("another workspace's task is 404 for every verb, and nothing of it changes", async () => {
    const other = await api.signup('tx');
    const theirs = await task(other.admin, { title: 'Theirs' });
    for (const res of [
      await api.as(t.admin).get(`/v2/tasks/${theirs.id}`),
      await api
        .as(t.admin)
        .patch(`/v2/tasks/${theirs.id}`)
        .send({ title: 'mine now', rowVersion: 1 }),
      await api.as(t.admin).post(`/v2/tasks/${theirs.id}/complete`).send({}),
      await api.as(t.admin).put(`/v2/tasks/${theirs.id}/links`).send({ contactId: null }),
      await api.as(t.admin).delete(`/v2/tasks/${theirs.id}`),
    ]) {
      expect(res.status).toBe(404);
    }
    const bulk = await api
      .as(t.admin)
      .post('/v2/tasks/bulk/delete')
      .send({ ids: [theirs.id] });
    expect(bulk.body.failed).toHaveLength(1);
    expect(
      (await h.owner.query(`SELECT title, status FROM tasks WHERE uuid = $1`, [theirs.id])).rows[0],
    ).toEqual({ title: 'Theirs', status: 'open' });
    expect(titles(await list(t.admin))).not.toContain('Theirs');
  });
});

describe('lists, filters, paging and counts (TW-TASK-002, 009, D-04, D-06, D-08)', () => {
  let t: Tenant;
  let m: { token: string; userId: number };
  let mUuid: string;
  beforeAll(async () => {
    t = await api.signup('tli');
    m = await api.member(t, 'tlist', TASK_WORKER);
    mUuid = await api.userUuid(m.userId);
    const mm = moments();
    await task(t.admin, { title: 'Overdue high', dueAt: mm.overdue, priority: 'high' });
    await task(t.admin, { title: 'Due today', dueAt: mm.today });
    await task(t.admin, { title: 'Upcoming low', dueAt: mm.upcoming, priority: 'low' });
    await task(t.admin, { title: 'No date' });
    await task(t.admin, { title: 'Nobody task', assigneeId: null });
    await task(t.admin, { title: 'For member', assigneeId: mUuid, dueAt: mm.overdue });
    const done = await task(t.admin, { title: 'Finished', dueAt: mm.overdue });
    await api.as(t.admin).post(`/v2/tasks/${done.id}/complete`).send({});
  });

  it('TW-TASK-009: the due filter cuts open tasks into overdue, today, upcoming and none (a done task is in none of them)', async () => {
    expect(titles(await list(t.admin, '?due=overdue')).sort()).toEqual([
      'For member',
      'Overdue high',
    ]);
    expect(titles(await list(t.admin, '?due=today'))).toEqual(['Due today']);
    expect(titles(await list(t.admin, '?due=upcoming'))).toEqual(['Upcoming low']);
    expect(titles(await list(t.admin, '?due=none')).sort()).toEqual(['No date', 'Nobody task']);
    const all = await list(t.admin, '?status=all&due=overdue');
    expect(titles(all)).not.toContain('Finished');
    const rows = (await list(t.admin, '?due=overdue')).data;
    expect(rows.every((r) => r.bucket === 'overdue' && r.overdue)).toBe(true);
  });

  it('TW-TASK-002: the default is the open tasks soonest due first with undated last; status=done and status=all work', async () => {
    const open = await list(t.admin);
    expect(titles(open).slice(0, 4)).toEqual(
      expect.arrayContaining(['Overdue high', 'For member']),
    );
    expect(titles(open).slice(-2).sort()).toEqual(['No date', 'Nobody task']);
    expect(titles(open)).not.toContain('Finished');
    expect(titles(await list(t.admin, '?status=done'))).toEqual(['Finished']);
    expect(titles(await list(t.admin, '?status=all')).sort()).toContain('Finished');
    expect((await list(t.admin, '?status=all')).data).toHaveLength(7);
  });

  it('filters: priority (csv), mine, assigneeId, unassigned, q on the title; an unknown assignee gives an empty page', async () => {
    expect(titles(await list(t.admin, '?priority=high,low')).sort()).toEqual([
      'Overdue high',
      'Upcoming low',
    ]);
    expect(titles(await list(t.admin, '?mine=true')).sort()).toEqual([
      'Due today',
      'No date',
      'Overdue high',
      'Upcoming low',
    ]);
    expect(titles(await list(m.token, '?mine=true'))).toEqual(['For member']);
    expect(titles(await list(t.admin, `?assigneeId=${mUuid}`))).toEqual(['For member']);
    expect(titles(await list(t.admin, '?unassigned=true'))).toEqual(['Nobody task']);
    expect(titles(await list(t.admin, '?q=overdue'))).toEqual(['Overdue high']);
    expect(titles(await list(t.admin, '?q=100%25'))).toEqual([]);
    expect((await list(t.admin, '?assigneeId=3a341df7-0add-4dba-9735-a9d45d0bf407')).data).toEqual(
      [],
    );
    expect((await api.as(t.admin).get('/v2/tasks?priority=urgent')).status).toBe(422);
  });

  it('TW-TASK-002 / "my tasks": GET /tasks/my is the list forced to the caller\'s own assignments', async () => {
    const mine = await api.as(m.token).get('/v2/tasks/my');
    expect(mine.status).toBe(200);
    expect(titles(mine.body)).toEqual(['For member']);
    const adminMine = await api.as(t.admin).get('/v2/tasks/my?due=overdue');
    expect(titles(adminMine.body)).toEqual(['Overdue high']);
  });

  it("D-08: the day buckets follow the workspace time zone, not the server's", async () => {
    // Two zones with a fixed offset and different midnights (Kiritimati UTC+14: 10:00 UTC; UTC-5: 05:00 UTC). The test needs a
    // local midnight at least two hours ahead so both tasks sit on a fixed edge (one hour either side) whatever the hour of
    // the run: Kiritimati is unusable from 08:00 to 10:00 UTC and UTC-5 from 03:00 to 05:00 UTC, never both at once.
    const now = Date.now();
    const d = new Date(now);
    const zone = [
      { name: 'Pacific/Kiritimati', hourUtc: 10 },
      { name: 'Etc/GMT+5', hourUtc: 5 },
    ]
      .map((z) => {
        let edge = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), z.hourUtc);
        if (edge <= now) edge += 24 * HOUR;
        return { ...z, edge };
      })
      .find((z) => z.edge - now >= 2 * HOUR);
    if (!zone) throw new Error('no zone has a local midnight two hours ahead');
    const edge = zone.edge;
    const tz = await api.signup('ttz');
    await h.owner.query(
      `UPDATE organizations SET settings = settings || jsonb_build_object('timezone', $2::text) WHERE id = $1`,
      [tz.orgId, zone.name],
    );
    await task(tz.admin, {
      title: 'Last hour of the day',
      dueAt: new Date(edge - HOUR).toISOString(),
    });
    await task(tz.admin, {
      title: 'First hour of the next',
      dueAt: new Date(edge + HOUR).toISOString(),
    });
    expect(titles(await list(tz.admin, '?due=today'))).toEqual(['Last hour of the day']);
    expect(titles(await list(tz.admin, '?due=upcoming'))).toEqual(['First hour of the next']);
    const counts = (await api.as(tz.admin).get('/v2/tasks/counts')).body;
    expect(counts).toMatchObject({ today: 1, upcoming: 1 });
  });

  it('dueFrom / dueTo select a window (inclusive start, exclusive end)', async () => {
    const mm = moments();
    const from = new Date().toISOString();
    const r = await list(
      t.admin,
      `?dueFrom=${encodeURIComponent(from)}&dueTo=${encodeURIComponent(mm.upcoming)}`,
    );
    expect(titles(r)).toEqual(['Due today']);
  });

  it("TW-TASK-002 / D-06: counts partition the open tasks into the four buckets, count the done ones, and report the caller's own", async () => {
    const admin = (await api.as(t.admin).get('/v2/tasks/counts')).body;
    expect(admin).toEqual({
      overdue: 2,
      today: 1,
      upcoming: 1,
      noDate: 2,
      open: 6,
      done: 1,
      mine: { open: 4, overdue: 1 },
    });
    expect(admin.open).toBe(admin.overdue + admin.today + admin.upcoming + admin.noDate);
    const mem = (await api.as(m.token).get('/v2/tasks/counts')).body;
    expect(mem).toMatchObject({ open: 1, overdue: 1, done: 0, mine: { open: 1, overdue: 1 } });
    // A filter narrows the buckets; "mine" ignores it.
    const high = (await api.as(t.admin).get('/v2/tasks/counts?priority=high')).body;
    expect(high).toMatchObject({
      overdue: 1,
      today: 0,
      upcoming: 0,
      noDate: 0,
      open: 1,
      mine: { open: 4 },
    });
  });

  it('D-06: the cursor pages a long list with no gap and no repeat, in every sort, including rows that tie to the microsecond', async () => {
    const t2 = await api.signup('tpg2');
    const uid = t2.adminUserId;
    // Seven tasks that share one due instant AND one created instant (a bulk import does this), plus distinct ones.
    for (let i = 0; i < 7; i++) {
      await h.owner.query(
        `INSERT INTO tasks (org_id, title, assignee_id, due_at, created_at) VALUES ($1,$2,$3,'2031-01-01T00:00:00.123456Z','2030-01-01T00:00:00.654321Z')`,
        [t2.orgId, `tie ${i}`, uid],
      );
    }
    for (let i = 0; i < 4; i++) {
      await h.owner.query(
        `INSERT INTO tasks (org_id, title, assignee_id, due_at) VALUES ($1,$2,$3,$4)`,
        [t2.orgId, `own ${i}`, uid, new Date(Date.now() + (i + 1) * HOUR)],
      );
    }
    await h.owner.query(`INSERT INTO tasks (org_id, title, assignee_id) VALUES ($1,'undated',$2)`, [
      t2.orgId,
      uid,
    ]);
    const doneIds = await h.owner.query(
      `UPDATE tasks SET status = 'done', done_at = '2031-06-01T00:00:00.5Z' WHERE org_id = $1 AND title IN ('tie 0','tie 1','tie 2') RETURNING uuid`,
      [t2.orgId],
    );
    expect(doneIds.rows).toHaveLength(3);

    for (const qs of [
      '?status=all&sort=due',
      '?status=all&sort=created',
      '?status=all&sort=completed',
      '?sort=due',
      '?status=done',
    ]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const r = await list(
          t2.admin,
          `${qs}${qs.includes('?') ? '&' : '?'}limit=3${cursor ? `&cursor=${cursor}` : ''}`,
        );
        seen.push(...r.data.map((x) => x.id));
        cursor = r.page.nextCursor;
        expect(r.page.hasMore).toBe(cursor !== null);
        expect(++pages).toBeLessThan(10);
      } while (cursor);
      const total = qs.includes('status=all') ? 12 : qs === '?status=done' ? 3 : 9;
      expect(seen, qs).toHaveLength(total);
      expect(new Set(seen).size, qs).toBe(total);
    }

    const due = await list(t2.admin, '?status=all&sort=due&limit=200');
    expect(titles(due).at(-1)).toBe('undated');
    const created = await list(t2.admin, '?status=all&sort=created&limit=200');
    // Newest first: the seven that share a (future) created instant come before the ones made now.
    expect(
      titles(created)
        .slice(0, 7)
        .every((x) => x.startsWith('tie')),
    ).toBe(true);
    expect(
      titles(created)
        .slice(7)
        .some((x) => x.startsWith('tie')),
    ).toBe(false);
    const completed = await list(t2.admin, '?status=all&sort=completed&limit=200');
    expect(completed.data.slice(0, 3).every((x) => x.status === 'done')).toBe(true);
    // A cursor made for one order is refused by another, and garbage is a 400.
    const c = (await list(t2.admin, '?sort=due&limit=2')).page.nextCursor!;
    expect((await api.as(t2.admin).get(`/v2/tasks?sort=created&cursor=${c}`)).status).toBe(400);
    expect((await api.as(t2.admin).get('/v2/tasks?cursor=%21%21')).status).toBe(400);
    expect((await api.as(t2.admin).get('/v2/tasks?limit=500')).status).toBe(422);
  });
});

describe('contact and deal task lists (TW-TASK-008, 014)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('tcd');
  });

  it("GET /contacts/:id/tasks lists that contact's tasks (open by default, paged, filtered); an unknown contact is 404", async () => {
    const [ada, bob] = await api.seedContacts(t, [{ name: 'Ada' }, { name: 'Bob' }]);
    const a1 = await task(t.admin, { title: 'Ada 1', contactId: ada, dueAt: moments().overdue });
    await task(t.admin, { title: 'Ada 2', contactId: ada });
    await task(t.admin, { title: 'Bob 1', contactId: bob });
    const done = await task(t.admin, { title: 'Ada done', contactId: ada });
    await api.as(t.admin).post(`/v2/tasks/${done.id}/complete`).send({});

    const res = await api.as(t.admin).get(`/v2/contacts/${ada}/tasks`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(titles(res.body)).toEqual(['Ada 1', 'Ada 2']);
    expect(
      titles((await api.as(t.admin).get(`/v2/contacts/${ada}/tasks?status=all&limit=2`)).body),
    ).toHaveLength(2);
    expect(
      titles((await api.as(t.admin).get(`/v2/contacts/${ada}/tasks?due=overdue`)).body),
    ).toEqual(['Ada 1']);
    expect(
      titles((await api.as(t.admin).get(`/v2/contacts/${ada}/tasks?status=done`)).body),
    ).toEqual(['Ada done']);
    expect(
      (await api.as(t.admin).get('/v2/contacts/3a341df7-0add-4dba-9735-a9d45d0bf407/tasks')).status,
    ).toBe(404);
    // The flat list filters by the same link.
    expect(titles(await list(t.admin, `?contactId=${bob}`))).toEqual(['Bob 1']);
    void a1;
  });

  it("a contact's tasks need the contact's own read permission and scope: out of scope is 404, no contacts permission is 403", async () => {
    const [mine, notMine] = await api.seedContacts(t, [{ name: 'Mine' }, { name: 'Not mine' }]);
    const rep = await api.member(t, 'trep', [...TASK_WORKER, ['record.contacts.read', 'own']]);
    await h.owner.query(`UPDATE contacts SET owner_id = $1 WHERE org_id = $2 AND uuid = $3`, [
      rep.userId,
      t.orgId,
      mine,
    ]);
    await task(t.admin, {
      title: 'On not-mine',
      contactId: notMine,
      assigneeId: await api.userUuid(rep.userId),
    });
    expect((await api.as(rep.token).get(`/v2/contacts/${mine}/tasks`)).status).toBe(200);
    expect((await api.as(rep.token).get(`/v2/contacts/${notMine}/tasks`)).status).toBe(404);
    const blind = await api.member(t, 'tblind', TASK_WORKER);
    expect((await api.as(blind.token).get(`/v2/contacts/${mine}/tasks`)).status).toBe(403);
  });

  it("GET /deals/:id/tasks lists that deal's tasks; a deal outside the caller's deal scope is 404", async () => {
    const deal = await api.deal(t.admin, { title: 'Deal T' });
    const other = await api.deal(t.admin, { title: 'Deal U' });
    await task(t.admin, { title: 'On T', dealId: deal.id });
    await task(t.admin, { title: 'On U', dealId: other.id });
    const res = await api.as(t.admin).get(`/v2/deals/${deal.id}/tasks`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(titles(res.body)).toEqual(['On T']);
    expect(
      (await api.as(t.admin).get('/v2/deals/3a341df7-0add-4dba-9735-a9d45d0bf407/tasks')).status,
    ).toBe(404);

    const rep = await api.member(t, 'tdealrep', [...TASK_WORKER, ['record.deals.read', 'own']]);
    expect((await api.as(rep.token).get(`/v2/deals/${deal.id}/tasks`)).status).toBe(404);
    const noDeals = await api.member(t, 'tnodeals', TASK_WORKER);
    expect((await api.as(noDeals.token).get(`/v2/deals/${deal.id}/tasks`)).status).toBe(403);
  });

  it('deleting the linked contact or deal keeps the task and clears the link (no dangling pointer)', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Short lived' }]);
    const deal = await api.deal(t.admin, { title: 'Short deal' });
    const x = await task(t.admin, { title: 'Survivor', contactId: c, dealId: deal.id });
    await h.owner.query(`DELETE FROM contacts WHERE org_id = $1 AND uuid = $2`, [t.orgId, c]);
    expect((await api.as(t.admin).delete(`/v2/deals/${deal.id}`)).status).toBe(204);
    const after = (await api.as(t.admin).get(`/v2/tasks/${x.id}`)).body as Task;
    expect(after).toMatchObject({ title: 'Survivor', contact: null, deal: null, status: 'open' });
  });
});

describe('bulk actions (D-07)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('tbk');
  });

  it('bulk complete and reopen: every id that can be changed is; unknown and out-of-scope ids are listed in failed and stop nothing', async () => {
    const a = await task(t.admin, { title: 'B1' });
    const b = await task(t.admin, { title: 'B2' });
    const rep = await api.member(t, 'tbrep', TASK_WORKER);
    const foreign = await task(t.admin, { title: 'Not the rep', assigneeId: null });
    const ghost = '3a341df7-0add-4dba-9735-a9d45d0bf407';

    const res = await api
      .as(t.admin)
      .post('/v2/tasks/bulk/complete')
      .send({ ids: [a.id, b.id, ghost, a.id] });
    expect(res.status).toBe(200);
    expect(res.body.succeeded.sort()).toEqual([a.id, b.id].sort());
    expect(res.body.failed).toEqual([
      { id: ghost, code: 'NOT_FOUND', message: expect.any(String) },
    ]);
    expect(titles(await list(t.admin, '?status=done')).sort()).toEqual(['B1', 'B2']);
    expect(
      (await api.events(t.orgId, 'task.completed')).filter((e) => e.uuid === a.id),
    ).toHaveLength(1);

    const repRes = await api
      .as(rep.token)
      .post('/v2/tasks/bulk/complete')
      .send({ ids: [foreign.id] });
    expect(repRes.body.succeeded).toEqual([]);
    expect(repRes.body.failed).toHaveLength(1);
    expect((await api.as(t.admin).get(`/v2/tasks/${foreign.id}`)).body.status).toBe('open');

    const re = await api
      .as(t.admin)
      .post('/v2/tasks/bulk/reopen')
      .send({ ids: [a.id, b.id] });
    expect(re.body.succeeded).toHaveLength(2);
    expect(titles(await list(t.admin, '?status=done'))).toEqual([]);
  });

  it('bulk assign: one member for all, null to unassign; a bad assignee is 422 and nothing changes', async () => {
    const m = await api.member(t, 'tbassign', TASK_WORKER);
    const mUuid = await api.userUuid(m.userId);
    const a = await task(t.admin, { title: 'BA1' });
    const b = await task(t.admin, { title: 'BA2' });
    const res = await api
      .as(t.admin)
      .post('/v2/tasks/bulk/assign')
      .send({ ids: [a.id, b.id], assigneeId: mUuid });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toHaveLength(2);
    expect((await api.as(t.admin).get(`/v2/tasks/${a.id}`)).body.assignee?.id).toBe(mUuid);
    expect(
      (await api.events(t.orgId, 'task.assigned')).filter(
        (e) => e.uuid === a.id || e.uuid === b.id,
      ),
    ).toHaveLength(2);

    const bad = await api
      .as(t.admin)
      .post('/v2/tasks/bulk/assign')
      .send({ ids: [a.id], assigneeId: '3a341df7-0add-4dba-9735-a9d45d0bf407' });
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('TASK_ASSIGNEE_INVALID');
    expect((await api.as(t.admin).get(`/v2/tasks/${a.id}`)).body.assignee?.id).toBe(mUuid);

    const none = await api
      .as(t.admin)
      .post('/v2/tasks/bulk/assign')
      .send({ ids: [a.id], assigneeId: null });
    expect(none.body.succeeded).toEqual([a.id]);
    expect((await api.as(t.admin).get(`/v2/tasks/${a.id}`)).body.assignee).toBeNull();
  });

  it('bulk delete removes what it can, audits and announces each, and the body is bounded (at most 200 ids, at least 1)', async () => {
    const a = await task(t.admin, { title: 'BD1' });
    const b = await task(t.admin, { title: 'BD2' });
    const res = await api
      .as(t.admin)
      .post('/v2/tasks/bulk/delete')
      .send({ ids: [a.id, b.id] });
    expect(res.body.succeeded).toHaveLength(2);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM tasks WHERE uuid = ANY($1::uuid[])`, [
          [a.id, b.id],
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await api.events(t.orgId, 'task.deleted')).filter((e) => e.uuid === a.id || e.uuid === b.id),
    ).toHaveLength(2);
    for (const ids of [
      [],
      Array.from({ length: 201 }, () => '3a341df7-0add-4dba-9735-a9d45d0bf407'),
      ['nope'],
    ]) {
      expect((await api.as(t.admin).post('/v2/tasks/bulk/delete').send({ ids })).status).toBe(422);
    }
  });
});

describe('the deal timeline and the task list (TW-TASK-014, D-14)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('tdt');
  });

  it('a task added on a deal timeline also appears in /tasks, linked to the deal and its contact, with the same due date and assignee', async () => {
    const [contactId] = await api.seedContacts(t, [{ name: 'Timeline Tom' }]);
    const deal = await api.deal(t.admin, { title: 'Timeline deal', contactId });
    const due = moments().upcoming;
    const act = await api
      .as(t.admin)
      .post(`/v2/deals/${deal.id}/activities`)
      .send({ type: 'task', body: 'Send proposal\nwith the new pricing', dueAt: due });
    expect(act.status, JSON.stringify(act.body)).toBe(201);

    const res = await api.as(t.admin).get(`/v2/tasks?dealId=${deal.id}`);
    expect(res.body.data).toHaveLength(1);
    const x = res.body.data[0] as Task;
    expect(x).toMatchObject({
      title: 'Send proposal',
      notes: 'Send proposal\nwith the new pricing',
      source: 'deal',
      dueAt: due,
      status: 'open',
      deal: { id: deal.id, title: 'Timeline deal' },
      contact: { id: contactId, name: 'Timeline Tom' },
    });
    expect(x.assignee?.id).toBe(await api.userUuid(t.adminUserId));
    expect((await api.events(t.orgId, 'task.created')).filter((e) => e.uuid === x.id)).toHaveLength(
      1,
    );
    // The deal's task list sees it too, and so does the contact's.
    expect(titles((await api.as(t.admin).get(`/v2/deals/${deal.id}/tasks`)).body)).toEqual([
      'Send proposal',
    ]);
    expect(titles((await api.as(t.admin).get(`/v2/contacts/${contactId}/tasks`)).body)).toEqual([
      'Send proposal',
    ]);
    // Notes, calls and the stage-change row are not tasks.
    await api
      .as(t.admin)
      .post(`/v2/deals/${deal.id}/activities`)
      .send({ type: 'note', body: 'just a note' });
    expect((await api.as(t.admin).get(`/v2/tasks?dealId=${deal.id}`)).body.data).toHaveLength(1);
  });

  it('completing on either side completes both; reopening on either side reopens both', async () => {
    const deal = await api.deal(t.admin, { title: 'Sync deal' });
    const act = (
      await api
        .as(t.admin)
        .post(`/v2/deals/${deal.id}/activities`)
        .send({ type: 'task', body: 'Sync me' })
    ).body;
    const x = (await api.as(t.admin).get(`/v2/tasks?dealId=${deal.id}`)).body.data[0] as Task;
    const timelineDone = async () =>
      (await api.timeline(t.admin, deal.id)).find((a) => a.id === act.id)!.done;

    await api.as(t.admin).post(`/v2/tasks/${x.id}/complete`).send({});
    expect(await timelineDone()).toBe(true);
    await api.as(t.admin).post(`/v2/tasks/${x.id}/reopen`).send({});
    expect(await timelineDone()).toBe(false);

    await api.as(t.admin).post(`/v2/deals/${deal.id}/activities/${act.id}/complete`).send({});
    expect((await api.as(t.admin).get(`/v2/tasks/${x.id}`)).body.status).toBe('done');
    expect(
      (await api.events(t.orgId, 'task.completed')).filter((e) => e.uuid === x.id),
    ).toHaveLength(2);
    await api.as(t.admin).post(`/v2/deals/${deal.id}/activities/${act.id}/reopen`).send({});
    expect((await api.as(t.admin).get(`/v2/tasks/${x.id}`)).body.status).toBe('open');
  });

  it("editing the task's due date or assignee is mirrored to the timeline row; deleting the task keeps the timeline row", async () => {
    const deal = await api.deal(t.admin, { title: 'Mirror edit' });
    const act = (
      await api
        .as(t.admin)
        .post(`/v2/deals/${deal.id}/activities`)
        .send({ type: 'task', body: 'Mirror' })
    ).body;
    const x = (await api.as(t.admin).get(`/v2/tasks?dealId=${deal.id}`)).body.data[0] as Task;
    const due = moments().upcoming;
    const m = await api.member(t, 'tmirror', TASK_WORKER);
    const mUuid = await api.userUuid(m.userId);
    const res = await api
      .as(t.admin)
      .patch(`/v2/tasks/${x.id}`)
      .send({ dueAt: due, assigneeId: mUuid, rowVersion: x.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (await api.as(t.admin).get(`/v2/deals/${deal.id}/activities`)).body.data.find(
      (a: { id: string }) => a.id === act.id,
    );
    expect(row.dueAt).toBe(due);
    expect(row.assignee.id).toBe(mUuid);
    expect((await api.as(t.admin).delete(`/v2/tasks/${x.id}`)).status).toBe(204);
    expect((await api.timeline(t.admin, deal.id)).some((a) => a.id === act.id)).toBe(true);
  });
});

describe('the due sweep (TW-TASK-010, D-15)', () => {
  let t: Tenant;
  let sweep: TaskDueSweepService;
  beforeAll(async () => {
    t = await api.signup('tsw');
    sweep = new TaskDueSweepService(h.app.get(DatabaseService), h.app.get(OutboxService));
  });

  it('an open task past its due time is announced once with task.due and stamped; done, undated and future tasks are not', async () => {
    const mm = moments();
    const due = await task(t.admin, { title: 'Sweep me', dueAt: mm.overdue });
    const doneOne = await task(t.admin, { title: 'Done already', dueAt: mm.overdue });
    await api.as(t.admin).post(`/v2/tasks/${doneOne.id}/complete`).send({});
    await task(t.admin, { title: 'Future', dueAt: mm.upcoming });
    await task(t.admin, { title: 'Undated' });

    const n = await sweep.sweep();
    expect(n).toBeGreaterThanOrEqual(1);
    const evs = (await api.events(t.orgId, 'task.due')).filter((e) => e.uuid === due.id);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      title: 'Sweep me',
      assigneeId: await api.userUuid(t.adminUserId),
      createdById: await api.userUuid(t.adminUserId),
    });
    expect(await api.events(t.orgId, 'task.due')).toHaveLength(1);
    expect(
      ((await api.as(t.admin).get(`/v2/tasks/${due.id}`)).body as Task).remindedAt,
    ).not.toBeNull();

    // Idempotent: a second pass finds nothing for this workspace.
    await sweep.sweep();
    expect(await api.events(t.orgId, 'task.due')).toHaveLength(1);
  });

  it('reopening a reminded task arms it again, and an unassigned task still names its creator', async () => {
    const x = await task(t.admin, { title: 'Again', dueAt: moments().overdue, assigneeId: null });
    await sweep.sweep();
    expect((await api.events(t.orgId, 'task.due')).filter((e) => e.uuid === x.id)[0]).toMatchObject(
      { assigneeId: null, createdById: await api.userUuid(t.adminUserId) },
    );
    await api.as(t.admin).post(`/v2/tasks/${x.id}/complete`).send({});
    await api.as(t.admin).post(`/v2/tasks/${x.id}/reopen`).send({});
    await sweep.sweep();
    expect((await api.events(t.orgId, 'task.due')).filter((e) => e.uuid === x.id)).toHaveLength(2);
  });

  it('a mirrored timeline task is stamped on the timeline row too, so the deal reminder does not fire a second time', async () => {
    const deal = await api.deal(t.admin, { title: 'Sweep deal' });
    await api
      .as(t.admin)
      .post(`/v2/deals/${deal.id}/activities`)
      .send({ type: 'task', body: 'Overdue follow-up', dueAt: moments().overdue });
    await sweep.sweep();
    const row = await h.owner.query(
      `SELECT a.reminded_at FROM deal_activities a JOIN deals d ON d.org_id = a.org_id AND d.id = a.deal_id WHERE d.uuid = $1 AND a.type = 'task'`,
      [deal.id],
    );
    expect(row.rows[0].reminded_at).not.toBeNull();
  });
});
