'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { redirectOnGateError } from '../shared/gate-errors';
import { retryAfterSeconds } from '../shared/error-utils';
import { useCountdown } from '../shared/use-countdown';
import { authApi } from './api';

/** The API throttles verification mail to one per minute (WaDesk had no limit). */
export const RESEND_COOLDOWN_SECONDS = 60;

export type ResendNotice = 'sent' | 'notSent' | 'alreadyVerified' | 'throttled';

/**
 * "Resend the verification email" with the throttle built in: after a send, or
 * when the API answers 429, the countdown runs from `retryAfterSeconds`. Shared
 * by the banner and the lock screen so both behave the same (WD-AUTH-015).
 */
export function useResendVerification(options: { onAlreadyVerified?: () => void } = {}) {
  const { onAlreadyVerified } = options;
  const router = useRouter();
  const countdown = useCountdown();
  const { start } = countdown;
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<ResendNotice | null>(null);
  const [error, setError] = useState<unknown>(null);

  const resend = useCallback(async () => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await authApi.resendVerification();
      if (result.alreadyVerified) {
        setNotice('alreadyVerified');
        onAlreadyVerified?.();
        return;
      }
      setNotice(result.sent ? 'sent' : 'notSent');
      start(RESEND_COOLDOWN_SECONDS);
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
    error,
    seconds: countdown.seconds,
    throttled: countdown.active,
  };
}
