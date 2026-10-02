import { describe, expect, it } from 'vitest';
import {
  REFERRAL_COOKIE,
  REFERRAL_MAX_AGE,
  referralCookieFor,
  referralFromParam,
  sanitizeReferral,
  withReferralFallback,
} from './referral';

describe('referral code', () => {
  it('upper-cases, strips symbols and caps typed input at 16', () => {
    expect(sanitizeReferral('abc-123 xyz')).toBe('ABC123XYZ');
    expect(sanitizeReferral('a'.repeat(40))).toBe('A'.repeat(16));
    expect(sanitizeReferral(null)).toBe('');
    expect(sanitizeReferral('<script>')).toBe('SCRIPT');
  });

  it('takes a code from a link only when it is A-Z0-9 and at most 16 long', () => {
    expect(referralFromParam('got-123')).toBe('GOT123');
    expect(referralFromParam('A'.repeat(16))).toBe('A'.repeat(16));
    // Too long after cleaning: dropped, not shortened into someone else's code.
    expect(referralFromParam('A'.repeat(17))).toBe('');
    expect(referralFromParam('---')).toBe('');
    expect(referralFromParam('')).toBe('');
    expect(referralFromParam(undefined)).toBe('');
  });

  it('builds a 30-day httpOnly lax cookie from a visit', () => {
    const c = referralCookieFor('got123', true);
    expect(c).toEqual({
      name: REFERRAL_COOKIE,
      value: 'GOT123',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: REFERRAL_MAX_AGE,
      },
    });
    expect(REFERRAL_MAX_AGE).toBe(60 * 60 * 24 * 30);
  });

  it('sets no cookie when the visit has no usable code', () => {
    expect(referralCookieFor(null, false)).toBeNull();
    expect(referralCookieFor('!!!', false)).toBeNull();
    expect(referralCookieFor('X'.repeat(20), false)).toBeNull();
  });
});

describe('referral fallback on sign-up', () => {
  it('fills in the remembered code when the box was left empty', () => {
    expect(withReferralFallback({ email: 'a@b.co' }, 'GOT123')).toEqual({
      email: 'a@b.co',
      referralCode: 'GOT123',
    });
    expect(withReferralFallback({ referralCode: '  ' }, 'GOT123')).toMatchObject({
      referralCode: 'GOT123',
    });
  });

  it('keeps what the visitor typed, even when a cookie exists', () => {
    expect(withReferralFallback({ referralCode: 'MINE1' }, 'GOT123').referralCode).toBe('MINE1');
  });

  it('leaves the body alone when there is no usable cookie', () => {
    const body = { email: 'a@b.co' };
    expect(withReferralFallback(body, undefined)).toBe(body);
    expect(withReferralFallback(body, '')).toBe(body);
    expect(withReferralFallback(body, 'A'.repeat(20))).toBe(body);
  });
});
