import { describe, expect, it } from 'vitest';
import { redact } from '../../../src/modules/auth/security/auth-audit.service';

describe('audit redaction of one-time values', () => {
  it('redacts a bare otp / totp / pin / passcode key as well as the compound forms', () => {
    const out = redact({
      otp: '123456',
      totp: '654321',
      pin: '0000',
      passcode: 'abc',
      otpCode: '111111',
      recoveryCode: 'AAAAA-BBBBB',
      code: '222222',
    }) as Record<string, unknown>;
    for (const k of Object.keys(out)) expect(out[k], k).toBe('[REDACTED]');
  });

  it('keeps ordinary fields, including ones that merely contain the letters', () => {
    const out = redact({ pinned: true, spinner: 'x', country_code: 'IN', orgId: 4 }) as Record<
      string,
      unknown
    >;
    expect(out).toEqual({ pinned: true, spinner: 'x', country_code: 'IN', orgId: 4 });
  });
});
