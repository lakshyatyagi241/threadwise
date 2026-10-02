'use client';

import {
  neutralAckSchema,
  resetPasswordRequestSchema,
  type PasswordPolicyHint,
} from '@crm/contracts';
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
import { longEnough, policyHintParts } from './policy-hint';
import { Alert, ArrowIcon, Button, LINK, PRIMARY_LINK, PasswordInput, Spinner } from './ui';

const FIELD_ORDER = ['password', 'confirmPassword'] as const;

/** The link was missing, used, or expired: the only way forward is a new one. */
export function InvalidResetLink({ org }: { org: string }) {
  const t = useTranslations('auth-registration-security.guest.reset');
  return (
    <div className="space-y-4">
      <Alert tone="danger" className="space-y-0.5">
        <p className="font-semibold">{t('invalidTitle')}</p>
        <p>{t('invalidBody')}</p>
      </Alert>
      <div className="flex flex-col items-center gap-3 text-[12.5px]">
        <Link
          href={org ? `/forgot-password?org=${encodeURIComponent(org)}` : '/forgot-password'}
          className={PRIMARY_LINK}
        >
          {t('requestNew')}
        </Link>
        <Link
          href={org ? `/login?org=${encodeURIComponent(org)}` : '/login'}
          className="text-(--auth-ink-500) hover:text-foreground"
        >
          {t('back')}
        </Link>
      </div>
    </div>
  );
}

/** Reset password (TW-AUTH-014): consumes the emailed token; success goes to sign-in, never straight into the app. */
export function ResetForm({
  org,
  token,
  passwordPolicy,
}: {
  org: string;
  token: string;
  /** The live password rules for the hint; null when they could not be read. */
  passwordPolicy: PasswordPolicyHint | null;
}) {
  const t = useTranslations('auth-registration-security.guest.reset');
  const tl = useTranslations('auth-registration-security.guest.login');
  const tv = useTranslations('auth-registration-security.guest.validation');
  const tp = useTranslations('auth-registration-security.guest.policy');
  const router = useRouter();
  const policy = policyHintParts(passwordPolicy);
  const passwordHint = [
    tp('minLength', { min: policy.min }),
    ...policy.extras.map((e) => tp(e)),
  ].join(' ');
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
      messages.password = tv('newPassword', { min: policy.min });
      failed.push('password');
    } else if (!longEnough(password, policy)) {
      messages.password = tv('newPassword', { min: policy.min });
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
    <div>
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
        <FormField label={t('password')} hint={passwordHint} error={fieldErrors.password}>
          {(p) => (
            <PasswordInput
              {...p}
              name="password"
              autoComplete="new-password"
              autoFocus
              placeholder="********"
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
              placeholder="********"
              showLabel={tl('showPassword')}
              hideLabel={tl('hidePassword')}
            />
          )}
        </FormField>
        <Button type="submit" className="mt-2 w-full" disabled={pending}>
          {pending ? <Spinner label={t('submitting')} /> : null}
          {pending ? t('submitting') : t('submit')}
          {!pending && <ArrowIcon />}
        </Button>
        <p className="mt-2 text-center text-[12.5px]">
          <Link href={`/login?org=${encodeURIComponent(org)}`} className={LINK}>
            {t('back')}
          </Link>
        </p>
      </form>
    </div>
  );
}
