import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { CalendarBackfillQueue } from './calendar-backfill.jobs';

/**
 * The events after which a workspace's upcoming bookings may be missing from its calendar: a calendar was connected or reconnected (a new
 * account takes its predecessor's events out of reach), or the workspace changed where bookings go.
 */
export const BACKFILL_EVENTS = [
  'appointment_calendar.connected',
  'appointment_calendar.provider_selected',
] as const;

/**
 * Queues the back-fill when one of `BACKFILL_EVENTS` happens (BL-035). Nothing is written here: the job looks at what is missing and writes
 * it, so a connect that changes nothing (the Google account page adding Sheets) costs one cheap query. Runs in the worker process under the
 * event's own tenant.
 */
@Injectable()
export class CalendarBackfillConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'appointment-calendar-backfill';
  readonly eventTypes = BACKFILL_EVENTS;

  constructor(
    private readonly queue: CalendarBackfillQueue,
    private readonly registry: OutboxSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** A redelivered event is harmless: the job id is fixed per workspace, so a second enqueue while the first job is still queued is a no-op. */
  async handle(event: OutboxEvent): Promise<void> {
    await this.queue.enqueue(event.orgId);
  }
}
