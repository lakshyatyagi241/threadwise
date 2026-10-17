import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { MemberDirectory } from '../../../src/realtime';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { NotificationFanout, NotificationsRepository } from '../../../src/modules/notifications';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import { SlaNotificationConsumer } from '../../../src/modules/notifications/sla-notification.consumer';
import {
  ConversationEventsRepository,
  InboxRealtimePublisher,
} from '../../../src/modules/team-inbox-conversations';
import { SlaClockService } from '../../../src/modules/team-inbox-routing-sla/sla-clock.service';
import { SlaInboundListener } from '../../../src/modules/team-inbox-routing-sla/sla-inbound.listener';
import { SlaSweepService } from '../../../src/modules/team-inbox-routing-sla/sla-sweep.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import {
  AGENT,
  Api,
  Inbox,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../team-inbox-conversations/support';

/**
 * SLA policies and response clocks (BL-036, TW-TIB2-024 to 028): the policy API with its permissions, plan gate and validation, the
 * clock that starts on the customer's message (priority overrides, business hours in the workspace time zone), the sweep that
 * closes answered clocks and flags breached ones, and the notification of a breach.
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

const get = <T>(cls: new (...a: never[]) => T): T => h.app.get(cls as never, { strict: false });

const clock = () => get(SlaClockService);
const sweeper = () =>
  new SlaSweepService(
    get(DatabaseService),
    get(ConversationEventsRepository),
    get(OutboxService),
    get(InboxRealtimePublisher),
    get(PlanEntitlementService),
  );

const MANAGE: Grant[] = [...AGENT, ['inbox.settings.read', 'all'], ['inbox.sla.manage', 'all']];
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const minutesAhead = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

describe('SLA policies API', () => {
  let t: Tenant;
  let manager: { token: string; userId: number };
  let reader: { token: string; userId: number };
  let plain: { token: string; userId: number };

  const policies = (token: string) => api.as(token).get('/v2/inbox/sla/policies');
  const create = (token: string, body: Record<string, unknown>) =>
    api.as(token).post('/v2/inbox/sla/policies').send(body);

  beforeAll(async () => {
    t = await api.signup('slp');
    manager = await api.member(t, 'manager', MANAGE);
    reader = await api.member(t, 'reader', [...AGENT, ['inbox.settings.read', 'all']]);
    plain = await api.member(t, 'plain', AGENT);
  });

  it('creates a policy: the first one is the default, a later default takes the flag, the list puts the default first', async () => {
    const first = await create(manager.token, {
      name: 'Standard',
      firstResponseMinutes: 30,
      resolutionMinutes: 1440,
      priorityOverrides: { urgent: { firstResponseMinutes: 5 } },
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({
      name: 'Standard',
      firstResponseMinutes: 30,
      resolutionMinutes: 1440,
      respectBusinessHours: true,
      isDefault: true,
      conversationCount: 0,
    });
    const second = await create(manager.token, { name: 'VIP', firstResponseMinutes: 10 });
    expect(second.body.isDefault).toBe(false);
    const third = await create(manager.token, { name: 'Gold', isDefault: true });
    expect(third.body.isDefault).toBe(true);

    const list = (await policies(reader.token)).body.data as Array<{
      name: string;
      isDefault: boolean;
    }>;
    expect(list.filter((p) => p.isDefault).map((p) => p.name)).toEqual(['Gold']);
    expect(list[0]!.name).toBe('Gold');
    expect(await api.auditCount(t.orgId, 'sla_policies', 'insert')).toBe(3);
    expect((await api.events(t.orgId, 'inbox.sla_policy.created')).length).toBe(3);
  });

  it('edits with the version it read, moves the default, and deletes', async () => {
    const made = (await create(manager.token, { name: 'Edit me', firstResponseMinutes: 60 })).body;
    const edited = await api.as(manager.token).patch(`/v2/inbox/sla/policies/${made.id}`).send({
      rowVersion: made.rowVersion,
      name: 'Edited',
      firstResponseMinutes: null,
      resolutionMinutes: 480,
      isDefault: true,
      respectBusinessHours: false,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({
      name: 'Edited',
      firstResponseMinutes: null,
      resolutionMinutes: 480,
      isDefault: true,
      respectBusinessHours: false,
    });
    const defaults = (
      (await policies(manager.token)).body.data as Array<{ isDefault: boolean }>
    ).filter((p) => p.isDefault);
    expect(defaults).toHaveLength(1);

    const stale = await api
      .as(manager.token)
      .patch(`/v2/inbox/sla/policies/${made.id}`)
      .send({ rowVersion: made.rowVersion, name: 'Stale' });
    expect(stale.status).toBe(409);

    expect((await api.as(manager.token).delete(`/v2/inbox/sla/policies/${made.id}`)).status).toBe(
      204,
    );
    expect((await api.as(manager.token).delete(`/v2/inbox/sla/policies/${made.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await api
          .as(manager.token)
          .patch(`/v2/inbox/sla/policies/${made.id}`)
          .send({ rowVersion: 1 })
      ).status,
    ).toBe(404);
  });

  it('validates every write: minutes, unknown priorities and unknown keys are refused', async () => {
    for (const body of [
      { name: '' },
      { name: 'x', firstResponseMinutes: 0 },
      { name: 'x', firstResponseMinutes: 100_001 },
      { name: 'x', resolutionMinutes: 1.5 },
      { name: 'x', priorityOverrides: { critical: { firstResponseMinutes: 5 } } },
      { name: 'x', priorityOverrides: { urgent: { firstResponseMinutes: 0 } } },
    ]) {
      expect((await create(manager.token, body)).status, JSON.stringify(body)).toBe(422);
    }
  });

  it('reading needs the inbox settings right, writing needs the SLA right', async () => {
    expect((await policies(reader.token)).status).toBe(200);
    expect((await create(reader.token, { name: 'Nope' })).status).toBe(403);
    expect((await policies(plain.token)).status).toBe(403);
  });

  it('every route is locked on a plan without inbox_sla', async () => {
    const t2 = await api.signup('slq');
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
      [t2.orgId, JSON.stringify({ features: { inbox_sla: false } })],
    );
    for (const res of [await policies(t2.admin), await create(t2.admin, { name: 'x' })]) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    }
  });

  it("tenants never see or touch each other's policies", async () => {
    const other = await api.signup('slr');
    const mine = (await policies(manager.token)).body.data as Array<{ id: string }>;
    expect((await policies(other.admin)).body.data).toEqual([]);
    expect((await api.as(other.admin).delete(`/v2/inbox/sla/policies/${mine[0]!.id}`)).status).toBe(
      404,
    );
  });
});

describe('response clocks', () => {
  let t: Tenant;
  let ch: { id: string };
  let manager: { token: string; userId: number };
  let policyId: string;

  const setWaiting = (uuid: string, iso: string | null) =>
    h.owner.query(`UPDATE conversations SET waiting_since = $2::timestamptz WHERE uuid = $1`, [
      uuid,
      iso,
    ]);
  const dues = async (uuid: string) => {
    const r = (await inbox.row(uuid)) as Record<string, unknown>;
    return {
      first: r.sla_first_response_due
        ? new Date(r.sla_first_response_due as string).toISOString()
        : null,
      resolution: r.sla_resolution_due
        ? new Date(r.sla_resolution_due as string).toISOString()
        : null,
      breached: r.sla_breached as boolean,
      policy: r.sla_policy_id,
    };
  };
  const seedClock = (
    uuid: string,
    over: { first?: string | null; resolution?: string | null; waiting?: string | null },
  ) =>
    h.owner.query(
      `UPDATE conversations SET sla_first_response_due = $2::timestamptz, sla_resolution_due = $3::timestamptz,
         waiting_since = $4::timestamptz, sla_breached = false WHERE uuid = $1`,
      [uuid, over.first ?? null, over.resolution ?? null, over.waiting ?? null],
    );

  beforeAll(async () => {
    t = await api.signup('slc');
    ch = await inbox.channel(t.admin);
    manager = await api.member(t, 'manager', MANAGE);
    const made = await api
      .as(manager.token)
      .post('/v2/inbox/sla/policies')
      .send({
        name: 'Standard',
        firstResponseMinutes: 30,
        resolutionMinutes: 240,
        respectBusinessHours: false,
        priorityOverrides: { urgent: { firstResponseMinutes: 5 } },
      });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    policyId = made.body.id;
  });

  it('starts from the customer wait: wall-clock targets, the priority override, and the policy link', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const waiting = '2026-10-14T10:00:00.000Z';
    await setWaiting(c.uuid, waiting);
    const out = await clock().start(t.orgId, c.uuid);
    expect(out).toMatchObject({ started: true, policy: policyId });
    expect(await dues(c.uuid)).toMatchObject({
      first: '2026-10-14T10:30:00.000Z',
      resolution: '2026-10-14T14:00:00.000Z',
      breached: false,
    });

    const u = await inbox.conversation(t, ch.id, {});
    await h.owner.query(`UPDATE conversations SET priority = 'urgent' WHERE uuid = $1`, [u.uuid]);
    await setWaiting(u.uuid, waiting);
    await clock().start(t.orgId, u.uuid);
    expect((await dues(u.uuid)).first).toBe('2026-10-14T10:05:00.000Z');
    expect((await dues(u.uuid)).resolution).toBe('2026-10-14T14:00:00.000Z');
    expect(
      (
        (await api.as(manager.token).get('/v2/inbox/sla/policies')).body.data as Array<{
          id: string;
          conversationCount: number;
        }>
      ).find((p) => p.id === policyId)!.conversationCount,
    ).toBeGreaterThanOrEqual(2);
  });

  it('counts only business hours in the workspace time zone when the policy asks for it', async () => {
    const t2 = await api.signup('slh');
    const ch2 = await inbox.channel(t2.admin);
    const m2 = await api.member(t2, 'manager', MANAGE);
    await api.as(m2.token).post('/v2/inbox/sla/policies').send({
      name: 'Hours',
      firstResponseMinutes: 120,
      resolutionMinutes: 600,
      respectBusinessHours: true,
    });
    const days = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [
        d,
        { enabled: true, from: '09:00', to: '17:00' },
      ]),
    );
    // The zone is the one the owner sets on the workspace (organizations.settings), not workspace_settings.timezone.
    await h.owner.query(
      `INSERT INTO workspace_settings (org_id, business_hours) VALUES ($1, $2::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET business_hours = $2::jsonb`,
      [t2.orgId, JSON.stringify({ days })],
    );
    await h.owner.query(
      `UPDATE organizations SET settings = settings || '{"timezone":"Asia/Kolkata"}'::jsonb WHERE id = $1`,
      [t2.orgId],
    );
    const c = await inbox.conversation(t2, ch2.id, {});
    // Monday 12 October 2026 10:00Z is 15:30 in Kolkata: 90 minutes remain today, 30 carry to Tuesday 09:00 IST (03:30Z)
    await setWaiting(c.uuid, '2026-10-12T10:00:00.000Z');
    await clock().start(t2.orgId, c.uuid);
    expect((await dues(c.uuid)).first).toBe('2026-10-13T04:00:00.000Z');
  });

  it('starts nothing without a default policy, without targets, or on a plan without inbox_sla', async () => {
    const t3 = await api.signup('sln');
    const ch3 = await inbox.channel(t3.admin);
    const c = await inbox.conversation(t3, ch3.id, {});
    expect(await clock().start(t3.orgId, c.uuid)).toEqual({ started: false, reason: 'no_policy' });
    expect(await clock().start(t3.orgId, '00000000-0000-4000-8000-000000000000')).toMatchObject({
      started: false,
    });
    const m3 = await api.member(t3, 'manager', MANAGE);
    await api.as(m3.token).post('/v2/inbox/sla/policies').send({ name: 'Empty' });
    expect(await clock().start(t3.orgId, c.uuid)).toEqual({ started: false, reason: 'no_targets' });
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
      [t3.orgId, JSON.stringify({ features: { inbox_sla: false } })],
    );
    expect(await clock().start(t3.orgId, c.uuid)).toEqual({ started: false, reason: 'plan' });
  });

  it('the inbound listener starts a clock for a new conversation and for one reopened after it was finished, not for a live thread', async () => {
    const listener = new SlaInboundListener({ register: () => undefined } as never, clock());
    const event = (uuid: string, over: Record<string, unknown>) =>
      ({
        orgId: t.orgId,
        conversationUuid: uuid,
        messageUuid: `m-${uuid}`,
        createdConversation: false,
        message: { kind: 'text', body: 'hi', meta: {}, location: null, mediaKey: null },
        ...over,
      }) as never;

    const live = await inbox.conversation(t, ch.id, {});
    await setWaiting(live.uuid, minutesAgo(1));
    await listener.onStored(event(live.uuid, {}));
    expect((await dues(live.uuid)).first).toBeNull();
    await listener.onStored(event(live.uuid, { reopenedFrom: 'snoozed' }));
    expect((await dues(live.uuid)).first).toBeNull();

    await listener.onStored(event(live.uuid, { createdConversation: true }));
    expect((await dues(live.uuid)).first).not.toBeNull();

    const done = await inbox.conversation(t, ch.id, { status: 'open' });
    await seedClock(done.uuid, { first: minutesAgo(500), resolution: minutesAgo(400) });
    await h.owner.query(`UPDATE conversations SET sla_breached = true WHERE uuid = $1`, [
      done.uuid,
    ]);
    await setWaiting(done.uuid, minutesAgo(1));
    await listener.onStored(event(done.uuid, { reopenedFrom: 'resolved' }));
    const after = await dues(done.uuid);
    expect(after.breached).toBe(false);
    expect(Date.parse(after.first!)).toBeGreaterThan(Date.now());
  });

  it('the sweep flags a first-response breach once: timeline, outbox, the list badge, and a second pass changes nothing', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    await seedClock(c.uuid, {
      first: minutesAgo(5),
      resolution: minutesAhead(600),
      waiting: minutesAgo(40),
    });
    const r1 = await sweeper().sweep();
    expect(r1.breached).toBeGreaterThanOrEqual(1);
    expect((await dues(c.uuid)).breached).toBe(true);
    const events = (await api.as(manager.token).get(`/v2/inbox/conversations/${c.uuid}/events`))
      .body.data as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.filter((e) => e.type === 'sla_breach')).toHaveLength(1);
    expect(events.find((e) => e.type === 'sla_breach')!.payload).toMatchObject({
      kind: 'first_response',
    });
    expect(
      (await api.events(t.orgId, 'conversation.sla_breached')).filter(
        (e) => e.conversationId === c.uuid,
      ),
    ).toHaveLength(1);

    const row = (await api.as(manager.token).get(`/v2/inbox/conversations/${c.uuid}`)).body;
    expect(row.slaStatus).toMatchObject({ state: 'breached', kind: 'first_response' });

    await sweeper().sweep();
    expect(
      (await api.events(t.orgId, 'conversation.sla_breached')).filter(
        (e) => e.conversationId === c.uuid,
      ),
    ).toHaveLength(1);
  });

  it('the sweep flags a resolution breach, and leaves alone what it must: not due, snoozed, finished, spam', async () => {
    const due = await inbox.conversation(t, ch.id, {});
    await seedClock(due.uuid, { resolution: minutesAgo(3) });
    const future = await inbox.conversation(t, ch.id, {});
    await seedClock(future.uuid, {
      first: minutesAhead(20),
      resolution: minutesAhead(100),
      waiting: minutesAgo(5),
    });
    const snoozed = await inbox.conversation(t, ch.id, { status: 'snoozed' });
    await seedClock(snoozed.uuid, { resolution: minutesAgo(30) });
    const resolved = await inbox.conversation(t, ch.id, { status: 'resolved' });
    await seedClock(resolved.uuid, { resolution: minutesAgo(30) });
    const spam = await inbox.conversation(t, ch.id, { status: 'spam' });
    await seedClock(spam.uuid, { resolution: minutesAgo(30) });
    await sweeper().sweep();
    expect((await dues(due.uuid)).breached).toBe(true);
    expect(
      (await api.as(manager.token).get(`/v2/inbox/conversations/${due.uuid}/events`)).body.data[0],
    ).toMatchObject({
      type: 'sla_breach',
      payload: { kind: 'resolution' },
    });
    for (const c of [future, snoozed, resolved, spam]) {
      expect((await dues(c.uuid)).breached, c.uuid).toBe(false);
    }
  });

  it('an answered first-response clock is closed with a first_response event: in time is no breach, late is one', async () => {
    const inTime = await inbox.conversation(t, ch.id, {});
    await seedClock(inTime.uuid, { first: minutesAhead(10), resolution: minutesAhead(300) });
    await h.owner.query(`UPDATE conversations SET last_outbound_at = now() WHERE uuid = $1`, [
      inTime.uuid,
    ]);
    const late = await inbox.conversation(t, ch.id, {});
    await seedClock(late.uuid, { first: minutesAgo(20), resolution: minutesAhead(300) });
    await h.owner.query(`UPDATE conversations SET last_outbound_at = now() WHERE uuid = $1`, [
      late.uuid,
    ]);
    await sweeper().sweep();

    const a = (await api.as(manager.token).get(`/v2/inbox/conversations/${inTime.uuid}/events`))
      .body.data as Array<{
      type: string;
      payload: Record<string, unknown>;
    }>;
    expect(a.find((e) => e.type === 'first_response')!.payload).toMatchObject({ withinSla: true });
    expect(a.some((e) => e.type === 'sla_breach')).toBe(false);
    expect((await dues(inTime.uuid)).first).toBeNull();
    expect((await dues(inTime.uuid)).breached).toBe(false);

    const b = (await api.as(manager.token).get(`/v2/inbox/conversations/${late.uuid}/events`)).body
      .data as Array<{
      type: string;
      payload: Record<string, unknown>;
    }>;
    expect(b.find((e) => e.type === 'first_response')!.payload).toMatchObject({ withinSla: false });
    expect(b.find((e) => e.type === 'sla_breach')!.payload).toMatchObject({
      kind: 'first_response',
    });
    expect((await dues(late.uuid)).breached).toBe(true);
  });

  it('a workspace whose plan lost inbox_sla is not swept', async () => {
    const t4 = await api.signup('slx');
    const ch4 = await inbox.channel(t4.admin);
    const c = await inbox.conversation(t4, ch4.id, {});
    await seedClock(c.uuid, { resolution: minutesAgo(10) });
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
      [t4.orgId, JSON.stringify({ features: { inbox_sla: false } })],
    );
    await sweeper().sweep();
    expect((await dues(c.uuid)).breached).toBe(false);
  });

  it('the breach notification goes to the assignee, else the team, else the SLA managers, once per event', async () => {
    const agent = await api.member(t, 'owner1', AGENT);
    const consumer = new SlaNotificationConsumer(
      get(DatabaseService),
      get(OutboxSubscriberRegistry),
      get(MemberDirectory),
      get(PlanEntitlementService),
      new NotificationFanout(
        new NotificationsRepository(),
        new NotificationPrefsResolver(get(DatabaseService)),
        // The live push is not what is tested here: the rows are.
        new Proxy({}, { get: () => async () => undefined }) as never,
      ),
    );
    const assigned = await inbox.conversation(t, ch.id, { assigneeUserId: agent.userId });
    const nobody = await inbox.conversation(t, ch.id, {});
    const ev = (uuid: string, id: string) =>
      ({
        id,
        orgId: t.orgId,
        eventType: 'conversation.sla_breached',
        payload: { conversationId: uuid, kind: 'first_response', dueAt: new Date().toISOString() },
      }) as never;
    await consumer.handle(ev(assigned.uuid, '9001'));
    await consumer.handle(ev(assigned.uuid, '9001'));
    await consumer.handle(ev(nobody.uuid, '9002'));

    const rows = await h.owner.query(
      `SELECT user_id, type, subject_uuid, title FROM inbox_notifications WHERE org_id = $1 AND type = 'sla_breached' ORDER BY id`,
      [t.orgId],
    );
    const forAssigned = rows.rows.filter((r) => r.subject_uuid === assigned.uuid);
    expect(forAssigned.map((r) => Number(r.user_id))).toEqual([agent.userId]);
    const forNobody = rows.rows
      .filter((r) => r.subject_uuid === nobody.uuid)
      .map((r) => Number(r.user_id));
    expect(forNobody).toContain(manager.userId);
    expect(forNobody).not.toContain(agent.userId);
  });
});
