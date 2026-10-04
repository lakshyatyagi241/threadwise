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
  'noShop',
  'slugTaken',
  'deviceInvalid',
  'noSender',
  'resetNotConfirmed',
  'domainNotSet',
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
    case ERROR_CODES.STORE_NO_SHOP:
      return 'noShop';
    case ERROR_CODES.STORE_SLUG_TAKEN:
      return 'slugTaken';
    case ERROR_CODES.STORE_DEVICE_INVALID:
      return 'deviceInvalid';
    case ERROR_CODES.STORE_NO_SENDER:
      return 'noSender';
    case ERROR_CODES.STORE_RESET_NOT_CONFIRMED:
      return 'resetNotConfirmed';
    case ERROR_CODES.STORE_DOMAIN_NOT_SET:
      return 'domainNotSet';
  }
  // A route that is not deployed answers 404 or 501 without one of our codes for it.
  if (error.status === 404 || error.status === 501) return 'unavailable';
  return 'unexpected';
}

/** The server's per-field messages by field name (`slug`, `customDomain`, ...). The first message of a field wins. */
export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(error instanceof ApiError)) return out;
  for (const f of error.fieldErrors) {
    const key = f.path.replace(/^body\./, '');
    if (!(key in out)) out[key] = f.message;
  }
  return out;
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;

/** The store has no shop yet: the dashboard and the settings page send the person to the shop wizard. */
export const isNoShop = (error: unknown): boolean => errorKind(error) === 'noShop';
