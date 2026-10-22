import type { AppointmentReminder } from '../api/schemas';

/**
 * What the appointment drawer says about one reminder beyond its status (BL-283, BL-426): the channels it tried in order, whether the step
 * went by a later channel than the first (the email fallback), what the provider reported and which buttons the customer tapped.
 * No React in here.
 */

export type ReminderAttempt = AppointmentReminder['attempts'][number];

/** The channels worth listing: more than one, or a single one that did not send (that is the answer to "why nothing?"). */
export function attemptsToShow(r: Pick<AppointmentReminder, 'attempts'>): ReminderAttempt[] {
  const a = r.attempts;
  if (a.length === 0) return [];
  if (a.length === 1 && a[0]!.status === 'sent') return [];
  return a;
}

/**
 * The channel a step fell back to: set when it was sent on a channel that was not the first one tried (the first was skipped, failed or
 * did not deliver in time). Null for a step that went by its first channel, and for a step that was not sent.
 */
export function fallbackChannel(
  r: Pick<AppointmentReminder, 'status' | 'attempts'>,
): ReminderAttempt['channel'] | null {
  if (r.status !== 'sent') return null;
  const sent = r.attempts.findIndex((a) => a.status === 'sent');
  return sent > 0 ? r.attempts[sent]!.channel : null;
}

/** The delivery line, or null while nothing is known (and for email, which has no delivery report). */
export function deliveryToShow(
  r: Pick<AppointmentReminder, 'status' | 'channel' | 'delivery'>,
): 'delivered' | 'failed' | 'undelivered' | null {
  if (r.status !== 'sent' || r.channel !== 'whatsapp') return null;
  return r.delivery === 'unknown' ? null : r.delivery;
}
