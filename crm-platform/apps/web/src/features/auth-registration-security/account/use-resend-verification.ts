'use client';

import type { MailFailureReasonCode } from '@crm/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { redirectOnGateError } from '../shared/gate-errors';
import { retryAfterSeconds } from '../shared/error-utils';
import { useCountdown } from '../shared/use-countdown';
import { authApi } from './api';
import { resendOutcome, type ResendNotice } from './resend-outcome';

/** The API throttles verification mail to one per minute (Reference had no limit). */
export const RESEND_COOLDOWN_SECONDS = 60;

export type { ResendNotice };

/**
 * "Resend the verification email" with the throttle built in: after a send, or
 * when the API answers 429, the countdown runs from `retryAfterSeconds`. A mail
 * that could not be sent starts no countdown and comes back with the reason. Shared
 * by the banner and the lock screen so both behave the same (TW-AUTH-015).
 */
export function useResendVerification(options: { onAlreadyVerified?: () => void } = {}) {
  const { onAlreadyVerified } = options;
  const router = useRouter();
  const countdown = useCountdown();
  const { start } = countdown;
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<ResendNotice | null>(null);
  const [reason, setReason] = useState<MailFailureReasonCode | null>(null);
  const [error, setError] = useState<unknown>(null);

  const resend = useCallback(async () => {
    setPending(true);
    setError(null);
    setNotice(null);
    setReason(null);
    try {
      const outcome = resendOutcome(await authApi.resendVerification());
      setNotice(outcome.notice);
      setReason(outcome.reason);
      if (outcome.notice === 'alreadyVerified') onAlreadyVerified?.();
      else if (outcome.cooldown) start(RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      if (redirectOnGateError(e, router.replace)) return;
      const wait = retryAfterSeconds(e);
      if (wait) {
        setNotice('throttled');
        start(wait);
      } else {
        setError(e);
      }
    } finally {
      setPending(false);
    }
  }, [router, start, onAlreadyVerified]);

  return {
    resend,
    pending,
    notice,
    /** Why the last send failed (only while `notice` is `notSent`). */
    reason,
    error,
    seconds: countdown.seconds,
    throttled: countdown.active,
  };
}
