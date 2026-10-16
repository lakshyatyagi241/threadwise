import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  MAIL_PORT,
  type MailPort,
} from '../../infra/providers/auth-registration-security/mail.port';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
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
import { reminderCopy, type ReminderKind } from './subscription-notification-copy';

/** The subscription events a workspace's admins are told about: the period is ending, the card failed, the subscription ended. */
export const MARKET_NOTIFY_EVENTS = [
  'marketplace.subscription.renewal_due',
  'marketplace.subscription.payment_failed',
  'marketplace.subscription.lapsed',
] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Which of the three messages an event is, and the notification type it writes. */
const KIND: Record<(typeof MARKET_NOTIFY_EVENTS)[number], ReminderKind> = {
  'marketplace.subscription.renewal_due': 'renewal_due',
  'marketplace.subscription.payment_failed': 'payment_failed',
  'marketplace.subscription.lapsed': 'ended',
};

/**
 * Tells a workspace's admins what is about to happen to a paid app (BL-076): the period ends in a few days (renews by card, is paid until a
 * date, or was cancelled and ends), the card renewal failed (the app keeps working for the grace days), or the subscription ended and the app
 * was paused. An in-app notification for every admin, deduplicated on the outbox event id so the drain's at-least-once delivery cannot notify
 * twice, and one email each (a Redis claim keyed by event and address keeps a redelivery from mailing again). Runs in the worker under the
 * event's own tenant, never privileged. The events are written by `MarketSubscriptionLifecycle.note` in the transaction of the change.
 */
@Injectable()
export class MarketSubscriptionNotificationsConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'marketplace-subscription-notifications';
  readonly eventTypes = MARKET_NOTIFY_EVENTS;
  private readonly logger = new Logger(MarketSubscriptionNotificationsConsumer.name);
  private readonly webUrl: string;
  private readonly brand: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsRepository,
    private readonly registry: OutboxSubscriberRegistry,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
    @Optional() private readonly publisher?: NotificationPublisher,
  ) {
    this.webUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
    this.brand = config.get('APP_NAME', { infer: true });
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const kind = KIND[event.eventType as keyof typeof KIND];
    if (!kind) return;
    const slug = str(event.payload.app);
    if (!slug) return;
    // An operator who ended a subscription or the kill switch already told the workspace by acting; only the clock's lapse is news.
    if (kind === 'ended' && str(event.payload.by) !== 'system') return;
    const periodEnd = str(event.payload.periodEnd);
    const pending: WrittenNotification[] = [];
    const owners: Array<{ id: number; email: string }> = [];
    let appName = slug;
    let copy = reminderCopy(kind, {
      name: slug,
      date: null,
      autoRenew: false,
      canceling: false,
      graceEnds: null,
    });

    await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const app = await tx.execute(sql`SELECT name FROM marketplace_apps WHERE slug = ${slug}`);
      appName = str((app.rows[0] as { name?: string } | undefined)?.name) ?? slug;
      const res = await tx.execute(sql`
        SELECT DISTINCT u.id, u.email FROM users u
        JOIN user_roles ur ON ur.org_id = u.org_id AND ur.user_id = u.id
        JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
        WHERE u.org_id = ${event.orgId} AND u.status = 'active' AND r.system_key = 'admin'`);
      for (const o of res.rows as Array<{ id: number | string; email: string }>)
        owners.push({ id: Number(o.id), email: o.email });
      if (owners.length === 0) {
        this.logger.warn(
          { orgId: event.orgId },
          'marketplace subscription notice has no admin to tell',
        );
        return;
      }
      copy = reminderCopy(kind, {
        name: appName,
        date: periodEnd,
        autoRenew: event.payload.autorenew === true,
        canceling: event.payload.canceling === true,
        graceEnds: str(event.payload.graceEndsAt),
      });
      for (const o of owners) {
        const written = await this.notifications.insertReturning(tx, event.orgId, {
          userId: o.id,
          type: copy.type,
          title: copy.title,
          body: copy.body,
          link: `/marketplace/app/${slug}`,
          data: {
            eventType: event.eventType,
            app: appName,
            appSlug: slug,
            periodEnd,
            autoRenew: event.payload.autorenew === true,
            canceling: event.payload.canceling === true,
          },
          dedupeKey: `${event.eventType}:${event.id}`,
        });
        if (written) pending.push(written);
      }
    });
    for (const row of pending) await this.publisher?.created(event.orgId, row);
    await this.mailAll(event, owners, copy, slug);
  }

  private async mailAll(
    event: OutboxEvent,
    owners: Array<{ id: number; email: string }>,
    copy: { title: string; body: string },
    slug: string,
  ): Promise<void> {
    if (!this.mail) return;
    for (const o of owners) {
      const key = `mkt:sub-mail:${event.id}:${createHash('sha256').update(o.email).digest('hex').slice(0, 20)}`;
      try {
        // SET NX: the first delivery claims the address; a redelivery finds it taken and sends nothing.
        const claimed = await this.redis.set(key, '1', 'EX', 7 * 86_400, 'NX');
        if (claimed !== 'OK') continue;
        await this.mail.send({
          to: o.email,
          subject: `[${this.brand}] ${copy.title}`,
          text: [copy.body, '', `Open the app: ${this.webUrl}/marketplace/app/${slug}`].join('\n'),
        });
      } catch (err) {
        this.logger.warn(
          { err },
          'marketplace subscription mail failed; the notification is written',
        );
      }
    }
  }
}
