import { describe, expect, it } from 'vitest';
import { RecaptchaAdapter } from '../../../src/infra/providers/auth-registration-security/recaptcha.adapter';

/**
 * Opt-in network check of the real adapter against Google's siteverify using
 * Google's published reCAPTCHA v2 TEST secret (documented for automated tests;
 * it accepts any token). Run with `RECAPTCHA_LIVE=1 pnpm --filter @crm/api test`.
 * Proves the request shape and response handling against the real service; it
 * says nothing about a human passing the widget.
 */
const GOOGLE_V2_TEST_SECRET = '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe';

describe.skipIf(!process.env.RECAPTCHA_LIVE)(
  'RecaptchaAdapter against Google (test secret)',
  () => {
    it('accepts a token the test secret verifies', async () => {
      const ok = await new RecaptchaAdapter().verify(
        { version: 'v2', secret: GOOGLE_V2_TEST_SECRET, threshold: 0 },
        { token: 'any-token-the-test-secret-accepts', remoteIp: '127.0.0.1' },
      );
      expect(ok).toBe(true);
    });

    it('refuses a real secret that does not belong to the token', async () => {
      const ok = await new RecaptchaAdapter().verify(
        { version: 'v2', secret: 'not-a-real-secret', threshold: 0 },
        { token: 'x' },
      );
      expect(ok).toBe(false);
    });
  },
);
