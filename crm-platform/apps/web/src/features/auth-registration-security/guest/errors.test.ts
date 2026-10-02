import { ERROR_CODES } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { mapAuthError, networkError, policyMessage, showsRequestId } from './errors';

const err = (
  status: number,
  code: string,
  fieldErrors: Array<{ path: string; message: string }> = [],
  requestId?: string,
) => new ApiError(status, code, 'msg', requestId, fieldErrors);

describe('mapAuthError', () => {
  it('reads the lockout wait from fieldErrors and rounds up to minutes', () => {
    const m = mapAuthError(
      err(429, ERROR_CODES.AUTH_ACCOUNT_LOCKED, [{ path: 'retryAfterSeconds', message: '845' }]),
    );
    expect(m.key).toBe('locked');
    expect(m.params).toEqual({ minutes: 15 });
    expect(m.retryAfterSeconds).toBe(845);
  });

  it('shows at least one minute when the wait is unknown', () => {
    expect(mapAuthError(err(429, ERROR_CODES.AUTH_ACCOUNT_LOCKED)).params).toEqual({ minutes: 1 });
    expect(
      mapAuthError(
        err(429, ERROR_CODES.AUTH_ACCOUNT_LOCKED, [{ path: 'retryAfterSeconds', message: '5' }]),
      ).params,
    ).toEqual({ minutes: 1 });
  });

  it('keeps one policy issue per broken password rule, with its rule id', () => {
    const m = mapAuthError(
      err(422, ERROR_CODES.AUTH_PASSWORD_POLICY, [
        { path: 'password.min_length', message: 'Use at least 10 characters.' },
        { path: 'password.number', message: 'Include at least one number.' },
      ]),
    );
    expect(m.key).toBe('passwordPolicy');
    expect(m.field).toBe('password');
    expect(m.policy).toEqual([
      { rule: 'min_length', message: 'Use at least 10 characters.' },
      { rule: 'number', message: 'Include at least one number.' },
    ]);
    // Still grouped under the field for code that reads server messages per input.
    expect(m.fieldErrors.password).toEqual([
      'Use at least 10 characters.',
      'Include at least one number.',
    ]);
  });

  it('reads rules from newPassword.<rule> too, and tolerates an older bare path', () => {
    const m = mapAuthError(
      err(422, ERROR_CODES.AUTH_PASSWORD_POLICY, [
        { path: 'newPassword.symbol', message: 'Include at least one symbol.' },
        { path: 'password', message: 'Something old' },
        { path: 'email', message: 'ignored here' },
      ]),
    );
    expect(m.policy).toEqual([
      { rule: 'symbol', message: 'Include at least one symbol.' },
      { rule: null, message: 'Something old' },
    ]);
  });

  it('maps credential, captcha and suspension codes', () => {
    expect(mapAuthError(err(401, ERROR_CODES.AUTH_INVALID_CREDENTIALS)).key).toBe(
      'invalidCredentials',
    );
    expect(mapAuthError(err(400, ERROR_CODES.AUTH_CAPTCHA_FAILED)).key).toBe('captcha');
    expect(mapAuthError(err(403, ERROR_CODES.AUTH_ACCOUNT_SUSPENDED)).key).toBe('suspended');
  });

  it('keeps the one-time-code limits distinct from a generic rate limit (they are 429s too)', () => {
    expect(mapAuthError(err(429, ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS)).key).toBe('otpTooMany');
    expect(mapAuthError(err(429, ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN)).key).toBe('otpCooldown');
  });

  it('tells a vanished sign-up (start over) from an expired code (ask for a new one)', () => {
    expect(mapAuthError(err(400, ERROR_CODES.AUTH_SIGNUP_EXPIRED)).key).toBe('signupExpired');
    expect(mapAuthError(err(400, ERROR_CODES.AUTH_OTP_EXPIRED)).key).toBe('otpExpired');
  });

  it('carries the resend wait from the server', () => {
    const m = mapAuthError(
      err(429, ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN, [
        { path: 'retryAfterSeconds', message: '37' },
      ]),
    );
    expect(m.key).toBe('otpCooldown');
    expect(m.retryAfterSeconds).toBe(37);
    expect(
      mapAuthError(err(429, ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN)).retryAfterSeconds,
    ).toBeUndefined();
  });

  it('maps one-time-code failures onto the code input', () => {
    for (const [code, key] of [
      [ERROR_CODES.AUTH_OTP_INVALID, 'otpInvalid'],
      [ERROR_CODES.AUTH_OTP_EXPIRED, 'otpExpired'],
      [ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS, 'otpTooMany'],
    ] as const) {
      const m = mapAuthError(err(400, code));
      expect(m.key).toBe(key);
      expect(m.field).toBe('code');
    }
  });

  it('handles rate limits with and without a wait', () => {
    const waited = mapAuthError(
      err(429, ERROR_CODES.RATE_LIMITED, [{ path: 'retryAfterSeconds', message: '42' }]),
    );
    expect(waited).toMatchObject({ key: 'rateLimitedWait', params: { seconds: 42 } });
    expect(mapAuthError(err(429, ERROR_CODES.RATE_LIMITED)).key).toBe('rateLimited');
  });

  it('groups validation details by their top-level field', () => {
    const m = mapAuthError(
      err(422, ERROR_CODES.VALIDATION_FAILED, [
        { path: 'email', message: 'Invalid email' },
        { path: 'phone', message: 'Invalid phone' },
        { path: 'email', message: 'Required' },
      ]),
    );
    expect(m.key).toBe('validation');
    expect(m.field).toBe('email');
    expect(m.fieldErrors).toEqual({
      email: ['Invalid email', 'Required'],
      phone: ['Invalid phone'],
    });
  });

  it('treats 419 and a bare 401 as a page that outlived its session', () => {
    expect(mapAuthError(err(419, 'UNKNOWN'))).toMatchObject({ key: 'sessionExpired', stale: true });
    expect(mapAuthError(err(401, ERROR_CODES.UNAUTHENTICATED))).toMatchObject({
      key: 'sessionExpired',
      stale: true,
    });
  });

  it('keeps a refused request (403) apart from an expired one', () => {
    expect(mapAuthError(err(403, ERROR_CODES.FORBIDDEN))).toMatchObject({
      key: 'forbidden',
      stale: false,
    });
    expect(mapAuthError(err(403, 'SOMETHING_ELSE')).key).toBe('forbidden');
  });

  it('maps a social sign-in that matches no account', () => {
    expect(mapAuthError(err(401, ERROR_CODES.AUTH_SOCIAL_NO_ACCOUNT)).key).toBe('socialNoAccount');
  });

  it('reports a dropped connection and unknown failures', () => {
    expect(mapAuthError(networkError()).key).toBe('network');
    expect(mapAuthError(new TypeError('Failed to fetch')).key).toBe('network');
    const m = mapAuthError(err(500, 'INTERNAL', [], 'req-1'));
    expect(m.key).toBe('unexpected');
    expect(showsRequestId(m)).toBe(true);
    expect(
      showsRequestId(mapAuthError(err(401, ERROR_CODES.AUTH_INVALID_CREDENTIALS, [], 'r'))),
    ).toBe(false);
  });
});

describe('policyMessage', () => {
  it('localises each known rule', () => {
    for (const rule of ['upper_lower', 'number', 'symbol', 'common']) {
      expect(policyMessage({ rule, message: 'English' })).toEqual({ key: rule });
    }
  });

  it('takes the length from the server text for min_length', () => {
    expect(policyMessage({ rule: 'min_length', message: 'Use at least 12 characters.' })).toEqual({
      key: 'min_length',
      params: { min: 12 },
    });
  });

  it('falls back to the server text when the length cannot be read or the rule is unknown', () => {
    expect(policyMessage({ rule: 'min_length', message: 'Too short.' })).toBeNull();
    expect(policyMessage({ rule: 'min_length', message: 'Use at least 0 characters.' })).toBeNull();
    expect(policyMessage({ rule: 'no_repeats', message: 'No repeated characters.' })).toBeNull();
    expect(policyMessage({ rule: null, message: 'Old server text' })).toBeNull();
  });
});
