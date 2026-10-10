import { ApiError, CLIENT_ERROR_CODES, retryAfterFromHeader, toApiError } from './errors';

const problem = (over: Record<string, unknown> = {}) => ({
  type: 'about:blank',
  title: 'Unauthorized',
  status: 401,
  code: 'AUTH_INVALID_CREDENTIALS',
  ...over,
});

describe('toApiError', () => {
  it('reads code, detail, request id and field errors from a problem+json body', () => {
    const e = toApiError(
      422,
      problem({
        status: 422,
        detail: 'Bad field',
        requestId: 'req-1',
        errors: [{ path: 'email', message: 'invalid' }],
      }),
    );
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(e.message).toBe('Bad field');
    expect(e.requestId).toBe('req-1');
    expect(e.fieldErrors).toEqual([{ path: 'email', message: 'invalid' }]);
  });

  it('falls back to the response header for the request id', () => {
    expect(toApiError(400, problem(), 'from-header').requestId).toBe('from-header');
  });

  it('maps a non-problem 5xx body to INTERNAL and a non-problem 4xx to UNKNOWN', () => {
    expect(toApiError(502, '<html>').code).toBe('INTERNAL');
    expect(toApiError(404, undefined).code).toBe('UNKNOWN');
  });

  it('adds Retry-After to a 429 as retryAfterSeconds', () => {
    const e = toApiError(429, problem({ status: 429, code: 'RATE_LIMITED' }), null, '12');
    expect(e.retryAfterSeconds).toBe(12);
  });

  it('keeps the body’s own retryAfterSeconds over the header', () => {
    const e = toApiError(
      429,
      problem({ status: 429, errors: [{ path: 'retryAfterSeconds', message: '5' }] }),
      null,
      '99',
    );
    expect(e.retryAfterSeconds).toBe(5);
  });
});

describe('ApiError helpers', () => {
  it('recognises a row-version conflict', () => {
    expect(new ApiError(409, 'ROW_VERSION_CONFLICT', 'x').isRowVersionConflict).toBe(true);
    expect(new ApiError(409, 'OTHER', 'x').isRowVersionConflict).toBe(false);
  });

  it('recognises an idle timeout only on a 401 carrying reason=idle', () => {
    const idle = new ApiError(401, 'AUTH_TOKEN_INVALID', 'x', undefined, [
      { path: 'reason', message: 'idle' },
    ]);
    expect(idle.isIdleTimeout).toBe(true);
    expect(
      new ApiError(403, 'X', 'x', undefined, [{ path: 'reason', message: 'idle' }]).isIdleTimeout,
    ).toBe(false);
  });

  it('separates connectivity failures from server answers', () => {
    expect(new ApiError(0, CLIENT_ERROR_CODES.NETWORK, 'x').isConnectivity).toBe(true);
    expect(new ApiError(0, CLIENT_ERROR_CODES.TIMEOUT, 'x').isConnectivity).toBe(true);
    expect(new ApiError(500, 'INTERNAL', 'x').isConnectivity).toBe(false);
  });
});

describe('retryAfterFromHeader', () => {
  it('reads seconds and HTTP dates, and rejects the rest', () => {
    expect(retryAfterFromHeader('30')).toBe(30);
    expect(
      retryAfterFromHeader(
        'Wed, 21 Oct 2026 07:28:30 GMT',
        Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'),
      ),
    ).toBe(30);
    expect(retryAfterFromHeader('0')).toBeNull();
    expect(retryAfterFromHeader('soon')).toBeNull();
    expect(retryAfterFromHeader(null)).toBeNull();
  });
});
