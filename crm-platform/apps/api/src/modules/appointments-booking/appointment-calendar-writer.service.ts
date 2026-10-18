import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import {
  APPOINTMENT_CALENDAR,
  eventProviderOf,
  type CalendarSyncPort,
} from '../../infra/providers/appointments-booking';
import { AppointmentMeetingMirror } from './appointment-meeting-mirror.service';
import { AppointmentsRepository } from './appointments.repository';
import { BookingTypesRepository } from './booking-types.repository';

/**
 * Writes an appointment's CURRENT state to its Google event, or removes the event when the booking is over (TW-APPT-029). The outbox
 * consumer calls it on every booking event, and a person calls it through "Push our time back to Google" (TW-GACC-011): one code path, so a
 * manual push can never differ from an automatic one.
 *
 * Every write records what we pushed (Google's etag, the time, the guest) next to the appointment. The reconcile compares the event
 * with THAT snapshot, never with the appointment: an appointment that was just moved and whose push is still queued then reads as "our own
 * change on its way", not as Google drift.
 */
@Injectable()
export class AppointmentCalendarWriter {
  private readonly logger = new Logger(AppointmentCalendarWriter.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly appts: AppointmentsRepository,
    private readonly types: BookingTypesRepository,
    @Inject(APPOINTMENT_CALENDAR) private readonly calendar: CalendarSyncPort,
    private readonly mirror: AppointmentMeetingMirror,
  ) {}

  /**
   * `written`: the event now matches the appointment. `deleted`: the booking is over and its event was removed. `skipped`: nothing to
   * write (no such appointment, or a booking that is not yet a commitment). Throws what the calendar port throws.
   */
  async sync(orgId: number, uuid: string): Promise<'written' | 'deleted' | 'skipped'> {
    const work = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const row = await this.appts.findByUuid(tx, orgId, uuid);
      if (!row) return null;
      const type =
        row.bookingTypeId === null
          ? undefined
          : await this.types.findById(tx, orgId, row.bookingTypeId);
      const integration =
        type === undefined
          ? null
          : ((await this.types.children(tx, orgId, [type.id])).get(type.id)?.integration ?? null);
      return { row, type, integration };
    });
    if (!work) return 'skipped';
    const { row, type, integration } = work;
    // The provider that holds the event now (an event with none recorded was written to Google, the only provider there was).
    const heldBy = row.calendarEventId ? eventProviderOf(row.calendarProvider) : null;
    // An event that exists lives in the calendar it was written to, even when the type has been pointed at another one since: update and
    // delete go there. A first write goes where the type says (a calendar id the type names is a Google calendar's).
    const calendarId = row.calendarEventId
      ? (row.calendarId ?? integration?.calendarId ?? null)
      : (integration?.calendarId ?? row.calendarId ?? null);

    if (row.status === 'cancelled' || row.status === 'declined') {
      if (!row.calendarEventId) return 'skipped';
      await this.calendar.deleteEvent(orgId, calendarId, row.calendarEventId, heldBy ?? undefined);
      // We removed it ourselves: nothing to reconcile any more.
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.appts.update(tx, orgId, row.id, undefined, {
          google_sync_state: null,
          google_sync_reason: null,
          google_drift_detected_at: null,
          google_drift_starts_at: null,
          google_drift_ends_at: null,
        }),
      );
      return 'deleted';
    }
    // Only a confirmed booking is a commitment worth a calendar event (a pending request or an unpaid hold is not).
    if (row.status !== 'confirmed') return 'skipped';

    // Events are written to ONE provider. When the event sits in the other one (the workspace changed provider), it is removed there
    // (best effort: that grant may be gone) and written fresh here, instead of patching an id that means nothing to this calendar.
    const writeTo = this.calendar.writeTarget ? await this.calendar.writeTarget(orgId) : heldBy;
    if (this.calendar.writeTarget && !writeTo) return 'skipped';
    let existingEventId = row.calendarEventId;
    let firstCalendarId = calendarId;
    if (existingEventId && writeTo !== null && heldBy !== writeTo) {
      await this.calendar
        .deleteEvent(orgId, calendarId, existingEventId, heldBy ?? undefined)
        .catch((err: unknown) =>
          this.logger.warn(
            { orgId, appointment: row.uuid, from: heldBy, err: String(err) },
            'could not remove the event from the previous calendar provider',
          ),
        );
      existingEventId = null;
      firstCalendarId = null;
    }
    // A calendar id the booking type names is one of Google's calendars: Microsoft writes to the workspace's chosen calendar.
    const targetCalendarId = writeTo === 'microsoft' ? null : firstCalendarId;

    const result = await this.calendar.upsertEvent({
      orgId,
      appointmentId: row.uuid,
      calendarId: targetCalendarId,
      title: type?.name ?? row.title,
      description: row.description,
      location: row.location,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      timezone: row.timezone,
      attendeeEmail: row.inviteeEmail,
      attendeeName: row.inviteeName,
      createMeet: integration?.createMeet ?? type?.locationType === 'virtual',
      existingEventId,
    });
    if (!result) return 'skipped';
    const now = new Date();
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      await this.appts.update(tx, orgId, row.id, undefined, {
        calendar_event_id: result.eventId,
        calendar_id: result.calendarId ?? targetCalendarId,
        calendar_provider: result.provider ?? writeTo ?? null,
        meet_url: result.meetUrl ?? row.meetUrl,
        google_event_etag: result.etag ?? null,
        google_pushed_at: now,
        google_pushed_starts_at: row.startsAt,
        google_pushed_ends_at: row.endsAt,
        google_pushed_attendee: row.inviteeEmail ? row.inviteeEmail.trim().toLowerCase() : null,
        google_sync_state: 'in_sync',
        google_sync_reason: null,
        google_drift_detected_at: null,
        google_drift_starts_at: null,
        google_drift_ends_at: null,
        google_checked_at: now,
      });
      // The Meet or Teams link the calendar just made is the meeting's join link: the contact's row follows the appointment as it is NOW.
      const current = await this.appts.findById(tx, orgId, row.id);
      if (current) await this.mirror.sync(tx, orgId, current);
    });
    return 'written';
  }
}
