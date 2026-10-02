import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { wholeMinutes } from './countdown';

/**
 * Turns an API/BFF failure into something a guest form can show: a message key under
 * `auth-registration-security.guest.errors`, optional ICU params, and per-field messages.
 * Branches on the stable `code` and the HTTP status, never on message text (frontend-api-call skill).
 */
/** One broken password rule: the server's rule id (`min_length`, ...) when it sent one, and its English text. */
export interface PolicyIssue {
  rule: string | null;
  message: string;
}

/** Rules we have localised texts for (`errors.policyRules.<rule>`). */
export const POLICY_RULES = ['min_length', 'upper_lower', 'number', 'symbol', 'common'] as const;

/**
 * How to show a broken rule in the visitor's language: the message key under `errors.policyRules` and its
 * parameters, or null to show the server's text (unknown rule, or a length rule whose number cannot be read).
 */
export function policyMessage(
  issue: PolicyIssue,
): { key: (typeof POLICY_RULES)[number]; params?: { min: number } } | null {
  const rule = POLICY_RULES.find((r) => r === issue.rule);
  if (!rule) return null;
  if (rule !== 'min_length') return { key: rule };
  // The server text is "Use at least N characters.": the number is the only part we need from it.
  const min = Number(/\d+/.exec(issue.message)?.[0]);
  return Number.isFinite(min) && min > 0 ? { key: rule, params: { min } } : null;
}

export interface MappedError {
  /** Key under `auth-registration-security.guest.errors`. */
  key: string;
  params?: Record<string, number | string>;
  /** Input the message belongs to, when the server named one. */
  field?: string;
  /** Server messages per top-level field name (policy rules, validation details). */
  fieldErrors: Record<string, string[]>;
  /** Seconds until the caller may retry (lockout, throttles). */
  retryAfterSeconds?: number;
  /** Shown for unexpected failures so support can find the log line. */
  requestId?: string;
  /** The password policy list: one entry per broken rule. */
  policy: PolicyIssue[];
  /** The page sat open until its session lapsed: say so kindly and let the visitor press the button again. */
  stale: boolean;
}

/** Network failure before any HTTP response arrived. */
export const NETWORK_CODE = 'NETWORK';

export function networkError(): ApiError {
  return new ApiError(0, NETWORK_CODE, 'Network error');
}

/** The v2 checkbox was not ticked: same wording as a refusal from the server, without a round trip. */
export function captchaMissing(): ApiError {
  return new ApiError(400, ERROR_CODES.AUTH_CAPTCHA_FAILED, 'Captcha required');
}

const BY_CODE: Record<string, { key: string; field?: string }> = {
  [ERROR_CODES.AUTH_INVALID_CREDENTIALS]: { key: 'invalidCredentials' },
  [ERROR_CODES.AUTH_ACCOUNT_SUSPENDED]: { key: 'suspended' },
  [ERROR_CODES.AUTH_CAPTCHA_FAILED]: { key: 'captcha' },
  [ERROR_CODES.AUTH_SIGNUP_CLOSED]: { key: 'signupClosed' },
  [ERROR_CODES.AUTH_SLUG_TAKEN]: { key: 'slugTaken', field: 'orgSlug' },
  [ERROR_CODES.AUTH_EMAIL_TAKEN]: { key: 'emailTaken', field: 'email' },
  [ERROR_CODES.AUTH_TOKEN_INVALID]: { key: 'tokenInvalid' },
  [ERROR_CODES.AUTH_EMAIL_UNVERIFIED]: { key: 'emailUnverified' },
  [ERROR_CODES.AUTH_MFA_INVALID_CODE]: { key: 'mfaInvalid', field: 'code' },
  [ERROR_CODES.AUTH_MFA_CHALLENGE_EXPIRED]: { key: 'mfaExpired' },
  [ERROR_CODES.AUTH_OTP_INVALID]: { key: 'otpInvalid', field: 'code' },
  [ERROR_CODES.AUTH_OTP_EXPIRED]: { key: 'otpExpired', field: 'code' },
  [ERROR_CODES.AUTH_SIGNUP_EXPIRED]: { key: 'signupExpired' },
  [ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS]: { key: 'otpTooMany', field: 'code' },
  [ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN]: { key: 'otpCooldown' },
  [ERROR_CODES.AUTH_OTP_SEND_FAILED]: { key: 'otpSendFailed', field: 'phone' },
  [ERROR_CODES.AUTH_SOCIAL_UNAVAILABLE]: { key: 'socialUnavailable' },
  [ERROR_CODES.AUTH_SOCIAL_STATE_INVALID]: { key: 'socialExpired' },
  [ERROR_CODES.AUTH_SOCIAL_FAILED]: { key: 'socialFailed' },
  [ERROR_CODES.AUTH_SOCIAL_NO_EMAIL]: { key: 'socialNoEmail' },
  [ERROR_CODES.AUTH_SOCIAL_NO_ACCOUNT]: { key: 'socialNoAccount' },
  [ERROR_CODES.AUTH_IP_BLOCKED]: { key: 'ipBlocked' },
  [ERROR_CODES.AUTH_WORKSPACE_NOT_AVAILABLE]: { key: 'workspaceUnavailable' },
};

function retryAfter(err: ApiError): number | undefined {
  const entry = err.fieldErrors.find((e) => e.path === 'retryAfterSeconds');
  const n = entry ? Number(entry.message) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;
}

/** Top-level field name of a server path: `extra.login.x` -> `extra`, `password` -> `password`. */
function topField(path: string): string {
  return path.split('.')[0] ?? path;
}

/**
 * Policy details arrive as `password.<rule>` (sign-up, reset) or `newPassword.<rule>` (change password);
 * an older server sends the bare field with no rule, which falls back to the server's text.
 */
function policyIssues(err: ApiError): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  for (const e of err.fieldErrors) {
    const [field, rule] = e.path.split('.');
    if (field !== 'password' && field !== 'newPassword') continue;
    issues.push({ rule: rule ?? null, message: e.message });
  }
  return issues;
}

export function mapAuthError(error: unknown): MappedError {
  const err =
    error instanceof ApiError
      ? error
      : new ApiError(0, NETWORK_CODE, error instanceof Error ? error.message : 'Network error');

  const fieldErrors: Record<string, string[]> = {};
  for (const e of err.fieldErrors) {
    if (e.path === 'retryAfterSeconds') continue;
    const field = topField(e.path);
    (fieldErrors[field] ??= []).push(e.message);
  }
  const base = {
    fieldErrors,
    requestId: err.requestId,
    policy: [] as PolicyIssue[],
    stale: false,
  };

  if (err.code === NETWORK_CODE || err.status === 0) return { ...base, key: 'network' };

  if (err.code === ERROR_CODES.AUTH_PASSWORD_POLICY) {
    return {
      ...base,
      key: 'passwordPolicy',
      field: 'password',
      policy: policyIssues(err),
    };
  }

  if (err.code === ERROR_CODES.AUTH_ACCOUNT_LOCKED) {
    const seconds = retryAfter(err);
    return {
      ...base,
      key: 'locked',
      params: { minutes: wholeMinutes(seconds ?? 60) },
      retryAfterSeconds: seconds,
    };
  }

  // Specific codes first: the one-time-code limits are 429s too, but have their own wording.
  const known = BY_CODE[err.code];
  if (known) {
    return { ...base, key: known.key, field: known.field, retryAfterSeconds: retryAfter(err) };
  }

  if (err.code === ERROR_CODES.RATE_LIMITED || err.status === 429) {
    const seconds = retryAfter(err);
    return seconds
      ? { ...base, key: 'rateLimitedWait', params: { seconds }, retryAfterSeconds: seconds }
      : { ...base, key: 'rateLimited' };
  }

  if (err.code === ERROR_CODES.VALIDATION_FAILED || err.status === 422) {
    const first = Object.keys(fieldErrors)[0];
    return { ...base, key: 'validation', field: first };
  }

  // The page outlived its session (or the token behind it): a friendly note, and the form stays as typed so
  // the visitor presses the button again. WaDesk's expired-page answer was the same.
  if (err.status === 419 || err.status === 401) {
    return { ...base, key: 'sessionExpired', stale: true };
  }

  // A refused request is not an expired one: the cross-site guard and permission checks answer 403.
  if (err.status === 403 || err.code === ERROR_CODES.FORBIDDEN) {
    return { ...base, key: 'forbidden' };
  }

  return { ...base, key: 'unexpected' };
}

/** Errors whose request id helps support (everything we cannot explain to the visitor). */
export function showsRequestId(mapped: MappedError): boolean {
  return mapped.key === 'unexpected' && Boolean(mapped.requestId);
}
