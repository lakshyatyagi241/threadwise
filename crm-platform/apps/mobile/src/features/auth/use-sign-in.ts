import {
  ERROR_CODES,
  emailSchema,
  type PasswordLoginResponse,
  type WorkspaceChoice,
} from '@crm/contracts';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { startSession } from '@/lib/auth/session-manager';
import type { CountryCode } from 'libphonenumber-js';
import {
  resendPhoneSignIn,
  signInToWorkspace,
  signInWithMfa,
  signInWithPassword,
  startPhoneSignIn,
  verifyPhoneSignIn,
} from './api';
import { evaluatePhone } from './phone';
import type { VerifyResult } from './use-sign-up';

export type SignInStep =
  | { kind: 'credentials' }
  | { kind: 'phone' }
  | {
      kind: 'phoneCode';
      challengeId: string;
      /** "+91 •••• ••21": never the full number. */
      maskedPhone: string;
      codeLength: number;
      /** Epoch milliseconds: when the code stops working, and when "resend" unlocks. */
      expiresAt: number;
      resendAt: number;
    }
  | { kind: 'mfa'; challengeToken: string }
  | { kind: 'workspace'; selectionToken: string; workspaces: WorkspaceChoice[] };

export interface FieldErrors {
  email?: string;
  password?: string;
  phone?: string;
}

/**
 * The sign-in state machine: password, then (when the account asks for it) the authenticator code, or the workspace pick when the
 * same email and password open several. Mirrors what the web app does, answered by the same endpoints. A person can also sign in
 * with a mobile number: the number, then the code sent to it, and from there the same second factor and workspace pick as a password.
 *
 * "Keep me signed in" is always on for the phone: a phone is a personal device and re-typing a password on every launch is the
 * reason people stop opening an app. The server still ends the session on revocation, password change and workspace suspension.
 */
export function useSignIn() {
  const { t } = useTranslation();
  const [step, setStep] = useState<SignInStep>({ kind: 'credentials' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const busy = useRef(false);

  const apply = useCallback(async (answer: PasswordLoginResponse) => {
    switch (answer.status) {
      case 'authenticated':
        await startSession(answer.tokens);
        return;
      case 'mfa_required':
        setStep({ kind: 'mfa', challengeToken: answer.challengeToken });
        return;
      case 'workspace_required':
        setStep({
          kind: 'workspace',
          selectionToken: answer.selectionToken,
          workspaces: answer.workspaces,
        });
        return;
    }
  }, []);

  const messageFor = useCallback(
    (e: unknown): string => {
      if (isApiError(e)) {
        switch (e.code) {
          case ERROR_CODES.AUTH_INVALID_CREDENTIALS:
            return t('auth.invalidCredentials');
          case ERROR_CODES.AUTH_ACCOUNT_LOCKED:
            return t('auth.accountLocked');
          case ERROR_CODES.AUTH_ACCOUNT_SUSPENDED:
            return t('auth.accountSuspended');
          case ERROR_CODES.AUTH_MFA_INVALID_CODE:
            return t('auth.mfaInvalid');
          case ERROR_CODES.AUTH_MFA_CHALLENGE_EXPIRED:
            return t('auth.mfaExpired');
          // The platform asks for a CAPTCHA the app cannot produce yet (ADR-0023): say so, instead of a vague "something went wrong".
          case ERROR_CODES.AUTH_CAPTCHA_FAILED:
            return t('errors.captchaUnsupported');
          // The platform's code step is off or has no working sender: the phone door is shut, the email one is not.
          case ERROR_CODES.AUTH_OTP_SEND_FAILED:
            return t('auth.phone.unavailable');
        }
      }
      return messageForError(e, t);
    },
    [t],
  );

  const run = useCallback(
    async (action: () => Promise<PasswordLoginResponse>) => {
      setPending(true);
      setError(null);
      try {
        await apply(await action());
      } catch (e) {
        setError(messageFor(e));
        // The challenge or selection token is single use and short lived: after it expires there is nothing to retry, only to restart.
        if (isApiError(e) && e.code === ERROR_CODES.AUTH_MFA_CHALLENGE_EXPIRED) {
          setStep({ kind: 'credentials' });
        }
      } finally {
        setPending(false);
      }
    },
    [apply, messageFor],
  );

  const submitPassword = useCallback(
    async (email: string, password: string) => {
      const next: FieldErrors = {};
      const trimmed = email.trim();
      if (!emailSchema.safeParse(trimmed).success) next.email = t('auth.emailInvalid');
      if (!password) next.password = t('auth.passwordRequired');
      setFieldErrors(next);
      if (next.email || next.password) return;
      await run(() => signInWithPassword({ email: trimmed, password, remember: true }));
    },
    [run, t],
  );

  const submitCode = useCallback(
    async (code: string) => {
      if (step.kind !== 'mfa') return;
      const challengeToken = step.challengeToken;
      await run(() => signInWithMfa({ challengeToken, code }));
    },
    [run, step],
  );

  const pickWorkspace = useCallback(
    async (orgSlug: string) => {
      if (step.kind !== 'workspace') return;
      const selectionToken = step.selectionToken;
      await run(() => signInToWorkspace({ selectionToken, orgSlug }));
    },
    [run, step],
  );

  /** Opens the number step. */
  const showPhone = useCallback(() => {
    setStep({ kind: 'phone' });
    setError(null);
    setFieldErrors({});
  }, []);

  const submitPhone = useCallback(
    async (raw: string, country: CountryCode) => {
      // The keyboard's "go" key does not wait for the button's busy state: two quick presses would ask for two codes, and the
      // answer that came back last would decide which one the person is asked to type.
      if (busy.current) return;
      const checked = evaluatePhone(raw, country);
      if (!checked.e164) {
        setFieldErrors({ phone: t('signUp.validation.phoneInvalid') });
        return;
      }
      busy.current = true;
      setFieldErrors({});
      setPending(true);
      setError(null);
      setResent(false);
      try {
        const answer = await startPhoneSignIn({ phone: checked.e164, remember: true });
        const now = Date.now();
        setStep({
          kind: 'phoneCode',
          challengeId: answer.challengeId,
          maskedPhone: answer.maskedPhone,
          codeLength: answer.codeLength,
          expiresAt: now + answer.expiresInSeconds * 1000,
          resendAt: now + answer.resendCooldownSeconds * 1000,
        });
      } catch (e) {
        setError(messageFor(e));
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [messageFor, t],
  );

  /** The code. A right one goes on like a right password: the session, the second factor, or the workspace pick (`apply`). */
  const submitPhoneCode = useCallback(
    async (code: string): Promise<VerifyResult> => {
      if (step.kind !== 'phoneCode' || busy.current) return 'keep';
      if (!new RegExp(`^\\d{${step.codeLength}}$`).test(code)) {
        setError(t('signUp.otp.codeInvalid', { length: step.codeLength }));
        return 'keep';
      }
      busy.current = true;
      setPending(true);
      setError(null);
      setResent(false);
      try {
        await apply(await verifyPhoneSignIn({ challengeId: step.challengeId, code }));
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
        busy.current = false;
        setPending(false);
      }
    },
    [apply, messageFor, step, t],
  );

  const resendPhoneCode = useCallback(async () => {
    if (step.kind !== 'phoneCode' || resending) return;
    setResending(true);
    setError(null);
    setResent(false);
    try {
      const answer = await resendPhoneSignIn({ challengeId: step.challengeId });
      const now = Date.now();
      setStep((s) =>
        s.kind === 'phoneCode'
          ? {
              ...s,
              expiresAt: now + answer.expiresInSeconds * 1000,
              resendAt: now + answer.resendCooldownSeconds * 1000,
            }
          : s,
      );
      setResent(true);
    } catch (e) {
      if (isApiError(e) && e.code === ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN) {
        // The server knows how long is left (our own clock may be off): follow it.
        const wait = e.retryAfterSeconds;
        if (wait) {
          setStep((s) =>
            s.kind === 'phoneCode' ? { ...s, resendAt: Date.now() + wait * 1000 } : s,
          );
        }
        setError(t('signUp.otp.cooldown'));
      } else if (isApiError(e) && e.code === ERROR_CODES.AUTH_OTP_EXPIRED) {
        // The challenge is gone (it only lives a few minutes): nothing is left to resend, so ask for the number again.
        setStep({ kind: 'phone' });
        setError(t('signUp.otp.expired'));
      } else {
        setError(messageFor(e));
      }
    } finally {
      setResending(false);
    }
  }, [messageFor, resending, step, t]);

  const restart = useCallback(() => {
    setStep({ kind: 'credentials' });
    setError(null);
    setFieldErrors({});
    setResent(false);
  }, []);

  return {
    step,
    pending,
    resending,
    resent,
    error,
    fieldErrors,
    submitPassword,
    submitCode,
    pickWorkspace,
    showPhone,
    submitPhone,
    submitPhoneCode,
    resendPhoneCode,
    restart,
  };
}
