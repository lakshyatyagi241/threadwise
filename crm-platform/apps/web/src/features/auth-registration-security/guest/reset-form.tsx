'use client';

import { neutralAckSchema, resetPasswordRequestSchema } from '@crm/contracts';
import { Button, PasswordInput, Spinner } from '@crm/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { callApi } from './bff';
import { mapAuthError, type MappedError } from './errors';
import { dropKey, focusFirstInvalid } from './focus';
import { FormError } from './form-error';
import { FormField } from './form-field';
import { PolicyErrors } from './policy-errors';

const FIELD_ORDER = ['password', 'confirmPassword'] as const;

/** The link was missing, used, or expired: the only way forward is a new one. */
export function InvalidResetLink({ org }: { org: string }) {
  const t = useTranslations('auth-registration-security.guest.reset');
  return (
    <div className="space-y-4">
      <div
        role="alert"
        className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
      >
        <p className="font-medium">{t('invalidTitle')}</p>
        <p>{t('invalidBody')}</p>
      </div>
      <div className="flex flex-col items-center gap-2 text-sm">
        <Link
          href={org ? `/forgot-password?org=${encodeURIComponent(org)}` : '/forgot-password'}
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground hover:opacity-90"
        >
          {t('requestNew')}
        </Link>
        <Link
          href={org ? `/login?org=${encodeURIComponent(org)}` : '/login'}
          className="text-muted-foreground underline-offset-2 hover:underline"
        >
          {t('back')}
        </Link>
      </div>
    </div>
  );
}

/** Reset password (TW-AUTH-014): consumes the emailed token; success goes to sign-in, never straight into the app. */
export function ResetForm({ org, token }: { org: string; token: string }) {
  const t = useTranslations('auth-registration-security.guest.reset');
  const tl = useTranslations('auth-registration-security.guest.login');
  const tv = useTranslations('auth-registration-security.guest.validation');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, ReactNode>>({});
  const [invalid, setInvalid] = useState(false);

  if (invalid) return <InvalidResetLink org={org} />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const data = new FormData(e.currentTarget);
    const password = String(data.get('password') ?? '');
    const confirm = String(data.get('confirmPassword') ?? '');
    const parsed = resetPasswordRequestSchema.safeParse({ orgSlug: org, token, password });
    const messages: Record<string, ReactNode> = {};
    const failed: string[] = [];
    if (!parsed.success) {
      const onlyPassword = parsed.error.issues.every((i) => i.path[0] === 'password');
      if (!onlyPassword) {
        setInvalid(true);
        return;
      }
      messages.password = tv('newPassword');
      failed.push('password');
    }
    if (password !== confirm) {
      messages.confirmPassword = tv('confirmPassword');
      failed.push('confirmPassword');
    }
    if (failed.length > 0 || !parsed.success) {
      setFieldErrors(messages);
      focusFirstInvalid(form.current, FIELD_ORDER, failed);
      return;
    }
    setFieldErrors({});
    setPending(true);
    try {
      await callApi('/auth/reset-password', {
        method: 'POST',
        body: parsed.data,
        schema: neutralAckSchema,
      });
      // The reset ended every session of this account; drop any cookies of this browser so /login shows the success note.
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      router.replace(`/login?reset=1&org=${encodeURIComponent(org)}`);
    } catch (err) {
      const mapped = mapAuthError(err);
      if (mapped.key === 'tokenInvalid') return setInvalid(true);
      setError(mapped);
      if (mapped.key === 'passwordPolicy') {
        setFieldErrors({ password: <PolicyErrors rules={mapped.policy} /> });
        focusFirstInvalid(form.current, FIELD_ORDER, ['password']);
      }
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <form
        method="post"
        ref={form}
        onSubmit={(e) => void onSubmit(e)}
        onInput={(e) => {
          const name = (e.target as HTMLInputElement).name;
          setFieldErrors((prev) => dropKey(prev, name));
          setError((cur) => (cur && cur.field === name ? null : cur));
        }}
        noValidate
        className="space-y-4"
      >
        <FormError error={error} skipFieldMessage={error?.key === 'passwordPolicy'} />
        <FormField label={t('password')} hint={t('passwordHint')} error={fieldErrors.password}>
          {(p) => (
            <PasswordInput
              {...p}
              name="password"
              autoComplete="new-password"
              autoFocus
              showLabel={tl('showPassword')}
              hideLabel={tl('hidePassword')}
            />
          )}
        </FormField>
        <FormField label={t('confirmPassword')} error={fieldErrors.confirmPassword}>
          {(p) => (
            <PasswordInput
              {...p}
              name="confirmPassword"
              autoComplete="new-password"
              showLabel={tl('showPassword')}
              hideLabel={tl('hidePassword')}
            />
          )}
        </FormField>
        <Button type="submit" className="h-11 w-full" disabled={pending}>
          {pending && <Spinner label={t('submitting')} />}
          {pending ? t('submitting') : t('submit')}
        </Button>
      </form>
      <p className="text-center text-sm">
        <Link
          href={`/login?org=${encodeURIComponent(org)}`}
          className="text-muted-foreground underline-offset-2 hover:underline"
        >
          {t('back')}
        </Link>
      </p>
    </div>
  );
}
