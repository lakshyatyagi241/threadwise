import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { ContactAssignmentEngine } from '../../../src/modules/crm/contact-assignment/contact-assignment.engine';
import { TeamDeletedConsumer } from '../../../src/modules/workspaces-teams-tenancy/team-deleted.consumer';
import { TeamUsageRepository } from '../../../src/modules/workspaces-teams-tenancy/team-usage.repository';
import { DealsApi, startHarness, type Harness } from '../deals-pipelines/support';
import type { Tenant } from '../contacts-attributes-tags/support';
import { Inbox } from '../team-inbox-conversations/support';

/**
 * Teams T0 (BL-380) through the whole app: a person who cannot open a record is not offered it by record assignment, and the test box
 * says why (gap 9); the delete-team preview counts what refers to the team and the `team.deleted` consumer takes the team out of the
 * JSON that kept its uuid (gap 14). Real Postgres, restricted role.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let h: Harness;
let api: DealsApi;
beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
}, 600_000);
afterAll(async () => {
  await h?.stop();
});

const get = <T>(cls: new (...a: never[]) => T): T => h.app.get(cls as never, { strict: false });

const features = async (t: Tenant) =>
  h.owner.query(
    `UPDATE org_plan_state SET overrides = jsonb_set(overrides, '{features}', '{"record_assignment": true, "inbox_routing": true}'::jsonb, true) WHERE org_id = $1`,
    [t.orgId],
  );

const uuidOf = async (userId: number) =>
  (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

describe('record assignment offers records only to people who can open them (gap 9)', () => {
  let t: Tenant;
  let mgr: { token: string; userId: number };
  let sighted: { token: string; userId: number; uuid: string };
  let blind: { token: string; userId: number; uuid: string };

  beforeAll(async () => {
    t = await api.signup('tz9');
    await features(t);
    mgr = await api.member(t, 'tzmgr', [
      ['crm.assignment.read', 'all'],
      ['crm.assignment.manage', 'all'],
      ['record.contacts.read', 'all'],
    ]);
    const s = await api.member(t, 'tzsighted', [['record.contacts.read', 'own']]);
    sighted = { ...s, uuid: await uuidOf(s.userId) };
    // Holds other rights, but not the one that opens a contact.
    const b = await api.member(t, 'tzblind', [['record.deals.read', 'all']]);
    blind = { ...b, uuid: await uuidOf(b.userId) };
    expect(
      (await api.as(mgr.token).put('/v2/assignment/settings').send({ enabled: true })).status,
    ).toBe(200);
  });

  const newContact = async () => {
    const [uuid] = await api.seedContacts(t, [{ name: `c${Math.random()}`, source: 'Website' }]);
    return uuid!;
  };
  const ownerOf = async (uuid: string) =>
    (await h.owner.query(`SELECT owner_id FROM contacts WHERE uuid = $1`, [uuid])).rows[0]
      .owner_id as number | null;
  const makeRule = async (body: Record<string, unknown>) => {
    const r = await api
      .as(mgr.token)
      .post('/v2/assignment/rules')
      .set('idempotency-key', randomUUID())
      .send({
        subject: 'contact',
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field: 'source', operator: 'equals', value: 'Website' }],
        },
        ...body,
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string };
  };

  it('a rule that names a person without the right finds nobody, and the test box says why', async () => {
    const rule = await makeRule({ name: 'Blind only', strategy: 'fixed', userIds: [blind.uuid] });
    const id = await newContact();
    const res = await api
      .as(mgr.token)
      .post('/v2/assignment/test')
      .send({ subject: 'contact', recordId: id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.outcome).toBe('nobody_available');
    expect(res.body.trace[0]).toMatchObject({
      ruleId: rule.id,
      matched: true,
      nobody: true,
      excluded: [{ id: blind.uuid, reason: 'no_access' }],
    });
    // Assigning for real hands it to nobody either.
    const out = await get(ContactAssignmentEngine).assign(t.orgId, 'contact', id, 'manual');
    expect(out.outcome).toBe('nobody_available');
    expect(await ownerOf(id)).toBeNull();
    await api.as(mgr.token).delete(`/v2/assignment/rules/${rule.id}`);
  });

  it('a pool with both people hands every record to the one who can open it', async () => {
    const rule = await makeRule({
      name: 'Pool',
      strategy: 'round_robin',
      userIds: [blind.uuid, sighted.uuid],
    });
    for (let i = 0; i < 4; i++) {
      const id = await newContact();
      const out = await get(ContactAssignmentEngine).assign(t.orgId, 'contact', id, 'manual');
      expect(out.outcome).toBe('assigned');
      expect(await ownerOf(id)).toBe(sighted.userId);
    }
    const res = await api
      .as(mgr.token)
      .post('/v2/assignment/test')
      .send({ subject: 'contact', recordId: await newContact() });
    expect(res.body.outcome).toBe('would_assign');
    expect(res.body.owner.id).toBe(sighted.uuid);
    expect(res.body.trace[0].excluded).toEqual([
      { id: blind.uuid, name: expect.any(String), reason: 'no_access' },
    ]);
    await api.as(mgr.token).delete(`/v2/assignment/rules/${rule.id}`);
  });

  it('the same holds for a team pool, and a person on leave is explained as on leave', async () => {
    const team = await api
      .as(t.admin)
      .post('/v2/workspace/teams')
      .send({ name: 'Pool team', memberIds: [blind.uuid, sighted.uuid] });
    expect(team.status, JSON.stringify(team.body)).toBe(201);
    const rule = await makeRule({ name: 'Team', strategy: 'round_robin', teamIds: [team.body.id] });
    const res = await api
      .as(mgr.token)
      .post('/v2/assignment/test')
      .send({ subject: 'contact', recordId: await newContact() });
    expect(res.body.owner.id).toBe(sighted.uuid);
    expect(res.body.trace[0].excluded.map((x: { reason: string }) => x.reason)).toEqual([
      'no_access',
    ]);
    await h.owner.query(
      `INSERT INTO member_leaves (org_id, user_id, starts_on, ends_on, status)
       VALUES ($1,$2,(now() AT TIME ZONE 'UTC')::date - 1,(now() AT TIME ZONE 'UTC')::date + 5,'active')`,
      [t.orgId, sighted.userId],
    );
    const away = await api
      .as(mgr.token)
      .post('/v2/assignment/test')
      .send({ subject: 'contact', recordId: await newContact() });
    expect(away.body.outcome).toBe('nobody_available');
    expect(away.body.trace[0].excluded.map((x: { reason: string }) => x.reason).sort()).toEqual([
      'no_access',
      'on_leave',
    ]);
    await h.owner.query(`DELETE FROM member_leaves WHERE org_id = $1`, [t.orgId]);
    await api.as(mgr.token).delete(`/v2/assignment/rules/${rule.id}`);
  });
});

describe('deleting a team: the preview and the cleanup (gap 14)', () => {
  let t: Tenant;
  let a: { token: string; userId: number; uuid: string };
  let b: { token: string; userId: number; uuid: string };
  let c: { token: string; userId: number; uuid: string };
  let team: { id: string; internal: number };
  let sideTeam: { id: string };

  beforeAll(async () => {
    t = await api.signup('tz14');
    await features(t);
    const mk = async (name: string) => {
      // Routing targets must be able to open the inbox.
      const m = await api.member(t, name, [
        ['inbox.conversation.read', 'all'],
        ['inbox.conversation.reply', 'all'],
      ]);
      return { ...m, uuid: await uuidOf(m.userId) };
    };
    a = await mk('tza');
    b = await mk('tzb');
    c = await mk('tzc');
    const made = await api
      .as(t.admin)
      .post('/v2/workspace/teams')
      .send({ name: 'Sales west', memberIds: [a.uuid, b.uuid] });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const internal = Number(
      (await h.owner.query(`SELECT id FROM teams WHERE uuid = $1`, [made.body.id])).rows[0].id,
    );
    team = { id: made.body.id as string, internal };
    // A second team that shares a member with the first, so one person keeps a colleague through it.
    const side = await api
      .as(t.admin)
      .post('/v2/workspace/teams')
      .send({ name: 'Side', memberIds: [b.uuid, c.uuid] });
    sideTeam = { id: side.body.id as string };
  });

  it('counts routing rules, assignment rules, shares, conversations and the people whose reach shrinks', async () => {
    const rr = (body: Record<string, unknown>) =>
      api
        .as(t.admin)
        .post('/v2/inbox/routing/rules')
        .set('idempotency-key', randomUUID())
        .send(body);
    const both = await rr({
      name: 'Refunds',
      isActive: true,
      conditions: { keywords: { words: ['refund'] } },
      assign: { strategy: 'round_robin', userIds: [c.uuid], teamIds: [team.id] },
    });
    expect(both.status, JSON.stringify(both.body)).toBe(201);
    const only = await rr({
      name: 'Team only',
      isActive: true,
      conditions: { keywords: { words: ['sales'] } },
      assign: { strategy: 'round_robin', teamIds: [team.id] },
    });
    expect(only.status, JSON.stringify(only.body)).toBe(201);
    const ar = await api
      .as(t.admin)
      .post('/v2/assignment/rules')
      .set('idempotency-key', randomUUID())
      .send({
        name: 'West leads',
        subject: 'contact',
        strategy: 'round_robin',
        teamIds: [team.id],
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field: 'source', operator: 'equals', value: 'Website' }],
        },
      });
    expect(ar.status, JSON.stringify(ar.body)).toBe(201);

    const inbox = new Inbox(h, api);
    const ch = await inbox.channel(t.admin, { name: 'Main' });
    await inbox.conversation(t, ch.id, { assigneeTeamId: team.internal });
    await inbox.conversation(t, ch.id, { assigneeTeamId: team.internal });

    const usage = await api.as(t.admin).get(`/v2/workspace/teams/${team.id}/usage`);
    expect(usage.status, JSON.stringify(usage.body)).toBe(200);
    expect(usage.body).toEqual({
      members: 2,
      routingRules: 2,
      assignmentRules: 1,
      segmentShares: 0,
      conversationsAssigned: 2,
      // a and b are teammates only through this team, so each would lose the other.
      peopleWithReachChange: 2,
    });
    // b and c are teammates only through the side team, so deleting that one would cost them each other too.
    const side = await api.as(t.admin).get(`/v2/workspace/teams/${sideTeam.id}/usage`);
    expect(side.body.members).toBe(2);
    expect(side.body.routingRules).toBe(0);
    expect(side.body.peopleWithReachChange).toBe(2);
  });

  it('is for people who manage teams, and a stranger team is a 404', async () => {
    expect((await api.as(a.token).get(`/v2/workspace/teams/${team.id}/usage`)).status).toBe(403);
    expect((await api.as(t.admin).get(`/v2/workspace/teams/${randomUUID()}/usage`)).status).toBe(
      404,
    );
    const other = await api.signup('tz14b');
    expect((await api.as(other.admin).get(`/v2/workspace/teams/${team.id}/usage`)).status).toBe(
      404,
    );
  });

  it('deleting the team and running team.deleted removes it from the rules, switches off a rule left with nothing to do, and is repeatable', async () => {
    expect((await api.as(t.admin).delete(`/v2/workspace/teams/${team.id}`)).status).toBe(204);
    // The event the delete wrote is the one the worker consumer receives.
    const ev = (
      await h.owner.query(
        `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
         WHERE org_id = $1 AND event_type = 'team.deleted' ORDER BY id DESC LIMIT 1`,
        [t.orgId],
      )
    ).rows[0];
    expect(ev.payload.uuid).toBe(team.id);
    const consumer = new TeamDeletedConsumer(
      get(OutboxSubscriberRegistry),
      get(DatabaseService),
      new TeamUsageRepository(),
    );
    const event = {
      id: String(ev.id),
      orgId: Number(ev.org_id),
      aggregateModule: String(ev.aggregate_module),
      aggregateId: String(ev.aggregate_id),
      eventType: 'team.deleted',
      payload: ev.payload as Record<string, unknown>,
    };
    await consumer.handle(event);
    await consumer.handle(event);

    const rules = (
      await h.owner.query(
        `SELECT name, is_active, actions FROM routing_rules WHERE org_id = $1 ORDER BY name`,
        [t.orgId],
      )
    ).rows as Array<{ name: string; is_active: boolean; actions: Array<Record<string, unknown>> }>;
    const refunds = rules.find((r) => r.name === 'Refunds')!;
    const assign = refunds.actions.find((x) => x.type === 'assign')!;
    expect(assign.teamIds).toEqual([]);
    expect(assign.userIds).toEqual([c.uuid]);
    expect(refunds.is_active).toBe(true);
    const teamOnly = rules.find((r) => r.name === 'Team only')!;
    expect(teamOnly.actions.some((x) => x.type === 'assign')).toBe(false);
    expect(teamOnly.is_active).toBe(false);

    const pools = (
      await h.owner.query(`SELECT team_ids FROM assignment_rules WHERE org_id = $1`, [t.orgId])
    ).rows as Array<{ team_ids: string[] }>;
    expect(pools.map((p) => p.team_ids)).toEqual([[]]);
    // The conversations kept their place and lost the team (the foreign key did that).
    const left = await h.owner.query(
      `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND assignee_team_id IS NOT NULL`,
      [t.orgId],
    );
    expect(left.rows[0].n).toBe(0);
  });
});
