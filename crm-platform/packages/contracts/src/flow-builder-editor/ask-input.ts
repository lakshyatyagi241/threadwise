import {
  isPlausibleBirthDate,
  MAX_GATE_AGE,
  MIN_GATE_AGE,
  parseAgeAnswer,
} from '../contact-consent/age';

/**
 * Validated questions: the Ask node with "Validate as" set to name, email, phone, number, alphanumeric or date. NOT a Reference
 * behaviour: Reference's Ask saved this setting and never read it. The rules and the default wrong-answer texts follow the console
 * chatbot runtime (email, name and number are checked there; its answer is not kept when it does not pass), with two
 * deviations written down here: a name may be 2 characters long (the console wants at least 4, which refuses "Om" and "Raj"),
 * and phone, alphanumeric and date, which the console never checked on WhatsApp, are checked here.
 * This file holds what the editor and the runtime must agree on, as pure data and functions.
 */

export const FLB_ASK_INPUT_TYPES = [
  'text',
  'name',
  'email',
  'phone',
  'number',
  'alphanumeric',
  'date',
  // A date and a time of day (an appointment, a delivery slot): the date in the chosen date format, then the time as HH:MM or h:mm am/pm.
  'datetime',
  // A time of day alone (an opening hour, a call-back slot): HH:MM or h:mm am/pm.
  'time',
  // The age question (BL-218, spec 11.10): an age in whole years, or a date of birth written in the chosen date format. The answer is
  // judged against the workspace's minor age (or the node's own) and written to the contact; see `FLB_AGE_*` below.
  'age',
  'date_of_birth',
] as const;
export type FlbAskInputType = (typeof FLB_ASK_INPUT_TYPES)[number];

/** An age question: it needs the workspace's age and writes to the contact, unlike the other checked answers. */
export const flbIsAgeInput = (t: FlbAskInputType): t is 'age' | 'date_of_birth' =>
  t === 'age' || t === 'date_of_birth';

/** What the run does when the answer is under the age: end with a neutral line, or carry on with `{{var}}_age_gate` = `under`. */
export const FLB_AGE_WHEN_UNDER = ['end', 'continue'] as const;
export type FlbAgeWhenUnder = (typeof FLB_AGE_WHEN_UNDER)[number];
export const flbCleanAgeWhenUnder = (v: unknown): FlbAgeWhenUnder =>
  v === 'continue' ? 'continue' : 'end';
/** The line sent when the run ends on an under-age answer and the author wrote none. It does not say why. */
export const FLB_AGE_END_TEXT = 'We are not able to continue.';
/** The node's own minimum age (1 to 21), or null for the workspace's. */
export const flbCleanMinAge = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= MIN_GATE_AGE && n <= MAX_GATE_AGE ? n : null;
};

/**
 * What the builders offer under "Validate as". Letters and numbers repeats Free text, Age is the age gate's own setting and Date of
 * birth repeats Date, so a new question no longer picks them; one that already uses one keeps it (see `flbAskInputChoices`).
 */
export const FLB_ASK_INPUT_PICKER: readonly FlbAskInputType[] = [
  'text',
  'name',
  'email',
  'phone',
  'number',
  'date',
  'datetime',
  'time',
];

/** The picker, plus the question's current type when it is one of the retired ones, so opening an old question changes nothing. */
export const flbAskInputChoices = (current: unknown): readonly FlbAskInputType[] => {
  const now = flbCleanAskInputType(current);
  return FLB_ASK_INPUT_PICKER.includes(now) ? FLB_ASK_INPUT_PICKER : [...FLB_ASK_INPUT_PICKER, now];
};

export const FLB_ASK_INPUT_LABELS: Record<FlbAskInputType, string> = {
  text: 'Free text',
  name: 'Name',
  email: 'Email address',
  phone: 'Phone number',
  number: 'Number',
  alphanumeric: 'Letters and numbers',
  date: 'Date',
  datetime: 'Date and time',
  time: 'Time',
  age: 'Age',
  date_of_birth: 'Date of birth',
};

/** The date shapes a customer can be asked for: `dd` day, `mm` month, `yyyy` / `yy` year, joined by `-`, `/` or `.`. */
export const FLB_DATE_FORMATS = [
  'dd-mm-yyyy',
  'dd/mm/yyyy',
  'dd.mm.yyyy',
  'mm/dd/yyyy',
  'mm-dd-yyyy',
  'yyyy-mm-dd',
  'dd-mm-yy',
  'dd/mm/yy',
  'mm/dd/yy',
] as const;
export type FlbDateFormat = (typeof FLB_DATE_FORMATS)[number];
export const FLB_DEFAULT_DATE_FORMAT: FlbDateFormat = 'dd-mm-yyyy';

export const flbCleanAskInputType = (v: unknown): FlbAskInputType =>
  (FLB_ASK_INPUT_TYPES as readonly string[]).includes(String(v)) ? (v as FlbAskInputType) : 'text';

export const flbCleanDateFormat = (v: unknown): FlbDateFormat =>
  (FLB_DATE_FORMATS as readonly string[]).includes(String(v))
    ? (v as FlbDateFormat)
    : FLB_DEFAULT_DATE_FORMAT;

/**
 * The one-time code that proves a phone number is the visitor's: a Phone question with "Verify with a code" on sends it to the number
 * (over the platform's verification sender) and waits for it in the chat. Short-lived and hard to farm: a code lives 10 minutes, three
 * wrong tries end the question, two new codes at most, three codes per number every ten minutes and a daily limit per workspace.
 */
export const FLB_OTP = {
  digits: 6,
  ttlMinutes: 10,
  maxTries: 3,
  maxResends: 2,
  perPhoneWindowSeconds: 600,
  perPhone: 3,
  perOrgPerDay: 100,
} as const;

/** What the visitor is told while a code is asked for. `{phone}` and `{minutes}` are filled in. */
export const FLB_OTP_TEXT = {
  sent: 'We sent a code to {phone}. Type it here (it works for {minutes} minutes), or send "resend" for a new one.',
  wrong: 'That code is not right. Please try again.',
  expired: 'That code has expired. Send "resend" for a new one.',
  noMoreCodes: 'No more new codes can be sent for this number.',
  needCountryCode: 'Please include your country code, like +91 98765 43210.',
  sendFailed: 'We could not send a code to that number. Please check it and try again.',
  tooMany: 'Too many codes were asked for. Please try again later.',
} as const;

/** The text sent when an answer does not pass and the author wrote none. */
export function flbAskInputWrongText(type: FlbAskInputType, dateFormat?: unknown): string {
  switch (type) {
    case 'name':
      return 'Please enter a valid name';
    case 'email':
      return 'Please enter a valid email id';
    case 'number':
      return 'Please enter a valid number';
    case 'phone':
      return 'Please enter a valid phone number';
    case 'alphanumeric':
      return 'Please use letters and numbers only';
    case 'date':
    case 'date_of_birth':
      return `Please enter a valid date (${flbCleanDateFormat(dateFormat).toUpperCase()})`;
    case 'time':
      return 'Please enter a valid time (HH:MM)';
    case 'datetime':
      return `Please enter a valid date and time (${flbCleanDateFormat(dateFormat).toUpperCase()} HH:MM)`;
    case 'age':
      return 'Please enter your age as a whole number';
    default:
      return 'Please try again';
  }
}

const EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
// Unicode letters, combining marks and spaces: no digits, punctuation, apostrophes or hyphens (the console's rule).
const NAME = /^(?!\s*$)[\p{L}\p{M} ]+$/u;
const NUMBER = /^-?\d+(\.\d+)?$/;
const ALNUM = /^[A-Za-z0-9]+$/;
const PHONE = /^\+?\d{7,15}$/;

const MAX_TEXT = 1000;

/** `dd-mm-yyyy` as a matcher: which part sits where, and the separator. */
function dateParts(format: FlbDateFormat) {
  const sep = /[-/.]/.exec(format)![0];
  return { sep, order: format.split(sep) as Array<'dd' | 'mm' | 'yyyy' | 'yy'> };
}

/** A real calendar day written in `format` (1 or 2 digits for day and month; `yy` means 20yy). */
export function flbParseDate(raw: string, format: FlbDateFormat): string | null {
  const { sep, order } = dateParts(format);
  const parts = raw.trim().split(sep);
  if (parts.length !== 3) return null;
  let d = 0;
  let m = 0;
  let y = 0;
  for (let i = 0; i < 3; i++) {
    const part = parts[i]!;
    const kind = order[i]!;
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (kind === 'dd') {
      if (part.length > 2) return null;
      d = n;
    } else if (kind === 'mm') {
      if (part.length > 2) return null;
      m = n;
    } else if (kind === 'yyyy') {
      if (part.length !== 4) return null;
      y = n;
    } else {
      if (part.length !== 2) return null;
      y = 2000 + n;
    }
  }
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d)
    return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * "04-05-1990 14:30" or "04-05-1990 2:30 pm": the date in `format`, a space, then a 24-hour or am/pm time. Returns `YYYY-MM-DDTHH:MM`,
 * or null when either half does not read.
 */
export function flbParseDateTime(raw: string, format: FlbDateFormat): string | null {
  const m = /^(\S+)\s+(\d{1,2}):(\d{2})\s*([ap]m)?$/i.exec(raw.trim());
  if (!m) return null;
  const date = flbParseDate(m[1]!, format);
  if (date === null) return null;
  let h = Number(m[2]);
  const min = Number(m[3]);
  const mer = m[4]?.toLowerCase();
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (mer === 'pm' ? 12 : 0);
  } else if (h > 23) return null;
  return `${date}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** "14:30" or "2:30 pm" -> `HH:MM` (24-hour), or null when it does not read. */
export function flbParseTime(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*([ap]m)?$/i.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const mer = m[3]?.toLowerCase();
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (mer === 'pm' ? 12 : 0);
  } else if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export type FlbAskInputResult = { ok: true; value: string } | { ok: false };

/**
 * Does `raw` pass? On success `value` is what the variable holds: the answer trimmed, a phone number without its spaces, dashes
 * and brackets, and a date exactly as the customer wrote it (`<var>_iso` is added by the runtime).
 */
export function flbAskInputCheck(
  type: FlbAskInputType,
  raw: string,
  opts: { dateFormat?: unknown } = {},
): FlbAskInputResult {
  const text = raw.trim();
  if (text === '' || text.length > MAX_TEXT) return { ok: false };
  switch (type) {
    case 'text':
      return { ok: true, value: text };
    case 'email':
      return EMAIL.test(text) ? { ok: true, value: text } : { ok: false };
    case 'name':
      return NAME.test(text) && text.length >= 2 && text.length <= 49
        ? { ok: true, value: text }
        : { ok: false };
    case 'number':
      return NUMBER.test(text) ? { ok: true, value: text } : { ok: false };
    case 'alphanumeric':
      return ALNUM.test(text) ? { ok: true, value: text } : { ok: false };
    case 'phone': {
      const digits = text.replace(/[\s().-]/g, '');
      return PHONE.test(digits) ? { ok: true, value: digits } : { ok: false };
    }
    case 'date':
      return flbParseDate(text, flbCleanDateFormat(opts.dateFormat)) !== null
        ? { ok: true, value: text }
        : { ok: false };
    case 'time':
      return flbParseTime(text) !== null ? { ok: true, value: text } : { ok: false };
    case 'datetime':
      return flbParseDateTime(text, flbCleanDateFormat(opts.dateFormat)) !== null
        ? { ok: true, value: text }
        : { ok: false };
    case 'age': {
      const n = parseAgeAnswer(text);
      return n === null ? { ok: false } : { ok: true, value: String(n) };
    }
    case 'date_of_birth': {
      const iso = flbParseDate(text, flbCleanDateFormat(opts.dateFormat));
      return iso !== null && isPlausibleBirthDate(iso, new Date())
        ? { ok: true, value: text }
        : { ok: false };
    }
  }
}

/** A question that checks its answer: not a free-text one, with no fixed answers and no file upload (those keep the plain Ask). */
export function flbAskNeedsInputCheck(d: {
  inputType?: unknown;
  acceptMedia?: unknown;
  expectedAnswers?: unknown;
}): boolean {
  return (
    flbCleanAskInputType(d.inputType) !== 'text' &&
    d.acceptMedia !== true &&
    !(Array.isArray(d.expectedAnswers) && d.expectedAnswers.length > 0)
  );
}
