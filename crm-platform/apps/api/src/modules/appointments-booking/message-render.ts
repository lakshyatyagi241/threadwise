import type { BookingReminderStepKind, BookingTemplateEvent } from '@crm/contracts';
import { formatClock, formatDateLong, formatSlotLabel } from './tz';

/**
 * The text of a booking message (TW-APPT-013, 030, 031; D-14). Reference filled `{{type}}` and `{{slot}}` into the reminder body and
 * `{title}` / `{time}` / `{date}` into its legacy texts; both spellings work here, and the other three events get the same treatment.
 */

export interface MessageFacts {
  typeName: string;
  title: string;
  inviteeName: string | null;
  startsAtMs: number;
  /** The zone the times are written in (the booking type's). */
  timezone: string;
  location: string | null;
  manageUrl: string | null;
  /** The link that opens the visit when it is online (a Meet or Teams link), apart from `location`. */
  joinUrl?: string | null;
  /** The host (the agent): name and number, for the messages that give the customer someone to call. */
  hostName?: string | null;
  hostPhone?: string | null;
  /** A step's own word for the service (a medical practice: "appointment"), used instead of the booking type's name. */
  serviceLabel?: string | null;
}

export const DEFAULT_TEXTS: Record<BookingTemplateEvent, string> = {
  confirmation: 'Booked: {{type}} on {{slot}}.{{manage_hint}}',
  reminder: 'Reminder: you have {{type}} coming up on {{slot}}. See you then!',
  cancellation: 'Your booking "{{type}}" on {{slot}} has been cancelled. Contact us to rebook.',
  reschedule: 'Your booking "{{type}}" has moved to {{slot}}.{{manage_hint}}',
};

export function variablesFor(f: MessageFacts): Record<string, string> {
  const slot = formatSlotLabel(f.startsAtMs, f.timezone);
  const date = formatDateLong(f.startsAtMs, f.timezone);
  const time = formatClock(f.startsAtMs, f.timezone);
  const place = f.joinUrl ? null : (f.location ?? '').trim();
  return {
    type: f.serviceLabel && f.serviceLabel.trim() !== '' ? f.serviceLabel.trim() : f.typeName,
    title: f.title,
    name: f.inviteeName ?? '',
    slot,
    date,
    time,
    location: f.location ?? '',
    join_link: f.joinUrl ?? '',
    manage_link: f.manageUrl ?? '',
    host_name: f.hostName ?? '',
    host_phone: f.hostPhone ?? '',
    // A link that opens the place on a map; only for a visit at an address (an online visit has no place to show).
    map_link: place
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`
      : '',
    manage_hint: f.manageUrl ? `\n\nReschedule or cancel: ${f.manageUrl}` : '',
  };
}

/**
 * Replaces `{{name}}` (spaces inside the braces allowed) and the legacy `{name}` for `title`, `time` and `date`. A variable that does
 * not exist is left as written, so a typo is visible in the message and not silently blank.
 */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => {
      const v = vars[key.toLowerCase()];
      return v === undefined ? whole : v;
    })
    .replace(/\{(title|time|date)\}/g, (_w, key: string) => vars[key] ?? '');
}

/** The body to send: the type's plain body for the event when it has one, else the default text; manage link appended to a confirmation or reschedule that did not place it. */
export function messageBody(
  event: BookingTemplateEvent,
  plainBody: string | null | undefined,
  facts: MessageFacts,
): string {
  const vars = variablesFor(facts);
  const text = plainBody && plainBody.trim() !== '' ? plainBody : DEFAULT_TEXTS[event];
  let out = renderTemplate(text, vars);
  const wantsLink = event === 'confirmation' || event === 'reschedule';
  if (
    wantsLink &&
    plainBody &&
    facts.manageUrl &&
    !/\{\{\s*manage_(link|hint)\s*\}\}/i.test(plainBody)
  ) {
    out += vars.manage_hint;
  }
  return out;
}

/** The built-in text of the after-visit follow-up (BL-283) when a rule has none of its own. No niche noun: the type's name carries it. */
export const DEFAULT_FOLLOW_UP_TEXT =
  'Thank you for {{type}} on {{slot}}. If you have any questions, just reply to this message.';

/**
 * The text of a reminder or follow-up rule: its own body, else (for a reminder) the type's reminder message, else the built-in text.
 * The same placeholders as the other booking messages.
 */
export function reminderBody(
  kind: 'before' | 'after',
  ruleBody: string | null | undefined,
  typeReminderBody: string | null | undefined,
  facts: MessageFacts,
): string {
  const vars = variablesFor(facts);
  const own = ruleBody && ruleBody.trim() !== '' ? ruleBody : null;
  const inherited =
    kind === 'before' && typeReminderBody && typeReminderBody.trim() !== ''
      ? typeReminderBody
      : null;
  const text =
    own ?? inherited ?? (kind === 'before' ? DEFAULT_TEXTS.reminder : DEFAULT_FOLLOW_UP_TEXT);
  return renderTemplate(text, vars);
}

/**
 * The built-in text of each step of a reminder sequence, used when a step has no message of its own. Neutral on purpose: "your {{type}}"
 * carries the workspace's own noun, and nothing here says what the visit is for.
 */
export const DEFAULT_STEP_TEXT: Record<BookingReminderStepKind, string> = {
  confirmation: 'Booked: {{type}} on {{slot}}.{{manage_hint}}',
  reminder_24h: DEFAULT_TEXTS.reminder,
  reminder_2h: DEFAULT_TEXTS.reminder,
  reminder_15m: DEFAULT_TEXTS.reminder,
  reminder: DEFAULT_TEXTS.reminder,
  after_visit: DEFAULT_FOLLOW_UP_TEXT,
  no_show:
    'We missed you for {{type}} on {{slot}}. Reply to this message and we will help you find a new time.',
  rebook:
    'It has been a while since your {{type}}. Reply to this message when you would like to book again.',
};

/**
 * The text of one step: its own body, else (for a reminder) the type's reminder message, else the step's built-in text. The same
 * placeholders as the other booking messages.
 */
export function stepBody(
  step: BookingReminderStepKind,
  ruleBody: string | null | undefined,
  typeReminderBody: string | null | undefined,
  facts: MessageFacts,
): string {
  const own = ruleBody && ruleBody.trim() !== '' ? ruleBody : null;
  const isReminder =
    step === 'reminder' ||
    step === 'reminder_24h' ||
    step === 'reminder_2h' ||
    step === 'reminder_15m';
  const inherited =
    isReminder && typeReminderBody && typeReminderBody.trim() !== '' ? typeReminderBody : null;
  return renderTemplate(own ?? inherited ?? DEFAULT_STEP_TEXT[step], variablesFor(facts));
}
