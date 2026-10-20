import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { CONFERENCING_RELEASE_EVENT, type ReleaseSnapshot } from '../crm';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { MeetingConferencingService } from './meeting-conferencing.service';

/** The release payload as the outbox carries it: untrusted until shaped. */
export function snapshotOf(payload: Record<string, unknown>): ReleaseSnapshot | null {
  const video = payload.video as { provider?: unknown; id?: unknown } | null | undefined;
  const calendar = payload.calendar as
    { provider?: unknown; calendarId?: unknown; eventId?: unknown } | null | undefined;
  const okVideo =
    video &&
    (video.provider === 'zoom' || video.provider === 'teams') &&
    typeof video.id === 'string' &&
    video.id !== ''
      ? { provider: video.provider as 'zoom' | 'teams', id: video.id }
      : null;
  const okCalendar =
    calendar &&
    (calendar.provider === 'google' || calendar.provider === 'microsoft') &&
    typeof calendar.eventId === 'string' &&
    calendar.eventId !== ''
      ? {
          provider: calendar.provider as 'google' | 'microsoft',
          calendarId: typeof calendar.calendarId === 'string' ? calendar.calendarId : null,
          eventId: calendar.eventId,
        }
      : null;
  if (!okVideo && !okCalendar) return null;
  return {
    hostUserId: typeof payload.hostUserId === 'number' ? payload.hostUserId : null,
    video: okVideo,
    calendar: okCalendar,
  };
}

/**
 * Removes a video room and a calendar event that a meeting no longer holds (BL-361, BL-362): the meeting was deleted, or its provider
 * changed, or it was taken off the calendar. The ids were captured in the same transaction as the change, so they survive the row. A failure
 * throws, so the drain retries it with backoff. Idempotent: removing something already gone is success (Zoom and Teams answer not-found,
 * Google and Microsoft answer not-found or gone, and each adapter treats that as deleted), so a redelivered event or a retry is harmless.
 * Runs in the worker process under the event's own tenant.
 */
@Injectable()
export class ConferencingReleaseConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'meeting-conferencing-release';
  readonly eventTypes = [CONFERENCING_RELEASE_EVENT] as const;
  private readonly logger = new Logger(ConferencingReleaseConsumer.name);

  constructor(
    private readonly conferencing: MeetingConferencingService,
    private readonly registry: OutboxSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const snapshot = snapshotOf(event.payload);
    if (!snapshot) return;
    await this.conferencing.release(event.orgId, snapshot);
    this.logger.debug({ aggregate: event.aggregateId }, 'meeting room and event released');
  }
}
