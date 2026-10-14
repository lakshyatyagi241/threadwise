import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { MemberDirectory } from '../../../src/realtime';
import { NotificationFanout, NotificationsRepository } from '../../../src/modules/notifications';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import { MemberLeaveNotificationConsumer } from '../../../src/modules/notifications/member-leave-notification.consumer';
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
 * Routing and leave (BL-112): conversation auto-assignment never picks somebody who is on leave today; a rule that names an absent person
 * hands the conversation to their delegate (ahead of the rule's teams), else the team pool decides, else the conversation stays
 * unassigned and the leads are told. Behaviour for people who are NOT on leave is the existing suite's (routing-rules.e2e.spec.ts).
 * Real Postgres (restricted role) and Redis, the real BullMQ ingest worker and the routing listener in the same process.
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
const phone = () => `9188${String(10_000_000 + phoneSeq++)}`;
const uuidOf = async (userId: number) =>
  (await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

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
    teamId: conv.assignee_team_id === null ? null : Number(conv.assignee_team_id),
  };
}

const rulesApi = (token: string) => ({
  create: (body: Record<string, unknown>) =>
    p.api.as(token).post('/v2/inbox/routing/rules').set('idempotency-key', randomUUID()).send(body),
  update: (id: string, body: Record<string, unknown>) =>
    p.api.as(token).patch(`/v2/inbox/routing/rules/${id}`).send(body),
});

describe('routing skips people on leave', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let a2: { token: string; userId: number };
  let a3: { token: string; userId: number };
  let a4: { token: string; userId: number };
  let u1: string;
  let u3: string;
  let team: { id: number; uuid: string };

  const eventsOf = async (conv: Record<string, unknown>) =>
    (
      await p.h.owner.query(
        `SELECT type, actor_type, payload FROM conversation_events WHERE conversation_id = $1 ORDER BY id`,
        [conv.id],
      )
    ).rows as Array<{ type: string; payload: Record<string, unknown> }>;
  const blockedEvents = async () =>
    (
      await p.h.owner.query(
        `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'routing.blocked_by_leave' ORDER BY id`,
        [t.orgId],
      )
    ).rows.map((r) => r.payload as Record<string, unknown>);

  /** On leave today (workspace calendar is UTC here; the window is wide so midnight cannot flip it). */
  const away = (userId: number, status = 'active') =>
    p.h.owner.query(
      `INSERT INTO member_leaves (org_id, user_id, starts_on, ends_on, status)
       VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date - 1, (now() AT TIME ZONE 'UTC')::date + 5, $3)`,
      [t.orgId, userId, status],
    );
  const back = () => p.h.owner.query(`DELETE FROM member_leaves WHERE org_id = $1`, [t.orgId]);
  const delegate = (userId: number, delegateId: number) =>
    p.h.owner.query(
      `INSERT INTO member_delegates (org_id, user_id, delegate_user_id) VALUES ($1,$2,$3)
       ON CONFLICT (org_id, user_id) DO UPDATE SET delegate_user_id = EXCLUDED.delegate_user_id`,
      [t.orgId, userId, delegateId],
    );
  const noDelegates = () =>
    p.h.owner.query(`DELETE FROM member_delegates WHERE org_id = $1`, [t.orgId]);
  const setStatus = (userId: number, status: string | null) =>
    status === null
      ? p.h.owner.query(`DELETE FROM agent_statuses WHERE org_id = $1 AND user_id = $2`, [
          t.orgId,
          userId,
        ])
      : p.h.owner.query(
          `INSERT INTO agent_statuses (org_id, user_id, status) VALUES ($1,$2,$3)
           ON CONFLICT (org_id, user_id) DO UPDATE SET status = EXCLUDED.status`,
          [t.orgId, userId, status],
        );

  beforeAll(async () => {
    t = await p.api.signup('rlv');
    ch = await simChannel(p, t);
    a1 = await p.api.member(t, 'rlv1', AGENT);
    a2 = await p.api.member(t, 'rlv2', AGENT);
    a3 = await p.api.member(t, 'rlv3', AGENT);
    a4 = await p.api.member(t, 'rlv4', AGENT);
    u1 = await uuidOf(a1.userId);
    u3 = await uuidOf(a3.userId);
    team = (
      await p.h.owner.query(
        `INSERT INTO teams (org_id, name) VALUES ($1, 'Desk') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    for (const a of [a2, a4]) {
      await p.h.owner.query(
        `INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`,
        [t.orgId, team.id, a.userId],
      );
    }
    const api = rulesApi(t.admin);
    const live = async (body: Record<string, unknown>) => {
      const r = (await api.create(body)).body as { id: string; rowVersion: number };
      expect((await api.update(r.id, { rowVersion: r.rowVersion, isActive: true })).status).toBe(
        200,
      );
    };
    await live({
      name: 'Pool',
      conditions: { keywords: { words: ['poolword'] } },
      assign: { strategy: 'round_robin', userIds: [u1, await uuidOf(a2.userId)] },
    });
    await live({
      name: 'Named',
      conditions: { keywords: { words: ['namedword'] } },
      assign: { strategy: 'specific', userIds: [u1] },
    });
    await live({
      name: 'Named with desk',
      conditions: { keywords: { words: ['deskword'] } },
      assign: { strategy: 'round_robin', userIds: [u1], teamIds: [team.uuid] },
    });
  });

  it('a round robin pool never picks the person on leave, and takes them back the day they are not', async () => {
    await away(a1.userId);
    const got = [];
    for (let i = 0; i < 3; i += 1) got.push((await customer(t, ch, 'poolword please')).assignee);
    expect(got).toEqual([a2.userId, a2.userId, a2.userId]);

    await back();
    const after = [];
    for (let i = 0; i < 2; i += 1) after.push((await customer(t, ch, 'poolword please')).assignee);
    // a2 took the last turn: the rotation continues with a1
    expect(after).toEqual([a1.userId, a2.userId]);
  });

  it('a leave that has not started, or that is over, does not block anybody', async () => {
    await p.h.owner.query(
      `INSERT INTO member_leaves (org_id, user_id, starts_on, ends_on, status) VALUES
        ($1, $2, (now() AT TIME ZONE 'UTC')::date + 3, (now() AT TIME ZONE 'UTC')::date + 6, 'scheduled'),
        ($1, $2, (now() AT TIME ZONE 'UTC')::date - 9, (now() AT TIME ZONE 'UTC')::date - 5, 'ended'),
        ($1, $2, (now() AT TIME ZONE 'UTC')::date - 20, (now() AT TIME ZONE 'UTC')::date - 10, 'cancelled')`,
      [t.orgId, a1.userId],
    );
    const seen = new Set<number | null>();
    for (let i = 0; i < 4; i += 1) seen.add((await customer(t, ch, 'poolword please')).assignee);
    expect(seen).toEqual(new Set([a1.userId, a2.userId]));
    await back();
  });

  it('a leave counts from its first day even before the sweep has flipped its status (the dates decide, not the sweep)', async () => {
    await away(a1.userId, 'scheduled');
    const got = (await customer(t, ch, 'poolword please')).assignee;
    expect(got).toBe(a2.userId);
    await back();
  });

  it('a rule that names somebody on leave gives the chat to their delegate, and the timeline says whom they cover', async () => {
    await away(a1.userId);
    await delegate(a1.userId, a3.userId);
    const got = await customer(t, ch, 'namedword help');
    expect(got.assignee).toBe(a3.userId);
    const ev = (await eventsOf(got.conv)).find((e) => e.type === 'assigned')!;
    expect(ev.payload).toMatchObject({ strategy: 'specific', delegateFor: u1 });
    expect(await blockedEvents()).toEqual([]);
    await back();
    await noDelegates();
    // the same rule with nobody away is the old behaviour
    expect((await customer(t, ch, 'namedword help')).assignee).toBe(a1.userId);
  });

  it('the delegate is used only when present: busy, offline, suspended or on leave themselves, they are skipped (no chain is followed)', async () => {
    await away(a1.userId);
    await delegate(a1.userId, a3.userId);
    await setStatus(a3.userId, 'busy');
    const blockedBefore = (await blockedEvents()).length;
    const none = await customer(t, ch, 'namedword help');
    expect(none.assignee).toBeNull();
    expect(none.teamId).toBeNull();
    // nobody could take it and somebody was away: the leads are told, once, with the conversation
    const blocked = await blockedEvents();
    expect(blocked.length).toBe(blockedBefore + 1);
    expect(blocked.at(-1)).toMatchObject({ conversationId: none.conv.uuid });

    await setStatus(a3.userId, null);
    await p.h.owner.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [a3.userId]);
    expect((await customer(t, ch, 'namedword help')).assignee).toBeNull();
    await p.h.owner.query(`UPDATE users SET status = 'active' WHERE id = $1`, [a3.userId]);

    // the delegate is away too: not followed to a delegate's delegate
    await away(a3.userId);
    await delegate(a3.userId, a4.userId);
    expect((await customer(t, ch, 'namedword help')).assignee).toBeNull();
    await back();
    await noDelegates();
  });

  it('a delegate who cannot open the inbox is not used', async () => {
    const outsider = await p.api.member(t, 'rlvout', [['record.contacts.read', 'all']]);
    await away(a1.userId);
    await delegate(a1.userId, outsider.userId);
    expect((await customer(t, ch, 'namedword help')).assignee).toBeNull();
    await back();
    await noDelegates();
  });

  it("with no delegate the rule's team pool decides; with one, the delegate goes ahead of the team", async () => {
    await away(a1.userId);
    const viaTeam = new Set<number | null>();
    for (let i = 0; i < 4; i += 1) viaTeam.add((await customer(t, ch, 'deskword hello')).assignee);
    expect(viaTeam).toEqual(new Set([a2.userId, a4.userId]));

    await delegate(a1.userId, a3.userId);
    for (let i = 0; i < 3; i += 1) {
      const got = await customer(t, ch, 'deskword hello');
      expect(got.assignee).toBe(a3.userId);
    }
    await back();
    await noDelegates();
  });

  it('with the whole team away the chat waits in the team queue (assigned to the team, nobody told)', async () => {
    await away(a1.userId);
    await away(a2.userId);
    await away(a4.userId);
    const before = (await blockedEvents()).length;
    const got = await customer(t, ch, 'deskword hello');
    expect(got.assignee).toBeNull();
    expect(got.teamId).toBe(Number(team.id));
    expect((await blockedEvents()).length).toBe(before);
    await back();
  });

  it('"keep returning contacts with their agent": an owner on leave hands the contact to their delegate, with none the rules decide', async () => {
    expect(
      (await p.api.as(t.admin).put('/v2/inbox/routing/settings').send({ keepContactAgent: true }))
        .status,
    ).toBe(200);
    const mine = phone();
    await p.api.seedContacts(t, [{ name: 'Returning', phone: `+${mine}`, ownerId: a1.userId }]);
    await away(a1.userId);

    await delegate(a1.userId, a3.userId);
    const viaDelegate = await customer(t, ch, 'poolword hello', mine);
    expect(viaDelegate.assignee).toBe(a3.userId);
    expect(
      (await eventsOf(viaDelegate.conv)).find((e) => e.type === 'assigned')!.payload.strategy,
    ).toBe('contact_agent');

    await noDelegates();
    const second = phone();
    await p.api.seedContacts(t, [{ name: 'Second', phone: `+${second}`, ownerId: a1.userId }]);
    const viaRules = await customer(t, ch, 'poolword hello', second);
    expect(viaRules.assignee).toBe(a2.userId); // a1 is away: the pool rule gives it to a2
    expect(
      (await eventsOf(viaRules.conv)).find((e) => e.type === 'assigned')!.payload.strategy,
    ).toBe('round_robin');

    await back();
    expect(
      (await p.api.as(t.admin).put('/v2/inbox/routing/settings').send({ keepContactAgent: false }))
        .status,
    ).toBe(200);
  });

  it('the picker shows who is on leave until when (and who covers); a person can still be picked by hand', async () => {
    await away(a1.userId);
    await delegate(a1.userId, a3.userId);
    const list = await p.api.as(t.admin).get('/v2/inbox/assignees');
    expect(list.status).toBe(200);
    const users = list.body.users as Array<{
      id: string;
      onLeave: { until: string | null; delegateId: string | null } | null;
    }>;
    const mark = users.find((u) => u.id === u1)!.onLeave!;
    expect(mark.delegateId).toBe(u3);
    expect(mark.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(users.find((u) => u.id === u3)!.onLeave).toBeNull();

    // by hand it is allowed (a warning in the picker, not a block)
    const conv = await customer(t, ch, 'nothing matches this text at all');
    const res = await p.api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv.conv.uuid}/assign`)
      .send({ rowVersion: Number(conv.conv.row_version), userId: u1 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await back();
    await noDelegates();
  });

  it('the leads are told when a chat has nobody to take it because of leave', async () => {
    const lead = await p.api.member(t, 'rlvlead', [
      ['team.leave.manage', 'all'],
      ['team.leave.read', 'all'],
    ]);
    const consumer = new MemberLeaveNotificationConsumer(
      p.h.app.get(DatabaseService, { strict: false }),
      p.h.app.get(OutboxSubscriberRegistry, { strict: false }),
      p.h.app.get(MemberDirectory, { strict: false }),
      new NotificationFanout(
        new NotificationsRepository(),
        new NotificationPrefsResolver(p.h.app.get(DatabaseService, { strict: false })),
        new Proxy({}, { get: () => async () => undefined }) as never,
      ),
    );
    const ev = (
      await p.h.owner.query(
        `SELECT id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
         WHERE org_id = $1 AND event_type = 'routing.blocked_by_leave' ORDER BY id DESC LIMIT 1`,
        [t.orgId],
      )
    ).rows[0];
    const event = {
      id: String(ev.id),
      orgId: t.orgId,
      aggregateModule: ev.aggregate_module,
      aggregateId: String(ev.aggregate_id),
      eventType: ev.event_type,
      payload: ev.payload,
    };
    await consumer.handle(event as never);
    await consumer.handle(event as never);
    const rows = (
      await p.h.owner.query(
        `SELECT user_id, link FROM inbox_notifications WHERE org_id = $1 AND type = 'assignment_blocked_by_leave'`,
        [t.orgId],
      )
    ).rows;
    const told = rows.map((r) => Number(r.user_id));
    expect(told).toContain(lead.userId);
    expect(told).not.toContain(a2.userId);
    expect(new Set(told).size).toBe(told.length);
    expect(rows[0]!.link).toBe(
      `/inbox?c=${(ev.payload as { conversationId: string }).conversationId}`,
    );
  });

  it("another workspace's leave never affects this workspace's routing", async () => {
    const other = await p.api.signup('rlvx');
    // the same internal user id space is shared: put a leave row in the other workspace for a user of that workspace
    const stranger = await p.api.member(other, 'rlvxs', AGENT);
    await p.h.owner.query(
      `INSERT INTO member_leaves (org_id, user_id, starts_on, ends_on, status)
       VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date - 1, (now() AT TIME ZONE 'UTC')::date + 5, 'active')`,
      [other.orgId, stranger.userId],
    );
    // a leave row cannot name a user of another workspace at all
    await expect(
      p.h.owner.query(
        `INSERT INTO member_leaves (org_id, user_id, starts_on) VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date)`,
        [t.orgId, stranger.userId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    const seen = new Set<number | null>();
    for (let i = 0; i < 4; i += 1) seen.add((await customer(t, ch, 'poolword please')).assignee);
    expect(seen).toEqual(new Set([a1.userId, a2.userId]));
  });
});
