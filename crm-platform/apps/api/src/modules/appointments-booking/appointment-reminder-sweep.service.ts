import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { APPOINTMENT_MODULE } from './appointment-rules';
import { AppointmentReminderService } from './appointment-reminder.service';
import { AppointmentRemindersRepository } from './appointment-reminders.repository';

const BATCH = 200;
const DELIVER_BATCH = 50;

/**
 * The reminder sweep (TW-APPT-030, BL-283): every minute it (1) claims the (booking, rule) runs whose time has come and (2) delivers the
 * runs that are waiting. Both halves are rows in `appointment_reminder_runs`, so a restart loses nothing: a claimed run waits as
 * `pending` or `held` with its `next_attempt_at` until a worker takes it.
 *
 * The claim is idempotent by construction: an `INSERT ... ON CONFLICT DO NOTHING` on (booking, kind, offset, arming), so however many
 * workers run, a retry or a restart cannot claim the same reminder twice. A reschedule moves the booking's `armed_at`, which makes the
 * rules claimable again for the new time, and the old runs stop (`cancelled / rescheduled`).
 *
 * A before-step fires only for a confirmed booking that has not started and whose moment is later than the booking was made or last
 * moved; an after-visit step only for a booking that ended and was not cancelled, declined or marked no-show; a rebook step only for a
 * completed visit. The event steps (the confirmation, the no-show message) are not claimed here: they are taken when the event
 * happens. A step that is switched off never fires. Delivery re-checks all of this at send time (`AppointmentReminderService`).
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
    private readonly runs: AppointmentRemindersRepository,
    private readonly reminders: AppointmentReminderService,
  ) {}

  @Interval(60_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const claimed = await this.sweep();
      const delivered = await this.deliver();
      if (claimed + delivered > 0) {
        this.logger.debug({ claimed, delivered }, 'appointment reminder sweep');
      }
    } catch (err) {
      this.logger.error({ err }, 'appointment reminder sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** The claim half. Returns how many runs were claimed and announced. */
  async sweep(limit = BATCH): Promise<number> {
    return this.db.privileged(async (tx) => {
      const claimed = await this.runs.claimDue(tx, limit);
      for (const r of claimed) {
        await this.outbox.emit(tx, {
          orgId: r.orgId,
          aggregateModule: APPOINTMENT_MODULE,
          aggregateId: r.appointmentId,
          eventType: 'appointment.reminder_due',
          payload: {
            uuid: r.appointmentUuid,
            kind: r.kind,
            offsetMinutes: r.offsetMinutes,
            dueAt: r.dueAt.toISOString(),
            startsAt: r.startsAt.toISOString(),
            endsAt: r.endsAt.toISOString(),
            timezone: r.timezone,
            bookingTypeId: r.bookingTypeUuid,
          },
        });
      }
      return claimed.length;
    });
  }

  /**
   * The delivery half: works on the runs that are waiting, then looks at the WhatsApp messages that were handed over (a message that
   * failed afterwards, or was not delivered in time when the step asks for that, goes out on the next channel). Returns how many runs
   * were worked on.
   */
  async deliver(limit = DELIVER_BATCH): Promise<number> {
    const delivered = await this.reminders.processDue(limit);
    const watched = await this.reminders.watchDelivery(limit);
    return delivered + watched;
  }
}
