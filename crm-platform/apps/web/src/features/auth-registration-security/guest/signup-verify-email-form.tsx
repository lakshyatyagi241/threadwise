'use client';

import {
  signupResendEmailCodeResponseSchema,
  signupVerifyEmailCodeResponseSchema,
} from '@crm/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { callApi } from './bff';
import { cleanCode, codePattern } from './otp-challenge';
import { formatClock } from './countdown';
import { mapAuthError, type MappedError } from './errors';
import { focusField } from './focus';
import { FormError } from './form-error';
import { FormField } from './form-field';
import {
  clearSignupStage,
  defaultStore,
  parseSignupStage,
  readSignupStageRaw,
  saveSignupStage,
  type StoredSignupStage,
} from './signup-challenge';
import { Alert, ArrowIcon, Button, Input, LINK, Spinner, cn } from './ui';
import { useCountdown } from './use-countdown';

/**
 * Sign-up step 2 of 3: check the code sent to the visitor's email (TW-AUTH-006 email-verification redesign).
 * The pending sign-up lives on the server; this page only keeps the non-secret stage data (token, masked
 * email, deadlines) in sessionStorage so a reload keeps its place. Modeled closely on `otp-form.tsx`.
 */
const noopSubscribe = () => () => undefined;
const UNREAD = Symbol('unread');

export function SignupVerifyEmailForm() {
  const router = useRouter();
  // sessionStorage only exists in the browser: the server render (and hydration) sees `UNREAD`, never "empty".
  const raw = useSyncExternalStore<string | null | typeof UNREAD>(
    noopSubscribe,
    () => readSignupStageRaw(defaultStore()),
    () => UNREAD,
  );
  const stage = useMemo(() => (raw === UNREAD ? null : parseSignupStage(raw)), [raw]);
  const missing = raw !== UNREAD && stage === null;

  useEffect(() => {
    // Nothing to verify (opened directly, or the tab was closed): start over.
    if (missing) router.replace('/signup');
  }, [missing, router]);

  if (!stage) {
    return (
      <div className="flex justify-center py-8 text-(--auth-ink-500)">
        <Spinner />
      </div>
    );
  }
  return <VerifyEmailEntry initial={stage} />;
}

/** Exported (alongside `SignupVerifyEmailForm`) so a render test can drive it without touching sessionStorage. */
export function VerifyEmailEntry({ initial }: { initial: StoredSignupStage }) {
  const t = useTranslations('auth-registration-security.guest.otp');
  const tv = useTranslations('auth-registration-security.guest.validation');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [stage, setStage] = useState(initial);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const expiresIn = useCountdown(stage.expiresAt);
  const resendIn = useCountdown(stage.resendAt);
  const te = useTranslations('auth-registration-security.guest.errors');

  useEffect(() => {
    focusField(form.current, 'code');
  }, []);

  function restart() {
    clearSignupStage();
    router.replace('/signup');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setResent(false);
    if (!codePattern(stage.codeLength).test(code)) {
      setFieldError(tv('code', { length: stage.codeLength }));
      focusField(form.current, 'code');
      return;
    }
    setFieldError(null);
    setPending(true);
    try {
      await callApi('/auth/signup/verify-email-code', {
        method: 'POST',
        body: { token: stage.token, code },
        schema: signupVerifyEmailCodeResponseSchema,
      });
      // The token is still needed by the password step: the stage stays until the account exists.
      router.push('/signup/password');
    } catch (err) {
      const mapped = mapAuthError(err);
      // The staged sign-up is gone (it lives a limited time, or was consumed by a race): nothing left to verify.
      if (mapped.key === 'signupExpired') return restart();
      setError(mapped);
      setPending(false);
      if (mapped.key === 'otpInvalid') setCode('');
      focusField(form.current, 'code');
    }
  }

  async function resend() {
    if (resending || resendIn > 0) return;
    setError(null);
    setResent(false);
    setResending(true);
    try {
      const res = await callApi('/auth/signup/resend-email-code', {
        method: 'POST',
        body: { token: stage.token },
        schema: signupResendEmailCodeResponseSchema,
      });
      const now = Date.now();
      const next: StoredSignupStage = {
        ...stage,
        expiresAt: now + res.expiresInSeconds * 1000,
        resendAt: now + res.resendCooldownSeconds * 1000,
      };
      saveSignupStage(next);
      setStage(next);
      setCode('');
      setResent(true);
      focusField(form.current, 'code');
    } catch (err) {
      const mapped = mapAuthError(err);
      // The staged sign-up is gone (it lives a limited time): nothing left to resend for.
      if (mapped.key === 'signupExpired') return restart();
      if (mapped.key === 'otpCooldown' && mapped.retryAfterSeconds) {
        // The server knows how long is left (our own clock may have been off): follow it.
        const next: StoredSignupStage = {
          ...stage,
          resendAt: Date.now() + mapped.retryAfterSeconds * 1000,
        };
        saveSignupStage(next);
        setStage(next);
      }
      setError(mapped);
    } finally {
      setResending(false);
    }
  }

  const inlineError = error && error.field === 'code' ? te(error.key, error.params) : fieldError;

  return (
    <form
      method="post"
      ref={form}
      onSubmit={(e) => void onSubmit(e)}
      onInput={() => setFieldError(null)}
      noValidate
      className="space-y-4"
    >
      <p className="text-[12.5px] text-(--auth-ink-600)">
        {t('sentTo')}{' '}
        <span dir="ltr" className="font-semibold text-foreground">
          {stage.maskedEmail}
        </span>
      </p>

      {resent && <Alert tone="success">{t('resentEmail')}</Alert>}
      <FormError error={error} skipFieldMessage={error?.field === 'code'} />

      <FormField
        label={t('code')}
        error={inlineError}
        hint={expiresIn > 0 ? t('expiresIn', { time: formatClock(expiresIn) }) : t('expired')}
      >
        {(p) => (
          <Input
            {...p}
            name="code"
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            placeholder={'0'.repeat(stage.codeLength)}
            onChange={(e) => setCode(cleanCode(e.target.value, stage.codeLength))}
            className="py-3 text-center font-mono text-[22px] tracking-[0.4em]"
          />
        )}
      </FormField>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Spinner label={t('verifying')} /> : null}
        {pending ? t('verifying') : t('verify')}
        {!pending && <ArrowIcon />}
      </Button>

      <div className="mt-1 flex items-center justify-between gap-3 text-[12px]">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={resending || resendIn > 0}
          className={cn(
            LINK,
            'disabled:cursor-not-allowed disabled:font-normal disabled:text-(--auth-ink-500) disabled:no-underline',
          )}
        >
          {resending
            ? t('resending')
            : resendIn > 0
              ? t('resendIn', { time: formatClock(resendIn) })
              : t('resend')}
        </button>
        <Link
          href="/signup"
          onClick={() => clearSignupStage()}
          className="text-(--auth-ink-500) hover:text-foreground"
        >
          {t('wrongEmail')} {t('goBack')}
        </Link>
      </div>
    </form>
  );
}
