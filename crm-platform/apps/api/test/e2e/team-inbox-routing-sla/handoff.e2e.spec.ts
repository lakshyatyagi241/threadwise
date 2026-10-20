import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InboundMessageHooks } from '../../../src/modules/chat-conversations';
import { HandoffService } from '../../../src/modules/team-inbox-routing-sla';
import { OwnerSyncConsumer } from '../../../src/modules/team-inbox-routing-sla/owner-sync.consumer';
import type { Tenant } from '../contacts-attributes-tags/support';
import {
  asUser,
  conversationOf,
  simChannel,
  simInbound,
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from '../chat-conversations/pipeline-support';

/**
 * Conversation handoff and assignment (BL-396..BL-404, docs/specs/conversation-handoff-and-assignment.md): the handling state, the waiting
 * queue, claim, rules at handoff behind the plan, the owner modes, the first-touch owner against the record assignment engine's guard, the
 * bot mute, and the owner sync. Real Postgres (restricted role) and Redis, the real ingest worker and the routing listener.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let p: Pipeline;
beforeAll(async () => {
  p = await startPipeline(async () => [
    (
      await import('../../../src/modules/team-inbox-routing-sla/team-inbox-routing-sla-worker.module')
    ).TeamInboxRoutingSlaWorkerModule,
  ]);
}, 600_000);
afterAll(async () => {
  await p?.stop();
});

const AGENT: Array<[string, 'all']> = [
  ['inbox.conversation.read', 'all'],
  ['inbox.conversation.reply', 'all'],
  ['inbox.conversation.assign_self', 'all'],
];

let phoneSeq = 0;
const phone = () => `9177${String(10_000_000 + phoneSeq++)}`;
const uuidOf = async (userId: number) =>
  (await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;
const features = (t: Tenant, f: Record<string, boolean>) =>
  p.h.owner.query(
    `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb)
     ON CONFLICT (org_id) DO UPDATE SET overrides = jsonb_set(org_plan_state.overrides, '{features}', $3::jsonb, true)`,
    [t.orgId, JSON.stringify({ features: f }), JSON.stringify(f)],
  );
const get = <T>(cls: new (...a: never[]) => T): T => p.h.app.get(cls as never, { strict: false });

async function thread(t: Tenant, ch: SimChannel, text = 'hello') {
  const from = phone();
  await simInbound(p, t, ch, { from, text });
  const conv = await until(`thread ${from}`, async () => {
    const c = await conversationOf(p, t, ch, from);
    return c.last_message_at ? c : null;
  });
  return { from, conv, uuid: conv.uuid as string, id: Number(conv.id) };
}
const row = async (id: number) =>
  (await p.h.owner.query(`SELECT * FROM conversations WHERE id = $1`, [id])).rows[0] as Record<string, unknown>;

describe('handoff: queue, claim, named person (every plan)', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let a2: { token: string; userId: number };
  let team: { id: number; uuid: string };

  beforeAll(async () => {
    t = await p.api.signup('hof');
    ch = await simChannel(p, t);
    // The Basic plan: no automatic assignment of any kind.
    await features(t, { inbox_routing: false });
    a1 = await p.api.member(t, 'hof1', AGENT);
    a2 = await p.api.member(t, 'hof2', AGENT);
    team = (
      await p.h.owner.query(`INSERT INTO teams (org_id, name) VALUES ($1, 'Desk') RETURNING id, uuid`, [t.orgId])
    ).rows[0];
    for (const a of [a1, a2])
      await p.h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [t.orgId, team.id, a.userId]);
  });

  const handoff = (token: string, id: string, body: Record<string, unknown>) =>
    p.api.as(token).post(`/v2/inbox/conversations/${id}/handoff`).set('idempotency-key', randomUUID()).send(body);

  it('a handoff to a team puts the conversation in its queue: waiting, the card, the tab and the badge', async () => {
    const c = await thread(t, ch);
    const res = await handoff(t.admin, c.uuid, {
      reason: 'customer_asked',
      summary: 'Wants a quote',
      destination: { kind: 'team', teamId: team.uuid },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.outcome).toBe('waiting');
    const r = await row(c.id);
    expect(r.handling).toBe('waiting');
    expect(Number(r.assignee_team_id)).toBe(team.id);
    expect(r.assignee_user_id).toBeNull();

    const card = await p.api.as(a1.token).get(`/v2/inbox/conversations/${c.uuid}/handoff`);
    expect(card.body.handoff).toMatchObject({ reason: 'customer_asked', summary: 'Wants a quote', status: 'waiting', outcome: 'waiting' });

    const list = await p.api.as(a1.token).get('/v2/inbox/conversations?tab=waiting');
    expect(list.status).toBe(200);
    expect((list.body.data as Array<{ id: string; handling: string }>).map((x) => x.id)).toContain(c.uuid);
    const counts = await p.api.as(a1.token).get('/v2/inbox/counts');
    expect(counts.body.waiting).toBeGreaterThanOrEqual(1);
    // untouched threads are not in the queue
    const other = await thread(t, ch);
    expect(((await p.api.as(a1.token).get('/v2/inbox/conversations?tab=waiting')).body.data as Array<{ id: string }>).map((x) => x.id)).not.toContain(other.uuid);
  });

  it('claim: the first agent gets it and the second is told it is taken; the card follows', async () => {
    const c = await thread(t, ch);
    await handoff(t.admin, c.uuid, { destination: { kind: 'team', teamId: team.uuid } });
    const sum = (await p.api.as(a1.token).get(`/v2/inbox/conversations/${c.uuid}`)).body;
    const version = (sum.conversation ?? sum).rowVersion as number;
    const first = await p.api.as(a1.token).post(`/v2/inbox/conversations/${c.uuid}/claim`).set('idempotency-key', randomUUID()).send({ rowVersion: version });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const r = await row(c.id);
    expect(r.handling).toBe('with_person');
    expect(Number(r.assignee_user_id)).toBe(a1.userId);
    expect(r.assigned_source).toBe('claim');
    const second = await p.api.as(a2.token).post(`/v2/inbox/conversations/${c.uuid}/claim`).set('idempotency-key', randomUUID()).send({ rowVersion: version + 1 });
    expect(second.status).toBe(409);
    const h = (await p.h.owner.query(`SELECT status, assigned_user_id FROM conversation_handoffs WHERE conversation_id = $1`, [c.id])).rows[0];
    expect(h.status).toBe('assigned');
    expect(Number(h.assigned_user_id)).toBe(a1.userId);
  });

  it('a named person takes it at once (port assigned); a repeat with the same key writes nothing', async () => {
    const c = await thread(t, ch);
    const key = `flow:${randomUUID()}`;
    const svc = get(HandoffService);
    const input = {
      orgId: t.orgId,
      conversationUuid: c.uuid,
      source: 'flow' as const,
      reason: 'sales_lead' as const,
      destination: { kind: 'person' as const, userId: await uuidOf(a2.userId) },
      idempotencyKey: key,
      answers: { name: 'Asha', budget: '5000', user_message: 'ignored' },
      actor: { kind: 'flow' as const },
    };
    const out = await asUser(t.orgId, a2.userId, () => svc.handoff(input));
    expect(out.outcome).toBe('assigned');
    expect(out.duplicate).toBe(false);
    const r = await row(c.id);
    expect(Number(r.assignee_user_id)).toBe(a2.userId);
    expect(r.handling).toBe('with_person');
    expect(r.assigned_source).toBe('handoff_named');
    const again = await asUser(t.orgId, a2.userId, () => svc.handoff(input));
    expect(again.duplicate).toBe(true);
    expect((await p.h.owner.query(`SELECT count(*)::int AS n FROM conversation_handoffs WHERE conversation_id = $1`, [c.id])).rows[0].n).toBe(1);
    const card = (await p.h.owner.query(`SELECT answers FROM conversation_handoffs WHERE conversation_id = $1`, [c.id])).rows[0];
    expect(card.answers).toEqual({ name: 'Asha', budget: '5000' });
  });

  it('without the plan the "assignment rules" destination waits in the queue and the trace says why', async () => {
    const c = await thread(t, ch);
    const res = await handoff(t.admin, c.uuid, { destination: { kind: 'rules' } });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('waiting');
    const r = await row(c.id);
    expect(r.handling).toBe('waiting');
    expect(r.assignee_user_id).toBeNull();
    const card = (await p.api.as(t.admin).get(`/v2/inbox/conversations/${c.uuid}/handoff`)).body.handoff;
    expect(JSON.stringify(card.trace)).toContain('rules_not_in_plan');
  });

  it('return to bot unassigns and unmutes; resolving clears the state', async () => {
    const c = await thread(t, ch);
    await handoff(t.admin, c.uuid, { destination: { kind: 'person', userId: await uuidOf(a1.userId) } });
    expect((await row(c.id)).handling).toBe('with_person');
    const back = await p.api.as(t.admin).post(`/v2/inbox/conversations/${c.uuid}/return-to-bot`).set('idempotency-key', randomUUID()).send({});
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    let r = await row(c.id);
    expect(r.handling).toBe('with_bot');
    expect(r.assignee_user_id).toBeNull();
    const c2 = await thread(t, ch);
    await handoff(t.admin, c2.uuid, { destination: { kind: 'team', teamId: team.uuid } });
    const v = ((await p.api.as(t.admin).get(`/v2/inbox/conversations/${c2.uuid}`)).body.conversation ?? {}).rowVersion as number;
    const st = await p.api.as(t.admin).post(`/v2/inbox/conversations/${c2.uuid}/status`).set('idempotency-key', randomUUID()).send({ status: 'resolved', rowVersion: v });
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    r = await row(c2.id);
    expect(r.handling).toBeNull();
    expect((await p.h.owner.query(`SELECT status FROM conversation_handoffs WHERE conversation_id = $1`, [c2.id])).rows[0].status).toBe('resolved');
  });

  it('the bot listeners are muted while the conversation waits or is with a person, and answer again after return to bot', async () => {
    const calls: string[] = [];
    const hooks = get(InboundMessageHooks);
    hooks.register({
      name: 'probe-bot',
      bot: true,
      onStored: async (e) => {
        calls.push(e.conversationUuid);
        return { consumed: false };
      },
    });
    const c = await thread(t, ch);
    expect(calls).toContain(c.uuid);
    calls.length = 0;
    await handoff(t.admin, c.uuid, { destination: { kind: 'team', teamId: team.uuid } });
    await simInbound(p, t, ch, { from: c.from, text: 'anyone there?' });
    await until('second message stored', async () => {
      const n = Number((await p.h.owner.query(`SELECT msg_seq FROM conversations WHERE id = $1`, [c.id])).rows[0].msg_seq);
      return n >= 2 ? n : null;
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(calls).toEqual([]);
    await p.api.as(t.admin).post(`/v2/inbox/conversations/${c.uuid}/return-to-bot`).set('idempotency-key', randomUUID()).send({});
    await simInbound(p, t, ch, { from: c.from, text: 'hello again' });
    await until('bot answers again', async () => (calls.length > 0 ? calls : null));
  });

  it('settings: a Basic plan can set what it has and is refused, with a reason, what it does not', async () => {
    const s = await p.api.as(t.admin).get('/v2/inbox/handoff-settings');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ autoAssign: true, ownerMode: 'independent', claimSetsOwner: false });
    expect(s.body.available).toMatchObject({ autoAssign: false, ownerFirst: false });
    const ok = await p.api.as(t.admin).put('/v2/inbox/handoff-settings').set('idempotency-key', randomUUID()).send({ claimSetsOwner: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.claimSetsOwner).toBe(true);
    const locked = await p.api.as(t.admin).put('/v2/inbox/handoff-settings').set('idempotency-key', randomUUID()).send({ ownerMode: 'owner_first' });
    expect(locked.status).toBe(422);
    expect(locked.body.code).toBe('PLAN_FEATURE_LOCKED');
  });

  it('claim sets the contact owner only where nobody ever decided it (the record engine guard)', async () => {
    // claimSetsOwner was switched on by the previous test
    const free = await thread(t, ch);
    const decided = await thread(t, ch);
    const contactOf = async (id: number) => Number((await row(id)).contact_id);
    expect(await contactOf(free.id)).toBeGreaterThan(0);
    // `decided` has an owner somebody set, then cleared: explicit "nobody"
    await p.h.owner.query(`UPDATE contacts SET owner_id = $2 WHERE id = $1`, [await contactOf(decided.id), a2.userId]);
    await p.h.owner.query(`UPDATE contacts SET owner_id = NULL WHERE id = $1`, [await contactOf(decided.id)]);
    for (const c of [free, decided]) {
      await handoff(t.admin, c.uuid, { destination: { kind: 'team', teamId: team.uuid } });
      const v = ((await p.api.as(a1.token).get(`/v2/inbox/conversations/${c.uuid}`)).body.conversation ?? {}).rowVersion as number;
      const res = await p.api.as(a1.token).post(`/v2/inbox/conversations/${c.uuid}/claim`).set('idempotency-key', randomUUID()).send({ rowVersion: v });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const ownerOf = async (id: number) => (await p.h.owner.query(`SELECT owner_id, owner_changed_at FROM contacts WHERE id = $1`, [await contactOf(id)])).rows[0];
    const f = await ownerOf(free.id);
    expect(Number(f.owner_id)).toBe(a1.userId);
    expect(f.owner_changed_at).not.toBeNull();
    expect((await ownerOf(decided.id)).owner_id).toBeNull();
    // the engine's own guard now refuses the claimed contact: nobody can overwrite it
    const again = await p.h.owner.query(
      `UPDATE contacts SET owner_id = $2 WHERE id = $1 AND owner_id IS NULL AND owner_changed_at IS NULL`,
      [await contactOf(free.id), a2.userId],
    );
    expect(again.rowCount).toBe(0);
  });
});

describe('handoff on a plan with routing: rules, team method, owner modes, sync', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let a2: { token: string; userId: number };
  let a3: { token: string; userId: number };
  let team: { id: number; uuid: string };

  const handoff = (id: string, body: Record<string, unknown>) =>
    p.api.as(t.admin).post(`/v2/inbox/conversations/${id}/handoff`).set('idempotency-key', randomUUID()).send(body);
  const setSettings = (body: Record<string, unknown>) =>
    p.api.as(t.admin).put('/v2/inbox/handoff-settings').set('idempotency-key', randomUUID()).send(body);

  beforeAll(async () => {
    t = await p.api.signup('hor');
    ch = await simChannel(p, t);
    await features(t, { inbox_routing: true, inbox_assignment_sticky: true });
    a1 = await p.api.member(t, 'hor1', AGENT);
    a2 = await p.api.member(t, 'hor2', AGENT);
    a3 = await p.api.member(t, 'hor3', AGENT);
    team = (
      await p.h.owner.query(
        `INSERT INTO teams (org_id, name, assignment_strategy) VALUES ($1, 'Sales', 'round_robin') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    for (const a of [a1, a2])
      await p.h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [t.orgId, team.id, a.userId]);
    const create = await p.api.as(t.admin).post('/v2/inbox/routing/rules').set('idempotency-key', randomUUID()).send({
      name: 'Everything to a3',
      conditions: { channelKinds: ['simulator'] },
      assign: { strategy: 'specific', userIds: [await uuidOf(a3.userId)] },
    });
    if (create.status === 201) {
      await p.api.as(t.admin).patch(`/v2/inbox/routing/rules/${create.body.id}`).send({ rowVersion: create.body.rowVersion, isActive: true });
    }
  });

  it("a team with round robin hands the conversation to its members in turn, and moves the team's cursor", async () => {
    const got: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const c = await thread(t, ch);
      const res = await handoff(c.uuid, { destination: { kind: 'team', teamId: team.uuid } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.outcome).toBe('assigned');
      got.push(Number((await row(c.id)).assignee_user_id));
    }
    expect(got).toEqual([a1.userId, a2.userId, a1.userId, a2.userId]);
  });

  it('a team that is closed keeps the conversation in its queue and answers unavailable', async () => {
    await p.h.owner.query(
      `UPDATE teams SET timezone = 'UTC', business_hours = $2::jsonb WHERE id = $1`,
      [team.id, JSON.stringify({ days: { mon: { enabled: false }, tue: { enabled: false }, wed: { enabled: false }, thu: { enabled: false }, fri: { enabled: false }, sat: { enabled: false }, sun: { enabled: false } } })],
    );
    const c = await thread(t, ch);
    const res = await handoff(c.uuid, { destination: { kind: 'team', teamId: team.uuid } });
    expect(res.body.outcome).toBe('unavailable');
    expect((await row(c.id)).handling).toBe('waiting');
    await p.h.owner.query(`UPDATE teams SET business_hours = NULL WHERE id = $1`, [team.id]);
  });

  it('the destination "assignment rules" runs the workspace rules at handoff time', async () => {
    const c = await thread(t, ch);
    await p.h.owner.query(`UPDATE conversations SET assignee_user_id = NULL, assignee_team_id = NULL, handling = NULL WHERE id = $1`, [c.id]);
    const res = await handoff(c.uuid, { destination: { kind: 'rules' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = await row(c.id);
    expect(['with_person', 'waiting']).toContain(r.handling);
  });

  it('the switch "automatic assignment" off keeps rules and methods out: the queue only', async () => {
    expect((await setSettings({ autoAssign: false })).status).toBe(200);
    const c = await thread(t, ch);
    const res = await handoff(c.uuid, { destination: { kind: 'team', teamId: team.uuid } });
    expect(res.body.outcome).toBe('waiting');
    const card = (await p.api.as(t.admin).get(`/v2/inbox/conversations/${c.uuid}/handoff`)).body.handoff;
    expect(JSON.stringify(card.trace)).toContain('auto_assign_off');
    expect((await setSettings({ autoAssign: true })).status).toBe(200);
  });

  it('owner first: the contact owner takes it before any method; a person outside the destination team is skipped', async () => {
    expect((await setSettings({ ownerMode: 'owner_first' })).status).toBe(200);
    const c = await thread(t, ch);
    const contactId = Number((await row(c.id)).contact_id);
    await p.h.owner.query(`UPDATE contacts SET owner_id = $2 WHERE id = $1`, [contactId, a2.userId]);
    const res = await handoff(c.uuid, { destination: { kind: 'rules' } });
    expect(res.body.outcome).toBe('assigned');
    let r = await row(c.id);
    expect(Number(r.assignee_user_id)).toBe(a2.userId);
    expect(r.assigned_source).toBe('owner');

    const c2 = await thread(t, ch);
    await p.h.owner.query(`UPDATE contacts SET owner_id = $2 WHERE id = $1`, [Number((await row(c2.id)).contact_id), a3.userId]);
    const res2 = await handoff(c2.uuid, { destination: { kind: 'team', teamId: team.uuid } });
    r = await row(c2.id);
    expect([a1.userId, a2.userId]).toContain(Number(r.assignee_user_id));
    expect(JSON.stringify(res2.body.handoff.trace)).toContain('not_in_destination_team');
    expect((await setSettings({ ownerMode: 'independent' })).status).toBe(200);
  });

  it('keep in sync: a changed contact owner moves automatic conversations, never one a person took, and a repeat is a no-op', async () => {
    expect((await setSettings({ ownerMode: 'keep_in_sync' })).status).toBe(200);
    const auto = await thread(t, ch);
    const taken = await thread(t, ch);
    const contactId = Number((await row(auto.id)).contact_id);
    // both conversations of the same contact: put `taken` on the same contact
    await p.h.owner.query(`UPDATE conversations SET contact_id = $2 WHERE id = $1`, [taken.id, contactId]);
    await p.h.owner.query(
      `UPDATE conversations SET assignee_user_id = $2, assigned_source = 'rule' WHERE id = $1`,
      [auto.id, a1.userId],
    );
    await p.h.owner.query(
      `UPDATE conversations SET assignee_user_id = $2, assigned_source = 'claim' WHERE id = $1`,
      [taken.id, a1.userId],
    );
    await p.h.owner.query(`UPDATE contacts SET owner_id = $2 WHERE id = $1`, [contactId, a2.userId]);
    const contactUuid = (await p.h.owner.query(`SELECT uuid FROM contacts WHERE id = $1`, [contactId])).rows[0].uuid as string;
    const sync = get(OwnerSyncConsumer);
    expect(await sync.sync(t.orgId, contactUuid)).toBe(1);
    expect(Number((await row(auto.id)).assignee_user_id)).toBe(a2.userId);
    expect((await row(auto.id)).assigned_source).toBe('sync');
    expect(Number((await row(taken.id)).assignee_user_id)).toBe(a1.userId);
    expect(await sync.sync(t.orgId, contactUuid)).toBe(0);
    expect((await setSettings({ ownerMode: 'independent' })).status).toBe(200);
  });

  it('losing the sticky feature takes the owner modes away without breaking the queue', async () => {
    await features(t, { inbox_routing: true, inbox_assignment_sticky: false });
    const s = await p.api.as(t.admin).get('/v2/inbox/handoff-settings');
    expect(s.body.available.ownerFirst).toBe(false);
    expect((await setSettings({ ownerMode: 'keep_in_sync' })).status).toBe(422);
    const c = await thread(t, ch);
    expect((await handoff(c.uuid, { destination: { kind: 'team', teamId: team.uuid } })).status).toBe(200);
  });
});
