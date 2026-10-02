'use client';

import { signupResendOtpResponseSchema } from '@crm/contracts';
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
import { bffAuthenticatedSchema } from './schemas';
import { completeSignIn } from './sign-in-complete';
import { clearDraft } from './signup-draft';
import { Alert, ArrowIcon, Button, Input, LINK, PRIMARY_LINK, Spinner, cn } from './ui';
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
      <div className="flex justify-center py-8 text-(--auth-ink-500)">
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

  const addressTaken = error?.key === 'slugTaken';

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
      clearDraft();
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
      className="space-y-4"
    >
      <p className="text-[12.5px] text-(--auth-ink-600)">
        {t('sentTo')}{' '}
        <span dir="ltr" className="font-semibold text-foreground">
          {challenge.maskedPhone}
        </span>
      </p>

      {resent && <Alert tone="success">{t('resent')}</Alert>}
      <FormError error={error} skipFieldMessage={error?.field === 'code'} />
      {addressTaken && (
        <div className="space-y-2">
          <p className="text-[12.5px] text-(--auth-ink-600)">{t('addressTakenHint')}</p>
          <Link
            href="/signup?back=1&slug=taken"
            onClick={() => clearChallenge()}
            className={PRIMARY_LINK}
          >
            {t('chooseAnotherAddress')}
          </Link>
        </div>
      )}

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
            className="py-3 text-center font-mono text-[22px] tracking-[0.4em]"
          />
        )}
      </FormField>

      <Button type="submit" className="w-full" disabled={pending || addressTaken}>
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
          href="/signup?back=1"
          onClick={() => clearChallenge()}
          className="text-(--auth-ink-500) hover:text-foreground"
        >
          {t('wrongNumber')} {t('goBack')}
        </Link>
      </div>
    </form>
  );
}
