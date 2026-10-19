import { ERROR_CODES } from '@crm/contracts';
import type { TFunction } from 'i18next';
import { isApiError, type ApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { SIGN_UP_FIELD_ORDER, type SignUpField, type ValidationKey } from './sign-up-validation';

/**
 * What the sign-up form shows when the SERVER refuses the request. Chosen by the stable error `code` and by the field path the
 * server names, never by the English message text (docs/mobile/i18n.md). Messages are the web form's own, in the person's language.
 */
export interface SignUpFailure {
  /** A message about the form as a whole, when no single field is to blame. */
  banner: string | null;
  fields: Partial<Record<SignUpField, string>>;
  /** The workspace address was refused: the form opens its address field so the person can type another one. */
  openSlug: boolean;
}

/** The text for a field the server reported as invalid (the same wording as the checks the form runs itself). */
const FIELD_KEY: Record<SignUpField, ValidationKey | null> = {
  fullName: 'signUp.validation.fullName',
  email: 'auth.emailInvalid',
  orgName: 'signUp.validation.orgName',
  orgSlug: 'signUp.validation.orgSlug',
  phone: 'signUp.validation.phoneInvalid',
  referralCode: 'signUp.validation.referralCode',
  password: 'signUp.validation.passwordInvalid',
  confirmPassword: null,
  acceptTerms: 'signUp.validation.acceptTerms',
};

const isField = (value: string): value is SignUpField =>
  (SIGN_UP_FIELD_ORDER as readonly string[]).includes(value);

/**
 * The password policy answer lists each broken rule as `<field>.<rule>` (`password` when signing up, `newPassword` when changing it). Each becomes one line in the person's language; a rule
 * this app does not know is left out (the header line still says the password was refused).
 */
export function policyMessage(error: ApiError, t: TFunction, name = 'password'): string {
  const lines: string[] = [];
  for (const detail of error.fieldErrors) {
    const [field, rule] = detail.path.split('.');
    if (field !== name) continue;
    switch (rule) {
      case 'min_length': {
        // The server's text is "Use at least N characters.": the number is the only part we need from it.
        const min = Number(/\d+/.exec(detail.message)?.[0]);
        if (Number.isFinite(min) && min > 0) lines.push(t('signUp.passwordMinLength', { min }));
        break;
      }
      case 'upper_lower':
        lines.push(t('signUp.passwordMixedCase'));
        break;
      case 'number':
        lines.push(t('signUp.passwordNumber'));
        break;
      case 'symbol':
        lines.push(t('signUp.passwordSymbol'));
        break;
      case 'common':
        lines.push(t('signUp.errors.policyCommon'));
        break;
    }
  }
  return [t('signUp.errors.passwordPolicy'), ...lines.map((line) => `• ${line}`)].join('\n');
}

export function mapSignUpError(error: unknown, t: TFunction): SignUpFailure {
  const none: SignUpFailure = { banner: null, fields: {}, openSlug: false };
  if (!isApiError(error)) return { ...none, banner: t('errors.generic') };

  switch (error.code) {
    case ERROR_CODES.AUTH_SIGNUP_CLOSED:
      return { ...none, banner: t('signUp.closedBody') };
    case ERROR_CODES.AUTH_CAPTCHA_FAILED:
      return { ...none, banner: t('errors.captchaUnsupported') };
    case ERROR_CODES.AUTH_EMAIL_TAKEN:
      return { ...none, fields: { email: t('signUp.errors.emailTaken') } };
    case ERROR_CODES.AUTH_SLUG_TAKEN:
      return { ...none, fields: { orgSlug: t('signUp.errors.slugTaken') }, openSlug: true };
    case ERROR_CODES.AUTH_PASSWORD_POLICY:
      return { ...none, fields: { password: policyMessage(error, t) } };
    case ERROR_CODES.AUTH_OTP_SEND_FAILED:
      return { ...none, fields: { phone: t('signUp.errors.otpSendFailed') } };
    case ERROR_CODES.VALIDATION_FAILED: {
      const fields: Partial<Record<SignUpField, string>> = {};
      for (const detail of error.fieldErrors) {
        const field = detail.path.split('.')[0] ?? '';
        const key = isField(field) ? FIELD_KEY[field] : null;
        if (isField(field) && key && !fields[field]) fields[field] = t(key);
      }
      return Object.keys(fields).length > 0
        ? { ...none, fields }
        : { ...none, banner: messageForError(error, t) };
    }
    default:
      return { ...none, banner: messageForError(error, t) };
  }
}
