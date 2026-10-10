import { ApiError, CLIENT_ERROR_CODES } from './errors';
import { transientRetry, transientRetryDelay } from './retry';

describe('transientRetry', () => {
  it('retries network failures and 5xx, up to four times', () => {
    expect(transientRetry(0, new ApiError(0, CLIENT_ERROR_CODES.NETWORK, 'x'))).toBe(true);
    expect(transientRetry(0, new ApiError(503, 'INTERNAL', 'x'))).toBe(true);
    expect(transientRetry(3, new ApiError(503, 'INTERNAL', 'x'))).toBe(true);
    expect(transientRetry(4, new ApiError(503, 'INTERNAL', 'x'))).toBe(false);
  });

  it('never retries a 4xx: that is the server’s answer', () => {
    expect(transientRetry(0, new ApiError(404, 'NOT_FOUND', 'x'))).toBe(false);
    expect(transientRetry(0, new ApiError(429, 'RATE_LIMITED', 'x'))).toBe(false);
  });

  it('backs off 1, 2, 4, 8 seconds and stops growing', () => {
    expect([0, 1, 2, 3, 4, 9].map(transientRetryDelay)).toEqual([
      1000, 2000, 4000, 8000, 8000, 8000,
    ]);
  });
});
