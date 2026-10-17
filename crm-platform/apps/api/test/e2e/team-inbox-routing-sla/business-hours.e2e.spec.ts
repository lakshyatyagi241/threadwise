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
 * Business hours (TW-TIB2-001): the weekly schedule and the workspace time zone are read and saved from the Auto-assignment screen, and
 * the routing engine uses the schedule as saved. Permissions (read `inbox.settings.read`, write `inbox.routing.manage`), validation, the
 * owner-only time zone, and the engine's `outside` check on a live conversation. Real Postgres and Redis, as the other TIB2 specs.
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

const WEEK_OPEN = (from: string, to: string) =>
  Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { enabled: true, from, to }]));

const WEEK_CLOSED = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { enabled: false, from: '09:00', to: '18:00' }]),
);

const hoursApi = (token: string) => ({
  get: () => p.api.as(token).get('/v2/inbox/routing/business-hours'),
  put: (body: Record<string, unknown>) => p.api.as(token).put('/v2/inbox/routing/business-hours').send(body),
});

describe('business hours API', () => {
  let t: Tenant;
  let reader: { token: string; userId: number };
  let manager: { token: string; userId: number };
  let agent: { token: string; userId: number };

  beforeAll(async () => {
    t = await p.api.signup('bhapi');
    reader = await p.api.member(t, 'bhreader', [['inbox.settings.read', 'all']]);
    manager = await p.api.member(t, 'bhmgr', [
      ['inbox.settings.read', 'all'],
      ['inbox.routing.manage', 'all'],
    ]);
    agent = await p.api.member(t, 'bhagent', [['inbox.conversation.read', 'all']]);
  });

  it('shows Reference defaults until a schedule is saved, then the saved one', async () => {
    const before = await hoursApi(t.admin).get();
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ timezone: 'UTC', canEditTimezone: true });
    expect(before.body.days.mon).toEqual({ enabled: true, from: '09:00', to: '18:00' });
    expect(before.body.days.sat.enabled).toBe(false);
  });

  it('reading needs inbox.settings.read; saving needs inbox.routing.manage', async () => {
    expect((await hoursApi(reader.token).get()).status).toBe(200);
    expect((await hoursApi(agent.token).get()).status).toBe(403);
    expect((await hoursApi(reader.token).put({ days: WEEK_OPEN('09:00', '18:00') })).status).toBe(403);
    expect((await hoursApi(agent.token).put({ days: WEEK_OPEN('09:00', '18:00') })).status).toBe(403);
  });

  it('refuses a closing time not after the opening one, a bad time and an unknown zone', async () => {
    const bad = { ...WEEK_OPEN('09:00', '18:00'), tue: { enabled: true, from: '18:00', to: '09:00' } };
    expect((await hoursApi(t.admin).put({ days: bad })).status).toBe(422);
    expect((await hoursApi(t.admin).put({ days: { ...WEEK_OPEN('9:00', '18:00') } })).status).toBe(422);
    expect(
      (await hoursApi(t.admin).put({ timezone: 'Mars/Olympus', days: WEEK_OPEN('09:00', '18:00') })).status,
    ).toBe(422);
  });

  it('the owner saves the schedule and the zone; the zone is the workspace zone everywhere', async () => {
    const res = await hoursApi(t.admin).put({ timezone: 'Asia/Kolkata', days: WEEK_OPEN('10:00', '18:30') });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ timezone: 'Asia/Kolkata', canEditTimezone: true });
    expect(res.body.days.sun).toEqual({ enabled: true, from: '10:00', to: '18:30' });

    const again = await hoursApi(reader.token).get();
    expect(again.body.timezone).toBe('Asia/Kolkata');
    expect(again.body.days.fri).toEqual({ enabled: true, from: '10:00', to: '18:30' });

    const org = await p.h.owner.query(`SELECT settings ->> 'timezone' AS tz FROM organizations WHERE id = $1`, [t.orgId]);
    expect(org.rows[0].tz).toBe('Asia/Kolkata');
    expect(await p.api.auditCount(t.orgId, 'business_hours', 'update')).toBeGreaterThan(0);
  });

  it('a manager who is not the owner saves the days, and the zone is ignored', async () => {
    const res = await hoursApi(manager.token).get();
    expect(res.body).toMatchObject({ timezone: 'Asia/Kolkata', canEditTimezone: false });

    const put = await hoursApi(manager.token).put({ timezone: 'Europe/Paris', days: WEEK_OPEN('08:00', '17:00') });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ timezone: 'Asia/Kolkata', canEditTimezone: false });
    expect(put.body.days.wed).toEqual({ enabled: true, from: '08:00', to: '17:00' });
  });
});

describe('business hours: the engine follows the saved schedule', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let u1: string;

  beforeAll(async () => {
    t = await p.api.signup('bhengine');
    ch = await simChannel(p, t);
    a1 = await p.api.member(t, 'bheng1', [
      ['inbox.conversation.read', 'all'],
      ['inbox.conversation.reply', 'all'],
      ['inbox.conversation.assign_self', 'all'],
    ]);
    u1 = (await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [a1.userId])).rows[0].uuid as string;
    const rule = await p.api
      .as(t.admin)
      .post('/v2/inbox/routing/rules')
      .set('idempotency-key', `bh-${t.orgId}`)
      .send({
        name: 'After hours',
        conditions: { businessHours: 'outside' },
        assign: { strategy: 'round_robin', userIds: [u1] },
        isActive: true,
      });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
  });

  const writes = async (from: string) => {
    await simInbound(p, t, ch, { from, text: 'hello' });
    return until(`routed ${from}`, async () => {
      const c = await conversationOf(p, t, ch, from);
      return (c.routing_meta as { routedMessage?: string } | null)?.routedMessage ? c : null;
    });
  };

  it('a customer who writes while the schedule says closed is routed by the after-hours rule', async () => {
    expect((await hoursApi(t.admin).put({ timezone: 'UTC', days: WEEK_CLOSED })).status).toBe(200);
    const conv = await writes('919900000101');
    expect(conv.assignee_user_id === null ? null : Number(conv.assignee_user_id)).toBe(a1.userId);
  });

  it('once the schedule is open all the time, the same rule no longer matches', async () => {
    expect((await hoursApi(t.admin).put({ timezone: 'UTC', days: WEEK_OPEN('00:00', '23:59') })).status).toBe(200);
    const conv = await writes('919900000102');
    expect(conv.assignee_user_id).toBeNull();
  });
});
