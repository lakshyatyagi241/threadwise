import { ERROR_CODES } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { errorKey, isRowVersionConflict } from './errors';

const err = (status: number, code: string) => new ApiError(status, code, 'words');

describe('errorKey', () => {
  it('maps every lead scoring code to its own key', () => {
    expect(errorKey(err(422, ERROR_CODES.LSC_PLATFORM_DISABLED))).toBe('platformDisabled');
    expect(errorKey(err(422, ERROR_CODES.LSC_NOT_ENABLED))).toBe('notEnabled');
    expect(errorKey(err(422, ERROR_CODES.LSC_NO_KEY))).toBe('noKey');
    expect(errorKey(err(502, ERROR_CODES.LSC_PROVIDER_FAILED))).toBe('providerFailed');
    expect(errorKey(err(409, ERROR_CODES.LSC_MANUAL_SCORE))).toBe('manualScore');
    expect(errorKey(err(402, ERROR_CODES.PLAN_LIMIT_REACHED))).toBe('planLimit');
  });
  it('maps the generic cases and falls back', () => {
    expect(errorKey(err(403, 'X'))).toBe('forbidden');
    expect(errorKey(err(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toBe('conflict');
    expect(errorKey(err(404, 'X'))).toBe('notFound');
    expect(errorKey(err(500, 'X'))).toBe('unexpected');
    expect(errorKey(new TypeError('fetch failed'))).toBe('network');
  });
  it('detects a stale save', () => {
    expect(isRowVersionConflict(err(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toBe(true);
    expect(isRowVersionConflict(err(409, ERROR_CODES.LSC_MANUAL_SCORE))).toBe(false);
  });
});
