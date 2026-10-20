import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { errorKind } from './errors';

describe('errorKind', () => {
  it('tells the person to connect WhatsApp when a template has no number to go through', () => {
    expect(errorKind(new ApiError(409, 'TPL_NO_CONNECTION', 'Connect a number'))).toBe(
      'whatsappNotConnected',
    );
  });

  it('keeps an unknown conflict as unexpected, and a row version conflict as conflict', () => {
    expect(errorKind(new ApiError(409, 'SOMETHING_ELSE', 'x'))).toBe('unexpected');
    expect(errorKind(new ApiError(409, 'ROW_VERSION_CONFLICT', 'x'))).toBe('conflict');
  });
});
