import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { gateRedirectFor, gateRouteForCode, isGateError, redirectOnGateError } from './gate-errors';

const err = (code: string, status = 403) => new ApiError(status, code, 'x', 'req-1');

describe('gate error mapping', () => {
  it.each([
    ['AUTH_ACCOUNT_SUSPENDED', '/suspended'],
    ['AUTH_PASSWORD_CHANGE_REQUIRED', '/account/security?required=password'],
    ['AUTH_MFA_ENROLMENT_REQUIRED', '/account/security?required=mfa'],
    ['AUTH_EMAIL_UNVERIFIED', '/verify-email-required'],
  ])('%s goes to %s', (code, target) => {
    expect(gateRouteForCode(code)).toBe(target);
    expect(gateRedirectFor(err(code))).toBe(target);
    expect(isGateError(err(code))).toBe(true);
  });

  it('ignores every other code and non-API errors', () => {
    expect(gateRedirectFor(err('AUTH_INVALID_CREDENTIALS', 401))).toBeNull();
    expect(gateRedirectFor(err('FORBIDDEN'))).toBeNull();
    expect(gateRedirectFor(new Error('boom'))).toBeNull();
    expect(gateRedirectFor(undefined)).toBeNull();
    expect(gateRouteForCode(undefined)).toBeNull();
    expect(isGateError(new Error('boom'))).toBe(false);
  });

  it('does not redirect a page onto itself', () => {
    const e = err('AUTH_MFA_ENROLMENT_REQUIRED');
    expect(gateRedirectFor(e, '/account/security')).toBeNull();
    expect(gateRedirectFor(e, '/dashboard')).toBe('/account/security?required=mfa');
  });

  it('redirectOnGateError reports whether it redirected', () => {
    const replace = vi.fn();
    expect(redirectOnGateError(err('AUTH_EMAIL_UNVERIFIED'), replace)).toBe(true);
    expect(replace).toHaveBeenCalledWith('/verify-email-required');
    replace.mockClear();
    expect(redirectOnGateError(err('VALIDATION_FAILED', 422), replace)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});
