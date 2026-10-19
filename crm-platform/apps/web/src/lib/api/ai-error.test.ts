import { describe, expect, it } from 'vitest';
import { aiErrorKind } from './ai-error';
import { ApiError } from './errors';

const err = (code: string, status = 422) => new ApiError(status, code, 'x');

describe('aiErrorKind', () => {
  it.each([
    ['CAMP_AI_NO_KEY', 'noKey'],
    ['CAMP_AI_LIMIT_REACHED', 'limitReached'],
    ['CAMP_AI_PROVIDER_FAILED', 'providerFailed'],
    ['CAMP_AI_BAD_JSON', 'badJson'],
    ['CAMP_AI_IMAGE_REFUSED', 'imageRefused'],
    ['VALIDATION_FAILED', 'invalid'],
    ['FORBIDDEN', 'forbidden'],
    ['SOMETHING_ELSE', 'failed'],
  ])('%s reads as %s', (code, kind) => {
    expect(aiErrorKind(err(code))).toBe(kind);
  });

  it('a 403 with an unknown code is still a permission problem', () => {
    expect(aiErrorKind(err('X', 403))).toBe('forbidden');
  });

  it('anything that is not an ApiError is a network problem', () => {
    expect(aiErrorKind(new TypeError('Failed to fetch'))).toBe('network');
  });
});
