import { signupRequestSchema, type SignupRequest } from '@crm/contracts';
import type { CountryCode } from 'libphonenumber-js';
import { evaluatePhone } from './phone';

/**
 * What the sign-up form checks before it calls the API (TW-AUTH-005). The shape comes from the contract (`signupRequestSchema`),
 * and the extra checks are the web form's own: a mobile number is required and must be a real one, the password must reach the
 * platform's live minimum length, and the confirmation must match. Every problem is a message KEY, not text: the screen turns it
 * into the person's language with `t()`.
 */

export type SignUpField =
  | 'fullName'
  | 'email'
  | 'orgName'
  | 'orgSlug'
  | 'phone'
  | 'referralCode'
  | 'password'
  | 'confirmPassword'
  | 'acceptTerms';

/** The order the fields appear in on screen, and so the order the first invalid one is found in. */
export const SIGN_UP_FIELD_ORDER: readonly SignUpField[] = [
  'fullName',
  'email',
  'orgName',
  'orgSlug',
  'phone',
  'referralCode',
  'password',
  'confirmPassword',
  'acceptTerms',
];

export interface SignUpValues {
  fullName: string;
  email: string;
  orgName: string;
  orgSlug: string;
  /** The person asked to type the workspace address instead of having it derived from the name. */
  customSlug: boolean;
  phone: string;
  referral: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

export interface SignUpRules {
  /** The platform's live minimum password length. */
  minLength: number;
  defaultCountry: CountryCode;
}

export type ValidationKey =
  | 'signUp.validation.fullName'
  | 'signUp.validation.orgName'
  | 'signUp.validation.orgSlug'
  | 'signUp.validation.phoneRequired'
  | 'signUp.validation.phoneInvalid'
  | 'signUp.validation.passwordMismatch'
  | 'signUp.validation.passwordInvalid'
  | 'signUp.validation.acceptTerms'
  | 'signUp.validation.referralCode'
  | 'signUp.passwordMinLength'
  | 'auth.emailInvalid'
  | 'auth.passwordRequired';

export interface Issue {
  key: ValidationKey;
  params?: { min: number };
}

export type SignUpIssues = Partial<Record<SignUpField, Issue>>;

export type SignUpValidation =
  | { ok: true; body: SignupRequest }
  | { ok: false; issues: SignUpIssues; firstInvalid: SignUpField };

/** The message for a field the contract schema refused. `password` and `phone` are decided below, with more context. */
const SCHEMA_ISSUE: Partial<Record<SignUpField, Issue>> = {
  fullName: { key: 'signUp.validation.fullName' },
  email: { key: 'auth.emailInvalid' },
  orgName: { key: 'signUp.validation.orgName' },
  orgSlug: { key: 'signUp.validation.orgSlug' },
  acceptTerms: { key: 'signUp.validation.acceptTerms' },
  referralCode: { key: 'signUp.validation.referralCode' },
};

const isField = (value: unknown): value is SignUpField =>
  typeof value === 'string' && (SIGN_UP_FIELD_ORDER as readonly string[]).includes(value);

export function validateSignUp(values: SignUpValues, rules: SignUpRules): SignUpValidation {
  const issues: SignUpIssues = {};
  const phone = evaluatePhone(values.phone, rules.defaultCountry);
  const slug = values.orgSlug.trim();

  const parsed = signupRequestSchema.safeParse({
    orgName: values.orgName,
    ...(values.customSlug && slug ? { orgSlug: slug } : {}),
    fullName: values.fullName,
    email: values.email.trim(),
    ...(phone.e164 ? { phone: phone.e164 } : {}),
    password: values.password,
    acceptTerms: values.acceptTerms,
    ...(values.referral ? { referralCode: values.referral } : {}),
  });

  if (!parsed.success) {
    for (const problem of parsed.error.issues) {
      const field = problem.path[0];
      const message = isField(field) ? SCHEMA_ISSUE[field] : undefined;
      if (isField(field) && message && !issues[field]) issues[field] = message;
    }
  }

  if (!values.phone.trim()) issues.phone = { key: 'signUp.validation.phoneRequired' };
  else if (!phone.valid) issues.phone = { key: 'signUp.validation.phoneInvalid' };

  // The contract only guards the floor (8); the platform's live minimum is shown to the person before the server is asked.
  if (!values.password) issues.password = { key: 'auth.passwordRequired' };
  else if (values.password.length < rules.minLength) {
    issues.password = { key: 'signUp.passwordMinLength', params: { min: rules.minLength } };
  }

  if (values.password !== values.confirmPassword) {
    issues.confirmPassword = { key: 'signUp.validation.passwordMismatch' };
  }

  const firstInvalid = SIGN_UP_FIELD_ORDER.find((field) => issues[field]);
  if (firstInvalid || !parsed.success) {
    return { ok: false, issues, firstInvalid: firstInvalid ?? 'fullName' };
  }
  return { ok: true, body: parsed.data };
}
