import type {
  BookingType,
  BookingTypeInput,
  DepositMode,
  LocationType,
  PreviewDraft,
  QuestionType,
  TemplateEvent,
} from '../api/schemas';
import { TEMPLATE_EVENTS } from '../api/schemas';
import {
  defaultWeek,
  newId,
  overrideProblems,
  overridesFromWire,
  overridesToWire,
  rulesFromWeek,
  weekFromRules,
  weekHasProblems,
  weekIsEmpty,
  type Override,
  type WeeklyHours,
} from './availability';
import { minorToInput, parseMajor, parsePercent, priceBreakdown } from './money';
import { isValidZone } from './zone';

/**
 * The booking type editor's form: every box is a string until it is validated, because that is what a person is typing.
 * `typeToDraft` and `draftToInput` convert to and from the API's shape; `validateDraft` applies WaDesk's rules (the limits of
 * `BookingTypeController::upsert`) plus the few the editor adds. Pure, so it is tested without a browser.
 */

export const LIMITS = {
  nameMax: 191,
  slugMax: 64,
  descriptionMax: 2000,
  locationMax: 500,
  durationMin: 5,
  durationMax: 1440,
  incrementMin: 5,
  incrementMax: 1440,
  bufferMax: 1440,
  minNoticeMax: 525_600,
  maxAdvanceMin: 1,
  maxAdvanceMax: 365,
  maxPerDayMax: 500,
  capacityMax: 500,
  reminders: 8,
  reminderMax: 525_600,
  questions: 20,
  questionLabelMax: 191,
  optionMax: 20,
  introMax: 2000,
  templateMax: 1000,
  cancelWindowMax: 525_600,
} as const;

export const COLORS = [
  '#075E54',
  '#0F766E',
  '#2563EB',
  '#7C3AED',
  '#C2410C',
  '#BE185D',
  '#4D7C0F',
  '#64748B',
] as const;
export const DEFAULT_COLOR = COLORS[0];

export interface ReminderDraft {
  id: string;
  /** Minutes before the start, as typed. */
  offset: string;
  label: string;
}

export interface QuestionDraft {
  id: string;
  /** The saved question's id, sent back so its row is kept; absent on a question added in this session. */
  serverId?: string;
  label: string;
  type: QuestionType;
  /** One choice per line (select questions). */
  optionsText: string;
  required: boolean;
  /** WaDesk's "map to contact field" (email, name, mobile). */
  map: string;
}

export interface TemplateDraft {
  waTemplateId: string;
  plainBody: string;
}

export interface BookingTypeDraft {
  name: string;
  slug: string;
  description: string;
  locationType: LocationType;
  locationValue: string;
  color: string;
  duration: string;
  increment: string;
  bufferBefore: string;
  bufferAfter: string;
  minNotice: string;
  maxAdvance: string;
  maxPerDay: string;
  capacity: string;
  requiresApproval: boolean;
  timezone: string;
  introMessage: string;
  isActive: boolean;
  currency: string;
  /** The fee as a person writes it ("150", "150.50"). */
  fee: string;
  taxPct: string;
  depositMode: DepositMode;
  deposit: string;
  gatewaySlug: string;
  autoSendLink: boolean;
  cancelFee: string;
  noShowFee: string;
  cancelWindow: string;
  calendarId: string;
  createMeet: boolean;
  spreadsheetId: string;
  sheetRange: string;
  week: WeeklyHours;
  overrides: Override[];
  templates: Record<TemplateEvent, TemplateDraft>;
  reminders: ReminderDraft[];
  questions: QuestionDraft[];
}

const emptyTemplates = (): Record<TemplateEvent, TemplateDraft> => ({
  confirmation: { waTemplateId: '', plainBody: '' },
  reminder: { waTemplateId: '', plainBody: '' },
  cancellation: { waTemplateId: '', plainBody: '' },
  reschedule: { waTemplateId: '', plainBody: '' },
});

/** A new type: WaDesk's form defaults (30 minutes, 4 hours' notice, 30 days ahead) and Monday to Friday 09:00 to 18:00. */
export function newDraft(defaults: {
  timezone: string;
  currency: string;
  location?: string;
}): BookingTypeDraft {
  return {
    name: '',
    slug: '',
    description: '',
    locationType: 'address',
    locationValue: defaults.location ?? '',
    color: DEFAULT_COLOR,
    duration: '30',
    increment: '30',
    bufferBefore: '0',
    bufferAfter: '0',
    minNotice: '240',
    maxAdvance: '30',
    maxPerDay: '',
    capacity: '1',
    requiresApproval: false,
    timezone: defaults.timezone,
    introMessage: '',
    isActive: true,
    currency: defaults.currency,
    fee: '0',
    taxPct: '0',
    depositMode: 'none',
    deposit: '0',
    gatewaySlug: '',
    autoSendLink: true,
    cancelFee: '0',
    noShowFee: '0',
    cancelWindow: '1440',
    calendarId: '',
    createMeet: false,
    spreadsheetId: '',
    sheetRange: 'Sheet1!A1',
    week: defaultWeek(),
    overrides: [],
    templates: emptyTemplates(),
    reminders: [],
    questions: [],
  };
}

export function typeToDraft(t: BookingType): BookingTypeDraft {
  const cur = t.price.currency;
  const templates = emptyTemplates();
  for (const tpl of t.templates) {
    templates[tpl.event] = { waTemplateId: tpl.waTemplateId ?? '', plainBody: tpl.plainBody ?? '' };
  }
  return {
    name: t.name,
    slug: t.slug,
    description: t.description ?? '',
    locationType: t.locationType,
    locationValue: t.locationValue ?? '',
    color: t.color ?? DEFAULT_COLOR,
    duration: String(t.durationMinutes),
    increment: String(t.incrementMinutes),
    bufferBefore: String(t.bufferBeforeMinutes),
    bufferAfter: String(t.bufferAfterMinutes),
    minNotice: String(t.minNoticeMinutes),
    maxAdvance: String(t.maxAdvanceDays),
    maxPerDay: t.maxPerDay === null ? '' : String(t.maxPerDay),
    capacity: String(t.capacity),
    requiresApproval: t.requiresApproval,
    timezone: t.timezone ?? '',
    introMessage: t.introMessage ?? '',
    isActive: t.isActive,
    currency: cur,
    fee: minorToInput(t.price.feeMinor, cur),
    taxPct: String(t.price.taxPct),
    depositMode: t.price.depositMode,
    deposit: minorToInput(t.price.depositValueMinor, cur),
    gatewaySlug: t.price.gatewaySlug ?? '',
    autoSendLink: t.price.autoSendLink,
    cancelFee: minorToInput(t.price.cancelFeeMinor, cur),
    noShowFee: minorToInput(t.price.noShowFeeMinor, cur),
    cancelWindow: String(t.price.cancelWindowMinutes),
    calendarId: t.integration.calendarId ?? '',
    createMeet: t.integration.createMeet,
    spreadsheetId: t.integration.spreadsheetId ?? '',
    sheetRange: t.integration.sheetRange ?? 'Sheet1!A1',
    week: weekFromRules(t.availability),
    overrides: overridesFromWire(t.overrides),
    templates,
    reminders: t.reminders.map((r) => ({
      id: newId(),
      offset: String(r.offsetMinutes),
      label: r.label ?? '',
    })),
    questions: t.questions.map((q) => ({
      id: newId(),
      ...(q.id ? { serverId: q.id } : {}),
      label: q.label,
      type: q.type,
      optionsText: q.options.join('\n'),
      required: q.required,
      map: q.mapToContactField ?? '',
    })),
  };
}

export type FormProblem =
  | 'nameRequired'
  | 'nameTooLong'
  | 'slugInvalid'
  | 'durationInvalid'
  | 'incrementInvalid'
  | 'bufferInvalid'
  | 'minNoticeInvalid'
  | 'maxAdvanceInvalid'
  | 'maxPerDayInvalid'
  | 'capacityInvalid'
  | 'timezoneInvalid'
  | 'colorInvalid'
  | 'feeInvalid'
  | 'taxInvalid'
  | 'depositInvalid'
  | 'depositTooHigh'
  | 'cancelFeeInvalid'
  | 'cancelWindowInvalid'
  | 'reminderInvalid'
  | 'remindersDuplicate'
  | 'remindersTooMany'
  | 'questionLabelRequired'
  | 'questionsTooMany'
  | 'questionOptionsRequired'
  | 'hoursInvalid'
  | 'overridesInvalid'
  | 'descriptionTooLong'
  | 'locationTooLong';

export type ProblemMap = Partial<Record<string, FormProblem>>;

/** The wizard step each field belongs to, so a failed save can jump to the first step with a problem. */
export const STEPS = ['service', 'timing', 'availability', 'pricing', 'messaging'] as const;
export type Step = (typeof STEPS)[number];

const int = (text: string): number | null =>
  /^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Field keys with a problem, each with its code. Keys: the draft's field names, `reminder:<id>`, `question:<id>`, `hours`. */
export function validateDraft(d: BookingTypeDraft): ProblemMap {
  const p: ProblemMap = {};
  const name = d.name.trim();
  if (!name) p.name = 'nameRequired';
  else if (name.length > LIMITS.nameMax) p.name = 'nameTooLong';
  if (d.slug.trim() && (!SLUG.test(d.slug.trim()) || d.slug.trim().length > LIMITS.slugMax))
    p.slug = 'slugInvalid';
  if (d.description.length > LIMITS.descriptionMax) p.description = 'descriptionTooLong';
  if (d.locationValue.length > LIMITS.locationMax) p.locationValue = 'locationTooLong';
  if (!HEX.test(d.color)) p.color = 'colorInvalid';

  const duration = int(d.duration);
  if (duration === null || duration < LIMITS.durationMin || duration > LIMITS.durationMax)
    p.duration = 'durationInvalid';
  const increment = d.increment.trim() === '' ? duration : int(d.increment);
  if (increment === null || increment < LIMITS.incrementMin || increment > LIMITS.incrementMax)
    p.increment = 'incrementInvalid';
  for (const k of ['bufferBefore', 'bufferAfter'] as const) {
    const v = d[k].trim() === '' ? 0 : int(d[k]);
    if (v === null || v > LIMITS.bufferMax) p[k] = 'bufferInvalid';
  }
  const notice = d.minNotice.trim() === '' ? 0 : int(d.minNotice);
  if (notice === null || notice > LIMITS.minNoticeMax) p.minNotice = 'minNoticeInvalid';
  const advance = d.maxAdvance.trim() === '' ? 30 : int(d.maxAdvance);
  if (advance === null || advance < LIMITS.maxAdvanceMin || advance > LIMITS.maxAdvanceMax)
    p.maxAdvance = 'maxAdvanceInvalid';
  if (d.maxPerDay.trim() !== '') {
    const v = int(d.maxPerDay);
    if (v === null || v < 1 || v > LIMITS.maxPerDayMax) p.maxPerDay = 'maxPerDayInvalid';
  }
  const capacity = d.capacity.trim() === '' ? 1 : int(d.capacity);
  if (capacity === null || capacity < 1 || capacity > LIMITS.capacityMax)
    p.capacity = 'capacityInvalid';
  if (!isValidZone(d.timezone)) p.timezone = 'timezoneInvalid';

  // price
  const fee = parseMajor(d.fee.trim() === '' ? '0' : d.fee, d.currency);
  if (fee === null) p.fee = 'feeInvalid';
  const tax = d.taxPct.trim() === '' ? 0 : parsePercent(d.taxPct);
  if (tax === null) p.taxPct = 'taxInvalid';
  if (d.depositMode === 'partial') {
    const dep = parseMajor(d.deposit.trim() === '' ? '0' : d.deposit, d.currency);
    if (dep === null || dep <= 0) p.deposit = 'depositInvalid';
    else if (fee !== null && tax !== null && dep > priceBreakdown(fee, tax, 'none', 0).totalMinor)
      p.deposit = 'depositTooHigh';
  }
  for (const k of ['cancelFee', 'noShowFee'] as const) {
    if (parseMajor(d[k].trim() === '' ? '0' : d[k], d.currency) === null) p[k] = 'cancelFeeInvalid';
  }
  const win = d.cancelWindow.trim() === '' ? 0 : int(d.cancelWindow);
  if (win === null || win > LIMITS.cancelWindowMax) p.cancelWindow = 'cancelWindowInvalid';

  // reminders: WaDesk keeps up to 8 distinct, positive offsets and drops the rest
  const seen = new Set<number>();
  for (const r of d.reminders) {
    if (r.offset.trim() === '') continue;
    const v = int(r.offset);
    if (v === null || v < 1 || v > LIMITS.reminderMax) p[`reminder:${r.id}`] = 'reminderInvalid';
    else if (seen.has(v)) p[`reminder:${r.id}`] = 'remindersDuplicate';
    else seen.add(v);
  }
  if (d.reminders.filter((r) => r.offset.trim() !== '').length > LIMITS.reminders)
    p.reminders = 'remindersTooMany';

  // questions
  if (d.questions.length > LIMITS.questions) p.questions = 'questionsTooMany';
  for (const q of d.questions) {
    if (q.label.trim() === '' && (q.optionsText.trim() !== '' || q.map.trim() !== ''))
      p[`question:${q.id}`] = 'questionLabelRequired';
    else if (q.label.trim().length > LIMITS.questionLabelMax)
      p[`question:${q.id}`] = 'questionLabelRequired';
    else if (q.type === 'select' && q.label.trim() !== '' && optionsOf(q).length === 0)
      p[`question:${q.id}`] = 'questionOptionsRequired';
  }

  // availability
  if (weekHasProblems(d.week)) p.hours = 'hoursInvalid';
  if (overrideProblems(d.overrides).size > 0) p.overrides = 'overridesInvalid';
  return p;
}

/** Which step a problem key sits on. */
export function stepOfProblem(key: string): Step {
  if (['name', 'slug', 'description', 'locationType', 'locationValue', 'color'].includes(key))
    return 'service';
  if (
    [
      'duration',
      'increment',
      'bufferBefore',
      'bufferAfter',
      'minNotice',
      'maxAdvance',
      'maxPerDay',
      'capacity',
      'timezone',
    ].includes(key)
  )
    return 'timing';
  if (key === 'hours' || key === 'overrides') return 'availability';
  if (['fee', 'taxPct', 'deposit', 'cancelFee', 'noShowFee', 'cancelWindow'].includes(key))
    return 'pricing';
  return 'messaging';
}

export function firstProblemStep(problems: ProblemMap): Step | null {
  const keys = Object.keys(problems);
  if (keys.length === 0) return null;
  return STEPS.find((s) => keys.some((k) => stepOfProblem(k) === s)) ?? 'service';
}

export function optionsOf(q: Pick<QuestionDraft, 'optionsText'>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of q.optionsText.split('\n')) {
    const v = line.trim().slice(0, 120);
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
    if (out.length >= LIMITS.optionMax) break;
  }
  return out;
}

const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** The body of a create or update. Call only after `validateDraft` found nothing. */
export function draftToInput(d: BookingTypeDraft): BookingTypeInput {
  const cur = d.currency.toUpperCase();
  const duration = Number(d.duration);
  const reminders: Array<{ offsetMinutes: number; label: string | null }> = [];
  const used = new Set<number>();
  for (const r of d.reminders) {
    const v = Number(r.offset);
    if (
      r.offset.trim() === '' ||
      !Number.isInteger(v) ||
      v < 1 ||
      used.has(v) ||
      reminders.length >= LIMITS.reminders
    )
      continue;
    used.add(v);
    reminders.push({ offsetMinutes: v, label: orNull(r.label) });
  }
  // furthest first, as WaDesk lists them
  reminders.sort((a, b) => b.offsetMinutes - a.offsetMinutes);

  return {
    name: d.name.trim(),
    slug: d.slug.trim(),
    description: orNull(d.description),
    locationType: d.locationType,
    locationValue: orNull(d.locationValue),
    color: d.color.toUpperCase(),
    durationMinutes: duration,
    incrementMinutes: d.increment.trim() === '' ? duration : Number(d.increment),
    bufferBeforeMinutes: d.bufferBefore.trim() === '' ? 0 : Number(d.bufferBefore),
    bufferAfterMinutes: d.bufferAfter.trim() === '' ? 0 : Number(d.bufferAfter),
    minNoticeMinutes: d.minNotice.trim() === '' ? 0 : Number(d.minNotice),
    maxAdvanceDays: d.maxAdvance.trim() === '' ? 30 : Number(d.maxAdvance),
    maxPerDay: d.maxPerDay.trim() === '' ? null : Number(d.maxPerDay),
    capacity: d.capacity.trim() === '' ? 1 : Number(d.capacity),
    requiresApproval: d.requiresApproval,
    timezone: orNull(d.timezone),
    introMessage: orNull(d.introMessage),
    isActive: d.isActive,
    price: {
      currency: cur,
      feeMinor: parseMajor(d.fee.trim() === '' ? '0' : d.fee, cur) ?? 0,
      taxPct: d.taxPct.trim() === '' ? 0 : (parsePercent(d.taxPct) ?? 0),
      depositMode: d.depositMode,
      depositValueMinor: d.depositMode === 'partial' ? (parseMajor(d.deposit, cur) ?? 0) : 0,
      gatewaySlug: orNull(d.gatewaySlug),
      autoSendLink: d.autoSendLink,
      cancelFeeMinor: parseMajor(d.cancelFee.trim() === '' ? '0' : d.cancelFee, cur) ?? 0,
      noShowFeeMinor: parseMajor(d.noShowFee.trim() === '' ? '0' : d.noShowFee, cur) ?? 0,
      cancelWindowMinutes: d.cancelWindow.trim() === '' ? 0 : Number(d.cancelWindow),
    },
    integration: {
      calendarId: orNull(d.calendarId),
      createMeet: d.createMeet || d.locationType === 'virtual',
      spreadsheetId: orNull(d.spreadsheetId),
      sheetRange: orNull(d.sheetRange),
    },
    availability: rulesFromWeek(d.week),
    overrides: overridesToWire(d.overrides),
    templates: TEMPLATE_EVENTS.flatMap((event) => {
      const t = d.templates[event];
      return t.waTemplateId.trim() === '' && t.plainBody.trim() === ''
        ? []
        : [{ event, waTemplateId: orNull(t.waTemplateId), plainBody: orNull(t.plainBody) }];
    }),
    reminders,
    // WaDesk leaves out a question without a label
    questions: d.questions
      .filter((q) => q.label.trim() !== '')
      .map((q) => ({
        ...(q.serverId ? { id: q.serverId } : {}),
        label: q.label.trim(),
        type: q.type,
        options: q.type === 'select' ? optionsOf(q) : [],
        required: q.required,
        mapToContactField: orNull(q.map),
      })),
  };
}

/** The slice of the draft the preview endpoint reads. */
export function previewDraft(d: BookingTypeDraft): PreviewDraft {
  const duration = Number(d.duration) || 30;
  return {
    timezone: d.timezone,
    durationMinutes: duration,
    incrementMinutes: Number(d.increment) || duration,
    bufferBeforeMinutes: Number(d.bufferBefore) || 0,
    bufferAfterMinutes: Number(d.bufferAfter) || 0,
    minNoticeMinutes: Number(d.minNotice) || 0,
    maxAdvanceDays: Number(d.maxAdvance) || 30,
    maxPerDay: d.maxPerDay.trim() === '' ? null : Number(d.maxPerDay) || null,
    capacity: Number(d.capacity) || 1,
    availability: rulesFromWeek(d.week),
    overrides: overridesToWire(d.overrides),
  };
}

/** Does the preview have anything to ask about? (Nothing is bookable without hours, a valid zone and a valid duration.) */
export function canPreview(d: BookingTypeDraft): boolean {
  const duration = int(d.duration);
  return (
    isValidZone(d.timezone) &&
    duration !== null &&
    duration >= LIMITS.durationMin &&
    !weekIsEmpty(d.week) &&
    !weekHasProblems(d.week)
  );
}

/** Lowercase kebab-case from a name, for the public link ("30-min Demo" becomes "30-min-demo"). */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slugMax)
    .replace(/-+$/g, '');
}
