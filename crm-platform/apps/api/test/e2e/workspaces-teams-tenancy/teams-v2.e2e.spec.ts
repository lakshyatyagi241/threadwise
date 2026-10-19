import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Teams v2 (BL-381, phase T1 of docs/specs/teams-unification.md) through HTTP on real Postgres: the hierarchy and its guards, the
 * manager, member roles and the primary team, the two keys (`team.read`, `team.manage`) with `inbox.team.manage` as an alias, the
 * deactivation rules (membership is kept, an inactive person never grants peer visibility, reactivation restores it) and the
 * hand-over the deactivate dialog asks for.
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

interface Team {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  lead: { id: string; fullName: string } | null;
  receivesConversations: boolean;
  receivesRecords: boolean;
  memberCount: number;
  members: Array<{
    id: string;
    role: 'member' | 'lead';
    isLead: boolean;
    isPrimary: boolean;
  }>;
  usage: {
    routingRules: number;
    assignmentRules: number;
    segmentShares: number;
    childTeams: number;
    conversations: number;
  };
  rowVersion: number;
}

const uuidOf = async (userId: number) =>
  (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;
const count = async (sql: string, params: unknown[]) =>
  Number((await h.owner.query(sql, params)).rows[0].n);

async function person(t: Tenant, name: string, extra: Array<[string, ('all' | 'team' | 'own')?]> = []) {
  // `team.read` so the person can open the Teams list in the checks that need it; extra grants are on top.
  const m = await api.member(t, name, [['team.read'], ...extra]);
  return { ...m, uuid: await uuidOf(m.userId) };
}

async function createTeam(token: string, body: Record<string, unknown>) {
  return api.as(token).post('/v2/workspace/teams').send(body);
}
async function patchTeam(token: string, team: Team, body: Record<string, unknown>) {
  return api
    .as(token)
    .patch(`/v2/workspace/teams/${team.id}`)
    .send({ rowVersion: team.rowVersion, ...body });
}
async function getTeam(token: string, id: string): Promise<Team> {
  const res = await api.as(token).get(`/v2/workspace/teams/${id}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Team;
}
const code = (res: { body: { code?: string } }) => res.body.code;

describe('Teams v2: hierarchy', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('tv2h');
  });

  it('creates a team with a parent, a manager and the receive switches; the response carries depth, manager, usage and the unused settings', async () => {
    const ana = await person(t, 'Ana');
    const top = await createTeam(t.admin, { name: 'Sales' });
    expect(top.status, JSON.stringify(top.body)).toBe(201);
    expect(top.body).toMatchObject({
      parentId: null,
      depth: 1,
      lead: null,
      receivesConversations: true,
      receivesRecords: true,
      isScopeBoundary: true,
      memberCount: 0,
      usage: { routingRules: 0, assignmentRules: 0, segmentShares: 0, childTeams: 0, conversations: 0 },
      unusedSettings: { businessHours: null, timezone: null, defaultAssignee: null },
    });

    const west = await createTeam(t.admin, {
      name: 'Sales West',
      parentId: top.body.id,
      leadId: ana.uuid,
      receivesConversations: false,
    });
    expect(west.status, JSON.stringify(west.body)).toBe(201);
    const w = west.body as Team;
    expect(w).toMatchObject({
      parentId: top.body.id,
      depth: 2,
      receivesConversations: false,
      receivesRecords: true,
      memberCount: 1,
    });
    expect(w.lead).toEqual({ id: ana.uuid, fullName: expect.any(String) });
    // The manager is a lead member, and a person on one team has it as primary.
    expect(w.members).toEqual([
      expect.objectContaining({ id: ana.uuid, role: 'lead', isLead: true, isPrimary: true }),
    ]);
    expect((await getTeam(t.admin, top.body.id)).usage.childTeams).toBe(1);
  });

  it('refuses a loop (a team under itself or under its own sub-team) with 422 WSP_TEAM_PARENT_CYCLE, and a tree deeper than 5 levels with 422 WSP_TEAM_PARENT_INVALID', async () => {
    const chain: Team[] = [];
    for (let i = 1; i <= 5; i++) {
      const res = await createTeam(t.admin, {
        name: `Chain${i}`,
        parentId: chain.at(-1)?.id ?? null,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      chain.push(res.body as Team);
    }
    expect(chain.at(-1)!.depth).toBe(5);

    const self = await patchTeam(t.admin, chain[0]!, { parentId: chain[0]!.id });
    expect(self.status).toBe(422);
    expect(code(self)).toBe('WSP_TEAM_PARENT_CYCLE');
    const loop = await patchTeam(t.admin, chain[0]!, { parentId: chain[3]!.id });
    expect(loop.status).toBe(422);
    expect(code(loop)).toBe('WSP_TEAM_PARENT_CYCLE');

    const tooDeep = await createTeam(t.admin, { name: 'Chain6', parentId: chain[4]!.id });
    expect(tooDeep.status).toBe(422);
    expect(code(tooDeep)).toBe('WSP_TEAM_PARENT_INVALID');
    // Moving a subtree is counted too: Chain2 and below is 4 levels, so it cannot go under a team at depth 2.
    const other = (await createTeam(t.admin, { name: 'Other1' })).body as Team;
    const other2 = (await createTeam(t.admin, { name: 'Other2', parentId: other.id })).body as Team;
    const move = await patchTeam(t.admin, chain[1]!, { parentId: other2.id });
    expect(move.status).toBe(422);
    expect(code(move)).toBe('WSP_TEAM_PARENT_INVALID');
    // The database guard holds even for a write that skips the service.
    await expect(
      h.owner.query(
        `UPDATE teams SET parent_team_id = (SELECT id FROM teams WHERE org_id = $1 AND uuid = $3)
         WHERE org_id = $1 AND uuid = $2`,
        [t.orgId, chain[0]!.id, chain[4]!.id],
      ),
    ).rejects.toMatchObject({ constraint: 'chk_teams_parent_cycle' });
  });

  it('a parent from another workspace is unknown (422), and deleting a parent moves its children up one level', async () => {
    const other = await api.signup('tv2h2');
    const foreign = (await createTeam(other.admin, { name: 'Foreign' })).body as Team;
    const res = await createTeam(t.admin, { name: 'Adopted', parentId: foreign.id });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('WSP_TEAM_PARENT_INVALID');

    const a = (await createTeam(t.admin, { name: 'Del A' })).body as Team;
    const b = (await createTeam(t.admin, { name: 'Del B', parentId: a.id })).body as Team;
    const c = (await createTeam(t.admin, { name: 'Del C', parentId: b.id })).body as Team;
    expect((await api.as(t.admin).delete(`/v2/workspace/teams/${b.id}`)).status).toBe(204);
    const after = await getTeam(t.admin, c.id);
    expect(after.parentId).toBe(a.id);
    expect(after.depth).toBe(2);
  });
});

describe('Teams v2: manager, members, primary team', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('tv2m');
  });

  it('a person on one team has it as primary; choosing a primary clears the mark on their other team; removing a team place settles the rest', async () => {
    const ben = await person(t, 'Ben');
    const one = (await createTeam(t.admin, { name: 'One', memberIds: [ben.uuid] })).body as Team;
    expect(one.members[0]).toMatchObject({ id: ben.uuid, isPrimary: true });

    const two = (await createTeam(t.admin, { name: 'Two', memberIds: [ben.uuid] })).body as Team;
    // On two teams the earlier mark stays; the new place is not primary.
    expect((await getTeam(t.admin, one.id)).members[0]!.isPrimary).toBe(true);
    expect(two.members[0]!.isPrimary).toBe(false);

    const made = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${two.id}/members/${ben.uuid}`)
      .send({ isPrimary: true });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    expect(made.body.members[0].isPrimary).toBe(true);
    expect((await getTeam(t.admin, one.id)).members[0]!.isPrimary).toBe(false);
    expect(
      await count(`SELECT count(*) n FROM team_members WHERE org_id = $1 AND user_id = $2 AND is_primary`, [
        t.orgId,
        ben.userId,
      ]),
    ).toBe(1);

    // Taking Ben off Two leaves him on One alone, so One becomes his primary again.
    const removed = await api.as(t.admin).delete(`/v2/workspace/teams/${two.id}/members/${ben.uuid}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body.members).toEqual([]);
    expect((await getTeam(t.admin, one.id)).members[0]!.isPrimary).toBe(true);
  });

  it('the database allows at most one primary team per person', async () => {
    const cy = await person(t, 'Cy');
    const a = (await createTeam(t.admin, { name: 'PrimA', memberIds: [cy.uuid] })).body as Team;
    const b = (await createTeam(t.admin, { name: 'PrimB', memberIds: [cy.uuid] })).body as Team;
    await expect(
      h.owner.query(
        `UPDATE team_members SET is_primary = true WHERE org_id = $1 AND user_id = $2 AND team_id = (SELECT id FROM teams WHERE org_id = $1 AND uuid = $3)`,
        [t.orgId, cy.userId, b.id],
      ),
    ).rejects.toMatchObject({ constraint: 'uq_team_members_one_primary' });
    expect(a.members[0]!.isPrimary).toBe(true);
  });

  it('the manager is a lead member: setting adds them, changing demotes the old one, removing the member or demoting them clears it', async () => {
    const dee = await person(t, 'Dee');
    const eli = await person(t, 'Eli');
    const team = (await createTeam(t.admin, { name: 'Led', memberIds: [dee.uuid] })).body as Team;
    expect(team.lead).toBeNull();

    const withEli = await patchTeam(t.admin, team, { leadId: eli.uuid });
    expect(withEli.status, JSON.stringify(withEli.body)).toBe(200);
    expect(withEli.body.lead.id).toBe(eli.uuid);
    expect(withEli.body.members.find((m: Team['members'][0]) => m.id === eli.uuid).role).toBe('lead');

    const switched = await patchTeam(t.admin, withEli.body as Team, { leadId: dee.uuid });
    expect(switched.body.lead.id).toBe(dee.uuid);
    expect(switched.body.members.find((m: Team['members'][0]) => m.id === eli.uuid).role).toBe('member');

    const demoted = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${team.id}/members/${dee.uuid}`)
      .send({ role: 'member' });
    expect(demoted.body.lead).toBeNull();

    await patchTeam(t.admin, demoted.body as Team, { leadId: eli.uuid });
    const gone = await api.as(t.admin).delete(`/v2/workspace/teams/${team.id}/members/${eli.uuid}`);
    expect(gone.body.lead).toBeNull();
    expect(gone.body.members.map((m: Team['members'][0]) => m.id)).toEqual([dee.uuid]);

    const unknown = await patchTeam(t.admin, gone.body as Team, { leadId: randomUUID() });
    expect(unknown.status).toBe(422);
    expect(code(unknown)).toBe('WSP_TEAM_MEMBER_UNKNOWN');
    const notOn = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${team.id}/members/${eli.uuid}`)
      .send({ role: 'lead' });
    expect(notOn.status).toBe(422);
    expect(code(notOn)).toBe('WSP_TEAM_MEMBER_NOT_ON_TEAM');
  });

  it('adding a member through the endpoint, and the "used by" counts of routing rules and sub-teams', async () => {
    const fay = await person(t, 'Fay');
    const team = (await createTeam(t.admin, { name: 'Used' })).body as Team;
    const added = await api
      .as(t.admin)
      .post(`/v2/workspace/teams/${team.id}/members`)
      .send({ userId: fay.uuid, role: 'lead' });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body.members[0]).toMatchObject({ id: fay.uuid, role: 'lead', isPrimary: true });

    await h.owner.query(
      `INSERT INTO routing_rules (org_id, name, conditions, actions) VALUES ($1, 'To used', '{}'::jsonb, $2::jsonb)`,
      [t.orgId, JSON.stringify([{ assign: { strategy: 'round_robin', userIds: [], teamIds: [team.id] } }])],
    );
    await createTeam(t.admin, { name: 'Used child', parentId: team.id });
    const list = await api.as(t.admin).get('/v2/workspace/teams?limit=100');
    const found = (list.body.data as Team[]).find((x) => x.id === team.id)!;
    expect(found.usage).toMatchObject({ routingRules: 1, childTeams: 1, assignmentRules: 0 });
    expect(found.memberCount).toBe(1);
  });
});

describe('Teams v2: permissions', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('tv2p');
  });

  it('team.read lists, team.manage writes, the old inbox.team.manage still writes (alias), nothing at all is refused', async () => {
    const reader = await api.member(t, 'Reader', [['team.read']]);
    const manager = await api.member(t, 'Manager2', [['team.manage']]);
    const legacy = await api.member(t, 'Legacy', [['inbox.team.manage']]);
    const nobody = await api.member(t, 'Nobody', [['record.contacts.read']]);

    expect((await api.as(reader.token).get('/v2/workspace/teams')).status).toBe(200);
    expect((await createTeam(reader.token, { name: 'ByReader' })).status).toBe(403);

    const made = await createTeam(manager.token, { name: 'ByManager' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    // team.manage alone also opens the list (a person who can manage can see what they manage).
    expect((await api.as(manager.token).get('/v2/workspace/teams')).status).toBe(200);

    const old = await createTeam(legacy.token, { name: 'ByAlias' });
    expect(old.status, JSON.stringify(old.body)).toBe(201);
    expect((await api.as(legacy.token).get('/v2/workspace/teams')).status).toBe(200);
    const summary = await api.as(legacy.token).get('/v2/workspace/members/summary');
    expect(summary.body.me.canManageTeams).toBe(true);

    expect((await api.as(nobody.token).get('/v2/workspace/teams')).status).toBe(403);
    expect((await createTeam(nobody.token, { name: 'Nope' })).status).toBe(403);
    expect(
      (await api.as(reader.token).post(`/v2/workspace/teams/${made.body.id}/members`).send({ userId: randomUUID() }))
        .status,
    ).toBe(403);
  });

  it('the migration gave the presets the keys: Owner, Admin and Manager hold both, Agent reads, Viewer holds neither', async () => {
    const holders = async (key: string) =>
      (
        await h.owner.query(
          `SELECT r.name FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
           WHERE g.org_id = $1 AND g.permission_key = $2 AND r.system_key IS NOT NULL ORDER BY r.name`,
          [t.orgId, key],
        )
      ).rows.map((x) => x.name);
    expect(await holders('team.manage')).toEqual(['Admin', 'Manager', 'Owner']);
    expect(await holders('team.read')).toEqual(['Admin', 'Agent', 'Manager', 'Owner']);
  });
});

describe('Teams v2: deactivation keeps membership and an inactive person never grants peer visibility', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('tv2d');
  });

  it('removing a member keeps their team rows, hides them from every tenant query, and reactivating brings them back', async () => {
    const gus = await person(t, 'Gus');
    const hal = await person(t, 'Hal');
    const team = (await createTeam(t.admin, { name: 'Keep', memberIds: [gus.uuid, hal.uuid] })).body as Team;

    expect((await api.as(t.admin).delete(`/v2/workspace/members/${gus.uuid}`)).status).toBe(204);
    // The row is still there for the migration role (history), the tenant sees only the active member.
    expect(
      await count(`SELECT count(*) n FROM team_members WHERE org_id = $1 AND user_id = $2`, [t.orgId, gus.userId]),
    ).toBe(1);
    const during = await getTeam(t.admin, team.id);
    expect(during.members.map((m) => m.id)).toEqual([hal.uuid]);

    // Reactivation (the roles screen's status change) restores the place without anyone re-adding it.
    const user = (await api.as(t.admin).get(`/v2/users/${gus.uuid}`)).body;
    const back = await api
      .as(t.admin)
      .patch(`/v2/users/${gus.uuid}`)
      .send({ status: 'active', rowVersion: user.rowVersion });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.teams.map((x: { name: string }) => x.name)).toEqual(['Keep']);
    expect((await getTeam(t.admin, team.id)).members.map((m) => m.id).sort()).toEqual(
      [gus.uuid, hal.uuid].sort(),
    );
  });

  it('team scope: a teammate who is deactivated stops granting visibility of their contacts, and gets it back when reactivated', async () => {
    const viewerP = await person(t, 'Ivy', [['record.contacts.read', 'team']]);
    const ownerP = await person(t, 'Jon');
    await createTeam(t.admin, { name: 'Scope', memberIds: [viewerP.uuid, ownerP.uuid] });
    const [contact] = await api.seedContacts(t, [{ name: 'Held by Jon', ownerId: ownerP.userId }]);
    const sees = async () =>
      ((await api.as(viewerP.token).get('/v2/contacts?limit=100')).body.data as Array<{ id: string }>).some(
        (c) => c.id === contact,
      );

    expect(await sees()).toBe(true);

    // The path that used to keep the rows: a status change, not the Remove button.
    const row = (await api.as(t.admin).get(`/v2/users/${ownerP.uuid}`)).body;
    const off = await api
      .as(t.admin)
      .patch(`/v2/users/${ownerP.uuid}`)
      .send({ status: 'inactive', rowVersion: row.rowVersion });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(await sees()).toBe(false);
    // ... and the places are still stored.
    expect(
      await count(`SELECT count(*) n FROM team_members WHERE org_id = $1 AND user_id = $2`, [t.orgId, ownerP.userId]),
    ).toBe(1);

    const on = await api
      .as(t.admin)
      .patch(`/v2/users/${ownerP.uuid}`)
      .send({ status: 'active', rowVersion: off.body.rowVersion });
    expect(on.status).toBe(200);
    expect(await sees()).toBe(true);
  });

  it('GET /users reports each person\'s teams and managers, and filters by team', async () => {
    const lead = await person(t, 'Kim');
    const mate = await person(t, 'Lou');
    const team = (await createTeam(t.admin, { name: 'Listed', memberIds: [mate.uuid], leadId: lead.uuid })).body as Team;
    const res = await api.as(t.admin).get(`/v2/users?teamId=${team.id}&limit=50`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byId = new Map((res.body.data as Array<{ id: string; teams: Array<{ name: string; isPrimary: boolean }>; managers: Array<{ id: string }> }>).map((u) => [u.id, u]));
    expect([...byId.keys()].sort()).toEqual([lead.uuid, mate.uuid].sort());
    expect(byId.get(mate.uuid)!.teams).toEqual([expect.objectContaining({ name: 'Listed', isPrimary: true })]);
    expect(byId.get(mate.uuid)!.managers).toEqual([expect.objectContaining({ id: lead.uuid })]);
    // The manager has no manager above them.
    expect(byId.get(lead.uuid)!.managers).toEqual([]);
  });
});

describe('Teams v2: the hand-over the deactivate dialog asks for', () => {
  let t: Tenant;
  let channel: number;
  beforeAll(async () => {
    t = await api.signup('tv2o');
    channel = Number(
      (
        await h.owner.query(
          `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','Handover') RETURNING id`,
          [t.orgId],
        )
      ).rows[0].id,
    );
  });

  const chat = async (assigneeUserId: number) =>
    h.owner.query(
      `INSERT INTO conversations (org_id, uuid, channel_id, peer_key, title, assignee_user_id) VALUES ($1,$2,$3,$4,'Thread',$5)`,
      [t.orgId, randomUUID(), channel, randomUUID(), assigneeUserId],
    );

  it('preview lists what a person holds and the active managers of their teams; person, team-lead and leave modes move or leave the work', async () => {
    const boss = await person(t, 'Boss', [['inbox.conversation.read'], ['record.contacts.read']]);
    const leaver = await person(t, 'Leaver');
    const spare = await person(t, 'Spare', [['inbox.conversation.read'], ['record.contacts.read']]);
    await createTeam(t.admin, { name: 'Handover', memberIds: [leaver.uuid], leadId: boss.uuid });
    await api.seedContacts(t, [
      { name: 'C1', ownerId: leaver.userId },
      { name: 'C2', ownerId: leaver.userId },
    ]);
    await chat(leaver.userId);
    await chat(leaver.userId);
    await chat(leaver.userId);

    const preview = await api.as(t.admin).get(`/v2/workspace/members/${leaver.uuid}/handover`);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({ contacts: 2, openDeals: 0, openConversations: 3 });
    expect(preview.body.teamLeads).toEqual([{ id: boss.uuid, fullName: expect.any(String), teamName: 'Handover' }]);

    // Leave them: nothing moves and it is not an error.
    const left = await api.as(t.admin).post(`/v2/workspace/members/${leaver.uuid}/handover`).set('Idempotency-Key', randomUUID()).send({ mode: 'leave' });
    expect(left.status, JSON.stringify(left.body)).toBe(200);
    expect(left.body).toMatchObject({ mode: 'leave', movedContacts: 0, movedConversations: 0, toUser: null });
    expect(await count(`SELECT count(*) n FROM contacts WHERE org_id = $1 AND owner_id = $2`, [t.orgId, leaver.userId])).toBe(2);

    // To a person: contacts go through the reassign batch, open chats are reassigned one by one.
    const toSpare = await api
      .as(t.admin)
      .post(`/v2/workspace/members/${leaver.uuid}/handover`)
      .set('Idempotency-Key', randomUUID())
      .send({ mode: 'person', userId: spare.uuid });
    expect(toSpare.status, JSON.stringify(toSpare.body)).toBe(200);
    expect(toSpare.body).toMatchObject({ mode: 'person', movedContacts: 2, movedConversations: 3, remaining: 0 });
    expect(toSpare.body.toUser.id).toBe(spare.uuid);
    expect(await count(`SELECT count(*) n FROM contacts WHERE org_id = $1 AND owner_id = $2`, [t.orgId, spare.userId])).toBe(2);
    expect(await count(`SELECT count(*) n FROM conversations WHERE org_id = $1 AND assignee_user_id = $2`, [t.orgId, spare.userId])).toBe(3);
    expect(await count(`SELECT count(*) n FROM owner_reassign_batches WHERE org_id = $1 AND from_user_id = $2`, [t.orgId, leaver.userId])).toBe(1);
    expect(await api.auditCount(t.orgId, 'conversations', 'update')).toBeGreaterThanOrEqual(3);

    // Nothing left to move: the preview says so, and to-the-manager has nothing to do either.
    const again = await api.as(t.admin).get(`/v2/workspace/members/${leaver.uuid}/handover`);
    expect(again.body).toMatchObject({ contacts: 0, openConversations: 0 });

    // To the team manager.
    await api.seedContacts(t, [{ name: 'C3', ownerId: leaver.userId }]);
    await chat(leaver.userId);
    const toBoss = await api
      .as(t.admin)
      .post(`/v2/workspace/members/${leaver.uuid}/handover`)
      .set('Idempotency-Key', randomUUID())
      .send({ mode: 'team_lead' });
    expect(toBoss.status, JSON.stringify(toBoss.body)).toBe(200);
    expect(toBoss.body).toMatchObject({ movedContacts: 1, movedConversations: 1 });
    expect(toBoss.body.toUser.id).toBe(boss.uuid);
  });

  it('team_lead with no manager is a 422, a person who is not active is refused, and only people who may deactivate can ask', async () => {
    const lone = await person(t, 'Lone');
    await api.seedContacts(t, [{ name: 'Orphan', ownerId: lone.userId }]);
    const noLead = await api
      .as(t.admin)
      .post(`/v2/workspace/members/${lone.uuid}/handover`)
      .set('Idempotency-Key', randomUUID())
      .send({ mode: 'team_lead' });
    expect(noLead.status).toBe(422);
    expect(code(noLead)).toBe('WSP_REASSIGN_INVALID');

    const ghost = await person(t, 'Ghost');
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [ghost.userId]);
    const toGhost = await api
      .as(t.admin)
      .post(`/v2/workspace/members/${lone.uuid}/handover`)
      .set('Idempotency-Key', randomUUID())
      .send({ mode: 'person', userId: ghost.uuid });
    expect(toGhost.status).toBe(422);

    const reader = await person(t, 'Plain');
    expect((await api.as(reader.token).get(`/v2/workspace/members/${lone.uuid}/handover`)).status).toBe(403);
    expect(
      (
        await api
          .as(reader.token)
          .post(`/v2/workspace/members/${lone.uuid}/handover`)
          .set('Idempotency-Key', randomUUID())
          .send({ mode: 'leave' })
      ).status,
    ).toBe(403);
  });
});

describe('Teams v2: "can receive" switches are enforced where a team is chosen', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('tv2r');
  });

  it('a team that does not receive conversations is not offered, not routed to and not assignable by hand', async () => {
    const ned = await person(t, 'Ned', [['inbox.conversation.read']]);
    const off = (
      await createTeam(t.admin, { name: 'Records only', memberIds: [ned.uuid], receivesConversations: false })
    ).body as Team;
    const on = (await createTeam(t.admin, { name: 'Chat team', memberIds: [ned.uuid] })).body as Team;

    const assignees = await api.as(t.admin).get('/v2/inbox/assignees');
    expect(assignees.status, JSON.stringify(assignees.body)).toBe(200);
    const names = (assignees.body.teams as Array<{ name: string }>).map((x) => x.name);
    expect(names).toContain('Chat team');
    expect(names).not.toContain('Records only');

    const channel = Number(
      (
        await h.owner.query(
          `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','Receive') RETURNING id`,
          [t.orgId],
        )
      ).rows[0].id,
    );
    const conv = (
      await h.owner.query(
        `INSERT INTO conversations (org_id, uuid, channel_id, peer_key, title) VALUES ($1,$2,$3,$4,'Thread') RETURNING uuid, row_version`,
        [t.orgId, randomUUID(), channel, randomUUID()],
      )
    ).rows[0];
    const refused = await api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv.uuid}/assign`)
      .set('Idempotency-Key', randomUUID())
      .send({ teamId: off.id, rowVersion: Number(conv.row_version) });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(code(refused)).toBe('CONVERSATION_ASSIGNEE_INVALID');
    const allowed = await api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv.uuid}/assign`)
      .set('Idempotency-Key', randomUUID())
      .send({ teamId: on.id, rowVersion: Number(conv.row_version) });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);

    const rule = await api
      .as(t.admin)
      .post('/v2/inbox/routing/rules')
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'To records team', assign: { strategy: 'round_robin', teamIds: [off.id] }, isFallback: true });
    expect(rule.status, JSON.stringify(rule.body)).toBe(422);
    const ok = await api
      .as(t.admin)
      .post('/v2/inbox/routing/rules')
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'To chat team', assign: { strategy: 'round_robin', teamIds: [on.id] }, isFallback: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('a team that does not receive records cannot take a reassigned book', async () => {
    const oli = await person(t, 'Oli');
    const pat = await person(t, 'Pat');
    const team = (
      await createTeam(t.admin, { name: 'Chat only', memberIds: [pat.uuid], receivesRecords: false })
    ).body as Team;
    await api.seedContacts(t, [{ name: 'Oli book', ownerId: oli.userId }]);
    const res = await api
      .as(t.admin)
      .post('/v2/owner-reassignments')
      .set('Idempotency-Key', randomUUID())
      .send({ fromUserId: oli.uuid, target: { kind: 'team', teamId: team.id } });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    const flipped = await patchTeam(t.admin, team, { receivesRecords: true });
    expect(flipped.status).toBe(200);
    const ok = await api
      .as(t.admin)
      .post('/v2/owner-reassignments')
      .set('Idempotency-Key', randomUUID())
      .send({ fromUserId: oli.uuid, target: { kind: 'team', teamId: team.id } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
});
