import {
  COMPANY_BUILTIN_PROPERTIES,
  CONTACT_BUILTIN_PROPERTIES,
  FORM_ADDRESS_PARTS,
  canonicalizeLocalPhone,
  composeAddress,
  formAgeField,
  formFields,
  isPlausibleBirthDate,
  judgeAgeAnswer,
  parseAgeAnswer,
  parseDateValue,
  type AgeAnswer,
  type AgeVerdict,
  type FormAddressPart,
  type FormDefinition,
  type FormFieldBlock,
} from '@crm/contracts';

/**
 * The pure rules of a submission (docs/specs/forms-builder-app.md 9.1 step 4 and 9.3): validate a visitor's answers against the FROZEN
 * version, and map the validated values onto CRM properties. No database, no request: a unit test pins every rule.
 *
 * Nothing here trusts the page: a field id the form does not have is dropped, a `hidden` field takes its value from the attribution the
 * page read (never from the answers), a required field that is blank is refused, an option that is not on the list is refused.
 */

/** What an answer is stored as: text, a number, a ticked box or the ticked options. */
export type StoredAnswer = string | number | boolean | string[];

export interface FieldIssue {
  fieldId: string;
  /** `required`, `invalid_email`, `invalid_phone`, `invalid_number`, `invalid_date`, `invalid_option`, `too_short`, `too_long`, `too_small`, `too_large`, `pattern`. */
  code: string;
}

export interface ValidatedAnswers {
  /** Field id -> the validated, normalised value. Blank answers are absent. */
  values: Record<string, StoredAnswer>;
  issues: FieldIssue[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Text a regular expression is tested against is cut here: with the pattern guard in the contracts, a floor against a slow pattern. */
const PATTERN_TEST_MAX = 500;
const SHORT_TEXT_MAX = 500;
const LONG_TEXT_MAX = 5000;
const NUMBER_ABS_MAX = 1e12;
const HIDDEN_MAX = 500;

// eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
const CONTROL_KEEP_BREAKS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
const CONTROL_ALL = /[\u0000-\u001f\u007f]/g;

/**
 * Text as stored: NUL and other control characters removed (a newline and a tab survive in long text), Unicode normalised to NFC, ends
 * trimmed. Collapsing whitespace is left alone: an address or a message may legitimately have line breaks.
 */
export function cleanText(raw: string, multiline: boolean): string {
  const stripped = raw.replace(multiline ? CONTROL_KEEP_BREAKS : CONTROL_ALL, '');
  return stripped.normalize('NFC').trim();
}

const isBlank = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

function asNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const t = raw.trim().replace(/,/g, '');
    if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** One field's answer: the value to store, `undefined` for a blank optional answer, or an issue code. */
function checkField(
  f: FormFieldBlock,
  raw: unknown,
  phoneCountryCode: string | undefined,
  now: Date,
): { value?: StoredAnswer; issue?: string } {
  const required = f.required;
  const v = f.validation;

  if (f.kind === 'checkbox') {
    const ticked = raw === true || raw === 'true' || raw === 'on' || raw === 1;
    if (!ticked && required) return { issue: 'required' };
    return ticked ? { value: true } : {};
  }

  if (isBlank(raw)) return required ? { issue: 'required' } : {};

  switch (f.kind) {
    case 'short_text':
    case 'long_text': {
      if (typeof raw !== 'string') return { issue: 'invalid_value' };
      const text = cleanText(raw, f.kind === 'long_text');
      if (text === '') return required ? { issue: 'required' } : {};
      const max = Math.min(
        v?.maxLen ?? Infinity,
        f.kind === 'long_text' ? LONG_TEXT_MAX : SHORT_TEXT_MAX,
      );
      if (text.length > max) return { issue: 'too_long' };
      if (v?.minLen !== undefined && text.length < v.minLen) return { issue: 'too_short' };
      if (v?.pattern && !matchesPattern(v.pattern, text)) return { issue: 'pattern' };
      return { value: text };
    }
    case 'email': {
      if (typeof raw !== 'string') return { issue: 'invalid_email' };
      const email = cleanText(raw, false).toLowerCase();
      if (email.length > 254 || !EMAIL.test(email)) return { issue: 'invalid_email' };
      if (v?.pattern && !matchesPattern(v.pattern, email)) return { issue: 'pattern' };
      return { value: email };
    }
    case 'phone': {
      if (typeof raw !== 'string') return { issue: 'invalid_phone' };
      const text = cleanText(raw, false);
      if (text.length > 40) return { issue: 'invalid_phone' };
      const phone = canonicalizeLocalPhone(text, phoneCountryCode);
      if (!phone) return { issue: 'invalid_phone' };
      return { value: phone.e164 };
    }
    case 'number':
    case 'currency':
    case 'rating': {
      const n = asNumber(raw);
      if (n === null || Math.abs(n) > NUMBER_ABS_MAX) return { issue: 'invalid_number' };
      if (f.kind === 'rating' && (!Number.isInteger(n) || n < 1 || n > 5))
        return { issue: 'invalid_number' };
      if (v?.min !== undefined && n < v.min) return { issue: 'too_small' };
      if (v?.max !== undefined && n > v.max) return { issue: 'too_large' };
      return { value: f.kind === 'currency' ? Math.round(n * 100) / 100 : n };
    }
    case 'date': {
      if (typeof raw !== 'string') return { issue: 'invalid_date' };
      const d = parseDateValue(raw.trim());
      if (!d || d.kind !== 'day') return { issue: 'invalid_date' };
      return { value: d.iso };
    }
    case 'date_of_birth': {
      // A real day that can be a birth date (BL-211). The same code as a bad date, so the page cannot tell a typo from a refusal.
      if (typeof raw !== 'string') return { issue: 'invalid_date' };
      const d = parseDateValue(raw.trim());
      if (!d || d.kind !== 'day' || !isPlausibleBirthDate(d.iso, now)) {
        return { issue: 'invalid_date' };
      }
      return { value: d.iso };
    }
    case 'age': {
      const n = parseAgeAnswer(typeof raw === 'string' || typeof raw === 'number' ? raw : null);
      return n === null ? { issue: 'invalid_number' } : { value: n };
    }
    case 'dropdown':
    case 'radio': {
      if (typeof raw !== 'string') return { issue: 'invalid_option' };
      return f.options?.some((o) => o.value === raw) ? { value: raw } : { issue: 'invalid_option' };
    }
    case 'checkbox_group': {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string'))
        return { issue: 'invalid_option' };
      const picked = [...new Set(raw as string[])];
      if (!picked.every((p) => f.options?.some((o) => o.value === p)))
        return { issue: 'invalid_option' };
      if (picked.length === 0) return required ? { issue: 'required' } : {};
      return { value: picked };
    }
    default:
      return {};
  }
}

function matchesPattern(pattern: string, text: string): boolean {
  if (text.length > PATTERN_TEST_MAX) return false;
  try {
    return new RegExp(pattern).test(text);
  } catch {
    // A pattern that does not compile was refused when the form was saved; if one got here anyway the safe answer is "does not match".
    return false;
  }
}

/** The attribution a `hidden` field takes its value from: what the page read, cut to length. A source the page did not send is blank. */
export type HiddenInput = Partial<
  Record<
    | 'utm_source'
    | 'utm_medium'
    | 'utm_campaign'
    | 'utm_term'
    | 'utm_content'
    | 'referrer'
    | 'page_url',
    string | undefined
  >
>;

/**
 * Validates the answers of a submission against the version of the form the visitor filled. Field ids the form does not have are
 * ignored. Every field is checked (a visitor learns every problem at once, and these are their own words), and `hidden` fields take the
 * page's attribution or their constant.
 */
export function validateSubmission(
  def: FormDefinition,
  answers: Record<string, unknown>,
  hidden: HiddenInput,
  now: Date = new Date(),
): ValidatedAnswers {
  const values: Record<string, StoredAnswer> = {};
  const issues: FieldIssue[] = [];
  const phoneCountryCode = def.settings.phoneCountryCode;
  for (const f of formFields(def)) {
    if (f.kind === 'hidden') {
      const raw =
        f.hiddenSource === 'constant'
          ? f.constant
          : f.hiddenSource
            ? hidden[f.hiddenSource]
            : undefined;
      const text = typeof raw === 'string' ? cleanText(raw, false).slice(0, HIDDEN_MAX) : '';
      if (text !== '') values[f.id] = text;
      continue;
    }
    const out = checkField(f, answers[f.id], phoneCountryCode, now);
    if (out.issue) issues.push({ fieldId: f.id, code: out.issue });
    else if (out.value !== undefined) values[f.id] = out.value;
  }
  return { values, issues };
}

/**
 * The answers a spammer pastes links and pitches into: long text, and short text that is not a website by purpose (a field bound to a
 * company's website legitimately holds a link). Short structured answers (an email, a number, a choice) are not text.
 */
export function freeTexts(def: FormDefinition, values: Record<string, StoredAnswer>): string[] {
  const out: string[] = [];
  for (const f of formFields(def)) {
    const v = values[f.id];
    if (typeof v !== 'string' || v.length <= 25) continue;
    const website = f.bind?.object === 'company' && f.bind.property === 'domain';
    if (f.kind === 'long_text' || (f.kind === 'short_text' && !website)) out.push(v);
  }
  return out;
}

// --- mapping -----------------------------------------------------------------------------------------------------------------------------

/** A mapped value as text, which is what the CRM's custom-property coercion reads (a list is comma-joined, a box is true/false). */
export function asText(value: StoredAnswer): string {
  if (Array.isArray(value)) return value.join(',');
  return typeof value === 'string' ? value : String(value);
}

export interface MappedObject {
  /** Built-in property name -> text. */
  builtin: Record<string, string>;
  /** Custom property key -> text (typed by the registry at write time). */
  custom: Record<string, string>;
}

export interface MappedSubmission {
  contact: MappedObject;
  company: MappedObject;
}

/** The names a form's contact built-ins can take; any other property key is a custom property of the registry. */
const CONTACT_BUILTINS: ReadonlySet<string> = new Set(CONTACT_BUILTIN_PROPERTIES);
const COMPANY_BUILTINS: ReadonlySet<string> = new Set(COMPANY_BUILTIN_PROPERTIES);

/** Which of an object's property names are columns rather than registry keys. */
export const isBuiltinProperty = (object: 'contact' | 'company', property: string): boolean =>
  (object === 'contact' ? CONTACT_BUILTINS : COMPANY_BUILTINS).has(property);

/** Splits the validated values by what each field is bound to. A field with no bind is kept in the submission only. */
export function mapAnswers(
  def: FormDefinition,
  values: Record<string, StoredAnswer>,
): MappedSubmission {
  const out: MappedSubmission = {
    contact: { builtin: {}, custom: {} },
    company: { builtin: {}, custom: {} },
  };
  for (const f of formFields(def)) {
    const value = values[f.id];
    if (value === undefined) continue;
    // A date of birth field always writes the contact's date of birth, bound or not (BL-211): there is nowhere else it could go.
    const bind =
      f.kind === 'date_of_birth'
        ? ({ object: 'contact', property: 'date_of_birth' } as const)
        : f.bind;
    if (!bind) continue;
    const target = out[bind.object];
    const text = asText(value);
    if (text === '') continue;
    if (isBuiltinProperty(bind.object, bind.property)) target.builtin[bind.property] = text;
    else target.custom[bind.property] = text;
  }
  // Address parts become the one address line the CRM keeps; a field bound to the whole address wins over the parts.
  for (const target of [out.contact, out.company]) {
    const parts: Partial<Record<FormAddressPart, string>> = {};
    for (const part of FORM_ADDRESS_PARTS) {
      if (target.builtin[part] !== undefined) parts[part] = target.builtin[part];
      delete target.builtin[part];
    }
    const joined = composeAddress(parts);
    if (joined !== null && target.builtin.address === undefined) target.builtin.address = joined;
  }
  return out;
}

/** "Ada Lovelace" from the pieces a form collected: the full name when bound, else first and last joined. */
export function contactDisplayName(m: MappedObject): {
  name: string | null;
  first: string | null;
  last: string | null;
} {
  const first = m.builtin.first_name?.trim() || null;
  const last = m.builtin.last_name?.trim() || null;
  const name = m.builtin.name?.trim() || [first, last].filter(Boolean).join(' ') || null;
  return {
    name: name ? name.slice(0, 191) : null,
    first: first?.slice(0, 191) ?? null,
    last: last?.slice(0, 191) ?? null,
  };
}

/** Domains of free mail providers: an address there says nothing about a company. */
const FREE_MAIL: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.co.uk',
  'yahoo.fr',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
  'rediffmail.com',
  'qq.com',
  '163.com',
  '126.com',
  'naver.com',
  'web.de',
  'tutanota.com',
  'fastmail.com',
  'hey.com',
  'inbox.com',
  'rocketmail.com',
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'btinternet.com',
  'libero.it',
  'orange.fr',
  'free.fr',
  'wanadoo.fr',
  'laposte.net',
  'mail.ru',
  'bk.ru',
  'list.ru',
  'rambler.ru',
  'seznam.cz',
  'o2.pl',
  'wp.pl',
]);

/** The company website an email address implies ("ada@acme.com" is "acme.com"), or null for a free mail provider or no address. */
export function companyHostFromEmail(email: string | null | undefined): string | null {
  const host = email?.split('@')[1]?.trim().toLowerCase();
  if (!host || !host.includes('.') || FREE_MAIL.has(host)) return null;
  return host;
}

export const isFreeMailDomain = (host: string): boolean => FREE_MAIL.has(host.toLowerCase());

// --- the age gate (BL-211, spec 11.10) -------------------------------------------------------------------------------------------------

/**
 * Answers the server adds beside the visitor's own, under keys no field can have (a block id starts with a letter). They travel with the
 * stored answers, so a staff re-run of the submission sees the same age outcome and the retention sweep removes the guardian's details
 * together with everything else the visitor typed.
 */
export const AGE_KEYS = {
  /** `under` when the gate found the visitor under the minimum age and the form let them through. */
  outcome: '_age_gate',
  /** The minimum age the gate used, so a re-run judges against the same number. */
  minAge: '_age_min',
  /** The declaration box was ticked. */
  confirmed: '_age_confirmed',
  guardianName: '_guardian_name',
  guardianEmail: '_guardian_email',
  guardianPhone: '_guardian_phone',
} as const;

/** What the gate saw: the minimum used and the verdict. */
export interface FormAgeJudgement {
  minAge: number;
  verdict: AgeVerdict;
}

/** The answer the gate judges, read from the validated values (and the declaration box); null when the gate is off. */
export function ageAnswerOf(
  def: FormDefinition,
  values: Record<string, StoredAnswer>,
  confirmed: boolean,
): AgeAnswer | null {
  const gate = def.ageGate;
  if (!gate.enabled) return null;
  const field = formAgeField(def);
  switch (gate.mode) {
    case 'dob':
      return { mode: 'dob', dob: field?.kind === 'date_of_birth' ? values[field.id] : undefined };
    case 'age':
      return { mode: 'age', age: field?.kind === 'age' ? values[field.id] : undefined };
    case 'declaration':
      return { mode: 'declaration', confirmed };
  }
}

/** Judges a submission against the form's gate; null when the gate is off. `workspaceAge` is the fallback for a gate with no age of its own. */
export function judgeFormAge(
  def: FormDefinition,
  values: Record<string, StoredAnswer>,
  confirmed: boolean,
  workspaceAge: number,
  now: Date,
): FormAgeJudgement | null {
  const answer = ageAnswerOf(def, values, confirmed);
  if (!answer) return null;
  const minAge = def.ageGate.minAge ?? workspaceAge;
  return { minAge, verdict: judgeAgeAnswer(answer, minAge, now) };
}

export interface GuardianDetails {
  name: string;
  email: string | null;
  phone: string | null;
}

/** The guardian the visitor named: a name and an email address or a phone number, cleaned like any other answer. Null when not usable. */
export function cleanGuardian(
  raw: { name: string; email?: string | undefined; phone?: string | undefined } | undefined,
  phoneCountryCode: string | undefined,
): GuardianDetails | null {
  if (!raw) return null;
  const name = cleanText(raw.name, false).slice(0, 120);
  const emailText = raw.email ? cleanText(raw.email, false).toLowerCase() : '';
  const email =
    emailText !== '' && emailText.length <= 191 && EMAIL.test(emailText) ? emailText : null;
  const phone = raw.phone
    ? (canonicalizeLocalPhone(cleanText(raw.phone, false), phoneCountryCode)?.e164 ?? null)
    : null;
  if (name === '' || (email === null && phone === null)) return null;
  return { name, email, phone };
}

/** The guardian details back out of the stored answers (a staff re-run, the submission screen). */
export function guardianOf(values: Record<string, unknown>): GuardianDetails | null {
  const text = (k: string): string | null => {
    const v = values[k];
    return typeof v === 'string' && v !== '' ? v : null;
  };
  const name = text(AGE_KEYS.guardianName);
  return name
    ? { name, email: text(AGE_KEYS.guardianEmail), phone: text(AGE_KEYS.guardianPhone) }
    : null;
}
