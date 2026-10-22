import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type {
  AppointmentMessenger,
  BookingMessage,
  BookingMessageResult,
} from '../../../src/infra/providers/appointments-booking';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { ContactActivitiesRepository } from '../../../src/modules/crm';
import type { InboundStoredEvent } from '../../../src/modules/chat-conversations/inbound-hooks';
import { AppointmentReminderService } from '../../../src/modules/appointments-booking/appointment-reminder.service';
import { AppointmentReminderSweepService } from '../../../src/modules/appointments-booking/appointment-reminder-sweep.service';
import { AppointmentRemindersRepository } from '../../../src/modules/appointments-booking/appointment-reminders.repository';
import { AppointmentsRepository } from '../../../src/modules/appointments-booking/appointments.repository';
import { AppointmentsSupport } from '../../../src/modules/appointments-booking/appointments.support';
import { BookingService } from '../../../src/modules/appointments-booking/booking.service';
import { ReminderPlan } from '../../../src/modules/appointments-booking/reminder-plan';
import { ReminderReplyService } from '../../../src/modules/appointments-booking/reminder-reply.service';
import {
  AppointmentsApi,
  buildReminderService,
  startHarness,
  type Harness,
  type Tenant,
} from './support';

/**
 * The upgrade tier of the Appointments app (owner decision 2026-10-22), through the real API and database, the customer messenger
 * replaced by a fake. The two plan features `appointment_confirm_buttons` and `appointment_rebook_steps` are switched with workspace
 * overrides (a harness workspace is on a plan with no catalogue row, so nothing is locked until an override says so):
 *  - saving a step (422 PLAN_FEATURE_LOCKED when it needs a part the plan lacks, nothing deleted on a downgrade);
 *  - packs (applied without the locked parts, and the answer says so);
 *  - the report (button counts only with the buttons, the fallback count) and the appointment's own history;
 *  - the Confirm / Reschedule / Cancel buttons (signed one-time tokens);
 *  - the worker at send time; the test email to a typed address.
 */
let h: Harness;
let api: AppointmentsApi;
let db: DatabaseService;
let sweep: AppointmentReminderSweepService;
let service: AppointmentReminderService;
let messenger: FakeMessenger;
let replies: ReminderReplyService;
const spoken: Array<{ conversationId: string; body: string }> = [];

class FakeMessenger implements AppointmentMessenger {
  readonly name = 'fake';
  sent: BookingMessage[] = [];
  result: BookingMessageResult = { status: 'sent' };
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
  messenger = new FakeMessenger();
  service = buildReminderService(h, messenger);
  sweep = new AppointmentReminderSweepService(
    db,
    h.app.get(OutboxService),
    h.app.get(AppointmentRemindersRepository),
    service,
  );
  const get = <T>(token: new (...a: never[]) => T): T => h.app.get(token, { strict: false });
  replies = new ReminderReplyService(
    db,
    {} as never,
    get(CryptoService),
    get(AppointmentRemindersRepository),
    get(AppointmentsRepository),
    get(BookingService),
    get(AppointmentsSupport),
    get(ContactActivitiesRepository),
    get(ReminderPlan),
    {
      enqueueOutbound: async (i: { conversationId: string; content: { body: string } }) => {
        spoken.push({ conversationId: i.conversationId, body: i.content.body });
      },
    } as never,
  );
}, 600_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;
type Rule = Record<string, unknown>;

/** Workspace overrides of the two upgrade flags (and optionally the app flag). Overrides beat the plan in both directions. */
async function flags(
  t: Tenant,
  v: { buttons: boolean; rebook: boolean; booking?: boolean },
): Promise<void> {
  await h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
    t.orgId,
    JSON.stringify({
      features: {
        appointment_confirm_buttons: v.buttons,
        appointment_rebook_steps: v.rebook,
        ...(v.booking === undefined ? {} : { appointment_booking: v.booking }),
      },
    }),
  ]);
}

const timed = (extra: Rule = {}): Rule => ({
  kind: 'before',
  stepKind: 'reminder_24h',
  offsetMinutes: 1440,
  isActive: true,
  channels: ['whatsapp', 'email'],
  ...extra,
});
const rebook = (extra: Rule = {}): Rule => ({
  kind: 'after',
  stepKind: 'rebook',
  offsetMinutes: 30 * 1440,
  isActive: true,
  channels: ['email'],
  ...extra,
});
const create = (t: Tenant, reminders: Rule[]) =>
  api.post(t.admin, '/v2/booking-types', {
    name: `Gate ${Math.random().toString(36).slice(2, 7)}`,
    durationMinutes: 30,
    minNoticeMinutes: 0,
    maxAdvanceDays: 30,
    timezone: 'UTC',
    availability: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      from: '00:00',
      to: '23:59',
    })),
    reminders,
  });

describe('saving a step', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('gsave');
  });

  it('flags off: switching the buttons or a rebook step ON is 422 PLAN_FEATURE_LOCKED; the same steps saved OFF, and plain reminders, are fine', async () => {
    await flags(t, { buttons: false, rebook: false });
    const withButtons = await create(t, [timed({ buttonsEnabled: true })]);
    expect(withButtons.status).toBe(422);
    expect(code(withButtons)).toBe('PLAN_FEATURE_LOCKED');
    expect(withButtons.body.detail ?? withButtons.body.message ?? '').toMatch(
      /Appointments upgrade tier/,
    );
    const withRebook = await create(t, [rebook()]);
    expect(withRebook.status).toBe(422);
    expect(code(withRebook)).toBe('PLAN_FEATURE_LOCKED');

    const plain = await create(t, [timed(), rebook({ isActive: false })]);
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);
    expect(plain.body.reminders).toHaveLength(2);
  });

  it('flags on: both parts save', async () => {
    await flags(t, { buttons: true, rebook: true });
    const res = await create(t, [timed({ buttonsEnabled: true }), rebook()]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(
      res.body.reminders.find((r: { stepKind: string }) => r.stepKind === 'reminder_24h'),
    ).toMatchObject({ buttonsEnabled: true });
    expect(
      res.body.reminders.find((r: { stepKind: string }) => r.stepKind === 'rebook'),
    ).toMatchObject({ isActive: true });
  });

  it('only one flag on: that part saves and the other is refused', async () => {
    await flags(t, { buttons: true, rebook: false });
    expect((await create(t, [timed({ buttonsEnabled: true })])).status).toBe(201);
    expect(code(await create(t, [rebook()]))).toBe('PLAN_FEATURE_LOCKED');
    await flags(t, { buttons: false, rebook: true });
    expect((await create(t, [rebook()])).status).toBe(201);
    expect(code(await create(t, [timed({ buttonsEnabled: true })]))).toBe('PLAN_FEATURE_LOCKED');
  });

  it('both flags on but the app flag off: still 422, the whole area is locked', async () => {
    await flags(t, { buttons: true, rebook: true, booking: false });
    const res = await create(t, [timed({ buttonsEnabled: true })]);
    expect(res.status).toBe(422);
    expect(code(res)).toBe('PLAN_FEATURE_LOCKED');
  });

  it('a downgrade deletes nothing: stored steps read back, an unchanged step saves, new switching-on is refused', async () => {
    await flags(t, { buttons: true, rebook: true });
    const made = await create(t, [timed({ buttonsEnabled: true }), rebook()]);
    expect(made.status).toBe(201);
    await flags(t, { buttons: false, rebook: false });

    const read = await api.as(t.admin).get(`/v2/booking-types/${made.body.id}`);
    expect(read.status).toBe(200);
    expect(
      read.body.reminders.find((r: { stepKind: string }) => r.stepKind === 'reminder_24h'),
    ).toMatchObject({ buttonsEnabled: true, isActive: true });
    expect(
      read.body.reminders.find((r: { stepKind: string }) => r.stepKind === 'rebook'),
    ).toMatchObject({ isActive: true });

    // Saving the same steps again (the owner edits the type's name, the editor sends the steps back) is allowed.
    const same = await api
      .as(t.admin)
      .patch(`/v2/booking-types/${made.body.id}`)
      .send({
        rowVersion: read.body.rowVersion,
        reminders: read.body.reminders.map((r: Rule) => ({
          id: r.id,
          kind: r.kind,
          stepKind: r.stepKind,
          offsetMinutes: r.offsetMinutes,
          isActive: r.isActive,
          channels: r.channels,
          buttonsEnabled: r.buttonsEnabled,
        })),
      });
    expect(same.status, JSON.stringify(same.body)).toBe(200);

    // Turning the buttons off is always allowed.
    const off = await api
      .as(t.admin)
      .patch(`/v2/booking-types/${made.body.id}`)
      .send({
        rowVersion: same.body.rowVersion,
        reminders: same.body.reminders.map((r: Rule) => ({
          id: r.id,
          kind: r.kind,
          stepKind: r.stepKind,
          offsetMinutes: r.offsetMinutes,
          isActive: r.stepKind === 'rebook' ? false : r.isActive,
          channels: r.channels,
          buttonsEnabled: false,
        })),
      });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
  });
});

describe('packs', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('gpack');
  });

  it('flags off: the preview and the apply both name what the plan leaves out, and the pack still applies', async () => {
    await flags(t, { buttons: false, rebook: false });
    const type = await api.type(t.admin, { name: 'Pack off' });
    const preview = await api.post(t.admin, '/v2/appointment-reminder-packs/clinic/preview', {
      bookingTypeId: type.id,
      language: 'en',
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.withheld).toEqual(
      expect.arrayContaining([
        { stepKind: 'reminder_24h', part: 'buttons' },
        { stepKind: 'rebook', part: 'rebook' },
      ]),
    );
    const adopt = await api.post(t.admin, '/v2/appointment-reminder-packs/clinic/adopt', {
      bookingTypeId: type.id,
      language: 'en',
      confirmReplace: true,
      submitToMeta: false,
    });
    expect(adopt.status, JSON.stringify(adopt.body)).toBe(200);
    expect(adopt.body.withheld).toEqual(preview.body.withheld);
    const rebookStep = adopt.body.reminders.find(
      (r: { stepKind: string }) => r.stepKind === 'rebook',
    );
    expect(rebookStep).toMatchObject({ isActive: false });
    expect(adopt.body.reminders.every((r: { buttonsEnabled: boolean }) => !r.buttonsEnabled)).toBe(
      true,
    );
    expect(adopt.body.reminders.length).toBeGreaterThan(2);
  });

  it('flags on: nothing is left out', async () => {
    await flags(t, { buttons: true, rebook: true });
    const type = await api.type(t.admin, { name: 'Pack on' });
    const preview = await api.post(t.admin, '/v2/appointment-reminder-packs/clinic/preview', {
      bookingTypeId: type.id,
      language: 'en',
    });
    expect(preview.body.withheld).toEqual([]);
    const adopt = await api.post(t.admin, '/v2/appointment-reminder-packs/dental/adopt', {
      bookingTypeId: type.id,
      language: 'hi',
      confirmReplace: true,
      submitToMeta: false,
    });
    expect(adopt.status, JSON.stringify(adopt.body)).toBe(200);
    expect(adopt.body.withheld).toEqual([]);
  });

  it('the pack list is readable by a viewer; applying needs the right to edit booking types', async () => {
    const viewer = await api.member(t, 'gpackviewer', [['record.booking-types.read']]);
    const list = await api.as(viewer.token).get('/v2/appointment-reminder-packs');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(7);
    const type = await api.type(t.admin, { name: 'Pack viewer' });
    const adopt = await api.post(viewer.token, '/v2/appointment-reminder-packs/clinic/adopt', {
      bookingTypeId: type.id,
      language: 'en',
    });
    expect(adopt.status).toBe(403);
  });
});

describe('the report, the history and the send', () => {
  let t: Tenant;
  const sentFor = (uuid: string) => messenger.sent.filter((m) => m.appointmentId === uuid);

  beforeAll(async () => {
    t = await api.signup('grep');
    await flags(t, { buttons: true, rebook: true });
    await sweep.sweep();
    await sweep.deliver();
  });
  beforeEach(() => {
    messenger.sent = [];
    messenger.result = { status: 'sent' };
    messenger.byChannel = {};
  });

  async function book(rules: Rule[]) {
    const created = await create(t, rules);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const slots = await api.slots(t.admin, created.body.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: created.body.id,
      startsAt: slots[0]!.start,
      invitee: {
        name: 'Rita',
        phone: `+9198444${Math.floor(10000 + Math.random() * 89999)}`,
        email: `rita${Math.floor(Math.random() * 1e6)}@example.com`,
      },
    });
    return { type: created.body as { id: string }, a };
  }
  const arrange = (id: string, startInMin: number) =>
    h.owner.query(
      `UPDATE appointments SET starts_at = now() + ($2 || ' minutes')::interval,
                               ends_at = now() + ($2 || ' minutes')::interval + interval '30 minutes',
                               armed_at = now() - interval '600 minutes'
       WHERE uuid = $1`,
      [id, String(startInMin)],
    );
  const runsOf = async (uuid: string) =>
    (
      await h.owner.query(
        `SELECT r.id, r.status, r.reason, r.channel, r.attempt_log
           FROM appointment_reminder_runs r JOIN appointments a ON a.org_id = r.org_id AND a.id = r.appointment_id
          WHERE a.uuid = $1 ORDER BY r.id`,
        [uuid],
      )
    ).rows;
  const report = (typeId: string) =>
    api.as(t.admin).get(`/v2/appointment-reminder-report?bookingTypeId=${typeId}`);

  it('counts the fallback, and the button taps only while the plan has the buttons', async () => {
    const { type, a } = await book([timed({ offsetMinutes: 60, stepKind: 'reminder' })]);
    await arrange(a.id, 30);
    messenger.byChannel = { whatsapp: { status: 'skipped', reason: 'template_unavailable' } };
    await sweep.sweep();
    await sweep.deliver();
    expect(sentFor(a.id).map((m) => m.channel)).toEqual(['whatsapp', 'email']);

    // The customer tapped Confirm and Reschedule on this message.
    const [run] = await runsOf(a.id);
    await h.owner.query(
      `UPDATE appointment_reminder_runs SET reply_state = $2::jsonb WHERE id = $1`,
      [
        run.id,
        JSON.stringify({
          confirm: { nonce: 'n1', usedAt: new Date().toISOString(), outcome: 'confirmed' },
          reschedule: { nonce: 'n2', usedAt: new Date().toISOString(), outcome: 'reschedule_link' },
          cancel: { nonce: 'n3', usedAt: null, outcome: null },
        }),
      ],
    );

    const on = await report(type.id);
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.buttonsIncluded).toBe(true);
    const step = on.body.data[0].steps[0];
    expect(step).toMatchObject({
      sent: 1,
      fallbackUsed: 1,
      buttons: { confirmed: 1, rescheduled: 1, cancelled: 0 },
    });
    // Counts only: no address, number or text anywhere in the report.
    expect(JSON.stringify(on.body)).not.toMatch(/@example|\+9198|Rita/);

    await flags(t, { buttons: false, rebook: true });
    const off = await report(type.id);
    expect(off.body.buttonsIncluded).toBe(false);
    expect(off.body.data[0].steps[0]).toMatchObject({ sent: 1, fallbackUsed: 1, buttons: null });
    await flags(t, { buttons: true, rebook: true });
  });

  it('the appointment lists the channels tried, the fallback and the button replies (every plan)', async () => {
    const { a } = await book([timed({ offsetMinutes: 60, stepKind: 'reminder' })]);
    await arrange(a.id, 30);
    messenger.byChannel = { whatsapp: { status: 'failed', reason: 'provider_error' } };
    await sweep.sweep();
    await sweep.deliver();
    const [run] = await runsOf(a.id);
    await h.owner.query(
      `UPDATE appointment_reminder_runs SET reply_state = '{"cancel":{"nonce":"x","usedAt":"2030-01-01T10:00:00.000Z","outcome":"cancelled"}}'::jsonb WHERE id = $1`,
      [run.id],
    );
    for (const f of [true, false]) {
      await flags(t, { buttons: f, rebook: f });
      const shown = (await api.appt(t.admin, a.id)) as unknown as {
        reminders: Array<{
          channel: string;
          attempts: Array<{ channel: string; status: string }>;
          buttonReplies: Array<{ action: string; at: string }>;
        }>;
      };
      expect(shown.reminders[0]).toMatchObject({
        channel: 'email',
        attempts: [
          { channel: 'whatsapp', status: 'failed' },
          { channel: 'email', status: 'sent' },
        ],
        buttonReplies: [{ action: 'cancel', at: '2030-01-01T10:00:00.000Z' }],
      });
    }
    await flags(t, { buttons: true, rebook: true });
  });

  it('a rebook step on a plan without it is skipped with plan_feature_locked, and sends again when the plan has it', async () => {
    const { a } = await book([rebook({ offsetMinutes: 5 })]);
    await h.owner.query(
      `UPDATE appointments SET starts_at = now() - interval '40 minutes', ends_at = now() - interval '10 minutes',
                               armed_at = now() - interval '2 days', status = 'completed' WHERE uuid = $1`,
      [a.id],
    );
    await flags(t, { buttons: true, rebook: false });
    await sweep.sweep();
    await sweep.deliver();
    expect(sentFor(a.id)).toEqual([]);
    expect((await runsOf(a.id))[0]).toMatchObject({
      status: 'skipped',
      reason: 'plan_feature_locked',
    });
    await flags(t, { buttons: true, rebook: true });
  });

  it('the buttons go out with signed payloads only while the plan has them', async () => {
    const tpl = await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status)
       VALUES ($1, 'gate_reminder', 'Hi {{1}}', 'standard', 'approved') RETURNING uuid`,
      [t.orgId],
    );
    const waTemplateId = tpl.rows[0].uuid as string;
    const rule = (): Rule =>
      timed({
        offsetMinutes: 60,
        stepKind: 'reminder',
        channels: ['whatsapp'],
        waTemplateId,
        buttonsEnabled: true,
      });
    // The rule is saved while the plan has the buttons, then the plan is downgraded before the send.
    const withPlan = await book([rule()]);
    await arrange(withPlan.a.id, 30);
    await sweep.sweep();
    await sweep.deliver();
    const first = sentFor(withPlan.a.id).find((m) => m.channel === 'whatsapp');
    expect(first?.quickReplyPayloads).toHaveLength(3);
    for (const p of first!.quickReplyPayloads!) expect(p.startsWith('ap1:')).toBe(true);

    const downgraded = await book([rule()]);
    await flags(t, { buttons: false, rebook: true });
    await arrange(downgraded.a.id, 30);
    await sweep.sweep();
    await sweep.deliver();
    const second = sentFor(downgraded.a.id).find((m) => m.channel === 'whatsapp');
    expect(second).toBeDefined();
    expect(second!.quickReplyPayloads).toBeUndefined();
    // Nothing was deleted: the stored step still has its buttons on.
    const kept = await api.as(t.admin).get(`/v2/booking-types/${downgraded.type.id}`);
    expect(kept.body.reminders[0]).toMatchObject({ buttonsEnabled: true, isActive: true });
    await flags(t, { buttons: true, rebook: true });
  });
});

describe('the Confirm / Reschedule / Cancel buttons (signed one-time tokens)', () => {
  let t: Tenant;
  let other: Tenant;

  beforeAll(async () => {
    t = await api.signup('gbtn');
    other = await api.signup('gbtno');
    await flags(t, { buttons: true, rebook: true });
  });
  beforeEach(() => {
    spoken.length = 0;
  });

  async function setup() {
    const created = await create(t, [timed({ offsetMinutes: 60, stepKind: 'reminder' })]);
    const slots = await api.slots(t.admin, created.body.id);
    const a = await api.staffBook(t.admin, {
      bookingTypeId: created.body.id,
      startsAt: slots[0]!.start,
      invitee: {
        name: 'Rita',
        phone: `+9198555${Math.floor(10000 + Math.random() * 89999)}`,
        email: `rita${Math.floor(Math.random() * 1e6)}@example.com`,
      },
    });
    await h.owner.query(
      `UPDATE appointments SET starts_at = now() + interval '30 minutes', ends_at = now() + interval '60 minutes',
                               armed_at = now() - interval '600 minutes', status = 'confirmed' WHERE uuid = $1`,
      [a.id],
    );
    await sweep.sweep();
    const row = (
      await h.owner.query(
        `SELECT r.id AS run_id, a.contact_id, a.id AS appt_id FROM appointment_reminder_runs r
           JOIN appointments a ON a.org_id = r.org_id AND a.id = r.appointment_id WHERE a.uuid = $1`,
        [a.id],
      )
    ).rows[0];
    const payloads = await replies.payloadsFor(t.orgId, Number(row.run_id));
    const event = (payload: string, over: Partial<InboundStoredEvent> = {}): InboundStoredEvent =>
      ({
        orgId: t.orgId,
        channelId: 1,
        conversationId: 1,
        contactId: Number(row.contact_id),
        channelUuid: crypto.randomUUID(),
        channelKind: 'whatsapp',
        conversationUuid: crypto.randomUUID(),
        messageUuid: crypto.randomUUID(),
        peerKey: 'x',
        peerName: null,
        createdConversation: false,
        message: {
          kind: 'interactive',
          body: null,
          meta: { buttonPayload: payload },
          location: null,
          mediaKey: null,
        },
        ...over,
      }) as InboundStoredEvent;
    const state = async () =>
      (
        await h.owner.query(
          `SELECT status, customer_confirmed_at FROM appointments WHERE uuid = $1`,
          [a.id],
        )
      ).rows[0] as { status: string; customer_confirmed_at: Date | null };
    return { a, payloads, event, state };
  }

  it('Confirm records the customer, answers once, and a second tap changes nothing more', async () => {
    const { payloads, event, state } = await setup();
    expect(payloads).toHaveLength(3);
    expect(payloads.every((p) => p.startsWith('ap1:') && p.length <= 256)).toBe(true);
    expect(new Set(payloads).size).toBe(3);
    const first = await replies.onStored(event(payloads[0]!));
    expect(first).toMatchObject({ consumed: true, halt: true });
    const after = await state();
    expect(after.customer_confirmed_at).not.toBeNull();
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.body).toMatch(/confirmed/i);

    const stamp = after.customer_confirmed_at!.getTime();
    await replies.onStored(event(payloads[0]!));
    expect((await state()).customer_confirmed_at!.getTime()).toBe(stamp);
    expect(spoken).toHaveLength(2);
    expect(spoken[1]!.body).toBe(spoken[0]!.body);
  });

  it('Cancel cancels the booking; Reschedule changes nothing and sends the manage link', async () => {
    const one = await setup();
    await replies.onStored(one.event(one.payloads[1]!));
    expect((await one.state()).status).toBe('confirmed');
    expect(spoken[0]!.body).toMatch(/http/);

    const two = await setup();
    spoken.length = 0;
    await replies.onStored(two.event(two.payloads[2]!));
    expect((await two.state()).status).toBe('cancelled');
    expect(spoken[0]!.body).toMatch(/cancelled/i);
  });

  it('a forged, edited or foreign token does nothing and gets no answer; a button of someone else is left alone', async () => {
    const { payloads, event, state } = await setup();
    expect(await replies.onStored(event('ap1:not-a-real-token'))).toMatchObject({
      consumed: true,
      halt: true,
    });
    expect(await replies.onStored(event(`${payloads[0]!.slice(0, -4)}AAAA`))).toMatchObject({
      consumed: true,
      halt: true,
    });
    // another workspace's tap carrying this workspace's token
    expect(
      await replies.onStored(event(payloads[0]!, { orgId: other.orgId } as never)),
    ).toMatchObject({ consumed: true, halt: true });
    // a flow's own button is not ours
    expect(await replies.onStored(event('flow:next'))).toEqual({ consumed: false });
    expect((await state()).customer_confirmed_at).toBeNull();
    expect(spoken).toHaveLength(0);
  });

  it('a tap from a different contact does nothing (a forwarded button)', async () => {
    const { payloads, event, state } = await setup();
    await replies.onStored(event(payloads[0]!, { contactId: 999_999_999 } as never));
    expect((await state()).customer_confirmed_at).toBeNull();
    expect(spoken).toHaveLength(0);
  });

  it('expires at the start, and a booking that is no longer open cannot be changed from a button', async () => {
    const { a, payloads, event, state } = await setup();
    await h.owner.query(
      `UPDATE appointments SET starts_at = now() - interval '5 minutes', ends_at = now() + interval '25 minutes' WHERE uuid = $1`,
      [a.id],
    );
    await replies.onStored(event(payloads[0]!));
    expect((await state()).customer_confirmed_at).toBeNull();
    expect(spoken).toHaveLength(1);

    const second = await setup();
    spoken.length = 0;
    await h.owner.query(`UPDATE appointments SET status = 'cancelled' WHERE uuid = $1`, [
      second.a.id,
    ]);
    await replies.onStored(second.event(second.payloads[0]!));
    expect((await second.state()).customer_confirmed_at).toBeNull();
  });

  it('a tap on a message sent before a downgrade still works (the customer got it under the old plan)', async () => {
    const { payloads, event, state } = await setup();
    await flags(t, { buttons: false, rebook: false });
    await replies.onStored(event(payloads[0]!));
    expect((await state()).customer_confirmed_at).not.toBeNull();
    await flags(t, { buttons: true, rebook: true });
  });
});

describe('the test email', () => {
  let t: Tenant;
  let type: { id: string; reminders: Array<{ id: string }> };

  beforeAll(async () => {
    t = await api.signup('gtest');
    const made = await create(t, [timed()]);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    type = made.body;
  });

  const send = (token: string, body: Rule = {}) =>
    api.post(
      token,
      `/v2/booking-types/${type.id}/reminders/${type.reminders[0]!.id}/test-email`,
      body,
    );
  const events = async () =>
    (
      await h.owner.query(
        `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'appointment.reminder_test_requested' ORDER BY id`,
        [t.orgId],
      )
    ).rows.map((r) => r.payload as Record<string, unknown>);

  it('goes to the signed-in user by default, with ids only in the event', async () => {
    const res = await send(t.admin);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({ status: 'queued' });
    const [e] = await events();
    expect(e).not.toHaveProperty('to');
    expect(JSON.stringify(e)).not.toMatch(/@/);
  });

  it('goes to a typed address, answers it masked, and refuses one that is not an address', async () => {
    const res = await send(t.admin, { to: 'Colleague@Example.org' });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({ status: 'queued', sentTo: 'c***@example.org' });
    expect((await events()).some((e) => e.to === 'colleague@example.org')).toBe(true);
    const bad = await send(t.admin, { to: 'not-an-address' });
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('VALIDATION_FAILED');
  });

  it('needs the right to edit booking types, and is limited to ten an hour per workspace', async () => {
    const viewer = await api.member(t, 'gtestviewer', [['record.booking-types.read']]);
    expect((await send(viewer.token)).status).toBe(403);
    const have = (await events()).length;
    for (let i = have; i < 10; i++) {
      expect((await send(t.admin, { to: `person${i}@example.org` })).status).toBe(202);
    }
    const over = await send(t.admin, { to: 'late@example.org' });
    expect(over.status).toBe(429);
    expect(code(over)).toBe('RATE_LIMITED');
  });
});
