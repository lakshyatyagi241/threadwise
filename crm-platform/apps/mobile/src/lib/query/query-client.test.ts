import { ApiError, CLIENT_ERROR_CODES } from '@/lib/api/errors';
import { createQueryClient, isRetryable } from './query-client';

describe('createQueryClient', () => {
  it('retries reads only for transient failures and never retries a mutation', () => {
    const defaults = createQueryClient().getDefaultOptions();
    const retry = defaults.queries?.retry as (failures: number, error: unknown) => boolean;
    expect(retry(0, new ApiError(503, 'INTERNAL', 'x'))).toBe(true);
    expect(retry(0, new ApiError(404, 'NOT_FOUND', 'x'))).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
  });
});

describe('isRetryable', () => {
  it('is true for connectivity failures and server errors, false for the server’s answers', () => {
    expect(isRetryable(new ApiError(0, CLIENT_ERROR_CODES.NETWORK, 'x'))).toBe(true);
    expect(isRetryable(new ApiError(502, 'INTERNAL', 'x'))).toBe(true);
    expect(isRetryable(new ApiError(403, 'RBAC_FORBIDDEN', 'x'))).toBe(false);
    expect(isRetryable(new Error('boom'))).toBe(false);
  });
});
