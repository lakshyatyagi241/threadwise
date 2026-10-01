'use client';

import { Button, Input, Spinner } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { focusField } from './focus';
import { postBff } from './bff';
import { formatClock } from './countdown';
import { mapAuthError, type MappedError } from './errors';
import { FormError } from './form-error';
import { FormField } from './form-field';
import { bffAuthenticatedSchema } from './schemas';
import { completeSignIn } from './sign-in-complete';
import { useCountdown } from './use-countdown';

/**
 * Second factor at sign-in (ADR-0019): the six-digit authenticator code, or one of the single-use
 * recovery codes. The challenge lives about five minutes; when it lapses the visitor starts over.
 */
export function MfaStep({
  challengeToken,
  expiresAt,
  remember,
  orgSlug,
  next,
  onBack,
}: {
  challengeToken: string;
  /** Epoch ms when the challenge stops being valid. */
  expiresAt: number;
  remember: boolean;
  orgSlug?: string;
  next?: string | null;
  /** Back to the credentials step; `expired` explains why when the challenge lapsed. */
  onBack: (reason?: 'expired') => void;
}) {
  const t = useTranslations('auth-registration-security.guest.mfa');
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const left = useCountdown(expiresAt);

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
    if (pending) return;
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
      setError(mapped);
      setPending(false);
      setValue('');
      focusField(form.current, fieldName);
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
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">
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
              className="h-12 text-center font-mono text-xl tracking-[0.5em]"
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

      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner label={t('verifying')} />}
        {pending ? t('verifying') : t('verify')}
      </Button>

      <div className="flex flex-col items-center gap-2 text-sm">
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
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
          className="text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => onBack()}
        >
          {t('back')}
        </button>
        <p className="text-xs text-muted-foreground" aria-live="off">
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
