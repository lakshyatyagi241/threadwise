import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { errorKey, flowsInUse, serverFieldProblems } from './errors';

const err = (status: number, code: string, fields: Array<{ path: string; message: string }> = []) =>
  new ApiError(status, code, 'x', 'req-1', fields);

describe('errorKey branches on the code', () => {
  it.each([
    [err(409, ERROR_CODES.ROW_VERSION_CONFLICT), 'conflict'],
    [err(409, ERROR_CODES.ALIB_NAME_TAKEN), 'nameTaken'],
    [err(409, ERROR_CODES.ALIB_IN_USE), 'inUse'],
    [err(422, ERROR_CODES.ALIB_LIMIT_REACHED), 'limit'],
    [err(422, ERROR_CODES.VALIDATION_FAILED), 'validation'],
    [err(404, ERROR_CODES.NOT_FOUND), 'notFound'],
    [err(403, ERROR_CODES.FORBIDDEN), 'forbidden'],
    [err(429, ERROR_CODES.RATE_LIMITED), 'rateLimited'],
    [err(500, 'INTERNAL'), 'unexpected'],
    [new TypeError('fetch failed'), 'network'],
  ])('%#', (e, key) => expect(errorKey(e)).toBe(key));
});

describe('details', () => {
  it('lists the flows of an in-use refusal', () => {
    const e = err(409, ERROR_CODES.ALIB_IN_USE, [{ path: 'f1', message: 'Welcome' }]);
    expect(flowsInUse(e)).toEqual([{ id: 'f1', name: 'Welcome' }]);
    expect(flowsInUse(err(409, ERROR_CODES.ALIB_NAME_TAKEN))).toEqual([]);
    expect(flowsInUse(new Error('x'))).toEqual([]);
  });
  it('hands over the field problems of a 422 only', () => {
    const fields = [{ path: 'url', message: 'bad' }];
    expect(serverFieldProblems(err(422, ERROR_CODES.VALIDATION_FAILED, fields))).toEqual(fields);
    expect(serverFieldProblems(err(409, ERROR_CODES.ALIB_IN_USE, fields))).toEqual([]);
  });
});
