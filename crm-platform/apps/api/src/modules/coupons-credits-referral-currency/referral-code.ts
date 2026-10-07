import { randomInt } from 'node:crypto';
import { REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from '@crm/contracts';

/**
 * One referral code (WD-CPN-029): ten characters from an alphabet with no 0, O, 1, I or L, drawn with a cryptographic random so a
 * code cannot be guessed from another. `rand` is injectable so the tests can force a collision or a fixed draw.
 */
export function generateReferralCode(rand: (maxExclusive: number) => number = randomInt): string {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_CODE_ALPHABET[rand(REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}

/** What a typed or carried code is compared as: trimmed and upper-cased, so lookups ignore case (WD-CPN-032 rule 1). */
export function normalizeReferralCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}
