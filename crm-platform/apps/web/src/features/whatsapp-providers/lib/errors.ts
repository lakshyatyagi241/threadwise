import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export type WapErrorKind =
  /** Someone else saved the provider first: offer a reload, never a blind retry. */
  | 'conflict'
  /** The operator lacks the platform permission the route demands. */
  | 'noAccess'
  /** Belongs to one input of a form. */
  | 'field'
  | 'general';

export interface WapError {
  kind: WapErrorKind;
  /** Message key under `whatsapp-providers.errors`. */
  key: string;
  /** The form field it belongs to (`key`, `baseUrl`, `headerTemplates`, `credentials.providerToken`, ...). */
  field?: string;
  /** ICU values for the message (`permission`, `detail`, `message`). */
  values?: Record<string, string>;
  requestId?: string;
}

/**
 * Branches on the problem+json `code`, never on its message text. The only server text shown is the reason of a refused base URL
 * (its field error) and a validation message; the API writes both without secrets.
 */
export function wapError(err: unknown): WapError {
  if (!(err instanceof ApiError)) return { kind: 'general', key: 'unexpected' };
  const requestId = err.requestId;
  const first = err.fieldErrors[0];
  switch (err.code) {
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return { kind: 'conflict', key: 'conflict', requestId };
    case ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED:
      return {
        kind: 'noAccess',
        key: 'noAccess',
        values: { permission: first?.message ?? '' },
        requestId,
      };
    case ERROR_CODES.WAP_PROVIDER_KEY_TAKEN:
      return { kind: 'field', key: 'keyTaken', field: 'key', requestId };
    case ERROR_CODES.WAP_BASE_URL_REFUSED:
      return {
        kind: 'field',
        key: first?.message ? 'baseUrlRefused' : 'baseUrlRefusedPlain',
        field: 'baseUrl',
        values: { detail: first?.message ?? '' },
        requestId,
      };
    case ERROR_CODES.WAP_PROVIDER_IN_USE:
      return { kind: 'general', key: 'inUse', requestId };
    case ERROR_CODES.WAP_PROVIDER_DISABLED:
      return { kind: 'general', key: 'disabled', requestId };
    case ERROR_CODES.WAP_CREDENTIALS_MISSING:
      return { kind: 'general', key: 'credentialsMissing', requestId };
    case ERROR_CODES.WAP_PROVIDER_IS_DEFAULT:
      return { kind: 'general', key: 'isDefault', requestId };
    case ERROR_CODES.WAP_PROVIDER_BUILTIN:
      return { kind: 'general', key: 'builtin', requestId };
    case ERROR_CODES.WAP_SWITCH_NOTHING_TO_DO:
      return { kind: 'general', key: 'nothingToDo', requestId };
    case ERROR_CODES.PROVIDER_UNAVAILABLE:
      return { kind: 'general', key: 'unavailable', requestId };
    case ERROR_CODES.NOT_FOUND:
      return { kind: 'general', key: 'notFound', requestId };
    case ERROR_CODES.VALIDATION_FAILED: {
      if (first?.path === 'numberIds') {
        return { kind: 'field', key: 'tooManyNumbers', field: 'numberIds', requestId };
      }
      if (first?.path) {
        return {
          kind: 'field',
          key: 'validationField',
          field: first.path,
          values: { message: first.message },
          requestId,
        };
      }
      return { kind: 'general', key: 'validation', requestId };
    }
    default:
      return { kind: 'general', key: err.status >= 500 ? 'unexpected' : 'request', requestId };
  }
}

/** True when the failure is "this operator may not use this screen". */
export const isNoAccess = (err: unknown): boolean =>
  err instanceof ApiError &&
  (err.code === ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED ||
    (err.status === 403 && err.code === ERROR_CODES.FORBIDDEN));

/** Every key `wapError` can answer, so the messages test can prove each one has text in every language. */
export const WAP_ERROR_KEYS = [
  'conflict',
  'noAccess',
  'keyTaken',
  'baseUrlRefused',
  'baseUrlRefusedPlain',
  'inUse',
  'disabled',
  'credentialsMissing',
  'isDefault',
  'builtin',
  'nothingToDo',
  'unavailable',
  'notFound',
  'tooManyNumbers',
  'validationField',
  'validation',
  'request',
  'unexpected',
] as const;
