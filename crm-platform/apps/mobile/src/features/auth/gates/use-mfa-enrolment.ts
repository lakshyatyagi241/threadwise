import { ERROR_CODES, type MfaSetupResponse } from '@crm/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { enableMfa, startMfaSetup } from './gates-api';
import { setRecoveryCodes } from './recovery-codes-store';

export type MfaPhase =
  /** Asking the server for the authenticator key. */
  | 'starting'
  /** The key is shown and the person types the first code. */
  | 'ready'
  /** The session is older than ten minutes: the password is asked for before the key (or the code) is accepted. */
  | 'password'
  /** The setup ran out of time (ten minutes): start again for a new key. */
  | 'expired'
  /** The key could not be made (offline, a server problem): try again. */
  | 'failed';

const SIX_DIGITS = /^\d{6}$/;

/**
 * Enrolling an authenticator app on the required-two-factor lock screen (TW-AUTH-032), as the web's security page does: start (the
 * server answers with the key and an `otpauth` link), type the first code to turn it on, then save the recovery codes. A session that
 * signed in more than ten minutes ago must send the password first (403 AUTH_REAUTH_REQUIRED); it is asked for when the server says so,
 * kept only in memory, and dropped once it has worked. The key and the codes are never logged or stored.
 */
export function useMfaEnrolment() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<MfaPhase>('starting');
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const password = useRef<string | undefined>(undefined);
  // What to do once the password is in: make the key, or finish turning two-factor on with this code.
  const waiting = useRef<{ kind: 'start' } | { kind: 'enable'; code: string }>({ kind: 'start' });

  /** Asks the server for the key. The first run (when the screen opens) starts from the initial `starting` state. */
  const load = useCallback(async () => {
    try {
      setSetup(await startMfaSetup(password.current ? { password: password.current } : {}));
      setPasswordError(null);
      setPhase('ready');
    } catch (e) {
      if (isApiError(e) && e.code === ERROR_CODES.AUTH_REAUTH_REQUIRED) {
        waiting.current = { kind: 'start' };
        setPhase('password');
      } else if (isApiError(e) && e.code === ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG) {
        password.current = undefined;
        setPasswordError(t('gates.mfa.passwordWrong'));
        setPhase('password');
      } else {
        setBanner(messageForError(e, t));
        setPhase('failed');
      }
    }
  }, [t]);

  /** "Try again" and "Start again": back to the waiting state, then ask again. */
  const start = useCallback(async () => {
    setPhase('starting');
    setBanner(null);
    await load();
  }, [load]);

  useEffect(() => {
    void load();
    // Once, when the screen opens.
  }, [load]);

  const enable = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!SIX_DIGITS.test(trimmed)) {
        setCodeError(t('gates.mfa.codeInvalid'));
        return;
      }
      setCodeError(null);
      setBanner(null);
      setPending(true);
      try {
        const answer = await enableMfa({
          code: trimmed,
          ...(password.current ? { password: password.current } : {}),
        });
        // Holding the codes in memory keeps this screen up when the session says the gate is open (see recovery-codes-store).
        setRecoveryCodes(answer.recoveryCodes);
        password.current = undefined;
        setSetup(null);
      } catch (e) {
        if (isApiError(e) && e.code === ERROR_CODES.AUTH_MFA_INVALID_CODE) {
          setCodeError(t('gates.mfa.codeWrong'));
        } else if (isApiError(e) && e.code === ERROR_CODES.AUTH_MFA_SETUP_EXPIRED) {
          setSetup(null);
          setPhase('expired');
        } else if (isApiError(e) && e.code === ERROR_CODES.AUTH_REAUTH_REQUIRED) {
          waiting.current = { kind: 'enable', code: trimmed };
          setPhase('password');
        } else if (isApiError(e) && e.code === ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG) {
          password.current = undefined;
          waiting.current = { kind: 'enable', code: trimmed };
          setPasswordError(t('gates.mfa.passwordWrong'));
          setPhase('password');
        } else {
          setBanner(messageForError(e, t));
        }
      } finally {
        setPending(false);
      }
    },
    [t],
  );

  /** The password the server asked for: try what was waiting with it. */
  const submitPassword = useCallback(
    async (value: string) => {
      if (!value) {
        setPasswordError(t('gates.mfa.passwordRequired'));
        return;
      }
      setPasswordError(null);
      password.current = value;
      const what = waiting.current;
      if (what.kind === 'start') await start();
      else {
        setPhase('ready');
        await enable(what.code);
      }
    },
    [enable, start, t],
  );

  return { phase, setup, pending, codeError, passwordError, banner, start, enable, submitPassword };
}
