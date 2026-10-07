import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { RoutingEngine } from '../../../src/modules/team-inbox-routing-sla';
import type { Tenant } from '../contacts-attributes-tags/support';
import {
  conversationOf,
  simChannel,
  simInbound,
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from '../chat-conversations/pipeline-support';

/**
 * Auto-assignment (TW-TIB2-004 to 011, 020): the rules API (permissions, plan gate and limit, validation, priority, tenant isolation)
 * and the engine that gives a new conversation to an agent. Real Postgres (restricted role) and Redis, the real BullMQ ingest worker and
 * the routing listener in the same process; customers write through the simulator channel.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let p: Pipeline;
beforeAll(async () => {
  p = await startPipeline(async () => [
    (
      await import('../../../src/modules/team-inbox-routing-sla/team-inbox-routing-sla-worker.module')
    ).TeamInboxRoutingSlaWorkerModule,
  ]);
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

const AGENT: Array<[string, 'all']> = [
  ['inbox.conversation.read', 'all'],
  ['inbox.conversation.reply', 'all'],
  ['inbox.conversation.assign_self', 'all'],
];

let phoneSeq = 0;
const phone = () => `9199${String(10_000_000 + phoneSeq++)}`;

const uuidOf = async (userId: number) =>
  (await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

interface Rule {
  id: string;
  rowVersion: number;
  firedCount: number;
  position: number;
  [k: string]: unknown;
}

const rulesApi = (token: string) => ({
  list: (qs = '') => p.api.as(token).get(`/v2/inbox/routing/rules${qs}`),
  create: (body: Record<string, unknown>, key: string = randomUUID()) =>
    p.api.as(token).post('/v2/inbox/routing/rules').set('idempotency-key', key).send(body),
  update: (id: string, body: Record<string, unknown>) =>
    p.api.as(token).patch(`/v2/inbox/routing/rules/${id}`).send(body),
  remove: (id: string) => p.api.as(token).delete(`/v2/inbox/routing/rules/${id}`),
  reorder: (ids: string[]) => p.api.as(token).post('/v2/inbox/routing/rules/reorder').send({ ids }),
});

/** A customer writes; resolves once the pipeline stored the message AND the routing listener has looked at the conversation. */
async function customer(t: Tenant, ch: SimChannel, text: string, from = phone()) {
  await simInbound(p, t, ch, { from, text });
  const conv = await until(`routed ${from}`, async () => {
    const c = await conversationOf(p, t, ch, from);
    const meta = c.routing_meta as { routedMessage?: string } | null;
    return meta?.routedMessage ? c : null;
  });
  return {
    from,
    conv,
    assignee: conv.assignee_user_id === null ? null : Number(conv.assignee_user_id),
  };
}

const ruleRow = async (id: string) =>
  (await p.h.owner.query(`SELECT * FROM routing_rules WHERE uuid = $1`, [id])).rows[0] as Record<
    string,
    unknown
  >;

describe('rules API', () => {
  let t: Tenant;
  let other: Tenant;
  let a1: { token: string; userId: number };
  let a2: { token: string; userId: number };
  let reader: { token: string; userId: number };
  let nobody: { token: string; userId: number };
  let u1: string;
  let u2: string;

  beforeAll(async () => {
    t = await p.api.signup('rra');
    other = await p.api.signup('rrb');
    a1 = await p.api.member(t, 'rra1', AGENT);
    a2 = await p.api.member(t, 'rra2', AGENT);
    reader = await p.api.member(t, 'rrreader', [['inbox.settings.read', 'all']]);
    nobody = await p.api.member(t, 'rrnobody', [['record.contacts.read', 'all']]);
    u1 = await uuidOf(a1.userId);
    u2 = await uuidOf(a2.userId);
  });

  const body = (over: Record<string, unknown> = {}) => ({
    name: 'Refunds',
    description: 'Refund requests go to the billing agents',
    conditions: { keywords: { mode: 'any', words: ['refund'] } },
    assign: { strategy: 'round_robin', userIds: [u1, u2] },
    ...over,
  });

  it('reading needs inbox.settings.read, writing inbox.routing.manage; the admin can do both', async () => {
    expect((await rulesApi(nobody.token).list()).status).toBe(403);
    expect((await rulesApi(reader.token).list()).status).toBe(200);
    expect((await rulesApi(reader.token).create(body())).status).toBe(403);
    expect((await rulesApi(a1.token).create(body())).status).toBe(403);
    const res = await rulesApi(t.admin).create(body());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // saved last, switched off, nothing fired yet; the description is kept
    expect(res.body).toMatchObject({
      name: 'Refunds',
      description: 'Refund requests go to the billing agents',
      isActive: false,
      isFallback: false,
      stopOnMatch: true,
      firedCount: 0,
      position: 1,
    });
    expect(res.body.assign).toEqual({ strategy: 'round_robin', userIds: [u1, u2], teamIds: [] });
    expect(JSON.stringify(res.body)).not.toMatch(/rrCursor/);
    expect(await p.api.auditCount(t.orgId, 'routing_rules', 'insert')).toBeGreaterThan(0);
    expect((await p.api.events(t.orgId, 'routing_rule.created')).length).toBeGreaterThan(0);
  });

  it('a retried create with the same Idempotency-Key makes one rule', async () => {
    const key = randomUUID();
    const first = await rulesApi(t.admin).create(body({ name: 'Once' }), key);
    const second = await rulesApi(t.admin).create(body({ name: 'Once' }), key);
    expect(second.body.id).toBe(first.body.id);
    const n = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM routing_rules WHERE org_id = $1 AND name = 'Once'`,
      [t.orgId],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it('refuses a rule that catches everything unless it is the fallback, and targets outside the workspace', async () => {
    const t2 = await p.api.signup('rrc');
    const none = await rulesApi(t2.admin).create({
      name: 'All',
      assign: { strategy: 'round_robin', userIds: [u1] },
    });
    expect(none.status).toBe(422);
    expect(JSON.stringify(none.body)).toContain('fallback');

    // an agent of ANOTHER workspace: the friendly 422, nothing created
    const foreign = await rulesApi(t2.admin).create(body());
    expect(foreign.status).toBe(422);
    expect(JSON.stringify(foreign.body)).toContain('not part of this workspace');
    expect((await rulesApi(t2.admin).list()).body.total).toBe(0);

    // a member who cannot open the inbox cannot be given conversations
    const blind = await uuidOf(nobody.userId);
    const refused = await rulesApi(t.admin).create(
      body({ assign: { strategy: 'round_robin', userIds: [blind] } }),
    );
    expect(refused.status).toBe(422);
  });

  it('lists in priority order with search and cursor pages; reorder moves the listed rules', async () => {
    const t3 = await p.api.signup('rrd');
    const m = await p.api.member(t3, 'rrdm', AGENT);
    const mu = await uuidOf(m.userId);
    const make = async (name: string, word: string) =>
      (
        await rulesApi(t3.admin).create({
          name,
          conditions: { keywords: { words: [word] } },
          assign: { strategy: 'specific', userIds: [mu] },
        })
      ).body as Rule;
    const r1 = await make('Alpha', 'a');
    const r2 = await make('Beta', 'b');
    const r3 = await make('Gamma', 'c');
    expect([r1.position, r2.position, r3.position]).toEqual([1, 2, 3]);

    const page1 = (await rulesApi(t3.admin).list('?limit=2')).body;
    expect(page1.data.map((r: Rule) => r.name)).toEqual(['Alpha', 'Beta']);
    expect(page1.page.hasMore).toBe(true);
    const page2 = (await rulesApi(t3.admin).list(`?limit=2&cursor=${page1.page.nextCursor}`)).body;
    expect(page2.data.map((r: Rule) => r.name)).toEqual(['Gamma']);
    expect(page2.total).toBe(3);
    expect((await rulesApi(t3.admin).list('?q=amm')).body.data.map((r: Rule) => r.name)).toEqual([
      'Gamma',
    ]);

    expect((await rulesApi(t3.admin).reorder([r3.id, r1.id])).status).toBe(200);
    const after = (await rulesApi(t3.admin).list()).body.data as Rule[];
    // Gamma and Alpha swapped slots; Beta, not listed, kept its own
    expect(after.map((r) => r.name)).toEqual(['Gamma', 'Beta', 'Alpha']);
    expect((await rulesApi(t3.admin).reorder([r3.id, randomUUID()])).status).toBe(404);
  });

  it('edits with the row version (a stale one is 409), toggles, keeps one fallback, deletes', async () => {
    const t4 = await p.api.signup('rre');
    const m = await p.api.member(t4, 'rrem', AGENT);
    const mu = await uuidOf(m.userId);
    const assign = { strategy: 'specific', userIds: [mu] };
    const a = (await rulesApi(t4.admin).create({ name: 'A', assign, isFallback: true }))
      .body as Rule;
    const b = (await rulesApi(t4.admin).create({ name: 'B', assign, isFallback: true }))
      .body as Rule;
    const list = (await rulesApi(t4.admin).list()).body.data as Array<
      Rule & { isFallback: boolean }
    >;
    expect(list.filter((r) => r.isFallback).map((r) => r.name)).toEqual(['B']);

    const on = await rulesApi(t4.admin).update(b.id, { rowVersion: b.rowVersion, isActive: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.isActive).toBe(true);
    const stale = await rulesApi(t4.admin).update(b.id, { rowVersion: b.rowVersion, name: 'B2' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');

    // a normal rule cannot lose all its conditions
    const withCond = (
      await rulesApi(t4.admin).create({ name: 'C', assign, conditions: { languages: ['ar'] } })
    ).body as Rule;
    const wipe = await rulesApi(t4.admin).update(withCond.id, {
      rowVersion: withCond.rowVersion,
      conditions: {},
    });
    expect(wipe.status).toBe(422);

    expect((await rulesApi(t4.admin).remove(a.id)).status).toBe(204);
    expect((await rulesApi(t4.admin).remove(a.id)).status).toBe(404);
  });

  it('the plan: the feature gate refuses every route, the limit refuses the next rule', async () => {
    const t5 = await p.api.signup('rrf');
    const m = await p.api.member(t5, 'rrfm', AGENT);
    const mu = await uuidOf(m.userId);
    const mk = (n: string) =>
      rulesApi(t5.admin).create({
        name: n,
        conditions: { languages: ['en'] },
        assign: { strategy: 'specific', userIds: [mu] },
      });
    await p.h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
      [t5.orgId, JSON.stringify({ limits: { routing_rules: 2 } })],
    );
    expect((await mk('one')).status).toBe(201);
    expect((await mk('two')).status).toBe(201);
    const over = await mk('three');
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('PLAN_LIMIT_REACHED');
    expect((await rulesApi(t5.admin).list()).body).toMatchObject({ total: 2, limit: 2 });

    await p.h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"inbox_routing":false}}' WHERE org_id = $1`,
      [t5.orgId],
    );
    for (const res of [await rulesApi(t5.admin).list(), await mk('four')]) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    }
  });

  it("tenants never see or touch each other's rules", async () => {
    const mine = (await rulesApi(t.admin).list()).body.data as Rule[];
    expect(mine.length).toBeGreaterThan(0);
    const theirs = await rulesApi(other.admin).list();
    expect(theirs.body.data).toEqual([]);
    const probe = await rulesApi(other.admin).update(mine[0]!.id, {
      rowVersion: mine[0]!.rowVersion,
      name: 'x',
    });
    expect(probe.status).toBe(404);
    expect((await rulesApi(other.admin).remove(mine[0]!.id)).status).toBe(404);
  });
});

describe('the engine: a new conversation is given to an agent', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let a2: { token: string; userId: number };
  let a3: { token: string; userId: number };
  let u1: string;
  let u2: string;
  let u3: string;
  let refunds: Rule;
  let billingA: Rule;
  let billingB: Rule;
  let fallback: Rule;
  const eventsOf = async (conv: Record<string, unknown>) =>
    (
      await p.h.owner.query(
        `SELECT type, actor_type, payload FROM conversation_events WHERE conversation_id = $1 ORDER BY id`,
        [conv.id],
      )
    ).rows as Array<{ type: string; actor_type: string; payload: Record<string, unknown> }>;

  beforeAll(async () => {
    t = await p.api.signup('rre1');
    ch = await simChannel(p, t);
    a1 = await p.api.member(t, 'eng1', AGENT);
    a2 = await p.api.member(t, 'eng2', AGENT);
    a3 = await p.api.member(t, 'eng3', AGENT);
    [u1, u2, u3] = await Promise.all([a1, a2, a3].map((a) => uuidOf(a.userId)));
    const api = rulesApi(t.admin);
    const live = async (r: Rule) =>
      (await api.update(r.id, { rowVersion: r.rowVersion, isActive: true })).body as Rule;
    refunds = await live(
      (
        await api.create({
          name: 'Refunds',
          conditions: { keywords: { mode: 'any', words: ['refund'] } },
          assign: { strategy: 'round_robin', userIds: [u1, u2] },
        })
      ).body,
    );
    // two rules for "billing": the first does not stop, so the second one takes over (Reference ran every matching rule in order)
    billingA = await live(
      (
        await api.create({
          name: 'Billing A',
          conditions: { keywords: { words: ['billing'] } },
          assign: { strategy: 'specific', userIds: [u1] },
          stopOnMatch: false,
        })
      ).body,
    );
    billingB = await live(
      (
        await api.create({
          name: 'Billing B',
          conditions: { keywords: { words: ['billing'] } },
          assign: { strategy: 'specific', userIds: [u2] },
        })
      ).body,
    );
    // never reached for "refund": the first rule stops evaluation
    await live(
      (
        await api.create({
          name: 'Any simulator',
          conditions: { channelKinds: ['simulator'], keywords: { words: ['refund'] } },
          assign: { strategy: 'specific', userIds: [u3] },
        })
      ).body,
    );
    fallback = await live(
      (
        await api.create({
          name: 'Fallback',
          isFallback: true,
          assign: { strategy: 'specific', userIds: [u3] },
        })
      ).body,
    );
  });

  it('the first matching rule wins and stops; round robin alternates across its two agents and keeps its place', async () => {
    const got: Array<number | null> = [];
    for (let i = 0; i < 5; i += 1)
      got.push((await customer(t, ch, 'I want a refund please')).assignee);
    expect(got).toEqual([a1.userId, a2.userId, a1.userId, a2.userId, a1.userId]);

    const row = await ruleRow(refunds.id);
    expect(Number(row.fired_count)).toBe(5);
    expect(row.last_fired_at).not.toBeNull();
    // the cursor is the last agent who took a turn, stored with the rule
    const assign = (row.actions as Array<{ type: string; rrCursor?: number }>).find(
      (a) => a.type === 'assign',
    );
    expect(assign?.rrCursor).toBe(a1.userId);
    // the rule below it never fired, however well it matched
    expect(Number((await ruleRow(fallback.id)).fired_count)).toBe(0);
    expect(
      Number(
        (
          await p.h.owner.query(
            `SELECT fired_count FROM routing_rules WHERE org_id = $1 AND name = 'Any simulator'`,
            [t.orgId],
          )
        ).rows[0].fired_count,
      ),
    ).toBe(0);
  });

  it('records who decided: a system event with the rule and strategy, an outbox event, an audit row, counters for the inbox', async () => {
    const { conv } = await customer(t, ch, 'refund');
    const ev = (await eventsOf(conv)).find((e) => e.type === 'assigned')!;
    expect(ev.actor_type).toBe('system');
    expect(ev.payload).toMatchObject({
      strategy: 'round_robin',
      ruleId: refunds.id,
      ruleName: 'Refunds',
    });
    const out = (await p.api.events(t.orgId, 'conversation.assigned')).filter(
      (e) => e.conversationId === conv.uuid,
    );
    expect(out).toHaveLength(1);
    // it shows up in the agent's own list like any assignment
    const mine = await p.api.as(a2.token).get('/v2/inbox/conversations?tab=mine');
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect((mine.body.data as Array<{ id: string }>).some((c) => c.id === conv.uuid)).toBe(true);
  });

  it('stop on match off: a later matching rule takes over, and both count', async () => {
    const { conv, assignee } = await customer(t, ch, 'a billing question');
    expect(assignee).toBe(a2.userId);
    expect(Number((await ruleRow(billingA.id)).fired_count)).toBe(1);
    expect(Number((await ruleRow(billingB.id)).fired_count)).toBe(1);
    const moves = (await eventsOf(conv)).filter((e) => ['assigned', 'reassigned'].includes(e.type));
    expect(moves.map((e) => e.type)).toEqual(['assigned', 'reassigned']);
  });

  it('the fallback takes what no rule matched; with it off the conversation stays unassigned', async () => {
    const got = await customer(t, ch, 'hello there');
    expect(got.assignee).toBe(a3.userId);
    expect(Number((await ruleRow(fallback.id)).fired_count)).toBe(1);

    const api = rulesApi(t.admin);
    const cur = (await api.list('?q=Fallback')).body.data[0] as Rule;
    await api.update(cur.id, { rowVersion: cur.rowVersion, isActive: false });
    const none = await customer(t, ch, 'hello again');
    expect(none.assignee).toBeNull();
    await api.update(cur.id, {
      rowVersion: (await api.list('?q=Fallback')).body.data[0].rowVersion,
      isActive: true,
    });
  });

  it('an agent who is suspended, or marked busy, is skipped; with nobody left a team queue or nothing', async () => {
    await p.h.owner.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [a2.userId]);
    const g1 = await customer(t, ch, 'refund');
    const g2 = await customer(t, ch, 'refund');
    expect([g1.assignee, g2.assignee]).toEqual([a1.userId, a1.userId]);

    // busy counts as unavailable too
    await p.h.owner.query(
      `INSERT INTO agent_statuses (org_id, user_id, status) VALUES ($1, $2, 'busy')
       ON CONFLICT (org_id, user_id) DO UPDATE SET status = 'busy'`,
      [t.orgId, a1.userId],
    );
    // nobody can take a "refund" now: the rule does not fire and the conversation falls through to the fallback
    const g3 = await customer(t, ch, 'refund');
    expect(g3.assignee).toBe(a3.userId);

    await p.h.owner.query(`UPDATE users SET status = 'active' WHERE id = $1`, [a2.userId]);
    await p.h.owner.query(`DELETE FROM agent_statuses WHERE org_id = $1 AND user_id = $2`, [
      t.orgId,
      a1.userId,
    ]);
  });

  it('a team in the rule is the queue when its people are all unavailable, and a person drawn through a team brings the team', async () => {
    const team = (
      await p.h.owner.query(
        `INSERT INTO teams (org_id, name) VALUES ($1, 'Support') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    await p.h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      team.id,
      a3.userId,
    ]);
    const api = rulesApi(t.admin);
    const rule = (
      await api.create({
        name: 'VIP desk',
        conditions: { keywords: { words: ['vip'] } },
        assign: { strategy: 'least_busy', teamIds: [team.uuid] },
      })
    ).body as Rule;
    await api.update(rule.id, { rowVersion: rule.rowVersion, isActive: true });
    // it goes first, the others keep their order
    const all = ((await api.list()).body.data as Rule[]).filter((r) => r.id !== rule.id);
    expect((await api.reorder([rule.id, ...all.map((r) => r.id)])).status).toBe(200);

    const first = await customer(t, ch, 'vip customer');
    expect(first.assignee).toBe(a3.userId);
    expect(Number(first.conv.assignee_team_id)).toBe(Number(team.id));

    await p.h.owner.query(
      `INSERT INTO agent_statuses (org_id, user_id, status) VALUES ($1, $2, 'offline')
       ON CONFLICT (org_id, user_id) DO UPDATE SET status = 'offline'`,
      [t.orgId, a3.userId],
    );
    const queued = await customer(t, ch, 'vip again');
    expect(queued.assignee).toBeNull();
    expect(Number(queued.conv.assignee_team_id)).toBe(Number(team.id));
    await p.h.owner.query(`DELETE FROM agent_statuses WHERE org_id = $1 AND user_id = $2`, [
      t.orgId,
      a3.userId,
    ]);
  });

  it('a redelivered message and a later message of the same conversation do not assign again', async () => {
    const from = phone();
    // `/dup ` makes the simulator deliver the message three times under one provider id
    const first = await customer(t, ch, '/dup refund', from);
    const fired = Number((await ruleRow(refunds.id)).fired_count);
    expect(first.assignee).not.toBeNull();
    const assignedEvents = (await eventsOf(first.conv)).filter((e) => e.type === 'assigned');
    expect(assignedEvents).toHaveLength(1);

    // a person takes it over; the customer writes again with a rule-matching text: nothing moves
    await p.h.owner.query(`UPDATE conversations SET assignee_user_id = $2 WHERE id = $1`, [
      first.conv.id,
      a3.userId,
    ]);
    await simInbound(p, t, ch, { from, text: 'refund refund' });
    await until('second message stored', async () => {
      const r = await p.h.owner.query(`SELECT msg_seq FROM conversations WHERE id = $1`, [
        first.conv.id,
      ]);
      return Number(r.rows[0].msg_seq) >= 2 || null;
    });
    expect(Number((await conversationOf(p, t, ch, from)).assignee_user_id)).toBe(a3.userId);
    expect(Number((await ruleRow(refunds.id)).fired_count)).toBe(fired);

    // and the engine itself remembers the message it routed for
    const again = await RequestContextStore.run(
      { requestId: 'spec', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
      () =>
        p.h.app.get(RoutingEngine).route({
          orgId: t.orgId,
          conversationUuid: first.conv.uuid as string,
          messageUuid: (first.conv.routing_meta as { routedMessage: string }).routedMessage,
          messageText: 'refund',
        }),
    );
    expect(again).toEqual({ outcome: 'skipped', reason: 'already_routed' });
  });

  it('"keep returning contacts with their agent": the contact\'s owner, else their last agent, only while active; off by default', async () => {
    const settings = (token: string) => ({
      get: () => p.api.as(token).get('/v2/inbox/routing/settings'),
      put: (keepContactAgent: boolean) =>
        p.api.as(token).put('/v2/inbox/routing/settings').send({ keepContactAgent }),
    });
    const own = phone();
    await p.api.seedContacts(t, [{ name: 'Returning', phone: `+${own}`, ownerId: a1.userId }]);

    // the switch is off by default: the rules decide, whoever owns the contact
    expect((await settings(t.admin).get()).body).toEqual({ keepContactAgent: false });
    const off = await customer(t, ch, 'refund', phone());
    expect((await eventsOf(off.conv)).find((e) => e.type === 'assigned')!.payload.strategy).toBe(
      'round_robin',
    );
    expect((await settings(a1.token).put(true)).status).toBe(403);
    expect((await settings(t.admin).put(true)).status).toBe(200);
    expect((await settings(t.admin).get()).body).toEqual({ keepContactAgent: true });

    // on: the owner gets it, although "refund" would have gone round robin; no rule is credited
    const firedBefore = Number((await ruleRow(refunds.id)).fired_count);
    const ownerFirst = await customer(t, ch, 'refund', own);
    expect(ownerFirst.assignee).toBe(a1.userId);
    const ev = (await eventsOf(ownerFirst.conv)).find((e) => e.type === 'assigned')!;
    expect(ev.payload).toMatchObject({ strategy: 'contact_agent' });
    expect(ev.payload.ruleId).toBeUndefined();
    expect(Number((await ruleRow(refunds.id)).fired_count)).toBe(firedBefore);

    // the owner is suspended: the rules run as usual
    await p.h.owner.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [a1.userId]);
    const gone = phone();
    await p.api.seedContacts(t, [{ name: 'Orphaned', phone: `+${gone}`, ownerId: a1.userId }]);
    const fallThrough = await customer(t, ch, 'refund', gone);
    expect(fallThrough.assignee).toBe(a2.userId);
    expect(
      (await eventsOf(fallThrough.conv)).find((e) => e.type === 'assigned')!.payload.strategy,
    ).toBe('round_robin');
    await p.h.owner.query(`UPDATE users SET status = 'active' WHERE id = $1`, [a1.userId]);

    // no owner, but the contact's last conversation (on another channel) was handled by a3: it goes back to a3
    const returning = phone();
    const [contactUuid] = await p.api.seedContacts(t, [
      { name: 'History', phone: `+${returning}` },
    ]);
    const contactId = Number(
      (await p.h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contactUuid])).rows[0].id,
    );
    const other = await simChannel(p, t);
    await p.h.owner.query(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title, status, assignee_user_id, contact_id, last_message_at)
       VALUES ($1,$2,$3,'earlier','resolved',$4,$5, now() - interval '2 days')`,
      [t.orgId, other.internalId, returning, a3.userId, contactId],
    );
    const back = await customer(t, ch, 'refund', returning);
    expect(back.assignee).toBe(a3.userId);
    expect((await eventsOf(back.conv)).find((e) => e.type === 'assigned')!.payload.strategy).toBe(
      'contact_agent',
    );

    expect((await settings(t.admin).put(false)).status).toBe(200);
  });

  it("tenant isolation: another workspace's conversations are never touched by these rules", async () => {
    const t2 = await p.api.signup('rre2');
    const ch2 = await simChannel(p, t2);
    const out = await customer(t2, ch2, 'refund');
    expect(out.assignee).toBeNull();
  });
});
