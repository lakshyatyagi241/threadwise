import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  errorKey,
  isEmbeddingUnavailable,
  isRowVersionConflict,
  serverFieldProblems,
} from './errors';

const err = (status: number, code: string, fields: Array<{ path: string; message: string }> = []) =>
  new ApiError(status, code, 'text that must not matter', 'req-1', fields);

describe('errorKey', () => {
  it.each([
    [err(409, ERROR_CODES.ROW_VERSION_CONFLICT), 'conflict'],
    [err(409, ERROR_CODES.FAQ_DUPLICATE_QUESTION), 'duplicateQuestion'],
    [err(422, ERROR_CODES.FAQ_LIMIT_REACHED), 'limitReached'],
    [err(422, ERROR_CODES.FAQ_FLOW_NOT_FOUND), 'flowNotFound'],
    [err(422, ERROR_CODES.FAQ_EMBEDDING_UNAVAILABLE), 'embeddingUnavailable'],
    [err(502, ERROR_CODES.FAQ_EMBEDDING_UNAVAILABLE), 'embeddingUnavailable'],
    [err(422, ERROR_CODES.FAQ_ENGINE_DISABLED), 'engineDisabled'],
    [err(422, ERROR_CODES.FAQ_MODEL_NOT_ALLOWED), 'modelNotAllowed'],
    [err(422, ERROR_CODES.VALIDATION_FAILED), 'validation'],
    [err(403, 'ANYTHING'), 'forbidden'],
    [err(404, 'WHATEVER'), 'notFound'],
    [err(429, ERROR_CODES.RATE_LIMITED), 'rateLimited'],
    [err(500, 'INTERNAL'), 'unexpected'],
    [new Error('offline'), 'network'],
  ])('%#', (e, key) => expect(errorKey(e)).toBe(key));

  it('reads a generic conflict on a variation text as a duplicate phrasing', () => {
    expect(errorKey(err(409, ERROR_CODES.CONFLICT, [{ path: 'text', message: 'x' }]))).toBe(
      'duplicateVariation',
    );
    expect(errorKey(err(409, ERROR_CODES.CONFLICT))).toBe('conflict');
  });
  it('has helpers keyed on the code', () => {
    expect(isRowVersionConflict(err(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toBe(true);
    expect(isEmbeddingUnavailable(err(422, ERROR_CODES.FAQ_EMBEDDING_UNAVAILABLE))).toBe(true);
    expect(
      serverFieldProblems(
        err(422, ERROR_CODES.VALIDATION_FAILED, [{ path: 'question', message: 'm' }]),
      ),
    ).toHaveLength(1);
    expect(serverFieldProblems(err(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toEqual([]);
  });
});
