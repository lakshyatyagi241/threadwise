import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { BookingReminderChannel, BookingReminderKind } from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  FOLLOW_UP_GRACE_MS,
  REMINDER_STALE_LOCK_MS,
  type ReminderReason,
  type RunStatus,
} from './appointment-reminder.rules';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));

/** A run the sweep has just claimed (for the outbox announcement). */
export interface ClaimedRun {
  orgId: number;
  runId: number;
  appointmentId: number;
  appointmentUuid: string;
  kind: BookingReminderKind;
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
  offsetMinutes: number;
  dueAt: Date;
  armedAt: Date;
  status: RunStatus;
  reason: string | null;
  channel: BookingReminderChannel | null;
  attempts: number;
  nextAttemptAt: Date;
  sentAt: Date | null;
}

/** The rule as it is now (what a run is delivered from). */
export interface RuleRow {
  id: number;
  isActive: boolean;
  kind: BookingReminderKind;
  offsetMinutes: number;
  label: string | null;
  channels: BookingReminderChannel[];
  subject: string | null;
  body: string | null;
  waTemplateUuid: string | null;
}

const toRun = (r: Raw): RunRow => ({
  id: Number(r.id),
  appointmentId: Number(r.appointment_id),
  reminderId: r.reminder_id === null || r.reminder_id === undefined ? null : Number(r.reminder_id),
  kind: r.kind as BookingReminderKind,
  offsetMinutes: Number(r.offset_minutes),
  dueAt: new Date(r.due_at as string),
  armedAt: new Date(r.armed_at as string),
  status: r.status as RunStatus,
  reason: s(r.reason),
  channel: (r.channel as BookingReminderChannel | null) ?? null,
  attempts: Number(r.attempts),
  nextAttemptAt: new Date(r.next_attempt_at as string),
  sentAt: r.sent_at ? new Date(r.sent_at as string) : null,
});

/**
 * Reminder runs (BL-283): the claim of "this rule for this booking at this arming", and what became of it. Every statement names the
 * workspace; the two sweep statements run privileged (they span workspaces by definition) and say so.
 */
@Injectable()
export class AppointmentRemindersRepository {
  /**
   * Claims every (booking, active rule) whose time has come and has no run yet for the booking's current arming. The unique key makes
   * it idempotent: however many workers run, an insert wins once. A before-rule fires only for a confirmed booking that has not started
   * and only when its moment is later than the booking was made or last moved (`armed_at`); an after-rule only for a booking that is
   * confirmed or completed and ended, within a day of its moment. Privileged.
   */
  async claimDue(tx: Tx, limit: number): Promise<ClaimedRun[]> {
    const graceSeconds = Math.floor(FOLLOW_UP_GRACE_MS / 1000);
    const res = await tx.execute(sql`
      WITH due AS (
        SELECT a.org_id, a.id AS appointment_id, r.id AS reminder_id, r.kind, r.offset_minutes, a.armed_at,
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
            (r.kind = 'after' AND a.status IN ('confirmed', 'completed')
              AND a.ends_at <= now() AND a.ends_at > now() - interval '32 days')
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
          (org_id, appointment_id, reminder_id, kind, offset_minutes, due_at, armed_at, status, next_attempt_at)
        SELECT org_id, appointment_id, reminder_id, kind, offset_minutes, due_at, armed_at, 'pending', now() FROM ready
        ON CONFLICT (org_id, appointment_id, kind, offset_minutes, armed_at) DO NOTHING
        RETURNING id, org_id, appointment_id, kind, offset_minutes, due_at
      )
      SELECT c.id AS run_id, c.org_id, c.appointment_id, c.kind, c.offset_minutes, c.due_at,
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
      offsetMinutes: Number(r.offset_minutes),
      dueAt: new Date(r.due_at as string),
      startsAt: new Date(r.starts_at as string),
      endsAt: new Date(r.ends_at as string),
      timezone: r.timezone as string,
      bookingTypeUuid: s(r.type_uuid),
    }));
  }

  /**
   * Closes runs a worker took and never finished (it died mid-delivery) as `failed / interrupted`. They are not retried: an SMS or an
   * email may already have gone, and a duplicate message to a customer is worse than a missed one that the booking records. Privileged.
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

  async findRun(tx: Tx, orgId: number, id: number): Promise<RunRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM appointment_reminder_runs WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRun(r) : undefined;
  }

  /** The rule a run came from, as it is now; undefined when it was deleted. */
  async findRule(tx: Tx, orgId: number, reminderId: number | null): Promise<RuleRow | undefined> {
    if (reminderId === null) return undefined;
    const res = await tx.execute(sql`
      SELECT br.*, w.uuid AS wa_uuid FROM booking_reminders br
      LEFT JOIN wa_templates w ON w.org_id = br.org_id AND w.id = br.wa_template_id
      WHERE br.org_id = ${orgId} AND br.id = ${reminderId}`);
    const r = (res.rows as Raw[])[0];
    if (!r) return undefined;
    return {
      id: Number(r.id),
      isActive: r.is_active as boolean,
      kind: r.kind as BookingReminderKind,
      offsetMinutes: Number(r.offset_minutes),
      label: s(r.label),
      channels: (r.channels as BookingReminderChannel[] | null) ?? ['whatsapp', 'sms', 'email'],
      subject: s(r.subject),
      body: s(r.body),
      waTemplateUuid: s(r.wa_uuid),
    };
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
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_reminder_runs
         SET status = ${v.status}, reason = ${v.reason}, channel = ${v.channel}, locked_at = NULL, updated_at = now(),
             sent_at = ${v.status === 'sent' ? sql`now()` : sql`sent_at`},
             next_attempt_at = ${v.nextAttemptAt ? v.nextAttemptAt.toISOString() : sql`next_attempt_at`}
       WHERE org_id = ${orgId} AND id = ${id}`);
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
      UPDATE appointment_reminder_runs SET status = 'cancelled', reason = ${reason}, locked_at = NULL, updated_at = now()
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
