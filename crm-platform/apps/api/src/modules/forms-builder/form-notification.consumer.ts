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

export const FORM_NOTIFY_EVENTS = [
  'form.submitted',
  'form.needs_review',
  'form.payment_succeeded',
  'form.payment_duplicate',
] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Plain text, at most `max` characters: a name or a form title from the public is never rendered raw into a notification or a mail. */
export const plain = (v: string, max: number): string => {
  const t = v
    .replace(/<[^>]*>/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** One key per submission and person: a redelivered event collides, so a person is told once per submission. */
export const submissionDedupeKey = (submissionId: string): string =>
  `form_submission:${submissionId}`;
/** A full plan is announced once a day per form, not once per rejected lead. */
export const capDedupeKey = (formId: string, day: string): string => `form_cap:${formId}:${day}`;

const REASON_TEXT: Record<string, string> = {
  no_contact_point: 'it has no email address or phone number',
  invalid_phone: 'its phone number could not be read',
  plan_limit_reached: "the plan's contact limit is reached",
  submissions_cap: "the plan's monthly submission limit is reached",
};

/**
 * Turns a form outcome into notifications (docs/specs/forms-builder-app.md 9.1 step 8): an in-app notification to the people the pipeline
 * resolved (the contact's owner when the form says so, plus the extra users on the form), and a notification email to the addresses the
 * form lists. Runs in the worker under the event's own tenant, never privileged, and is idempotent: the in-app insert is
 * ON CONFLICT DO NOTHING on a dedupe key, and an email address is sent to once per submission (a Redis key with a week's life).
 *
 * A mail failure is logged and does not fail the event: the submission is stored and the in-app notification is written. The mail carries
 * the contact's name and a link, not the answers: mail travels, the admin screen is where answers are read.
 */
@Injectable()
export class FormNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'form-notifications';
  readonly eventTypes = FORM_NOTIFY_EVENTS;
  private readonly logger = new Logger(FormNotificationConsumer.name);
  private readonly webUrl: string;
  private readonly brand: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: NotificationsRepository,
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
    const p = event.payload;
    const formId = str(p.formId);
    const submissionId = str(p.submissionId);
    if (!formId || !submissionId) return;
    const formName = plain(str(p.formName) ?? 'a form', 120);
    const link = `/forms/${formId}/submissions?submission=${submissionId}`;
    const recipients = Array.isArray(p.notify)
      ? p.notify.filter((v): v is string => typeof v === 'string')
      : [];

    if (event.eventType === 'form.needs_review') {
      const reason = str(p.reason) ?? 'no_contact_point';
      const day = new Date().toISOString().slice(0, 10);
      await this.inApp(event, recipients, {
        type: 'form_needs_review',
        title: 'A form submission needs review',
        body: `A submission to ${formName} was kept for review: ${REASON_TEXT[reason] ?? 'it could not be processed'}.`,
        link,
        data: { formId, formName, submissionId, reason },
        dedupeKey:
          reason === 'submissions_cap' ? capDedupeKey(formId, day) : `form_review:${submissionId}`,
      });
      return;
    }

    if (
      event.eventType === 'form.payment_succeeded' ||
      event.eventType === 'form.payment_duplicate'
    ) {
      await this.handlePayment(event, p, recipients, { formId, formName, submissionId, link });
      return;
    }

    const returning = p.created === false;
    const name = plain(str(p.contactName) ?? 'Someone', 120);
    await this.inApp(event, recipients, {
      type: 'form_submission',
      title: returning ? 'A contact submitted a form again' : 'New form submission',
      body: `${name} submitted ${formName}`,
      link,
      data: {
        formId,
        formName,
        submissionId,
        contactId: str(p.contactId),
        contactName: name,
        created: !returning,
      },
      dedupeKey: submissionDedupeKey(submissionId),
    });
    const emails = Array.isArray(p.notifyEmails)
      ? p.notifyEmails.filter((v): v is string => typeof v === 'string')
      : [];
    await this.emailAll(emails, submissionId, formName, name, returning, `${this.webUrl}${link}`);
  }

  /**
   * A payment on a form: the in-app note goes to the same people as the submission (the contact's owner and the listed users), once per
   * payment attempt; a second payment for a submission already paid is its own, louder note because it needs a refund. The notification
   * email goes to the listed addresses for a normal payment only.
   */
  private async handlePayment(
    event: OutboxEvent,
    p: Record<string, unknown>,
    recipients: string[],
    form: { formId: string; formName: string; submissionId: string; link: string },
  ): Promise<void> {
    const paymentId = str(p.paymentId);
    if (!paymentId) return;
    const duplicate = event.eventType === 'form.payment_duplicate';
    const name = plain(str(p.contactName) ?? 'Someone', 120);
    const amount = plain(`${str(p.amount) ?? ''} ${str(p.currency) ?? ''}`, 40);
    await this.inApp(event, recipients, {
      type: duplicate ? 'form_payment_duplicate' : 'form_payment',
      title: duplicate ? 'A form was paid twice' : 'Payment received on a form',
      body: duplicate
        ? `${name} paid ${amount} again for ${form.formName}. Refund the extra payment from your gateway.`
        : `${name} paid ${amount} for ${form.formName}`,
      link: form.link,
      data: {
        formId: form.formId,
        formName: form.formName,
        submissionId: form.submissionId,
        paymentId,
        contactName: name,
        amount,
      },
      dedupeKey: `${duplicate ? 'form_payment_dup' : 'form_payment'}:${paymentId}`,
    });
    if (duplicate) return;
    const emails = Array.isArray(p.notifyEmails)
      ? p.notifyEmails.filter((v): v is string => typeof v === 'string')
      : [];
    await this.emailPayment(
      emails,
      paymentId,
      form.formName,
      name,
      amount,
      `${this.webUrl}${form.link}`,
    );
  }

  private async emailPayment(
    emails: string[],
    paymentId: string,
    formName: string,
    contactName: string,
    amount: string,
    url: string,
  ): Promise<void> {
    if (!this.mail || emails.length === 0) return;
    for (const to of emails) {
      const key = `form:paymail:${paymentId}:${createHash('sha256').update(to).digest('hex').slice(0, 20)}`;
      try {
        const claimed = await this.redis.set(key, '1', 'EX', 7 * 86_400, 'NX');
        if (claimed !== 'OK') continue;
        await this.mail.send({
          to,
          subject: `[${this.brand}] Payment received: ${formName}`,
          text: [
            `${contactName} paid ${amount} for "${formName}".`,
            '',
            `Open the submission: ${url}`,
          ].join('\n'),
        });
      } catch (err) {
        this.logger.warn({ err }, 'form payment mail failed; the payment is recorded');
      }
    }
  }

  private async inApp(
    event: OutboxEvent,
    recipients: string[],
    note: {
      type: string;
      title: string;
      body: string;
      link: string;
      data: Record<string, unknown>;
      dedupeKey: string;
    },
  ): Promise<void> {
    if (recipients.length === 0) return;
    const pending: WrittenNotification[] = [];
    await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const users = await tx.execute(sql`
        SELECT id FROM users
        WHERE org_id = ${event.orgId} AND status = 'active'
          AND uuid IN (${sql.join(
            recipients.map((u) => sql`${u}::uuid`),
            sql`, `,
          )})`);
      for (const u of users.rows as Array<{ id: number | string }>) {
        const written = await this.repo.insertReturning(tx, event.orgId, {
          userId: Number(u.id),
          ...note,
        });
        if (written) pending.push(written);
      }
    });
    for (const row of pending) await this.publisher?.created(event.orgId, row);
  }

  private async emailAll(
    emails: string[],
    submissionId: string,
    formName: string,
    contactName: string,
    returning: boolean,
    url: string,
  ): Promise<void> {
    if (!this.mail || emails.length === 0) return;
    for (const to of emails) {
      const key = `form:mail:${submissionId}:${createHash('sha256').update(to).digest('hex').slice(0, 20)}`;
      try {
        // SET NX: the first delivery of this event claims the address; a redelivery finds it taken and sends nothing.
        const claimed = await this.redis.set(key, '1', 'EX', 7 * 86_400, 'NX');
        if (claimed !== 'OK') continue;
        await this.mail.send({
          to,
          subject: `[${this.brand}] ${returning ? 'Form submitted again' : 'New form submission'}: ${formName}`,
          text: [
            `${contactName} ${returning ? 'submitted' : 'just submitted'} "${formName}".`,
            '',
            `Open the submission: ${url}`,
          ].join('\n'),
        });
      } catch (err) {
        this.logger.warn({ err }, 'form notification mail failed; the submission is stored');
      }
    }
  }
}
