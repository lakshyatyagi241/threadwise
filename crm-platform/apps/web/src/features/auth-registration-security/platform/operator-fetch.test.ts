import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { createIpBlockStore } from './lib/ip-blocked';
import { operatorAuthRedirect, reportIpBlock } from './operator-fetch';

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

  it('carries the page the operator was on, so signing in again lands back there', () => {
    expect(operatorAuthRedirect(err(401, 'UNAUTHENTICATED'), '/admin/security?tab=login')).toBe(
      '/admin/login?expired=1&next=%2Fadmin%2Fsecurity%3Ftab%3Dlogin',
    );
  });

  it('says the session ended for inactivity, with the limit, when the API did', () => {
    const idle = new ApiError(401, 'UNAUTHENTICATED', 'x', 'req', [
      { path: 'reason', message: 'idle' },
      { path: 'idleMinutes', message: '20' },
    ]);
    expect(operatorAuthRedirect(idle, '/admin/events')).toBe(
      '/admin/login?expired=idle&minutes=20&next=%2Fadmin%2Fevents',
    );
    expect(operatorAuthRedirect(idle)).toBe('/admin/login?expired=idle&minutes=20');
  });

  it('leaves ordinary errors alone', () => {
    expect(operatorAuthRedirect(err(403, 'AUTH_OPERATOR_ROLE_REQUIRED'))).toBeNull();
    expect(operatorAuthRedirect(err(422, 'VALIDATION_FAILED'))).toBeNull();
    expect(operatorAuthRedirect(new Error('network'))).toBeNull();
  });
});

describe('reportIpBlock', () => {
  it('records the blocked address for the shell and says it did', () => {
    const store = createIpBlockStore();
    const e = new ApiError(403, 'AUTH_IP_BLOCKED', 'no', 'req', [
      { path: 'ip', message: '203.0.113.9' },
    ]);
    expect(reportIpBlock(e, store)).toBe(true);
    expect(store.get()).toEqual({ ip: '203.0.113.9' });
  });

  it('ignores every other error', () => {
    const store = createIpBlockStore();
    expect(reportIpBlock(err(403, 'AUTH_OPERATOR_ROLE_REQUIRED'), store)).toBe(false);
    expect(reportIpBlock(err(401, 'UNAUTHENTICATED'), store)).toBe(false);
    expect(reportIpBlock(new Error('offline'), store)).toBe(false);
    expect(store.get()).toBeNull();
  });
});
