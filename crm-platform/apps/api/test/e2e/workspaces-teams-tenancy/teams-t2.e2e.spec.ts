import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DealsApi, startHarness, type Harness, type Tenant } from '../deals-pipelines/support';
import { Inbox } from '../team-inbox-conversations/support';

/**
 * Teams T2 (BL-382, docs/specs/teams-unification.md) through HTTP on real Postgres:
 *
 *   1. the scope `team_and_below` on records (contacts, tasks, deals) and the hand-over bound that follows it;
 *   2. the unassigned conversation queue as the permission `inbox.conversation.read_unassigned`;
 *   3. `owning_team_id`: stamped when the owner is set (single edit, bulk edit, an owner-reassign batch), a person on two teams
 *      counted once, the Team filter of the contacts, deals and tasks lists;
 *   4. the Roles API: the new scope, the members-without-a-team count, and "no handing out more than you hold".
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let h: Harness;
let api: DealsApi;
let inbox: Inbox;

beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
  inbox = new Inbox(h, api);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const uuidOf = async (userId: number) =>
  (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

/** A team of the workspace (optionally under a parent), straight in the table. */
async function team(t: Tenant, name: string, parent?: { id: number }) {
  const r = await h.owner.query(
    `INSERT INTO teams (org_id, name, slug, parent_team_id) VALUES ($1,$2,$2,$3) RETURNING id, uuid`,
    [t.orgId, name, parent?.id ?? null],
  );
  return { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}
async function join(t: Tenant, teamId: number, userId: number, primary: boolean) {
  await h.owner.query(
    `INSERT INTO team_members (org_id, team_id, user_id, is_primary) VALUES ($1,$2,$3,$4)`,
    [t.orgId, teamId, userId, primary],
  );
}

const names = (body: { data: Array<{ name?: string; title?: string }> }) =>
  new Set(body.data.map((r) => r.name ?? r.title));

describe('team_and_below on records', () => {
  let t: Tenant;
  const people: Record<string, { token: string; userId: number; uuid: string }> = {};
  const contactOf: Record<string, string> = {};

  beforeAll(async () => {
    t = await api.signup('t2r');
    const hq = await team(t, 'HQ');
    const region = await team(t, 'Region', hq);
    const city = await team(t, 'City', region);
    const other = await team(t, 'Other');

    const read = (scope: 'team' | 'team_and_below' | 'own' | 'all') =>
      [
        ['record.contacts.read', scope],
        ['record.contacts.update', scope],
        ['record.tasks.read', scope],
        ['record.deals.read', scope],
      ] as Array<[string, typeof scope]>;
    const make = async (
      key: string,
      scope: Parameters<typeof read>[0],
      teamRow?: { id: number },
    ) => {
      const m = await api.member(t, key, read(scope));
      if (teamRow) await join(t, teamRow.id, m.userId, true);
      people[key] = { ...m, uuid: await uuidOf(m.userId) };
    };
    await make('boss', 'team_and_below', hq);
    await make('bossFlat', 'team', hq);
    await make('mid', 'team_and_below', region);
    await make('cityUser', 'team_and_below', city);
    await make('otherUser', 'team_and_below', other);
    await make('loner', 'team_and_below');
    await make('hqUser', 'own', hq);
    await make('regionUser', 'own', region);

    for (const k of ['hqUser', 'regionUser', 'cityUser', 'otherUser', 'loner']) {
      const [uuid] = await api.seedContacts(t, [{ name: `c-${k}`, ownerId: people[k]!.userId }]);
      contactOf[k] = uuid!;
    }
  });

  const contacts = async (who: string, qs = '') => {
    const res = await api.as(people[who]!.token).get(`/v2/contacts?limit=100${qs}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return names(res.body);
  };

  it('a manager sees the contacts of their team and of every team below, and not of a sibling tree', async () => {
    expect(await contacts('boss')).toEqual(new Set(['c-hqUser', 'c-regionUser', 'c-cityUser']));
  });

  it('team is narrower: only the people who share a team with me', async () => {
    expect(await contacts('bossFlat')).toEqual(new Set(['c-hqUser']));
  });

  it('a mid-level manager sees their team and below, never above', async () => {
    expect(await contacts('mid')).toEqual(new Set(['c-regionUser', 'c-cityUser']));
    expect(await contacts('cityUser')).toEqual(new Set(['c-cityUser']));
  });

  it('a person in no team with team_and_below sees only their own, like team does', async () => {
    expect(await contacts('loner')).toEqual(new Set(['c-loner']));
  });

  it('opening one record follows the same scope: 404 outside, 200 inside', async () => {
    const inside = await api.as(people.boss!.token).get(`/v2/contacts/${contactOf.cityUser}`);
    expect(inside.status, JSON.stringify(inside.body)).toBe(200);
    const sibling = await api.as(people.boss!.token).get(`/v2/contacts/${contactOf.otherUser}`);
    expect(sibling.status).toBe(404);
    const flat = await api.as(people.bossFlat!.token).get(`/v2/contacts/${contactOf.cityUser}`);
    expect(flat.status).toBe(404);
  });

  it('tasks and deals follow the same scope', async () => {
    for (const k of ['hqUser', 'cityUser', 'otherUser']) {
      const task = await api
        .as(t.admin)
        .post('/v2/tasks')
        .send({ title: `task-${k}`, assigneeId: people[k]!.uuid });
      expect(task.status, JSON.stringify(task.body)).toBe(201);
      await api.deal(t.admin, { title: `deal-${k}`, value: '10', ownerId: people[k]!.uuid });
    }
    const tasks = await api.as(people.boss!.token).get('/v2/tasks?limit=100&status=all');
    expect(tasks.status, JSON.stringify(tasks.body)).toBe(200);
    expect(names(tasks.body)).toEqual(new Set(['task-hqUser', 'task-cityUser']));
    const deals = await api.as(people.boss!.token).get('/v2/deals?limit=100');
    expect(deals.status, JSON.stringify(deals.body)).toBe(200);
    expect(names(deals.body)).toEqual(new Set(['deal-hqUser', 'deal-cityUser']));
    const flat = await api.as(people.bossFlat!.token).get('/v2/deals?limit=100');
    expect(names(flat.body)).toEqual(new Set(['deal-hqUser']));
  });

  it('the hand-over bound follows the scope: a team_and_below manager may give a record to a sub-team, a team manager may not', async () => {
    const cur = await api.as(people.boss!.token).get(`/v2/contacts/${contactOf.hqUser}`);
    const ok = await api
      .as(people.boss!.token)
      .patch(`/v2/contacts/${contactOf.hqUser}`)
      .send({ ownerId: people.cityUser!.uuid, rowVersion: cur.body.rowVersion });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const flatCur = await api.as(people.bossFlat!.token).get(`/v2/contacts/${contactOf.hqUser}`);
    // bossFlat can no longer see it (it moved to City); hand a visible one to a sub-team instead
    expect(flatCur.status).toBe(404);
    const mine = (
      await api.seedContacts(t, [{ name: 'flat-own', ownerId: people.bossFlat!.userId }])
    )[0]!;
    const flatMine = await api.as(people.bossFlat!.token).get(`/v2/contacts/${mine}`);
    const refused = await api
      .as(people.bossFlat!.token)
      .patch(`/v2/contacts/${mine}`)
      .send({ ownerId: people.cityUser!.uuid, rowVersion: flatMine.body.rowVersion });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
  });

  it('the widest scope wins when a person holds two roles', async () => {
    const both = await api.member(t, 'both', [['record.contacts.read', 'team']]);
    const second = await h.owner.query(
      `INSERT INTO roles (org_id, name) VALUES ($1,'both-second') RETURNING id`,
      [t.orgId],
    );
    await h.owner.query(
      `INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope) VALUES ($1,$2,'record.contacts.read','allow','team_and_below')`,
      [t.orgId, second.rows[0].id],
    );
    await h.owner.query(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      both.userId,
      second.rows[0].id,
    ]);
    const hq = (
      await h.owner.query(`SELECT id FROM teams WHERE org_id = $1 AND name = 'HQ'`, [t.orgId])
    ).rows[0].id;
    await join(t, Number(hq), both.userId, true);
    // roles_version is read per request; a fresh login is the simple way to pick the new role up
    const login = await api
      .http()
      .post('/v2/auth/login')
      .set('x-forwarded-for', '10.99.0.7')
      .send({
        orgSlug: t.slug,
        email: (await h.owner.query(`SELECT email FROM users WHERE id = $1`, [both.userId])).rows[0]
          .email,
        password: 'Str0ngPassw0rd#1',
      });
    expect(login.status, JSON.stringify(login.body)).toBeLessThan(300);
    const res = await api.as(login.body.tokens.accessToken).get('/v2/contacts?limit=100');
    expect(names(res.body).has('c-cityUser')).toBe(true);
  });
});

describe('the unassigned queue as a permission (decision D2)', () => {
  let t: Tenant;
  let ch: { id: string };
  const who: Record<string, { token: string; userId: number }> = {};
  const c: Record<string, string> = {};

  beforeAll(async () => {
    t = await api.signup('t2q');
    ch = await inbox.channel(t.admin);
    const hq = await team(t, 'HQ');
    const city = await team(t, 'City', hq);
    const other = await team(t, 'Other');
    const grants = (scope: 'team' | 'team_and_below' | 'own', queue: boolean) =>
      [
        ['inbox.conversation.read', scope],
        ...(queue ? [['inbox.conversation.read_unassigned']] : []),
      ] as Array<[string, ('team' | 'team_and_below' | 'own')?]>;
    const make = async (key: string, scope: 'team' | 'team_and_below' | 'own', queue: boolean) => {
      who[key] = await api.member(t, key, grants(scope, queue));
      await join(t, hq.id, who[key]!.userId, true);
    };
    await make('belowQueue', 'team_and_below', true);
    await make('belowNoQueue', 'team_and_below', false);
    await make('teamQueue', 'team', true);
    await make('teamNoQueue', 'team', false);
    await make('ownQueue', 'own', true);

    c.unassigned = (await inbox.conversation(t, ch.id, {})).uuid;
    c.toHq = (await inbox.conversation(t, ch.id, { assigneeTeamId: hq.id })).uuid;
    c.toCity = (await inbox.conversation(t, ch.id, { assigneeTeamId: city.id })).uuid;
    c.toOther = (await inbox.conversation(t, ch.id, { assigneeTeamId: other.id })).uuid;
    c.toBelow = (
      await inbox.conversation(t, ch.id, { assigneeUserId: who.belowNoQueue!.userId })
    ).uuid;
  });

  const seen = async (key: string) => {
    const res = await api.as(who[key]!.token).get('/v2/inbox/conversations?limit=100&tab=all');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return {
      ids: new Set((res.body.data as Array<{ id: string }>).map((r) => r.id)),
      all: res.body.meta.counts.all as number,
    };
  };

  it('team_and_below with the permission: my team, the teams below, mine and the queue; not a sibling tree', async () => {
    const s = await seen('belowQueue');
    expect(s.ids).toEqual(new Set([c.unassigned, c.toHq, c.toCity]));
    expect(s.all).toBe(s.ids.size);
  });

  it('team_and_below without it: the same, minus the unassigned queue', async () => {
    const s = await seen('belowNoQueue');
    expect(s.ids).toEqual(new Set([c.toHq, c.toCity, c.toBelow]));
    expect(s.all).toBe(s.ids.size);
    const hidden = await api
      .as(who.belowNoQueue!.token)
      .get(`/v2/inbox/conversations/${c.unassigned}`);
    expect(hidden.status).toBe(404);
  });

  it('team keeps what it always had with the permission (nothing changes for a migrated role) and loses only the queue without it', async () => {
    expect((await seen('teamQueue')).ids).toEqual(new Set([c.unassigned, c.toHq]));
    expect((await seen('teamNoQueue')).ids).toEqual(new Set([c.toHq]));
  });

  it('the permission widens team scopes only: own never saw the queue and still does not', async () => {
    expect((await seen('ownQueue')).ids).toEqual(new Set());
  });

  it('a team reader can still act on the queue they see: the acting scope keeps its rule', async () => {
    const member = await api.member(t, 'actor', [
      ['inbox.conversation.read', 'team'],
      ['inbox.conversation.read_unassigned'],
      ['inbox.conversation.note', 'team'],
    ]);
    const res = await api
      .as(member.token)
      .post(`/v2/inbox/conversations/${c.unassigned}/notes`)
      .send({ body: 'looking at it' });
    // The route exists and the scope check passes (it is not a 404 or 403 from visibility).
    expect([200, 201]).toContain(res.status);
  });
});

describe('owning team (decision D8)', () => {
  let t: Tenant;
  let hq: { id: number; uuid: string };
  let sales: { id: number; uuid: string };
  const p: Record<string, { userId: number; uuid: string }> = {};

  beforeAll(async () => {
    t = await api.signup('t2o');
    hq = await team(t, 'HQ');
    sales = await team(t, 'Sales');
    const user = async (name: string) => {
      const m = await api.member(t, name, []);
      p[name] = { userId: m.userId, uuid: await uuidOf(m.userId) };
    };
    for (const n of ['hqPerson', 'salesPerson', 'dual', 'undecided']) await user(n);
    await join(t, hq.id, p.hqPerson!.userId, true);
    await join(t, sales.id, p.salesPerson!.userId, true);
    // On two teams with a chosen primary: counts for HQ only.
    await join(t, hq.id, p.dual!.userId, true);
    await join(t, sales.id, p.dual!.userId, false);
    // On two teams, none chosen: belongs to no team in reports.
    await join(t, hq.id, p.undecided!.userId, false);
    await join(t, sales.id, p.undecided!.userId, false);
  });

  const listed = async (qs: string, path = '/v2/contacts') => {
    const res = await api.as(t.admin).get(`${path}${path.includes('?') ? '&' : '?'}limit=100${qs}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return names(res.body);
  };

  it('a contact created with an owner carries the owner primary team; the Team filter finds it', async () => {
    for (const [name, who] of [
      ['oc-hq', 'hqPerson'],
      ['oc-sales', 'salesPerson'],
      ['oc-dual', 'dual'],
      ['oc-undecided', 'undecided'],
    ] as const) {
      const res = await api
        .as(t.admin)
        .post('/v2/contacts')
        .send({
          firstName: name,
          phone: `+9170${String(30_000_000 + name.length * 7 + who.length)}`,
          ownerId: p[who]!.uuid,
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    expect(await listed(`&teamId=${hq.uuid}&q=oc-`)).toEqual(new Set(['oc-hq', 'oc-dual']));
    expect(await listed(`&teamId=${sales.uuid}&q=oc-`)).toEqual(new Set(['oc-sales']));
    // The person on two teams is counted once, the undecided person in none.
    expect(await listed('&q=oc-')).toEqual(
      new Set(['oc-hq', 'oc-sales', 'oc-dual', 'oc-undecided']),
    );
  });

  it('follows the owner when the owner changes: single edit, bulk edit and a reassign batch', async () => {
    const [a, b, c1, c2] = await api.seedContacts(t, [
      { name: 'mv-single', ownerId: p.hqPerson!.userId },
      { name: 'mv-bulk', ownerId: p.hqPerson!.userId },
      { name: 'mv-batch-1', ownerId: p.salesPerson!.userId },
      { name: 'mv-batch-2', ownerId: p.salesPerson!.userId },
    ]);
    expect(await listed(`&teamId=${hq.uuid}&q=mv-`)).toEqual(new Set(['mv-single', 'mv-bulk']));

    const cur = await api.as(t.admin).get(`/v2/contacts/${a}`);
    const edit = await api
      .as(t.admin)
      .patch(`/v2/contacts/${a}`)
      .send({ ownerId: p.salesPerson!.uuid, rowVersion: cur.body.rowVersion });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);

    const bulk = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/owner')
      .send({ ids: [b], ownerId: p.salesPerson!.uuid });
    expect(bulk.status, JSON.stringify(bulk.body)).toBe(200);

    const batch = await api
      .as(t.admin)
      .post('/v2/owner-reassignments')
      .set('idempotency-key', randomUUID())
      .send({
        fromUserId: p.salesPerson!.uuid,
        target: { kind: 'user', userId: p.hqPerson!.uuid },
      });
    expect(batch.status, JSON.stringify(batch.body)).toBeLessThan(300);

    expect(await listed(`&teamId=${sales.uuid}&q=mv-`)).toEqual(new Set());
    expect(await listed(`&teamId=${hq.uuid}&q=mv-`)).toEqual(
      new Set(['mv-single', 'mv-bulk', 'mv-batch-1', 'mv-batch-2']),
    );
    expect(c1 && c2).toBeTruthy();
  });

  it('clearing the owner clears the team', async () => {
    const [x] = await api.seedContacts(t, [{ name: 'clr-1', ownerId: p.hqPerson!.userId }]);
    expect(await listed(`&teamId=${hq.uuid}&q=clr-`)).toEqual(new Set(['clr-1']));
    const cur = await api.as(t.admin).get(`/v2/contacts/${x}`);
    const res = await api
      .as(t.admin)
      .patch(`/v2/contacts/${x}`)
      .send({ ownerId: null, rowVersion: cur.body.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await listed(`&teamId=${hq.uuid}&q=clr-`)).toEqual(new Set());
  });

  it('the Team filter on deals and tasks', async () => {
    await api.deal(t.admin, { title: 'dl-hq', value: '5', ownerId: p.hqPerson!.uuid });
    await api.deal(t.admin, { title: 'dl-sales', value: '5', ownerId: p.salesPerson!.uuid });
    await api.deal(t.admin, { title: 'dl-dual', value: '5', ownerId: p.dual!.uuid });
    expect(await listed(`&teamId=${hq.uuid}&q=dl-`, '/v2/deals')).toEqual(
      new Set(['dl-hq', 'dl-dual']),
    );
    expect(await listed(`&teamId=${sales.uuid}&q=dl-`, '/v2/deals')).toEqual(new Set(['dl-sales']));
    for (const [title, who] of [
      ['tk-hq', 'hqPerson'],
      ['tk-sales', 'salesPerson'],
      ['tk-dual', 'dual'],
    ] as const) {
      const res = await api.as(t.admin).post('/v2/tasks').send({ title, assigneeId: p[who]!.uuid });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    expect(await listed(`&teamId=${hq.uuid}&status=all&q=tk-`, '/v2/tasks')).toEqual(
      new Set(['tk-hq', 'tk-dual']),
    );
    expect(await listed(`&teamId=${sales.uuid}&status=all&q=tk-`, '/v2/tasks')).toEqual(
      new Set(['tk-sales']),
    );
  });

  it('an unknown team is an empty list, and a deleted team leaves the records where they are', async () => {
    expect(await listed(`&teamId=${randomUUID()}`)).toEqual(new Set());
    const gone = await team(t, 'Gone');
    await join(t, gone.id, (await api.member(t, 'gonePerson', [])).userId, true);
    const goneUser = (
      await h.owner.query(`SELECT user_id FROM team_members WHERE team_id = $1`, [gone.id])
    ).rows[0].user_id;
    await api.seedContacts(t, [{ name: 'gone-1', ownerId: Number(goneUser) }]);
    expect(await listed(`&teamId=${gone.uuid}&q=gone-`)).toEqual(new Set(['gone-1']));
    await h.owner.query(`DELETE FROM teams WHERE org_id = $1 AND id = $2`, [t.orgId, gone.id]);
    expect(await listed(`&q=gone-`)).toEqual(new Set(['gone-1']));
    expect(await listed(`&teamId=${gone.uuid}&q=gone-`)).toEqual(new Set());
  });

  it('the CRM dashboard counts a person on two teams once', async () => {
    const hqView = await api.as(t.admin).get(`/v2/crm/dashboard?range=30d&teamId=${hq.uuid}`);
    const salesView = await api.as(t.admin).get(`/v2/crm/dashboard?range=30d&teamId=${sales.uuid}`);
    expect(hqView.status, JSON.stringify(hqView.body)).toBe(200);
    // dl-dual belongs to HQ (the primary team of its owner) and not to Sales.
    expect(hqView.body.deals.open.count).toBe(2);
    expect(salesView.body.deals.open.count).toBe(1);
  });
});

describe('the Roles API', () => {
  let t: Tenant;

  beforeAll(async () => {
    t = await api.signup('t2roles');
  });

  it('saves the new scope, returns it, and counts the active members of the role who are in no team', async () => {
    const created = await api
      .as(t.admin)
      .post('/v2/roles')
      .send({
        name: 'Region lead',
        grants: [
          { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'team_and_below' },
        ],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.grants).toEqual([
      { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'team_and_below' },
    ]);
    expect(created.body.membersWithoutTeam).toBe(0);

    const roleId = (
      await h.owner.query(`SELECT id FROM roles WHERE org_id = $1 AND name = 'Region lead'`, [
        t.orgId,
      ])
    ).rows[0].id;
    const withTeam = await api.member(t, 'in-a-team', []);
    const without = await api.member(t, 'no-team', []);
    const squad = await team(t, 'Squad');
    await join(t, squad.id, withTeam.userId, true);
    for (const u of [withTeam, without]) {
      await h.owner.query(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1,$2,$3)`, [
        t.orgId,
        u.userId,
        roleId,
      ]);
    }
    const again = await api.as(t.admin).get(`/v2/roles/${created.body.id}`);
    expect(again.status).toBe(200);
    expect(again.body.userCount).toBe(2);
    expect(again.body.membersWithoutTeam).toBe(1);
  });

  it('nobody grants a wider scope than they hold: team_and_below is wider than team', async () => {
    const editor = await api.member(t, 'editor', [
      ['admin.role.manage'],
      ['record.contacts.read', 'team'],
    ]);
    const refused = await api
      .as(editor.token)
      .post('/v2/roles')
      .send({
        name: 'Too wide',
        grants: [
          { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'team_and_below' },
        ],
      });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body.code).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    const fine = await api
      .as(editor.token)
      .post('/v2/roles')
      .send({
        name: 'Same width',
        grants: [{ permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'team' }],
      });
    expect(fine.status, JSON.stringify(fine.body)).toBe(201);
  });

  it('lists the unassigned-queue permission as a switch without a scope', async () => {
    const res = await api.as(t.admin).get('/v2/permissions');
    expect(res.status).toBe(200);
    const def = (
      res.body.data as Array<{ key: string; supportsScope: boolean; category: string }>
    ).find((d) => d.key === 'inbox.conversation.read_unassigned');
    expect(def).toMatchObject({ supportsScope: false, category: 'inbox' });
  });
});
