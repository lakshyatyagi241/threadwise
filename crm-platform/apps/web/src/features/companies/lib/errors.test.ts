import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { errorKind } from './errors';

const api = (status: number, code: string) => new ApiError(status, code, 'x');

describe('errorKind (what a failed call says)', () => {
  it('a company that is gone is "notFound" for one company, and never for a list', () => {
    const gone = api(404, ERROR_CODES.NOT_FOUND);
    expect(errorKind(gone)).toBe('notFound');
    expect(errorKind(gone, 'record')).toBe('notFound');
    expect(errorKind(gone, 'list')).toBe('unavailable');
  });

  it('a route that is not there (404/501 with no code of ours) is "unavailable" in both contexts', () => {
    for (const status of [404, 501]) {
      expect(errorKind(api(status, 'UNKNOWN'))).toBe('unavailable');
      expect(errorKind(api(status, 'UNKNOWN'), 'list')).toBe('unavailable');
    }
  });

  it('a 5xx and a lost connection are not "not found" in either context', () => {
    expect(errorKind(api(500, 'INTERNAL'), 'list')).toBe('unexpected');
    expect(errorKind(api(503, 'INTERNAL'))).toBe('unexpected');
    expect(errorKind(new TypeError('Failed to fetch'), 'list')).toBe('network');
    expect(errorKind(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('the other codes read the same in both contexts', () => {
    for (const [status, code, kind] of [
      [403, ERROR_CODES.FORBIDDEN, 'forbidden'],
      [401, ERROR_CODES.UNAUTHENTICATED, 'signedOut'],
      [429, ERROR_CODES.RATE_LIMITED, 'rateLimited'],
      [422, ERROR_CODES.PLAN_FEATURE_LOCKED, 'planDisabled'],
    ] as const) {
      expect(errorKind(api(status, code), 'list')).toBe(kind);
      expect(errorKind(api(status, code), 'record')).toBe(kind);
    }
  });
});
