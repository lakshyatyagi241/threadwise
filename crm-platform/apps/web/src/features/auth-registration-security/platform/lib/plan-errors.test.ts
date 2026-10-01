import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { planErrorKind } from './plan-errors';

describe('planErrorKind', () => {
  it('reads how many workspaces block a delete', () => {
    const e = new ApiError(409, 'PLAN_IN_USE', 'x', undefined, [{ path: 'inUse', message: '3' }]);
    expect(planErrorKind(e)).toEqual({ key: 'inUse', count: 3 });
  });

  it('survives a missing or malformed count', () => {
    expect(planErrorKind(new ApiError(409, 'PLAN_IN_USE', 'x'))).toEqual({
      key: 'inUse',
      count: 0,
    });
    expect(
      planErrorKind(
        new ApiError(409, 'PLAN_IN_USE', 'x', undefined, [{ path: 'inUse', message: 'many' }]),
      ),
    ).toEqual({ key: 'inUse', count: 0 });
  });

  it('maps the signup-default protection by code, not by wording', () => {
    expect(planErrorKind(new ApiError(409, 'PLAN_DEFAULT_PROTECTED', 'anything'))).toEqual({
      key: 'defaultProtected',
    });
  });

  it('maps statuses and falls back to a generic sentence', () => {
    expect(planErrorKind(new ApiError(404, 'NOT_FOUND', 'x'))).toEqual({ key: 'notFound' });
    expect(planErrorKind(new ApiError(403, 'AUTH_OPERATOR_ROLE_REQUIRED', 'x'))).toEqual({
      key: 'forbidden',
    });
    expect(planErrorKind(new ApiError(500, 'INTERNAL', 'x'))).toEqual({ key: 'generic' });
    expect(planErrorKind(new Error('boom'))).toEqual({ key: 'generic' });
  });
});
