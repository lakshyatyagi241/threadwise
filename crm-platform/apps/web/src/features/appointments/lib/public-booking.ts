import type {
  Answer,
  BookingQuestion,
  PublicBooking,
  PublicBookInput,
  PublicType,
} from '../api/schemas';
import { formatDayLong, formatTime, formatTimeRange, zoneName } from './format';
import type { IcsEvent } from './ics';
import { formatMoney, priceBreakdown } from './money';
import { isOpen, visitorCan } from './status';
import { parseDayKey, zoneOffsetMinutes } from './zone';

/**
 * The logic of the visitor's pages, kept out of the components so it can be tested: what a visitor must fill in and how it is
 * checked, the request that is sent, how a time reads in the visitor's zone and the service's, the price lines, where the
 * appointment takes place, and which of Reschedule and Cancel a booking still offers.
 */

// ---- the form ------------------------------------------------------------------------------------------------------

export type FieldProblem = 'required' | 'invalid' | 'tooLong';
export type DetailField = 'name' | 'email' | 'phone';

export interface Details {
  name: string;
  email: string;
  phone: string;
}

export const EMPTY_DETAILS: Details = { name: '', email: '', phone: '' };

/** Limits that match the server's (WaDesk caps a customer name at 191 and a phone at 32). */
export const LIMITS = { name: 191, email: 191, phone: 32, text: 500, textarea: 2000 } as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const isEmail = (value: string): boolean =>
  value.length <= LIMITS.email && EMAIL.test(value.trim());

/** A phone number a person might type: digits with an optional leading plus, spaces, dashes, dots and brackets; 6 to 15 digits. */
export function isPhone(value: string): boolean {
  const v = value.trim();
  if (v.length > LIMITS.phone || !/^\+?[0-9 ()\-.]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, '').length;
  return digits >= 6 && digits <= 15;
}

/** `YYYY-MM-DD` that is a real calendar day. */
export const isDay = (value: string): boolean => parseDayKey(value.trim()) !== null;

/** A number as a person writes it: an optional minus, digits, an optional decimal part. */
export const isNumberText = (value: string): boolean =>
  /^-?\d{1,15}(\.\d{1,10})?$/.test(value.trim());

/**
 * A question that asks for something the form already has (WaDesk maps an answer to a contact field: "name", "email",
 * "mobile"). The visitor is never asked twice: the answer is taken from the field above.
 */
export function coveredField(q: Pick<BookingQuestion, 'mapToContactField'>): DetailField | null {
  const map = (q.mapToContactField ?? '').trim().toLowerCase();
  if (map === 'name') return 'name';
  if (map === 'email') return 'email';
  if (map === 'mobile' || map === 'phone') return 'phone';
  return null;
}

export interface AskedQuestion {
  question: BookingQuestion;
  /** The index in the type's own list: the key of its answer and of a server error on it. */
  index: number;
}

/** The questions the visitor answers on the page (the ones the details already cover are left out). */
export function askedQuestions(questions: readonly BookingQuestion[]): AskedQuestion[] {
  const out: AskedQuestion[] = [];
  questions.forEach((question, index) => {
    if (coveredField(question) === null) out.push({ question, index });
  });
  return out;
}

/** Whether a question that is covered by a detail makes that detail required (a required "mobile" question needs a phone). */
const requiredByQuestion = (questions: readonly BookingQuestion[], field: DetailField): boolean =>
  questions.some((q) => q.required && coveredField(q) === field);

/** A required question that maps to the phone makes the phone field required. */
export const phoneRequired = (questions: readonly BookingQuestion[]): boolean =>
  requiredByQuestion(questions, 'phone');

export function validateDetails(
  details: Details,
  questions: readonly BookingQuestion[] = [],
): Partial<Record<DetailField, FieldProblem>> {
  const out: Partial<Record<DetailField, FieldProblem>> = {};
  const name = details.name.trim();
  if (!name) out.name = 'required';
  else if (name.length > LIMITS.name) out.name = 'tooLong';
  const email = details.email.trim();
  if (!email) out.email = 'required';
  else if (!isEmail(email)) out.email = 'invalid';
  const phone = details.phone.trim();
  if (!phone) {
    if (requiredByQuestion(questions, 'phone')) out.phone = 'required';
  } else if (!isPhone(phone)) out.phone = 'invalid';
  return out;
}

/** One answer against its question: `required` when empty and needed, `invalid` when it is not what the type asks for. */
export function validateAnswer(q: BookingQuestion, raw: string): FieldProblem | null {
  const value = raw.trim();
  if (!value) return q.required ? 'required' : null;
  switch (q.type) {
    case 'text':
      return value.length > LIMITS.text ? 'tooLong' : null;
    case 'textarea':
      return value.length > LIMITS.textarea ? 'tooLong' : null;
    case 'select':
      return q.options.includes(value) ? null : 'invalid';
    case 'number':
      return isNumberText(value) ? null : 'invalid';
    case 'email':
      return isEmail(value) ? null : 'invalid';
    case 'phone':
      return isPhone(value) ? null : 'invalid';
    case 'date':
      return isDay(value) ? null : 'invalid';
  }
}

/** Problems by question index, for the questions asked on the page. */
export function validateAnswers(
  questions: readonly BookingQuestion[],
  values: Readonly<Record<number, string>>,
): Record<number, FieldProblem> {
  const out: Record<number, FieldProblem> = {};
  for (const { question, index } of askedQuestions(questions)) {
    const problem = validateAnswer(question, values[index] ?? '');
    if (problem) out[index] = problem;
  }
  return out;
}

export interface BuiltBooking {
  input: PublicBookInput;
  /** For answer `i` of `input.answers`, the question index it came from (to place a server error on the right field). */
  sources: number[];
}

/** The request body. Empty answers are left out; a covered question is answered from the detail it maps to. */
export function buildBookInput(args: {
  startsAt: string;
  zone: string;
  details: Details;
  questions: readonly BookingQuestion[];
  values: Readonly<Record<number, string>>;
}): BuiltBooking {
  const { details } = args;
  const answers: Answer[] = [];
  const sources: number[] = [];
  args.questions.forEach((q, index) => {
    const field = coveredField(q);
    const value = (field ? details[field] : (args.values[index] ?? '')).trim();
    if (!value) return;
    answers.push({ label: q.label, answer: value, ...(q.id ? { questionId: q.id } : {}) });
    sources.push(index);
  });
  const phone = details.phone.trim();
  return {
    input: {
      startsAt: args.startsAt,
      name: details.name.trim(),
      email: details.email.trim(),
      ...(phone ? { phone } : {}),
      inviteeTimezone: args.zone,
      answers,
    },
    sources,
  };
}

export interface ServerProblems {
  details: Partial<Record<DetailField, true>>;
  answers: Record<number, true>;
  /** The time itself was refused. */
  startsAt: boolean;
  /** Some path that is not on the page: only a general message can be shown. */
  other: boolean;
}

const ANSWER_PATH = /^answers(?:[.[/](\d+)\]?)?/;

/** Places the server's `fieldErrors` (path to message) on the fields of the page. */
export function placeServerErrors(
  fieldErrors: Readonly<Record<string, string>>,
  built: Pick<BuiltBooking, 'sources'>,
  questions: readonly BookingQuestion[],
): ServerProblems {
  const out: ServerProblems = { details: {}, answers: {}, startsAt: false, other: false };
  for (const path of Object.keys(fieldErrors)) {
    if (path === 'name' || path === 'email' || path === 'phone') {
      out.details[path] = true;
      continue;
    }
    if (path === 'startsAt') {
      out.startsAt = true;
      continue;
    }
    const m = ANSWER_PATH.exec(path);
    const at = m?.[1] !== undefined ? built.sources[Number(m[1])] : undefined;
    const q = at !== undefined ? questions[at] : undefined;
    if (q && at !== undefined) {
      const covered = coveredField(q);
      if (covered) out.details[covered] = true;
      else out.answers[at] = true;
      continue;
    }
    out.other = true;
  }
  return out;
}

// ---- when and where ------------------------------------------------------------------------------------------------

export interface WhenPart {
  /** "Monday, 5 October 2026". */
  day: string;
  /** "9:30 AM". */
  time: string;
  /** "9:30 AM – 10:00 AM". */
  range: string;
  /** "Asia/Kolkata". */
  zone: string;
  /** "GMT+5:30". */
  zoneName: string;
}

export function whenIn(startsAt: string, endsAt: string, zone: string, locale: string): WhenPart {
  return {
    day: formatDayLong(startsAt, locale, zone),
    time: formatTime(startsAt, locale, zone),
    range: formatTimeRange(startsAt, endsAt, locale, zone),
    zone: zone.replaceAll('_', ' '),
    zoneName: zoneName(startsAt, locale, zone),
  };
}

/**
 * A booking in the visitor's zone and, when the service runs on a different clock at that moment, in the service's too
 * ("9:30 AM in Tokyo is 6:00 AM where the service is"). Two zones that read the same time are shown once.
 */
export function whenLines(
  startsAt: string,
  endsAt: string,
  visitorZone: string,
  serviceZone: string,
  locale: string,
): { visitor: WhenPart; service: WhenPart | null } {
  const same =
    zoneOffsetMinutes(startsAt, visitorZone) === zoneOffsetMinutes(startsAt, serviceZone);
  return {
    visitor: whenIn(startsAt, endsAt, visitorZone, locale),
    service: same ? null : whenIn(startsAt, endsAt, serviceZone, locale),
  };
}

/** Only web links open from the page: a `javascript:` or `data:` address from the server is never made into a link. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export type Where =
  | { kind: 'video'; url: string }
  | { kind: 'videoLater' }
  | { kind: 'address'; text: string }
  | { kind: 'phone'; text: string; tel: string };

/** WaDesk shows the video link when the booking has one, else the address; a phone appointment shows the number to use. */
export function whereOf(
  b: Pick<PublicBooking, 'meetUrl' | 'location' | 'locationType'>,
): Where | null {
  const meet = safeHttpUrl(b.meetUrl);
  if (meet) return { kind: 'video', url: meet };
  const text = (b.location ?? '').trim();
  if (b.locationType === 'virtual') {
    const link = safeHttpUrl(text);
    return link ? { kind: 'video', url: link } : { kind: 'videoLater' };
  }
  if (!text) return null;
  if (b.locationType === 'phone')
    return { kind: 'phone', text, tel: `tel:${text.replace(/[^0-9+]/g, '')}` };
  return { kind: 'address', text };
}

/** The text a calendar entry shows as its place. */
export function calendarPlace(
  b: Pick<PublicBooking, 'meetUrl' | 'location' | 'locationType'>,
): string | null {
  const where = whereOf(b);
  if (!where) return null;
  switch (where.kind) {
    case 'video':
      return where.url;
    case 'address':
    case 'phone':
      return where.text;
    case 'videoLater':
      return null;
  }
}

/** The calendar event for a booking: the file and the Google link are built from the same fields. */
export function calendarEvent(
  b: PublicBooking,
  orgName: string,
): IcsEvent & { description: string } {
  const lines = [b.description?.trim(), `${orgName}`, b.manageUrl].filter((x): x is string =>
    Boolean(x),
  );
  return {
    uid: `${b.manageToken}@appointments`,
    title: orgName ? `${b.typeName} - ${orgName}` : b.typeName,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    location: calendarPlace(b),
    description: lines.join('\n'),
    url: b.manageUrl,
    status: b.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED',
  };
}

// ---- state of a booking on the manage pages -------------------------------------------------------------------------

export type ManageState = 'open' | 'cancelled' | 'completed' | 'no_show' | 'passed';

/**
 * What the manage page offers. A booking that is still open can be moved or cancelled until it starts; a closed one
 * (cancelled, completed, no-show) and an open one whose start has passed can only be looked at.
 */
export function manageStateOf(
  b: Pick<PublicBooking, 'status' | 'startsAt'>,
  now: Date,
): ManageState {
  if (!isOpen(b.status)) return b.status as 'cancelled' | 'completed' | 'no_show';
  return Date.parse(b.startsAt) > now.getTime() ? 'open' : 'passed';
}

/** Reschedule and Cancel, offered only while the booking is open and has not started, and the server agrees. */
export function manageActions(
  b: PublicBooking,
  now: Date,
): { reschedule: boolean; cancel: boolean } {
  const can = visitorCan(b, now);
  return { reschedule: can.reschedule && b.canReschedule, cancel: can.cancel && b.canCancel };
}

// ---- price ---------------------------------------------------------------------------------------------------------

export interface PriceLines {
  currency: string;
  taxPct: number;
  feeMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** What would be due at booking (a deposit or the total); 0 when nothing is. */
  dueNowMinor: number;
}

/** The price lines of a service, or null when it is free (or has no currency). */
export function priceLines(
  type: Pick<PublicType, 'currency' | 'feeMinor' | 'taxPct' | 'dueNowMinor'>,
): PriceLines | null {
  if (type.feeMinor <= 0 || !type.currency) return null;
  const b = priceBreakdown(type.feeMinor, type.taxPct, 'none', 0);
  return {
    currency: type.currency,
    taxPct: type.taxPct,
    feeMinor: b.feeMinor,
    taxMinor: b.taxMinor,
    totalMinor: b.totalMinor,
    dueNowMinor: Math.min(b.totalMinor, Math.max(0, type.dueNowMinor)),
  };
}

/** The fee a visitor sees first on a card ("$150.00"); the tax is shown on the booking page. */
export function priceLabel(
  type: Pick<PublicType, 'currency' | 'feeMinor'>,
  locale: string,
): string | null {
  if (type.feeMinor <= 0 || !type.currency) return null;
  return formatMoney(type.feeMinor, type.currency, locale);
}
