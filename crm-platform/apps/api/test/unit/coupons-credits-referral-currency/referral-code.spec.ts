import { describe, expect, it } from 'vitest';
import { REFERRAL_CODE_ALPHABET } from '@crm/contracts';
import {
  generateReferralCode,
  normalizeReferralCode,
} from '../../../src/modules/coupons-credits-referral-currency/referral-code';

describe('WD-CPN-029 referral code generator', () => {
  it('WD-CPN-029 draws 10 characters from the confusion-free alphabet (no 0, O, 1, I, L)', () => {
    expect(REFERRAL_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    for (let i = 0; i < 500; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(10);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
      expect(code).not.toMatch(/[0OIL1]/);
    }
  });

  it('WD-CPN-029 uses the injected random source for every character, so a collision can be forced', () => {
    const calls: number[] = [];
    const code = generateReferralCode((max) => {
      calls.push(max);
      return calls.length - 1;
    });
    expect(calls).toHaveLength(10);
    expect(calls.every((m) => m === REFERRAL_CODE_ALPHABET.length)).toBe(true);
    expect(code).toBe(REFERRAL_CODE_ALPHABET.slice(0, 10));
  });

  it('WD-CPN-029 two draws are different (the default source is cryptographic, not a counter)', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateReferralCode()));
    expect(seen.size).toBe(200);
  });

  it('WD-CPN-032 a typed code is compared trimmed and upper-cased; empty stays empty', () => {
    expect(normalizeReferralCode('  ab3k9x2mqp ')).toBe('AB3K9X2MQP');
    expect(normalizeReferralCode('')).toBe('');
    expect(normalizeReferralCode(null)).toBe('');
    expect(normalizeReferralCode(undefined)).toBe('');
  });
});
