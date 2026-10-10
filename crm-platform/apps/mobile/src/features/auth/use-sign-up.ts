import { ERROR_CODES } from '@crm/contracts';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { startSession } from '@/lib/auth/session-manager';
import { resendSignUpOtp, signUp, verifySignUpOtp } from './api';
import { maskPhone } from './phone';
import { mapSignUpError } from './sign-up-errors';
import {
  SIGN_UP_FIELD_ORDER,
  validateSignUp,
  type SignUpField,
  type SignUpRules,
  type SignUpValues,
} from './sign-up-validation';

export type SignUpStep =
  | { kind: 'form' }
  | {
      kind: 'otp';
      challengeId: string;
      /** "+91 •••• ••21", built from the number the person typed. */
      maskedPhone: string;
      codeLength: number;
      /** Epoch milliseconds: when the code stops working, and when "resend" unlocks. */
      expiresAt: number;
      resendAt: number;
    };

/** What the code field should do after a try: leave the form (`done`), empty itself (`clear`) or keep what was typed (`keep`). */
export type VerifyResult = 'done' | 'clear' | 'keep';

type FieldMessages = Partial<Record<SignUpField, string>>;

interface BackToForm {
  banner?: string | null;
  fields?: FieldMessages;
  openSlug?: boolean;
}

/**
 * The sign-up state machine (TW-AUTH-005, TW-AUTH-006): the form, then, when the platform asks for a WhatsApp code, the code step.
 * Nothing exists on the server until the form is accepted (without a code) or the code is confirmed (with one). Answered by the
 * same endpoints as the web, parsed with the same contract schemas.
 *
 * The form's values live in the screen, not here, so going back from the code step ("wrong number?") keeps everything typed.
 */
export function useSignUp() {
  const { t } = useTranslation();
  const [step, setStep] = useState<SignUpStep>({ kind: 'form' });
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldMessages>({});
  const [slugConflict, setSlugConflict] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  // A second tap before the first answer arrives must not send a second request; state alone would still say "not pending".
  const busy = useRef(false);

  const backToForm = useCallback((failure: BackToForm) => {
    setStep({ kind: 'form' });
    setCodeError(null);
    setResent(false);
    setBanner(failure.banner ?? null);
    setFieldErrors(failure.fields ?? {});
    setSlugConflict(Boolean(failure.openSlug));
  }, []);

  /** Resolves to the field the screen should move focus to (the first one with a problem), or null when nothing is wrong. */
  const submit = useCallback(
    async (values: SignUpValues, rules: SignUpRules): Promise<SignUpField | null> => {
      if (busy.current) return null;
      setBanner(null);

      const checked = validateSignUp(values, rules);
      if (!checked.ok) {
        const messages: FieldMessages = {};
        for (const field of SIGN_UP_FIELD_ORDER) {
          const issue = checked.issues[field];
          if (issue) messages[field] = t(issue.key, issue.params);
        }
        setFieldErrors(messages);
        return checked.firstInvalid;
      }

      setFieldErrors({});
      busy.current = true;
      setPending(true);
      try {
        const answer = await signUp(checked.body);
        if (answer.status === 'authenticated') {
          await startSession(answer.tokens);
          return null;
        }
        const now = Date.now();
        setStep({
          kind: 'otp',
          challengeId: answer.challengeId,
          maskedPhone: checked.body.phone ? maskPhone(checked.body.phone) : answer.maskedPhone,
          codeLength: answer.codeLength,
          expiresAt: now + answer.expiresInSeconds * 1000,
          resendAt: now + answer.resendCooldownSeconds * 1000,
        });
        return null;
      } catch (e) {
        const failure = mapSignUpError(e, t);
        setBanner(failure.banner);
        setFieldErrors(failure.fields);
        if (failure.openSlug) setSlugConflict(true);
        return SIGN_UP_FIELD_ORDER.find((field) => failure.fields[field]) ?? null;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [t],
  );

  const verify = useCallback(
    async (code: string): Promise<VerifyResult> => {
      if (step.kind !== 'otp' || busy.current) return 'keep';
      if (!new RegExp(`^\\d{${step.codeLength}}$`).test(code)) {
        setCodeError(t('signUp.otp.codeInvalid', { length: step.codeLength }));
        return 'keep';
      }

      busy.current = true;
      setPending(true);
      setCodeError(null);
      setResent(false);
      try {
        const answer = await verifySignUpOtp({ challengeId: step.challengeId, code });
        await startSession(answer.tokens);
        return 'done';
      } catch (e) {
        if (isApiError(e)) {
          switch (e.code) {
            case ERROR_CODES.AUTH_OTP_INVALID:
              setCodeError(t('signUp.otp.invalid'));
              return 'clear';
            case ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS:
              setCodeError(t('signUp.otp.tooMany'));
              return 'clear';
            case ERROR_CODES.AUTH_OTP_EXPIRED:
              setCodeError(t('signUp.otp.expired'));
              return 'keep';
            // The pending sign-up is gone (it only lives a while): nothing is left to verify, so start over.
            case ERROR_CODES.AUTH_SIGNUP_EXPIRED:
              backToForm({ banner: t('signUp.errors.signupExpired') });
              return 'keep';
            // Somebody took the address while the code was on its way: the person picks another one on the form.
            case ERROR_CODES.AUTH_SLUG_TAKEN:
              backToForm({
                banner: t('signUp.otp.addressTakenHint'),
                fields: { orgSlug: t('signUp.errors.slugTaken') },
                openSlug: true,
              });
              return 'keep';
            case ERROR_CODES.AUTH_EMAIL_TAKEN:
              backToForm({ fields: { email: t('signUp.errors.emailTaken') } });
              return 'keep';
          }
        }
        setCodeError(messageForError(e, t));
        return 'keep';
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [backToForm, step, t],
  );

  const resend = useCallback(async () => {
    if (step.kind !== 'otp' || resending) return;
    setResending(true);
    setCodeError(null);
    setResent(false);
    try {
      const answer = await resendSignUpOtp({ challengeId: step.challengeId });
      const now = Date.now();
      setStep((s) =>
        s.kind === 'otp'
          ? {
              ...s,
              expiresAt: now + answer.expiresInSeconds * 1000,
              resendAt: now + answer.resendCooldownSeconds * 1000,
            }
          : s,
      );
      setResent(true);
    } catch (e) {
      if (isApiError(e) && e.code === ERROR_CODES.AUTH_SIGNUP_EXPIRED) {
        backToForm({ banner: t('signUp.errors.signupExpired') });
      } else if (isApiError(e) && e.code === ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN) {
        // The server knows how long is left (our own clock may be off): follow it.
        const wait = e.retryAfterSeconds;
        if (wait) {
          setStep((s) => (s.kind === 'otp' ? { ...s, resendAt: Date.now() + wait * 1000 } : s));
        }
        setCodeError(t('signUp.otp.cooldown'));
      } else {
        setCodeError(messageForError(e, t));
      }
    } finally {
      setResending(false);
    }
  }, [backToForm, resending, step, t]);

  const goBackToForm = useCallback(() => backToForm({}), [backToForm]);

  /** A field the person is editing is no longer wrong: its message goes away as soon as they type. */
  const clearFieldError = useCallback((field: SignUpField) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  return {
    step,
    pending,
    resending,
    banner,
    fieldErrors,
    slugConflict,
    codeError,
    resent,
    submit,
    verify,
    resend,
    goBackToForm,
    clearFieldError,
  };
}
