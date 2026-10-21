import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { BookingTemplateEvent } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import {
  APPOINTMENT_MESSENGER,
  type AppointmentMessenger,
  type BookingMessage,
  type BookingMessageChannel,
} from '../../infra/providers/appointments-booking';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { AppointmentReminderService } from './appointment-reminder.service';
import { AppointmentRemindersRepository } from './appointment-reminders.repository';
import { AppointmentsRepository, type AppointmentRow } from './appointments.repository';
import { AppointmentsSupport } from './appointments.support';
import { BookingTypesRepository, type TemplateRow } from './booking-types.repository';
import { messageBody, renderTemplate, variablesFor } from './message-render';

export const MESSAGE_EVENTS = [
  'appointment.booked',
  'appointment.confirmed',
  'appointment.declined',
  'appointment.cancelled',
  'appointment.rescheduled',
  /** A visit was marked no-show: the no-show step of the reminder sequence goes out (BL-421). */
  'appointment.no_show',
] as const;

/** Which lifecycle message an event is, and the status the booking must still have for it to be worth sending. */
const PLAN: Record<
  Exclude<(typeof MESSAGE_EVENTS)[number], 'appointment.no_show'>,
  { template: BookingTemplateEvent; status: AppointmentRow['status'] }
> = {
  'appointment.booked': { template: 'confirmation', status: 'confirmed' },
  'appointment.confirmed': { template: 'confirmation', status: 'confirmed' },
  'appointment.declined': { template: 'cancellation', status: 'declined' },
  'appointment.cancelled': { template: 'cancellation', status: 'cancelled' },
  'appointment.rescheduled': { template: 'reschedule', status: 'confirmed' },
};

const SUBJECTS: Record<BookingTemplateEvent, string> = {
  confirmation: 'Your booking is confirmed',
  reminder: 'Reminder: your booking is coming up',
  cancellation: 'Your booking was cancelled',
  reschedule: 'Your booking was moved',
};

/** The channels this stack can address from what an appointment holds: a phone (WhatsApp) and an email. */
function addressable(channel: TemplateRow['channel'], row: AppointmentRow): boolean {
  if (channel === 'whatsapp') return row.inviteePhone !== null;
  if (channel === 'email') return row.inviteeEmail !== null;
  return false;
}

/**
 * Turns booking events into customer messages (TW-APPT-013, 030, 031; D-14): the confirmation, the reminder, the cancellation and the
 * reschedule notice, through the `AppointmentMessenger` port (the channel domains register the adapter that really sends).
 *
 * Idempotent: the idempotency key is the outbox event id plus the channel, and a port adapter dedupes on it, so the drain's
 * at-least-once delivery cannot send a message twice. The booking is read again at delivery, so a message about a state that no
 * longer holds (reminded after cancelling, "confirmed" after a decline) is dropped rather than sent late.
 *
 * Which channels: the channels the type has a message configured for that event, else WhatsApp when there is a phone, else email.
 * `notify: false` on the event (a silent staff action) sends nothing. Runs in the worker process under the event's own tenant.
 */
@Injectable()
export class AppointmentMessageConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'appointment-messages';
  readonly eventTypes = MESSAGE_EVENTS;
  private readonly logger = new Logger(AppointmentMessageConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly appts: AppointmentsRepository,
    private readonly types: BookingTypesRepository,
    private readonly support: AppointmentsSupport,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly sequence: AppointmentReminderService,
    private readonly runs: AppointmentRemindersRepository,
    @Inject(APPOINTMENT_MESSENGER) private readonly messenger: AppointmentMessenger,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const uuid = typeof event.payload.uuid === 'string' ? event.payload.uuid : null;
    if (event.eventType === 'appointment.no_show') {
      if (uuid && event.payload.notify !== false) await this.eventStep(event, uuid, 'no_show');
      return;
    }
    const plan = PLAN[event.eventType as keyof typeof PLAN];
    if (!plan || !uuid || event.payload.notify === false) return;
    // The confirmation is a step of the booking type's reminder sequence when the type has one switched on: that step has its own
    // channel order, message and delivery record, so the single confirmation below is not sent as well.
    if (plan.template === 'confirmation' && (await this.eventStep(event, uuid, 'confirmation'))) {
      return;
    }

    const messages = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const row = await this.appts.findByUuid(tx, event.orgId, uuid);
      if (!row || row.status !== plan.status) return [];
      if (plan.template === 'reminder' && row.startsAt.getTime() <= Date.now()) return [];
      const children =
        row.bookingTypeId === null
          ? null
          : (await this.types.children(tx, event.orgId, [row.bookingTypeId])).get(
              row.bookingTypeId,
            );
      const configured = (children?.templates ?? []).filter((t) => t.event === plan.template);
      const channels: Array<{ channel: BookingMessageChannel; tpl: TemplateRow | null }> = [];
      for (const t of configured)
        if (addressable(t.channel, row)) channels.push({ channel: t.channel, tpl: t });
      // Nothing configured: WhatsApp when there is a phone, then email when there is an address. The first that delivers wins (WhatsApp
      // outside its 24 hour window needs a template, so a booker reachable by email still gets the notice).
      const unconfigured = channels.length === 0 && configured.length === 0;
      if (unconfigured) {
        if (row.inviteePhone) channels.push({ channel: 'whatsapp', tpl: null });
        if (row.inviteeEmail) channels.push({ channel: 'email', tpl: null });
      }
      const facts = {
        typeName: row.bookingTypeName ?? row.title,
        title: row.title,
        inviteeName: row.inviteeName,
        startsAtMs: row.startsAt.getTime(),
        timezone: row.timezone,
        location: row.meetUrl ?? row.location,
        manageUrl: this.support.manageUrlOf(row),
        joinUrl: row.meetUrl,
      };
      const vars = variablesFor(facts);
      return channels.map(({ channel, tpl }): BookingMessage & { firstWins: boolean } => {
        // A message chosen from the library (BL-351) is read now, so editing it changes what is sent; an inactive one is ignored.
        const lib = tpl?.libraryTemplateId && tpl.libraryActive ? tpl : null;
        return {
          firstWins: unconfigured,
          orgId: event.orgId,
          appointmentId: row.uuid,
          event: plan.template,
          channel,
          to: { name: row.inviteeName, phone: row.inviteePhone, email: row.inviteeEmail },
          body: messageBody(plan.template, lib?.libraryBody ?? tpl?.plainBody, facts),
          subject: lib?.librarySubject
            ? renderTemplate(lib.librarySubject, vars)
            : `${facts.typeName}: ${SUBJECTS[plan.template]}`,
          waTemplateId: lib?.libraryWaUuid ?? tpl?.waTemplateUuid ?? null,
          variableMap: tpl?.variableMap ?? null,
          idempotencyKey: `${event.id}:${channel}`,
          contactId: row.contactUuid,
          variables: vars,
          purpose: 'service',
        };
      });
    });

    let delivered = false;
    for (const { firstWins, ...message } of messages) {
      if (firstWins && delivered) continue;
      // The messenger asks the ConsentGate itself (a booking notice is a service message, BL-141: a contact who sent STOP still gets
      // it, one who withdrew the service purpose on that channel does not).
      const res = await this.messenger.send(message);
      if (res.status === 'failed' || res.status === 'held') {
        // Throwing makes the drain retry the event with backoff; the adapter's dedupe makes the retry safe.
        throw new Error(
          `booking message ${res.status} (${message.channel}): ${res.reason ?? 'unknown'}`,
        );
      }
      if (res.status === 'sent') delivered = true;
      if (res.status === 'skipped') {
        this.logger.debug(
          { event: event.eventType, channel: message.channel, reason: res.reason },
          'booking message skipped',
        );
      }
    }
  }

  /**
   * Hands an event to the booking type's sequence step for it (the confirmation, the no-show message). True when the type has that step
   * switched on and it took over; false when the type has none (the older single message is then used, for the confirmation).
   */
  private async eventStep(
    event: OutboxEvent,
    uuid: string,
    step: 'confirmation' | 'no_show',
  ): Promise<boolean> {
    const found = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const row = await this.appts.findByUuid(tx, event.orgId, uuid);
      if (!row || row.bookingTypeId === null) return null;
      if (step === 'confirmation' && row.status !== 'confirmed') return null;
      if (!(await this.runs.hasEventStep(tx, event.orgId, row.bookingTypeId, step))) return null;
      return row.id;
    });
    if (found === null) return false;
    // The step owns this event now, whether this call took the run or an earlier delivery of the same event already had.
    await this.sequence.deliverEventStep(event.orgId, found, step);
    return true;
  }
}
