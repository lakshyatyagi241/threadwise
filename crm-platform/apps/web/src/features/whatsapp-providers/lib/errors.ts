import { ApiError } from '@/lib/api/errors';

/**
 * The message key (under `whatsapp-providers.errors`) for an API failure. Branches on the stable problem+json `code`, then on the
 * status for the two classes every endpoint shares (409 and 422); never on the wording.
 */
export const ERROR_KINDS = [
  'conflict',
  'keyTaken',
  'inUse',
  'isDefault',
  'disabledProvider',
  'baseUrlRefused',
  'headerInvalid',
  'secretsMissing',
  'presetUnknown',
  'unavailable',
  'notFound',
  'validation',
  'forbidden',
  'rateLimited',
  'generic',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

const BY_CODE: Record<string, ErrorKind> = {
  ROW_VERSION_CONFLICT: 'conflict',
  WAP_PROVIDER_KEY_TAKEN: 'keyTaken',
  WAP_PROVIDER_IN_USE: 'inUse',
  WAP_PROVIDER_IS_DEFAULT: 'isDefault',
  WAP_PROVIDER_DISABLED: 'disabledProvider',
  WAP_BASE_URL_REFUSED: 'baseUrlRefused',
  WAP_HEADER_TEMPLATE_INVALID: 'headerInvalid',
  WAP_CREDENTIALS_MISSING: 'secretsMissing',
  WAP_PRESET_UNKNOWN: 'presetUnknown',
  PROVIDER_UNAVAILABLE: 'unavailable',
  VALIDATION_FAILED: 'validation',
  AUTH_OPERATOR_ROLE_REQUIRED: 'forbidden',
  RATE_LIMITED: 'rateLimited',
};

export interface ErrorView {
  kind: ErrorKind;
  /** Field paths the API rejected, so the form can mark the inputs. */
  fields: string[];
}

export function errorView(err: unknown): ErrorView {
  if (!(err instanceof ApiError)) return { kind: 'generic', fields: [] };
  const fields = err.fieldErrors.map((f) => f.path);
  const byCode = BY_CODE[err.code];
  if (byCode) return { kind: byCode, fields };
  if (err.status === 409) return { kind: 'conflict', fields };
  if (err.status === 422) return { kind: 'validation', fields };
  if (err.status === 403) return { kind: 'forbidden', fields };
  if (err.status === 404) return { kind: 'notFound', fields };
  if (err.status === 429) return { kind: 'rateLimited', fields };
  return { kind: 'generic', fields };
}

/** A 409 that means "someone else changed it": reload, never retry with the new version. */
export const isStale = (err: unknown): boolean =>
  err instanceof ApiError && (err.isRowVersionConflict || err.code === 'ROW_VERSION_CONFLICT');

/** The server's field messages by path (`errors[].path`), first wins. */
export function serverFieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (err instanceof ApiError)
    for (const f of err.fieldErrors) if (!(f.path in out)) out[f.path] = f.message;
  return out;
}

/**
 * How a failed connection test is classified for the screen. The API returns a stable class in `code`; an unknown one is shown
 * as `unknown` with the request id, never as raw upstream text.
 */
export const TEST_FAILURE_KINDS = [
  'auth',
  'notFound',
  'unreachable',
  'timeout',
  'tls',
  'rateLimited',
  'badResponse',
  'unknown',
] as const;
export type TestFailureKind = (typeof TEST_FAILURE_KINDS)[number];

const TEST_BY_CODE: Record<string, TestFailureKind> = {
  auth_failed: 'auth',
  unauthorized: 'auth',
  forbidden: 'auth',
  not_found: 'notFound',
  waba_not_found: 'notFound',
  phone_not_found: 'notFound',
  unreachable: 'unreachable',
  dns: 'unreachable',
  connection_refused: 'unreachable',
  timeout: 'timeout',
  tls: 'tls',
  rate_limited: 'rateLimited',
  bad_response: 'badResponse',
};

export function testFailureKind(code: string | null | undefined): TestFailureKind {
  return (code && TEST_BY_CODE[code]) || 'unknown';
}
