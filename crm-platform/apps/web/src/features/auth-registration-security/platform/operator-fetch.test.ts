import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { operatorAuthRedirect } from './operator-fetch';

const err = (status: number, code: string) => new ApiError(status, code, 'x');

describe('operatorAuthRedirect', () => {
  it('sends a super admin without MFA to the enrolment page', () => {
    expect(operatorAuthRedirect(err(403, 'AUTH_MFA_ENROLMENT_REQUIRED'))).toBe(
      '/admin/account/security',
    );
  });

  it('sends an expired session to sign-in with the expired notice', () => {
    expect(operatorAuthRedirect(err(401, 'UNAUTHENTICATED'))).toBe('/admin/login?expired=1');
  });

  it('leaves ordinary errors alone', () => {
    expect(operatorAuthRedirect(err(403, 'AUTH_OPERATOR_ROLE_REQUIRED'))).toBeNull();
    expect(operatorAuthRedirect(err(422, 'VALIDATION_FAILED'))).toBeNull();
    expect(operatorAuthRedirect(new Error('network'))).toBeNull();
  });
});
