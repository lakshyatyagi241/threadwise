import { describe, expect, it } from 'vitest';
import { ApiError, toApiError } from './errors';

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
