import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import {
  NotificationPublisher,
  NotificationsRepository,
  type WrittenNotification,
} from '../notifications';

export const LEAD_NOTIFY_EVENTS = ['lead.created', 'lead.updated'] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** One key per lead event and person: a retry that emits the same lead again collides, so a person is told once per lead. */
export const leadDedupeKey = (leadEventId: string): string => `new_lead:${leadEventId}`;

/** Plain text, at most `max` characters: a name or a label from the public is never rendered raw into a notification. */
const plain = (v: string, max: number): string => {
  const t = v
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Turns a lead outcome into in-app `new_lead` notifications (spec L-09): the people the lead pipeline resolved at ingest (the contact's
 * owner when the source says so, plus the extra users named on the source). Same pattern as `TaskNotificationConsumer`: idempotent
 * (the notification's dedupe key is the lead event's id, and the insert is ON CONFLICT DO NOTHING), runs in the worker under the event's own
 * tenant, never privileged.
 *
 * A test lead never notifies. A lead that needs review does not either: it is in the source's "Needs attention" list, and a person who
 * was not told about a half-lead is better than one who is told twice. A returning contact ("updated") is told as a returning lead.
 */
@Injectable()
export class LeadNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'lead-notifications';
  readonly eventTypes = LEAD_NOTIFY_EVENTS;
  private readonly logger = new Logger(LeadNotificationConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: NotificationsRepository,
    private readonly registry: OutboxSubscriberRegistry,
    @Optional() private readonly publisher?: NotificationPublisher,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    if (p.test === true) return;
    const leadEventId = str(p.leadEventId);
    const contactId = str(p.contactId);
    const recipients = Array.isArray(p.notify)
      ? p.notify.filter((v): v is string => typeof v === 'string')
      : [];
    if (!leadEventId || !contactId || recipients.length === 0) return;

    const returning = event.eventType === 'lead.updated';
    const name = plain(str(p.contactName) ?? 'A new contact', 120);
    const platform = plain(str(p.platform) ?? 'a lead source', 60);
    const sourceName = plain(str(p.sourceName) ?? '', 120);

    const pending: WrittenNotification[] = [];
    await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const users = await tx.execute(sql`
        SELECT id, uuid FROM users
        WHERE org_id = ${event.orgId} AND status = 'active'
          AND uuid IN (${sql.join(
            recipients.map((u) => sql`${u}::uuid`),
            sql`, `,
          )})`);
      for (const u of users.rows as Array<{ id: number | string; uuid: string }>) {
        const written = await this.repo.insertReturning(tx, event.orgId, {
          userId: Number(u.id),
          type: 'new_lead',
          title: returning ? 'Lead came in again' : 'New lead',
          body: returning
            ? `${name} sent another lead from ${platform}`
            : `${name} came in from ${platform}`,
          link: `/contacts/${contactId}`,
          data: { leadEventId, contactId, contactName: name, platform, sourceName, returning },
          dedupeKey: leadDedupeKey(leadEventId),
        });
        if (written) {
          pending.push(written);
          this.logger.debug({ orgId: event.orgId, eventId: event.id }, 'lead notification written');
        }
      }
    });
    for (const row of pending) await this.publisher?.created(event.orgId, row);
  }
}
