import { ERROR_CODES } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VerifyResult } from '@/components/ui/otp-step';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import {
  confirmPhoneVerification,
  resendPhoneVerification,
  startPhoneVerification,
} from './profile-api';
import { profileKey } from './use-profile';

/** The code that was sent: what the code step shows (a masked number, how long it lives, when a new one can be asked for). */
export interface PendingCode {
  maskedPhone: string;
  codeLength: number;
  /** Epoch milliseconds: when the code stops working, and when "resend" unlocks. */
  expiresAt: number;
  resendAt: number;
}

/**
 * Verifying the number on the person's own profile: ask for a code, type it, and the number counts as verified (so it can sign in).
 * A right code changes the profile on the server, so the saved profile is read again to show "Verified".
 */
export function usePhoneVerification() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const guard = useRef(false);

  const messageFor = useCallback(
    (e: unknown): string => {
      // The platform's code step is off or the sender is down: the person is told plainly, not "something went wrong".
      if (isApiError(e) && e.code === ERROR_CODES.AUTH_OTP_SEND_FAILED) {
        return t('menu.profile.verifyUnavailable');
      }
      return messageForError(e, t);
    },
    [t],
  );

  const start = useCallback(async () => {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    setDone(false);
    setResent(false);
    try {
      const answer = await startPhoneVerification();
      const now = Date.now();
      setPending({
        maskedPhone: answer.maskedPhone,
        codeLength: answer.codeLength,
        expiresAt: now + answer.expiresInSeconds * 1000,
        resendAt: now + answer.resendCooldownSeconds * 1000,
      });
    } catch (e) {
      setError(messageFor(e));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }, [messageFor]);

  const confirm = useCallback(
    async (code: string): Promise<VerifyResult> => {
      if (!pending || guard.current) return 'keep';
      if (!new RegExp(`^\\d{${pending.codeLength}}$`).test(code)) {
        setError(t('signUp.otp.codeInvalid', { length: pending.codeLength }));
        return 'keep';
      }
      guard.current = true;
      setBusy(true);
      setError(null);
      setResent(false);
      try {
        await confirmPhoneVerification({ code });
        await queryClient.invalidateQueries({ queryKey: profileKey });
        setPending(null);
        setDone(true);
        return 'done';
      } catch (e) {
        if (isApiError(e)) {
          switch (e.code) {
            case ERROR_CODES.AUTH_OTP_INVALID:
              setError(t('signUp.otp.invalid'));
              return 'clear';
            case ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS:
              setError(t('signUp.otp.tooMany'));
              return 'clear';
            case ERROR_CODES.AUTH_OTP_EXPIRED:
              setError(t('signUp.otp.expired'));
              return 'keep';
          }
        }
        setError(messageFor(e));
        return 'keep';
      } finally {
        guard.current = false;
        setBusy(false);
      }
    },
    [messageFor, pending, queryClient, t],
  );

  const resend = useCallback(async () => {
    if (!pending || resending) return;
    setResending(true);
    setError(null);
    setResent(false);
    try {
      const answer = await resendPhoneVerification();
      const now = Date.now();
      setPending((p) =>
        p
          ? {
              ...p,
              expiresAt: now + answer.expiresInSeconds * 1000,
              resendAt: now + answer.resendCooldownSeconds * 1000,
            }
          : p,
      );
      setResent(true);
    } catch (e) {
      if (isApiError(e) && e.code === ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN) {
        // The server knows how long is left (our own clock may be off): follow it.
        const wait = e.retryAfterSeconds;
        if (wait) setPending((p) => (p ? { ...p, resendAt: Date.now() + wait * 1000 } : p));
        setError(t('signUp.otp.cooldown'));
      } else if (isApiError(e) && e.code === ERROR_CODES.AUTH_OTP_EXPIRED) {
        // The request is gone (it only lives a few minutes) or the number changed: back to the profile.
        setPending(null);
        setError(t('signUp.otp.expired'));
      } else {
        setError(messageFor(e));
      }
    } finally {
      setResending(false);
    }
  }, [messageFor, pending, resending, t]);

  const cancel = useCallback(() => {
    setPending(null);
    setError(null);
    setResent(false);
  }, []);

  return { pending, busy, resending, resent, error, done, start, confirm, resend, cancel };
}
