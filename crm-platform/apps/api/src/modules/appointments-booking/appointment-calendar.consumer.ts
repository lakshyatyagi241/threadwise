import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import {
  APPOINTMENT_CALENDAR,
  type CalendarSyncPort,
} from '../../infra/providers/appointments-booking';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { AppointmentsRepository } from './appointments.repository';
import { BookingTypesRepository } from './booking-types.repository';

export const CALENDAR_EVENTS = [
  'appointment.booked',
  'appointment.confirmed',
  'appointment.rescheduled',
  'appointment.cancelled',
  'appointment.declined',
] as const;

/**
 * The calendar hook (TW-APPT-029, D-08): when a booking is confirmed or moved the event is written to the workspace's calendar through
 * the `CalendarSyncPort`; when it is cancelled or declined the event is removed. Reference did this inline with Google and swallowed every
 * failure; here a failure throws, so the drain retries it with backoff, and the port is idempotent on the stored event id (update,
 * not create), so a retry never doubles an event.
 *
 * The appointment is read again at delivery, so a stale event (moved again, cancelled since) writes the CURRENT state. A workspace with
 * nothing connected (the stub adapter) is a silent no-op: bookings work without a calendar.
 * Runs in the worker process under the event's own tenant.
 */
@Injectable()
export class AppointmentCalendarConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'appointment-calendar';
  readonly eventTypes = CALENDAR_EVENTS;
  private readonly logger = new Logger(AppointmentCalendarConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly appts: AppointmentsRepository,
    private readonly types: BookingTypesRepository,
    private readonly registry: OutboxSubscriberRegistry,
    @Inject(APPOINTMENT_CALENDAR) private readonly calendar: CalendarSyncPort,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const uuid = typeof event.payload.uuid === 'string' ? event.payload.uuid : null;
    if (!uuid) return;
    const status = await this.calendar.status(event.orgId);
    if (!status.connected) return;

    const work = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const row = await this.appts.findByUuid(tx, event.orgId, uuid);
      if (!row) return null;
      const type =
        row.bookingTypeId === null
          ? undefined
          : await this.types.findById(tx, event.orgId, row.bookingTypeId);
      const integration =
        type === undefined
          ? null
          : ((await this.types.children(tx, event.orgId, [type.id])).get(type.id)?.integration ??
            null);
      return { row, type, integration };
    });
    if (!work) return;
    const { row, type, integration } = work;
    // An event that exists lives in the calendar it was written to, even when the type has been pointed at another one since: update and
    // delete go there. A first write goes where the type says.
    const calendarId = row.calendarEventId
      ? (row.calendarId ?? integration?.calendarId ?? null)
      : (integration?.calendarId ?? row.calendarId ?? null);

    if (row.status === 'cancelled' || row.status === 'declined') {
      if (row.calendarEventId)
        await this.calendar.deleteEvent(event.orgId, calendarId, row.calendarEventId);
      return;
    }
    // Only a confirmed booking is a commitment worth a calendar event (a pending request or an unpaid hold is not).
    if (row.status !== 'confirmed') return;

    const result = await this.calendar.upsertEvent({
      orgId: event.orgId,
      appointmentId: row.uuid,
      calendarId,
      title: type?.name ?? row.title,
      description: row.description,
      location: row.location,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      timezone: row.timezone,
      attendeeEmail: row.inviteeEmail,
      attendeeName: row.inviteeName,
      createMeet: integration?.createMeet ?? type?.locationType === 'virtual',
      existingEventId: row.calendarEventId,
    });
    if (!result) return;
    if (result.eventId !== row.calendarEventId || result.meetUrl !== row.meetUrl) {
      await this.db.txAs({ orgId: event.orgId, userId: null }, (tx) =>
        this.appts.update(tx, event.orgId, row.id, undefined, {
          calendar_event_id: result.eventId,
          calendar_id: result.calendarId ?? calendarId,
          meet_url: result.meetUrl ?? row.meetUrl,
        }),
      );
      this.logger.debug({ appointment: row.uuid }, 'calendar event written back');
    }
  }
}
