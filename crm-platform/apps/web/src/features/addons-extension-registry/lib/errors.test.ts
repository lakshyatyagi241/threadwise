import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { deleteErrorKey } from './errors';

describe('deleteErrorKey', () => {
  it('says why when the API refuses because purchases exist', () => {
    expect(deleteErrorKey(new ApiError(409, ERROR_CODES.ADD_PACK_IN_USE, 'x'))).toBe('refused');
  });

  it('names a missing permission and a missing add-on', () => {
    expect(deleteErrorKey(new ApiError(403, 'FORBIDDEN', 'x'))).toBe('forbidden');
    expect(deleteErrorKey(new ApiError(404, 'NOT_FOUND', 'x'))).toBe('notFound');
  });

  it('falls back to a delete sentence, never the save one', () => {
    expect(deleteErrorKey(new ApiError(500, 'INTERNAL', 'x'))).toBe('failed');
    expect(deleteErrorKey(new Error('offline'))).toBe('failed');
  });
});
