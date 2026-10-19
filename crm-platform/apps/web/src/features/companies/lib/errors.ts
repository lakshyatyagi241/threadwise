import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** What the person is told about a failed call, chosen by error `code`, never by the server's wording. */
export const ERROR_KINDS = [
  'network',
  'forbidden',
  'signedOut',
  'conflict',
  'validation',
  'unavailable',
  'rateLimited',
  'notFound',
  'planDisabled',
  'ownerInvalid',
  'filterInvalid',
  'exportTooLarge',
  'importInvalid',
  'unexpected',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/**
 * What the failed call was asking for. A `NOT_FOUND` answer to one company's call (`record`) means that company is gone; the same
 * code on a call for a collection (`list`: the companies list, the tiles, a search) can only mean the route is not there, which
 * says nothing about any company, so it reads as "not available" and never as "That company no longer exists".
 */
export type ErrorContext = 'record' | 'list';

export function errorKind(error: unknown, context: ErrorContext = 'record'): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.code) {
    case ERROR_CODES.FORBIDDEN:
      return 'forbidden';
    case ERROR_CODES.UNAUTHENTICATED:
      return 'signedOut';
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    case ERROR_CODES.NOT_FOUND:
      return context === 'list' ? 'unavailable' : 'notFound';
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      return 'planDisabled';
    case ERROR_CODES.COMPANY_OWNER_INVALID:
      return 'ownerInvalid';
    case ERROR_CODES.COMPANY_FILTER_INVALID:
      return 'filterInvalid';
    case ERROR_CODES.COMPANY_EXPORT_TOO_LARGE:
      return 'exportTooLarge';
    case ERROR_CODES.COMPANY_IMPORT_INVALID:
      return 'importInvalid';
  }
  // A route that is not deployed answers 404 or 501 without one of our codes for it.
  if (error.status === 404 || error.status === 501) return 'unavailable';
  return 'unexpected';
}

/**
 * Why the server refused a company's custom values, when it did: a required property left empty, a value that does not fit its
 * property, or a property that cannot be edited. Each names its fields as `customFields.<key>` (see `fieldErrors`).
 */
export function propertyErrorKind(error: unknown): 'required' | 'invalid' | 'notEditable' | null {
  if (!(error instanceof ApiError)) return null;
  switch (error.code) {
    case ERROR_CODES.COMPANY_REQUIRED_PROPERTY_MISSING:
      return 'required';
    case ERROR_CODES.COMPANY_PROPERTY_INVALID:
      return 'invalid';
    case ERROR_CODES.COMPANY_PROPERTY_NOT_EDITABLE:
      return 'notEditable';
    default:
      return null;
  }
}

/** The first message the server gave for each field of a refused write, by field path. */
export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(error instanceof ApiError)) return out;
  for (const f of error.fieldErrors) if (!(f.path in out)) out[f.path] = f.message;
  return out;
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;
