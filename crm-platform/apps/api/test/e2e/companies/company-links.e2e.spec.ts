import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DealsApi,
  startHarness,
  uuidRe,
  type Grant,
  type Harness,
  type Tenant,
} from '../deals-pipelines/support';

/**
 * The company pickers and the company's tasks (BL-034). Putting a company on a contact or a deal needs `record.companies.read` and
 * the company inside the caller's record scope (outside it is 404, never 403, so a company is not revealed); a company a record
 * already has never blocks an unrelated edit; and `GET /companies/:id/tasks` is the company page's tasks card. One app, one
 * database; each block works in an organization of its own.
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
const DAY = 86_400_000;

/** Reads companies at `own` scope, and writes contacts, deals and tasks like a sales rep. */
const REP: Grant[] = [
  ['record.companies.read', 'own'],
  ['record.companies.create'],
  ['record.contacts.read'],
  ['record.contacts.create'],
  ['record.contacts.update'],
  ['record.deals.read'],
  ['record.deals.create'],
  ['record.deals.update'],
  ['record.tasks.read'],
  ['record.tasks.create'],
];
/** The same without any right to see companies. */
const BLIND_REP: Grant[] = REP.filter(([k]) => !k.startsWith('record.companies.'));

async function company(token: string, body: Record<string, unknown>) {
  const res = await api.as(token).post('/v2/companies').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; name: string; rowVersion: number };
}

describe('linking a company from a contact or a deal needs the right to read it', () => {
  let t: Tenant;
  let rep: { token: string; userId: number };
  let blind: { token: string; userId: number };
  let mine: { id: string };
  let theirs: { id: string };
  let phone = 5550100;
  const nextPhone = () => `+1415${phone++}`;

  beforeAll(async () => {
    t = await api.signup('cl');
    rep = await api.member(t, 'clrep', REP);
    blind = await api.member(t, 'clblind', BLIND_REP);
    mine = await company(rep.token, { name: 'Rep company' });
    theirs = await company(t.admin, { name: 'Admin company', ownerId: null });
  });

  it('a contact: a company in the rep’s scope links on create and on edit; the contact answers with the company id', async () => {
    const created = await api
      .as(rep.token)
      .post('/v2/contacts')
      .send({ name: 'Linked At Create', phone: nextPhone(), companyId: mine.id });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.companyId).toBe(mine.id);

    const plain = await api
      .as(rep.token)
      .post('/v2/contacts')
      .send({ name: 'Linked Later', phone: nextPhone() });
    expect(plain.status).toBe(201);
    expect(plain.body.companyId).toBeNull();
    const edited = await api
      .as(rep.token)
      .patch(`/v2/contacts/${plain.body.id}`)
      .send({ companyId: mine.id, rowVersion: plain.body.rowVersion });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.companyId).toBe(mine.id);

    const cleared = await api
      .as(rep.token)
      .patch(`/v2/contacts/${plain.body.id}`)
      .send({ companyId: null, rowVersion: edited.body.rowVersion });
    expect(cleared.status).toBe(200);
    expect(cleared.body.companyId).toBeNull();
  });

  it('a contact: a company outside the record scope is 404 (not 403) on create and on edit, and nothing is written', async () => {
    const before = await h.owner.query(
      `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`,
      [t.orgId],
    );
    const create = await api
      .as(rep.token)
      .post('/v2/contacts')
      .send({ name: 'Outside', phone: nextPhone(), companyId: theirs.id });
    expect(create.status).toBe(404);
    expect(code(create)).toBe('NOT_FOUND');
    // The answer names the field, so the form can say it at the company field instead of "this contact no longer exists".
    expect(create.body.errors).toEqual([expect.objectContaining({ path: 'companyId' })]);
    const after = await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(after.rows[0].n).toBe(before.rows[0].n);

    const own = await api
      .as(rep.token)
      .post('/v2/contacts')
      .send({ name: 'Edit target', phone: nextPhone() });
    const edit = await api
      .as(rep.token)
      .patch(`/v2/contacts/${own.body.id}`)
      .send({ companyId: theirs.id, rowVersion: own.body.rowVersion });
    expect(edit.status).toBe(404);
    const row = await h.owner.query(`SELECT company_id FROM contacts WHERE uuid = $1`, [
      own.body.id,
    ]);
    expect(row.rows[0].company_id).toBeNull();
  });

  it('a contact: without record.companies.read the link is 403; a company the contact already has never blocks an unrelated edit', async () => {
    const refused = await api
      .as(blind.token)
      .post('/v2/contacts')
      .send({ name: 'Blind link', phone: nextPhone(), companyId: mine.id });
    expect(refused.status).toBe(403);
    expect(code(refused)).toBe('FORBIDDEN');
    expect(refused.body.errors).toEqual([expect.objectContaining({ path: 'companyId' })]);

    // The admin links it; the blind rep edits another field and sends the same company back (a form that round-trips it).
    const made = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Already linked', phone: nextPhone(), companyId: theirs.id });
    expect(made.status).toBe(201);
    const kept = await api
      .as(blind.token)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({ firstName: 'Renamed', companyId: theirs.id, rowVersion: made.body.rowVersion });
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    expect(kept.body.companyId).toBe(theirs.id);
    // ...but cannot move it to another company.
    const moved = await api
      .as(blind.token)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({ companyId: mine.id, rowVersion: kept.body.rowVersion });
    expect(moved.status).toBe(403);
  });

  it('a contact: an unknown company, or one from another workspace, is 404 for everyone', async () => {
    const other = await api.signup('clo');
    const foreign = await company(other.admin, { name: 'Foreign' });
    for (const id of [foreign.id, '00000000-0000-4000-8000-000000000001']) {
      const res = await api
        .as(t.admin)
        .post('/v2/contacts')
        .send({ name: 'Nowhere', phone: nextPhone(), companyId: id });
      expect(res.status).toBe(404);
    }
  });

  it('a deal: the same rules on create and edit; a contact’s company still comes along without a check', async () => {
    const ok = await api.deal(rep.token, { title: 'Deal in my company', companyId: mine.id });
    expect(ok.company?.id).toBe(mine.id);

    const outside = await api.as(rep.token).post('/v2/deals').send({
      title: 'Deal outside',
      companyId: theirs.id,
    });
    expect(outside.status).toBe(404);

    const bare = await api.deal(rep.token, { title: 'Deal edited' });
    const edit = await api
      .as(rep.token)
      .patch(`/v2/deals/${bare.id}`)
      .send({ companyId: theirs.id, rowVersion: bare.rowVersion });
    expect(edit.status).toBe(404);
    const edited = await api
      .as(rep.token)
      .patch(`/v2/deals/${bare.id}`)
      .send({ companyId: mine.id, rowVersion: bare.rowVersion });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.company.id).toBe(mine.id);

    const refused = await api.as(blind.token).post('/v2/deals').send({
      title: 'Blind deal',
      companyId: mine.id,
    });
    expect(refused.status).toBe(403);

    // A deal with no company of its own takes its contact's company: that is not a choice of the caller, so it is not checked.
    const linked = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Company person', phone: nextPhone(), companyId: theirs.id });
    const inherits = await api.as(rep.token).post('/v2/deals').send({
      title: 'Inherits',
      contactId: linked.body.id,
    });
    expect(inherits.status, JSON.stringify(inherits.body)).toBe(201);
    expect(inherits.body.company.id).toBe(theirs.id);
  });
});

describe("a company's tasks (GET /companies/:id/tasks)", () => {
  let t: Tenant;
  let co: { id: string };
  let other: { id: string };

  async function task(token: string, body: Record<string, unknown>) {
    const res = await api.as(token).post('/v2/tasks').send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as {
      id: string;
      title: string;
      status: string;
      company: { id: string } | null;
    };
  }

  beforeAll(async () => {
    t = await api.signup('ct');
    co = await company(t.admin, { name: 'Tasks Co' });
    other = await company(t.admin, { name: 'Other Co' });
  });

  it('lists the open tasks of that company, soonest due first, and not the tasks of another company or of none', async () => {
    const soon = await task(t.admin, {
      title: 'Soon',
      companyId: co.id,
      dueAt: new Date(Date.now() + DAY).toISOString(),
    });
    const later = await task(t.admin, {
      title: 'Later',
      companyId: co.id,
      dueAt: new Date(Date.now() + 5 * DAY).toISOString(),
    });
    await task(t.admin, { title: 'Elsewhere', companyId: other.id });
    await task(t.admin, { title: 'Nowhere' });

    const res = await api.as(t.admin).get(`/v2/companies/${co.id}/tasks`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.map((x: { title: string }) => x.title)).toEqual(['Soon', 'Later']);
    expect(res.body.data[0].company).toEqual({ id: co.id, name: 'Tasks Co' });
    expect(res.body.data[0].id).toMatch(uuidRe);
    expect(res.body.page).toMatchObject({ hasMore: false, nextCursor: null });

    // done tasks only on request, like the other lists
    await api.as(t.admin).post(`/v2/tasks/${soon.id}/complete`).send({});
    const open = await api.as(t.admin).get(`/v2/companies/${co.id}/tasks`);
    expect(open.body.data.map((x: { id: string }) => x.id)).toEqual([later.id]);
    const done = await api.as(t.admin).get(`/v2/companies/${co.id}/tasks?status=done`);
    expect(done.body.data.map((x: { id: string }) => x.id)).toEqual([soon.id]);
  });

  it('pages with a cursor and honours the limit', async () => {
    const paged = await company(t.admin, { name: 'Paged Co' });
    for (let i = 0; i < 5; i++) await task(t.admin, { title: `P${i}`, companyId: paged.id });
    const first = await api.as(t.admin).get(`/v2/companies/${paged.id}/tasks?limit=2`);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.page.hasMore).toBe(true);
    const seen = new Set<string>(first.body.data.map((x: { id: string }) => x.id));
    let cursor = first.body.page.nextCursor as string | null;
    while (cursor) {
      const next = await api
        .as(t.admin)
        .get(`/v2/companies/${paged.id}/tasks?limit=2&cursor=${encodeURIComponent(cursor)}`);
      expect(next.status).toBe(200);
      for (const x of next.body.data as Array<{ id: string }>) {
        expect(seen.has(x.id)).toBe(false);
        seen.add(x.id);
      }
      cursor = next.body.page.nextCursor;
    }
    expect(seen.size).toBe(5);
  });

  it('needs record.tasks.read (403) and record.companies.read on the company, whose record scope applies (404)', async () => {
    const noTasks = await api.member(t, 'ctnt', [['record.companies.read']]);
    expect((await api.as(noTasks.token).get(`/v2/companies/${co.id}/tasks`)).status).toBe(403);

    const noCompanies = await api.member(t, 'ctnc', [['record.tasks.read']]);
    expect((await api.as(noCompanies.token).get(`/v2/companies/${co.id}/tasks`)).status).toBe(403);

    const scoped = await api.member(t, 'ctsc', [
      ['record.companies.read', 'own'],
      ['record.tasks.read'],
    ]);
    const hidden = await api.as(scoped.token).get(`/v2/companies/${co.id}/tasks`);
    expect(hidden.status).toBe(404);
    expect(code(hidden)).toBe('NOT_FOUND');
    const scopedUuid = await api.userUuid(scoped.userId);
    const visible = await company(t.admin, { name: 'Visible to scoped', ownerId: scopedUuid });
    await task(t.admin, { title: 'Seen', companyId: visible.id });
    const seen = await api.as(scoped.token).get(`/v2/companies/${visible.id}/tasks`);
    expect(seen.status).toBe(200);
    expect(seen.body.data).toHaveLength(1);
  });

  it("the task scope still applies: someone who sees only their own tasks sees only those of the company's tasks", async () => {
    const worker = await api.member(t, 'ctw', [
      ['record.companies.read'],
      ['record.tasks.read', 'own'],
    ]);
    const workerUuid = await api.userUuid(worker.userId);
    const shared = await company(t.admin, { name: 'Shared tasks' });
    await task(t.admin, { title: 'Theirs', companyId: shared.id, assigneeId: workerUuid });
    await task(t.admin, { title: 'Not theirs', companyId: shared.id });
    const res = await api.as(worker.token).get(`/v2/companies/${shared.id}/tasks`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((x: { title: string }) => x.title)).toEqual(['Theirs']);
  });

  it('a malformed id is 400, an unknown one 404, and a company of another workspace is 404', async () => {
    expect((await api.as(t.admin).get('/v2/companies/not-a-uuid/tasks')).status).toBe(400);
    expect(
      (await api.as(t.admin).get('/v2/companies/00000000-0000-4000-8000-000000000002/tasks'))
        .status,
    ).toBe(404);
    const foreignTenant = await api.signup('ctf');
    const foreign = await company(foreignTenant.admin, { name: 'Foreign Co' });
    expect((await api.as(t.admin).get(`/v2/companies/${foreign.id}/tasks`)).status).toBe(404);
  });

  it('a workspace whose plan lacks the sales pipeline is refused with 422 PLAN_FEATURE_LOCKED', async () => {
    const locked = await api.signup('ctl');
    const mineCo = await company(locked.admin, { name: 'Locked Co' });
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"sales_pipeline":false}}' WHERE org_id = $1`,
      [locked.orgId],
    );
    const res = await api.as(locked.admin).get(`/v2/companies/${mineCo.id}/tasks`);
    expect(res.status).toBe(422);
    expect(code(res)).toBe('PLAN_FEATURE_LOCKED');
  });
});
