import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  APPOINTMENT_CALENDAR,
  type CalendarSyncPort,
} from '../../infra/providers/appointments-booking';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { AppointmentCalendarWriter } from './appointment-calendar-writer.service';

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
    private readonly writer: AppointmentCalendarWriter,
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
    const done = await this.writer.sync(event.orgId, uuid);
    if (done === 'written') this.logger.debug({ appointment: uuid }, 'calendar event written back');
  }
}
