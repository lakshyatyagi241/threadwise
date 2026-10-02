import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { errorKey, formatMicros, lastDays } from './lib';

describe('formatMicros', () => {
  it('prints millionths of a dollar without rounding through a float', () => {
    expect(formatMicros('0')).toBe('$0.0000');
    expect(formatMicros('20000')).toBe('$0.0200');
    expect(formatMicros('9007199254740993123456')).toBe('$9007199254740993.1234');
  });
});

describe('errorKey', () => {
  it('maps stable codes, never titles', () => {
    expect(errorKey(new ApiError(409, 'ROW_VERSION_CONFLICT', 'x'))).toBe('conflict');
    expect(errorKey(new ApiError(422, 'I18N_PROVIDER_CREDENTIALS_MISSING', 'x'))).toBe(
      'credentialsMissing',
    );
    expect(errorKey(new Error('boom'))).toBe('unexpected');
  });
});

describe('lastDays', () => {
  it('is inclusive of today', () => {
    expect(lastDays(7, new Date('2026-10-08T12:00:00Z'))).toEqual({
      from: '2026-10-02',
      to: '2026-10-08',
    });
  });
});
