import type { BookingSettings, BookingSettingsInput, TemplateEvent } from '../api/schemas';
import { TEMPLATE_EVENTS } from '../api/schemas';
import {
  rulesFromWeek,
  weekFromRules,
  weekHasProblems,
  weekIsEmpty,
  type WeeklyHours,
} from './availability';
import { isValidZone, safeZone } from './zone';

/**
 * Pure logic of the Booking settings screen: the form's draft, the checks, and the conversion to what the API takes. The limits
 * are Reference's own (AppointmentController::saveSettings) so a value that passes here passes there. The screen only draws it.
 */

export const NUMBER_FIELDS = [
  'slotDurationMinutes',
  'maxPerDay',
  'bufferBeforeMinutes',
  'bufferAfterMinutes',
  'advanceDays',
  'reminderMinutesBefore',
] as const;
export type NumberField = (typeof NUMBER_FIELDS)[number];

export const LIMITS: Record<NumberField, { min: number; max: number }> = {
  slotDurationMinutes: { min: 5, max: 480 },
  maxPerDay: { min: 1, max: 96 },
  bufferBeforeMinutes: { min: 0, max: 240 },
  bufferAfterMinutes: { min: 0, max: 240 },
  advanceDays: { min: 1, max: 90 },
  reminderMinutesBefore: { min: 0, max: 1440 },
};

export const LOCATION_MAX = 191;
/** WhatsApp's own ceiling for a message body is 1024; leave room for the placeholders' expansion. */
export const TEMPLATE_MAX = 1000;

/** What a workspace starts with (Reference's defaults). */
export const DEFAULT_NUMBERS: Record<NumberField, number> = {
  slotDurationMinutes: 30,
  maxPerDay: 16,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  advanceDays: 14,
  reminderMinutesBefore: 60,
};

export const PLACEHOLDERS = ['{{type}}', '{{slot}}', '{{name}}', '{{manage_link}}'] as const;

/** The messages a customer gets, until the workspace writes its own. */
export const DEFAULT_TEMPLATES: Record<TemplateEvent, string> = {
  confirmation:
    'Hi {{name}}, your {{type}} is booked for {{slot}}. Manage it here: {{manage_link}}',
  reminder: 'Reminder: your {{type}} is on {{slot}}.',
  cancellation: 'Your appointment "{{type}}" on {{slot}} has been cancelled. Contact us to rebook.',
  reschedule: 'Your {{type}} has been moved to {{slot}}.',
};

/** Every field of the form as the person types it: numbers are strings so a half-typed value is not lost. */
export interface SettingsDraft {
  timezone: string;
  week: WeeklyHours;
  numbers: Record<NumberField, string>;
  defaultLocation: string;
  templates: Record<TemplateEvent, string>;
}

export type FieldKey =
  'timezone' | 'businessHours' | NumberField | 'defaultLocation' | `templates.${TemplateEvent}`;

export type ProblemCode =
  'required' | 'notInteger' | 'tooSmall' | 'tooLarge' | 'tooLong' | 'badZone' | 'badHours';

export interface Problem {
  code: ProblemCode;
  /** Values for the message (`min`, `max`). */
  params?: { min?: number; max?: number };
}

export type Problems = Partial<Record<FieldKey, Problem>>;

/** The form for a loaded settings record. `viewerZone` fills the time zone while the workspace has none. */
export function draftFromSettings(s: BookingSettings, viewerZone: string): SettingsDraft {
  return {
    timezone: safeZone(s.timezone, viewerZone),
    week: weekFromRules(s.businessHours),
    numbers: {
      slotDurationMinutes: String(s.slotDurationMinutes),
      maxPerDay: String(s.maxPerDay),
      bufferBeforeMinutes: String(s.bufferBeforeMinutes),
      bufferAfterMinutes: String(s.bufferAfterMinutes),
      advanceDays: String(s.advanceDays),
      reminderMinutesBefore: String(s.reminderMinutesBefore),
    },
    defaultLocation: s.defaultLocation,
    templates: { ...s.templates },
  };
}

/** A whole number, as typed. Null when it is empty or is not one ("12.5", "1e3", "abc"). */
export function parseWhole(text: string): number | null {
  const t = text.trim();
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

function checkNumber(field: NumberField, text: string): Problem | undefined {
  if (text.trim() === '') return { code: 'required' };
  const n = parseWhole(text);
  if (n === null) return { code: 'notInteger' };
  const { min, max } = LIMITS[field];
  if (n < min) return { code: 'tooSmall', params: { min, max } };
  if (n > max) return { code: 'tooLarge', params: { min, max } };
  return undefined;
}

/** What is wrong with the draft, by field. An empty result means it can be saved. */
export function validateDraft(d: SettingsDraft): Problems {
  const out: Problems = {};
  if (!isValidZone(d.timezone)) out.timezone = { code: 'badZone' };
  if (weekHasProblems(d.week)) out.businessHours = { code: 'badHours' };
  for (const f of NUMBER_FIELDS) {
    const p = checkNumber(f, d.numbers[f]);
    if (p) out[f] = p;
  }
  if ([...d.defaultLocation.trim()].length > LOCATION_MAX)
    out.defaultLocation = { code: 'tooLong', params: { max: LOCATION_MAX } };
  for (const e of TEMPLATE_EVENTS) {
    const body = d.templates[e].trim();
    if (body === '') out[`templates.${e}`] = { code: 'required' };
    else if ([...body].length > TEMPLATE_MAX)
      out[`templates.${e}`] = { code: 'tooLong', params: { max: TEMPLATE_MAX } };
  }
  return out;
}

/** The draft as the API takes it. Call it on a draft that passed `validateDraft`. */
export function toInput(d: SettingsDraft): BookingSettingsInput {
  const n = (f: NumberField) => parseWhole(d.numbers[f]) ?? DEFAULT_NUMBERS[f];
  return {
    timezone: d.timezone,
    slotDurationMinutes: n('slotDurationMinutes'),
    bufferBeforeMinutes: n('bufferBeforeMinutes'),
    bufferAfterMinutes: n('bufferAfterMinutes'),
    maxPerDay: n('maxPerDay'),
    advanceDays: n('advanceDays'),
    reminderMinutesBefore: n('reminderMinutesBefore'),
    defaultLocation: d.defaultLocation.trim(),
    businessHours: rulesFromWeek(d.week),
    templates: {
      confirmation: d.templates.confirmation.trim(),
      reminder: d.templates.reminder.trim(),
      cancellation: d.templates.cancellation.trim(),
      reschedule: d.templates.reschedule.trim(),
    },
  };
}

const fingerprint = (d: SettingsDraft): string =>
  JSON.stringify({
    ...toInput(d),
    // Unparsable numbers still count as edits.
    numbers: NUMBER_FIELDS.map((f) => d.numbers[f].trim()),
    // Rows without both times are not sent, but an added blank row is not an edit either.
    hours: rulesFromWeek(d.week),
  });

/** Has the person changed anything since `base`? Whitespace and unfinished hour rows do not count. */
export const isDirty = (base: SettingsDraft, now: SettingsDraft): boolean =>
  fingerprint(base) !== fingerprint(now);

/** True when no weekday has hours: nobody could book. A note, not an error (Reference allows it). */
export const hasNoHours = (d: SettingsDraft): boolean => weekIsEmpty(d.week);

/** `{{...}}` names a template uses that nothing fills in. A hint only: the text still saves. */
export function unknownPlaceholders(text: string): string[] {
  const known = new Set<string>(PLACEHOLDERS);
  const found = text.match(/\{\{[^{}]*\}\}/g) ?? [];
  return [...new Set(found.filter((p) => !known.has(p)))];
}

/** Is the text already the default for this event? Drives the "Reset to default" button. */
export const isDefaultTemplate = (event: TemplateEvent, text: string): boolean =>
  text.trim() === DEFAULT_TEMPLATES[event];

/** Server field paths ("slotDurationMinutes", "businessHours.2.from", "templates.reminder") to this form's keys. */
export function fieldKeyOf(path: string): FieldKey | null {
  const [root, second] = path.split('.');
  if (root === 'businessHours') return 'businessHours';
  if (root === 'templates' && second && (TEMPLATE_EVENTS as readonly string[]).includes(second))
    return `templates.${second as TemplateEvent}`;
  if (root === 'timezone' || root === 'defaultLocation') return root;
  return (NUMBER_FIELDS as readonly string[]).includes(root ?? '') ? (root as NumberField) : null;
}
