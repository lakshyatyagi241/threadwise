import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FOLLOW_UP_DEFAULTS } from '@crm/contracts';
import { ContactTouchService } from '../../../src/modules/crm';
import { TaskDueSweepService } from '../../../src/modules/crm/tasks/task-due-sweep.service';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * Automatic follow-ups (BL-291) end to end on real Postgres: the settings document, what a contact action does to the contact's next
 * follow-up under each rule, the default date and alert time in the workspace's time zone, the one-open-follow-up invariant under
 * concurrency, the reminder sweep, the by-hand endpoints with their scopes, the list filter and the stats. With the default settings
 * nothing is created.
 */
let h: Harness;
let api: Api;
let touch: ContactTouchService;
let db: DatabaseService;
let sweep: TaskDueSweepService;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  touch = h.app.get(ContactTouchService);
  db = h.app.get(DatabaseService);
  sweep = new TaskDueSweepService(db, h.app.get(OutboxService));
}, 1_500_000);

afterAll(async () => {
  await h?.stop();
});

let n = 0;
const phone = () => `+9198${String(40_000_000 + n++)}`;
const url = '/v2/lead-handling/settings/follow-ups';

type When = Partial<typeof FOLLOW_UP_DEFAULTS.updateWhen>;
const settings = async (
  t: Tenant,
  over: { when?: When; defaultDate?: Record<string, unknown>; defaultTime?: string } = {},
) => {
  const cur = (await api.as(t.admin).get('/v2/lead-handling/settings')).body.followUps as {
    rowVersion: number | null;
  };
  const res = await api
    .as(t.admin)
    .put(url)
    .send({
      updateWhen: { ...FOLLOW_UP_DEFAULTS.updateWhen, ...over.when },
      defaultDate: over.defaultDate ?? FOLLOW_UP_DEFAULTS.defaultDate,
      defaultTime: over.defaultTime ?? FOLLOW_UP_DEFAULTS.defaultTime,
      ...(cur.rowVersion ? { rowVersion: cur.rowVersion } : {}),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};
const zone = (t: Tenant, tz: string) =>
  h.owner.query(
    `UPDATE organizations SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{timezone}', to_jsonb($2::text)) WHERE id = $1`,
    [t.orgId, tz],
  );

const create = async (t: Tenant, body: Record<string, unknown> = {}) => {
  const res = await api
    .as(t.admin)
    .post('/v2/contacts')
    .send({ firstName: 'Lead', phone: phone(), ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string };
};
const internalId = async (uuid: string) =>
  Number((await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [uuid])).rows[0].id);

/** A touch as a person: what a message dispatch or a button press does, with the person as the actor. */
const touchAs = async (t: Tenant, uuid: string, userId = t.adminUserId) => {
  const id = await internalId(uuid);
  await RequestContextStore.run(
    { requestId: 'e2e', orgId: t.orgId, actorType: 'user', actorId: userId, userId },
    () => db.txAs({ orgId: t.orgId }, (tx) => touch.touch(tx, t.orgId, id, 'message', userId)),
  );
};

interface FollowUpRow {
  uuid: string;
  status: string;
  source: string;
  kind: string;
  due_at: Date | null;
  assignee_id: number | null;
  day_offset: number | null;
  clock: string | null;
}
/** The contact's follow-up tasks, with the due date read on a zone: its clock and how many days from today it is there. */
const followUps = async (uuid: string, tz = 'UTC'): Promise<FollowUpRow[]> =>
  (
    await h.owner.query(
      `SELECT t.uuid, t.status, t.source, t.kind, t.due_at, t.assignee_id,
              ((t.due_at AT TIME ZONE $2)::date - (now() AT TIME ZONE $2)::date)::int AS day_offset,
              to_char(t.due_at AT TIME ZONE $2, 'HH24:MI') AS clock
       FROM tasks t JOIN contacts c ON c.org_id = t.org_id AND c.id = t.contact_id
       WHERE c.uuid = $1 AND t.kind = 'follow_up' ORDER BY t.id`,
      [uuid, tz],
    )
  ).rows as FollowUpRow[];
const open = async (uuid: string, tz = 'UTC') =>
  (await followUps(uuid, tz)).filter((r) => r.status === 'open');
const setDue = (uuid: string, sqlExpr: string | null) =>
  h.owner.query(
    `UPDATE tasks SET due_at = ${sqlExpr ?? 'NULL'}, reminded_at = NULL
     WHERE kind = 'follow_up' AND status = 'open' AND contact_id = (SELECT id FROM contacts WHERE uuid = $1)`,
    [uuid],
  );
/** Gives the contact an open follow-up the way a person would, then moves its due date in SQL. */
const seedFollowUp = async (t: Tenant, uuid: string, sqlExpr: string | null) => {
  const res = await api
    .as(t.admin)
    .put(`/v2/contacts/${uuid}/follow-up`)
    .send({ dueAt: new Date(Date.now() + 40 * 86_400_000).toISOString() });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await setDue(uuid, sqlExpr);
};

describe('the settings document', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('fus');
  });

  it('reads as the defaults before it is saved: everything off, 3 days later, 09:00', async () => {
    const res = await api.as(t.admin).get('/v2/lead-handling/settings');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.followUps).toMatchObject({ ...FOLLOW_UP_DEFAULTS, rowVersion: null });
  });

  it('is saved with a version, audited, and refuses a stale or invalid document', async () => {
    await settings(t, { when: { none: true } });
    const got = (await api.as(t.admin).get('/v2/lead-handling/settings')).body.followUps;
    expect(got).toMatchObject({ rowVersion: 1, updateWhen: { none: true } });
    const body = { ...FOLLOW_UP_DEFAULTS };
    expect((await api.as(t.admin).put(url).send(body)).status).toBe(409);
    expect(
      (
        await api
          .as(t.admin)
          .put(url)
          .send({ ...body, rowVersion: 9 })
      ).status,
    ).toBe(409);
    expect(
      (
        await api
          .as(t.admin)
          .put(url)
          .send({ ...body, defaultDate: { kind: 'days', days: 400 }, rowVersion: 1 })
      ).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .put(url)
          .send({ ...body, defaultTime: '25:61', rowVersion: 1 })
      ).status,
    ).toBe(422);
    const audit = await h.owner.query(
      `SELECT action, delta FROM audit_log WHERE org_id = $1 AND module = 'lead_followup_settings' ORDER BY id`,
      [t.orgId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].delta['updateWhen.none']).toEqual({ old: false, new: true });
  });

  it('needs admin.settings.manage, and is private to the workspace', async () => {
    const m = await api.member(t, 'ed', [['record.contacts.update']]);
    expect(
      (
        await api
          .as(m.token)
          .put(url)
          .send({ ...FOLLOW_UP_DEFAULTS, rowVersion: 1 })
      ).status,
    ).toBe(403);
    const other = await api.signup('fus2');
    expect(
      (await api.as(other.admin).get('/v2/lead-handling/settings')).body.followUps,
    ).toMatchObject({
      rowVersion: null,
      updateWhen: { none: false },
    });
  });
});

describe('with the default settings a contact action creates nothing', () => {
  it('no follow-up task, no event, no change to the contact', async () => {
    const t = await api.signup('fud');
    const c = await create(t);
    await touchAs(t, c.id);
    expect(await followUps(c.id)).toHaveLength(0);
    expect(await api.events(t.orgId, 'task.created')).toHaveLength(0);
  });
});

describe('the four situations', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('fur');
    await zone(t, 'Asia/Kolkata');
  });

  it('no follow-up: one is created for the owner, 3 days later at 09:00 in the workspace zone, as an auto follow-up task', async () => {
    await settings(t, { when: { none: true } });
    const c = await create(t);
    await touchAs(t, c.id);
    const rows = await followUps(c.id, 'Asia/Kolkata');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'open',
      source: 'auto',
      kind: 'follow_up',
      clock: '09:00',
      day_offset: 3,
    });
    expect(rows[0]!.assignee_id).toBe(t.adminUserId);
    const contact = (await api.as(t.admin).get(`/v2/contacts/${c.id}`)).body;
    expect(contact.nextFollowUp).toMatchObject({ id: rows[0]!.uuid });
    expect(new Date(contact.nextFollowUp.dueAt).getTime()).toBe(rows[0]!.due_at!.getTime());
    const tasks = await api.as(t.admin).get('/v2/tasks?limit=100');
    expect(
      (tasks.body.data as Array<{ id: string; kind: string }>).find((x) => x.id === rows[0]!.uuid)
        ?.kind,
    ).toBe('follow_up');
  });

  it('is idempotent: touching again changes nothing, and there is still one open follow-up with the same date', async () => {
    const c = await create(t);
    await touchAs(t, c.id);
    const first = (await followUps(c.id))[0]!;
    const audits = await h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'tasks'`,
      [t.orgId],
    );
    await touchAs(t, c.id);
    await touchAs(t, c.id);
    const rows = await followUps(c.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ uuid: first.uuid });
    expect(rows[0]!.due_at!.getTime()).toBe(first.due_at!.getTime());
    const after = await h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'tasks'`,
      [t.orgId],
    );
    expect(after.rows[0].n).toBe(audits.rows[0].n);
  });

  it('a follow-up without a date counts as none', async () => {
    const c = await create(t);
    await seedFollowUp(t, c.id, null);
    await touchAs(t, c.id);
    const rows = await open(c.id, 'Asia/Kolkata');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day_offset: 3, clock: '09:00' });
  });

  it.each([
    ['overdue', "now() - interval '2 days'", 'overdue', 3],
    ['today', "now() + interval '1 minute'", 'today', 3],
    ['future', "now() + interval '20 days'", 'future', 3],
  ] as const)(
    'a %s follow-up moves only when its own option is on',
    async (_state, due, key, offset) => {
      const c = await create(t);
      await seedFollowUp(t, c.id, due);
      const before = (await open(c.id))[0]!;
      // every option except this one: nothing moves
      const others: When = { none: true, overdue: true, today: true, future: true, [key]: false };
      await settings(t, { when: others });
      await touchAs(t, c.id);
      expect((await open(c.id))[0]!.due_at!.getTime(), 'the option is off').toBe(
        before.due_at!.getTime(),
      );
      await settings(t, {
        when: { none: false, overdue: false, today: false, future: false, [key]: true },
      });
      await touchAs(t, c.id);
      const after = await open(c.id, 'Asia/Kolkata');
      expect(after, 'the option is on').toHaveLength(1);
      expect(after[0]).toMatchObject({ uuid: before.uuid, day_offset: offset, clock: '09:00' });
      await settings(t, { when: { none: true } });
    },
    120_000,
  );

  it('an existing follow-up keeps its person; a new one belongs to whoever got in touch when the contact has no owner', async () => {
    const asha = await api.member(t, 'asha', [
      ['record.contacts.update'],
      ['record.contacts.read'],
    ]);
    const c = await create(t, { ownerId: null });
    await touchAs(t, c.id, asha.userId);
    expect((await open(c.id))[0]!.assignee_id).toBe(asha.userId);
    await settings(t, { when: { none: true, overdue: true } });
    await setDue(c.id, "now() - interval '1 day'");
    await touchAs(t, c.id);
    expect((await open(c.id))[0]!.assignee_id).toBe(asha.userId);
    await settings(t, { when: { none: true } });
  });
});

describe('the default date and the alert time', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('fud2');
    await zone(t, 'America/New_York');
  });

  it.each([
    [{ kind: 'days', days: 1 }, 1],
    [{ kind: 'days', days: 7 }, 7],
    [{ kind: 'days', days: 12 }, 12],
  ] as const)(
    '%j is that many days later at the chosen time, in the workspace zone',
    async (defaultDate, offset) => {
      await settings(t, {
        when: { none: true },
        defaultDate: { ...defaultDate },
        defaultTime: '17:45',
      });
      const c = await create(t);
      await touchAs(t, c.id);
      expect((await open(c.id, 'America/New_York'))[0]).toMatchObject({
        day_offset: offset,
        clock: '17:45',
      });
      await settings(t, { when: { none: true }, defaultDate: { kind: 'days', days: 3 } });
    },
  );

  it('one month later is the same day of the next month', async () => {
    await settings(t, { when: { none: true }, defaultDate: { kind: 'month' } });
    const c = await create(t);
    await touchAs(t, c.id);
    const row = (await open(c.id, 'America/New_York'))[0]!;
    const ok = await h.owner.query(
      `SELECT ((($1::timestamptz AT TIME ZONE 'America/New_York')::date) = LEAST(
          ((now() AT TIME ZONE 'America/New_York')::date + interval '1 month')::date,
          (date_trunc('month', now() AT TIME ZONE 'America/New_York') + interval '2 month - 1 day')::date)) AS ok`,
      [row.due_at],
    );
    expect(ok.rows[0].ok).toBe(true);
  });

  it('someday makes an open follow-up with no date; none completes the open one and makes no new one', async () => {
    await settings(t, { when: { none: true, future: true }, defaultDate: { kind: 'someday' } });
    const c = await create(t);
    await touchAs(t, c.id);
    const rows = await open(c.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.due_at).toBeNull();

    await settings(t, { when: { none: true, future: true }, defaultDate: { kind: 'none' } });
    await touchAs(t, c.id);
    const all = await followUps(c.id);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe('done');
    const fresh = await create(t);
    await touchAs(t, fresh.id);
    expect(await followUps(fresh.id)).toHaveLength(0);
  });
});

describe('one open follow-up per contact, whatever happens at once', () => {
  it('two touches at the same moment make one follow-up and no error', async () => {
    const t = await api.signup('fuc');
    await settings(t, { when: { none: true } });
    const c = await create(t);
    await Promise.all([touchAs(t, c.id), touchAs(t, c.id), touchAs(t, c.id)]);
    expect(await followUps(c.id)).toHaveLength(1);
  });

  it('two people setting it by hand at once end with one open follow-up', async () => {
    const t = await api.signup('fuc2');
    const c = await create(t);
    const put = () =>
      api
        .as(t.admin)
        .put(`/v2/contacts/${c.id}/follow-up`)
        .send({ dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    const [a, b] = await Promise.all([put(), put()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await open(c.id)).toHaveLength(1);
  });
});

describe('the reminder', () => {
  it('a dated follow-up is announced once when it falls due; a someday one never is', async () => {
    const t = await api.signup('fuw');
    const dated = await create(t);
    const someday = await create(t);
    await seedFollowUp(t, dated.id, "now() - interval '5 minutes'");
    await seedFollowUp(t, someday.id, null);
    await sweep.sweep();
    await sweep.sweep();
    const due = (await api.events(t.orgId, 'task.due')) as Array<Record<string, unknown>>;
    const mine = due.filter((e) => e.contactId === dated.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ source: 'manual', contactId: dated.id });
    expect(due.some((e) => e.contactId === someday.id)).toBe(false);
  });
});

describe('by hand', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('fuh');
    await zone(t, 'Asia/Kolkata');
  });
  const in5 = () => new Date(Date.now() + 5 * 86_400_000).toISOString();

  it('sets, moves, snoozes, completes and removes a follow-up, and the contact shows it', async () => {
    const c = await create(t);
    const set = await api.as(t.admin).put(`/v2/contacts/${c.id}/follow-up`).send({ dueAt: in5() });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.nextFollowUp).toMatchObject({ dueAt: expect.any(String) });
    const moved = await api.as(t.admin).put(`/v2/contacts/${c.id}/follow-up`).send({ dueAt: null });
    expect(moved.body.nextFollowUp).toMatchObject({ id: set.body.nextFollowUp.id, dueAt: null });
    expect(await open(c.id)).toHaveLength(1);

    const snoozed = await api
      .as(t.admin)
      .post(`/v2/contacts/${c.id}/follow-up/snooze`)
      .send({ preset: 'week' });
    expect(snoozed.status, JSON.stringify(snoozed.body)).toBe(200);
    expect((await open(c.id, 'Asia/Kolkata'))[0]).toMatchObject({ day_offset: 7, clock: '09:00' });

    const done = await api.as(t.admin).post(`/v2/contacts/${c.id}/follow-up/done`).send({});
    expect(done.body).toEqual({ nextFollowUp: null });
    expect((await followUps(c.id))[0]!.status).toBe('done');
    expect(
      ((await api.as(t.admin).get(`/v2/contacts/${c.id}`)).body as { nextFollowUp: unknown })
        .nextFollowUp,
    ).toBeNull();

    await api.as(t.admin).put(`/v2/contacts/${c.id}/follow-up`).send({ dueAt: in5() });
    const cleared = await api.as(t.admin).delete(`/v2/contacts/${c.id}/follow-up`);
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(await open(c.id)).toHaveLength(0);
  });

  it('snoozing a contact without a follow-up is 404; an unknown contact is 404', async () => {
    const c = await create(t);
    expect(
      (await api.as(t.admin).post(`/v2/contacts/${c.id}/follow-up/snooze`).send({ preset: 'day' }))
        .status,
    ).toBe(404);
    expect(
      (
        await api
          .as(t.admin)
          .put(`/v2/contacts/00000000-0000-4000-8000-000000000009/follow-up`)
          .send({ dueAt: in5() })
      ).status,
    ).toBe(404);
  });

  it('a new follow-up needs permission to create tasks; moving an existing one does not', async () => {
    const m = await api.member(t, 'noTasks', [
      ['record.contacts.read'],
      ['record.contacts.update'],
    ]);
    const c = await create(t);
    expect(
      (await api.as(m.token).put(`/v2/contacts/${c.id}/follow-up`).send({ dueAt: in5() })).status,
    ).toBe(403);
    await api.as(t.admin).put(`/v2/contacts/${c.id}/follow-up`).send({ dueAt: in5() });
    expect(
      (await api.as(m.token).put(`/v2/contacts/${c.id}/follow-up`).send({ dueAt: null })).status,
    ).toBe(200);
  });

  it("a member limited to their own contacts cannot reach someone else's follow-up", async () => {
    const m = await api.member(t, 'own', [
      ['record.contacts.read', 'own'],
      ['record.contacts.update', 'own'],
      ['record.tasks.create'],
    ]);
    const theirs = await create(t);
    await api.as(t.admin).put(`/v2/contacts/${theirs.id}/follow-up`).send({ dueAt: in5() });
    for (const res of [
      await api.as(m.token).put(`/v2/contacts/${theirs.id}/follow-up`).send({ dueAt: null }),
      await api.as(m.token).post(`/v2/contacts/${theirs.id}/follow-up/done`).send({}),
      await api.as(m.token).delete(`/v2/contacts/${theirs.id}/follow-up`),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(await open(theirs.id)).toHaveLength(1);
  });

  it('another workspace cannot reach it', async () => {
    const other = await api.signup('fuh2');
    const c = await create(t);
    await api.as(t.admin).put(`/v2/contacts/${c.id}/follow-up`).send({ dueAt: in5() });
    expect(
      (await api.as(other.admin).post(`/v2/contacts/${c.id}/follow-up/done`).send({})).status,
    ).toBe(404);
    expect(await open(c.id)).toHaveLength(1);
  });
});

describe('finding contacts by follow-up', () => {
  it('filters by state, and the stats count the contacts with one', async () => {
    const t = await api.signup('fuf');
    const mk = async (due: string | null | 'none') => {
      const c = await create(t);
      if (due !== 'none') await seedFollowUp(t, c.id, due);
      return c.id;
    };
    const overdue = await mk("now() - interval '3 days'");
    const today = await mk("now() + interval '1 minute'");
    const upcoming = await mk("now() + interval '30 days'");
    const someday = await mk(null);
    const none = await mk('none');
    const ids = async (state: string) =>
      (
        (await api.as(t.admin).get(`/v2/contacts?followUp=${state}&limit=100`)).body.data as Array<{
          id: string;
        }>
      )
        .map((c) => c.id)
        .sort();
    expect(await ids('overdue')).toEqual([overdue]);
    expect(await ids('today')).toEqual([today]);
    expect(await ids('upcoming')).toEqual([upcoming]);
    expect(await ids('someday')).toEqual([someday]);
    expect(await ids('none')).toEqual([none]);
    expect((await api.as(t.admin).get('/v2/contacts?followUp=bogus')).status).toBe(422);
    const stats = (await api.as(t.admin).get('/v2/contacts/stats')).body as {
      withFollowUp: number;
    };
    expect(stats.withFollowUp).toBe(4);
    const bulk = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/uncontacted')
      .send({ filter: { followUp: 'overdue' }, uncontacted: true });
    expect(bulk.body).toMatchObject({ matched: 1, changed: 1 });
  });
});
