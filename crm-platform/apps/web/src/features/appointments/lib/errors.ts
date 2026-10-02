import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** What the person is told about a failed call, chosen by error `code` (then by status), never by the server's wording. */
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
  'slotTaken',
  'gone',
  'invalidTransition',
  'notStarted',
  'alreadyStarted',
  'bookingOff',
  'notDeletable',
  'unexpected',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** Codes the appointments API answers a lost race for a time with (a taken slot, a full shared slot, a closed day). */
const SLOT_CODES: ReadonlySet<string> = new Set([
  ERROR_CODES.APPT_SLOT_TAKEN,
  ERROR_CODES.APPT_SLOT_UNAVAILABLE,
  ERROR_CODES.SLOT_CAPACITY_FULL,
]);

export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  if (SLOT_CODES.has(error.code)) return 'slotTaken';
  switch (error.code) {
    case ERROR_CODES.APPT_INVALID_TRANSITION:
      return 'invalidTransition';
    case ERROR_CODES.APPT_NOT_STARTED:
      return 'notStarted';
    case ERROR_CODES.APPT_ALREADY_STARTED:
      return 'alreadyStarted';
    case ERROR_CODES.APPT_LINK_UNAVAILABLE:
      return 'gone';
    case ERROR_CODES.APPT_BOOKING_UNAVAILABLE:
    case ERROR_CODES.APPT_TYPE_UNAVAILABLE:
      return 'bookingOff';
    case ERROR_CODES.APPT_NOT_DELETABLE:
      return 'notDeletable';
    case ERROR_CODES.APPT_ANSWERS_INVALID:
    case ERROR_CODES.APPT_HOST_INVALID:
    case ERROR_CODES.APPT_AMOUNT_INVALID:
      return 'validation';
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
      return 'planDisabled';
  }
  // WaDesk answers a booking that can no longer change (cancelled, completed, no-show) with 410.
  if (error.status === 410) return 'gone';
  if (error.status === 429) return 'rateLimited';
  if (error.status === 404 || error.status === 501)
    return error.code === 'NOT_FOUND' ? 'notFound' : 'unavailable';
  return 'unexpected';
}

/** The appointments routes are not deployed on this server: not a failure of the screen itself. */
export const isUnavailable = (error: unknown): boolean => errorKind(error) === 'unavailable';

export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(error instanceof ApiError)) return out;
  for (const f of error.fieldErrors) if (!(f.path in out)) out[f.path] = f.message;
  return out;
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;
