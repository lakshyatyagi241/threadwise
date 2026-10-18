import { AppointmentCalendarWriter } from '../../../src/modules/appointments-booking/appointment-calendar-writer.service';
import { AppointmentMeetingMirror } from '../../../src/modules/appointments-booking/appointment-meeting-mirror.service';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type {
  AppointmentMessenger,
  BookingMessage,
  BookingMessageResult,
  CalendarEventRequest,
  CalendarSyncPort,
} from '../../../src/infra/providers/appointments-booking';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
} from '../../../src/kernel/outbox/outbox-subscribers';
import { AppointmentCalendarConsumer } from '../../../src/modules/appointments-booking/appointment-calendar.consumer';
import { AppointmentLifecycleSweepService } from '../../../src/modules/appointments-booking/appointment-lifecycle-sweep.service';
import { AppointmentMessageConsumer } from '../../../src/modules/appointments-booking/appointment-message.consumer';
import { AppointmentReminderService } from '../../../src/modules/appointments-booking/appointment-reminder.service';
import { AppointmentReminderSweepService } from '../../../src/modules/appointments-booking/appointment-reminder-sweep.service';
import { AppointmentRemindersRepository } from '../../../src/modules/appointments-booking/appointment-reminders.repository';
import { AuditService } from '../../../src/kernel/audit/audit.service';
import { ContactActivitiesRepository } from '../../../src/modules/crm';
import { AppointmentsRepository } from '../../../src/modules/appointments-booking/appointments.repository';
import { AppointmentsSupport } from '../../../src/modules/appointments-booking/appointments.support';
import { BookingService } from '../../../src/modules/appointments-booking/booking.service';
import { BookingTypesRepository } from '../../../src/modules/appointments-booking/booking-types.repository';
import { SlotsService } from '../../../src/modules/appointments-booking/slots.service';
import {
  AppointmentsApi,
  startHarness,
  type Appointment,
  type Harness,
  type Tenant,
} from './support';

/**
 * The worker side of appointments (TW-APPT-030..032, D-13, D-14, EXT-APPT-08): the reminder sweep (idempotent, per offset, re-armed by a
 * reschedule), the lifecycle sweep, and the consumers that turn booking events into customer messages and calendar events through the
 * two ports. The HTTP app does not run the sweeps (they are worker-process services), so each is built here from the app's own parts,
 * as the task and sales-document sweeps are tested; the outbox events they read are the real rows the API wrote.
 */
let h: Harness;
let api: AppointmentsApi;
let db: DatabaseService;
let reminders: AppointmentReminderSweepService;
let reminderService: AppointmentReminderService;
/** What the reminder delivery hands to the customer messenger: a fake, no real WhatsApp, SMS or email provider is ever called. */
let reminderMessenger: FakeMessenger;
let lifecycle: AppointmentLifecycleSweepService;
let typesRepo: BookingTypesRepository;
let apptsRepo: AppointmentsRepository;
let support: AppointmentsSupport;

beforeAll(async () => {
  h = await startHarness();
  api = new AppointmentsApi(h);
  db = h.app.get(DatabaseService);
  typesRepo = h.app.get(BookingTypesRepository);
  apptsRepo = h.app.get(AppointmentsRepository);
  support = h.app.get(AppointmentsSupport);
  reminderMessenger = new FakeMessenger();
  reminderService = new AppointmentReminderService(
    db,
    h.app.get(AppointmentRemindersRepository),
    apptsRepo,
    typesRepo,
    support,
    h.app.get(AuditService),
    h.app.get(OutboxService),
    h.app.get(ContactActivitiesRepository),
    reminderMessenger,
  );
  reminders = new AppointmentReminderSweepService(
    db,
    h.app.get(OutboxService),
    h.app.get(AppointmentRemindersRepository),
    reminderService,
  );
  lifecycle = new AppointmentLifecycleSweepService(db, apptsRepo, h.app.get(BookingService));
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const DAY3 = 3 * 86_400_000;

/** The real outbox rows, as the drain hands them to a subscriber. */
async function outbox(orgId: number, type: string, uuid?: string): Promise<OutboxEvent[]> {
  const res = await h.owner.query(
    `SELECT id::text AS id, org_id, aggregate_module, aggregate_id::text AS aggregate_id, event_type, payload
       FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
    [orgId, type],
  );
  return res.rows
    .map((r) => ({
      id: r.id,
      orgId: Number(r.org_id),
      aggregateModule: r.aggregate_module,
      aggregateId: r.aggregate_id,
      eventType: r.event_type,
      payload: r.payload,
    }))
    .filter((e) => !uuid || e.payload.uuid === uuid);
}

/** A booking arranged straight in the table: starts `startInMin` from now, was made `madeAgoMin` ago. */
async function arrange(
  id: string,
  startInMin: number,
  madeAgoMin: number | null,
  durationMin = 30,
): Promise<void> {
  // `null` keeps the booking's arming: only a reschedule moves `armed_at` in real life, and a moved arming is a new claim.
  await h.owner.query(
    `UPDATE appointments SET starts_at = now() + ($2 || ' minutes')::interval,
                             ends_at = now() + ($2 || ' minutes')::interval + ($3 || ' minutes')::interval,
                             armed_at = CASE WHEN $4::text IS NULL THEN armed_at ELSE now() - ($4 || ' minutes')::interval END
     WHERE uuid = $1`,
    [id, String(startInMin), String(durationMin), madeAgoMin === null ? null : String(madeAgoMin)],
  );
}

describe('the reminder sweep (TW-APPT-030, D-14)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('wrs');
  });

  async function book(
    name: string,
    reminderOffsets: Array<{
      offsetMinutes: number;
      isActive?: boolean;
      kind?: 'before' | 'after';
    }>,
  ) {
    // A rule is created OFF; these tests are about rules that are on.
    const type = await api.type(t.admin, {
      name,
      reminders: reminderOffsets.map((r) => ({ isActive: true, ...r })),
    });
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      invitee: { name: 'R', phone: `+9198111${Math.floor(10000 + Math.random() * 89999)}` },
    });
    return { type, a };
  }

  it('claims each due offset once and announces it; an inactive offset and a not-yet-due one are left alone; a second pass claims nothing', async () => {
    const { a } = await book('Remind A', [
      { offsetMinutes: 1440 },
      { offsetMinutes: 60 },
      { offsetMinutes: 30, isActive: false },
      { offsetMinutes: 10 },
    ]);
    // Starts in 30 minutes; the booking was made 24 hours ago: 1440 and 60 are due, 10 is not yet, 30 is switched off.
    await arrange(a.id, 30, 24 * 60);
    expect(await reminders.sweep()).toBe(2);
    const events = await outbox(t.orgId, 'appointment.reminder_due', a.id);
    expect(
      events.map((e) => e.payload.offsetMinutes).sort((x, y) => Number(x) - Number(y)),
    ).toEqual([60, 1440]);
    expect(events[0]!.payload).toMatchObject({ uuid: a.id, timezone: 'UTC' });
    expect(JSON.stringify(events)).not.toMatch(/R —|phone|\+9198/);
    expect(await reminders.sweep()).toBe(0);
    expect(await outbox(t.orgId, 'appointment.reminder_due', a.id)).toHaveLength(2);
    // Ten minutes before, the third offset comes due.
    await arrange(a.id, 9, null);
    expect(await reminders.sweep()).toBe(1);
    expect(
      (await outbox(t.orgId, 'appointment.reminder_due', a.id)).map((e) => e.payload.offsetMinutes),
    ).toContain(10);
    // The claims are rows, one per (appointment, offset).
    const runs = await h.owner.query(
      `SELECT offset_minutes FROM appointment_reminder_runs WHERE org_id = $1 ORDER BY offset_minutes`,
      [t.orgId],
    );
    expect(runs.rows.map((r) => r.offset_minutes)).toEqual([10, 60, 1440]);
  });

  it("Reference's rule: a booking made inside a reminder's window never gets that reminder", async () => {
    const { a } = await book('Remind B', [{ offsetMinutes: 1440 }, { offsetMinutes: 60 }]);
    // Made two hours ago for a start in 30 minutes: the 24-hour reminder's time was before the booking existed, so it is skipped for
    // good; the 60-minute one came after it and is due.
    await arrange(a.id, 30, 120);
    expect(await reminders.sweep()).toBe(1);
    const got = await outbox(t.orgId, 'appointment.reminder_due', a.id);
    expect(got.map((e) => e.payload.offsetMinutes)).toEqual([60]);
    await arrange(a.id, 5, null);
    expect(await reminders.sweep()).toBe(0);
    // And a booking made after the 60-minute reminder's time (made now, starting in 30 minutes) gets neither.
    const { a: late } = await book('Remind B2', [{ offsetMinutes: 1440 }, { offsetMinutes: 60 }]);
    await arrange(late.id, 30, 0);
    expect(await reminders.sweep()).toBe(0);
  });

  it('only a confirmed booking that has not started is reminded: not pending, cancelled, started or finished ones', async () => {
    const { a: pendingLike } = await book('Remind C1', [{ offsetMinutes: 60 }]);
    const { a: cancelled } = await book('Remind C2', [{ offsetMinutes: 60 }]);
    const { a: started } = await book('Remind C3', [{ offsetMinutes: 60 }]);
    for (const a of [pendingLike, cancelled, started]) await arrange(a.id, 30, 600);
    await h.owner.query(`UPDATE appointments SET status = 'pending' WHERE uuid = $1`, [
      pendingLike.id,
    ]);
    await h.owner.query(`UPDATE appointments SET status = 'cancelled' WHERE uuid = $1`, [
      cancelled.id,
    ]);
    await h.owner.query(
      `UPDATE appointments SET starts_at = now() - interval '10 minutes', ends_at = now() + interval '20 minutes' WHERE uuid = $1`,
      [started.id],
    );
    expect(await reminders.sweep()).toBe(0);
  });

  it('a reschedule stops what was waiting and arms every offset again for the new time (D-14)', async () => {
    const { type, a } = await book('Remind D', [{ offsetMinutes: 60 }]);
    await arrange(a.id, 30, 600);
    expect(await reminders.sweep()).toBe(1);
    const slots = await api.slots(t.admin, type.id);
    const moved = await api.post(t.admin, `/v2/appointments/${a.id}/reschedule`, {
      startsAt: slots[10]!.start,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const row = await api.rowOf(a.id);
    // The claim for the old time did not go out yet: it stays as history, cancelled because the booking moved.
    const old = await h.owner.query(
      `SELECT status, reason FROM appointment_reminder_runs WHERE appointment_id = $1`,
      [row.id],
    );
    expect(old.rows).toEqual([{ status: 'cancelled', reason: 'rescheduled' }]);
    // The new time is hours away: nothing is due, and the moment the reminder's time comes it fires once more.
    expect(await reminders.sweep()).toBe(0);
    await arrange(a.id, 30, 600);
    expect(await reminders.sweep()).toBe(1);
    expect(await outbox(t.orgId, 'appointment.reminder_due', a.id)).toHaveLength(2);
  });

  it('two workers sweeping at once announce each reminder exactly once', async () => {
    const made = [];
    for (let i = 0; i < 6; i++) made.push((await book(`Remind E${i}`, [{ offsetMinutes: 60 }])).a);
    for (const a of made) await arrange(a.id, 30, 600);
    const [x, y] = await Promise.all([reminders.sweep(), reminders.sweep()]);
    expect(x + y).toBe(6);
    for (const a of made)
      expect(await outbox(t.orgId, 'appointment.reminder_due', a.id)).toHaveLength(1);
  });

  it("spans every workspace: another organization's due reminder is announced under its own tenant", async () => {
    const other = await api.signup('wrs2');
    const type = await api.type(other.admin, {
      name: 'Other org',
      reminders: [{ offsetMinutes: 60, isActive: true }],
    });
    const slots = await api.slots(other.admin, type.id);
    const a = await api.staffBook(other.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      invitee: { name: 'O', phone: '+919811177701' },
    });
    await arrange(a.id, 30, 600);
    expect(await reminders.sweep()).toBe(1);
    expect(await outbox(other.orgId, 'appointment.reminder_due', a.id)).toHaveLength(1);
    expect(await outbox(t.orgId, 'appointment.reminder_due', a.id)).toHaveLength(0);
  });
});

describe('reminder rules and their delivery (BL-283)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('wrd');
    // The sweeps span every workspace: let go of what earlier describes of this file left claimable.
    await reminders.sweep();
    await reminders.deliver();
  });
  beforeEach(() => {
    reminderMessenger.sent = [];
    reminderMessenger.result = { status: 'sent' };
    reminderMessenger.byChannel = {};
  });

  type Rule = Record<string, unknown>;
  async function book(name: string, rules: Rule[], invitee?: Record<string, unknown>) {
    const type = await api.type(t.admin, { name, reminders: rules });
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      invitee: invitee ?? {
        name: 'Rita',
        phone: `+9198222${Math.floor(10000 + Math.random() * 89999)}`,
        email: `rita${Math.floor(Math.random() * 1e6)}@example.com`,
      },
    });
    return { type, a };
  }
  const runsOf = async (uuid: string) =>
    (
      await h.owner.query(
        `SELECT r.kind, r.offset_minutes, r.status, r.reason, r.channel, r.attempts, r.next_attempt_at
           FROM appointment_reminder_runs r JOIN appointments a ON a.org_id = r.org_id AND a.id = r.appointment_id
          WHERE a.uuid = $1 ORDER BY r.id`,
        [uuid],
      )
    ).rows;
  const timeline = async (uuid: string) =>
    (
      await h.owner.query(
        `SELECT c.title, c.body FROM contact_activities c JOIN appointments a ON a.org_id = c.org_id AND a.contact_id = c.contact_id
          WHERE a.uuid = $1 AND c.activity_type = 'appointment_reminder' ORDER BY c.id`,
        [uuid],
      )
    ).rows;

  it('a rule is created OFF: nothing is claimed or sent until someone switches it on', async () => {
    const { type, a } = await book('Off by default', [{ offsetMinutes: 60 }]);
    expect(type.reminders[0]).toMatchObject({ isActive: false, kind: 'before', body: null });
    expect(type.reminders[0].channels).toEqual(['whatsapp', 'sms', 'email']);
    await arrange(a.id, 30, 600);
    await reminders.sweep();
    await reminders.deliver();
    expect(await runsOf(a.id)).toEqual([]);
    expect(reminderMessenger.sent.filter((m) => m.appointmentId === a.id)).toEqual([]);
  });

  it('delivers a due reminder through the messenger once, records it on the run, the audit log, the timeline and the outbox', async () => {
    const { a } = await book('Deliver', [
      {
        offsetMinutes: 60,
        isActive: true,
        channels: ['sms', 'email'],
        body: 'Hi {{name}}, {{type}} at {{time}}. Cancel or move: {{manage_link}}',
      },
    ]);
    await arrange(a.id, 30, 600);
    expect(await reminders.sweep()).toBe(1);
    expect(await reminders.deliver()).toBe(1);

    expect(reminderMessenger.sent).toHaveLength(1);
    const m = reminderMessenger.sent[0]!;
    expect(m).toMatchObject({
      orgId: t.orgId,
      appointmentId: a.id,
      event: 'reminder',
      channel: 'sms',
      purpose: 'service',
    });
    expect(m.body).toMatch(/^Hi Rita, Deliver at \d{1,2}:\d{2} [AP]M\. Cancel or move: http/);
    expect(m.notAfter).toBe(new Date((await api.rowOf(a.id)).starts_at as string).toISOString());
    expect(m.idempotencyKey).toMatch(/^apptrem:/);

    const [run] = await runsOf(a.id);
    expect(run).toMatchObject({
      kind: 'before',
      offset_minutes: 60,
      status: 'sent',
      channel: 'sms',
    });
    expect(await timeline(a.id)).toEqual([{ title: 'Reminder sent on SMS', body: null }]);
    expect(JSON.stringify(await timeline(a.id))).not.toMatch(/Rita|\+9198|@example/);
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'appointment_reminder_runs'`,
      [t.orgId],
    );
    expect(audit.rows.some((r) => r.delta.status?.new === 'sent')).toBe(true);
    expect((await outbox(t.orgId, 'appointment.reminder_sent', a.id)).length).toBe(1);

    // Idempotent: nothing more to deliver, nothing more to claim, however often the sweep runs.
    expect(await reminders.deliver()).toBe(0);
    expect(await reminders.sweep()).toBe(0);
    expect(reminderMessenger.sent).toHaveLength(1);
  });

  it("tries the rule's channels in its order and uses the first that delivers, without a second copy", async () => {
    const { a } = await book('Fallback order', [
      { offsetMinutes: 60, isActive: true, channels: ['whatsapp', 'sms', 'email'] },
    ]);
    reminderMessenger.byChannel = {
      whatsapp: { status: 'skipped', reason: 'template_required' },
      sms: { status: 'skipped', reason: 'no_sender' },
    };
    await arrange(a.id, 30, 600);
    await reminders.sweep();
    await reminders.deliver();
    expect(reminderMessenger.sent.map((x) => x.channel)).toEqual(['whatsapp', 'sms', 'email']);
    expect((await runsOf(a.id))[0]).toMatchObject({ status: 'sent', channel: 'email' });
  });

  it('when no channel can deliver, the run says why (the most telling reason) and the timeline shows it', async () => {
    const { a } = await book('Nobody', [
      { offsetMinutes: 60, isActive: true, channels: ['sms', 'email'] },
    ]);
    reminderMessenger.byChannel = {
      sms: { status: 'skipped', reason: 'opted_out' },
      email: { status: 'skipped', reason: 'no_sender' },
    };
    await arrange(a.id, 30, 600);
    await reminders.sweep();
    await reminders.deliver();
    expect((await runsOf(a.id))[0]).toMatchObject({
      status: 'skipped',
      reason: 'opted_out',
      channel: null,
    });
    expect(await timeline(a.id)).toEqual([
      { title: 'Reminder not sent', body: 'The contact opted out.' },
    ]);
  });

  it('a hold (quiet hours) waits for its time, keeps the preference, and writes the timeline once', async () => {
    const { a } = await book('Held', [{ offsetMinutes: 60, isActive: true, channels: ['sms'] }]);
    const until = new Date(Date.now() + 2 * 3_600_000).toISOString();
    reminderMessenger.result = { status: 'held', reason: 'quiet_hours', holdUntil: until };
    await arrange(a.id, 30, 600);
    await reminders.sweep();
    await reminders.deliver();
    const [held] = await runsOf(a.id);
    expect(held).toMatchObject({ status: 'held', reason: 'quiet_hours', channel: 'sms' });
    expect(new Date(held.next_attempt_at).toISOString()).toBe(until);
    // Not due yet: the next pass leaves it alone.
    expect(await reminders.deliver()).toBe(0);
    // Its time comes, the quiet hours are still on: held again for the same reason, no second timeline entry.
    await h.owner.query(
      `UPDATE appointment_reminder_runs SET next_attempt_at = now() - interval '1 minute' WHERE org_id = $1`,
      [t.orgId],
    );
    await reminders.deliver();
    expect((await timeline(a.id)).length).toBe(1);
    // Then they end and it goes.
    reminderMessenger.result = { status: 'sent' };
    await h.owner.query(
      `UPDATE appointment_reminder_runs SET next_attempt_at = now() - interval '1 minute' WHERE org_id = $1`,
      [t.orgId],
    );
    await reminders.deliver();
    expect((await runsOf(a.id))[0]).toMatchObject({ status: 'sent', channel: 'sms' });
    expect((await timeline(a.id)).map((x) => x.title)).toEqual([
      'Reminder waiting',
      'Reminder sent on SMS',
    ]);
  });

  it('never sends after the start: a run that is only delivered once the booking began is skipped', async () => {
    const { a } = await book('Too late', [{ offsetMinutes: 60, isActive: true }]);
    await arrange(a.id, 30, 600);
    await reminders.sweep();
    await h.owner.query(
      `UPDATE appointments SET starts_at = now() - interval '5 minutes', ends_at = now() + interval '25 minutes' WHERE uuid = $1`,
      [a.id],
    );
    await reminders.deliver();
    expect(reminderMessenger.sent).toEqual([]);
    expect((await runsOf(a.id))[0]).toMatchObject({ status: 'skipped', reason: 'started' });
  });

  it('a booking cancelled stops its waiting reminders; a rule switched off between the claim and the send stops its run', async () => {
    const { a } = await book('Stopped', [
      { offsetMinutes: 60, isActive: true },
      { offsetMinutes: 30, isActive: true },
    ]);
    await arrange(a.id, 20, 600);
    expect(await reminders.sweep()).toBe(2);
    const cancel = await api.post(t.admin, `/v2/appointments/${a.id}/cancel`, { reason: 'test' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect((await runsOf(a.id)).map((r) => [r.status, r.reason])).toEqual([
      ['cancelled', 'booking_cancelled'],
      ['cancelled', 'booking_cancelled'],
    ]);
    expect(await reminders.deliver()).toBe(0);

    const second = await book('Switched off', [{ offsetMinutes: 60, isActive: true }]);
    await arrange(second.a.id, 30, 600);
    await reminders.sweep();
    await h.owner.query(
      `UPDATE booking_reminders SET is_active = false WHERE booking_type_id = (SELECT id FROM booking_types WHERE uuid = $1)`,
      [second.type.id],
    );
    await reminders.deliver();
    expect((await runsOf(second.a.id))[0]).toMatchObject({
      status: 'cancelled',
      reason: 'rule_off',
    });
    expect(reminderMessenger.sent).toEqual([]);
  });

  it('the after-visit follow-up: claimed after the END, sent as a follow-up, not for a no-show', async () => {
    const done = await book('Follow-up done', [
      {
        kind: 'after',
        offsetMinutes: 5,
        isActive: true,
        channels: ['email'],
        body: 'Thank you {{name}}',
      },
    ]);
    const missed = await book('Follow-up missed', [
      { kind: 'after', offsetMinutes: 5, isActive: true },
    ]);
    for (const x of [done, missed]) {
      await h.owner.query(
        `UPDATE appointments SET starts_at = now() - interval '40 minutes', ends_at = now() - interval '10 minutes', armed_at = now() - interval '2 days' WHERE uuid = $1`,
        [x.a.id],
      );
    }
    await h.owner.query(`UPDATE appointments SET status = 'completed' WHERE uuid = $1`, [
      done.a.id,
    ]);
    await h.owner.query(`UPDATE appointments SET status = 'no_show' WHERE uuid = $1`, [
      missed.a.id,
    ]);
    expect(await reminders.sweep()).toBe(1);
    await reminders.deliver();
    expect(reminderMessenger.sent).toHaveLength(1);
    expect(reminderMessenger.sent[0]).toMatchObject({
      appointmentId: done.a.id,
      event: 'follow_up',
      purpose: 'follow_up',
      channel: 'email',
      body: 'Thank you Rita',
      notAfter: null,
    });
    expect((await runsOf(done.a.id))[0]).toMatchObject({ kind: 'after', status: 'sent' });
    expect(await runsOf(missed.a.id)).toEqual([]);
    expect((await timeline(done.a.id))[0]!.title).toBe('Follow-up sent on email');
  });

  it('a follow-up that is not yet due, or more than a day late, is not claimed', async () => {
    const soon = await book('Follow-up soon', [
      { kind: 'after', offsetMinutes: 120, isActive: true },
    ]);
    const old = await book('Follow-up old', [{ kind: 'after', offsetMinutes: 5, isActive: true }]);
    await h.owner.query(
      `UPDATE appointments SET starts_at = now() - interval '40 minutes', ends_at = now() - interval '10 minutes', armed_at = now() - interval '2 days', status = 'completed' WHERE uuid = $1`,
      [soon.a.id],
    );
    await h.owner.query(
      `UPDATE appointments SET starts_at = now() - interval '3 days', ends_at = now() - interval '3 days' + interval '30 minutes', armed_at = now() - interval '5 days', status = 'completed' WHERE uuid = $1`,
      [old.a.id],
    );
    expect(await reminders.sweep()).toBe(0);
  });

  it('a worker that died mid-delivery leaves the run interrupted, never sent twice', async () => {
    const { a } = await book('Interrupted', [{ offsetMinutes: 60, isActive: true }]);
    await arrange(a.id, 30, 600);
    await reminders.sweep();
    await h.owner.query(
      `UPDATE appointment_reminder_runs SET status = 'sending', locked_at = now() - interval '30 minutes'
        WHERE appointment_id = (SELECT id FROM appointments WHERE uuid = $1)`,
      [a.id],
    );
    await reminders.deliver();
    expect(reminderMessenger.sent).toEqual([]);
    expect((await runsOf(a.id))[0]).toMatchObject({ status: 'failed', reason: 'interrupted' });
  });

  it('two workers delivering at once send each run once', async () => {
    const made = [];
    for (let i = 0; i < 5; i++) {
      made.push(
        (await book(`Parallel ${i}`, [{ offsetMinutes: 60, isActive: true, channels: ['sms'] }])).a,
      );
    }
    for (const a of made) await arrange(a.id, 30, 600);
    await reminders.sweep();
    const [x, y] = await Promise.all([reminders.deliver(), reminders.deliver()]);
    expect(x + y).toBe(5);
    expect(reminderMessenger.sent.map((m) => m.appointmentId).sort()).toEqual(
      made.map((a) => a.id).sort(),
    );
  });

  it('the booking detail shows each reminder and what became of it', async () => {
    const { a } = await book('Detail', [
      { offsetMinutes: 60, isActive: true, channels: ['sms'], label: 'One hour' },
      { offsetMinutes: 30, isActive: true, channels: ['sms'] },
      { offsetMinutes: 15, isActive: false },
      { kind: 'after', offsetMinutes: 60, isActive: true },
    ]);
    await arrange(a.id, 20, 600);
    await reminders.sweep();
    await reminders.deliver();
    const got = (await api.appt(t.admin, a.id)) as Appointment & {
      reminders?: Array<{
        kind: string;
        offsetMinutes: number;
        status: string;
        label: string | null;
        channel: string | null;
      }>;
    };
    const list = got.reminders ?? [];
    expect(list.map((r) => [r.kind, r.offsetMinutes, r.status])).toEqual([
      ['before', 60, 'sent'],
      ['before', 30, 'sent'],
      ['after', 60, 'scheduled'],
    ]);
    expect(list[0]).toMatchObject({ label: 'One hour', channel: 'sms' });
  });

  it("another workspace's runs are never touched by this one's rules", async () => {
    const other = await api.signup('wrd2');
    const mine = await book('Mine', [{ offsetMinutes: 60, isActive: true, channels: ['sms'] }]);
    await arrange(mine.a.id, 30, 600);
    await reminders.sweep();
    const seen = await h.owner.query(
      `SELECT count(*)::int AS n FROM appointment_reminder_runs WHERE org_id = $1`,
      [other.orgId],
    );
    expect(seen.rows[0].n).toBe(0);
    await reminders.deliver();
    expect(reminderMessenger.sent.every((m) => m.orgId === t.orgId)).toBe(true);
  });
});

describe('the lifecycle sweep (TW-APPT-032, D-13)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('wls');
  });

  it('frees expired reservations and leaves live ones', async () => {
    const type = await api.type(t.admin);
    const id = Number(
      (await h.owner.query(`SELECT id FROM booking_types WHERE uuid = $1`, [type.id])).rows[0].id,
    );
    const ins = (expires: string) =>
      h.owner.query(
        `INSERT INTO slot_reservations (org_id, booking_type_id, starts_at, ends_at, session_ref, channel, expires_at)
                     VALUES ($1,$2, now() + interval '2 days', now() + interval '2 days 30 minutes','s','whatsapp', ${expires})`,
        [t.orgId, id],
      );
    await ins(`now() - interval '1 minute'`);
    await ins(`now() + interval '5 minutes'`);
    const r = await lifecycle.sweep();
    expect(r.reservations).toBe(1);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM slot_reservations WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('flags a confirmed booking that ended with no verdict as needs-review (never guesses a no-show) and completes a checked-in one', async () => {
    const type = await api.type(t.admin, { name: 'Lifecycle' });
    const slots = await api.slots(t.admin, type.id);
    const book = (i: number, phone: string) =>
      api.staffBook(t.admin, {
        bookingTypeId: type.id,
        startsAt: slots[i]!.start,
        invitee: { name: `L${i}`, phone },
      });
    const forgotten = await book(0, '+919811188801');
    const checkedIn = await book(3, '+919811188802');
    const recent = await book(6, '+919811188803');
    // Different hours, so the moved bookings do not overlap one another (one seat of one type).
    for (const [a, startAgoMin] of [
      [forgotten, 120],
      [checkedIn, 240],
      [recent, 20],
    ] as const) {
      await h.owner.query(
        `UPDATE appointments SET starts_at = now() - ($2 || ' minutes')::interval, ends_at = now() - ($2 || ' minutes')::interval + interval '30 minutes' WHERE uuid = $1`,
        [a.id, String(startAgoMin)],
      );
    }
    expect((await api.post(t.admin, `/v2/appointments/${checkedIn.id}/check-in`, {})).status).toBe(
      200,
    );
    const r = await lifecycle.sweep();
    expect(r.flagged).toBe(1);
    expect(r.completed).toBe(1);
    expect(await api.appt(t.admin, forgotten.id)).toMatchObject({
      status: 'confirmed',
      needsReview: true,
    });
    expect(await api.appt(t.admin, checkedIn.id)).toMatchObject({
      status: 'completed',
      needsReview: false,
    });
    // Ended five minutes ago: inside the 15-minute grace, nothing yet.
    expect(await api.appt(t.admin, recent.id)).toMatchObject({
      status: 'confirmed',
      needsReview: false,
    });
    const ev = (await outbox(t.orgId, 'appointment.completed', checkedIn.id))[0]!;
    expect(ev.payload).toMatchObject({
      from: 'confirmed',
      by: 'system',
      reason: 'checked_in',
      notify: false,
    });
    expect(await api.auditCount(t.orgId, 'appointments', 'update')).toBeGreaterThan(0);
    // Nothing more to do; and the flagged one is not flagged twice.
    const again = await lifecycle.sweep();
    expect(again).toMatchObject({ flagged: 0, completed: 0, cancelled: 0, declined: 0 });
    expect(
      (await api.as(t.admin).get('/v2/appointments?scope=all&needsReview=true')).body.data.map(
        (x: Appointment) => x.id,
      ),
    ).toEqual([forgotten.id]);
    expect((await api.as(t.admin).get('/v2/appointments/counts')).body.needsReview).toBe(1);
    // A person closes it, which clears the flag.
    const done = await api.post(t.admin, `/v2/appointments/${forgotten.id}/no-show`, {});
    expect(done.body).toMatchObject({ status: 'no_show', needsReview: false });
  });

  it('D-13: an unpaid pending booking whose payment hold ran out is cancelled by the system and its slot comes back', async () => {
    const type = await api.type(t.admin, {
      name: 'Hold',
      payment: { currency: 'USD', fee: '20.00', depositMode: 'full', gatewaySlug: 'stripe' },
    });
    const slots = await api.publicSlots(t.slug, type.slug);
    const req = await api.publicBooked(t.slug, type.slug, {
      startsAt: slots[2]!.start,
      name: 'Holder',
      email: 'holder@example.com',
    });
    expect(req.status).toBe('pending');
    expect((await api.publicSlots(t.slug, type.slug)).map((s) => s.start)).not.toContain(
      slots[2]!.start,
    );
    const a = (await api.as(t.admin).get('/v2/appointments?scope=all&q=holder@example')).body
      .data[0] as Appointment;
    expect((await lifecycle.sweep()).cancelled).toBe(0); // the hold is still running
    await h.owner.query(
      `UPDATE appointments SET hold_expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [a.id],
    );
    expect((await lifecycle.sweep()).cancelled).toBe(1);
    expect(await api.appt(t.admin, a.id)).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'system',
      cancelReason: 'payment_timeout',
    });
    expect((await api.publicSlots(t.slug, type.slug)).map((s) => s.start)).toContain(
      slots[2]!.start,
    );
    const ev = (await outbox(t.orgId, 'appointment.cancelled', a.id))[0]!;
    expect(ev.payload).toMatchObject({ by: 'system', reason: 'payment_timeout', notify: true });
    // A payment that arrives too late is refused: the booking is over.
    expect(
      (await api.post(t.admin, `/v2/appointments/${a.id}/payments`, { amount: '20.00' })).status,
    ).toBe(409);
  });

  it('a pending request whose time has passed is declined by the system; a paid-and-confirmed one is not touched', async () => {
    const type = await api.type(t.admin, { name: 'Expiring', approvalRequired: true });
    const slots = await api.publicSlots(t.slug, type.slug);
    await api.publicBooked(t.slug, type.slug, {
      startsAt: slots[1]!.start,
      name: 'Waiting',
      email: 'waiting@example.com',
    });
    const a = (await api.as(t.admin).get('/v2/appointments?scope=all&q=waiting@example')).body
      .data[0] as Appointment;
    await arrange(a.id, -120, 600);
    expect((await lifecycle.sweep()).declined).toBe(1);
    expect(await api.appt(t.admin, a.id)).toMatchObject({
      status: 'declined',
      cancelledBy: 'system',
      cancelReason: 'expired',
    });
    expect((await outbox(t.orgId, 'appointment.declined', a.id))[0]!.payload).toMatchObject({
      reason: 'expired',
    });
  });

  it('a person acting first wins: a candidate that changed after it was picked is skipped', async () => {
    const type = await api.type(t.admin, {
      name: 'Race',
      payment: { currency: 'USD', fee: '20.00', depositMode: 'full', gatewaySlug: 'stripe' },
    });
    const slots = await api.publicSlots(t.slug, type.slug);
    await api.publicBooked(t.slug, type.slug, {
      startsAt: slots[0]!.start,
      name: 'Quick',
      email: 'quick@example.com',
    });
    const a = (await api.as(t.admin).get('/v2/appointments?scope=all&q=quick@example')).body
      .data[0] as Appointment;
    await h.owner.query(
      `UPDATE appointments SET hold_expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [a.id],
    );
    // Paid at the last moment: the booking is confirmed, so the sweep finds it no longer pending.
    expect(
      (await api.post(t.admin, `/v2/appointments/${a.id}/payments`, { amount: '20.00' })).body
        .status,
    ).toBe('confirmed');
    expect((await lifecycle.sweep()).cancelled).toBe(0);
    expect((await api.appt(t.admin, a.id)).status).toBe('confirmed');
  });
});

/** A messenger that records what it is asked to send. */
class FakeMessenger implements AppointmentMessenger {
  readonly name = 'fake';
  sent: BookingMessage[] = [];
  result: BookingMessageResult = { status: 'sent' };
  /** An answer for one channel; the others get `result`. */
  byChannel: Partial<Record<string, BookingMessageResult>> = {};
  async send(m: BookingMessage): Promise<BookingMessageResult> {
    this.sent.push(m);
    return this.byChannel[m.channel] ?? this.result;
  }
}

describe('the message consumer (TW-APPT-013, 030, 031, D-14, EXT-APPT-08)', () => {
  let t: Tenant;
  let messenger: FakeMessenger;
  let consumer: AppointmentMessageConsumer;
  beforeAll(async () => {
    t = await api.signup('wmc');
    messenger = new FakeMessenger();
    consumer = new AppointmentMessageConsumer(
      db,
      apptsRepo,
      typesRepo,
      support,
      new OutboxSubscriberRegistry(),
      messenger,
    );
  });

  const first = async (type: string, uuid: string) => (await outbox(t.orgId, type, uuid))[0]!;

  it('a confirmed booking is announced with the default text, the manage link and a stable idempotency key', async () => {
    const type = await api.type(t.admin, { name: 'Haircut' });
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[4]!.start,
      invitee: { name: 'Ana', phone: '+919811166601', email: 'ana@example.com' },
    });
    messenger.sent = [];
    const ev = await first('appointment.booked', a.id);
    await consumer.handle(ev);
    expect(messenger.sent).toHaveLength(1);
    const m = messenger.sent[0]!;
    expect(m).toMatchObject({
      orgId: t.orgId,
      appointmentId: a.id,
      event: 'confirmation',
      channel: 'whatsapp',
      to: { name: 'Ana', phone: '+919811166601', email: 'ana@example.com' },
      idempotencyKey: `${ev.id}:whatsapp`,
      waTemplateId: null,
    });
    expect(m.body).toMatch(
      /^Booked: Haircut on [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} · \d{1,2}:\d{2} [AP]M\./,
    );
    expect(m.body).toContain(`Reschedule or cancel: ${a.manageUrl}`);
    // At-least-once delivery: the same event again is the same message (the adapter dedupes on the key).
    await consumer.handle(ev);
    expect(messenger.sent[1]!.idempotencyKey).toBe(m.idempotencyKey);
  });

  it("uses the type's messages: its plain body for the event, per configured channel, with the variables filled", async () => {
    const type = await api.type(t.admin, {
      name: 'Custom',
      templates: [
        {
          event: 'confirmation',
          channel: 'whatsapp',
          plainBody: 'Hi {{name}}, see you {{slot}} at {{location}}',
        },
        { event: 'confirmation', channel: 'email', plainBody: 'Email confirmation for {{type}}' },
      ],
      locationValue: '9 High St',
    });
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[4]!.start,
      invitee: { name: 'Bo', phone: '+919811166602', email: 'bo@example.com' },
    });
    messenger.sent = [];
    await consumer.handle(await first('appointment.booked', a.id));
    expect(messenger.sent.map((m) => m.channel).sort()).toEqual(['email', 'whatsapp']);
    const wa = messenger.sent.find((m) => m.channel === 'whatsapp')!;
    expect(wa.body).toMatch(
      /^Hi Bo, see you [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} · \d{1,2}:\d{2} [AP]M at 9 High St\n\nReschedule or cancel: /,
    );
    expect(wa.variables).toMatchObject({ name: 'Bo', type: 'Custom', location: '9 High St' });
    expect(wa.purpose).toBe('service');
    const mail = messenger.sent.find((m) => m.channel === 'email')!;
    expect(mail.body.startsWith('Email confirmation for Custom')).toBe(true);
    expect(mail.subject).toBe('Custom: Your booking is confirmed');
  });

  it('with no message configured: WhatsApp when there is a phone, else email; with neither, nothing', async () => {
    const type = await api.type(t.admin, { name: 'Fallback' });
    const slots = await api.slots(t.admin, type.id);
    const phoneOnly = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[4]!.start,
      invitee: { name: 'P', phone: '+919811166603' },
    });
    const mailOnly = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[7]!.start,
      invitee: { name: 'M', email: 'm@example.com' },
    });
    const nobody = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[10]!.start,
      invitee: { name: 'N' },
    });
    for (const [a, channel] of [
      [phoneOnly, 'whatsapp'],
      [mailOnly, 'email'],
      [nobody, null],
    ] as const) {
      messenger.sent = [];
      await consumer.handle(await first('appointment.booked', a.id));
      expect(messenger.sent.map((m) => m.channel)).toEqual(channel ? [channel] : []);
    }
  });

  it('a message about a state that no longer holds is dropped; a silent action sends nothing; a pending booking is not "confirmed"', async () => {
    const type = await api.type(t.admin, { name: 'Stale', approvalRequired: true });
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[4]!.start,
      invitee: { name: 'S', phone: '+919811166604' },
    });
    messenger.sent = [];
    await consumer.handle(await first('appointment.booked', a.id));
    expect(messenger.sent).toHaveLength(1); // staff booking: confirmed at once
    messenger.sent = [];
    // Cancelled silently: the cancellation is not sent; the old "booked" event is stale and is dropped as well.
    await api.post(t.admin, `/v2/appointments/${a.id}/cancel`, { notify: false });
    await consumer.handle(await first('appointment.cancelled', a.id));
    await consumer.handle(await first('appointment.booked', a.id));
    expect(messenger.sent).toHaveLength(0);
    // Cancelled loudly: the cancellation text goes out.
    const b = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[8]!.start,
      invitee: { name: 'S2', phone: '+919811166605' },
    });
    await api.post(t.admin, `/v2/appointments/${b.id}/cancel`, { reason: 'x' });
    await consumer.handle(await first('appointment.cancelled', b.id));
    expect(messenger.sent.map((m) => [m.event, m.body.includes('has been cancelled')])).toEqual([
      ['cancellation', true],
    ]);
  });

  it('a request awaiting approval sends nothing until staff confirm it', async () => {
    const type = await api.type(t.admin, { name: 'Needs approval', approvalRequired: true });
    const slots = await api.publicSlots(t.slug, type.slug);
    await api.publicBooked(t.slug, type.slug, {
      startsAt: slots[0]!.start,
      name: 'Req',
      email: 'req2@example.com',
    });
    const a = (await api.as(t.admin).get('/v2/appointments?scope=all&q=req2@example')).body
      .data[0] as Appointment;
    messenger.sent = [];
    await consumer.handle(await first('appointment.booked', a.id));
    expect(messenger.sent).toHaveLength(0);
    await api.post(t.admin, `/v2/appointments/${a.id}/confirm`, {});
    await consumer.handle(await first('appointment.confirmed', a.id));
    expect(messenger.sent.map((m) => [m.event, m.channel])).toEqual([['confirmation', 'email']]);
    // Declined requests get the cancellation text.
    const b = await api.publicBooked(t.slug, type.slug, {
      startsAt: slots[1]!.start,
      name: 'Req',
      email: 'req3@example.com',
    });
    expect(b.status).toBe('pending');
    const bb = (await api.as(t.admin).get('/v2/appointments?scope=all&q=req3@example')).body
      .data[0] as Appointment;
    await api.post(t.admin, `/v2/appointments/${bb.id}/decline`, {});
    messenger.sent = [];
    await consumer.handle(await first('appointment.declined', bb.id));
    expect(messenger.sent.map((m) => m.event)).toEqual(['cancellation']);
  });

  it("a rescheduled booking gets the reschedule text with the new time; the customer's own move is announced too", async () => {
    const type = await api.type(t.admin, { name: 'Mover' });
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[4]!.start,
      invitee: { name: 'Mo', phone: '+919811166606' },
    });
    await api.post(t.admin, `/v2/appointments/${a.id}/reschedule`, { startsAt: slots[9]!.start });
    messenger.sent = [];
    await consumer.handle(await first('appointment.rescheduled', a.id));
    expect(messenger.sent).toHaveLength(1);
    expect(messenger.sent[0]).toMatchObject({ event: 'reschedule' });
    expect(messenger.sent[0]!.body).toContain('has moved to');
    expect(messenger.sent[0]!.body).toContain('Reschedule or cancel:');
  });

  it('a skipped delivery is fine (no channel adapter), a failed one throws so the drain retries with backoff', async () => {
    const type = await api.type(t.admin, { name: 'Fails' });
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[4]!.start,
      invitee: { name: 'F', phone: '+919811166607' },
    });
    const ev = await first('appointment.booked', a.id);
    messenger.result = { status: 'skipped', reason: 'no_channel_adapter' };
    await expect(consumer.handle(ev)).resolves.toBeUndefined();
    messenger.result = { status: 'failed', reason: 'provider down' };
    await expect(consumer.handle(ev)).rejects.toThrow(/provider down/);
    // A hold is retried by the drain too.
    messenger.result = { status: 'held', reason: 'channel_unavailable' };
    await expect(consumer.handle(ev)).rejects.toThrow(/channel_unavailable/);
    messenger.result = { status: 'sent' };
  });

  it('the stub adapter the application ships with reports "skipped" rather than failing', async () => {
    const { NoAppointmentMessenger } =
      await import('../../../src/infra/providers/appointments-booking');
    const res = await new NoAppointmentMessenger().send({
      orgId: 1,
      appointmentId: 'x',
      event: 'reminder',
      channel: 'whatsapp',
      to: { name: null, phone: '+1', email: null },
      body: 'b',
      subject: 's',
      waTemplateId: null,
      variableMap: null,
      idempotencyKey: 'k',
    });
    expect(res).toEqual({ status: 'skipped', reason: 'no_channel_adapter' });
  });
});

/** A calendar that is connected and records what it is asked to do. */
class FakeCalendar implements CalendarSyncPort {
  readonly provider = 'fake';
  connected = true;
  upserts: CalendarEventRequest[] = [];
  deletes: Array<{ calendarId: string | null; eventId: string }> = [];
  busy: Array<{ start: Date; end: Date }> = [];
  calls = 0;
  async status() {
    return { connected: this.connected, account: this.connected ? 'ana@example.com' : null };
  }
  async freeBusy() {
    this.calls++;
    return this.busy;
  }
  async upsertEvent(req: CalendarEventRequest) {
    this.upserts.push(req);
    return {
      eventId: req.existingEventId ?? 'evt-1',
      calendarId: req.calendarId ?? 'primary',
      meetUrl: req.createMeet ? 'https://meet.example/abc' : null,
    };
  }
  async deleteEvent(_o: number, calendarId: string | null, eventId: string) {
    this.deletes.push({ calendarId, eventId });
  }
  async readEvent() {
    return { kind: 'missing' as const };
  }
  async calendarExists() {
    return true;
  }
}

describe('the calendar hook (TW-APPT-012, 029, D-08, EXT-APPT-08)', () => {
  let t: Tenant;
  let cal: FakeCalendar;
  let consumer: AppointmentCalendarConsumer;
  beforeAll(async () => {
    t = await api.signup('wcc');
    cal = new FakeCalendar();
    consumer = new AppointmentCalendarConsumer(
      new AppointmentCalendarWriter(
        db,
        apptsRepo,
        typesRepo,
        cal,
        h.app.get(AppointmentMeetingMirror),
      ),
      new OutboxSubscriberRegistry(),
      cal,
    );
  });
  const first = async (type: string, uuid: string) => (await outbox(t.orgId, type, uuid))[0]!;

  it('writes the event for a confirmed booking, stores the event id and the Meet link, updates the same event on a move, deletes it on a cancel', async () => {
    const type = await api.type(t.admin, {
      name: 'Calendar',
      locationType: 'virtual',
      calendar: { calendarId: 'team@example.com' },
    });
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[4]!.start,
      invitee: { name: 'Cal', phone: '+919811155501', email: 'cal@example.com' },
    });
    await consumer.handle(await first('appointment.booked', a.id));
    expect(cal.upserts).toHaveLength(1);
    expect(cal.upserts[0]).toMatchObject({
      orgId: t.orgId,
      appointmentId: a.id,
      calendarId: 'team@example.com',
      title: 'Calendar',
      attendeeEmail: 'cal@example.com',
      attendeeName: 'Cal',
      createMeet: true,
      existingEventId: null,
      timezone: 'UTC',
    });
    expect(cal.upserts[0]!.startsAt.toISOString()).toBe(slots[4]!.start);
    const stored = await api.rowOf(a.id);
    expect(stored).toMatchObject({
      calendar_event_id: 'evt-1',
      calendar_id: 'team@example.com',
      meet_url: 'https://meet.example/abc',
    });
    expect((await api.appt(t.admin, a.id)).calendar).toMatchObject({
      eventId: 'evt-1',
      calendarId: 'team@example.com',
      sync: { state: 'in_sync', reason: null },
    });
    // Redelivery and a move both update the same event.
    await consumer.handle(await first('appointment.booked', a.id));
    await api.post(t.admin, `/v2/appointments/${a.id}/reschedule`, { startsAt: slots[8]!.start });
    await consumer.handle(await first('appointment.rescheduled', a.id));
    expect(cal.upserts.map((u) => u.existingEventId)).toEqual([null, 'evt-1', 'evt-1']);
    expect(cal.upserts[2]!.startsAt.toISOString()).toBe(slots[8]!.start);
    await api.post(t.admin, `/v2/appointments/${a.id}/cancel`, {});
    await consumer.handle(await first('appointment.cancelled', a.id));
    expect(cal.deletes).toEqual([{ calendarId: 'team@example.com', eventId: 'evt-1' }]);
  });

  it('writes nothing for a pending request or an unpaid hold, and nothing at all when no calendar is connected', async () => {
    const type = await api.type(t.admin, { name: 'No event', approvalRequired: true });
    const slots = await api.publicSlots(t.slug, type.slug);
    await api.publicBooked(t.slug, type.slug, {
      startsAt: slots[0]!.start,
      name: 'Pend',
      email: 'pend@example.com',
    });
    const a = (await api.as(t.admin).get('/v2/appointments?scope=all&q=pend@example')).body
      .data[0] as Appointment;
    const before = cal.upserts.length;
    await consumer.handle(await first('appointment.booked', a.id));
    expect(cal.upserts).toHaveLength(before);
    await api.post(t.admin, `/v2/appointments/${a.id}/confirm`, {});
    await consumer.handle(await first('appointment.confirmed', a.id));
    expect(cal.upserts).toHaveLength(before + 1);
    cal.connected = false;
    await api.post(t.admin, `/v2/appointments/${a.id}/cancel`, {});
    await consumer.handle(await first('appointment.cancelled', a.id));
    expect(cal.deletes).toHaveLength(1); // only the first test's delete: not connected, so nothing was called
    cal.connected = true;
  });

  it("a calendar's busy time blocks slots (with the type's buffers); an outage does not stop bookings", async () => {
    const type = await api.type(t.admin, {
      name: 'Busy',
      calendar: { calendarId: 'busy@example.com' },
    });
    const slots = await api.slots(t.admin, type.id);
    const s = slots[6]!;
    cal.busy = [{ start: new Date(s.start), end: new Date(s.end) }];
    const slotsSvc = new SlotsService(typesRepo, apptsRepo, cal);
    const lt = await db.txAs({ orgId: t.orgId, userId: null }, async (tx) => {
      const row = (await typesRepo.findByUuid(tx, t.orgId, type.id))!;
      return slotsSvc.load(tx, t.orgId, row);
    });
    const from = Date.parse(slots[0]!.start) - 86_400_000;
    const busy = await slotsSvc.busyFor(t.orgId, lt, from, from + 3 * 86_400_000);
    expect(busy).toEqual([{ startMs: Date.parse(s.start), endMs: Date.parse(s.end) }]);
    const res = await db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
      slotsSvc.slots(tx, t.orgId, lt, {}, Date.now(), busy),
    );
    const starts = res.days.flatMap((d) => d.slots.map((x) => x.start));
    expect(starts).not.toContain(s.start);
    expect(starts).toContain(slots[7]!.start);
    // A failing calendar: no busy time, no exception.
    cal.freeBusy = async () => {
      throw new Error('calendar down');
    };
    expect(await slotsSvc.busyFor(t.orgId, lt, from, from + DAY3)).toEqual([]);
    // Staff booking still works through the real app (whose calendar is the stub).
    expect(
      (
        await api.post(t.admin, '/v2/appointments', {
          bookingTypeId: type.id,
          startsAt: s.start,
          invitee: { name: 'Still', phone: '+919811155599' },
        })
      ).status,
    ).toBe(201);
  });
});
