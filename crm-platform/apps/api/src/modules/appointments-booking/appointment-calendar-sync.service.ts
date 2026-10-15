import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type AppointmentActionInput,
  type AppointmentResponse,
  type CalendarDriftAction,
  type RecordScope,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  APPOINTMENT_CALENDAR,
  GoogleCalendarError,
  type CalendarSyncPort,
} from '../../infra/providers/appointments-booking';
import { AppointmentCalendarWriter } from './appointment-calendar-writer.service';
import { AppointmentsRepository, type AppointmentRow } from './appointments.repository';
import { AppointmentsService } from './appointments.service';
import { AppointmentsSupport } from './appointments.support';
import { CalendarNotConnectedError } from './google-calendar-tokens.service';

/**
 * What a person can do about a drifted appointment (TW-GACC-011). Both actions need `record.appointments.update` for the appointment (its
 * record scope applies, an appointment outside it is not found) and both answer 409 `GOOGLE_SYNC_NOT_DRIFTED` when there is nothing to
 * decide, so a double click or a stale screen changes nothing twice.
 *
 *  - push: the event is written again from the appointment, through the same code as every automatic write (a deleted event comes back
 *    under the same id). The appointment is not touched.
 *  - accept: Google's change is applied THROUGH THE USUAL APPOINTMENT RULES, never around them. The event is read again first, so what
 *    is applied is what Google shows now: a deleted or missing event cancels the appointment (the customer is told, the slot is freed);
 *    a moved event reschedules it to Google's start (the booking type's length applies, availability is not re-checked: a person is
 *    accepting a time somebody chose on purpose; the customer is told); changed guests are acknowledged (the invitee of an appointment is
 *    its contact: it cannot be edited from Google, so this only stops the badge and remembers Google's list).
 */
@Injectable()
export class AppointmentCalendarSyncService {
  private readonly logger = new Logger(AppointmentCalendarSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AppointmentsRepository,
    private readonly support: AppointmentsSupport,
    private readonly appts: AppointmentsService,
    private readonly writer: AppointmentCalendarWriter,
    @Inject(APPOINTMENT_CALENDAR) private readonly calendar: CalendarSyncPort,
  ) {}

  async push(
    uuid: string,
    scope: RecordScope,
  ): Promise<{ appointment: AppointmentResponse; result: CalendarDriftAction }> {
    const row = await this.drifted(uuid, scope);
    let done: 'written' | 'deleted' | 'skipped';
    try {
      done = await this.writer.sync(RequestContextStore.require().orgId, uuid);
    } catch (err) {
      throw this.asApiError(err);
    }
    // Nothing was written (no calendar connected, or the calendar port had nothing to do): this is not a success, and nothing is audited.
    if (done === 'skipped') throw this.notConnected();
    await this.noteDecision(row, 'pushed');
    return {
      appointment: await this.appts.get(uuid, scope),
      result: { done: 'pushed', applied: null },
    };
  }

  async accept(
    uuid: string,
    input: AppointmentActionInput,
    scope: RecordScope,
  ): Promise<{ appointment: AppointmentResponse; result: CalendarDriftAction }> {
    const row = await this.drifted(uuid, scope);
    const ctx = RequestContextStore.require();
    let event;
    try {
      event = await this.calendar.readEvent(ctx.orgId, row.calendarId, row.calendarEventId!);
    } catch (err) {
      throw this.asApiError(err);
    }

    if (event.kind !== 'found') {
      await this.appts.cancel(
        uuid,
        {
          reason: 'The Google Calendar event was deleted',
          notify: input.notify,
          rowVersion: input.rowVersion,
        },
        scope,
      );
      await this.noteDecision(row, 'accepted');
      return {
        appointment: await this.appts.get(uuid, scope),
        result: { done: 'accepted', applied: 'cancelled' },
      };
    }

    if (event.allDay || event.startsAt === null) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'The Google event is now an all-day event: it has no time to accept. Push our time back instead.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // The booking moves to the start AND the end Google shows (either may be the only one that changed), through the normal reschedule
    // path: reminders armed again, `appointment.rescheduled`, the customer told when `notify`.
    const moved =
      event.startsAt.getTime() !== row.startsAt.getTime() ||
      (event.endsAt !== null && event.endsAt.getTime() !== row.endsAt.getTime());
    let applied: 'rescheduled' | 'acknowledged' = 'acknowledged';
    if (moved) {
      await this.appts.rescheduleToGoogle(
        uuid,
        {
          startsAt: event.startsAt,
          endsAt:
            event.endsAt ??
            new Date(event.startsAt.getTime() + (row.endsAt.getTime() - row.startsAt.getTime())),
          notify: input.notify,
          rowVersion: input.rowVersion,
        },
        scope,
      );
      applied = 'rescheduled';
    }
    // What we have written to the event is now what Google shows: remember its time, guests and etag as the baseline, and clear the
    // drift ONLY when the appointment really matches the event now (otherwise the badge stays and says so on the next look).
    const settled = await this.db.txAs({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const now = (await this.repo.findById(tx, ctx.orgId, row.id, true))!;
      const matches =
        now.startsAt.getTime() === event.startsAt!.getTime() &&
        (event.endsAt === null || now.endsAt.getTime() === event.endsAt.getTime());
      await this.repo.update(tx, ctx.orgId, row.id, undefined, {
        google_pushed_starts_at: now.startsAt,
        google_pushed_ends_at: now.endsAt,
        google_pushed_attendee:
          event.attendees.length > 0 ? [...event.attendees].sort().join(',') : null,
        google_pushed_at: new Date(),
        google_event_etag: event.etag,
        ...(matches
          ? {
              google_sync_state: 'in_sync',
              google_sync_reason: null,
              google_drift_detected_at: null,
              google_drift_starts_at: null,
              google_drift_ends_at: null,
              google_checked_at: new Date(),
            }
          : {}),
      });
      return matches;
    });
    await this.noteDecision(row, 'accepted');
    this.logger.debug({ settled }, 'accepted a Google change');
    return {
      appointment: await this.appts.get(uuid, scope),
      result: { done: 'accepted', applied },
    };
  }

  private notConnected(): AppError {
    return new AppError(
      ERROR_CODES.APPT_CALENDAR_NOT_CONNECTED,
      'No Google Calendar is connected for this workspace.',
      HttpStatus.CONFLICT,
    );
  }

  private async drifted(uuid: string, scope: RecordScope): Promise<AppointmentRow> {
    // Scope first: an appointment the caller may not see is "not found", whatever its sync state.
    await this.appts.get(uuid, scope);
    const ctx = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.repo.findByUuid(tx, ctx.orgId, uuid));
    if (!row) throw AppError.notFound('Appointment', uuid);
    if (row.googleSyncState !== 'drifted' || !row.calendarEventId) {
      throw new AppError(
        ERROR_CODES.GOOGLE_SYNC_NOT_DRIFTED,
        "This appointment's Google Calendar event is not out of sync.",
        HttpStatus.CONFLICT,
      );
    }
    return row;
  }

  private async noteDecision(row: AppointmentRow, decision: 'pushed' | 'accepted'): Promise<void> {
    await this.db.tx((tx) =>
      this.support.record(tx, row, {
        audit: {
          action: 'update',
          delta: { googleSync: { old: row.googleSyncReason, new: decision } },
        },
      }),
    );
  }

  /** What the caller is told about a Google failure: a stable code, never Google's text. */
  private asApiError(err: unknown): Error {
    if (err instanceof AppError) return err;
    if (err instanceof CalendarNotConnectedError) {
      return new AppError(
        ERROR_CODES.APPT_CALENDAR_NOT_CONNECTED,
        'No Google Calendar is connected for this workspace.',
        HttpStatus.CONFLICT,
      );
    }
    if (err instanceof GoogleCalendarError) {
      this.logger.warn({ kind: err.kind, status: err.status }, 'calendar drift action failed');
      return new AppError(
        ERROR_CODES.APPT_CALENDAR_PROVIDER_FAILED,
        'Google Calendar did not answer. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
