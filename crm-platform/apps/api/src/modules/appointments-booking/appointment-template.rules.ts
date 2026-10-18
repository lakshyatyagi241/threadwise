import {
  BOOKING_REMINDER_PLACEHOLDERS,
  type AppointmentMessageKind,
  type AppointmentTemplateChannel,
  type AppointmentTemplateStatus,
} from '@crm/contracts';
import { WA_VARIABLE_ORDER } from './appointment-reminder.rules';

/**
 * Pure rules of the appointment message library (BL-351, BL-352): the built-in set, which placeholders a WhatsApp message may use, how a
 * library text becomes a WhatsApp template body, and what status the library shows for a WhatsApp message.
 *
 * Wording: the texts are neutral on purpose ("your {{type}}", "booking"), so one set serves a clinic, a salon, an agency or a property
 * visit; the workspace's own words for the service come from the booking type's name. They are English only; the owner edits them.
 */

/** The placeholders a library text may use (the ones every booking message supports). */
export const LIBRARY_PLACEHOLDERS: readonly string[] = BOOKING_REMINDER_PLACEHOLDERS;
/** The placeholders a WhatsApp message may use, in the order the sender fills `{{1}}`, `{{2}}`... */
export const WHATSAPP_PLACEHOLDERS: readonly string[] = WA_VARIABLE_ORDER;

/** Example values Meta needs for every variable of a template it reviews. Generic on purpose. */
export const WA_EXAMPLES: Record<string, string> = {
  name: 'Asha',
  type: 'Consultation',
  date: 'Monday 15 January',
  time: '10:30 AM',
  location: '12 High Street, Main Branch',
  join_link: 'https://meet.example.com/abc-defg',
  manage_link: 'https://example.com/manage/abc',
};

export interface PredefinedTemplate {
  key: AppointmentMessageKind;
  kind: AppointmentMessageKind;
  channel: AppointmentTemplateChannel;
  language: string;
  name: string;
  subject: string | null;
  body: string;
  /** WhatsApp only: the category the template is submitted under. */
  metaCategory: 'UTILITY' | 'MARKETING' | null;
}

const email = (
  kind: AppointmentMessageKind,
  name: string,
  subject: string,
  body: string,
): PredefinedTemplate => ({
  key: kind,
  kind,
  channel: 'email',
  language: 'en',
  name,
  subject,
  body,
  metaCategory: null,
});

const whatsapp = (
  kind: AppointmentMessageKind,
  name: string,
  body: string,
  metaCategory: 'UTILITY' | 'MARKETING' = 'UTILITY',
): PredefinedTemplate => ({
  key: kind,
  kind,
  channel: 'whatsapp',
  language: 'en',
  name,
  subject: null,
  body,
  metaCategory,
});

/**
 * The built-in set: one message per kind per channel. WhatsApp bodies use only `name`, `type`, `date`, `time` in that order (the
 * order the sender fills), keep a word at both ends of the text (Meta refuses a variable at the start or the end) and are submitted as
 * UTILITY, except the after-visit follow-up, which Meta treats as marketing and the sender gates as marketing too.
 */
export const PREDEFINED_TEMPLATES: readonly PredefinedTemplate[] = [
  email(
    'confirmation',
    'Booking confirmation',
    'Your {{type}} is confirmed',
    'Hi {{name}},\n\nYour {{type}} is confirmed for {{date}} at {{time}}.\n\nWhere: {{location}}\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}\n\nWe look forward to seeing you.',
  ),
  email(
    'reminder',
    'Booking reminder',
    'Reminder: your {{type}} on {{date}}',
    'Hi {{name}},\n\nThis is a reminder about your {{type}} on {{date}} at {{time}}.\n\nWhere: {{location}}\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}\n\nSee you soon.',
  ),
  email(
    'reschedule',
    'Booking rescheduled',
    'Your {{type}} has moved to {{date}}',
    'Hi {{name}},\n\nYour {{type}} has been moved to {{date}} at {{time}}.\n\nWhere: {{location}}\n\nThis time does not suit you? Choose another here: {{manage_link}}',
  ),
  email(
    'cancellation',
    'Booking cancelled',
    'Your {{type}} on {{date}} was cancelled',
    'Hi {{name}},\n\nYour {{type}} on {{date}} at {{time}} has been cancelled.\n\nWould you like to book a new time? Just reply to this email and we will help.',
  ),
  email(
    'follow_up',
    'After-visit follow-up',
    'Thank you for your {{type}}',
    'Hi {{name}},\n\nThank you for your {{type}} on {{date}}. We hope it went well.\n\nIf you have any questions, or would like to book again, just reply to this email.',
  ),
  whatsapp(
    'confirmation',
    'Booking confirmation',
    'Hi {{name}}, your {{type}} is confirmed for {{date}} at {{time}}. We look forward to seeing you.',
  ),
  whatsapp(
    'reminder',
    'Booking reminder',
    'Hi {{name}}, this is a reminder about your {{type}} on {{date}} at {{time}}. Reply here if you need to change anything.',
  ),
  whatsapp(
    'reschedule',
    'Booking rescheduled',
    'Hi {{name}}, your {{type}} has been moved to {{date}} at {{time}}. Reply here if this time does not work for you.',
  ),
  whatsapp(
    'cancellation',
    'Booking cancelled',
    'Hi {{name}}, your {{type}} on {{date}} at {{time}} has been cancelled. Reply here any time to book a new time.',
  ),
  whatsapp(
    'follow_up',
    'After-visit follow-up',
    'Hi {{name}}, thank you for your {{type}} on {{date}}. We hope it went well. Reply here if you have any questions or would like to book again.',
    'MARKETING',
  ),
];

export function findPredefined(
  key: string,
  channel: AppointmentTemplateChannel,
  language: string,
): PredefinedTemplate | undefined {
  return PREDEFINED_TEMPLATES.find(
    (p) => p.key === key && p.channel === channel && p.language === language,
  );
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/** The placeholders of a text, lower case, in first-use order. */
export function variablesOf(...texts: Array<string | null | undefined>): string[] {
  const seen: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(PLACEHOLDER)) {
      const key = m[1]!.toLowerCase();
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

/** A placeholder in a library text that no booking message knows: it would be sent as typed. */
export function unknownPlaceholders(text: string): string[] {
  return variablesOf(text).filter((v) => !LIBRARY_PLACEHOLDERS.includes(v));
}

export type WhatsappBody =
  | {
      ok: true;
      /** The body with numbered placeholders (`{{1}}`...), as the template is stored and sent. */
      body: string;
      variableMap: { body: Array<{ num: number; key: string; example: string }> };
      variables: string[];
    }
  | { ok: false; problem: string };

/**
 * A library text as a WhatsApp template body. The sender fills `{{1}}`, `{{2}}`... from `name, type, date, time, location, join_link,
 * manage_link` in that order and only as many as the body has, so a WhatsApp text may use only a leading run of that list, first
 * written in that order. Anything else is refused here, where the owner can fix it, instead of failing when a customer is messaged.
 */
export function toWhatsappBody(text: string): WhatsappBody {
  const used = variablesOf(text);
  const order: readonly string[] = WA_VARIABLE_ORDER;
  const stray = used.filter((v) => !order.includes(v));
  if (stray.length > 0) {
    return {
      ok: false,
      problem: `WhatsApp can fill only ${order.join(', ')}. Remove ${stray.map((s) => `{{${s}}}`).join(', ')}.`,
    };
  }
  const expected = order.slice(0, used.length);
  if (used.some((v, i) => v !== expected[i])) {
    return {
      ok: false,
      problem: `A WhatsApp message must use its placeholders in this order, without skipping one: ${order.join(', ')}.`,
    };
  }
  const body = text.replace(PLACEHOLDER, (_w, key: string) => `{{${order.indexOf(key.toLowerCase()) + 1}}}`);
  return {
    ok: true,
    body,
    variables: used,
    variableMap: {
      body: used.map((key, i) => ({ num: i + 1, key, example: WA_EXAMPLES[key] ?? 'Example' })),
    },
  };
}

/** The library text of a stored WhatsApp body (`{{1}}`) written with names again, so the owner reads `{{name}}`, not `{{1}}`. */
export function namedBodyOf(waBody: string): string {
  const order: readonly string[] = WA_VARIABLE_ORDER;
  return waBody.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, n: string) => {
    const key = order[Number(n) - 1];
    return key ? `{{${key}}}` : whole;
  });
}

export interface WaRowFacts {
  status: string;
  metaStatus: string | null;
  pausedUntil: Date | null;
  rejectionReason: string | null;
}

/**
 * What the library shows for a WhatsApp message: read from the linked template every time, never copied, so it cannot say "approved"
 * after Meta paused or disabled the template. Anything that cannot send and is not waiting for review is shown as rejected, with a
 * reason.
 */
export function libraryStatusOfWa(
  row: WaRowFacts | null,
  now: Date = new Date(),
): { status: AppointmentTemplateStatus; reason: string | null } {
  if (!row) return { status: 'draft', reason: null };
  const status = row.status === 'public' ? 'approved' : row.status;
  if (status === 'draft') return { status: 'draft', reason: null };
  if (status === 'pending') return { status: 'pending', reason: null };
  if (status === 'approved') {
    if (row.metaStatus !== null && row.metaStatus !== 'APPROVED') {
      return { status: 'rejected', reason: row.rejectionReason ?? 'Meta no longer lists it as approved.' };
    }
    if (row.pausedUntil && row.pausedUntil.getTime() > now.getTime()) {
      return { status: 'rejected', reason: row.rejectionReason ?? 'Meta has paused this template.' };
    }
    return { status: 'approved', reason: null };
  }
  const fallback =
    status === 'paused'
      ? 'Meta has paused this template.'
      : status === 'disabled'
        ? 'Meta has disabled this template.'
        : status === 'deleted'
          ? 'This template no longer exists on Meta.'
          : 'Meta rejected this template.';
  return { status: 'rejected', reason: row.rejectionReason ?? fallback };
}

/** The Meta template name for an adopted message: stable, readable and unique per kind and language. */
export function waNameOf(kind: AppointmentMessageKind, language: string): string {
  return `appt_${kind}_${language.toLowerCase()}`;
}
