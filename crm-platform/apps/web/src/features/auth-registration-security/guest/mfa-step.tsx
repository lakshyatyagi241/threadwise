'use client';

import { webauthnOptionsResponseSchema } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api/errors';
import { KeyIcon } from '../shared/icons';
import { assertPasskey, usePasskeySupport } from '../shared/passkeys/passkey-browser';
import { classifyPasskeyError } from '../shared/passkeys/passkey-failure';
import { focusField } from './focus';
import { callApi, postBff } from './bff';
import { formatClock } from './countdown';
import { mapAuthError, type MappedError } from './errors';
import { FormError } from './form-error';
import { FormField } from './form-field';
import { bffAuthenticatedSchema } from './schemas';
import { completeSignIn } from './sign-in-complete';
import { Alert, ArrowIcon, Button, Input, LINK, Spinner, cn } from './ui';
import { useCountdown } from './use-countdown';

/**
 * Second factor at sign-in: the six-digit authenticator code, or one of the single-use
 * recovery codes, or a passkey when the person has one. The challenge lives about five minutes;
 * when it lapses the visitor starts over.
 */
export function MfaStep({
  challengeToken,
  expiresAt,
  remember,
  orgSlug,
  next,
  passkey = false,
  onBack,
}: {
  challengeToken: string;
  /** Epoch ms when the challenge stops being valid. */
  expiresAt: number;
  remember: boolean;
  orgSlug?: string;
  next?: string | null;
  /** The sign-in answer said this person has a passkey: offer it next to the code. */
  passkey?: boolean;
  /** Back to the credentials step; `expired` explains why when the challenge lapsed. */
  onBack: (reason?: 'expired') => void;
}) {
  const t = useTranslations('auth-registration-security.guest.mfa');
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [viaPasskey, setViaPasskey] = useState(false);
  const [passkeyProblem, setPasskeyProblem] = useState<'cancelled' | 'failed' | null>(null);
  const passkeySupported = usePasskeySupport();
  const showPasskey = passkey && passkeySupported;
  const [error, setError] = useState<MappedError | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const left = useCountdown(expiresAt);
  // Too many wrong codes: the API says how long to wait. Submitting again before then only renews the refusal.
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const lockLeft = useCountdown(lockedUntil);
  const locked = lockLeft > 0;

  const fieldName = mode === 'code' ? 'code' : 'recoveryCode';
  useEffect(() => {
    focusField(form.current, fieldName);
  }, [fieldName]);

  useEffect(() => {
    if (left === 0) onBack('expired');
  }, [left, onBack]);

  const valid =
    mode === 'code' ? /^\d{6}$/.test(value) : value.trim().length >= 8 && value.trim().length <= 32;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending || locked) return;
    setError(null);
    if (!valid) {
      setFieldError(t(mode === 'code' ? 'invalidCode' : 'invalidRecovery'));
      focusField(form.current, fieldName);
      return;
    }
    setFieldError(null);
    setPending(true);
    try {
      const res = await postBff(
        'mfa',
        {
          challengeToken,
          ...(mode === 'code' ? { code: value } : { recoveryCode: value.trim() }),
          // Not part of the API contract (it is dropped there): the sign-in route uses them for cookie lifetime and the workspace prefill.
          remember,
          ...(orgSlug ? { orgSlug } : {}),
        },
        bffAuthenticatedSchema,
      );
      completeSignIn(res, next);
    } catch (err) {
      const mapped = mapAuthError(err);
      if (mapped.key === 'mfaExpired') return onBack('expired');
      if (mapped.key === 'locked' && mapped.retryAfterSeconds) {
        setLockedUntil(Date.now() + mapped.retryAfterSeconds * 1000);
      }
      setError(mapped);
      setPending(false);
      setValue('');
      focusField(form.current, fieldName);
    }
  }

  /** The browser asks for the passkey (fingerprint, face, screen lock or key); the API checks the answer. */
  async function signInWithPasskey() {
    if (pending || locked) return;
    setError(null);
    setFieldError(null);
    setPasskeyProblem(null);
    setPending(true);
    setViaPasskey(true);
    try {
      const options = await callApi('/auth/login/mfa/webauthn-options', {
        method: 'POST',
        body: { challengeToken },
        schema: webauthnOptionsResponseSchema,
      });
      const assertion = await assertPasskey(options);
      const res = await postBff(
        'mfa',
        {
          challengeToken,
          webauthn: assertion,
          // As for a code: not part of the API contract, used by the sign-in route for the cookie lifetime and prefill.
          remember,
          ...(orgSlug ? { orgSlug } : {}),
        },
        bffAuthenticatedSchema,
      );
      completeSignIn(res, next);
    } catch (err) {
      setPending(false);
      setViaPasskey(false);
      // Not an API answer: the browser's prompt was closed, or the device could not provide the passkey.
      if (!(err instanceof ApiError)) {
        return setPasskeyProblem(
          classifyPasskeyError(err) === 'cancelled' ? 'cancelled' : 'failed',
        );
      }
      const mapped = mapAuthError(err);
      if (mapped.key === 'mfaExpired') return onBack('expired');
      if (mapped.key === 'locked' && mapped.retryAfterSeconds) {
        setLockedUntil(Date.now() + mapped.retryAfterSeconds * 1000);
      }
      setError(mapped);
    }
  }

  const shownError =
    fieldError ?? (error && error.field === 'code' ? <FormErrorText error={error} /> : null);

  return (
    <form
      method="post"
      ref={form}
      onSubmit={(e) => void submit(e)}
      onInput={() => setFieldError(null)}
      noValidate
      className="space-y-5"
    >
      <div className="space-y-1">
        <h2 className="font-serif text-[22px] leading-tight">{t('title')}</h2>
        <p className="text-[13px] text-(--auth-ink-600)">
          {mode === 'code' ? t('descriptionCode') : t('descriptionRecovery')}
        </p>
      </div>

      <FormError error={error} skipFieldMessage={error?.field === 'code'} />

      <FormField
        label={mode === 'code' ? t('codeLabel') : t('recoveryLabel')}
        error={shownError}
        hint={mode === 'recovery' ? t('recoveryHint') : undefined}
      >
        {(p) =>
          mode === 'code' ? (
            <Input
              {...p}
              name="code"
              value={value}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder="000000"
              onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="py-3 text-center font-mono text-[22px] tracking-[0.5em]"
            />
          ) : (
            <Input
              {...p}
              name="recoveryCode"
              value={value}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={32}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono"
            />
          )
        }
      </FormField>

      <Button type="submit" className="w-full" disabled={pending || locked}>
        {pending && !viaPasskey ? <Spinner label={t('verifying')} /> : null}
        {pending && !viaPasskey ? t('verifying') : t('verify')}
        {!pending && <ArrowIcon />}
      </Button>

      {showPasskey && (
        <div className="space-y-2">
          {passkeyProblem && (
            <Alert tone="warning">
              {passkeyProblem === 'cancelled' ? t('passkeyCancelled') : t('passkeyFailed')}
            </Alert>
          )}
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={pending || locked}
            onClick={() => void signInWithPasskey()}
          >
            {viaPasskey ? <Spinner label={t('passkeyWaiting')} /> : <KeyIcon className="size-4" />}
            {viaPasskey ? t('passkeyWaiting') : t('usePasskey')}
          </Button>
        </div>
      )}

      <div className="flex flex-col items-center gap-2 text-[12.5px]">
        <button
          type="button"
          className={cn(LINK)}
          onClick={() => {
            setMode(mode === 'code' ? 'recovery' : 'code');
            setValue('');
            setError(null);
            setFieldError(null);
          }}
        >
          {mode === 'code' ? t('useRecovery') : t('useApp')}
        </button>
        <button
          type="button"
          className="text-(--auth-ink-500) hover:text-foreground"
          onClick={() => onBack()}
        >
          {t('back')}
        </button>
        <p className="text-[11px] text-(--auth-ink-500)" aria-live="off">
          {t('expiresIn', { time: formatClock(left) })}
        </p>
      </div>
    </form>
  );
}

function FormErrorText({ error }: { error: MappedError }) {
  const t = useTranslations('auth-registration-security.guest');
  return <>{t(`errors.${error.key}`, error.params)}</>;
}
