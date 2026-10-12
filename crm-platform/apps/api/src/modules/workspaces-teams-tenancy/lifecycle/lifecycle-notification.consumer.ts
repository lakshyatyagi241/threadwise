import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  MAIL_PORT,
  type MailPort,
} from '../../../infra/providers/auth-registration-security/mail.port';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../../kernel/outbox/outbox-subscribers';
import { LifecycleRepository } from './lifecycle.repository';

export const LIFECYCLE_EVENTS = ['org.lifecycle.reminder', 'org.archived', 'org.restored'] as const;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const dateText = (iso: string | null): string => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'the scheduled date';
};

export interface LifecycleMail {
  subject: string;
  text: string;
}

/**
 * The notice a workspace's owner and admins get (ADR-0028). Pure, so the wording is testable: the stage, the number of days idle and the
 * exact date of the next step, and what to do about it. No personal data of anyone but the recipient's own workspace name.
 */
export function composeLifecycleMail(
  eventType: string,
  payload: Record<string, unknown>,
  ctx: { workspace: string; brand: string; webUrl: string },
): LifecycleMail | null {
  const { workspace, brand, webUrl } = ctx;
  const sign = `Sign in to keep it active: ${webUrl}/login`;
  if (eventType === 'org.lifecycle.reminder') {
    const stage = payload.stage === 'delete' ? 'delete' : 'archive';
    const n = num(payload.reminderNo) ?? 1;
    const idle = num(payload.daysInactive);
    const when = dateText(str(payload.actionAt));
    const idleText = idle === null ? 'a long time' : `${idle} days`;
    if (stage === 'archive') {
      return {
        subject: `[${brand}] Your workspace "${workspace}" will be archived on ${when} (reminder ${n} of 3)`,
        text: [
          `Your workspace "${workspace}" has had no activity for ${idleText}.`,
          '',
          `If it stays inactive it will be archived on ${when}. An archived workspace cannot be used, but nothing is deleted yet and it can be restored on request.`,
          '',
          sign,
        ].join('\n'),
      };
    }
    return {
      subject: `[${brand}] Your archived workspace "${workspace}" will be permanently deleted on ${when} (reminder ${n} of 3)`,
      text: [
        `Your workspace "${workspace}" is archived and has had no activity for ${idleText}.`,
        '',
        `On ${when} it will be permanently deleted, with all its contacts, conversations and files. This cannot be undone.`,
        '',
        `To keep it, reply to this email or contact support before ${when} and ask for the workspace to be restored.`,
      ].join('\n'),
    };
  }
  if (eventType === 'org.archived') {
    const days = num(payload.deleteAfterDays);
    return {
      subject: `[${brand}] Your workspace "${workspace}" has been archived`,
      text: [
        `Your workspace "${workspace}" was archived because it had no activity.`,
        '',
        `Nothing has been deleted. ${days ? `If it stays inactive it will be permanently deleted after ${days} days without activity, and we will remind you three times before then.` : 'We will remind you before it is permanently deleted.'}`,
        '',
        'To restore it, reply to this email or contact support.',
      ].join('\n'),
    };
  }
  if (eventType === 'org.restored') {
    return {
      subject: `[${brand}] Your workspace "${workspace}" has been restored`,
      text: [
        `Your workspace "${workspace}" is active again and you can sign in.`,
        '',
        `${webUrl}/login`,
      ].join('\n'),
    };
  }
  return null;
}

/**
 * Sends the lifecycle notices. Runs in the worker under the event's own tenant, never privileged, and is idempotent: one mail per
 * (event, address), enforced by a Redis key with a week's life. A mail failure is logged and does NOT fail the event: the reminder is
 * recorded in org_lifecycle_log regardless, and a failed send is visible there in the logs, not silently swallowed.
 */
@Injectable()
export class LifecycleNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'workspace-lifecycle-notifications';
  readonly eventTypes = LIFECYCLE_EVENTS;
  private readonly logger = new Logger(LifecycleNotificationConsumer.name);
  private readonly webUrl: string;
  private readonly brand: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LifecycleRepository,
    private readonly registry: OutboxSubscriberRegistry,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {
    this.webUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
    this.brand = config.get('APP_NAME', { infer: true });
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    if (!this.mail) return;
    const { workspace, emails } = await this.db.txAs(
      { orgId: event.orgId, userId: null },
      async (tx) => {
        const row = await tx.execute(sql`SELECT name FROM organizations WHERE id = ${event.orgId}`);
        return {
          workspace: (row.rows[0] as { name?: string } | undefined)?.name ?? 'your workspace',
          emails: await this.repo.recipients(tx, event.orgId),
        };
      },
    );
    const mail = composeLifecycleMail(event.eventType, event.payload, {
      workspace: workspace.replace(/[\r\n]+/g, ' ').slice(0, 120),
      brand: this.brand,
      webUrl: this.webUrl,
    });
    if (!mail) return;

    for (const to of emails) {
      const key = `wsp:lifecycle-mail:${event.id}:${createHash('sha256').update(to).digest('hex').slice(0, 24)}`;
      const first = await this.redis.set(key, '1', 'EX', 7 * 86_400, 'NX').catch(() => 'OK');
      if (first === null) continue;
      try {
        await this.mail.send({ to, subject: mail.subject, text: mail.text });
      } catch (err) {
        await this.redis.del(key).catch(() => undefined);
        this.logger.error(
          { err, orgId: event.orgId, eventType: event.eventType },
          'lifecycle mail failed',
        );
      }
    }
  }
}
