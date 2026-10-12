import { ApiError } from '@/lib/api';
import { failureKindOf, firstParam, joinMeta } from './record-support';

describe('failureKindOf', () => {
  it.each([
    [new ApiError(404, 'NOT_FOUND', 'gone'), 'missing'],
    [new ApiError(403, 'FORBIDDEN', 'no'), 'denied'],
    [new ApiError(403, 'SOMETHING_ELSE', 'no'), 'denied'],
    [new ApiError(500, 'INTERNAL', 'oops'), 'other'],
    [new ApiError(0, 'CLIENT_NETWORK', 'offline'), 'other'],
    [new Error('plain'), 'other'],
    [null, 'other'],
  ])('reads %p as %s', (error, kind) => {
    expect(failureKindOf(error)).toBe(kind);
  });
});

describe('firstParam', () => {
  it('gives one string for whatever the router gave', () => {
    expect(firstParam('abc')).toBe('abc');
    expect(firstParam(['abc', 'def'])).toBe('abc');
    expect(firstParam([])).toBe('');
    expect(firstParam(undefined)).toBe('');
  });
});

describe('joinMeta', () => {
  it('joins the pieces that are there with a middle dot', () => {
    expect(joinMeta(['a', null, 'b', undefined, ''])).toBe('a · b');
    expect(joinMeta([null])).toBe('');
  });
});
