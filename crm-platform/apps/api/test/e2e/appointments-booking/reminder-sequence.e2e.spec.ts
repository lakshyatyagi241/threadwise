import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type {
  AppointmentMessenger,
  BookingMessage,
  BookingMessageResult,
} from '../../../src/infra/providers/appointments-booking';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
} from '../../../src/kernel/outbox/outbox-subscribers';
import { AppointmentMessageConsumer } from '../../../src/modules/appointments-booking/appointment-message.consumer';
import { AppointmentReminderService } from '../../../src/modules/appointments-booking/appointment-reminder.service';
import { AppointmentReminderSweepService } from '../../../src/modules/appointments-booking/appointment-reminder-sweep.service';
import { AppointmentRemindersRepository } from '../../../src/modules/appointments-booking/appointment-reminders.repository';
import { AppointmentsRepository } from '../../../src/modules/appointments-booking/appointments.repository';
import { AppointmentsSupport } from '../../../src/modules/appointments-booking/appointments.support';
import { BookingTypesRepository } from '../../../src/modules/appointments-booking/booking-types.repository';
import {
  AppointmentsApi,
  bearer,
  buildReminderService,
  startHarness,
  type Appointment,
  type BookingType,
  type Harness,
  type Tenant,
} from './support';

/**
 * Appointment reminders as an ordered SEQUENCE of steps (BL-420 SMS removed, BL-421 sequences). Through the real API and database, with
 * the customer messenger replaced by a fake (no WhatsApp or email provider is ever called):
 *  - what the SMS-removal migration leaves behind, as the API shows it;
 *  - WhatsApp first, then email, and why email was used (the run's channel log, shown on the booking);
 *  - a cancel stops every waiting step; the skip rules of the steps; quiet hours hold and never move to the next channel;
 *  - a rule that only had SMS is delivered on WhatsApp, then email, and the messenger is never asked for SMS.
 */
let h: Harness;
let api: AppointmentsApi;
let db: DatabaseService;
let sweep: AppointmentReminderSweepService;
let service: AppointmentReminderService;
let consumer: AppointmentMessageConsumer;
let messenger: FakeMessenger;

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

beforeAll(async () => {
  h = await startHarness();
  api = new AppointmentsApi(h);
  db = h.app.get(DatabaseService);
  const typesRepo = h.app.get(BookingTypesRepository);
  const apptsRepo = h.app.get(AppointmentsRepository);
  const support = h.app.get(AppointmentsSupport);
  const runsRepo = h.app.get(AppointmentRemindersRepository);
  messenger = new FakeMessenger();
  service = buildReminderService(h, messenger);
  sweep = new AppointmentReminderSweepService(db, h.app.get(OutboxService), runsRepo, service);
  consumer = new AppointmentMessageConsumer(
    db,
    apptsRepo,
    typesRepo,
    support,
    new OutboxSubscriberRegistry(),
    service,
    runsRepo,
    messenger,
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

/** A booking arranged straight in the table: starts `startInMin` from now, was made `madeAgoMin` ago (`null` keeps its arming). */
async function arrange(
  id: string,
  startInMin: number,
  madeAgoMin: number | null,
  durationMin = 30,
): Promise<void> {
  await h.owner.query(
    `UPDATE appointments SET starts_at = now() + ($2 || ' minutes')::interval,
                             ends_at = now() + ($2 || ' minutes')::interval + ($3 || ' minutes')::interval,
                             armed_at = CASE WHEN $4::text IS NULL THEN armed_at ELSE now() - ($4 || ' minutes')::interval END
     WHERE uuid = $1`,
    [id, String(startInMin), String(durationMin), madeAgoMin === null ? null : String(madeAgoMin)],
  );
}

async function outbox(orgId: number, type: string, uuid: string): Promise<OutboxEvent[]> {
  const res = await h.owner.query(
    `SELECT id::text AS id, org_id, aggregate_module, aggregate_id::text AS aggregate_id, event_type, payload
       FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
    [orgId, type],
  );
  return res.rows
    .map((r) => ({
      id: r.id as string,
      orgId: Number(r.org_id),
      aggregateModule: r.aggregate_module as string,
      aggregateId: r.aggregate_id as string,
      eventType: r.event_type as string,
      payload: r.payload as Record<string, unknown>,
    }))
    .filter((e) => e.payload.uuid === uuid);
}

type Rule = Record<string, unknown>;
interface ShownReminder {
  kind: string;
  stepKind: string | null;
  offsetMinutes: number;
  status: string;
  reason: string | null;
  channel: string | null;
  attempts: Array<{ channel: string; status: string; reason: string | null }>;
}

describe('the SMS-removal migration, as the API shows it (BL-420)', () => {
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    // a: email and WhatsApp on (the usual workspace).  b: only WhatsApp on, no email choice at all.
    a = await api.signup('seqa');
    b = await api.signupUndecided('seqb');
    expect(
      (
        await api
          .http()
          .put('/v2/appointment-channels/whatsapp')
          .set(bearer(b.admin))
          .set('Idempotency-Key', crypto.randomUUID())
          .send({ enabled: true })
      ).status,
    ).toBe(200);
  });

  const make = (t: Tenant, name: string, channels: string[]): Promise<BookingType> =>
    api.type(t.admin, {
      name,
      reminders: [{ offsetMinutes: 60, isActive: true, channels }],
    });
  const setChannels = (typeId: string, channels: string[], extra = ''): Promise<unknown> =>
    h.owner.query(
      `UPDATE booking_reminders SET channels = $2::text[] ${extra}
        WHERE booking_type_id = (SELECT id FROM booking_types WHERE uuid = $1)`,
      [typeId, channels],
    );
  const read = async (t: Tenant, typeId: string): Promise<BookingType> => {
    const res = await api.as(t.admin).get(`/v2/booking-types/${typeId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as BookingType;
  };

  /** The data part of the migration (everything after its schema changes), run as the owner role like the migration runner does. */
  async function runMigrationData(): Promise<void> {
    const file = readFileSync(
      resolve(
        __dirname,
        '../../../../../packages/db/migrations/20270320090000_appt_reminders_sms_removed.sql',
      ),
      'utf8',
    );
    const from = file.indexOf("SELECT set_config('app.privileged'");
    expect(from).toBeGreaterThan(0);
    await h.owner.query(`BEGIN;\n${file.slice(from)}\nCOMMIT;`);
  }

  it('a stored rule that lists SMS reads without it, and the notice appears only on a rule the migration changed', async () => {
    const mixed = await make(a, 'Mixed', ['email']);
    const only = await make(a, 'Only SMS, email on', ['email']);
    const none = await make(b, 'Only SMS, no email', ['whatsapp']);
    // Rows as they were before SMS was removed (the old CHECK still takes 'sms').
    await setChannels(mixed.id, ['sms', 'whatsapp', 'email']);
    await setChannels(only.id, ['sms']);
    await setChannels(none.id, ['sms']);
    await h.owner.query(
      `INSERT INTO appointment_channel_settings (org_id, channel, enabled, source) VALUES ($1, 'sms', true, 'owner')
       ON CONFLICT (org_id, channel) DO UPDATE SET enabled = true`,
      [a.orgId],
    );

    // Before the migration data runs, the API already reads without SMS (a rule left with nothing falls back to the live default).
    expect((await read(a, mixed.id)).reminders[0]).toMatchObject({
      channels: ['whatsapp', 'email'],
      notice: null,
    });
    expect((await read(a, only.id)).reminders[0]).toMatchObject({
      channels: ['whatsapp', 'email'],
      notice: null,
    });

    await runMigrationData();

    // SMS among other channels: it is dropped, the others keep their order, no notice.
    const m = (await read(a, mixed.id)).reminders[0]!;
    expect(m).toMatchObject({ channels: ['whatsapp', 'email'], isActive: true, notice: null });
    // Only SMS, and the workspace has email on: email only, still on, with the notice.
    const o = (await read(a, only.id)).reminders[0]!;
    expect(o).toMatchObject({ channels: ['email'], isActive: true, notice: 'sms_removed' });
    // Only SMS and no email: switched OFF, WhatsApp and email offered, with the notice.
    const n = (await read(b, none.id)).reminders[0]!;
    expect(n).toMatchObject({
      channels: ['whatsapp', 'email'],
      isActive: false,
      notice: 'sms_removed',
    });
    // Nothing is deleted, and the workspace's SMS choice is kept as history but off.
    const sms = await h.owner.query(
      `SELECT enabled FROM appointment_channel_settings WHERE org_id = $1 AND channel = 'sms'`,
      [a.orgId],
    );
    expect(sms.rows).toEqual([{ enabled: false }]);
    const list = await api.as(a.admin).get('/v2/appointment-channels');
    expect(list.body.data.map((c: { channel: string }) => c.channel)).toEqual([
      'email',
      'whatsapp',
      'voice',
    ]);
    // The raw rows never mention SMS in what the API returns.
    for (const t of [mixed, only]) {
      expect(JSON.stringify((await read(a, t.id)).reminders)).not.toMatch(/sms(?!_removed)/);
    }

    // Running the migration data again changes nothing (the rule that is already email-only has no SMS left).
    await runMigrationData();
    expect((await read(a, only.id)).reminders[0]).toMatchObject({
      channels: ['email'],
      notice: 'sms_removed',
    });
  });

  it('the owner looking at the step clears the notice: switching it on, or choosing other channels, saves it without the note', async () => {
    const t = await make(b, 'Notice cleared', ['whatsapp']);
    await setChannels(
      t.id,
      ['whatsapp', 'email'],
      ", is_active = false, notice_code = 'sms_removed'",
    );
    const before = await read(b, t.id);
    expect(before.reminders[0]).toMatchObject({ isActive: false, notice: 'sms_removed' });
    // Saved but still off and unchanged: the note stays.
    const same = await api
      .as(b.admin)
      .patch(`/v2/booking-types/${t.id}`)
      .send({
        rowVersion: before.rowVersion,
        reminders: [
          {
            id: before.reminders[0]!.id,
            offsetMinutes: 60,
            isActive: false,
            channels: ['whatsapp', 'email'],
          },
        ],
      });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(same.body.reminders[0].notice).toBe('sms_removed');
    // Switched on with WhatsApp: the owner chose; the note goes.
    const on = await api
      .as(b.admin)
      .patch(`/v2/booking-types/${t.id}`)
      .send({
        rowVersion: same.body.rowVersion,
        reminders: [
          {
            id: before.reminders[0]!.id,
            offsetMinutes: 60,
            isActive: true,
            channels: ['whatsapp'],
          },
        ],
      });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.reminders[0]).toMatchObject({
      isActive: true,
      channels: ['whatsapp'],
      notice: null,
    });
  });

  it('SMS is refused on create and update (422), whether the step is on or off', async () => {
    const t = await make(a, 'No SMS', ['email']);
    const created = await api.post(a.admin, '/v2/booking-types', {
      name: 'Wants SMS',
      durationMinutes: 30,
      timezone: 'UTC',
      reminders: [{ offsetMinutes: 60, isActive: true, channels: ['sms'] }],
    });
    expect(created.status).toBe(422);
    expect(created.body.code).toBe('VALIDATION_FAILED');
    const cur = await read(a, t.id);
    const updated = await api
      .as(a.admin)
      .patch(`/v2/booking-types/${t.id}`)
      .send({
        rowVersion: cur.rowVersion,
        reminders: [
          {
            id: cur.reminders[0]!.id,
            offsetMinutes: 60,
            isActive: false,
            channels: ['email', 'sms'],
          },
        ],
      });
    expect(updated.status, JSON.stringify(updated.body)).toBe(422);
    expect(updated.body.code).toBe('VALIDATION_FAILED');
    expect((await read(a, t.id)).reminders[0]!.channels).toEqual(['email']);
  });
});

describe('delivering the steps of a sequence', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('seqd');
    // The sweeps span every workspace: let go of what earlier describes of this file left claimable.
    await sweep.sweep();
    await sweep.deliver();
  });
  beforeEach(() => {
    messenger.sent = [];
    messenger.result = { status: 'sent' };
    messenger.byChannel = {};
  });

  async function book(name: string, rules: Rule[], invitee?: Record<string, unknown>) {
    const type = await api.type(t.admin, { name, reminders: rules });
    const slots = await api.slots(t.admin, type.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: type.id,
      startsAt: slots[0]!.start,
      invitee: invitee ?? {
        name: 'Rita',
        phone: `+9198333${Math.floor(10000 + Math.random() * 89999)}`,
        email: `rita${Math.floor(Math.random() * 1e6)}@example.com`,
      },
    });
    return { type, a };
  }
  const runsOf = async (uuid: string) =>
    (
      await h.owner.query(
        `SELECT r.kind, r.step_kind, r.offset_minutes, r.status, r.reason, r.channel, r.attempt_log, r.next_attempt_at
           FROM appointment_reminder_runs r JOIN appointments a ON a.org_id = r.org_id AND a.id = r.appointment_id
          WHERE a.uuid = $1 ORDER BY r.offset_minutes DESC, r.id`,
        [uuid],
      )
    ).rows;
  const sentFor = (uuid: string) => messenger.sent.filter((m) => m.appointmentId === uuid);
  const remindersOf = async (uuid: string): Promise<ShownReminder[]> =>
    ((await api.appt(t.admin, uuid)) as Appointment & { reminders: ShownReminder[] }).reminders;
  /** One timed step due now: starts in 30 minutes, was made ten hours ago, the step is 60 minutes before. */
  async function dueNow(rule: Rule = {}) {
    const made = await book('Due', [
      { offsetMinutes: 60, isActive: true, channels: ['whatsapp', 'email'], ...rule },
    ]);
    await arrange(made.a.id, 30, 600);
    return made;
  }

  describe('WhatsApp first, then email, and why', () => {
    const cases: Array<[string, BookingMessageResult, string, string]> = [
      [
        'the contact has no number',
        { status: 'skipped', reason: 'no_contact_point' },
        'skipped',
        'no_contact_point',
      ],
      [
        'the contact gave no consent',
        { status: 'skipped', reason: 'no_consent' },
        'skipped',
        'no_consent',
      ],
      [
        'the WhatsApp template is not approved',
        { status: 'skipped', reason: 'template_unavailable' },
        'skipped',
        'template_unavailable',
      ],
      [
        'the provider refuses the message',
        { status: 'failed', reason: 'provider_error' },
        'failed',
        'provider_error',
      ],
    ];

    for (const [why, whatsapp, status, reason] of cases) {
      it(`${why}: the step goes by email and the booking says why`, async () => {
        const { a } = await dueNow();
        messenger.byChannel = { whatsapp };
        await sweep.sweep();
        await sweep.deliver();
        expect(sentFor(a.id).map((m) => m.channel)).toEqual(['whatsapp', 'email']);
        expect((await runsOf(a.id))[0]).toMatchObject({
          status: 'sent',
          channel: 'email',
          reason: null,
          attempt_log: [
            { channel: 'whatsapp', status, reason },
            { channel: 'email', status: 'sent', reason: null },
          ],
        });
        const [shown] = await remindersOf(a.id);
        expect(shown).toMatchObject({
          status: 'sent',
          channel: 'email',
          attempts: [
            { channel: 'whatsapp', status, reason },
            { channel: 'email', status: 'sent', reason: null },
          ],
        });
        // Codes only: never a number, an address or the text.
        expect(JSON.stringify(shown!.attempts)).not.toMatch(/\+9198|@example|Rita/);
      });
    }

    it('a channel that delivers is the only one used: no second copy by email', async () => {
      const { a } = await dueNow();
      await sweep.sweep();
      await sweep.deliver();
      expect(sentFor(a.id).map((m) => m.channel)).toEqual(['whatsapp']);
      const [shown] = await remindersOf(a.id);
      expect(shown).toMatchObject({
        status: 'sent',
        channel: 'whatsapp',
        attempts: [{ channel: 'whatsapp', status: 'sent', reason: null }],
      });
    });

    it('when neither channel can deliver, the run is skipped (or failed) and keeps both lines of the log', async () => {
      const skipped = await dueNow();
      messenger.byChannel = {
        whatsapp: { status: 'skipped', reason: 'no_consent' },
        email: { status: 'skipped', reason: 'no_contact_point' },
      };
      await sweep.sweep();
      await sweep.deliver();
      expect((await runsOf(skipped.a.id))[0]).toMatchObject({
        status: 'skipped',
        reason: 'no_consent',
        channel: null,
        attempt_log: [
          { channel: 'whatsapp', status: 'skipped', reason: 'no_consent' },
          { channel: 'email', status: 'skipped', reason: 'no_contact_point' },
        ],
      });

      const failed = await dueNow();
      messenger.byChannel = {
        whatsapp: { status: 'failed', reason: 'provider_error' },
        email: { status: 'failed', reason: 'provider_error' },
      };
      await sweep.sweep();
      await sweep.deliver();
      expect((await runsOf(failed.a.id))[0]).toMatchObject({
        status: 'failed',
        reason: 'provider_error',
        attempt_log: [
          { channel: 'whatsapp', status: 'failed', reason: 'provider_error' },
          { channel: 'email', status: 'failed', reason: 'provider_error' },
        ],
      });
    });

    it('an unexpected error in the WhatsApp adapter is that channel failing, not the end of the step', async () => {
      const { a } = await dueNow();
      const original = messenger.send.bind(messenger);
      messenger.send = async (m) => {
        if (m.channel === 'whatsapp') {
          messenger.sent.push(m);
          throw new Error('boom');
        }
        return original(m);
      };
      try {
        await sweep.sweep();
        await sweep.deliver();
      } finally {
        messenger.send = original;
      }
      expect((await runsOf(a.id))[0]).toMatchObject({
        status: 'sent',
        channel: 'email',
        attempt_log: [
          { channel: 'whatsapp', status: 'failed', reason: 'internal_error' },
          { channel: 'email', status: 'sent', reason: null },
        ],
      });
    });
  });

  describe('quiet hours hold, they never move the step to the next channel', () => {
    it('the run is held with quiet_hours on WhatsApp, email is not tried, and it goes on WhatsApp when the hours end', async () => {
      const { a } = await dueNow();
      const until = new Date(Date.now() + 2 * 3_600_000).toISOString();
      messenger.result = { status: 'held', reason: 'quiet_hours', holdUntil: until };
      await sweep.sweep();
      await sweep.deliver();
      expect(sentFor(a.id).map((m) => m.channel)).toEqual(['whatsapp']);
      const [held] = await runsOf(a.id);
      expect(held).toMatchObject({
        status: 'held',
        reason: 'quiet_hours',
        channel: 'whatsapp',
        attempt_log: [{ channel: 'whatsapp', status: 'held', reason: 'quiet_hours' }],
      });
      expect(new Date(held.next_attempt_at).toISOString()).toBe(until);
      expect(await remindersOf(a.id)).toMatchObject([
        { status: 'held', reason: 'quiet_hours', channel: 'whatsapp' },
      ]);

      // The hours end: the same preference is tried again and WhatsApp delivers; email never gets a message.
      messenger.result = { status: 'sent' };
      await h.owner.query(
        `UPDATE appointment_reminder_runs SET next_attempt_at = now() - interval '1 minute'
          WHERE appointment_id = (SELECT id FROM appointments WHERE uuid = $1)`,
        [a.id],
      );
      await sweep.deliver();
      expect(sentFor(a.id).map((m) => m.channel)).toEqual(['whatsapp', 'whatsapp']);
      expect((await runsOf(a.id))[0]).toMatchObject({
        status: 'sent',
        channel: 'whatsapp',
        reason: null,
      });
    });

    it('a WhatsApp that cannot deliver does fall to email, but a held WhatsApp does not', async () => {
      const skip = await dueNow();
      messenger.byChannel = { whatsapp: { status: 'skipped', reason: 'no_consent' } };
      await sweep.sweep();
      await sweep.deliver();
      expect(sentFor(skip.a.id).map((m) => m.channel)).toEqual(['whatsapp', 'email']);

      const hold = await dueNow();
      messenger.sent = [];
      messenger.byChannel = {
        whatsapp: { status: 'held', reason: 'channel_unavailable' },
      };
      await sweep.sweep();
      await sweep.deliver();
      expect(sentFor(hold.a.id).map((m) => m.channel)).toEqual(['whatsapp']);
      expect((await runsOf(hold.a.id))[0]).toMatchObject({
        status: 'held',
        reason: 'channel_unavailable',
      });
    });
  });

  describe('a cancel stops every step that is waiting', () => {
    it('the 24 hour, 2 hour and 15 minute steps, a held after-visit step and the event step all become cancelled / booking_cancelled', async () => {
      const { type, a } = await book('Cancel all', [
        { offsetMinutes: 1440, isActive: true },
        { offsetMinutes: 120, isActive: true, skipIfConfirmed: true },
        { offsetMinutes: 15, isActive: true },
        { kind: 'after', offsetMinutes: 60, isActive: true },
        { kind: 'event', offsetMinutes: 1, stepKind: 'no_show', isActive: true },
      ]);
      expect(type.reminders.map((r) => r.stepKind).sort()).toEqual(
        ['after_visit', 'no_show', 'reminder_15m', 'reminder_24h', 'reminder_2h'].sort(),
      );
      // Starts in 10 minutes, made two days ago: the three timed steps before the start are all due and claimed (pending).
      await arrange(a.id, 10, 2 * 24 * 60);
      expect(await sweep.sweep()).toBe(3);
      // A held after-visit run and a no-show run that a worker had just taken, as the other waiting states.
      const row = (
        await h.owner.query(
          `SELECT a.id, a.org_id, a.armed_at FROM appointments a WHERE a.uuid = $1`,
          [a.id],
        )
      ).rows[0];
      for (const [step, status, offset, kind] of [
        ['after_visit', 'held', 60, 'after'],
        ['no_show', 'sending', 1, 'event'],
      ] as const) {
        await h.owner.query(
          `INSERT INTO appointment_reminder_runs
             (org_id, appointment_id, reminder_id, kind, step_kind, offset_minutes, due_at, armed_at, status, next_attempt_at, reason, locked_at)
           SELECT $1, $2, r.id, $3, $4, $5, now(), $6, $7, now() + interval '1 hour',
                  CASE WHEN $7 = 'held' THEN 'quiet_hours' END, CASE WHEN $7 = 'sending' THEN now() END
             FROM booking_reminders r WHERE r.org_id = $1 AND r.step_kind = $4
              AND r.booking_type_id = (SELECT booking_type_id FROM appointments WHERE id = $2)`,
          [row.org_id, row.id, kind, step, offset, row.armed_at, status],
        );
      }
      expect((await runsOf(a.id)).map((r) => r.status).sort()).toEqual([
        'held',
        'pending',
        'pending',
        'pending',
        'sending',
      ]);

      const cancel = await api.post(t.admin, `/v2/appointments/${a.id}/cancel`, { reason: 'test' });
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
      const runs = await runsOf(a.id);
      expect(runs).toHaveLength(5);
      expect(runs.map((r) => [r.status, r.reason])).toEqual(
        Array.from({ length: 5 }, () => ['cancelled', 'booking_cancelled']),
      );
      expect(runs.map((r) => r.step_kind).sort()).toEqual(
        ['after_visit', 'no_show', 'reminder_15m', 'reminder_24h', 'reminder_2h'].sort(),
      );
      // Nothing is left to take, nothing is sent, and a later sweep claims nothing for it.
      await sweep.deliver();
      expect(sentFor(a.id)).toEqual([]);
      expect(await sweep.sweep()).toBe(0);
    });

    it('a step that was already sent stays sent; only what was waiting is cancelled', async () => {
      const { a } = await book('Cancel after send', [
        { offsetMinutes: 1440, isActive: true },
        { offsetMinutes: 120, isActive: true },
      ]);
      await arrange(a.id, 100, 2 * 24 * 60);
      await sweep.sweep();
      // Only the 24 hour step is delivered; the 2 hour step is claimed but waits.
      await h.owner.query(
        `UPDATE appointment_reminder_runs SET next_attempt_at = now() + interval '1 hour'
          WHERE offset_minutes = 120 AND appointment_id = (SELECT id FROM appointments WHERE uuid = $1)`,
        [a.id],
      );
      await sweep.deliver();
      expect(sentFor(a.id)).toHaveLength(1);
      const cancel = await api.post(t.admin, `/v2/appointments/${a.id}/cancel`, { reason: 'test' });
      expect(cancel.status).toBe(200);
      expect((await runsOf(a.id)).map((r) => [r.step_kind, r.status, r.reason])).toEqual([
        ['reminder_24h', 'sent', null],
        ['reminder_2h', 'cancelled', 'booking_cancelled'],
      ]);
    });
  });

  describe('the skip rules of the steps', () => {
    it('the 15 minute reminder is skipped as no_join_link without a meet URL, and goes with one', async () => {
      const without = await book('No link', [{ offsetMinutes: 15, isActive: true }]);
      const withLink = await book('With link', [{ offsetMinutes: 15, isActive: true }]);
      for (const x of [without, withLink]) await arrange(x.a.id, 10, 600);
      await h.owner.query(
        `UPDATE appointments SET meet_url = 'https://meet.example.com/abc-defg' WHERE uuid = $1`,
        [withLink.a.id],
      );
      await sweep.sweep();
      await sweep.deliver();
      expect(sentFor(without.a.id)).toEqual([]);
      expect((await runsOf(without.a.id))[0]).toMatchObject({
        step_kind: 'reminder_15m',
        status: 'skipped',
        reason: 'no_join_link',
      });
      expect(sentFor(withLink.a.id).map((m) => m.channel)).toEqual(['whatsapp']);
      expect(sentFor(withLink.a.id)[0]!.variables?.join_link).toBe(
        'https://meet.example.com/abc-defg',
      );
      expect((await runsOf(withLink.a.id))[0]).toMatchObject({
        status: 'sent',
        channel: 'whatsapp',
      });
      expect(await remindersOf(without.a.id)).toMatchObject([
        { stepKind: 'reminder_15m', status: 'skipped', reason: 'no_join_link' },
      ]);
    });

    it('skip_if_confirmed skips the 2 hour reminder once the customer confirmed, and only then', async () => {
      const confirmed = await book('Confirmed', [
        { offsetMinutes: 120, isActive: true, skipIfConfirmed: true },
      ]);
      const unconfirmed = await book('Not confirmed', [
        { offsetMinutes: 120, isActive: true, skipIfConfirmed: true },
      ]);
      const noRule = await book('Rule off', [{ offsetMinutes: 120, isActive: true }]);
      for (const x of [confirmed, unconfirmed, noRule]) await arrange(x.a.id, 100, 600);
      await h.owner.query(
        `UPDATE appointments SET customer_confirmed_at = now() WHERE uuid = ANY($1::uuid[])`,
        [[confirmed.a.id, noRule.a.id]],
      );
      await sweep.sweep();
      await sweep.deliver();
      expect((await runsOf(confirmed.a.id))[0]).toMatchObject({
        step_kind: 'reminder_2h',
        status: 'skipped',
        reason: 'already_confirmed',
      });
      expect(sentFor(confirmed.a.id)).toEqual([]);
      expect(sentFor(unconfirmed.a.id)).toHaveLength(1);
      // The switch is per step: without skip_if_confirmed the reminder still goes to a confirmed customer.
      expect(sentFor(noRule.a.id)).toHaveLength(1);
    });

    it('a reminder is never sent at or after the start, nor in the last two minutes before it', async () => {
      const lastMinute = await book('Last minute', [{ offsetMinutes: 60, isActive: true }]);
      const began = await book('Began', [{ offsetMinutes: 60, isActive: true }]);
      await arrange(lastMinute.a.id, 30, 600);
      await arrange(began.a.id, 30, 600);
      await sweep.sweep();
      // The claim was made while the start was ahead; delivery happens when it is one minute away / has begun.
      await arrange(lastMinute.a.id, 1, null);
      await arrange(began.a.id, -5, null, 30);
      await sweep.deliver();
      expect(sentFor(lastMinute.a.id)).toEqual([]);
      expect(sentFor(began.a.id)).toEqual([]);
      expect((await runsOf(lastMinute.a.id))[0]).toMatchObject({
        status: 'skipped',
        reason: 'started',
      });
      expect((await runsOf(began.a.id))[0]).toMatchObject({ status: 'skipped', reason: 'started' });
    });
  });

  describe('a rule that only had SMS (rows from before SMS was removed)', () => {
    it('is delivered as WhatsApp, then email, and the messenger is never asked for SMS', async () => {
      const { type, a } = await book('Was SMS', [
        { offsetMinutes: 60, isActive: true, channels: ['email'] },
      ]);
      await h.owner.query(
        `UPDATE booking_reminders SET channels = ARRAY['sms']::text[]
          WHERE booking_type_id = (SELECT id FROM booking_types WHERE uuid = $1)`,
        [type.id],
      );
      const read = await api.as(t.admin).get(`/v2/booking-types/${type.id}`);
      expect(read.body.reminders[0].channels).toEqual(['whatsapp', 'email']);

      messenger.byChannel = { whatsapp: { status: 'skipped', reason: 'no_consent' } };
      await arrange(a.id, 30, 600);
      await sweep.sweep();
      await sweep.deliver();
      expect(sentFor(a.id).map((m) => m.channel)).toEqual(['whatsapp', 'email']);
      expect(messenger.sent.map((m) => m.channel as string)).not.toContain('sms');
      expect((await runsOf(a.id))[0]).toMatchObject({
        status: 'sent',
        channel: 'email',
        attempt_log: [
          { channel: 'whatsapp', status: 'skipped', reason: 'no_consent' },
          { channel: 'email', status: 'sent', reason: null },
        ],
      });
    });

    it('a rule that listed SMS first keeps its other channels in their order', async () => {
      const { type, a } = await book('SMS then email', [
        { offsetMinutes: 60, isActive: true, channels: ['email', 'whatsapp'] },
      ]);
      await h.owner.query(
        `UPDATE booking_reminders SET channels = ARRAY['sms', 'email']::text[]
          WHERE booking_type_id = (SELECT id FROM booking_types WHERE uuid = $1)`,
        [type.id],
      );
      await arrange(a.id, 30, 600);
      await sweep.sweep();
      await sweep.deliver();
      expect(sentFor(a.id).map((m) => m.channel)).toEqual(['email']);
      expect((await runsOf(a.id))[0]).toMatchObject({ status: 'sent', channel: 'email' });
    });
  });

  describe('the event steps are claimed once and delivered by the message consumer', () => {
    it('the confirmation step goes WhatsApp then email with a log, once however often the event is delivered, and the single legacy confirmation is not sent as well', async () => {
      const { a } = await book('Confirm step', [
        { kind: 'event', offsetMinutes: 0, stepKind: 'confirmation', isActive: true },
      ]);
      const ev = (await outbox(t.orgId, 'appointment.booked', a.id))[0]!;
      expect(ev).toBeDefined();
      messenger.byChannel = { whatsapp: { status: 'skipped', reason: 'template_unavailable' } };
      await consumer.handle(ev);
      expect(sentFor(a.id).map((m) => [m.event, m.channel])).toEqual([
        ['confirmation', 'whatsapp'],
        ['confirmation', 'email'],
      ]);
      expect(await runsOf(a.id)).toMatchObject([
        {
          kind: 'event',
          step_kind: 'confirmation',
          status: 'sent',
          channel: 'email',
          attempt_log: [
            { channel: 'whatsapp', status: 'skipped', reason: 'template_unavailable' },
            { channel: 'email', status: 'sent', reason: null },
          ],
        },
      ]);
      // The outbox is at-least-once: the same event again sends nothing more.
      await consumer.handle(ev);
      expect(sentFor(a.id)).toHaveLength(2);
      expect(await runsOf(a.id)).toHaveLength(1);
    });

    it('a type without the confirmation step keeps the single confirmation (WhatsApp, then email when it cannot)', async () => {
      const { a } = await book('No confirm step', [{ offsetMinutes: 60, isActive: true }]);
      const ev = (await outbox(t.orgId, 'appointment.booked', a.id))[0]!;
      await consumer.handle(ev);
      expect(sentFor(a.id).map((m) => [m.event, m.channel])).toEqual([
        ['confirmation', 'whatsapp'],
      ]);
      expect(await runsOf(a.id)).toEqual([]);
    });

    it('the no-show step is sent when the visit is marked no-show, and not for a visit that was not', async () => {
      const marked = await book('No-show step', [
        { kind: 'event', offsetMinutes: 1, stepKind: 'no_show', isActive: true },
      ]);
      const other = await book('No-show step, not marked', [
        { kind: 'event', offsetMinutes: 1, stepKind: 'no_show', isActive: true },
      ]);
      await arrange(marked.a.id, -60, null, 30);
      const done = await api.post(t.admin, `/v2/appointments/${marked.a.id}/no-show`, {});
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      const ev = (await outbox(t.orgId, 'appointment.no_show', marked.a.id))[0]!;
      expect(ev).toBeDefined();
      await consumer.handle(ev);
      expect(sentFor(marked.a.id).map((m) => [m.event, m.channel])).toEqual([
        ['no_show', 'whatsapp'],
      ]);
      expect(await runsOf(marked.a.id)).toMatchObject([
        { kind: 'event', step_kind: 'no_show', status: 'sent', channel: 'whatsapp' },
      ]);
      // The same event for a booking that is not a no-show finds the run's gate closed: nothing is sent.
      const fake: OutboxEvent = {
        ...ev,
        id: '999999999',
        payload: { ...ev.payload, uuid: other.a.id },
      };
      await consumer.handle(fake);
      expect(sentFor(other.a.id)).toEqual([]);
      expect(await runsOf(other.a.id)).toMatchObject([
        { step_kind: 'no_show', status: 'cancelled', reason: 'booking_not_confirmed' },
      ]);
    });
  });
});
