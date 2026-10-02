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

export type BookingMessageEvent = 'confirmation' | 'reminder' | 'cancellation' | 'reschedule';
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
}

export interface BookingMessageResult {
  status: 'sent' | 'skipped' | 'failed';
  /** Why it was skipped or failed (logged, not shown to the customer). */
  reason?: string;
  providerMessageId?: string;
}

export interface AppointmentMessenger {
  readonly name: string;
  send(message: BookingMessage): Promise<BookingMessageResult>;
}
