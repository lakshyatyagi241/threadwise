import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { QUEUES } from '../../../src/infra/queue/queues';
import type { OutboxEvent } from '../../../src/kernel/outbox/outbox-subscribers';
import { CalendarBackfillConsumer } from '../../../src/modules/appointments-booking/calendar-backfill.consumer';
import { CalendarBackfillService } from '../../../src/modules/appointments-booking/calendar-backfill.service';
import { AppointmentCalendarConsumer } from '../../../src/modules/appointments-booking/appointment-calendar.consumer';
import { FakeMicrosoft } from './fake-microsoft';
import { AppointmentsApi, startHarness, type Harness, type Tenant } from './support';

/**
 * Back-fill of calendar events after a reconnect (BL-035), through the real service, queue and consumer. The calendar is the Microsoft
 * stand-in (`fake-microsoft.ts`); nothing here talks to a real Microsoft tenant.
 */
let h: Harness;
let api: AppointmentsApi;
let ms: FakeMicrosoft;
let backfill: CalendarBackfillService;
let consumer: CalendarBackfillConsumer;
let calendarConsumer: AppointmentCalendarConsumer;
let queue: Queue;
let a: Tenant;
const saved: Record<string, string | undefined> = {};
const ENV = [
  'MICROSOFT_CALENDAR_CLIENT_ID',
  'MICROSOFT_CALENDAR_CLIENT_SECRET',
  'MICROSOFT_CALENDAR_BUSY_CACHE_SECONDS',
  'MICROSOFT_CALENDAR_RETRIES',
];
const RETURN = '/appointments/settings';
const CALLBACK = '/v2/public/appointments/calendar/microsoft/callback';

beforeAll(async () => {
  ms = await FakeMicrosoft.start();
  for (const k of [...ENV, ...Object.keys(ms.env())]) saved[k] = process.env[k];
  Object.assign(process.env, ms.env(), {
    MICROSOFT_CALENDAR_CLIENT_ID: ms.clientId,
    MICROSOFT_CALENDAR_CLIENT_SECRET: ms.clientSecret,
    MICROSOFT_CALENDAR_BUSY_CACHE_SECONDS: '0',
    MICROSOFT_CALENDAR_RETRIES: '0',
  });
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/appointments-booking/appointments-booking-worker.module'))
        .AppointmentsBookingWorkerModule,
    ],
  });
  api = new AppointmentsApi(h);
  backfill = h.app.get(CalendarBackfillService);
  consumer = h.app.get(CalendarBackfillConsumer);
  calendarConsumer = h.app.get(AppointmentCalendarConsumer);
  queue = h.app.get(getQueueToken(QUEUES.CALENDAR_BACKFILL));
  // The real processor is registered by the worker module, and it would run the jobs the tests only want to SEE queued: paused, they just wait.
  await queue.obliterate({ force: true });
  await queue.pause();
  a = await api.signup('bfl');
}, 300_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await queue?.obliterate({ force: true }).catch(() => undefined);
  await h?.stop();
  await ms?.stop();
});

// --- helpers ---------------------------------------------------------------------------------------------------------

async function connect(t: Tenant, codeName: string, email: string): Promise<void> {
  const start = await api.post(t.admin, '/v2/appointments/calendar/microsoft/start', {
    returnTo: RETURN,
  });
  const state = new URL(start.body.url as string).searchParams.get('state')!;
  ms.grant(codeName, ms.account(email));
  const res = await request(h.app.getHttpServer())
    .get(CALLBACK)
    .query({ code: codeName, state })
    .redirects(0);
  const ticket = new URL(res.headers.location as string).searchParams.get('ticket')!;
  const done = await api.post(t.admin, '/v2/appointments/calendar/microsoft/confirm', { ticket });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  expect(done.body.outcome).toBe('connected');
}

const eventsOf = (email: string) => ms.eventsOf(`default-oid-${email}`);

async function book(t: Tenant, name: string, startInHours: number, status?: 'cancelled') {
  const type = await api.type(t.admin, { name, maxAdvanceDays: 365 });
  const slots = await api.slots(t.admin, type.id);
  const appt = await api.staffBook(t.admin, {
    bookingTypeId: type.id,
    startsAt: slots[0]!.start,
    invitee: {
      name: `Guest ${name}`,
      phone: `+9198222${String(Math.floor(Math.random() * 90000) + 10000)}`,
    },
  });
  // Arranging only: the time is moved straight in the table so the test controls what is upcoming, past or far away.
  await api.moveTo(appt.id, startInHours);
  if (status === 'cancelled') {
    const res = await api.post(t.admin, `/v2/appointments/${appt.id}/cancel`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  return appt;
}

const row = async (id: string) => api.rowOf(id);

async function outboxEvent(orgId: number, type: string): Promise<OutboxEvent> {
  const res = await h.owner.query(
    `SELECT id::text AS id, org_id, aggregate_module, aggregate_id::text AS aggregate_id, event_type, payload
       FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY event_outbox.id DESC LIMIT 1`,
    [orgId, type],
  );
  const r = res.rows[0]!;
  return {
    id: r.id as string,
    orgId: Number(r.org_id),
    aggregateModule: r.aggregate_module as string,
    aggregateId: r.aggregate_id as string,
    eventType: r.event_type as string,
    payload: r.payload as Record<string, unknown>,
  };
}

// --- the scenario ----------------------------------------------------------------------------------------------------

describe('bookings made while no calendar was connected', () => {
  let soon: Awaited<ReturnType<typeof book>>;
  let later: Awaited<ReturnType<typeof book>>;
  let farAway: Awaited<ReturnType<typeof book>>;
  let past: Awaited<ReturnType<typeof book>>;
  let cancelled: Awaited<ReturnType<typeof book>>;
  let pending: Awaited<ReturnType<typeof book>>;

  beforeAll(async () => {
    soon = await book(a, 'Soon', 3);
    later = await book(a, 'Later', 24 * 30);
    farAway = await book(a, 'Far away', 24 * 120);
    past = await book(a, 'Past', -48);
    cancelled = await book(a, 'Cancelled', 5, 'cancelled');
    pending = await book(a, 'Pending', 6);
    await h.owner.query(`UPDATE appointments SET status = 'pending' WHERE uuid = $1`, [pending.id]);
  });

  it('have no event, and nothing is pending while there is nowhere to write', async () => {
    for (const x of [soon, later, farAway, past, cancelled, pending]) {
      expect((await row(x.id)).calendar_event_id).toBeNull();
    }
    const none = await backfill.backfillOrg(a.orgId);
    expect(none).toMatchObject({ outcome: 'not_connected', written: 0 });
    expect(await backfill.pending(a.orgId)).toBe(0);
  });

  it('connecting queues a back-fill through the outbox consumer, once however many events say so', async () => {
    await connect(a, 'bf-1', 'ana@contoso.example');
    const ev = await outboxEvent(a.orgId, 'appointment_calendar.connected');
    await consumer.handle(ev);
    await consumer.handle(ev);
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs.filter((j) => j.data.orgId === a.orgId)).toHaveLength(1);
    expect(jobs[0]!.id).toBe(`calendar-backfill-${a.orgId}`);
    expect(jobs[0]!.data).toMatchObject({ orgId: a.orgId });
  });

  it('writes the missing events of the upcoming CONFIRMED bookings within the horizon, and only those', async () => {
    const overview = await api.as(a.admin).get('/v2/appointments/calendar/overview');
    expect(overview.body.backfillPending).toBe(2); // soon, later
    const before = eventsOf('ana@contoso.example').length;
    const report = await backfill.backfillOrg(a.orgId);
    expect(report).toMatchObject({
      outcome: 'ok',
      looked: 2,
      written: 2,
      failed: 0,
      moreWaiting: false,
    });
    expect(eventsOf('ana@contoso.example')).toHaveLength(before + 2);
    for (const x of [soon, later]) {
      expect(await row(x.id)).toMatchObject({ calendar_provider: 'microsoft' });
      expect((await row(x.id)).calendar_event_id).toBeTruthy();
    }
    // Not yet needed (beyond 90 days), over, cancelled, or not a commitment yet (pending).
    for (const x of [farAway, past, cancelled, pending]) {
      expect((await row(x.id)).calendar_event_id).toBeNull();
    }
    expect(await api.auditCount(a.orgId, 'appointment_calendar_backfill', 'update')).toBe(1);
    const events = await h.owner.query(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'appointment_calendar.backfilled'`,
      [a.orgId],
    );
    expect(events.rows[0].payload).toMatchObject({ provider: 'microsoft', written: 2, failed: 0 });
    // The summary carries counts, never a name, an address or a link.
    expect(JSON.stringify(events.rows[0].payload)).not.toMatch(/Guest|@|http/);
  });

  it('is idempotent: a second pass finds nothing to do, and writes nothing', async () => {
    const calls = ms.count('POST', /\/events$/);
    const again = await backfill.backfillOrg(a.orgId);
    expect(again).toMatchObject({ outcome: 'ok', looked: 0, written: 0 });
    expect(ms.count('POST', /\/events$/)).toBe(calls);
    expect(await backfill.pending(a.orgId)).toBe(0);
    expect(await api.auditCount(a.orgId, 'appointment_calendar_backfill', 'update')).toBe(1);
  });

  it('a booking whose own outbox event is being delivered meanwhile still ends with ONE event (the write is idempotent)', async () => {
    const x = await book(a, 'Racing', 8);
    const ev = await outboxEvent(a.orgId, 'appointment.booked');
    expect(ev.payload.uuid).toBe(x.id);
    const before = eventsOf('ana@contoso.example').length;
    await Promise.all([backfill.backfillOrg(a.orgId), calendarConsumer.handle(ev)]);
    expect(eventsOf('ana@contoso.example')).toHaveLength(before + 1);
    expect(eventsOf('ana@contoso.example').filter((e) => e.transactionId === x.id)).toHaveLength(1);
  });

  it('a booking cancelled after the pass queued is never written', async () => {
    const x = await book(a, 'Cancel race', 9);
    const res = await api.post(a.admin, `/v2/appointments/${x.id}/cancel`, {});
    expect(res.status).toBe(200);
    const before = eventsOf('ana@contoso.example').length;
    await backfill.backfillOrg(a.orgId);
    expect(eventsOf('ana@contoso.example')).toHaveLength(before);
    expect((await row(x.id)).calendar_event_id).toBeNull();
  });
});

describe('a pass stops where it should', () => {
  it('a calendar that cannot be asked stops the pass and throws (so the queue retries), keeping what was written', async () => {
    const b = await api.signup('bfm');
    await connect(b, 'bf-2', 'bea@contoso.example');
    const first = await book(b, 'First', 2);
    const second = await book(b, 'Second', 3);
    const third = await book(b, 'Third', 4);
    // Arranged: nothing was written for these three (as if they were made while the calendar was down).
    await h.owner.query(
      `UPDATE appointments SET calendar_event_id = NULL, calendar_provider = NULL WHERE org_id = $1`,
      [b.orgId],
    );
    ms.failNext('POST', /\/events$/, 503, { times: 100 });
    await expect(backfill.backfillOrg(b.orgId)).rejects.toMatchObject({ kind: 'server' });
    ms.clearFailures();
    expect((await row(first.id)).calendar_event_id).toBeNull();
    const done = await backfill.backfillOrg(b.orgId);
    expect(done).toMatchObject({ written: 3, failed: 0 });
    for (const x of [first, second, third])
      expect((await row(x.id)).calendar_event_id).toBeTruthy();
  });

  it('one booking the calendar refuses is counted and the pass goes on; five refused in a row end the pass', async () => {
    const c = await api.signup('bfn');
    await connect(c, 'bf-3', 'cy@contoso.example');
    const made = [];
    for (let i = 0; i < 7; i += 1) made.push(await book(c, `Many ${i}`, 2 + i));
    await h.owner.query(
      `UPDATE appointments SET calendar_event_id = NULL, calendar_provider = NULL WHERE org_id = $1`,
      [c.orgId],
    );
    // One booking is refused as a bad request; the others go through.
    ms.failNext('POST', /\/events$/, 400, { times: 1 });
    const report = await backfill.backfillOrg(c.orgId);
    expect(made).toHaveLength(7);
    expect(report).toMatchObject({ looked: 7, failed: 1, written: 6 });

    // A refusal that is the account's, not the booking's: it ends the pass after five.
    await h.owner.query(
      `UPDATE appointments SET calendar_event_id = NULL, calendar_provider = NULL WHERE org_id = $1`,
      [c.orgId],
    );
    ms.failNext('POST', /\/events$/, 403, {
      times: 100,
      body: { error: { code: 'ErrorAccessDenied' } },
    });
    const stuck = await backfill.backfillOrg(c.orgId);
    ms.clearFailures();
    expect(stuck.failed).toBe(5);
    expect(stuck.written).toBe(0);
    expect(stuck.moreWaiting).toBe(false);
  });

  it('a pass is bounded: it stops at its limit and hands the rest to the next, from where it stopped', async () => {
    const d = await api.signup('bfo');
    await connect(d, 'bf-4', 'di@contoso.example');
    for (let i = 0; i < 5; i += 1) await book(d, `Bound ${i}`, 2 + i);
    await h.owner.query(
      `UPDATE appointments SET calendar_event_id = NULL, calendar_provider = NULL WHERE org_id = $1`,
      [d.orgId],
    );
    const first = await backfill.backfillOrg(d.orgId, null, new Date(), 2);
    expect(first).toMatchObject({ looked: 2, written: 2, moreWaiting: true });
    expect(first.next).not.toBeNull();
    const second = await backfill.backfillOrg(d.orgId, first.next, new Date(), 2);
    expect(second).toMatchObject({ looked: 2, written: 2, moreWaiting: true });
    const third = await backfill.backfillOrg(d.orgId, second.next, new Date(), 2);
    expect(third).toMatchObject({ looked: 1, written: 1, moreWaiting: false, next: null });
    expect(await backfill.pending(d.orgId)).toBe(0);
  });
});

describe('another account replaces the first', () => {
  it('the events left behind in the old account are forgotten, and the back-fill writes them into the new one', async () => {
    const e = await api.signup('bfp');
    await connect(e, 'bf-5', 'eve@contoso.example');
    const x = await book(e, 'Moves house', 3);
    await calendarConsumer.handle(await outboxEvent(e.orgId, 'appointment.booked'));
    expect((await row(x.id)).calendar_event_id).toBeTruthy();
    expect(eventsOf('eve@contoso.example')).toHaveLength(1);

    await connect(e, 'bf-6', 'finn@contoso.example');
    // Detached when the other account was confirmed: nothing points at an event the workspace can no longer reach.
    expect((await row(x.id)).calendar_event_id).toBeNull();
    expect(await backfill.pending(e.orgId)).toBe(1);

    const report = await backfill.backfillOrg(e.orgId);
    expect(report).toMatchObject({ written: 1 });
    expect(eventsOf('finn@contoso.example')).toHaveLength(1);
    expect(eventsOf('eve@contoso.example')).toHaveLength(1); // the old account's event is untouched: it is not ours to reach any more
  });
});

describe('asking for a back-fill', () => {
  it('"write them now" queues one job and says how many bookings were waiting; with nothing connected it queues nothing', async () => {
    const none = await api.signup('bfq');
    const idle = await api.post(none.admin, '/v2/appointments/calendar/backfill');
    expect(idle.status).toBe(200);
    expect(idle.body).toEqual({ queued: false, pending: 0 });

    await connect(none, 'bf-7', 'gus@contoso.example');
    await book(none, 'Waiting', 4);
    await h.owner.query(
      `UPDATE appointments SET calendar_event_id = NULL, calendar_provider = NULL WHERE org_id = $1`,
      [none.orgId],
    );
    const res = await api.post(none.admin, '/v2/appointments/calendar/backfill');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ queued: true, pending: 1 });
    const twice = await api.post(none.admin, '/v2/appointments/calendar/backfill');
    expect(twice.body.queued).toBe(true);
    const jobs = (await queue.getJobs(['waiting', 'delayed', 'active'])).filter(
      (j) => j.data.orgId === none.orgId,
    );
    expect(jobs).toHaveLength(1);
  });

  it("needs the booking-settings capability, and is the workspace's own", async () => {
    const agent = await api.member(a, 'agent', [['record.appointments.read']]);
    expect((await api.as(agent.token).post('/v2/appointments/calendar/backfill')).status).toBe(403);
    const other = await api.signup('bfr');
    const seen = await api.as(other.admin).get('/v2/appointments/calendar/overview');
    expect(seen.body.backfillPending).toBe(0);
  });

  it('the consumer listens to a connect and to a change of provider, and to nothing else', () => {
    expect([...consumer.eventTypes]).toEqual([
      'appointment_calendar.connected',
      'appointment_calendar.provider_selected',
    ]);
  });
});

describe('a workspace that disconnected', () => {
  it('a disconnected workspace writes nothing and reports not_connected', async () => {
    const f = await api.signup('bfs');
    await connect(f, 'bf-8', 'hal@contoso.example');
    await book(f, 'Orphan', 3);
    await h.owner.query(
      `UPDATE appointments SET calendar_event_id = NULL, calendar_provider = NULL WHERE org_id = $1`,
      [f.orgId],
    );
    expect((await api.post(f.admin, '/v2/appointments/calendar/microsoft/disconnect')).status).toBe(
      200,
    );
    expect(await backfill.backfillOrg(f.orgId)).toMatchObject({
      outcome: 'not_connected',
      written: 0,
    });
  });
});
