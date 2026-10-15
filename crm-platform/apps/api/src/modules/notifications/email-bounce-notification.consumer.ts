import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { NotificationFanout } from './notification-fanout';

/** Raised by the conversation core when a sent email bounced (TW-MAIL-032). */
export const EMAIL_BOUNCE_EVENT = 'email.message_bounced';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Tells the person who wrote a reply that it did not reach someone (`email_bounced`). One bell row per bounced message and recipient (the
 * key), only for the sender and only while they are an active member: a reply written by a bot has no sender, so nobody is told (the
 * system line in the thread still shows it). A soft bounce (a full mailbox, a delay) is told too, with its own wording.
 */
@Injectable()
export class EmailBounceNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'email-bounce-notifications';
  readonly eventTypes = [EMAIL_BOUNCE_EVENT] as const;
  private readonly logger = new Logger(EmailBounceNotificationConsumer.name);

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
    const senderId = typeof p.senderUserId === 'number' ? p.senderUserId : null;
    const conversationId = str(p.conversationId);
    const messageId = str(p.messageId);
    const recipient = str(p.failedRecipient);
    if (senderId === null || !conversationId || !messageId || !recipient) return;
    const soft = p.kind === 'soft';
    const reason = (str(p.reason) ?? '').slice(0, 200);

    const pending = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const active = await tx.execute(
        sql`SELECT id FROM users WHERE org_id = ${event.orgId} AND id = ${senderId} AND status = 'active'`,
      );
      if (active.rows.length === 0) return [];
      return this.fanout.write(tx, event.orgId, 'email_bounced', [senderId], () => ({
        title: soft
          ? `Email to ${recipient} is delayed`
          : `Email to ${recipient} was not delivered`,
        body: reason || null,
        link: `/inbox?c=${conversationId}`,
        data: {
          conversationId,
          messageId,
          failedRecipient: recipient,
          kind: soft ? 'soft' : 'hard',
          reason,
        },
        dedupeKey: `email-bounce:${messageId}:${recipient}:${soft ? 'soft' : 'hard'}`,
        subjectKind: 'conversation',
        subjectUuid: conversationId,
      }));
    });
    await this.fanout.publish(event.orgId, pending);
    if (pending.length > 0) this.logger.debug({ orgId: event.orgId }, 'email bounce told');
  }
}
