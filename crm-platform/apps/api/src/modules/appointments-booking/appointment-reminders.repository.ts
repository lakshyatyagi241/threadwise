import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  defaultStepKind,
  type BookingReminderChannel,
  type BookingReminderKind,
  type BookingReminderRecordChannel,
  type BookingReminderStepKind,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  FOLLOW_UP_GRACE_MS,
  REMINDER_STALE_LOCK_MS,
  type AttemptEntry,
  type ReminderReason,
  type RunStatus,
} from './appointment-reminder.rules';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);

/** The three buttons of a reminder, and what a run remembers of each: a random nonce, when it was used and what came of it. */
export type ReplyAction = 'confirm' | 'reschedule' | 'cancel';
export interface ReplyEntry {
  nonce: string;
  usedAt: string | null;
  outcome: string | null;
}
export type ReplyState = Partial<Record<ReplyAction, ReplyEntry>>;

export type DeliveryState = 'unknown' | 'delivered' | 'failed' | 'undelivered';

/** A run the sweep has just claimed (for the outbox announcement). */
export interface ClaimedRun {
  orgId: number;
  runId: number;
  appointmentId: number;
  appointmentUuid: string;
  kind: BookingReminderKind;
  stepKind: BookingReminderStepKind;
  offsetMinutes: number;
  dueAt: Date;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  bookingTypeUuid: string | null;
}

export interface RunRow {
  id: number;
  appointmentId: number;
  reminderId: number | null;
  kind: BookingReminderKind;
  stepKind: BookingReminderStepKind | null;
  offsetMinutes: number;
  dueAt: Date;
  armedAt: Date;
  status: RunStatus;
  reason: string | null;
  channel: BookingReminderRecordChannel | null;
  attempts: number;
  attemptLog: AttemptEntry[];
  nextAttemptAt: Date;
  sentAt: Date | null;
  messageRef: string | null;
  delivery: DeliveryState;
  deliveredAt: Date | null;
}

/** The rule as it is now (what a run is delivered from). */
export interface RuleRow {
  id: number;
  uuid: string;
  bookingTypeId: number;
  isActive: boolean;
  kind: BookingReminderKind;
  stepKind: BookingReminderStepKind;
  offsetMinutes: number;
  label: string | null;
  channels: BookingReminderChannel[];
  subject: string | null;
  body: string | null;
  waTemplateUuid: string | null;
  /** The step's WhatsApp template body (numbered placeholders), for the free-text form inside the 24 hour window. */
  waTemplateBody: string | null;
  /** The language of the step's WhatsApp template (the language of the reply to a button tap). */
  waTemplateLanguage: string | null;
  buttonsEnabled: boolean;
  skipIfConfirmed: boolean;
  undeliveredFallbackMinutes: number | null;
  /** The word this step uses instead of the service's name, or null. */
  serviceLabel: string | null;
  /** The email message of the library this step sends, read now. Null = none chosen (or it was deleted). */
  library: { active: boolean; subject: string | null; body: string } | null;
}

const toLog = (v: unknown): AttemptEntry[] =>
  Array.isArray(v)
    ? (v as AttemptEntry[]).filter((e) => e && typeof e === 'object' && 'channel' in e)
    : [];

const toRun = (r: Raw): RunRow => ({
  id: Number(r.id),
  appointmentId: Number(r.appointment_id),
  reminderId: r.reminder_id === null || r.reminder_id === undefined ? null : Number(r.reminder_id),
  kind: r.kind as BookingReminderKind,
  stepKind: (r.step_kind as BookingReminderStepKind | null) ?? null,
  offsetMinutes: Number(r.offset_minutes),
  dueAt: new Date(r.due_at as string),
  armedAt: new Date(r.armed_at as string),
  status: r.status as RunStatus,
  reason: s(r.reason),
  channel: (r.channel as BookingReminderRecordChannel | null) ?? null,
  attempts: Number(r.attempts),
  attemptLog: toLog(r.attempt_log),
  nextAttemptAt: new Date(r.next_attempt_at as string),
  sentAt: d(r.sent_at),
  messageRef: s(r.message_ref),
  delivery: (r.delivery as DeliveryState | null) ?? 'unknown',
  deliveredAt: d(r.delivered_at),
});

/** Only the channels a step can name now; an old row that still lists the removed SMS reads without it. */
export const liveChannels = (v: unknown): BookingReminderChannel[] => {
  const list = ((v as string[] | null) ?? []).filter(
    (c): c is BookingReminderChannel => c === 'whatsapp' || c === 'email',
  );
  return list.length > 0 ? list : ['whatsapp', 'email'];
};

/**
 * Reminder runs (BL-283): the claim of "this rule for this booking at this arming", and what became of it. Every statement names the
 * workspace; the sweep statements run privileged (they span workspaces by definition) and say so.
 */
@Injectable()
export class AppointmentRemindersRepository {
  /**
   * Claims every (booking, active timed step) whose time has come and has no run yet for the booking's current arming. The unique key
   * makes it idempotent: however many workers run, an insert wins once. A before-step fires only for a confirmed booking that has not
   * started and only when its moment is later than the booking was made or last moved (`armed_at`); an after-visit step only for a
   * booking that is confirmed or completed and ended, within a day of its moment; a rebook step only for a COMPLETED booking, up to a
   * year after the visit and within a day of its moment. Event steps (the confirmation, the no-show message) are not claimed here: they
   * are created when the event happens (`claimEvent`). Privileged.
   */
  async claimDue(tx: Tx, limit: number): Promise<ClaimedRun[]> {
    const graceSeconds = Math.floor(FOLLOW_UP_GRACE_MS / 1000);
    const res = await tx.execute(sql`
      WITH due AS (
        SELECT a.org_id, a.id AS appointment_id, r.id AS reminder_id, r.kind, r.offset_minutes, a.armed_at, r.step_kind,
               CASE r.kind
                 WHEN 'before' THEN a.starts_at - make_interval(mins => r.offset_minutes)
                 ELSE a.ends_at + make_interval(mins => r.offset_minutes)
               END AS due_at
        FROM appointments a
        JOIN booking_reminders r
          ON r.org_id = a.org_id AND r.booking_type_id = a.booking_type_id AND r.is_active
        WHERE (
            (r.kind = 'before' AND a.status = 'confirmed'
              AND a.starts_at > now() AND a.starts_at <= now() + interval '31 days')
            OR
            (r.kind = 'after' AND r.step_kind IS DISTINCT FROM 'rebook' AND a.status IN ('confirmed', 'completed')
              AND a.ends_at <= now() AND a.ends_at > now() - interval '32 days')
            OR
            (r.kind = 'after' AND r.step_kind = 'rebook' AND a.status = 'completed'
              AND a.ends_at <= now() AND a.ends_at > now() - interval '400 days')
          )
      ), ready AS (
        SELECT * FROM due d
        WHERE d.due_at <= now()
          AND d.due_at > d.armed_at
          AND (d.kind = 'before' OR d.due_at > now() - make_interval(secs => ${graceSeconds}))
          AND NOT EXISTS (
            SELECT 1 FROM appointment_reminder_runs x
            WHERE x.org_id = d.org_id AND x.appointment_id = d.appointment_id AND x.kind = d.kind
              AND x.offset_minutes = d.offset_minutes AND x.armed_at = d.armed_at)
        ORDER BY d.due_at, d.appointment_id
        LIMIT ${limit}
      ), claimed AS (
        INSERT INTO appointment_reminder_runs
          (org_id, appointment_id, reminder_id, kind, step_kind, offset_minutes, due_at, armed_at, status, next_attempt_at)
        SELECT org_id, appointment_id, reminder_id, kind, step_kind, offset_minutes, due_at, armed_at, 'pending', now() FROM ready
        ON CONFLICT (org_id, appointment_id, kind, offset_minutes, armed_at) DO NOTHING
        RETURNING id, org_id, appointment_id, kind, step_kind, offset_minutes, due_at
      )
      SELECT c.id AS run_id, c.org_id, c.appointment_id, c.kind, c.step_kind, c.offset_minutes, c.due_at,
             a.uuid, a.starts_at, a.ends_at, a.timezone, bt.uuid AS type_uuid
      FROM claimed c
      JOIN appointments a ON a.org_id = c.org_id AND a.id = c.appointment_id
      LEFT JOIN booking_types bt ON bt.org_id = a.org_id AND bt.id = a.booking_type_id`);
    return (res.rows as Raw[]).map((r) => ({
      orgId: Number(r.org_id),
      runId: Number(r.run_id),
      appointmentId: Number(r.appointment_id),
      appointmentUuid: r.uuid as string,
      kind: r.kind as BookingReminderKind,
      stepKind:
        (r.step_kind as BookingReminderStepKind | null) ??
        defaultStepKind(r.kind as BookingReminderKind, Number(r.offset_minutes)),
      offsetMinutes: Number(r.offset_minutes),
      dueAt: new Date(r.due_at as string),
      startsAt: new Date(r.starts_at as string),
      endsAt: new Date(r.ends_at as string),
      timezone: r.timezone as string,
      bookingTypeUuid: s(r.type_uuid),
    }));
  }

  /**
   * An event step (the confirmation when a booking is confirmed, the no-show message when a visit is marked no-show) for one booking:
   * a run that is already taken (`sending`), so the caller delivers it at once. Null when the booking's type has no such step switched
   * on, or when this booking was already claimed for it at its current arming (the unique key makes it once). Runs under the caller's
   * tenant transaction.
   */
  async claimEvent(
    tx: Tx,
    orgId: number,
    appointmentId: number,
    step: 'confirmation' | 'no_show',
  ): Promise<number | null> {
    const res = await tx.execute(sql`
      INSERT INTO appointment_reminder_runs
        (org_id, appointment_id, reminder_id, kind, step_kind, offset_minutes, due_at, armed_at, status, next_attempt_at,
         locked_at, attempts)
      SELECT a.org_id, a.id, r.id, 'event', r.step_kind, r.offset_minutes, now(), a.armed_at, 'sending', now(), now(), 1
      FROM appointments a
      JOIN booking_reminders r
        ON r.org_id = a.org_id AND r.booking_type_id = a.booking_type_id AND r.is_active
       AND r.kind = 'event' AND r.step_kind = ${step}
      WHERE a.org_id = ${orgId} AND a.id = ${appointmentId}
      ON CONFLICT (org_id, appointment_id, kind, offset_minutes, armed_at) DO NOTHING
      RETURNING id`);
    const row = (res.rows as Raw[])[0];
    return row ? Number(row.id) : null;
  }

  /** Whether the booking's type has this event step switched on (the legacy confirmation is sent only when it does not). */
  async hasEventStep(
    tx: Tx,
    orgId: number,
    bookingTypeId: number,
    step: 'confirmation' | 'no_show',
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM booking_reminders
      WHERE org_id = ${orgId} AND booking_type_id = ${bookingTypeId} AND kind = 'event' AND step_kind = ${step} AND is_active
      LIMIT 1`);
    return res.rows.length > 0;
  }

  /**
   * Closes runs a worker took and never finished (it died mid-delivery) as `failed / interrupted`. They are not retried: an email may
   * already have gone, and a duplicate message to a customer is worse than a missed one that the booking records. Privileged.
   */
  async recoverStale(tx: Tx): Promise<number> {
    const secs = Math.floor(REMINDER_STALE_LOCK_MS / 1000);
    const res = await tx.execute(sql`
      UPDATE appointment_reminder_runs SET status = 'failed', reason = 'interrupted', locked_at = NULL, updated_at = now()
      WHERE status = 'sending' AND locked_at < now() - make_interval(secs => ${secs})
      RETURNING id`);
    return res.rows.length;
  }

  /**
   * Takes the runs that are waiting and due, marking them `sending` so no other worker works on them. Row-locked and skipping locked
   * rows, so several workers split the batch. Privileged.
   */
  async takeWaiting(tx: Tx, limit: number): Promise<Array<{ orgId: number; id: number }>> {
    const res = await tx.execute(sql`
      UPDATE appointment_reminder_runs SET status = 'sending', locked_at = now(), attempts = attempts + 1, updated_at = now()
      WHERE (org_id, id) IN (
        SELECT org_id, id FROM appointment_reminder_runs
        WHERE status IN ('pending', 'held') AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING org_id, id`);
    return (res.rows as Raw[]).map((r) => ({ orgId: Number(r.org_id), id: Number(r.id) }));
  }

  /**
   * The sent runs whose message is still being watched and whose check is due: the delivery check moves its own next check three
   * minutes on (a lease), so a worker that dies only delays the check. Privileged.
   */
  async takeDeliveryChecks(tx: Tx, limit: number): Promise<Array<{ orgId: number; id: number }>> {
    const res = await tx.execute(sql`
      UPDATE appointment_reminder_runs SET delivery_check_at = now() + interval '3 minutes'
      WHERE (org_id, id) IN (
        SELECT org_id, id FROM appointment_reminder_runs
        WHERE delivery_check_at <= now() AND delivery = 'unknown' AND status = 'sent' AND message_ref IS NOT NULL
        ORDER BY delivery_check_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING org_id, id`);
    return (res.rows as Raw[]).map((r) => ({ orgId: Number(r.org_id), id: Number(r.id) }));
  }

  /** What the conversation core knows of a message we handed over: its status and when it was delivered. */
  async messageState(
    tx: Tx,
    orgId: number,
    messageUuid: string,
  ): Promise<{ status: string; deliveredAt: Date | null } | undefined> {
    const res = await tx.execute(sql`
      SELECT status, delivered_at FROM messages WHERE org_id = ${orgId} AND uuid = ${messageUuid}::uuid LIMIT 1`);
    const r = (res.rows as Raw[])[0];
    return r ? { status: r.status as string, deliveredAt: d(r.delivered_at) } : undefined;
  }

  async findRun(tx: Tx, orgId: number, id: number): Promise<RunRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM appointment_reminder_runs WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRun(r) : undefined;
  }

  /** The rule a run came from, as it is now; undefined when it was deleted. */
  async findRuleByUuid(tx: Tx, orgId: number, uuid: string): Promise<RuleRow | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM booking_reminders WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const id = (res.rows as Raw[])[0]?.id;
    return id === undefined ? undefined : this.findRule(tx, orgId, Number(id));
  }

  async findRule(tx: Tx, orgId: number, reminderId: number | null): Promise<RuleRow | undefined> {
    if (reminderId === null) return undefined;
    const res = await tx.execute(sql`
      SELECT br.*, w.uuid AS wa_uuid, w.template_body AS wa_body, w.language AS wa_lang,
             lt.is_active AS lib_active, lt.subject AS lib_subject, lt.body AS lib_body
      FROM booking_reminders br
      LEFT JOIN wa_templates w ON w.org_id = br.org_id AND w.id = br.wa_template_id
      LEFT JOIN appointment_message_templates lt ON lt.org_id = br.org_id AND lt.id = br.library_template_id
      WHERE br.org_id = ${orgId} AND br.id = ${reminderId}`);
    const r = (res.rows as Raw[])[0];
    if (!r) return undefined;
    const kind = r.kind as BookingReminderKind;
    const offset = Number(r.offset_minutes);
    return {
      id: Number(r.id),
      uuid: r.uuid as string,
      bookingTypeId: Number(r.booking_type_id),
      isActive: r.is_active as boolean,
      kind,
      stepKind: (r.step_kind as BookingReminderStepKind | null) ?? defaultStepKind(kind, offset),
      offsetMinutes: offset,
      label: s(r.label),
      channels: liveChannels(r.channels),
      subject: s(r.subject),
      body: s(r.body),
      waTemplateUuid: s(r.wa_uuid),
      waTemplateBody: s(r.wa_body),
      waTemplateLanguage: s(r.wa_lang),
      buttonsEnabled: (r.buttons_enabled as boolean | null) ?? false,
      skipIfConfirmed: (r.skip_if_confirmed as boolean | null) ?? false,
      undeliveredFallbackMinutes:
        r.undelivered_fallback_minutes === null || r.undelivered_fallback_minutes === undefined
          ? null
          : Number(r.undelivered_fallback_minutes),
      serviceLabel: s(r.service_label),
      library:
        r.lib_body === null || r.lib_body === undefined
          ? null
          : {
              active: r.lib_active as boolean,
              subject: s(r.lib_subject),
              body: r.lib_body as string,
            },
    };
  }

  /** The reply tokens of a run, locked for the rest of the transaction. Undefined when the run does not exist. */
  async lockReply(
    tx: Tx,
    orgId: number,
    runId: number,
  ): Promise<{ appointmentId: number; stepKind: BookingReminderStepKind | null; state: ReplyState } | undefined> {
    const res = await tx.execute(sql`
      SELECT appointment_id, step_kind, reply_state FROM appointment_reminder_runs
      WHERE org_id = ${orgId} AND id = ${runId} FOR UPDATE`);
    const r = (res.rows as Raw[])[0];
    if (!r) return undefined;
    return {
      appointmentId: Number(r.appointment_id),
      stepKind: (r.step_kind as BookingReminderStepKind | null) ?? null,
      state: (r.reply_state && typeof r.reply_state === 'object' ? r.reply_state : {}) as ReplyState,
    };
  }

  async saveReply(tx: Tx, orgId: number, runId: number, state: ReplyState): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_reminder_runs SET reply_state = ${JSON.stringify(state)}::jsonb, updated_at = now()
      WHERE org_id = ${orgId} AND id = ${runId}`);
  }

  /** Whether the contact has another booking that starts after this one ended (a rebook message would be pointless). */
  async hasLaterBooking(
    tx: Tx,
    orgId: number,
    appointmentId: number,
    contactId: number,
    endsAt: Date,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM appointments
      WHERE org_id = ${orgId} AND contact_id = ${contactId} AND id <> ${appointmentId}
        AND status IN ('pending', 'confirmed') AND starts_at > ${endsAt.toISOString()}
      LIMIT 1`);
    return res.rows.length > 0;
  }

  /** Writes the outcome of a run and lets go of the claim. A held run comes back at `nextAttemptAt`. */
  async finish(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      status: Exclude<RunStatus, 'pending' | 'sending'>;
      reason: ReminderReason | null;
      channel: BookingReminderChannel | null;
      nextAttemptAt?: Date;
      attemptLog?: AttemptEntry[];
      /** The thread message of a WhatsApp send, so its delivery can be watched; with the time of the first look. */
      messageRef?: string | null;
      deliveryCheckAt?: Date | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_reminder_runs
         SET status = ${v.status}, reason = ${v.reason}, channel = ${v.channel}, locked_at = NULL, updated_at = now(),
             sent_at = ${v.status === 'sent' ? sql`now()` : sql`sent_at`},
             next_attempt_at = ${v.nextAttemptAt ? v.nextAttemptAt.toISOString() : sql`next_attempt_at`},
             attempt_log = ${v.attemptLog ? JSON.stringify(v.attemptLog) : sql`attempt_log`}::jsonb,
             message_ref = ${v.messageRef ? sql`${v.messageRef}::uuid` : sql`message_ref`},
             delivery_check_at = ${v.deliveryCheckAt ? v.deliveryCheckAt.toISOString() : sql`delivery_check_at`}
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** What the delivery check learned: delivered (stop watching), failed or undelivered (a fallback took over, or none was left). */
  async recordDelivery(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      delivery: DeliveryState;
      deliveredAt?: Date | null;
      checkAt: Date | null;
      attemptLog?: AttemptEntry[];
      /** A fallback sent the message again on another channel: the run now names it, and its own message is watched. */
      channel?: BookingReminderChannel;
      messageRef?: string | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_reminder_runs
         SET delivery = ${v.delivery}, delivered_at = ${v.deliveredAt ? v.deliveredAt.toISOString() : sql`delivered_at`},
             delivery_check_at = ${v.checkAt ? v.checkAt.toISOString() : sql`NULL`}, updated_at = now(),
             attempt_log = ${v.attemptLog ? JSON.stringify(v.attemptLog) : sql`attempt_log`}::jsonb,
             channel = ${v.channel ?? sql`channel`},
             message_ref = ${v.messageRef ? sql`${v.messageRef}::uuid` : sql`message_ref`}
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** A message that was handed over and then failed, with no channel left to try: the run is a failed one. */
  async failAfterSend(
    tx: Tx,
    orgId: number,
    id: number,
    reason: ReminderReason,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_reminder_runs SET status = 'failed', reason = ${reason}, updated_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'sent'`);
  }

  /**
   * A booking was cancelled, declined, marked no-show or moved: every run of it that has not been delivered stops, with the reason.
   * (A reschedule also arms the rules again under the new `armed_at`, so they are claimed afresh for the new time.)
   */
  async cancelWaiting(
    tx: Tx,
    orgId: number,
    appointmentId: number,
    reason: Extract<
      ReminderReason,
      'rescheduled' | 'booking_cancelled' | 'booking_declined' | 'booking_no_show'
    >,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_reminder_runs SET status = 'cancelled', reason = ${reason}, locked_at = NULL, delivery_check_at = NULL,
             updated_at = now()
      WHERE org_id = ${orgId} AND appointment_id = ${appointmentId} AND status IN ('pending', 'held', 'sending')`);
  }

  /** The runs of one booking, newest arming last; for the booking's detail. */
  async forAppointment(tx: Tx, orgId: number, appointmentId: number): Promise<RunRow[]> {
    const res = await tx.execute(sql`
      SELECT * FROM appointment_reminder_runs
      WHERE org_id = ${orgId} AND appointment_id = ${appointmentId}
      ORDER BY armed_at, due_at, id`);
    return (res.rows as Raw[]).map(toRun);
  }
}
