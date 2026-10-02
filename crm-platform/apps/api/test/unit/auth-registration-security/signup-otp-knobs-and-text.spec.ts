import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_BASE_URL, registrationSettingsPatchSchema } from '@crm/contracts';
import { renderOtpText } from '../../../src/infra/providers/auth-registration-security/otp-payloads';
import { withDefaultKnobs } from '../../../src/modules/auth/platform/registration-otp.service';

describe('OTP knobs left blank (TW-AUTH-007)', () => {
  const parse = (otp: Record<string, unknown>) =>
    registrationSettingsPatchSchema.parse(withDefaultKnobs({ otp })).otp;

  it('an empty validity is 5 minutes, never 0 and never an error', () => {
    expect(parse({ ttlMinutes: null })?.ttlMinutes).toBe(5);
    expect(parse({ ttlMinutes: '' })?.ttlMinutes).toBe(5);
    expect(parse({ ttlMinutes: '   ' })?.ttlMinutes).toBe(5);
    expect(parse({ ttlMinutes: Number.NaN })?.ttlMinutes).toBe(5);
  });

  it('the other three knobs fall back to their own defaults', () => {
    expect(parse({ length: null, resendCooldownSec: '', maxAttempts: ' ' })).toMatchObject({
      length: 6,
      resendCooldownSec: 60,
      maxAttempts: 5,
    });
  });

  it('a number typed as text is read as the number; a knob that is not sent stays unsent', () => {
    expect(parse({ ttlMinutes: ' 12 ' })?.ttlMinutes).toBe(12);
    expect(parse({ enabled: true })).toEqual({ enabled: true });
  });

  it('an out-of-range or malformed value is still refused', () => {
    expect(() => parse({ ttlMinutes: 0 })).toThrow();
    expect(() => parse({ ttlMinutes: 91 })).toThrow();
    expect(() => parse({ ttlMinutes: 'abc' })).toThrow();
    expect(() => parse({ resendCooldownSec: 5 })).toThrow();
  });

  it('leaves a body without an otp section alone', () => {
    const body = { publicRegistration: false };
    expect(withDefaultKnobs(body)).toBe(body);
    expect(withDefaultKnobs(null)).toBeNull();
  });
});

describe('sender defaults (TW-AUTH-007)', () => {
  it('new WhatsApp Business senders start on Graph v23.0', () => {
    expect(DEFAULT_GRAPH_BASE_URL).toBe('https://graph.facebook.com/v23.0');
  });

  it('the fallback WhatsApp text bolds the code with asterisks, not italics', () => {
    const text = renderOtpText({
      templateBody: null,
      code: '482915',
      ttlMinutes: 10,
      appName: 'Acme',
    });
    expect(text.startsWith('*482915* is your Acme verification code.')).toBe(true);
    expect(text).not.toContain('_482915_');
    expect(text).toContain('10 minutes');
  });
});
