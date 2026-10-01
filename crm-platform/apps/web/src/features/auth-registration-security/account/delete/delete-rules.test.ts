import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { blockerOf, phraseMatches } from './delete-rules';

const blocked = (reason: string) =>
  new ApiError(422, 'AUTH_DELETE_BLOCKED', 'x', 'req', [{ path: 'reason', message: reason }]);

describe('phraseMatches', () => {
  it('needs the exact phrase, case-sensitively', () => {
    expect(phraseMatches('DELETE my account')).toBe(true);
    expect(phraseMatches('  DELETE my account  ')).toBe(true);
    expect(phraseMatches('delete my account')).toBe(false);
    expect(phraseMatches('DELETE MY ACCOUNT')).toBe(false);
    expect(phraseMatches('DELETE my')).toBe(false);
    expect(phraseMatches('')).toBe(false);
  });
});

describe('blockerOf', () => {
  it('names the two blockers', () => {
    expect(blockerOf(blocked('sole_member'))).toBe('sole_member');
    expect(blockerOf(blocked('sole_admin'))).toBe('sole_admin');
  });
  it('ignores unknown reasons, other codes and non-API errors', () => {
    expect(blockerOf(blocked('something_else'))).toBeNull();
    expect(blockerOf(new ApiError(422, 'AUTH_CURRENT_PASSWORD_WRONG', 'x'))).toBeNull();
    expect(blockerOf(new Error('boom'))).toBeNull();
    expect(blockerOf(new ApiError(422, 'AUTH_DELETE_BLOCKED', 'x'))).toBeNull();
  });
});
