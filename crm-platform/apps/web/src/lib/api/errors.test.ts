import { describe, expect, it } from 'vitest';
import { ApiError, retryAfterFromHeader, toApiError } from './errors';

describe('toApiError', () => {
  it('maps problem+json to a code, request id and field errors', () => {
    const e = toApiError(400, {
      type: 'about:blank',
      title: 'Validation failed',
      status: 400,
      code: 'VALIDATION_FAILED',
      requestId: 'req-1',
      errors: [{ path: 'email', message: 'Invalid' }],
    });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.requestId).toBe('req-1');
    expect(e.fieldErrors).toEqual([{ path: 'email', message: 'Invalid' }]);
  });

  it('falls back to the response header request id when the body has none', () => {
    const e = toApiError(
      404,
      { type: 'x', title: 'Not found', status: 404, code: 'NOT_FOUND' },
      'hdr-9',
    );
    expect(e.requestId).toBe('hdr-9');
  });

  it('does not trust non-problem bodies and never leaks their text', () => {
    const e = toApiError(502, '<html>bad gateway</html>');
    expect(e.code).toBe('INTERNAL');
    expect(e.message).not.toContain('bad gateway');
  });

  it('flags a row version conflict so the UI can ask for a reload instead of retrying', () => {
    expect(
      toApiError(409, { type: 'x', title: 'Conflict', status: 409, code: 'ROW_VERSION_CONFLICT' })
        .isRowVersionConflict,
    ).toBe(true);
    expect(
      toApiError(409, { type: 'x', title: 'Conflict', status: 409, code: 'CONFLICT' })
        .isRowVersionConflict,
    ).toBe(false);
  });
});

describe('idle timeout', () => {
  const body = (errors: Array<{ path: string; message: string }>) => ({
    type: 'about:blank',
    title: 'Unauthenticated',
    status: 401,
    code: 'UNAUTHENTICATED',
    errors,
  });

  it('reads the reason and the limit the API attaches to a session ended for inactivity', () => {
    const e = toApiError(
      401,
      body([
        { path: 'reason', message: 'idle' },
        { path: 'idleMinutes', message: '45' },
      ]),
    );
    expect(e.isIdleTimeout).toBe(true);
    expect(e.idleMinutes).toBe(45);
  });

  it('keeps the idle reason even when the limit is missing or unreadable', () => {
    const e = toApiError(401, body([{ path: 'reason', message: 'idle' }]));
    expect(e.isIdleTimeout).toBe(true);
    expect(e.idleMinutes).toBeUndefined();
    expect(
      toApiError(
        401,
        body([
          { path: 'reason', message: 'idle' },
          { path: 'idleMinutes', message: 'x' },
        ]),
      ).idleMinutes,
    ).toBeUndefined();
  });

  it('is not an idle timeout for an ordinary 401 or for another status', () => {
    expect(toApiError(401, body([])).isIdleTimeout).toBe(false);
    expect(toApiError(401, body([{ path: 'reason', message: 'revoked' }])).isIdleTimeout).toBe(
      false,
    );
    expect(
      toApiError(403, { ...body([{ path: 'reason', message: 'idle' }]), status: 403 })
        .isIdleTimeout,
    ).toBe(false);
  });
});

describe('Retry-After', () => {
  const locked = { type: 'about:blank', title: 'Locked', status: 429, code: 'AUTH_ACCOUNT_LOCKED' };

  it('turns the header into the same retryAfterSeconds detail the screens already read', () => {
    const e = toApiError(429, locked, 'req-1', '900');
    expect(e.fieldErrors).toEqual([{ path: 'retryAfterSeconds', message: '900' }]);
  });

  it('keeps the body detail when both are present', () => {
    const e = toApiError(
      429,
      { ...locked, errors: [{ path: 'retryAfterSeconds', message: '120' }] },
      'req-1',
      '900',
    );
    expect(e.fieldErrors).toEqual([{ path: 'retryAfterSeconds', message: '120' }]);
  });

  it('reads an HTTP date, rounds up, and ignores zero, garbage and other statuses', () => {
    const now = Date.parse('2026-10-01T10:00:00Z');
    expect(retryAfterFromHeader('Thu, 01 Oct 2026 10:02:00 GMT', now)).toBe(120);
    expect(retryAfterFromHeader('0')).toBeNull();
    expect(retryAfterFromHeader('soon')).toBeNull();
    expect(retryAfterFromHeader(null)).toBeNull();
    expect(toApiError(503, { ...locked, status: 503, code: 'X' }, null, '30').fieldErrors).toEqual(
      [],
    );
  });

  it('gives a non-problem 429 a wait as well', () => {
    expect(toApiError(429, '<html>', null, '45').fieldErrors).toEqual([
      { path: 'retryAfterSeconds', message: '45' },
    ]);
  });
});
