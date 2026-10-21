/**
 * The port between appointments and the channels that deliver their messages (TW-APPT-013, 030, 031; EXT-APPT-08). Reference posted
 * reminders to its Node WhatsApp bridge by hand; here the domain turns an event ("the booking was confirmed", "a reminder is due")
 * into a finished message and hands it to this interface. Delivery (WhatsApp, email, a template, the right sender and connection) is
 * the channel domains' job: they register an adapter under the `APPOINTMENT_MESSENGER` token.
 *
 * Delivery is at-least-once (the outbox redelivers), so an adapter MUST dedupe on `idempotencyKey`: the same key is the same message.
 * Throwing means "try again" (the consumer is retried with backoff); an adapter that cannot deliver for a lasting reason (no phone, no
 * connected sender, opted out) returns `skipped` instead, so the event is not retried forever.
 */

export const APPOINTMENT_MESSENGER = Symbol('APPOINTMENT_MESSENGER');

export type BookingMessageEvent =
  | 'confirmation'
  | 'reminder'
  | 'cancellation'
  | 'reschedule'
  /** The after-visit follow-up of a reminder rule (BL-283). */
  | 'follow_up'
  /** The no-show message of a reminder sequence (BL-421). */
  | 'no_show'
  /** The rebook (recall) message of a reminder sequence (BL-421). */
  | 'rebook';
/** SMS was removed from appointment messages: WhatsApp and email carry them (the other values are not addressable by a booking). */
export type BookingMessageChannel = 'whatsapp' | 'email' | 'telegram' | 'instagram' | 'facebook';

export interface BookingMessage {
  orgId: number;
  /** The appointment's uuid. */
  appointmentId: string;
  event: BookingMessageEvent;
  channel: BookingMessageChannel;
  to: { name: string | null; phone: string | null; email: string | null };
  /** The finished text (variables already filled). */
  body: string;
  /** An email's subject line. */
  subject: string;
  /** A WhatsApp template of the workspace to send instead of `body`, with its variable map; null = free text. */
  waTemplateId: string | null;
  variableMap: Record<string, string> | null;
  /** The same key is the same message: dedupe on it. */
  idempotencyKey: string;
  /** The contact's uuid when the booking has one. WhatsApp needs it (the message lands in the contact's thread). */
  contactId?: string | null;
  /** Every named placeholder of the booking (name, type, date, time, location, ...), to fill a template's numbered values. */
  variables?: Record<string, string>;
  /**
   * `service`: the booking's own notices and reminders (asked of the ConsentGate as service messages). `follow_up`: an after-visit
   * follow-up or a rebook message, asked as marketing (it needs consent where the workspace requires it).
   */
  purpose?: 'service' | 'follow_up';
  /** A reminder that quiet hours would push past this instant (the booking's start) is skipped instead of held. */
  notAfter?: string | null;
  /**
   * The payloads of the template's quick-reply buttons, in button order (Confirm, Reschedule, Cancel). Each is a signed one-time token
   * bound to this booking and step; the messenger sends them as the buttons' payload so the customer's tap comes back to the booking.
   * Used only with a WhatsApp template that has quick-reply buttons.
   */
  quickReplyPayloads?: string[];
  /**
   * A test of a step sent to a staff member's own email (BL-425): quiet hours and the customer consent check do not apply (it is not a
   * customer), the owner's channel choice still does. Email only.
   */
  isTest?: boolean;
}

export interface BookingMessageResult {
  /** `held`: not now, ask again (quiet hours, a channel that is down); `holdUntil` is when, when the adapter knows. */
  status: 'sent' | 'skipped' | 'failed' | 'held';
  /** Why it was skipped, held or failed: a stable code (logged and recorded, not shown to the customer). */
  reason?: string;
  holdUntil?: string;
  providerMessageId?: string;
}

export interface AppointmentMessenger {
  readonly name: string;
  send(message: BookingMessage): Promise<BookingMessageResult>;
}
