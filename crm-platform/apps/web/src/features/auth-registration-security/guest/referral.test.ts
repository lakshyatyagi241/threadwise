import { describe, expect, it } from 'vitest';
import {
  clearedReferralCookie,
  readReferralFromCookie,
  referralCookie,
  sanitizeReferral,
} from './referral';

describe('referral code', () => {
  it('upper-cases, strips symbols and caps at 16', () => {
    expect(sanitizeReferral('abc-123 xyz')).toBe('ABC123XYZ');
    expect(sanitizeReferral('a'.repeat(40))).toBe('A'.repeat(16));
    expect(sanitizeReferral(null)).toBe('');
    expect(sanitizeReferral('<script>')).toBe('SCRIPT');
  });

  it('writes a 30-day lax cookie and reads it back', () => {
    const c = referralCookie('GOT123');
    expect(c).toContain('crm_ref=GOT123');
    expect(c).toContain(`Max-Age=${60 * 60 * 24 * 30}`);
    expect(c).toContain('SameSite=Lax');
    expect(readReferralFromCookie(`theme=dark; ${c.split(';')[0]}; other=1`)).toBe('GOT123');
  });

  it('ignores other cookies and clears with Max-Age=0', () => {
    expect(readReferralFromCookie('a=1; b=2')).toBe('');
    expect(clearedReferralCookie()).toContain('Max-Age=0');
  });
});
