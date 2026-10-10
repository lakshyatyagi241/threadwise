import { REFERRAL_MAX_LENGTH, sanitizeReferral } from './referral';

describe('sanitizeReferral', () => {
  it('keeps upper-case letters and digits only', () => {
    expect(sanitizeReferral('ab-12 cd')).toBe('AB12CD');
  });

  it('stops at the longest code the contract accepts', () => {
    expect(REFERRAL_MAX_LENGTH).toBe(16);
    expect(sanitizeReferral('a'.repeat(20))).toBe('A'.repeat(16));
  });

  it('copes with nothing', () => {
    expect(sanitizeReferral(null)).toBe('');
    expect(sanitizeReferral(undefined)).toBe('');
    expect(sanitizeReferral('---')).toBe('');
  });
});
