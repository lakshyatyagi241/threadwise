import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { REVIEW_AFTER_MINUTES } from './appointment-rules';
import { AppointmentsRepository } from './appointments.repository';
import { BookingService } from './booking.service';

const BATCH = 100;

/**
 * The lifecycle sweep (WD-APPT-032): WaDesk ran it on the Node heartbeat under a cache lock; here it is a worker job (one pass a
 * minute, row-locked, so several workers cannot double up).
 *
 *   1. free expired soft-lock reservations;
 *   2. flag confirmed bookings that ended a while ago with no verdict as `needs_review` (a person decides completed or no-show; the
 *      clock never guesses a no-show);
 *   3. complete the confirmed bookings that were checked in and have ended;
 *   4. cancel unpaid pending bookings whose payment hold ran out (D-13), and decline pending requests whose time has passed.
 *
 * Steps 3 and 4 go through the same `BookingService.transition` a person's click does, as the system actor, so they audit and emit the
 * same events (and so free the slot in the same statement). Runs privileged to find the candidates across workspaces; each change then
 * runs scoped to its own workspace. Imported by WorkersModule only.
 */
@Injectable()
export class AppointmentLifecycleSweepService {
  private readonly logger = new Logger(AppointmentLifecycleSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly appts: AppointmentsRepository,
    private readonly booking: BookingService,
  ) {}

  @Interval(60_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.sweep();
      if (r.reservations + r.flagged + r.completed + r.cancelled + r.declined > 0) {
        this.logger.debug(r, 'appointment lifecycle sweep');
      }
    } catch (err) {
      this.logger.error({ err }, 'appointment lifecycle sweep failed');
    } finally {
      this.running = false;
    }
  }

  async sweep(limit = BATCH): Promise<{
    reservations: number;
    flagged: number;
    completed: number;
    cancelled: number;
    declined: number;
  }> {
    const cutoff = new Date(Date.now() - REVIEW_AFTER_MINUTES * 60_000).toISOString();
    const { reservations, flagged, completeIds, holdIds, expiredIds } = await this.db.privileged(
      async (tx) => {
        const gone = await tx.execute(sql`
        DELETE FROM slot_reservations WHERE ctid IN (
          SELECT ctid FROM slot_reservations WHERE expires_at < now() LIMIT ${limit * 2}) RETURNING 1`);
        const flag = await tx.execute(sql`
        UPDATE appointments SET needs_review = true WHERE (org_id, id) IN (
          SELECT org_id, id FROM appointments
          WHERE status = 'confirmed' AND ends_at < ${cutoff}::timestamptz AND checked_in_at IS NULL AND NOT needs_review
          ORDER BY ends_at LIMIT ${limit} FOR UPDATE SKIP LOCKED) RETURNING 1`);
        const pick = async (cond: ReturnType<typeof sql>) =>
          (
            await tx.execute(
              sql`SELECT org_id, id, uuid FROM appointments WHERE ${cond} ORDER BY starts_at LIMIT ${limit}`,
            )
          ).rows as Array<{ org_id: number | string; id: number | string; uuid: string }>;
        return {
          reservations: gone.rows.length,
          flagged: flag.rows.length,
          completeIds: await pick(
            sql`status = 'confirmed' AND ends_at < ${cutoff}::timestamptz AND checked_in_at IS NOT NULL`,
          ),
          holdIds: await pick(
            sql`status = 'pending' AND hold_expires_at IS NOT NULL AND hold_expires_at < now()`,
          ),
          expiredIds: await pick(
            sql`status = 'pending' AND hold_expires_at IS NULL AND ends_at < now()`,
          ),
        };
      },
    );

    const completed = await this.each(completeIds, 'completed', 'checked_in');
    const cancelled = await this.each(holdIds, 'cancelled', 'payment_timeout');
    const declined = await this.each(expiredIds, 'declined', 'expired');
    return { reservations, flagged, completed, cancelled, declined };
  }

  /** Moves each row as the system actor, scoped to its own workspace; a row that changed meanwhile is skipped. */
  private async each(
    rows: Array<{ org_id: number | string; id: number | string; uuid: string }>,
    to: 'completed' | 'cancelled' | 'declined',
    reason: string,
  ): Promise<number> {
    let done = 0;
    for (const r of rows) {
      const orgId = Number(r.org_id);
      try {
        await RequestContextStore.run(
          {
            requestId: `appointment-lifecycle-${r.uuid}`,
            orgId,
            actorType: 'system',
            actorId: null,
            userId: null,
          },
          () =>
            this.db.txAs({ orgId, userId: null }, async (tx) => {
              const row = await this.appts.findById(tx, orgId, Number(r.id), true);
              if (!row) return;
              // Re-check under the lock: a person may have acted since the candidates were picked.
              const stale =
                (to === 'completed' && (row.status !== 'confirmed' || !row.checkedInAt)) ||
                (to !== 'completed' && row.status !== 'pending');
              if (stale) return;
              await this.booking.transition(tx, orgId, row, to, {
                by: 'system',
                reason,
                notify: to !== 'completed',
                nowMs: Date.now(),
              });
              done++;
            }),
        );
      } catch (err) {
        this.logger.warn({ err, appointment: r.uuid }, 'lifecycle transition failed');
      }
    }
    return done;
  }
}
