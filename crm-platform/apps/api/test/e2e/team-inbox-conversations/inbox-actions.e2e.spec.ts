import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT, Api, Inbox, startHarness, uuidRe, type Harness, type Tenant } from './support';

/**
 * What an agent does to a conversation (plan-inbox-chat.md Phase 1, routes 16 to 20): assign, claim and unassign with the permission and
 * scope rules, the status moves and their guard, internal notes, the timeline and the assignee picker. Each block works in an
 * organization of its own; conversations are arranged straight in the tables.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let h: Harness;
let api: Api;
let inbox: Inbox;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  inbox = new Inbox(h, api);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const userUuid = async (id: number) =>
  (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [id])).rows[0].uuid as string;

const detail = async (token: string, uuid: string) => {
  const res = await api.as(token).get(`/v2/inbox/conversations/${uuid}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

const eventTypes = async (token: string, uuid: string) =>
  (
    (await api.as(token).get(`/v2/inbox/conversations/${uuid}/events?limit=100`)).body
      .data as Array<{
      type: string;
    }>
  ).map((e) => e.type);

const outbox = async (orgId: number, type: string) => api.events(orgId, type);

describe('assign, claim and unassign', () => {
  let t: Tenant;
  let ch: { id: string };
  let manager: { token: string; userId: number };
  let agent: { token: string; userId: number };
  let colleague: { token: string; userId: number };
  let ownScoped: { token: string; userId: number };
  let noInbox: { userId: number };
  let teamUuid: string;
  let teamId: number;
  let agentUuid: string;
  let colleagueUuid: string;

  const assign = (token: string, uuid: string, body: Record<string, unknown>) =>
    api.as(token).post(`/v2/inbox/conversations/${uuid}/assign`).send(body);

  beforeAll(async () => {
    t = await api.signup('iaa');
    ch = await inbox.channel(t.admin);
    manager = await api.member(t, 'manager', [...AGENT, ['inbox.conversation.assign', 'all']]);
    agent = await api.member(t, 'agent', AGENT);
    colleague = await api.member(t, 'colleague', AGENT);
    ownScoped = await api.member(t, 'ownscoped', [
      ['inbox.conversation.read', 'own'],
      ['inbox.conversation.assign_self', 'all'],
    ]);
    noInbox = await api.member(t, 'noinbox', [['record.contacts.read', 'all']]);
    const team = (
      await h.owner.query(
        `INSERT INTO teams (org_id, name) VALUES ($1,'Sales') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    teamId = Number(team.id);
    teamUuid = team.uuid as string;
    agentUuid = await userUuid(agent.userId);
    colleagueUuid = await userUuid(colleague.userId);
  });

  it('a manager assigns a person: the row, the header, the timeline, the audit and the outbox event all agree', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const version = await inbox.version(c.uuid);
    const res = await assign(manager.token, c.uuid, { rowVersion: version, userId: agentUuid });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.id).toBe(c.uuid);
    expect(res.body.assignment.user).toMatchObject({ id: agentUuid, name: 'agent' });
    expect(res.body.rowVersion).toBeGreaterThan(version);
    expect(Number((await inbox.row(c.uuid)).assignee_user_id)).toBe(agent.userId);
    expect(await eventTypes(manager.token, c.uuid)).toEqual(['assigned']);

    const ev = (await api.as(manager.token).get(`/v2/inbox/conversations/${c.uuid}/events`)).body
      .data[0];
    expect(ev).toMatchObject({ type: 'assigned', actor: { kind: 'user', name: 'manager' } });
    expect(ev.payload).toMatchObject({ fromUserId: null, toUserId: agentUuid, strategy: 'manual' });
    expect(JSON.stringify(ev)).not.toMatch(/"(?:fromUserId|toUserId)":\d/);

    const out = (await outbox(t.orgId, 'conversation.assigned')).filter(
      (e) => e.conversationId === c.uuid,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ toUserId: agentUuid, fromUserId: null });
    expect(await api.auditCount(t.orgId, 'conversations', 'update')).toBeGreaterThan(0);
  });

  it('reassigning records a reassigned event with who it came from, and unassigning clears only the person', async () => {
    const c = await inbox.conversation(t, ch.id, {
      assigneeUserId: agent.userId,
      assigneeTeamId: teamId,
    });
    const re = await assign(manager.token, c.uuid, {
      rowVersion: await inbox.version(c.uuid),
      userId: colleagueUuid,
    });
    expect(re.status).toBe(200);
    expect(re.body.assignment.user.id).toBe(colleagueUuid);
    expect(re.body.assignment.team.id).toBe(teamUuid);
    const first = (await api.as(manager.token).get(`/v2/inbox/conversations/${c.uuid}/events`)).body
      .data[0];
    expect(first.type).toBe('reassigned');
    expect(first.payload).toMatchObject({ fromUserId: agentUuid, toUserId: colleagueUuid });

    const un = await assign(manager.token, c.uuid, {
      rowVersion: re.body.rowVersion,
      userId: null,
    });
    expect(un.status).toBe(200);
    expect(un.body.assignment.user).toBeNull();
    expect(un.body.assignment.team.id).toBe(teamUuid);
    expect((await eventTypes(manager.token, c.uuid))[0]).toBe('unassigned');
    const out = (await outbox(t.orgId, 'conversation.assigned')).filter(
      (e) => e.conversationId === c.uuid,
    );
    expect(out.map((e) => e.toUserId)).toEqual([colleagueUuid, null]);
  });

  it('assigns a team alone without touching the person, and null clears the team', async () => {
    const c = await inbox.conversation(t, ch.id, { assigneeUserId: agent.userId });
    const res = await assign(manager.token, c.uuid, {
      rowVersion: await inbox.version(c.uuid),
      teamId: teamUuid,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.assignment.user.id).toBe(agentUuid);
    expect(res.body.assignment.team).toMatchObject({ id: teamUuid, name: 'Sales' });
    const cleared = await assign(manager.token, c.uuid, {
      rowVersion: res.body.rowVersion,
      teamId: null,
    });
    expect(cleared.body.assignment.team).toBeNull();
    expect(cleared.body.assignment.user.id).toBe(agentUuid);
  });

  it('an agent with only the claim right claims for themselves, and nothing else', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const version = await inbox.version(c.uuid);
    const claim = await assign(agent.token, c.uuid, { rowVersion: version, userId: agentUuid });
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);
    expect(claim.body.assignment.user.id).toBe(agentUuid);

    const other = await inbox.conversation(t, ch.id, {});
    const v = () => inbox.version(other.uuid);
    // Another person, a team, and unassigning all need the full assign right.
    expect(
      (await assign(agent.token, other.uuid, { rowVersion: await v(), userId: colleagueUuid }))
        .status,
    ).toBe(403);
    expect(
      (
        await assign(agent.token, other.uuid, {
          rowVersion: await v(),
          userId: agentUuid,
          teamId: teamUuid,
        })
      ).status,
    ).toBe(403);
    expect(
      (await assign(agent.token, other.uuid, { rowVersion: await v(), teamId: teamUuid })).status,
    ).toBe(403);
    expect(
      (await assign(agent.token, c.uuid, { rowVersion: claim.body.rowVersion, userId: null }))
        .status,
    ).toBe(403);
    expect(await eventTypes(agent.token, other.uuid)).toEqual([]);
  });

  it('a member with neither right cannot assign at all', async () => {
    const reader = await api.member(t, 'reader', [['inbox.conversation.read', 'all']]);
    const c = await inbox.conversation(t, ch.id, {});
    expect((await assign(reader.token, c.uuid, { rowVersion: 1, userId: agentUuid })).status).toBe(
      403,
    );
  });

  it('assigning what is already assigned is a no-op: the current row, no event, no outbox event', async () => {
    const c = await inbox.conversation(t, ch.id, { assigneeUserId: agent.userId });
    const before = (await outbox(t.orgId, 'conversation.assigned')).length;
    const res = await assign(manager.token, c.uuid, { rowVersion: 999, userId: agentUuid });
    expect(res.status).toBe(200);
    expect(res.body.assignment.user.id).toBe(agentUuid);
    expect(await eventTypes(manager.token, c.uuid)).toEqual([]);
    expect((await outbox(t.orgId, 'conversation.assigned')).length).toBe(before);
  });

  it('a stale rowVersion is 409 and changes nothing', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const stale = (await inbox.version(c.uuid)) - 1 || 1;
    await h.owner.query(`UPDATE conversations SET preview = 'moved' WHERE uuid = $1`, [c.uuid]);
    const res = await assign(manager.token, c.uuid, { rowVersion: stale, userId: agentUuid });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROW_VERSION_CONFLICT');
    expect((await inbox.row(c.uuid)).assignee_user_id).toBeNull();
  });

  it("refuses a target that is not this workspace's, not active, or cannot open the inbox: 422, row unchanged", async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const version = () => inbox.version(c.uuid);
    const foreign = await api.signup('iab');
    const foreignUser = await userUuid(foreign.adminUserId);
    const a = await assign(manager.token, c.uuid, {
      rowVersion: await version(),
      userId: foreignUser,
    });
    expect(a.status).toBe(422);
    expect(a.body.code).toBe('CONVERSATION_ASSIGNEE_INVALID');
    const unknown = await assign(manager.token, c.uuid, {
      rowVersion: await version(),
      userId: randomUUID(),
    });
    expect(unknown.body.code).toBe('CONVERSATION_ASSIGNEE_INVALID');
    const idle = await api.member(t, 'suspended', AGENT);
    await h.owner.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [idle.userId]);
    const inactive = await assign(manager.token, c.uuid, {
      rowVersion: await version(),
      userId: await userUuid(idle.userId),
    });
    expect(inactive.body.code).toBe('CONVERSATION_ASSIGNEE_INVALID');
    const noAccess = await assign(manager.token, c.uuid, {
      rowVersion: await version(),
      userId: await userUuid(noInbox.userId),
    });
    expect(noAccess.status).toBe(422);
    expect(noAccess.body.code).toBe('CONVERSATION_ASSIGNEE_INVALID');
    const badTeam = await assign(manager.token, c.uuid, {
      rowVersion: await version(),
      teamId: randomUUID(),
    });
    expect(badTeam.body.code).toBe('CONVERSATION_ASSIGNEE_INVALID');
    const foreignTeam = (
      await h.owner.query(
        `INSERT INTO teams (org_id, name) VALUES ($1,'Elsewhere') RETURNING uuid`,
        [foreign.orgId],
      )
    ).rows[0].uuid;
    expect(
      (await assign(manager.token, c.uuid, { rowVersion: await version(), teamId: foreignTeam }))
        .body.code,
    ).toBe('CONVERSATION_ASSIGNEE_INVALID');
    const row = await inbox.row(c.uuid);
    expect(row.assignee_user_id).toBeNull();
    expect(row.assignee_team_id).toBeNull();
    expect(await eventTypes(manager.token, c.uuid)).toEqual([]);
  });

  it('validates the body: a version is needed, ids are uuids, and at least one of user and team is named', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    expect((await assign(manager.token, c.uuid, { userId: agentUuid })).status).toBe(422);
    expect((await assign(manager.token, c.uuid, { rowVersion: 1 })).status).toBe(422);
    expect((await assign(manager.token, c.uuid, { rowVersion: 1, userId: '7' })).status).toBe(422);
    expect(
      (
        await assign(manager.token, c.uuid, {
          rowVersion: 1,
          userId: agentUuid,
          strategy: 'round_robin',
        })
      ).status,
    ).toBe(422);
  });

  it('a closed conversation becomes open when assigned; resolved and snoozed ones keep their status', async () => {
    const closed = await inbox.conversation(t, ch.id, { status: 'closed' });
    await h.owner.query(`UPDATE conversations SET resolved_at = now() WHERE uuid = $1`, [
      closed.uuid,
    ]);
    const res = await assign(manager.token, closed.uuid, {
      rowVersion: await inbox.version(closed.uuid),
      userId: agentUuid,
    });
    expect(res.body.status).toBe('open');
    const types = await eventTypes(manager.token, closed.uuid);
    expect(types).toContain('reopened');
    expect(types).toContain('assigned');
    expect((await inbox.row(closed.uuid)).resolved_at).toBeNull();

    for (const status of ['resolved', 'snoozed']) {
      const c = await inbox.conversation(t, ch.id, { status });
      const r = await assign(manager.token, c.uuid, {
        rowVersion: await inbox.version(c.uuid),
        userId: agentUuid,
      });
      expect(r.body.status).toBe(status);
    }
  });

  it('giving a thread to a person takes it from an AI agent and records the hand-off', async () => {
    const aiAgent = (
      await h.owner.query(
        `INSERT INTO ai_agents (org_id, name) VALUES ($1,'Helper') RETURNING id`,
        [t.orgId],
      )
    ).rows[0].id;
    const c = await inbox.conversation(t, ch.id, {});
    await h.owner.query(`UPDATE conversations SET assignee_agent_id = $1 WHERE uuid = $2`, [
      aiAgent,
      c.uuid,
    ]);
    const withAi = await detail(manager.token, c.uuid);
    expect(withAi.assignment.aiAgent.name).toBe('Helper');
    const res = await assign(manager.token, c.uuid, {
      rowVersion: withAi.rowVersion,
      userId: agentUuid,
    });
    expect(res.body.assignment.aiAgent).toBeNull();
    expect(await eventTypes(manager.token, c.uuid)).toEqual(
      expect.arrayContaining(['ai_handoff', 'assigned']),
    );
  });

  it('scope: a caller whose read scope is own cannot assign a conversation they cannot see (404), and loses the conversation they give away', async () => {
    const theirs = await inbox.conversation(t, ch.id, { assigneeUserId: ownScoped.userId });
    const others = await inbox.conversation(t, ch.id, { assigneeUserId: colleague.userId });
    expect(
      (
        await assign(ownScoped.token, others.uuid, {
          rowVersion: 1,
          userId: await userUuid(ownScoped.userId),
        })
      ).status,
    ).toBe(404);
    expect(
      (await api.as(ownScoped.token).get(`/v2/inbox/conversations/${theirs.uuid}`)).status,
    ).toBe(200);
    // A manager moves it to a colleague: the own-scoped agent can no longer open it.
    const moved = await assign(manager.token, theirs.uuid, {
      rowVersion: await inbox.version(theirs.uuid),
      userId: colleagueUuid,
    });
    expect(moved.status).toBe(200);
    expect(
      (await api.as(ownScoped.token).get(`/v2/inbox/conversations/${theirs.uuid}`)).status,
    ).toBe(404);
    expect(
      (await api.as(ownScoped.token).get(`/v2/inbox/conversations/${theirs.uuid}/messages`)).status,
    ).toBe(404);
    const list = await api.as(ownScoped.token).get('/v2/inbox/conversations?limit=100');
    expect(list.body.data.map((r: { id: string }) => r.id)).not.toContain(theirs.uuid);
  });

  it('a claim by an agent whose assign scope is narrower than the conversation is refused (403)', async () => {
    const narrow = await api.member(t, 'narrow', [
      ['inbox.conversation.read', 'all'],
      ['inbox.conversation.assign_self', 'own'],
    ]);
    const c = await inbox.conversation(t, ch.id, { assigneeUserId: colleague.userId });
    const res = await assign(narrow.token, c.uuid, {
      rowVersion: await inbox.version(c.uuid),
      userId: await userUuid(narrow.userId),
    });
    expect(res.status).toBe(403);
  });
});

describe('status: resolve, close, reopen, pending, and the guard', () => {
  let t: Tenant;
  let ch: { id: string };
  let agent: { token: string; userId: number };
  let reader: { token: string };
  let ownResolver: { token: string; userId: number };

  const setStatus = (token: string, uuid: string, body: Record<string, unknown>) =>
    api.as(token).post(`/v2/inbox/conversations/${uuid}/status`).send(body);

  beforeAll(async () => {
    t = await api.signup('iss');
    ch = await inbox.channel(t.admin);
    agent = await api.member(t, 'agent', AGENT);
    reader = await api.member(t, 'reader', [['inbox.conversation.read', 'all']]);
    ownResolver = await api.member(t, 'ownres', [
      ['inbox.conversation.read', 'all'],
      ['inbox.conversation.resolve', 'own'],
    ]);
  });

  it('resolves: status, who and when, a resolved event, an outbox event and an audit row', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const res = await setStatus(agent.token, c.uuid, {
      rowVersion: await inbox.version(c.uuid),
      status: 'resolved',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('resolved');
    const row = await inbox.row(c.uuid);
    expect(row.resolved_at).not.toBeNull();
    expect(Number(row.resolved_by)).toBe(agent.userId);
    expect(await eventTypes(agent.token, c.uuid)).toEqual(['resolved']);
    const out = (await outbox(t.orgId, 'conversation.resolved')).filter(
      (e) => e.conversationId === c.uuid,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      status: 'resolved',
      from: 'open',
      resolvedBy: await userUuid(agent.userId),
    });
    const detailed = await detail(agent.token, c.uuid);
    expect(detailed.resolvedAt).not.toBeNull();
  });

  it('a resolved thread leaves the default list and comes back when reopened (open, reopened event, resolver cleared)', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const a = await setStatus(agent.token, c.uuid, {
      rowVersion: await inbox.version(c.uuid),
      status: 'resolved',
    });
    const open = await api.as(agent.token).get('/v2/inbox/conversations?limit=100');
    expect(open.body.data.map((r: { id: string }) => r.id)).not.toContain(c.uuid);
    const b = await setStatus(agent.token, c.uuid, {
      rowVersion: a.body.rowVersion,
      status: 'open',
    });
    expect(b.status).toBe(200);
    expect(b.body.status).toBe('open');
    const row = await inbox.row(c.uuid);
    expect(row.resolved_at).toBeNull();
    expect(row.resolved_by).toBeNull();
    expect(await eventTypes(agent.token, c.uuid)).toEqual(['reopened', 'resolved']);
    expect(
      (await outbox(t.orgId, 'conversation.reopened')).filter((e) => e.conversationId === c.uuid),
    ).toHaveLength(1);
    const back = await api.as(agent.token).get('/v2/inbox/conversations?limit=100');
    expect(back.body.data.map((r: { id: string }) => r.id)).toContain(c.uuid);
  });

  it('resolved to closed keeps who finished it and when; closed back to resolved too; no second resolved outbox event', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const a = await setStatus(agent.token, c.uuid, {
      rowVersion: await inbox.version(c.uuid),
      status: 'resolved',
    });
    const stamp = (await inbox.row(c.uuid)).resolved_at;
    const closed = await setStatus(agent.token, c.uuid, {
      rowVersion: a.body.rowVersion,
      status: 'closed',
    });
    expect(closed.body.status).toBe('closed');
    expect((await inbox.row(c.uuid)).resolved_at).toEqual(stamp);
    const again = await setStatus(agent.token, c.uuid, {
      rowVersion: closed.body.rowVersion,
      status: 'resolved',
    });
    expect(again.body.status).toBe('resolved');
    expect(
      (await outbox(t.orgId, 'conversation.resolved')).filter((e) => e.conversationId === c.uuid),
    ).toHaveLength(1);
    expect((await eventTypes(agent.token, c.uuid))[0]).toBe('resolved');
  });

  it('pending and back to open are plain status changes with a status_changed event', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const p = await setStatus(agent.token, c.uuid, {
      rowVersion: await inbox.version(c.uuid),
      status: 'pending',
    });
    expect(p.body.status).toBe('pending');
    const o = await setStatus(agent.token, c.uuid, {
      rowVersion: p.body.rowVersion,
      status: 'open',
    });
    expect(o.body.status).toBe('open');
    expect(await eventTypes(agent.token, c.uuid)).toEqual(['status_changed', 'status_changed']);
    const ev = (await api.as(agent.token).get(`/v2/inbox/conversations/${c.uuid}/events`)).body
      .data;
    expect(ev[1].payload).toEqual({ from: 'open', to: 'pending' });
  });

  it('waking a snoozed thread by hand clears the snooze time', async () => {
    const c = await inbox.conversation(t, ch.id, { status: 'snoozed' });
    await h.owner.query(
      `UPDATE conversations SET snoozed_until = now() + interval '1 day' WHERE uuid = $1`,
      [c.uuid],
    );
    const res = await setStatus(agent.token, c.uuid, {
      rowVersion: await inbox.version(c.uuid),
      status: 'open',
    });
    expect(res.status).toBe(200);
    expect(res.body.snoozedUntil).toBeNull();
  });

  it('resolving a resolved thread is a no-op: same answer, no event, no second outbox event', async () => {
    const c = await inbox.conversation(t, ch.id, { status: 'resolved' });
    const res = await setStatus(agent.token, c.uuid, { rowVersion: 999, status: 'resolved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
    expect(await eventTypes(agent.token, c.uuid)).toEqual([]);
    expect(
      (await outbox(t.orgId, 'conversation.resolved')).filter((e) => e.conversationId === c.uuid),
    ).toHaveLength(0);
  });

  it('refuses moves the machine does not allow: a spam thread cannot be resolved (422 CONVERSATION_STATUS_INVALID)', async () => {
    const spam = await inbox.conversation(t, ch.id, { status: 'spam' });
    const res = await setStatus(agent.token, spam.uuid, {
      rowVersion: await inbox.version(spam.uuid),
      status: 'resolved',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CONVERSATION_STATUS_INVALID');
    expect((await inbox.row(spam.uuid)).status).toBe('spam');
    const ok = await setStatus(agent.token, spam.uuid, {
      rowVersion: await inbox.version(spam.uuid),
      status: 'open',
    });
    expect(ok.body.status).toBe('open');
  });

  it('validates the body: snoozed and spam are not settable here, and a version is required', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    expect(
      (await setStatus(agent.token, c.uuid, { rowVersion: 1, status: 'snoozed' })).status,
    ).toBe(422);
    expect((await setStatus(agent.token, c.uuid, { rowVersion: 1, status: 'spam' })).status).toBe(
      422,
    );
    expect((await setStatus(agent.token, c.uuid, { status: 'resolved' })).status).toBe(422);
  });

  it('a stale rowVersion is 409 and changes nothing', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    await h.owner.query(`UPDATE conversations SET preview = 'moved' WHERE uuid = $1`, [c.uuid]);
    const res = await setStatus(agent.token, c.uuid, { rowVersion: 1, status: 'resolved' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROW_VERSION_CONFLICT');
    expect((await inbox.row(c.uuid)).status).toBe('open');
  });

  it('needs the resolve permission, and its scope must cover the conversation', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    expect(
      (
        await setStatus(reader.token, c.uuid, {
          rowVersion: await inbox.version(c.uuid),
          status: 'resolved',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await setStatus(ownResolver.token, c.uuid, {
          rowVersion: await inbox.version(c.uuid),
          status: 'resolved',
        })
      ).status,
    ).toBe(403);
    const mine = await inbox.conversation(t, ch.id, { assigneeUserId: ownResolver.userId });
    expect(
      (
        await setStatus(ownResolver.token, mine.uuid, {
          rowVersion: await inbox.version(mine.uuid),
          status: 'resolved',
        })
      ).status,
    ).toBe(200);
    expect((await inbox.row(c.uuid)).status).toBe('open');
  });
});

describe('internal notes', () => {
  let t: Tenant;
  let ch: { id: string };
  let agent: { token: string; userId: number };
  let colleague: { token: string; userId: number };
  let manager: { token: string; userId: number };
  let reader: { token: string };
  let conv: { id: number; uuid: string };

  const add = (token: string, uuid: string, body: Record<string, unknown>) =>
    api.as(token).post(`/v2/inbox/conversations/${uuid}/notes`).send(body);

  beforeAll(async () => {
    t = await api.signup('ino');
    ch = await inbox.channel(t.admin);
    agent = await api.member(t, 'agent', AGENT);
    colleague = await api.member(t, 'colleague', AGENT);
    manager = await api.member(t, 'manager', [...AGENT, ['inbox.conversation.assign', 'all']]);
    reader = await api.member(t, 'reader', [['inbox.conversation.read', 'all']]);
    conv = await inbox.conversation(t, ch.id, { messages: 2 });
  });

  it('adds a note, lists it newest first with its author, and never lets it into the thread or the preview', async () => {
    const res = await add(agent.token, conv.uuid, { body: 'Customer prefers email' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      conversationId: conv.uuid,
      body: 'Customer prefers email',
      mentions: [],
      isPinned: false,
      author: { name: 'agent' },
    });
    expect(res.body.id).toMatch(uuidRe);
    const second = await add(colleague.token, conv.uuid, { body: 'Second note' });
    const listed = await api.as(agent.token).get(`/v2/inbox/conversations/${conv.uuid}/notes`);
    expect(listed.body.data.map((n: { body: string }) => n.body)).toEqual([
      'Second note',
      'Customer prefers email',
    ]);
    expect(second.status).toBe(201);

    const msgs = await api.as(agent.token).get(`/v2/inbox/conversations/${conv.uuid}/messages`);
    expect(JSON.stringify(msgs.body)).not.toContain('Customer prefers email');
    expect((await inbox.row(conv.uuid)).preview).not.toBe('Customer prefers email');
    expect(Number((await inbox.row(conv.uuid)).msg_seq)).toBe(2);
    const toChannel = await h.owner.query(
      `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND direction = 'out'`,
      [conv.id],
    );
    expect(toChannel.rows[0].n).toBe(0);
  });

  it('records note_added in the timeline and the outbox (without the text), and an audit row', async () => {
    const res = await add(agent.token, conv.uuid, { body: 'secret remark about pricing' });
    expect(await eventTypes(agent.token, conv.uuid)).toContain('note_added');
    const out = (await outbox(t.orgId, 'conversation.note_added')).filter(
      (e) => e.noteId === res.body.id,
    );
    expect(out).toHaveLength(1);
    expect(JSON.stringify(out[0])).not.toContain('secret remark');
    expect(await api.auditCount(t.orgId, 'conversation_notes', 'insert')).toBeGreaterThan(0);
  });

  it('stores mentions as user uuids of active members, without repeats or the author, and refuses anyone else', async () => {
    const colleagueUuid = await userUuid(colleague.userId);
    const agentUuid = await userUuid(agent.userId);
    const ok = await add(agent.token, conv.uuid, {
      body: '@colleague please look',
      mentions: [colleagueUuid, colleagueUuid, agentUuid],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.mentions).toEqual([colleagueUuid]);

    const stranger = await api.signup('inm');
    const strangerUuid = await userUuid(stranger.adminUserId);
    const foreign = await add(agent.token, conv.uuid, { body: 'x', mentions: [strangerUuid] });
    expect(foreign.status).toBe(422);
    expect(foreign.body.code).toBe('VALIDATION_FAILED');
    const away = await api.member(t, 'away', AGENT);
    await h.owner.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [away.userId]);
    expect(
      (await add(agent.token, conv.uuid, { body: 'x', mentions: [await userUuid(away.userId)] }))
        .status,
    ).toBe(422);
    const nobodies = await add(agent.token, conv.uuid, { body: 'x', mentions: [randomUUID()] });
    expect(nobodies.status).toBe(422);
  });

  it('validates the text: empty, longer than the limit; and needs the note permission', async () => {
    expect((await add(agent.token, conv.uuid, { body: '   ' })).status).toBe(422);
    expect((await add(agent.token, conv.uuid, { body: 'x'.repeat(4001) })).status).toBe(422);
    expect((await add(reader.token, conv.uuid, { body: 'nope' })).status).toBe(403);
  });

  it('pages notes newest first with a cursor, without repeats or gaps', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    for (let i = 1; i <= 7; i += 1) await add(agent.token, c.uuid, { body: `n${i}` });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const p = await api
        .as(agent.token)
        .get(`/v2/inbox/conversations/${c.uuid}/notes?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      expect(p.status).toBe(200);
      seen.push(...p.body.data.map((n: { body: string }) => n.body));
      if (!p.body.page.hasMore) break;
      cursor = p.body.page.nextCursor;
    }
    expect(seen).toEqual(['n7', 'n6', 'n5', 'n4', 'n3', 'n2', 'n1']);
  });

  it('deleting: the author may, a manager may, another agent may not (403), and the note is gone after', async () => {
    const mine = await add(agent.token, conv.uuid, { body: 'mine to delete' });
    const del = (token: string, id: string) =>
      api.as(token).delete(`/v2/inbox/conversations/${conv.uuid}/notes/${id}`);
    const denied = await del(colleague.token, mine.body.id);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('INBOX_NOTE_NOT_DELETABLE');
    expect((await del(agent.token, mine.body.id)).status).toBe(204);
    expect((await del(agent.token, mine.body.id)).status).toBe(404);
    const theirs = await add(colleague.token, conv.uuid, { body: 'colleague note' });
    expect((await del(manager.token, theirs.body.id)).status).toBe(204);
    const listed = await api
      .as(agent.token)
      .get(`/v2/inbox/conversations/${conv.uuid}/notes?limit=100`);
    expect(listed.body.data.map((n: { id: string }) => n.id)).not.toContain(mine.body.id);
    expect(await api.auditCount(t.orgId, 'conversation_notes', 'delete')).toBeGreaterThanOrEqual(2);
  });

  it('a note of another conversation is not found through this one, and a reader may list but not delete', async () => {
    const other = await inbox.conversation(t, ch.id, {});
    const note = await add(agent.token, other.uuid, { body: 'elsewhere' });
    const wrong = await api
      .as(agent.token)
      .delete(`/v2/inbox/conversations/${conv.uuid}/notes/${note.body.id}`);
    expect(wrong.status).toBe(404);
    expect(wrong.body.code).toBe('CONVERSATION_NOTE_NOT_FOUND');
    expect(
      (await api.as(reader.token).get(`/v2/inbox/conversations/${other.uuid}/notes`)).status,
    ).toBe(200);
    expect(
      (
        await api
          .as(reader.token)
          .delete(`/v2/inbox/conversations/${other.uuid}/notes/${note.body.id}`)
      ).status,
    ).toBe(403);
  });

  it("scope own: a note on another agent's conversation is a 404 to read, write or delete", async () => {
    const own = await api.member(t, 'ownonly', [
      ['inbox.conversation.read', 'own'],
      ['inbox.conversation.note', 'own'],
    ]);
    const hidden = await inbox.conversation(t, ch.id, { assigneeUserId: agent.userId });
    expect(
      (await api.as(own.token).get(`/v2/inbox/conversations/${hidden.uuid}/notes`)).status,
    ).toBe(404);
    expect((await add(own.token, hidden.uuid, { body: 'x' })).status).toBe(404);
    const mine = await inbox.conversation(t, ch.id, { assigneeUserId: own.userId });
    expect((await add(own.token, mine.uuid, { body: 'ok' })).status).toBe(201);
  });
});

describe('timeline', () => {
  let t: Tenant;
  let ch: { id: string };
  let manager: { token: string; userId: number };

  beforeAll(async () => {
    t = await api.signup('ite');
    ch = await inbox.channel(t.admin);
    manager = await api.member(t, 'manager', [...AGENT, ['inbox.conversation.assign', 'all']]);
  });

  it('lists events newest first, pages with a cursor, and tells a person from the system', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    for (let i = 0; i < 6; i += 1) {
      await h.owner.query(
        `INSERT INTO conversation_events (org_id, conversation_id, actor_type, type, payload, created_at)
         VALUES ($1,$2,'system','sla_breach','{}'::jsonb, now() - ($3 || ' minutes')::interval)`,
        [t.orgId, c.id, String(10 - i)],
      );
    }
    await api
      .as(manager.token)
      .post(`/v2/inbox/conversations/${c.uuid}/status`)
      .send({ rowVersion: await inbox.version(c.uuid), status: 'resolved' });
    const first = await api
      .as(manager.token)
      .get(`/v2/inbox/conversations/${c.uuid}/events?limit=4`);
    expect(first.status).toBe(200);
    expect(first.body.data[0]).toMatchObject({
      type: 'resolved',
      actor: { kind: 'user', name: 'manager' },
    });
    expect(first.body.data[1]).toMatchObject({
      type: 'sla_breach',
      actor: { kind: 'system', userId: null, name: null },
    });
    expect(first.body.page.hasMore).toBe(true);
    const seen = first.body.data.map((e: { id: string }) => e.id);
    const next = await api
      .as(manager.token)
      .get(`/v2/inbox/conversations/${c.uuid}/events?limit=4&cursor=${first.body.page.nextCursor}`);
    seen.push(...next.body.data.map((e: { id: string }) => e.id));
    expect(new Set(seen).size).toBe(7);
    expect(next.body.page.hasMore).toBe(false);
    const times = [...first.body.data, ...next.body.data].map(
      (e: { createdAt: string }) => e.createdAt,
    );
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("an unknown cursor is a validation error, and another conversation's events are not mixed in", async () => {
    const a = await inbox.conversation(t, ch.id, {});
    const b = await inbox.conversation(t, ch.id, {});
    await api
      .as(manager.token)
      .post(`/v2/inbox/conversations/${a.uuid}/status`)
      .send({ rowVersion: await inbox.version(a.uuid), status: 'pending' });
    expect(
      (await api.as(manager.token).get(`/v2/inbox/conversations/${a.uuid}/events?cursor=zzz`))
        .status,
    ).toBe(422);
    expect(
      (await api.as(manager.token).get(`/v2/inbox/conversations/${b.uuid}/events`)).body.data,
    ).toEqual([]);
  });
});

describe('assignees', () => {
  let t: Tenant;
  let ch: { id: string };
  let manager: { token: string; userId: number };
  let busy: { token: string; userId: number };
  let noInbox: { token: string; userId: number };

  beforeAll(async () => {
    t = await api.signup('ias');
    ch = await inbox.channel(t.admin);
    manager = await api.member(t, 'manager', [...AGENT, ['inbox.conversation.assign', 'all']]);
    busy = await api.member(t, 'busy', AGENT);
    noInbox = await api.member(t, 'noinbox', [['record.contacts.read', 'all']]);
    await h.owner.query(
      `INSERT INTO agent_statuses (org_id, user_id, status) VALUES ($1,$2,'busy')`,
      [t.orgId, busy.userId],
    );
    await inbox.conversation(t, ch.id, { assigneeUserId: busy.userId });
    await inbox.conversation(t, ch.id, { assigneeUserId: busy.userId, status: 'pending' });
    await inbox.conversation(t, ch.id, { assigneeUserId: busy.userId, status: 'resolved' });
    await inbox.conversation(t, ch.id, { assigneeUserId: busy.userId, archived: true });
    await h.owner.query(`INSERT INTO teams (org_id, name, color) VALUES ($1,'Sales','#112233')`, [
      t.orgId,
    ]);
  });

  it('lists the people who may open the inbox with availability and a live count of open work, and the teams', async () => {
    const res = await api.as(manager.token).get('/v2/inbox/assignees');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byName = new Map(res.body.users.map((u: { name: string }) => [u.name, u]));
    const b = byName.get('busy') as {
      availability: string;
      openConversations: number;
      isMe: boolean;
      id: string;
    };
    expect(b).toMatchObject({ availability: 'busy', openConversations: 2, isMe: false });
    expect(b.id).toMatch(uuidRe);
    // No status row means offline (Reference); the caller is marked.
    expect(byName.get('manager')).toMatchObject({ availability: 'offline', isMe: true });
    expect(byName.has('noinbox')).toBe(false);
    expect(res.body.teams).toEqual([
      expect.objectContaining({
        name: 'Sales',
        color: '#112233',
        memberCount: 0,
        assignmentStrategy: 'manual',
      }),
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/"id":\d+/);
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it("needs the right to read conversations, and never lists another workspace's people", async () => {
    expect((await api.as(noInbox.token).get('/v2/inbox/assignees')).status).toBe(403);
    const other = await api.signup('iat');
    const res = await api.as(other.admin).get('/v2/inbox/assignees');
    expect(res.status).toBe(200);
    expect(res.body.users.map((u: { name: string }) => u.name)).not.toContain('manager');
    expect(res.body.teams).toEqual([]);
  });
});
