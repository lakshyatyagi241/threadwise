import { HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { ProblemExceptionFilter } from '../../../src/common/filters/problem-exception.filter';

vi.mock('../../../src/modules/platform-infrastructure', () => ({ reportServerError: vi.fn() }));

/** Runs the filter with a response that records its headers. `preset` is a header a limiter already set. */
function run(exception: unknown, preset: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...preset };
  const response = {
    status: () => response,
    type: () => response,
    send: () => undefined,
    getHeader: (k: string) => headers[k],
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/v2/auth/login' }),
    }),
  } as unknown as ArgumentsHost;
  new ProblemExceptionFilter().catch(exception, host);
  return headers;
}

const limited = (wait?: string) =>
  new AppError(
    ERROR_CODES.RATE_LIMITED,
    'Too many attempts. Slow down.',
    HttpStatus.TOO_MANY_REQUESTS,
    wait === undefined ? undefined : [{ path: 'retryAfterSeconds', message: wait }],
  );

describe('a 429 tells a header-only client how long to wait', () => {
  it('copies the wait the body names into Retry-After', () => {
    expect(run(limited('297'))['Retry-After']).toBe('297');
  });
  it('keeps the value a limiter already set', () => {
    expect(run(limited('297'), { 'Retry-After': '12' })['Retry-After']).toBe('12');
  });
  it('sets nothing when the body names no wait, or one that is not a whole number of seconds', () => {
    expect(run(limited())['Retry-After']).toBeUndefined();
    expect(run(limited('soon'))['Retry-After']).toBeUndefined();
    expect(run(limited('0'))['Retry-After']).toBeUndefined();
    expect(run(limited('-5'))['Retry-After']).toBeUndefined();
    expect(run(limited('1.5'))['Retry-After']).toBeUndefined();
  });
  it('does not touch the header of any other status', () => {
    const other = new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'x',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'retryAfterSeconds', message: '30' }],
    );
    expect(run(other)['Retry-After']).toBeUndefined();
  });
});
