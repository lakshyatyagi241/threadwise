import { ERROR_CODES, BRIEF_SECTION_KEYS, type BriefSectionKey } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/**
 * What the brief card says about a failed call, chosen by error `code`, never by the server's wording. `unavailable` is the state with
 * no AI key (also known beforehand from the state call); the rest are shown where the button is.
 */
export type BriefErrorKind =
  | 'unavailable'
  | 'tooSoon'
  | 'providerFailed'
  | 'limit'
  | 'forbidden'
  | 'notFound'
  | 'network'
  | 'unexpected';

export function briefErrorKind(error: unknown): BriefErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.code) {
    case ERROR_CODES.COMPANY_BRIEF_AI_UNAVAILABLE:
      return 'unavailable';
    case ERROR_CODES.COMPANY_BRIEF_RATE_LIMITED:
      return 'tooSoon';
    case ERROR_CODES.COMPANY_BRIEF_PROVIDER_FAILED:
      return 'providerFailed';
    case ERROR_CODES.FORBIDDEN:
      return 'forbidden';
    case ERROR_CODES.NOT_FOUND:
      return 'notFound';
    // The platform key's monthly allowance, or the per-person limit on how many briefs an hour.
    case ERROR_CODES.RATE_LIMITED:
    case ERROR_CODES.PLAN_LIMIT_REACHED:
      return 'limit';
  }
  return 'unexpected';
}

export const BRIEF_ERROR_KINDS: readonly BriefErrorKind[] = [
  'unavailable',
  'tooSoon',
  'providerFailed',
  'limit',
  'forbidden',
  'notFound',
  'network',
  'unexpected',
];

export const SECTION_KEYS: readonly BriefSectionKey[] = BRIEF_SECTION_KEYS;

/** The kinds of records a brief was written from, in the order the notice lists them. */
export const SOURCE_KEYS = ['properties', 'contacts', 'deals', 'tasks', 'conversations'] as const;
