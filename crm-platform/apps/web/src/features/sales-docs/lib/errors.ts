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
  'invalidTransition',
  'notEditable',
  'notDeletable',
  'alreadyDecided',
  'alreadyConverted',
  'alreadyLinkedDeal',
  'linkUnavailable',
  'noRecipient',
  'sendFailed',
  'expired',
  'ownerInvalid',
  'invoicingUnavailable',
  'unexpected',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/**
 * Trying the same call again can only help when the failure was the network, the server or a limit that lifts: a plan that lacks
 * the feature, a missing permission, a document that is not there or a sign-in that ended answer the same every time, so the
 * panel does not offer the button for them.
 */
export const isRetryable = (kind: ErrorKind): boolean =>
  kind === 'network' || kind === 'unavailable' || kind === 'rateLimited' || kind === 'unexpected';

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
    case ERROR_CODES.SALESDOC_AMOUNT_INVALID:
      return 'validation';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    case ERROR_CODES.NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      return 'planDisabled';
    case ERROR_CODES.SALESDOC_INVALID_TRANSITION:
      return 'invalidTransition';
    case ERROR_CODES.SALESDOC_NOT_EDITABLE:
      return 'notEditable';
    case ERROR_CODES.SALESDOC_NOT_DELETABLE:
      return 'notDeletable';
    case ERROR_CODES.SALESDOC_ALREADY_DECIDED:
      return 'alreadyDecided';
    case ERROR_CODES.SALESDOC_ALREADY_CONVERTED:
      return 'alreadyConverted';
    case ERROR_CODES.SALESDOC_ALREADY_LINKED_DEAL:
      return 'alreadyLinkedDeal';
    case ERROR_CODES.SALESDOC_LINK_UNAVAILABLE:
      return 'linkUnavailable';
    case ERROR_CODES.SALESDOC_NO_RECIPIENT:
      return 'noRecipient';
    case ERROR_CODES.SALESDOC_SEND_FAILED:
      return 'sendFailed';
    case ERROR_CODES.SALESDOC_EXPIRED:
      return 'expired';
    case ERROR_CODES.SALESDOC_OWNER_INVALID:
      return 'ownerInvalid';
    case ERROR_CODES.SALESDOC_INVOICING_UNAVAILABLE:
      return 'invoicingUnavailable';
  }
  // A route that is not deployed answers 404 or 501 without one of our codes for it.
  if (error.status === 404 || error.status === 501) return 'unavailable';
  return 'unexpected';
}

export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(error instanceof ApiError)) return out;
  for (const f of error.fieldErrors) if (!(f.path in out)) out[f.path] = f.message;
  return out;
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;

/** The sales-docs routes are not deployed on this server: not a failure of this screen. */
export const isUnavailable = (error: unknown): boolean => errorKind(error) === 'unavailable';
