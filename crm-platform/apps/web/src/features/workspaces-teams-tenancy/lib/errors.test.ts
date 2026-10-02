import { ERROR_CODES } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { ERROR_KINDS, errorKind, planLimitOf } from './errors';
import { readMessages } from './test-support';

const api = (code: string, status = 422) => new ApiError(status, code, 'whatever the server wrote');

describe('errorKind', () => {
  it('branches on the problem code, never on the wording', () => {
    expect(errorKind(new ApiError(409, ERROR_CODES.WSP_ALREADY_MEMBER, 'text changed'))).toBe(
      'alreadyMember',
    );
    expect(errorKind(api(ERROR_CODES.PLAN_LIMIT_REACHED))).toBe('planLimit');
    expect(errorKind(api(ERROR_CODES.ROW_VERSION_CONFLICT, 409))).toBe('conflict');
    expect(errorKind(api(ERROR_CODES.RBAC_ROLE_GRANT_FORBIDDEN, 403))).toBe('cannotGrant');
    expect(errorKind(api(ERROR_CODES.RBAC_SELF_ROLE_CHANGE, 422))).toBe('ownRole');
    expect(errorKind(api(ERROR_CODES.WSP_CANNOT_ACT_ON_HIGHER_RANK, 403))).toBe('higherRank');
    expect(errorKind(api(ERROR_CODES.WSP_TEAM_NAME_TAKEN, 409))).toBe('teamNameTaken');
    expect(errorKind(api(ERROR_CODES.RBAC_LAST_OWNER))).toBe('lastOwner');
  });

  it('treats a dropped connection as a network problem and anything else as unexpected', () => {
    expect(errorKind(new TypeError('Failed to fetch'))).toBe('network');
    expect(errorKind(new Error('boom'))).toBe('unexpected');
    expect(errorKind(api('SOMETHING_NEW', 500))).toBe('unexpected');
  });

  it('has a sentence in English and Arabic for every kind', () => {
    for (const locale of ['en', 'ar']) {
      const errors = (
        readMessages(locale)['workspaces-teams-tenancy'] as Record<string, Record<string, string>>
      ).errors!;
      for (const kind of ERROR_KINDS)
        expect(typeof errors[kind], `${locale} ${kind}`).toBe('string');
    }
  });
});

describe('planLimitOf', () => {
  it('reads the cap the server sends', () => {
    const e = new ApiError(402, ERROR_CODES.PLAN_LIMIT_REACHED, 'x', undefined, [
      { path: 'limitValue', message: '5' },
    ]);
    expect(planLimitOf(e)).toBe(5);
    expect(planLimitOf(api(ERROR_CODES.PLAN_LIMIT_REACHED))).toBeUndefined();
    expect(planLimitOf('nope')).toBeUndefined();
  });
});
