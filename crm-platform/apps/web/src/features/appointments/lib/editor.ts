import { newId } from './availability';
import {
  STEPS,
  stepOfProblem,
  type BookingTypeDraft,
  type FormProblem,
  type ProblemMap,
  type QuestionDraft,
  type Step,
} from './booking-form';
import { parseMajor, parsePercent, priceBreakdown, type PriceBreakdown } from './money';

/**
 * Pure helpers of the booking type editor: what a step needs before the person may move on, which problem codes exist, the
 * reminder and question rows, the currency list, and the few text operations the screen performs. No React in here.
 */

// ---- steps ---------------------------------------------------------------------------------------------------------------

/**
 * What stops a person leaving a step by going forward. Reference blocks on exactly two things: a name on step 1 and a duration on
 * step 2. Every other problem is shown but only stops the final save.
 */
export const STEP_BLOCKERS: Readonly<Partial<Record<Step, readonly string[]>>> = {
  service: ['name'],
  timing: ['duration'],
};

/** The problem keys of `step` that stop a forward move. */
export function blockersOf(step: Step, problems: ProblemMap): string[] {
  return (STEP_BLOCKERS[step] ?? []).filter((k) => problems[k] !== undefined);
}

/**
 * The first step in `from .. to-1` (the steps being left on a move forward from `from` to `to`) that has a blocking problem,
 * with the field to focus; null when the move is allowed. A move backwards is always allowed.
 */
export function firstBlocker(
  from: Step,
  to: Step,
  problems: ProblemMap,
): { step: Step; key: string } | null {
  const a = STEPS.indexOf(from);
  const b = STEPS.indexOf(to);
  for (let i = a; i < b; i++) {
    const step = STEPS[i]!;
    const key = blockersOf(step, problems)[0];
    if (key) return { step, key };
  }
  return null;
}

/** The earliest step that holds one of the problem keys, with the first of its keys; null for no keys. */
export function firstStepOfKeys(keys: readonly string[]): { step: Step; key: string } | null {
  for (const step of STEPS) {
    const key = keys.find((k) => stepOfProblem(k) === step);
    if (key) return { step, key };
  }
  return null;
}

/** The steps that hold at least one problem (the stepper marks them). */
export function stepsWithProblems(problems: ProblemMap): Set<Step> {
  return new Set(Object.keys(problems).map(stepOfProblem));
}

// ---- problem codes ---------------------------------------------------------------------------------------------------------

const PROBLEM_TABLE: Record<FormProblem, true> = {
  nameRequired: true,
  nameTooLong: true,
  slugInvalid: true,
  durationInvalid: true,
  incrementInvalid: true,
  bufferInvalid: true,
  minNoticeInvalid: true,
  maxAdvanceInvalid: true,
  maxPerDayInvalid: true,
  capacityInvalid: true,
  timezoneInvalid: true,
  colorInvalid: true,
  feeInvalid: true,
  taxInvalid: true,
  depositInvalid: true,
  depositTooHigh: true,
  cancelFeeInvalid: true,
  cancelWindowInvalid: true,
  reminderInvalid: true,
  remindersDuplicate: true,
  remindersTooMany: true,
  reminderChannelsNone: true,
  reminderBodyTooLong: true,
  questionLabelRequired: true,
  questionsTooMany: true,
  questionOptionsRequired: true,
  hoursInvalid: true,
  overridesInvalid: true,
  descriptionTooLong: true,
  locationTooLong: true,
};

/** Every problem code `validateDraft` can produce (so a message exists for each one). */
export const PROBLEM_CODES = Object.keys(PROBLEM_TABLE) as FormProblem[];

/** The API's field paths as the draft's problem keys; a path with no mapping is not shown against a field. */
const SERVER_FIELDS: Readonly<Record<string, string>> = {
  name: 'name',
  slug: 'slug',
  description: 'description',
  locationValue: 'locationValue',
  color: 'color',
  durationMinutes: 'duration',
  incrementMinutes: 'increment',
  bufferBeforeMinutes: 'bufferBefore',
  bufferAfterMinutes: 'bufferAfter',
  minNoticeMinutes: 'minNotice',
  maxAdvanceDays: 'maxAdvance',
  maxPerDay: 'maxPerDay',
  capacity: 'capacity',
  timezone: 'timezone',
  'price.feeMinor': 'fee',
  'price.taxPct': 'taxPct',
  'price.depositValueMinor': 'deposit',
  'price.cancelFeeMinor': 'cancelFee',
  'price.noShowFeeMinor': 'noShowFee',
  'price.cancelWindowMinutes': 'cancelWindow',
};

/** Which draft problem key a server field path belongs to (`availability.2.from` is the hours, `questions.0.label` a question). */
export function serverFieldKey(path: string): string | null {
  const direct = SERVER_FIELDS[path];
  if (direct) return direct;
  if (path.startsWith('availability')) return 'hours';
  if (path.startsWith('overrides')) return 'overrides';
  if (path.startsWith('reminders')) return 'reminders';
  if (path.startsWith('questions')) return 'questions';
  return null;
}

/** The server's field errors as draft problem keys (the first message per key wins). */
export function serverProblems(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, message] of Object.entries(fields)) {
    const key = serverFieldKey(path);
    if (key && !(key in out)) out[key] = message;
  }
  return out;
}

// ---- currencies ------------------------------------------------------------------------------------------------------------

/** The currencies a booking type is offered in; the workspace's and the type's own are added when missing. */
export const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'AED',
  'SAR',
  'QAR',
  'KWD',
  'BHD',
  'OMR',
  'EGP',
  'JOD',
  'PKR',
  'BDT',
  'LKR',
  'NPR',
  'IDR',
  'MYR',
  'SGD',
  'THB',
  'PHP',
  'VND',
  'CNY',
  'JPY',
  'KRW',
  'HKD',
  'AUD',
  'NZD',
  'CAD',
  'MXN',
  'BRL',
  'ARS',
  'CLP',
  'COP',
  'ZAR',
  'NGN',
  'KES',
  'GHS',
  'TRY',
  'RUB',
  'UAH',
  'PLN',
  'CZK',
  'SEK',
  'NOK',
  'DKK',
  'CHF',
  'ILS',
] as const;

export function currencyChoices(current: string, workspace?: string | null): string[] {
  const set = new Set<string>(COMMON_CURRENCIES);
  if (workspace) set.add(workspace.toUpperCase());
  if (current.trim()) set.add(current.trim().toUpperCase());
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Fee, tax, total and what is due now for the form as it stands; an unreadable box counts as zero. */
export function draftPrice(d: BookingTypeDraft): PriceBreakdown {
  const cur = d.currency.toUpperCase();
  const fee = parseMajor(d.fee.trim() === '' ? '0' : d.fee, cur) ?? 0;
  const tax = d.taxPct.trim() === '' ? 0 : (parsePercent(d.taxPct) ?? 0);
  const dep =
    d.depositMode === 'partial'
      ? (parseMajor(d.deposit.trim() === '' ? '0' : d.deposit, cur) ?? 0)
      : 0;
  return priceBreakdown(fee, tax, d.depositMode, dep);
}

// ---- reminders and questions ------------------------------------------------------------------------------------------------

export { QUICK_FOLLOW_UPS, QUICK_REMINDERS, addReminder, newReminder } from './reminder-rules';

export const newQuestion = (): QuestionDraft => ({
  id: newId(),
  label: '',
  type: 'text',
  optionsText: '',
  required: true,
  map: '',
});

/** The same list with the item at `index` moved by `delta` places (a move off either end changes nothing). */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  return next;
}

// ---- messages --------------------------------------------------------------------------------------------------------------------

/** What a lifecycle message may contain; the server fills them in when it sends. */
export const PLACEHOLDERS = ['{{type}}', '{{slot}}', '{{name}}', '{{manage_link}}'] as const;

/**
 * `text` with `insert` put over the selection `[start, end)`. Returns the new text and where the caret goes, or null when the
 * result would be longer than `max`.
 */
export function insertAtRange(
  text: string,
  insert: string,
  start: number,
  end: number,
  max: number,
): { text: string; caret: number } | null {
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  const next = text.slice(0, a) + insert + text.slice(b);
  return next.length > max ? null : { text: next, caret: a + insert.length };
}

// ---- the form as a whole ----------------------------------------------------------------------------------------------------------

/** A comparable snapshot of the form: two equal snapshots mean nothing was changed. */
export const draftSignature = (d: BookingTypeDraft): string => JSON.stringify(d);

/** `https://app.example/book/<workspace>/<slug>`; `slug` empty shows a stand-in so the link reads as a link. */
export function publicLink(origin: string, orgSlug: string, slug: string): string {
  return `${origin}/book/${encodeURIComponent(orgSlug)}/${encodeURIComponent(slug.trim() || 'your-link')}`;
}
