'use client';

import { signupResendOtpResponseSchema } from '@crm/contracts';
import { Alert, Button, Input, Spinner } from '@crm/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { callApi, postBff } from './bff';
import { formatClock } from './countdown';
import { mapAuthError, type MappedError } from './errors';
import { focusField } from './focus';
import { FormError } from './form-error';
import { FormField } from './form-field';
import {
  cleanCode,
  clearChallenge,
  codePattern,
  defaultStore,
  parseChallenge,
  readChallengeRaw,
  saveChallenge,
  type StoredChallenge,
} from './otp-challenge';
import { forgetReferral } from './referral';
import { bffAuthenticatedSchema } from './schemas';
import { completeSignIn } from './sign-in-complete';
import { useCountdown } from './use-countdown';

/**
 * Sign-up WhatsApp code check (TW-AUTH-006). The pending sign-up lives on the server; this page only keeps
 * the non-secret challenge data (id, masked number, deadlines) in sessionStorage so a reload keeps its place.
 */
const noopSubscribe = () => () => undefined;
const UNREAD = Symbol('unread');

export function OtpForm() {
  const router = useRouter();
  // sessionStorage only exists in the browser: the server render (and hydration) sees `UNREAD`, never "empty".
  const raw = useSyncExternalStore<string | null | typeof UNREAD>(
    noopSubscribe,
    () => readChallengeRaw(defaultStore()),
    () => UNREAD,
  );
  const challenge = useMemo(() => (raw === UNREAD ? null : parseChallenge(raw)), [raw]);
  const missing = raw !== UNREAD && challenge === null;

  useEffect(() => {
    // Nothing to verify (opened directly, or the tab was closed): start over, like Reference does.
    if (missing) router.replace('/signup?restart=1');
  }, [missing, router]);

  if (!challenge) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  return <OtpEntry initial={challenge} />;
}

function OtpEntry({ initial }: { initial: StoredChallenge }) {
  const t = useTranslations('auth-registration-security.guest.otp');
  const tv = useTranslations('auth-registration-security.guest.validation');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [challenge, setChallenge] = useState(initial);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const expiresIn = useCountdown(challenge.expiresAt);
  const resendIn = useCountdown(challenge.resendAt);
  const te = useTranslations('auth-registration-security.guest.errors');

  useEffect(() => {
    focusField(form.current, 'code');
  }, []);

  function restart() {
    clearChallenge();
    router.replace('/signup?restart=1');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setResent(false);
    if (!codePattern(challenge.codeLength).test(code)) {
      setFieldError(tv('code', { length: challenge.codeLength }));
      focusField(form.current, 'code');
      return;
    }
    setFieldError(null);
    setPending(true);
    try {
      const res = await postBff(
        'signup-otp',
        { challengeId: challenge.challengeId, code },
        bffAuthenticatedSchema,
      );
      clearChallenge();
      forgetReferral();
      completeSignIn(res);
    } catch (err) {
      const mapped = mapAuthError(err);
      // The staged sign-up is gone (it lives 30 minutes): nothing left to verify.
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
      const res = await callApi('/auth/signup/resend-otp', {
        method: 'POST',
        body: { challengeId: challenge.challengeId },
        schema: signupResendOtpResponseSchema,
      });
      const now = Date.now();
      const next: StoredChallenge = {
        ...challenge,
        expiresAt: now + res.expiresInSeconds * 1000,
        resendAt: now + res.resendCooldownSeconds * 1000,
      };
      saveChallenge(next);
      setChallenge(next);
      setCode('');
      setResent(true);
      focusField(form.current, 'code');
    } catch (err) {
      const mapped = mapAuthError(err);
      // The staged sign-up is gone (it lives 30 minutes): nothing left to resend for.
      if (mapped.key === 'signupExpired') return restart();
      if (mapped.key === 'otpCooldown' && mapped.retryAfterSeconds) {
        // The server knows how long is left (our own clock may have been off): follow it.
        const next: StoredChallenge = {
          ...challenge,
          resendAt: Date.now() + mapped.retryAfterSeconds * 1000,
        };
        saveChallenge(next);
        setChallenge(next);
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
      className="space-y-5"
    >
      <p className="text-sm text-muted-foreground">
        {t('sentTo')}{' '}
        <span dir="ltr" className="font-medium text-foreground">
          {challenge.maskedPhone}
        </span>
      </p>

      {resent && <Alert tone="success">{t('resent')}</Alert>}
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
            placeholder={'0'.repeat(challenge.codeLength)}
            onChange={(e) => setCode(cleanCode(e.target.value, challenge.codeLength))}
            className="h-12 text-center font-mono text-xl tracking-[0.4em]"
          />
        )}
      </FormField>

      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending && <Spinner label={t('verifying')} />}
        {pending ? t('verifying') : t('verify')}
      </Button>

      <div className="flex flex-col items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={resending || resendIn > 0}
          className="font-medium text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
        >
          {resending
            ? t('resending')
            : resendIn > 0
              ? t('resendIn', { time: formatClock(resendIn) })
              : t('resend')}
        </button>
        <p className="text-muted-foreground">
          {t('wrongNumber')}{' '}
          <Link
            href="/signup"
            onClick={() => clearChallenge()}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {t('goBack')}
          </Link>
        </p>
      </div>
    </form>
  );
}
