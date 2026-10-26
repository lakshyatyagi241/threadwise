import { HttpStatus, Injectable, Logger, type OnModuleInit, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, type ReminderTestSendResult } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  APPOINTMENT_MESSENGER,
  type AppointmentMessenger,
} from '../../infra/providers/appointments-booking';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { APPOINTMENT_MODULE } from './appointment-rules';
import { AppointmentRemindersRepository } from './appointment-reminders.repository';
import { AppointmentReminderService, eventOf } from './appointment-reminder.service';
import { BookingTypesRepository } from './booking-types.repository';
import { variablesFor, type MessageFacts } from './message-render';

export const TEST_REQUESTED = 'appointment.reminder_test_requested';
export const TEST_FINISHED = 'appointment.reminder_test_finished';
/** A typed address makes this an outbound email to anyone, so the tests are capped per workspace (an address-typing abuse guard). */
export const TEST_EMAILS_PER_HOUR = 10;

/** `a***@example.com`: enough for the person to recognise their own address, nothing for anyone looking over a shoulder. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email.charAt(0)}***${email.slice(at)}`;
}

/**
 * The email test of a reminder step (BL-425): the person who is editing the step gets the email at their OWN address, with sample
 * values, so they see what a customer would read. Email only: there is no WhatsApp test (a template message to a real number costs money
 * and needs that person's consent). The request is an outbox event (nothing in the API process sends a booking message); the worker
 * sends it and tells the person the result in the bell.
 */
@Injectable()
export class ReminderTestSendService {
  constructor(
    private readonly db: DatabaseService,
    private readonly types: BookingTypesRepository,
    private readonly runs: AppointmentRemindersRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async request(
    typeUuid: string,
    reminderUuid: string,
    to?: string,
  ): Promise<ReminderTestSendResult> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.forbidden('a signed-in user');
    return this.db.tx(async (tx) => {
      const type = await this.types.findByUuid(tx, ctx.orgId, typeUuid);
      if (!type) throw AppError.notFound('Booking type', typeUuid);
      const rule = await this.runs.findRuleByUuid(tx, ctx.orgId, reminderUuid);
      if (!rule || rule.bookingTypeId !== type.id)
        throw AppError.notFound('Reminder', reminderUuid);
      const res = await tx.execute(
        sql`SELECT email::text AS email FROM users WHERE org_id = ${ctx.orgId} AND id = ${ctx.userId}`,
      );
      const own = (res.rows as Array<{ email: string | null }>)[0]?.email;
      const email = to ?? own;
      if (!email) {
        return { status: 'skipped', reason: 'no_contact_point', sentTo: null };
      }
      const recent = await tx.execute(
        sql`SELECT count(*)::int AS n FROM event_outbox
            WHERE org_id = ${ctx.orgId} AND event_type = ${TEST_REQUESTED} AND created_at > now() - interval '1 hour'`,
      );
      if (((recent.rows as Array<{ n: number }>)[0]?.n ?? 0) >= TEST_EMAILS_PER_HOUR) {
        throw new AppError(
          ERROR_CODES.RATE_LIMITED,
          'Too many test emails this hour. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: APPOINTMENT_MODULE,
        aggregateId: type.id,
        eventType: TEST_REQUESTED,
        // Ids only for the signed-in user's own address: the worker reads it again from the user. A TYPED address has to travel with the
        // event (there is no other place to keep it for the few seconds until the worker runs); the event is not shown anywhere.
        payload: { typeUuid, reminderUuid, userId: ctx.userId, ...(to ? { to } : {}) },
      });
      await this.audit.record(tx, {
        module: 'booking_reminders',
        recordId: rule.id,
        action: 'update',
        delta: {
          test_email_requested: { old: null, new: true },
          ...(to ? { test_email_other_address: { old: null, new: true } } : {}),
        },
      });
      return { status: 'queued', reason: null, sentTo: maskEmail(email) };
    });
  }
}

/** Sends the test (worker). */
@Injectable()
export class ReminderTestSendConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'appointment-reminder-test';
  readonly eventTypes = [TEST_REQUESTED] as const;
  private readonly logger = new Logger(ReminderTestSendConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly types: BookingTypesRepository,
    private readonly runs: AppointmentRemindersRepository,
    private readonly reminders: AppointmentReminderService,
    private readonly outbox: OutboxService,
    @Inject(APPOINTMENT_MESSENGER) private readonly messenger: AppointmentMessenger,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    const typeUuid = typeof p.typeUuid === 'string' ? p.typeUuid : null;
    const reminderUuid = typeof p.reminderUuid === 'string' ? p.reminderUuid : null;
    const userId = typeof p.userId === 'number' ? p.userId : null;
    const typed = typeof p.to === 'string' && p.to.length > 0 ? p.to : null;
    if (!typeUuid || !reminderUuid || userId === null) return;

    const loaded = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const type = await this.types.findByUuid(tx, event.orgId, typeUuid);
      const rule = await this.runs.findRuleByUuid(tx, event.orgId, reminderUuid);
      if (!type || !rule || rule.bookingTypeId !== type.id) return null;
      const res = await tx.execute(
        sql`SELECT email::text AS email, full_name FROM users WHERE org_id = ${event.orgId} AND id = ${userId} AND status = 'active'`,
      );
      const user = (res.rows as Array<{ email: string | null; full_name: string | null }>)[0];
      if (!user?.email && !typed) return null;
      const kids = (await this.types.children(tx, event.orgId, [type.id])).get(type.id);
      const typeReminderBody =
        (kids?.templates ?? [])
          .filter((t) => t.event === 'reminder')
          .map((t) => (t.libraryActive && t.libraryBody?.trim() ? t.libraryBody : t.plainBody))
          .find((b) => b?.trim()) ?? null;
      return {
        type,
        rule,
        user: user ?? { email: null, full_name: null },
        typeReminderBody,
      };
    });
    if (!loaded) return;
    const { type, rule, user, typeReminderBody } = loaded;

    // Sample values: tomorrow at 10:00 in the service's zone, the person's own name, links that go nowhere real.
    const startsAtMs = Date.now() + 24 * 3_600_000;
    const facts: MessageFacts = {
      typeName: type.name,
      title: type.name,
      inviteeName: user.full_name,
      startsAtMs,
      timezone: type.timezone ?? 'UTC',
      location: type.locationValue ?? 'Main branch',
      manageUrl: 'https://example.com/b/manage/sample',
      joinUrl: type.locationType === 'virtual' ? 'https://meet.example.com/sample' : null,
      hostName: type.hostName,
      hostPhone: null,
      serviceLabel: rule.serviceLabel,
    };
    const { body, subject } = this.reminders.textFor(
      'email',
      rule,
      rule.stepKind,
      typeReminderBody,
      facts,
      variablesFor(facts),
    );
    const res = await this.messenger.send({
      orgId: event.orgId,
      appointmentId: 'test',
      event: eventOf(rule.stepKind),
      channel: 'email',
      to: { name: user.full_name, phone: null, email: typed ?? user.email! },
      body,
      subject: `[Test] ${subject}`,
      waTemplateId: null,
      variableMap: null,
      idempotencyKey: `apptrem-test:${event.id}`,
      isTest: true,
    });
    await this.db.txAs({ orgId: event.orgId, userId: null }, (tx) =>
      this.outbox.emit(tx, {
        orgId: event.orgId,
        aggregateModule: APPOINTMENT_MODULE,
        aggregateId: type.id,
        eventType: TEST_FINISHED,
        payload: { userId, status: res.status, reason: res.reason ?? null, typeUuid },
      }),
    );
    this.logger.debug({ orgId: event.orgId, status: res.status }, 'reminder test email');
  }
}
