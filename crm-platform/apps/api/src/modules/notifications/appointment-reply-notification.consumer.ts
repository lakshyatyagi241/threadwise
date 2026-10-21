import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { NotificationFanout } from './notification-fanout';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The wording of the bell row when a customer cancels from a reminder. Pure, for the tests. */
export function customerCancelCopy(startsAtIso: string | null): { title: string; body: string } {
  return {
    title: 'A customer cancelled their appointment',
    body: `They tapped Cancel on a reminder${startsAtIso ? ` for the appointment at ${startsAtIso}` : ''}. The time is free again.`,
  };
}

/** The wording of the answer to an email test of a reminder step. */
export function testResultCopy(
  status: string,
  reason: string | null,
): { title: string; body: string } {
  if (status === 'sent') {
    return {
      title: 'Test email sent',
      body: 'The test of your reminder step is in your inbox.',
    };
  }
  return {
    title: 'Test email not sent',
    body: reason
      ? `The test of your reminder step could not be sent (${reason.replaceAll('_', ' ')}).`
      : 'The test of your reminder step could not be sent.',
  };
}

/**
 * Two small notes from the reminder sequences (BL-425, BL-426): the host is told, once, when a customer cancels by tapping Cancel on a
 * reminder (`appointment.cancelled` with `via = reminder_reply`), and the person who asked for an email test is told how it went
 * (`appointment.reminder_test_finished`). Both are idempotent on the event, so a redelivery writes nothing twice.
 */
@Injectable()
export class AppointmentReplyNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'appointment-reply-notifications';
  readonly eventTypes = ['appointment.cancelled', 'appointment.reminder_test_finished'] as const;
  private readonly logger = new Logger(AppointmentReplyNotificationConsumer.name);

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
    if (event.eventType === 'appointment.reminder_test_finished') {
      const userId = typeof p.userId === 'number' ? p.userId : null;
      if (userId === null) return;
      const copy = testResultCopy(str(p.status) ?? 'failed', str(p.reason));
      const typeUuid = str(p.typeUuid);
      const pending = await this.db.txAs({ orgId: event.orgId, userId: null }, (tx) =>
        this.fanout.write(tx, event.orgId, 'appointment_reminder_test', [userId], () => ({
          title: copy.title,
          body: copy.body,
          link: typeUuid ? `/appointments/settings` : null,
          data: { bookingTypeId: typeUuid },
          dedupeKey: `appointment-test:${event.id}`,
        })),
      );
      await this.fanout.publish(event.orgId, pending);
      return;
    }
    if (p.via !== 'reminder_reply' || p.by !== 'invitee') return;
    const uuid = str(p.uuid);
    const hostUuid = str(p.hostId);
    if (!uuid || !hostUuid) return;
    const copy = customerCancelCopy(str(p.startsAt));
    const pending = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const found = await tx.execute(
        sql`SELECT id FROM users WHERE org_id = ${event.orgId} AND uuid = ${hostUuid}::uuid AND status = 'active'`,
      );
      const hostId = (found.rows as Array<{ id: number | string }>)[0]?.id;
      if (hostId === undefined) return [];
      return this.fanout.write(
        tx,
        event.orgId,
        'appointment_cancelled_by_customer',
        [Number(hostId)],
        () => ({
          title: copy.title,
          body: copy.body,
          link: `/appointments?appt=${uuid}`,
          data: { appointmentId: uuid },
          dedupeKey: `appointment-customer-cancel:${uuid}:${event.id}`,
        }),
      );
    });
    await this.fanout.publish(event.orgId, pending);
    if (pending.length > 0)
      this.logger.debug({ orgId: event.orgId }, 'customer cancel told to the host');
  }
}
