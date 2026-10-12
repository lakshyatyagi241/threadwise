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

export const SUBSCRIPTION_NOTIFY_EVENTS = [
  'paygw.subscription.past_due',
  'paygw.subscription.canceled',
] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Tells a workspace's owners when the payment provider has changed their subscription behind their back: a renewal charge that did not
 * go through (`past_due`: they still have access for the grace days, but must fix the payment), or the provider ending the subscription
 * (`canceled`: a cancel THEY or an operator made is not announced, the lifecycle only records provider-side changes it did not make).
 * In-app for every owner, deduplicated on the outbox event id so the drain's at-least-once delivery cannot notify twice, and one email
 * for a failed payment (the notice somebody must act on). Runs in the worker under the event's own tenant, never privileged.
 */
@Injectable()
export class SubscriptionNotificationsConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'subscription-notifications';
  readonly eventTypes = SUBSCRIPTION_NOTIFY_EVENTS;
  private readonly logger = new Logger(SubscriptionNotificationsConsumer.name);
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
    const failed = event.eventType === 'paygw.subscription.past_due';
    const slug = str(event.payload.plan);
    const pending: WrittenNotification[] = [];
    const owners: Array<{ id: number; email: string }> = [];
    let name = slug ?? 'subscription';

    await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      if (slug) {
        const plan = await tx.execute(sql`SELECT name FROM plans WHERE slug = ${slug}`);
        name = str((plan.rows[0] as { name?: string } | undefined)?.name) ?? slug;
      }
      const res = await tx.execute(sql`
        SELECT DISTINCT u.id, u.email FROM users u
        JOIN user_roles ur ON ur.org_id = u.org_id AND ur.user_id = u.id
        JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
        WHERE u.org_id = ${event.orgId} AND u.status = 'active' AND r.system_key = 'admin'`);
      for (const o of res.rows as Array<{ id: number | string; email: string }>) {
        owners.push({ id: Number(o.id), email: o.email });
      }
      if (owners.length === 0) {
        this.logger.warn({ orgId: event.orgId }, 'subscription notification has no owner to tell');
        return;
      }
      const copy = failed
        ? {
            type: 'billing_payment_failed',
            title: 'Subscription payment failed',
            body: `The payment for ${name} did not go through. Check your payment method; your plan stays active for a few days while it is retried.`,
          }
        : {
            type: 'billing_subscription_canceled',
            title: 'Subscription cancelled',
            body: `Your ${name} subscription was cancelled by the payment provider. It will not renew; the period you paid for keeps running.`,
          };
      for (const o of owners) {
        const written = await this.notifications.insertReturning(tx, event.orgId, {
          userId: o.id,
          type: copy.type,
          title: copy.title,
          body: copy.body,
          link: '/billing/subscriptions',
          data: { eventType: event.eventType, plan: slug },
          dedupeKey: `${event.eventType}:${event.id}`,
        });
        if (written) pending.push(written);
      }
    });
    for (const row of pending) await this.publisher?.created(event.orgId, row);
    if (failed) await this.mailAll(event, owners, name);
  }

  private async mailAll(
    event: OutboxEvent,
    owners: Array<{ id: number; email: string }>,
    name: string,
  ): Promise<void> {
    if (!this.mail) return;
    for (const o of owners) {
      const key = `paygw:sub-mail:${event.id}:${createHash('sha256').update(o.email).digest('hex').slice(0, 20)}`;
      try {
        // SET NX: the first delivery claims the address; a redelivery finds it taken and sends nothing.
        const claimed = await this.redis.set(key, '1', 'EX', 7 * 86_400, 'NX');
        if (claimed !== 'OK') continue;
        await this.mail.send({
          to: o.email,
          subject: `[${this.brand}] Your subscription payment failed`,
          text: [
            `The payment for your ${name} subscription did not go through.`,
            'Your plan stays active for a few days while the payment provider retries. To keep it, make sure your payment method is valid.',
            '',
            `See your subscriptions: ${this.webUrl}/billing/subscriptions`,
          ].join('\n'),
        });
      } catch (err) {
        this.logger.warn({ err }, 'subscription payment mail failed; the notification is written');
      }
    }
  }
}
