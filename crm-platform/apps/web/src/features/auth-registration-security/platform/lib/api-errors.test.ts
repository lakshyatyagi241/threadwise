import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  fieldErrorMap,
  fieldMessage,
  isRoleRefusal,
  retryAfterSeconds,
  rootPath,
} from './api-errors';

const withFields = (fields: Array<{ path: string; message: string }>) =>
  new ApiError(429, 'AUTH_ACCOUNT_LOCKED', 'locked', 'req-1', fields);

describe('retryAfterSeconds', () => {
  it('reads the lockout wait from the field errors', () => {
    expect(retryAfterSeconds(withFields([{ path: 'retryAfterSeconds', message: '540' }]))).toBe(
      540,
    );
  });
  it('rounds up and ignores junk', () => {
    expect(retryAfterSeconds(withFields([{ path: 'retryAfterSeconds', message: '12.2' }]))).toBe(
      13,
    );
    expect(
      retryAfterSeconds(withFields([{ path: 'retryAfterSeconds', message: 'soon' }])),
    ).toBeNull();
    expect(retryAfterSeconds(withFields([]))).toBeNull();
  });
});

describe('field error helpers', () => {
  const e = withFields([
    { path: 'ip', message: '203.0.113.9' },
    { path: 'ip', message: 'second' },
  ]);
  it('finds a message by path', () => expect(fieldMessage(e, 'ip')).toBe('203.0.113.9'));
  it('keeps the first message of a repeated path', () =>
    expect(fieldErrorMap(e)).toEqual({ ip: '203.0.113.9' }));
  it('collapses list item paths to the list field', () => {
    expect(rootPath('abuseBlockKeywordList.3')).toBe('abuseBlockKeywordList');
    expect(rootPath('otp.ttlMinutes')).toBe('otp');
    expect(rootPath('trialDays')).toBe('trialDays');
  });
});

describe('isRoleRefusal', () => {
  it('is true only for a 403 that names the role requirement', () => {
    expect(isRoleRefusal(new ApiError(403, 'AUTH_OPERATOR_ROLE_REQUIRED', 'no'))).toBe(true);
    expect(isRoleRefusal(new ApiError(403, 'AUTH_IP_BLOCKED', 'no'))).toBe(false);
    expect(isRoleRefusal(new ApiError(403, 'AUTH_MFA_ENROLMENT_REQUIRED', 'no'))).toBe(false);
    expect(isRoleRefusal(new ApiError(401, 'AUTH_OPERATOR_ROLE_REQUIRED', 'no'))).toBe(false);
    expect(isRoleRefusal(new Error('x'))).toBe(false);
  });
});
