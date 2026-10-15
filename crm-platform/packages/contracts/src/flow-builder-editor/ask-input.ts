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
] as const;
export type FlbAskInputType = (typeof FLB_ASK_INPUT_TYPES)[number];

export const FLB_ASK_INPUT_LABELS: Record<FlbAskInputType, string> = {
  text: 'Free text',
  name: 'Name',
  email: 'Email address',
  phone: 'Phone number',
  number: 'Number',
  alphanumeric: 'Letters and numbers',
  date: 'Date',
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
      return `Please enter a valid date (${flbCleanDateFormat(dateFormat).toUpperCase()})`;
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
