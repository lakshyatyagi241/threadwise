import { newId } from './availability';

/**
 * Reminder and follow-up rules of a booking type (BL-283), as the editor holds them. No React in here.
 *
 * A rule says WHEN (an amount and a unit, before the appointment starts or after it ends), on WHICH channels (an ordered preference: the
 * first channel that works is used), WHAT (its own text, or a WhatsApp template) and whether it is ON. A new rule is OFF: nothing is
 * sent until someone switches it on.
 */

export const REMINDER_KINDS = ['before', 'after'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const REMINDER_UNITS = ['minutes', 'hours', 'days'] as const;
export type ReminderUnit = (typeof REMINDER_UNITS)[number];

const UNIT_MINUTES: Record<ReminderUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** The API keeps an offset of up to 30 days. */
export const REMINDER_MAX_MINUTES = 43_200;
export const REMINDER_MAX_RULES = 8;
export const REMINDER_BODY_MAX = 2000;
export const REMINDER_SUBJECT_MAX = 191;
export const REMINDER_LABEL_MAX = 40;

/** What a run can say about why it did not go (the API's stable codes); each has a sentence under `appointments.reminders.reasons`. */
export const REMINDER_REASON_CODES = [
  'rule_removed',
  'rule_off',
  'rescheduled',
  'booking_cancelled',
  'booking_declined',
  'booking_no_show',
  'booking_not_confirmed',
  'started',
  'expired',
  'no_contact_point',
  'no_channel',
  'no_sender',
  'channel_disabled',
  'template_required',
  'template_unavailable',
  'quiet_hours_too_late',
  'no_consent',
  'opted_out',
  'do_not_call',
  'minor',
  'processing_restricted',
  'plan_limit',
  'quiet_hours',
  'channel_unavailable',
  'wallet_empty',
  'send_halted',
  'provider_error',
  'interrupted',
  'internal_error',
] as const;
export type ReminderReasonCode = (typeof REMINDER_REASON_CODES)[number];

/** A code from a newer server than this app knows says nothing rather than a broken key. */
export const knownReason = (reason: string | null): ReminderReasonCode | null =>
  (REMINDER_REASON_CODES as readonly string[]).includes(reason ?? '')
    ? (reason as ReminderReasonCode)
    : null;

/** The placeholders a reminder text may use; the same ones the booking messages use. */
export const REMINDER_PLACEHOLDERS = [
  'name',
  'type',
  'slot',
  'date',
  'time',
  'location',
  'join_link',
  'manage_link',
] as const;
export type ReminderPlaceholder = (typeof REMINDER_PLACEHOLDERS)[number];

export interface ReminderDraft {
  /** A key of this session (never sent). */
  id: string;
  /** The saved rule's id, sent back so its row (and the runs that point at it) is kept; absent on a rule added in this session. */
  serverId?: string;
  kind: ReminderKind;
  enabled: boolean;
  /** The amount, as typed. */
  offset: string;
  unit: ReminderUnit;
  label: string;
  /** In the order they are tried. */
  channels: ReminderChannel[];
  subject: string;
  body: string;
  /** The uuid of an approved WhatsApp template, or ''. */
  waTemplateId: string;
}

export const newReminder = (
  offset = '',
  label = '',
  kind: ReminderKind = 'before',
): ReminderDraft => ({
  id: newId(),
  kind,
  enabled: false,
  offset,
  unit: 'minutes',
  label,
  channels: [...REMINDER_CHANNELS],
  subject: '',
  body: '',
  waTemplateId: '',
});

/** Minutes of a typed amount and unit, or null when it is not a whole positive number. */
export function minutesOf(r: Pick<ReminderDraft, 'offset' | 'unit'>): number | null {
  const text = r.offset.trim();
  if (!/^\d{1,9}$/.test(text)) return null;
  return Number(text) * UNIT_MINUTES[r.unit];
}

/** An offset in minutes as the largest unit that holds it exactly: 1440 is 1 day, 90 is 90 minutes. */
export function splitMinutes(minutes: number): { offset: string; unit: ReminderUnit } {
  if (minutes >= 1440 && minutes % 1440 === 0)
    return { offset: String(minutes / 1440), unit: 'days' };
  if (minutes >= 60 && minutes % 60 === 0) return { offset: String(minutes / 60), unit: 'hours' };
  return { offset: String(minutes), unit: 'minutes' };
}

/** The same amount and unit, in the draft's fields. */
export function withMinutes(r: ReminderDraft, minutes: number): ReminderDraft {
  return { ...r, ...splitMinutes(minutes) };
}

/** `before:1440`: two rules are the same when they fire at the same moment relative to the same edge of the booking. */
export const ruleKey = (kind: ReminderKind, minutes: number): string => `${kind}:${minutes}`;

/** The moments already written, for the quick-add chips and the duplicate check (an empty or unreadable box is not one). */
export function reminderKeys(list: readonly ReminderDraft[]): Set<string> {
  const out = new Set<string>();
  for (const r of list) {
    const m = minutesOf(r);
    if (m !== null) out.add(ruleKey(r.kind, m));
  }
  return out;
}

/** Quick-add chips. */
export const QUICK_REMINDERS = [1440, 180, 60, 15] as const;
export const QUICK_FOLLOW_UPS = [120, 1440] as const;

/**
 * Adds a rule `minutes` before the start (or after the end). An empty row of the same kind is filled first; a moment that is already
 * there, or a full list, leaves the list as it was. A rule added here is OFF.
 */
export function addReminder(
  list: readonly ReminderDraft[],
  minutes: number,
  label = '',
  kind: ReminderKind = 'before',
): ReminderDraft[] {
  if (reminderKeys(list).has(ruleKey(kind, minutes))) return [...list];
  const blank = list.findIndex((r) => r.kind === kind && r.offset.trim() === '');
  if (blank >= 0) {
    return list.map((r, i) =>
      i === blank ? { ...withMinutes(r, minutes), label: r.label || label } : r,
    );
  }
  if (list.length >= REMINDER_MAX_RULES) return [...list];
  return [...list, { ...withMinutes(newReminder('', label, kind), minutes) }];
}

/** The same list with a channel moved by `delta` places in one rule's preference (a move off either end changes nothing). */
export function moveChannel(
  channels: readonly ReminderChannel[],
  index: number,
  delta: number,
): ReminderChannel[] {
  const to = index + delta;
  if (index < 0 || index >= channels.length || to < 0 || to >= channels.length)
    return [...channels];
  const next = [...channels];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  return next;
}

/** A channel switched on (added last in the preference) or off; at least one stays on. */
export function toggleChannel(
  channels: readonly ReminderChannel[],
  channel: ReminderChannel,
): ReminderChannel[] {
  if (channels.includes(channel)) {
    return channels.length <= 1 ? [...channels] : channels.filter((c) => c !== channel);
  }
  return [...channels, channel];
}

// ---- validation ---------------------------------------------------------------------------------------------------------------

export type ReminderProblem =
  | 'offsetInvalid'
  | 'duplicate'
  | 'channelsNone'
  | 'bodyTooLong'
  | 'subjectTooLong'
  | 'labelTooLong'
  | 'tooMany';

/**
 * Problems by key: `reminder:<id>` for a row, `reminders` for the list. A row with an empty amount is a row nobody filled in and is
 * left out (it is dropped when saved), as the editor always did.
 */
export function validateReminders(list: readonly ReminderDraft[]): Record<string, ReminderProblem> {
  const p: Record<string, ReminderProblem> = {};
  const seen = new Set<string>();
  for (const r of list) {
    if (r.offset.trim() === '') continue;
    const key = `reminder:${r.id}`;
    const m = minutesOf(r);
    if (m === null || m < 1 || m > REMINDER_MAX_MINUTES) p[key] = 'offsetInvalid';
    else if (seen.has(ruleKey(r.kind, m))) p[key] = 'duplicate';
    else if (r.channels.length === 0) p[key] = 'channelsNone';
    else if (r.body.length > REMINDER_BODY_MAX) p[key] = 'bodyTooLong';
    else if (r.subject.length > REMINDER_SUBJECT_MAX) p[key] = 'subjectTooLong';
    else if (r.label.length > REMINDER_LABEL_MAX) p[key] = 'labelTooLong';
    if (m !== null) seen.add(ruleKey(r.kind, m));
  }
  if (list.filter((r) => r.offset.trim() !== '').length > REMINDER_MAX_RULES)
    p.reminders = 'tooMany';
  return p;
}

/** What the API takes for the rules: furthest first within a kind, rows without an amount left out, as many as it keeps. */
export interface ReminderInput {
  id?: string;
  offsetMinutes: number;
  label: string | null;
  isActive: boolean;
  kind: ReminderKind;
  channels: ReminderChannel[];
  subject: string | null;
  body: string | null;
  waTemplateId: string | null;
}

const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export function remindersToInput(list: readonly ReminderDraft[]): ReminderInput[] {
  const out: ReminderInput[] = [];
  const used = new Set<string>();
  for (const r of list) {
    const m = minutesOf(r);
    if (m === null || m < 1 || used.has(ruleKey(r.kind, m)) || out.length >= REMINDER_MAX_RULES)
      continue;
    used.add(ruleKey(r.kind, m));
    out.push({
      ...(r.serverId ? { id: r.serverId } : {}),
      offsetMinutes: m,
      label: orNull(r.label),
      isActive: r.enabled,
      kind: r.kind,
      channels: r.channels.length > 0 ? [...r.channels] : [...REMINDER_CHANNELS],
      subject: orNull(r.subject),
      body: orNull(r.body),
      waTemplateId: orNull(r.waTemplateId),
    });
  }
  // before-rules first, furthest from the start first; then the follow-ups, soonest first
  return out.sort((a, b) =>
    a.kind === b.kind
      ? a.kind === 'before'
        ? b.offsetMinutes - a.offsetMinutes
        : a.offsetMinutes - b.offsetMinutes
      : a.kind === 'before'
        ? -1
        : 1,
  );
}

/** The rules of a saved type as drafts. */
export function remindersFromType(
  rules: ReadonlyArray<{
    id?: string | undefined;
    offsetMinutes: number;
    label: string | null;
    isActive: boolean;
    kind: ReminderKind;
    channels: ReminderChannel[];
    subject: string | null;
    body: string | null;
    waTemplateId: string | null;
  }>,
): ReminderDraft[] {
  return rules.map((r) => ({
    id: newId(),
    ...(r.id ? { serverId: r.id } : {}),
    kind: r.kind,
    enabled: r.isActive,
    ...splitMinutes(r.offsetMinutes),
    label: r.label ?? '',
    channels: r.channels.length > 0 ? [...r.channels] : [...REMINDER_CHANNELS],
    subject: r.subject ?? '',
    body: r.body ?? '',
    waTemplateId: r.waTemplateId ?? '',
  }));
}

/** Whether the saved rules and the drafts differ (an empty row is not a change). */
export function remindersChanged(
  saved: readonly ReminderDraft[],
  now: readonly ReminderDraft[],
): boolean {
  const a = JSON.stringify(remindersToInput(saved).map(({ id: _id, ...rest }) => rest));
  const b = JSON.stringify(remindersToInput(now).map(({ id: _id, ...rest }) => rest));
  return a !== b;
}

// ---- preview ------------------------------------------------------------------------------------------------------------------

/** The standard texts the API uses when a rule has none (they are what the contact would get). */
export const STANDARD_TEXT: Record<ReminderKind, string> = {
  before: 'Reminder: you have {{type}} coming up on {{slot}}. See you then!',
  after:
    'Thank you for {{type}} on {{slot}}. If you have any questions, just reply to this message.',
};

export interface PreviewSample {
  name: string;
  type: string;
  slot: string;
  date: string;
  time: string;
  location: string;
  join_link: string;
  manage_link: string;
}

/** Fills the placeholders with sample values the way the server does: a name it does not know stays as written. */
export function renderPreview(body: string, sample: PreviewSample): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => {
    const v = (sample as unknown as Record<string, string | undefined>)[key.toLowerCase()];
    return v === undefined ? whole : v;
  });
}

/** What the contact would read: the rule's own text, else the standard one. */
export function previewOf(r: Pick<ReminderDraft, 'kind' | 'body'>, sample: PreviewSample): string {
  return renderPreview(r.body.trim() === '' ? STANDARD_TEXT[r.kind] : r.body, sample);
}
