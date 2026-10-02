import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { APPOINTMENT_MODULE } from './appointment-rules';

const BATCH = 200;

/**
 * The reminder sweep (TW-APPT-030, D-14): the hook point the message consumer subscribes to. Every minute it claims the
 * (appointment, reminder offset) pairs whose time has come and writes one `appointment.reminder_due` event per claim, in one
 * transaction.
 *
 * What Reference did (registered a one-off schedule on the Node bridge at booking time, with a synthetic id, and never checked it again)
 * is a worker job here, and it is idempotent by construction: the claim is an `INSERT ... ON CONFLICT DO NOTHING` on
 * (appointment, offset), so however many workers run, a retry or a restart cannot announce the same reminder twice. A reschedule
 * deletes the booking's claims, which arms every offset again.
 *
 * A reminder fires only for a confirmed booking that has not started, when its time (start - offset) has come, and only if that time
 * is later than the moment the booking was made or last moved (`armed_at`): Reference's "skip when the booking was made inside the
 * reminder window". A reminder row that is switched off never fires.
 *
 * Runs privileged: it spans every workspace by definition (one of the sanctioned uses). Imported by WorkersModule only.
 */
@Injectable()
export class AppointmentReminderSweepService {
  private readonly logger = new Logger(AppointmentReminderSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  @Interval(60_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sweep();
      if (n > 0) this.logger.debug({ claimed: n }, 'appointment reminder sweep');
    } catch (err) {
      this.logger.error({ err }, 'appointment reminder sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass. Returns how many reminders were claimed and announced. */
  async sweep(limit = BATCH): Promise<number> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        WITH due AS (
          SELECT a.org_id, a.id AS appointment_id, r.id AS reminder_id, r.offset_minutes,
                 a.starts_at - make_interval(mins => r.offset_minutes) AS due_at
          FROM appointments a
          JOIN booking_reminders r
            ON r.org_id = a.org_id AND r.booking_type_id = a.booking_type_id AND r.is_active
          WHERE a.status = 'confirmed'
            AND a.starts_at > now()
            AND a.starts_at - make_interval(mins => r.offset_minutes) <= now()
            AND a.starts_at - make_interval(mins => r.offset_minutes) > a.armed_at
            AND NOT EXISTS (
              SELECT 1 FROM appointment_reminder_runs x
              WHERE x.org_id = a.org_id AND x.appointment_id = a.id AND x.offset_minutes = r.offset_minutes)
          ORDER BY due_at, a.id
          LIMIT ${limit}
        ), claimed AS (
          INSERT INTO appointment_reminder_runs (org_id, appointment_id, reminder_id, offset_minutes, due_at)
          SELECT org_id, appointment_id, reminder_id, offset_minutes, due_at FROM due
          ON CONFLICT (org_id, appointment_id, offset_minutes) DO NOTHING
          RETURNING org_id, appointment_id, reminder_id, offset_minutes, due_at
        )
        SELECT c.org_id, c.appointment_id, c.offset_minutes, c.due_at,
               a.uuid, a.starts_at, a.ends_at, a.timezone, bt.uuid AS type_uuid
        FROM claimed c
        JOIN appointments a ON a.org_id = c.org_id AND a.id = c.appointment_id
        LEFT JOIN booking_types bt ON bt.org_id = a.org_id AND bt.id = a.booking_type_id
      `);
      for (const r of res.rows as Array<Record<string, unknown>>) {
        await this.outbox.emit(tx, {
          orgId: Number(r.org_id),
          aggregateModule: APPOINTMENT_MODULE,
          aggregateId: Number(r.appointment_id),
          eventType: 'appointment.reminder_due',
          payload: {
            uuid: r.uuid,
            offsetMinutes: Number(r.offset_minutes),
            dueAt: new Date(r.due_at as string).toISOString(),
            startsAt: new Date(r.starts_at as string).toISOString(),
            endsAt: new Date(r.ends_at as string).toISOString(),
            timezone: r.timezone,
            bookingTypeId: r.type_uuid ?? null,
          },
        });
      }
      return res.rows.length;
    });
  }
}
