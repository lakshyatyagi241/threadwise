import { describe, expect, it } from 'vitest';
import { mailFailureReasonSchema } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { resendOutcome } from './resend-outcome';

describe('resendOutcome', () => {
  it('starts the wait only for a mail that was really sent', () => {
    expect(resendOutcome({ sent: true, alreadyVerified: false })).toEqual({
      notice: 'sent',
      reason: null,
      cooldown: true,
    });
  });

  it('starts no wait after a failed send and passes the reason on', () => {
    expect(resendOutcome({ sent: false, alreadyVerified: false, reason: 'auth_failed' })).toEqual({
      notice: 'notSent',
      reason: 'auth_failed',
      cooldown: false,
    });
  });

  it('names an unknown reason when an older API sends none', () => {
    expect(resendOutcome({ sent: false, alreadyVerified: false })).toEqual({
      notice: 'notSent',
      reason: 'unknown',
      cooldown: false,
    });
  });

  it('does not wait or complain when the address is already verified', () => {
    expect(resendOutcome({ sent: false, alreadyVerified: true })).toEqual({
      notice: 'alreadyVerified',
      reason: null,
      cooldown: false,
    });
  });
});

describe('mail failure reasons', () => {
  it('has a sentence in both languages for every reason the API can send', () => {
    for (const locale of ['en', 'ar'] as const) {
      const account = (
        loadMessages(locale) as {
          'auth-registration-security': { account: { mailFailure: Record<string, string> } };
        }
      )['auth-registration-security'].account.mailFailure;
      for (const reason of mailFailureReasonSchema.options) {
        expect(account[reason], `${locale}:${reason}`).toBeTruthy();
      }
    }
  });

  it('drops no part of the API answer: the web parse keeps the reason', async () => {
    const { resendVerificationResponseSchema } = await import('@crm/contracts');
    expect(
      resendVerificationResponseSchema.parse({
        sent: false,
        alreadyVerified: false,
        reason: 'timeout',
      }),
    ).toMatchObject({ reason: 'timeout' });
  });
});
