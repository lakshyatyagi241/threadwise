import type {
  OtpTemplateCreateRequest,
  RegistrationSettings,
  RegistrationSettingsPatch,
} from '@crm/contracts';

/**
 * Registration policy form (TW-AUTH-019, TW-AUTH-007). Numbers are text so a field can be blank.
 * The sign-up OTP knobs fall back to their documented defaults when blank (Reference never saved an
 * empty knob as 0); trial days keep the stored value when blank. The OTP template is not a form
 * field: it is created and refreshed through its own actions, never saved with the form.
 */
export const OTP_KNOBS = {
  ttlMinutes: { min: 1, max: 90, default: 5 },
  length: { min: 4, max: 8, default: 6 },
  resendCooldownSec: { min: 15, max: 600, default: 60 },
  maxAttempts: { min: 1, max: 20, default: 5 },
} as const;
export type OtpKnob = keyof typeof OTP_KNOBS;

export const TRIAL_DAYS = { min: 0, max: 365 } as const;
/** `<kind>:<id>`, the reference of a sender in the OTP sender registry. */
export const SENDER_PATTERN = /^(waba|twilio|device|dev):[a-z0-9]{1,24}$/;
export const COUNTRY_PATTERN = /^[A-Za-z]{2}$/;

export interface RegistrationDraft {
  publicRegistration: boolean;
  emailVerification: RegistrationSettings['emailVerification'];
  defaultPlanId: string;
  trialDays: string;
  defaultTimezone: string;
  /** '' = no default country. */
  defaultCountryIso: string;
  termsUrl: string;
  privacyUrl: string;
  cookiesUrl: string;
  otpEnabled: boolean;
  /** '' = no sender chosen. */
  otpSender: string;
  ttlMinutes: string;
  length: string;
  resendCooldownSec: string;
  maxAttempts: string;
}

export type RegistrationField =
  | 'defaultPlanId'
  | 'trialDays'
  | 'defaultTimezone'
  | 'defaultCountryIso'
  | 'termsUrl'
  | 'privacyUrl'
  | 'cookiesUrl'
  | 'otpSender'
  | OtpKnob;

export type RegistrationProblem =
  | { code: 'range'; min: number; max: number }
  | { code: 'required' }
  | { code: 'link' }
  | { code: 'tooLong'; max: number }
  | { code: 'senderFormat' }
  | { code: 'senderRequired' }
  | { code: 'countryFormat' };
export type RegistrationProblems = Partial<Record<RegistrationField, RegistrationProblem>>;

/** The OTP part of the form (what a template action returns and the draft takes back). */
export type OtpDraftFields = Pick<
  RegistrationDraft,
  'otpEnabled' | 'otpSender' | 'ttlMinutes' | 'length' | 'resendCooldownSec' | 'maxAttempts'
>;

export function otpDraftFields(s: RegistrationSettings): OtpDraftFields {
  return {
    otpEnabled: s.otp.enabled,
    otpSender: s.otp.sender ?? '',
    ttlMinutes: String(s.otp.ttlMinutes),
    length: String(s.otp.length),
    resendCooldownSec: String(s.otp.resendCooldownSec),
    maxAttempts: String(s.otp.maxAttempts),
  };
}

export function registrationToDraft(s: RegistrationSettings): RegistrationDraft {
  return {
    publicRegistration: s.publicRegistration,
    emailVerification: s.emailVerification,
    defaultPlanId: s.defaultPlanId ?? '',
    trialDays: String(s.trialDays),
    defaultTimezone: s.defaultTimezone,
    defaultCountryIso: s.defaultCountryIso?.toUpperCase() ?? '',
    termsUrl: s.termsUrl,
    privacyUrl: s.privacyUrl,
    cookiesUrl: s.cookiesUrl ?? '',
    ...otpDraftFields(s),
  };
}

/** A legal link is a site path (`/legal/terms`) or an http(s) URL. Anything else (javascript:, //host) is refused. */
export function isValidLegalLink(value: string): boolean {
  const v = value.trim();
  if (v.length === 0 || v.length > 512) return false;
  if (v.startsWith('/')) return !v.startsWith('//') && !v.includes('\\') && !/\s/.test(v);
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function wholeNumber(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

export function buildRegistrationPatch(
  base: RegistrationSettings,
  draft: RegistrationDraft,
): { patch: RegistrationSettingsPatch; problems: RegistrationProblems } {
  const patch: RegistrationSettingsPatch = {};
  const otp: NonNullable<RegistrationSettingsPatch['otp']> = {};
  const problems: RegistrationProblems = {};

  if (draft.publicRegistration !== base.publicRegistration)
    patch.publicRegistration = draft.publicRegistration;
  if (draft.emailVerification !== base.emailVerification)
    patch.emailVerification = draft.emailVerification;

  const plan = draft.defaultPlanId.trim();
  if (plan.length > 64) problems.defaultPlanId = { code: 'tooLong', max: 64 };
  else if ((plan || null) !== base.defaultPlanId) patch.defaultPlanId = plan || null;

  if (draft.trialDays.trim() !== '') {
    const n = wholeNumber(draft.trialDays);
    if (n === null || n < TRIAL_DAYS.min || n > TRIAL_DAYS.max)
      problems.trialDays = { code: 'range', ...TRIAL_DAYS };
    else if (n !== base.trialDays) patch.trialDays = n;
  }

  const tz = draft.defaultTimezone.trim();
  if (!tz) problems.defaultTimezone = { code: 'required' };
  else if (tz.length > 64) problems.defaultTimezone = { code: 'tooLong', max: 64 };
  else if (tz !== base.defaultTimezone) patch.defaultTimezone = tz;

  const country = draft.defaultCountryIso.trim();
  if (country && !COUNTRY_PATTERN.test(country))
    problems.defaultCountryIso = { code: 'countryFormat' };
  else if (
    (country ? country.toUpperCase() : null) !== (base.defaultCountryIso?.toUpperCase() ?? null)
  ) {
    patch.defaultCountryIso = country ? country.toUpperCase() : null;
  }

  for (const key of ['termsUrl', 'privacyUrl'] as const) {
    const v = draft[key].trim();
    if (!v) problems[key] = { code: 'required' };
    else if (!isValidLegalLink(v)) problems[key] = { code: 'link' };
    else if (v !== base[key]) patch[key] = v;
  }
  const cookies = draft.cookiesUrl.trim();
  if (cookies && !isValidLegalLink(cookies)) problems.cookiesUrl = { code: 'link' };
  else if ((cookies || null) !== base.cookiesUrl) patch.cookiesUrl = cookies || null;

  if (draft.otpEnabled !== base.otp.enabled) otp.enabled = draft.otpEnabled;

  const sender = draft.otpSender.trim();
  if (sender && !SENDER_PATTERN.test(sender)) problems.otpSender = { code: 'senderFormat' };
  else if ((sender || null) !== base.otp.sender) otp.sender = sender || null;

  for (const key of Object.keys(OTP_KNOBS) as OtpKnob[]) {
    const spec = OTP_KNOBS[key];
    const raw = draft[key].trim();
    const n = raw === '' ? spec.default : wholeNumber(raw);
    if (n === null || n < spec.min || n > spec.max)
      problems[key] = { code: 'range', min: spec.min, max: spec.max };
    else if (n !== base.otp[key]) otp[key] = n;
  }

  if (Object.keys(otp).length > 0) patch.otp = otp;
  return { patch, problems };
}

const OTP_FIELDS = ['otpSender', ...(Object.keys(OTP_KNOBS) as OtpKnob[])] as const;

/**
 * "Create & submit template" posts the whole OTP form (Reference): the sender is required, and the
 * knobs go with it so they are saved in the same request. Only OTP fields are checked: another
 * invalid field elsewhere on the page must not block this action. Blank knobs fall back to their
 * defaults, as on a normal save.
 */
export function buildOtpTemplateRequest(
  base: RegistrationSettings,
  draft: RegistrationDraft,
): { body: OtpTemplateCreateRequest | null; problems: RegistrationProblems } {
  const { patch, problems: all } = buildRegistrationPatch(base, draft);
  const problems: RegistrationProblems = {};
  for (const key of OTP_FIELDS) if (all[key]) problems[key] = all[key];
  const sender = draft.otpSender.trim();
  if (!sender) problems.otpSender = { code: 'senderRequired' };
  if (Object.keys(problems).length > 0) return { body: null, problems };
  return { body: { otp: { ...(patch.otp ?? {}), sender } }, problems };
}

/** How many settings a patch touches, counting each OTP knob (what "N settings saved" reports). */
export function patchSize(patch: RegistrationSettingsPatch): number {
  const { otp, ...rest } = patch;
  return Object.keys(rest).length + (otp ? Object.keys(otp).length : 0);
}

/** Maps an API field path (`otp.ttlMinutes`) to the form control it belongs to. */
export function registrationFieldForPath(
  path: string,
): RegistrationField | 'publicRegistration' | 'emailVerification' | 'otpEnabled' | null {
  const map: Record<string, ReturnType<typeof registrationFieldForPath>> = {
    publicRegistration: 'publicRegistration',
    emailVerification: 'emailVerification',
    defaultPlanId: 'defaultPlanId',
    trialDays: 'trialDays',
    defaultTimezone: 'defaultTimezone',
    defaultCountryIso: 'defaultCountryIso',
    termsUrl: 'termsUrl',
    privacyUrl: 'privacyUrl',
    cookiesUrl: 'cookiesUrl',
    'otp.enabled': 'otpEnabled',
    'otp.sender': 'otpSender',
    'otp.ttlMinutes': 'ttlMinutes',
    'otp.length': 'length',
    'otp.resendCooldownSec': 'resendCooldownSec',
    'otp.maxAttempts': 'maxAttempts',
  };
  return map[path] ?? null;
}
