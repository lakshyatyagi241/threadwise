import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { NotificationsRepository } from './notifications.repository';
import {
  SALESDOC_NOTIFICATION_TYPE,
  SALESDOC_NOTIFY_EVENTS,
  copyFor,
  dedupeKeyFor,
  linkFor,
  recipientsFor,
  type SalesDocEventFacts,
  type SalesDocNotifyEvent,
} from './salesdoc-notification-rules';

const { users } = schema;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Turns the buyer's decision on a proposal or an estimate into in-app notifications (TW-PROP-017): the owner and the creator of the
 * document, once each, with a link to the document.
 *
 * Idempotent the same way the task consumer is: the notification's dedupe key is the event type plus the outbox event id and the
 * insert is ON CONFLICT DO NOTHING on (org, user, key), so the drain's at-least-once delivery cannot notify twice. The document is
 * read again at delivery time (its title for the wording); a document deleted since is dropped, not announced.
 *
 * Runs in the worker process under the event's own tenant (RLS applies), never privileged.
 */
@Injectable()
export class SalesDocNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'salesdoc-notifications';
  readonly eventTypes = SALESDOC_NOTIFY_EVENTS;
  private readonly logger = new Logger(SalesDocNotificationConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: NotificationsRepository,
    private readonly registry: OutboxSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    const docUuid = str(p.uuid);
    const number = str(p.number);
    if (!docUuid || !number) return;
    const facts: SalesDocEventFacts = {
      eventType: event.eventType as SalesDocNotifyEvent,
      docUuid,
      kind: p.kind === 'estimate' ? 'estimate' : 'proposal',
      number,
      by: str(p.by),
      ownerUuid: str(p.ownerId),
      createdByUuid: str(p.createdById),
    };
    const recipients = recipientsFor(facts);
    if (recipients.length === 0) return;

    await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const doc = await tx.execute(sql`
        SELECT title FROM sales_docs WHERE org_id = ${event.orgId} AND uuid = ${docUuid}::uuid
      `);
      const row = doc.rows[0] as { title: string | null } | undefined;
      if (!row) return;
      const people = await tx
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(and(eq(users.orgId, event.orgId), inArray(users.uuid, recipients)));
      const copy = copyFor(facts, row.title);
      const outcome = facts.eventType === 'salesdoc.accepted' ? 'accepted' : 'declined';
      for (const person of people) {
        if (person.status !== 'active') continue;
        const written = await this.repo.insertOnce(tx, event.orgId, {
          userId: Number(person.id),
          type: SALESDOC_NOTIFICATION_TYPE,
          title: copy.title,
          body: copy.body,
          link: linkFor(facts),
          data: { salesDocId: docUuid, kind: facts.kind, number: facts.number, status: outcome },
          dedupeKey: dedupeKeyFor(facts.eventType, event.id),
        });
        if (written) {
          this.logger.debug(
            { orgId: event.orgId, eventId: event.id, type: facts.eventType },
            'quote decision notification written',
          );
        }
      }
    });
  }
}
