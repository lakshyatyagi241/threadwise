import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { ERROR_KINDS, errorKind, isRetryable } from './errors';

const api = (status: number, code: string) => new ApiError(status, code, 'x');

describe('which failures offer "Try again"', () => {
  it('offers it for the network, the server and a limit that lifts', () => {
    expect(isRetryable(errorKind(new Error('offline')))).toBe(true);
    expect(isRetryable(errorKind(api(500, 'INTERNAL')))).toBe(true);
    expect(isRetryable(errorKind(api(429, 'RATE_LIMITED')))).toBe(true);
    expect(isRetryable(errorKind(api(501, 'NOT_IMPLEMENTED')))).toBe(true);
  });

  it('does not offer it when the answer will be the same again', () => {
    expect(errorKind(api(422, 'PLAN_FEATURE_LOCKED'))).toBe('planDisabled');
    expect(isRetryable('planDisabled')).toBe(false);
    expect(isRetryable(errorKind(api(403, 'FORBIDDEN')))).toBe(false);
    expect(isRetryable(errorKind(api(401, 'UNAUTHENTICATED')))).toBe(false);
    expect(isRetryable(errorKind(api(404, 'NOT_FOUND')))).toBe(false);
    expect(isRetryable(errorKind(api(409, 'ROW_VERSION_CONFLICT')))).toBe(false);
    expect(isRetryable(errorKind(api(422, 'VALIDATION_FAILED')))).toBe(false);
  });

  it('decides for every kind', () => {
    for (const kind of ERROR_KINDS) expect(typeof isRetryable(kind)).toBe('boolean');
  });
});
