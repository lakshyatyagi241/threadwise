import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * Routing and the personal working hours (docs/specs/agent-status-bar.md): automatic assignment skips a person who is outside their own
 * working hours (the effective status), says so in the trace (`outside_working_hours`), ignores the schedule when the workspace does not
 * have `agent_status_automation`, and lets a manual "Available" through. The rule itself is unit tested; this proves the engine reads it
 * through the real database. Real Postgres (restricted role), Redis, the ingest worker and the routing listener in one process.
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
const phone = () => `9188${String(30_000_000 + phoneSeq++)}`;
const uuidOf = async (userId: number) =>
  (await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

async function customer(t: Tenant, ch: SimChannel, text: string) {
  const from = phone();
  await simInbound(p, t, ch, { from, text });
  const conv = await until(`routed ${from}`, async () => {
    const c = await conversationOf(p, t, ch, from);
    const meta = c.routing_meta as { routedMessage?: string } | null;
    return meta?.routedMessage ? c : null;
  });
  return conv.assignee_user_id === null ? null : Number(conv.assignee_user_id);
}

const hhmm = (h24: number) => `${String((h24 + 24) % 24).padStart(2, '0')}:00`;
/** Open for one hour, starting two hours from now, every day of the week (UTC): now is never inside it. */
function closedNow() {
  const hour = new Date().getUTCHours();
  const day = { enabled: true, from: hhmm(hour + 2), to: hhmm(hour + 3) };
  return {
    automate: true,
    timezone: 'UTC',
    days: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day },
  };
}

describe('routing skips people outside their working hours', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let a2: { token: string; userId: number };

  const flags = (automation: boolean) =>
    p.h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
      [
        t.orgId,
        JSON.stringify({
          features: {
            inbox_routing: true,
            agent_status_bar: true,
            agent_status_automation: automation,
          },
        }),
      ],
    );
  const setPrefs = (userId: number, availability: Record<string, unknown>, status = 'online') =>
    p.h.owner.query(
      `INSERT INTO agent_statuses (org_id, user_id, status, preferences) VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (org_id, user_id) DO UPDATE SET status = EXCLUDED.status, preferences = EXCLUDED.preferences`,
      [t.orgId, userId, status, JSON.stringify({ availability })],
    );
  const tryIt = () =>
    p.api.as(t.admin).post('/v2/inbox/routing/test').send({
      channelKind: 'simulator',
      messageText: 'poolword please',
    });

  beforeAll(async () => {
    t = await p.api.signup('rwh');
    ch = await simChannel(p, t);
    a1 = await p.api.member(t, 'rwh1', AGENT);
    a2 = await p.api.member(t, 'rwh2', AGENT);
    await flags(true);
    const r = (
      await p.api
        .as(t.admin)
        .post('/v2/inbox/routing/rules')
        .set('idempotency-key', randomUUID())
        .send({
          name: 'Pool',
          conditions: { keywords: { words: ['poolword'] } },
          assign: {
            strategy: 'round_robin',
            userIds: [await uuidOf(a1.userId), await uuidOf(a2.userId)],
          },
        })
    ).body as { id: string; rowVersion: number };
    expect(
      (
        await p.api
          .as(t.admin)
          .patch(`/v2/inbox/routing/rules/${r.id}`)
          .send({ rowVersion: r.rowVersion, isActive: true })
      ).status,
    ).toBe(200);
    await setPrefs(a1.userId, { hours: closedNow() });
  });

  it('a round robin pool never picks the person outside their hours, and Try it says why', async () => {
    const got = [];
    for (let i = 0; i < 3; i += 1) got.push(await customer(t, ch, 'poolword please'));
    expect(got).toEqual([a2.userId, a2.userId, a2.userId]);
    const res = await tryIt();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.trace.map((l: { why?: string }) => l.why)).toContain('outside_working_hours');
  });

  it('a manual Available beats the schedule and the person is picked again', async () => {
    await setPrefs(a1.userId, {
      hours: closedNow(),
      manual: { status: 'online', setAt: new Date().toISOString(), until: null },
    });
    const seen = new Set<number | null>();
    for (let i = 0; i < 4; i += 1) seen.add(await customer(t, ch, 'poolword please'));
    expect(seen).toEqual(new Set([a1.userId, a2.userId]));
  });

  it('without agent_status_automation the schedule is ignored (and kept)', async () => {
    await setPrefs(a1.userId, { hours: closedNow() });
    await flags(false);
    const seen = new Set<number | null>();
    for (let i = 0; i < 4; i += 1) seen.add(await customer(t, ch, 'poolword please'));
    expect(seen).toEqual(new Set([a1.userId, a2.userId]));
    const kept = await p.h.owner.query(
      `SELECT preferences FROM agent_statuses WHERE org_id = $1 AND user_id = $2`,
      [t.orgId, a1.userId],
    );
    expect(kept.rows[0].preferences.availability.hours.automate).toBe(true);
    await flags(true);
  });

  it('a manual Away (stored offline) is still skipped, with the old reason', async () => {
    await setPrefs(a1.userId, {}, 'offline');
    const got = [];
    for (let i = 0; i < 2; i += 1) got.push(await customer(t, ch, 'poolword please'));
    expect(got).toEqual([a2.userId, a2.userId]);
    const res = await tryIt();
    expect(res.body.trace.map((l: { why?: string }) => l.why)).toContain(
      'offline_busy_or_at_capacity',
    );
  });
});
