import { BOOKING_TIMED_STEPS_MAX } from '@crm/contracts';
import {
  UNDELIVERED_MIN,
  minutesOf,
  newReminder,
  splitMinutes,
  stepKindOf,
  withMinutes,
  type ReminderDraft,
  type ReminderStepKind,
  type ReminderUnit,
  type WaTemplateStatus,
} from './reminder-rules';

/**
 * The timeline view of a booking type's reminder steps (BL-422). No React in here.
 *
 * The steps sit in three lanes in the order a contact lives through them: when the booking is made (the confirmation), before the visit
 * (the reminders) and after the visit (the follow-up, the no-show message, the rebook message). The lane is derived from a step's kind,
 * never stored, so the saved rules and the list editor are untouched.
 */

export const TIMELINE_LANES = ['booked', 'before', 'after'] as const;
export type TimelineLane = (typeof TIMELINE_LANES)[number];

/** Which lane a step is in. A step whose kind was edited in the list view still lands in the right place. */
export function laneOf(r: Pick<ReminderDraft, 'kind' | 'stepKind'>): TimelineLane {
  if (r.kind === 'event') return r.stepKind === 'no_show' ? 'after' : 'booked';
  return r.kind === 'before' ? 'before' : 'after';
}

/** The order of the after-visit lane: the follow-up, the no-show message (a branch), then the rebook message. */
const AFTER_RANK: Partial<Record<ReminderStepKind, number>> = { after_visit: 0, no_show: 1, rebook: 2 };

/** The steps of each lane, in the order they happen (the furthest reminder first). A row with no time yet comes last of its lane. */
export function groupTimeline(rules: readonly ReminderDraft[]): Record<TimelineLane, ReminderDraft[]> {
  const out: Record<TimelineLane, ReminderDraft[]> = { booked: [], before: [], after: [] };
  for (const r of rules) out[laneOf(r)].push(r);
  const minutes = (r: ReminderDraft, blank: number) => minutesOf(r) ?? blank;
  out.before.sort((a, b) => minutes(b, -1) - minutes(a, -1));
  out.after.sort((a, b) => {
    const ra = AFTER_RANK[stepKindOf(a)] ?? 0;
    const rb = AFTER_RANK[stepKindOf(b)] ?? 0;
    return ra !== rb ? ra - rb : minutes(a, Number.MAX_SAFE_INTEGER) - minutes(b, Number.MAX_SAFE_INTEGER);
  });
  return out;
}

// ---- the "Add step" menu -------------------------------------------------------------------------------------------------------

/** What the "Add step" menu offers. `custom` is a reminder at a time of the owner's choice. */
export const STEP_CHOICES = [
  'confirmation',
  'reminder_24h',
  'reminder_2h',
  'reminder_15m',
  'custom',
  'after_visit',
  'no_show',
  'rebook',
] as const;
export type StepChoice = (typeof STEP_CHOICES)[number];

/** Why an entry cannot be added: it is there already, or the five steps with a time are used. */
export type ChoiceState = 'available' | 'present' | 'cap';

/** The plan features that gate parts of a sequence (default on; the server is the authority). */
export interface SequencePlan {
  buttons: boolean;
  rebook: boolean;
}

const isTimed = (c: StepChoice): boolean => c !== 'confirmation' && c !== 'no_show';

/** Steps with a time that the list holds (an empty row does not count until it has a time, like the server's count). */
export const timedSteps = (rules: readonly ReminderDraft[]): number =>
  rules.filter((r) => r.kind !== 'event').length;

export function choiceState(rules: readonly ReminderDraft[], choice: StepChoice): ChoiceState {
  if (choice === 'confirmation') {
    return rules.some((r) => r.kind === 'event' && r.stepKind === 'confirmation') ? 'present' : 'available';
  }
  if (choice === 'no_show') {
    return rules.some((r) => r.kind === 'event' && r.stepKind === 'no_show') ? 'present' : 'available';
  }
  const present = (m: number, kind: 'before' | 'after') =>
    rules.some((r) => r.kind === kind && minutesOf(r) === m);
  if (choice === 'reminder_24h' && present(1440, 'before')) return 'present';
  if (choice === 'reminder_2h' && present(120, 'before')) return 'present';
  if (choice === 'reminder_15m' && present(15, 'before')) return 'present';
  if (choice === 'after_visit' && present(120, 'after')) return 'present';
  if (isTimed(choice) && timedSteps(rules) >= BOOKING_TIMED_STEPS_MAX) return 'cap';
  return 'available';
}

/** The rebook message waits this long by default. */
export const REBOOK_DEFAULT_DAYS = 30;

/** The row a menu entry adds. It starts OFF like every new rule; the caller trims its channels to the usable ones. */
export function buildStep(choice: StepChoice): ReminderDraft {
  const base = (kind: ReminderDraft['kind'], stepKind: ReminderStepKind) => {
    const r = newReminder('', '', kind);
    return { ...r, stepKind };
  };
  switch (choice) {
    case 'confirmation':
      return base('event', 'confirmation');
    case 'no_show':
      return base('event', 'no_show');
    case 'reminder_24h':
      return { ...withMinutes(base('before', 'reminder_24h'), 1440), buttonsEnabled: false };
    case 'reminder_2h':
      return { ...withMinutes(base('before', 'reminder_2h'), 120), skipIfConfirmed: true };
    case 'reminder_15m':
      return withMinutes(base('before', 'reminder_15m'), 15);
    case 'custom':
      return base('before', 'reminder');
    case 'after_visit':
      return withMinutes(base('after', 'after_visit'), 120);
    case 'rebook':
      return withMinutes(base('after', 'rebook'), REBOOK_DEFAULT_DAYS * 1440);
  }
}

/** The list with the step added, or unchanged when it cannot be added. */
export function addStep(rules: readonly ReminderDraft[], choice: StepChoice, step = buildStep(choice)): ReminderDraft[] {
  return choiceState(rules, choice) === 'available' ? [...rules, step] : [...rules];
}

// ---- one card -------------------------------------------------------------------------------------------------------------------

/** The amount and unit a step is shown with ("1 day", "15 minutes"); a row with no valid time says so with `null`. */
export function offsetParts(r: ReminderDraft): { count: number; unit: ReminderUnit } | null {
  const m = minutesOf(r);
  if (m === null || m < 1) return null;
  const { offset, unit } = splitMinutes(m);
  return { count: Number(offset), unit };
}

/** The messages a step may carry buttons or skip rules on: only the ones before the visit. */
export const hasReplyOptions = (r: Pick<ReminderDraft, 'kind'>): boolean => r.kind === 'before';

/** The wait before the next channel only matters when there is a next channel. */
export const hasFallbackWait = (r: Pick<ReminderDraft, 'channels'>): boolean => r.channels.length > 1;

export const DEFAULT_FALLBACK_MINUTES = 30;
export { UNDELIVERED_MIN };

/** The state of the WhatsApp message of a step, for its badge. `na`: the step does not use WhatsApp. */
export type WhatsappState = WaTemplateStatus | 'none' | 'na';

export function whatsappState(r: Pick<ReminderDraft, 'channels' | 'waTemplateId' | 'waTemplateStatus'>): WhatsappState {
  if (!r.channels.includes('whatsapp')) return 'na';
  if (r.waTemplateStatus) return r.waTemplateStatus;
  return r.waTemplateId.trim() === '' ? 'none' : 'approved';
}

/**
 * What happens to a contact the step cannot reach on WhatsApp yet: `email` (the next channel takes over), `window` (no other channel:
 * WhatsApp sends free text only inside the 24 hour window), or `ok` (the template is approved, nothing to say).
 */
export function fallbackNote(
  r: Pick<ReminderDraft, 'channels' | 'waTemplateId' | 'waTemplateStatus'>,
): 'ok' | 'email' | 'window' {
  const wa = whatsappState(r);
  if (wa === 'na' || wa === 'approved') return 'ok';
  return r.channels.includes('email') ? 'email' : 'window';
}
