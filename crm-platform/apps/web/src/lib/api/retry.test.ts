import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import { transientRetry, transientRetryDelay } from './retry';

const err = (status: number) => new ApiError(status, 'X', 'message');

describe('transientRetry', () => {
  it('retries a network error, an unreadable answer and a 5xx, up to four times', () => {
    expect(transientRetry(0, new TypeError('fetch failed'))).toBe(true);
    expect(transientRetry(0, new SyntaxError('Unexpected token <'))).toBe(true);
    expect(transientRetry(3, err(503))).toBe(true);
    expect(transientRetry(4, err(503))).toBe(false);
  });
  it("never retries the server's own 4xx answer", () => {
    for (const s of [400, 401, 403, 404, 409, 422, 429])
      expect(transientRetry(0, err(s))).toBe(false);
  });
  it('waits 1, 2, 4, then 8 seconds at most', () => {
    expect([0, 1, 2, 3, 4, 9].map(transientRetryDelay)).toEqual([
      1000, 2000, 4000, 8000, 8000, 8000,
    ]);
  });
});
