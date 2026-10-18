import type { BookingTemplateEvent } from '@crm/contracts';
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
  return {
    type: f.typeName,
    title: f.title,
    name: f.inviteeName ?? '',
    slot,
    date,
    time,
    location: f.location ?? '',
    join_link: f.joinUrl ?? '',
    manage_link: f.manageUrl ?? '',
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
