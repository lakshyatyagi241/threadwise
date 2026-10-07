import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export type WizardErrorKind = 'network' | 'forbidden' | 'notFound' | 'rateLimited' | 'unexpected';

/** What a failed call tells the person, chosen by the problem's `code` and never by its wording. */
export function errorKind(e: unknown): WizardErrorKind {
  if (!(e instanceof ApiError)) return 'network';
  switch (e.code) {
    case ERROR_CODES.FORBIDDEN:
      return 'forbidden';
    case ERROR_CODES.NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    default:
      return 'unexpected';
  }
}

export const requestIdOf = (e: unknown): string | undefined =>
  e instanceof ApiError ? e.requestId : undefined;
