import { ApiError } from '@/lib/api/errors';

/** The message key (under `...affiliate.errors`) for a failure: by status, never by the wording. */
export const ERROR_KINDS = ['forbidden', 'network', 'generic'] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export function errorKind(err: unknown): ErrorKind {
  if (!(err instanceof ApiError)) return 'network';
  return err.status === 403 ? 'forbidden' : 'generic';
}

export const requestIdOf = (err: unknown): string | undefined =>
  err instanceof ApiError ? err.requestId : undefined;
