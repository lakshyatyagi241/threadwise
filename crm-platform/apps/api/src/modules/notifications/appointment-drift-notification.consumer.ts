import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { APPOINTMENT_CALENDAR_DRIFTED, CALENDAR_DRIFT_REASONS } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { NotificationFanout } from './notification-fanout';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The wording of "the Google event of this appointment no longer matches it". Pure, for the tests. */
export function driftCopy(title: string, reason: string): { title: string; body: string } {
  const why: Record<string, string> = {
    event_deleted: 'Its event was deleted or cancelled in Google Calendar.',
    event_missing: 'Its event can no longer be found in Google Calendar.',
    time_changed: 'Its event was moved to another time in Google Calendar.',
    attendees_changed: 'The guests of its event were changed in Google Calendar.',
  };
  return {
    title: `Calendar out of sync: ${title}`,
    body: `${why[reason] ?? 'Its Google Calendar event no longer matches it.'} The appointment has not been changed. Choose to push our time back to Google or accept Google's change.`,
  };
}

/**
 * Tells the owner of an appointment, once, that its Google Calendar event no longer matches it (`appointment.calendar_drifted`,
 * TW-GACC-011). The reconcile writes that event only on the FIRST detection, and the note is idempotent on the appointment and the
 * detection time, so a redelivery writes nothing twice. Nothing about the appointment itself is touched here.
 */
@Injectable()
export class AppointmentDriftNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'appointment-drift-notifications';
  readonly eventTypes = [APPOINTMENT_CALENDAR_DRIFTED] as const;
  private readonly logger = new Logger(AppointmentDriftNotificationConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly fanout: NotificationFanout,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    const uuid = str(p.uuid);
    const reason = str(p.reason);
    const ownerUserId = typeof p.ownerUserId === 'number' ? p.ownerUserId : null;
    if (!uuid || !reason || ownerUserId === null) return;
    if (!(CALENDAR_DRIFT_REASONS as readonly string[]).includes(reason)) return;
    const copy = driftCopy(str(p.title) ?? 'appointment', reason);

    const pending = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const active = await tx.execute(
        sql`SELECT id FROM users WHERE org_id = ${event.orgId} AND id = ${ownerUserId} AND status = 'active'`,
      );
      if (active.rows.length === 0) return [];
      return this.fanout.write(
        tx,
        event.orgId,
        'appointment_calendar_drift',
        [ownerUserId],
        () => ({
          title: copy.title,
          body: copy.body,
          link: `/appointments?appt=${uuid}`,
          data: { appointmentId: uuid, reason },
          dedupeKey: `appointment-drift:${uuid}:${event.id}`,
        }),
      );
    });
    await this.fanout.publish(event.orgId, pending);
    if (pending.length > 0) this.logger.debug({ orgId: event.orgId }, 'calendar drift told');
  }
}
