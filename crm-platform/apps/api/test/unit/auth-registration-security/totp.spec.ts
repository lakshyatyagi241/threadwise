import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUrl,
  totpStep,
  verifyTotp,
} from '../../../src/modules/auth/support/totp';

/** RFC 6238 appendix B, SHA-1 secret "12345678901234567890", last six digits of the 8-digit values. */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const VECTORS: Array<[number, string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
];

describe('totp', () => {
  it.each(VECTORS)('matches the RFC 6238 vector at t=%i', (seconds, expected) => {
    expect(hotp(base32Decode(RFC_SECRET), totpStep(seconds * 1000))).toBe(expected);
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 128, 64]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(base32Decode('gez dgnb-vgy3')).toEqual(base32Decode('GEZDGNBVGY3'));
  });

  it('accepts the current code and one step of drift either way', () => {
    const now = 1_111_111_109_000;
    const step = totpStep(now);
    const secret = base32Decode(RFC_SECRET);
    expect(verifyTotp(RFC_SECRET, hotp(secret, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, hotp(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, hotp(secret, step + 1), now)).toBe(step + 1);
  });

  it('rejects a code two steps old (about 90 seconds)', () => {
    const now = 1_111_111_109_000;
    expect(
      verifyTotp(RFC_SECRET, hotp(base32Decode(RFC_SECRET), totpStep(now) - 2), now),
    ).toBeNull();
  });

  it('cannot replay a step that was already accepted', () => {
    const now = 1_111_111_109_000;
    const step = totpStep(now);
    const code = hotp(base32Decode(RFC_SECRET), step);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, now, step - 1)).toBe(step);
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyTotp(RFC_SECRET, '12345')).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef')).toBeNull();
    expect(verifyTotp(RFC_SECRET, '')).toBeNull();
  });

  it('generates a 160-bit secret and a well-formed otpauth URL', () => {
    const secret = generateTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    const url = new URL(otpauthUrl('Acme CRM', 'a@b.test', secret));
    expect(url.protocol).toBe('otpauth:');
    expect(url.searchParams.get('secret')).toBe(secret);
    expect(url.searchParams.get('issuer')).toBe('Acme CRM');
    expect(decodeURIComponent(url.pathname)).toContain('a@b.test');
  });
});
