import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { QueueTimersService } from '../../../src/modules/team-inbox-routing-sla/queue-timers.service';
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
 * The waiting queue's settings and timers (Auto-assignment > Waiting queue): validation of the settings, the plan gate, a chat nobody could
 * take entering the queue, and the three steps (reminder, offer to the overflow team, message to the customer or back to the bot) run by
 * `QueueTimersService` with a fake clock: in order, once each, counted in the team's open minutes, and cancelled by a claim. Real Postgres
 * (restricted role), real Redis, the real ingest worker and routing listener.
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
const q = (sql: string, args: unknown[] = []) => p.h.owner.query(sql, args);
const get = <T>(cls: new (...a: never[]) => T): T => p.h.app.get(cls as never, { strict: false });
let phoneSeq = 0;
const phone = () => `9166${String(30_000_000 + phoneSeq++)}`;
const minutes = (n: number) => new Date(Date.now() + n * 60_000);

async function thread(t: Tenant, ch: SimChannel) {
  const from = phone();
  await simInbound(p, t, ch, { from, text: 'hello' });
  const conv = await until(`thread ${from}`, async () => {
    const c = await conversationOf(p, t, ch, from);
    return c.last_message_at ? c : null;
  });
  return { uuid: conv.uuid as string, id: Number(conv.id) };
}
const row = async (id: number) =>
  (await q(`SELECT * FROM conversations WHERE id = $1`, [id])).rows[0] as Record<string, unknown>;
const putSettings = (t: Tenant, body: Record<string, unknown>) =>
  p.api
    .as(t.admin)
    .put('/v2/inbox/handoff-settings')
    .set('idempotency-key', randomUUID())
    .send(body);
const sendToTeam = (t: Tenant, uuid: string, teamUuid: string) =>
  p.api
    .as(t.admin)
    .post(`/v2/inbox/conversations/${uuid}/handoff`)
    .set('idempotency-key', randomUUID())
    .send({ destination: { kind: 'team', teamId: teamUuid } });
const card = async (t: Tenant, uuid: string) =>
  (await p.api.as(t.admin).get(`/v2/inbox/conversations/${uuid}/handoff`)).body.handoff;
const run = (t: Tenant, uuid: string, at: Date) =>
  RequestContextStore.run(
    { requestId: `qt-${uuid}`, orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
    () => get(QueueTimersService).runFor(t.orgId, uuid, at),
  );
const events = async (id: number) =>
  (
    await q(`SELECT type FROM conversation_events WHERE conversation_id = $1 ORDER BY id`, [id])
  ).rows.map((r) => r.type as string);

describe('settings', () => {
  let t: Tenant;
  let a: { teamUuid: string };
  beforeAll(async () => {
    t = await p.api.signup('wqs');
    a = {
      teamUuid: (
        await q(`INSERT INTO teams (org_id, name) VALUES ($1, 'Overflow') RETURNING uuid`, [
          t.orgId,
        ])
      ).rows[0].uuid,
    };
  });

  it('every step is off by default and the timers read back', async () => {
    const s = await p.api.as(t.admin).get('/v2/inbox/handoff-settings');
    expect(s.body.queueTimers).toEqual({
      remindMinutes: null,
      overflowMinutes: null,
      overflowTeamId: null,
      unclaimedMinutes: null,
      unclaimedAction: 'keep',
      unclaimedMessage: '',
    });
    expect(s.body.available.queueTimers).toBe(true);
    const ok = await putSettings(t, {
      queueTimers: { remindMinutes: 5, overflowMinutes: 10, overflowTeamId: a.teamUuid },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.queueTimers).toMatchObject({ remindMinutes: 5, overflowTeamId: a.teamUuid });
  });

  it('refuses an incomplete step with the field, never drops it silently', async () => {
    for (const body of [
      { queueTimers: { overflowMinutes: 10, overflowTeamId: null } },
      { queueTimers: { unclaimedMinutes: 30, unclaimedAction: 'keep' } },
      { queueTimers: { unclaimedMinutes: 30, unclaimedAction: 'message', unclaimedMessage: '  ' } },
      { queueTimers: { remindMinutes: 0 } },
      { queueTimers: { remindMinutes: 2000 } },
    ]) {
      const res = await putSettings(t, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('is part of Smart routing: locked without the feature, kept but not in effect', async () => {
    await q(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, '{"features":{"inbox_routing":false}}'::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = EXCLUDED.overrides`,
      [t.orgId],
    );
    const locked = await putSettings(t, { queueTimers: { remindMinutes: 7 } });
    expect(locked.status).toBe(422);
    expect(locked.body.code).toBe('PLAN_FEATURE_LOCKED');
    const s = await p.api.as(t.admin).get('/v2/inbox/handoff-settings');
    expect(s.body.available.queueTimers).toBe(false);
    expect(s.body.queueTimers.remindMinutes).toBeNull(); // saved 5, not in effect
    await q(`UPDATE org_plan_state SET overrides = '{}'::jsonb WHERE org_id = $1`, [t.orgId]);
    expect(
      (await p.api.as(t.admin).get('/v2/inbox/handoff-settings')).body.queueTimers.remindMinutes,
    ).toBe(5);
  });
});

describe('the steps', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let teamA: { id: number; uuid: string };
  let teamB: { id: number; uuid: string };

  beforeAll(async () => {
    t = await p.api.signup('wqt');
    ch = await simChannel(p, t);
    a1 = await p.api.member(t, 'wqt1', AGENT);
    const mk = async (name: string) =>
      (
        await q(`INSERT INTO teams (org_id, name) VALUES ($1, $2) RETURNING id, uuid`, [
          t.orgId,
          name,
        ])
      ).rows[0];
    teamA = await mk('Desk A');
    teamB = await mk('Desk B');
    for (const tm of [teamA, teamB])
      await q(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
        t.orgId,
        tm.id,
        a1.userId,
      ]);
    const res = await putSettings(t, {
      queueTimers: {
        remindMinutes: 5,
        overflowMinutes: 10,
        overflowTeamId: teamB.uuid,
        unclaimedMinutes: 20,
        unclaimedAction: 'message',
        unclaimedMessage: 'Hi {{first_name}}, we are on it.',
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('runs remind, offer and final in order as the minutes are reached, each once', async () => {
    const c = await thread(t, ch);
    expect((await sendToTeam(t, c.uuid, teamA.uuid)).body.outcome).toBe('waiting');
    expect((await run(t, c.uuid, minutes(2))).skipped).toBe('nothing_due');

    expect((await run(t, c.uuid, minutes(6))).steps).toEqual(['remind']);
    expect((await run(t, c.uuid, minutes(6))).skipped).toBe('nothing_due'); // once only
    expect((await card(t, c.uuid)).timers.remindedAt).not.toBeNull();

    expect((await run(t, c.uuid, minutes(11))).steps).toEqual(['offer']);
    expect(Number((await row(c.id)).assignee_team_id)).toBe(teamB.id);
    expect((await row(c.id)).assignee_user_id).toBeNull();
    expect((await row(c.id)).handling).toBe('waiting');
    expect((await card(t, c.uuid)).timers.offeredFrom).toMatchObject({ name: 'Desk A' });

    expect((await run(t, c.uuid, minutes(21))).steps).toEqual(['final']);
    const done = (await card(t, c.uuid)).timers;
    expect(done.finalAction).toBe('message');
    expect(await events(c.id)).toEqual(
      expect.arrayContaining(['queue_reminded', 'queue_offered', 'queue_customer_message']),
    );
    // the message was queued for the customer exactly once
    const sent = await q(
      `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND direction = 'out'`,
      [c.id],
    );
    expect(sent.rows[0].n).toBe(1);
    expect((await run(t, c.uuid, minutes(60))).skipped).toBe('nothing_due');
  });

  it('a claim cancels the rest: nothing more runs for a chat somebody took', async () => {
    const c = await thread(t, ch);
    await sendToTeam(t, c.uuid, teamA.uuid);
    const sum = (await p.api.as(a1.token).get(`/v2/inbox/conversations/${c.uuid}`)).body;
    const version = (sum.conversation ?? sum).rowVersion as number;
    const claim = await p.api
      .as(a1.token)
      .post(`/v2/inbox/conversations/${c.uuid}/claim`)
      .set('idempotency-key', randomUUID())
      .send({ rowVersion: version });
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);
    expect((await run(t, c.uuid, minutes(60))).skipped).toBe('not_waiting');
    expect(await events(c.id)).not.toContain('queue_reminded');
  });

  it('a resolved chat is left alone', async () => {
    const c = await thread(t, ch);
    await sendToTeam(t, c.uuid, teamA.uuid);
    await q(`UPDATE conversations SET status = 'closed' WHERE id = $1`, [c.id]);
    expect((await run(t, c.uuid, minutes(60))).skipped).toBe('not_waiting');
  });

  it('counts only the minutes the team is open', async () => {
    const closed = (
      await q(
        `INSERT INTO teams (org_id, name, timezone, business_hours) VALUES ($1, 'Closed', 'UTC', $2::jsonb) RETURNING id, uuid`,
        [
          t.orgId,
          JSON.stringify({
            days: Object.fromEntries(
              ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { enabled: false }]),
            ),
          }),
        ],
      )
    ).rows[0];
    await q(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      closed.id,
      a1.userId,
    ]);
    const c = await thread(t, ch);
    await sendToTeam(t, c.uuid, closed.uuid);
    // a team that is never open: no minute ever counts, so no step is due however long the chat waits
    const out = await run(t, c.uuid, minutes(600));
    expect(out.steps).toEqual([]);
  });

  it('without Smart routing nothing runs and nothing is cleared', async () => {
    const c = await thread(t, ch);
    await sendToTeam(t, c.uuid, teamA.uuid);
    await q(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, '{"features":{"inbox_routing":false}}'::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = EXCLUDED.overrides`,
      [t.orgId],
    );
    expect((await run(t, c.uuid, minutes(60))).skipped).toBe('plan');
    expect((await card(t, c.uuid)).timers.remindedAt).toBeNull();
    await q(`UPDATE org_plan_state SET overrides = '{}'::jsonb WHERE org_id = $1`, [t.orgId]);
    expect((await run(t, c.uuid, minutes(60))).steps.length).toBeGreaterThan(0); // back on: it resumes
  });

  it('the sweep finds the chats of workspaces that configured a timer, and only those', async () => {
    const quiet = await p.api.signup('wqq');
    const qch = await simChannel(p, quiet);
    const c = await thread(quiet, qch);
    const team = (
      await q(`INSERT INTO teams (org_id, name) VALUES ($1, 'Q') RETURNING uuid`, [quiet.orgId])
    ).rows[0];
    await sendToTeam(quiet, c.uuid, team.uuid);
    await get(QueueTimersService).sweep(minutes(600));
    expect((await card(quiet, c.uuid)).timers.remindedAt).toBeNull(); // no timer configured there
  });
});

describe('giving the chat back to the bot', () => {
  it('the last step hands a chat nobody took back to the bot, once', async () => {
    const t = await p.api.signup('wqb');
    const ch = await simChannel(p, t);
    const team = (
      await q(`INSERT INTO teams (org_id, name) VALUES ($1, 'Desk') RETURNING uuid`, [t.orgId])
    ).rows[0];
    expect(
      (await putSettings(t, { queueTimers: { unclaimedMinutes: 15, unclaimedAction: 'bot' } }))
        .status,
    ).toBe(200);
    const c = await thread(t, ch);
    await sendToTeam(t, c.uuid, team.uuid);
    expect((await run(t, c.uuid, minutes(16))).steps).toEqual(['final']);
    expect((await row(c.id)).handling).toBe('with_bot');
    expect((await card(t, c.uuid)).status).toBe('returned');
    expect((await run(t, c.uuid, minutes(40))).skipped).toBe('not_waiting');
  });
});
