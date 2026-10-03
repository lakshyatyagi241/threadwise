import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** What the person is told about a failed call, chosen by problem `code`, never by the server's wording. */
export const ERROR_KINDS = [
  'network',
  'forbidden',
  'signedOut',
  'conflict',
  'validation',
  'unavailable',
  'rateLimited',
  'notFound',
  'planLocked',
  'planLimit',
  'wallet',
  'sendBlocked',
  'notConnected',
  'metaRejected',
  'noWaba',
  'wabaToken',
  'noCatalogLinked',
  'noRecipients',
  'tooManyRecipients',
  'noProducts',
  'noSender',
  'sendFailed',
  'collectionProducts',
  'providerFailed',
  'unexpected',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export function errorKind(error: unknown): ErrorKind {
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
      return 'notFound';
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      return 'planLocked';
    case ERROR_CODES.PLAN_LIMIT_REACHED:
      return 'planLimit';
    case ERROR_CODES.WALLET_INSUFFICIENT_FUNDS:
    case ERROR_CODES.WALLET_INACTIVE:
      return 'wallet';
    case ERROR_CODES.AUTH_SEND_HALTED:
    case ERROR_CODES.AUTH_SEND_BLOCKED:
      return 'sendBlocked';
    case ERROR_CODES.CAT_NOT_CONNECTED:
      return 'notConnected';
    case ERROR_CODES.CAT_META_REJECTED:
      return 'metaRejected';
    case ERROR_CODES.CAT_NO_WABA:
      return 'noWaba';
    case ERROR_CODES.CAT_WABA_TOKEN_MISSING:
      return 'wabaToken';
    case ERROR_CODES.CAT_NO_CATALOG_LINKED:
      return 'noCatalogLinked';
    case ERROR_CODES.CAT_NO_RECIPIENTS:
      return 'noRecipients';
    case ERROR_CODES.CAT_TOO_MANY_RECIPIENTS:
      return 'tooManyRecipients';
    case ERROR_CODES.CAT_NO_PRODUCTS:
      return 'noProducts';
    case ERROR_CODES.CAT_NO_SENDER:
      return 'noSender';
    case ERROR_CODES.CAT_SEND_FAILED:
      return 'sendFailed';
    case ERROR_CODES.CAT_COLLECTION_PRODUCTS_INVALID:
      return 'collectionProducts';
    case ERROR_CODES.CAT_PROVIDER_FAILED:
      return 'providerFailed';
  }
  // A route that is not deployed answers 404 or 501 without one of our codes for it.
  if (error.status === 404 || error.status === 501) return 'unavailable';
  return 'unexpected';
}

/** Kinds whose problem detail carries text the person needs (Meta's own message and hint, the provider's reason). */
const WITH_DETAIL: ReadonlySet<ErrorKind> = new Set<ErrorKind>([
  'metaRejected',
  'providerFailed',
  'sendFailed',
  'sendBlocked',
]);

/** The problem's detail for the kinds that show it; empty for every other kind. */
export function errorDetail(error: unknown): string {
  if (!(error instanceof ApiError)) return '';
  return WITH_DETAIL.has(errorKind(error)) ? error.message : '';
}

export const isPlanLocked = (error: unknown): boolean => errorKind(error) === 'planLocked';
export const isRowVersionConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.isRowVersionConflict;
/** The routes are not deployed on this server: not a failure of the screen itself. */
export const isUnavailable = (error: unknown): boolean => errorKind(error) === 'unavailable';

export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(error instanceof ApiError)) return out;
  for (const f of error.fieldErrors) if (!(f.path in out)) out[f.path] = f.message;
  return out;
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;
