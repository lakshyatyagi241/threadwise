import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { useCountdown } from '@/features/auth/use-countdown';
import { resendVerification } from './gates-api';

/** The API sends one verification mail a minute; a mail that could not be sent costs the person no waiting. */
export const RESEND_COOLDOWN_SECONDS = 60;

export type ResendNotice = 'sent' | 'notSent' | 'alreadyVerified' | 'throttled';

/**
 * "Send the verification email again" with the throttle built in (TW-AUTH-015), as on the web: after a send, or when the API answers
 * 429, a countdown runs and the button waits; a failed send starts none. `onAlreadyVerified` runs when the answer says the address
 * was verified in the meantime.
 */
export function useResendVerification(onAlreadyVerified: () => void) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<ResendNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const seconds = useCountdown(endsAt);

  const wait = (secs: number) => setEndsAt(Date.now() + secs * 1000);

  const resend = useCallback(async () => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const answer = await resendVerification();
      if (answer.alreadyVerified) {
        setNotice('alreadyVerified');
        onAlreadyVerified();
      } else if (answer.sent) {
        setNotice('sent');
        setEndsAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
      } else {
        setNotice('notSent');
      }
    } catch (e) {
      const retryAfter = isApiError(e) ? e.retryAfterSeconds : undefined;
      if (retryAfter) {
        setNotice('throttled');
        wait(retryAfter);
      } else {
        setError(messageForError(e, t));
      }
    } finally {
      setPending(false);
    }
  }, [onAlreadyVerified, t]);

  return { resend, pending, notice, error, seconds };
}
