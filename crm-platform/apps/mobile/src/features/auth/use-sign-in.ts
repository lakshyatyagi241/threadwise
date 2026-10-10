import {
  ERROR_CODES,
  emailSchema,
  type PasswordLoginResponse,
  type WorkspaceChoice,
} from '@crm/contracts';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { startSession } from '@/lib/auth/session-manager';
import { signInToWorkspace, signInWithMfa, signInWithPassword } from './api';

export type SignInStep =
  | { kind: 'credentials' }
  | { kind: 'mfa'; challengeToken: string }
  | { kind: 'workspace'; selectionToken: string; workspaces: WorkspaceChoice[] };

export interface FieldErrors {
  email?: string;
  password?: string;
}

/**
 * The sign-in state machine: password, then (when the account asks for it) the authenticator code, or the workspace pick when the
 * same email and password open several. Mirrors what the web app does, answered by the same endpoints.
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

  const restart = useCallback(() => {
    setStep({ kind: 'credentials' });
    setError(null);
    setFieldErrors({});
  }, []);

  return { step, pending, error, fieldErrors, submitPassword, submitCode, pickWorkspace, restart };
}
