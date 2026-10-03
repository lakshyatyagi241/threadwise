'use client';

import { acceptWspInviteSchema, type WspInvitePreview } from '@crm/contracts';
import { Button, PasswordInput, Spinner } from '@crm/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { postBff } from '@/features/auth-registration-security/guest/bff';
import { mapAuthError, type MappedError } from '@/features/auth-registration-security/guest/errors';
import { dropKey, focusFirstInvalid } from '@/features/auth-registration-security/guest/focus';
import { FormError } from '@/features/auth-registration-security/guest/form-error';
import { FormField } from '@/features/auth-registration-security/guest/form-field';
import { PolicyErrors } from '@/features/auth-registration-security/guest/policy-errors';
import { bffAuthenticatedSchema } from '@/features/auth-registration-security/guest/schemas';
import { completeSignIn } from '@/features/auth-registration-security/guest/sign-in-complete';
import { ApiError } from '@/lib/api/errors';
import { ERROR_CODES } from '@crm/contracts';

const FIELD_ORDER = ['password', 'confirmPassword'] as const;

/** The link is unknown, used or expired: the only way forward is a new invitation from the person who sent it. */
export function InviteInvalid() {
  const t = useTranslations('workspaces-teams-tenancy.accept');
  return (
    <div className="space-y-4">
      <div
        role="alert"
        className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
      >
        <p className="font-medium">{t('invalidTitle')}</p>
        <p>{t('invalidBody')}</p>
      </div>
      <Link
        href="/login"
        className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        {t('signIn')}
      </Link>
    </div>
  );
}

/**
 * Accept an invitation (WD-WSP-016, 021): the invitee picks a password and ends signed in to the workspace. The BFF route
 * `/api/auth/accept-invite` keeps the session tokens in httpOnly cookies, as it does for every sign-in.
 */
export function AcceptInviteForm({
  org,
  token,
  preview,
}: {
  org: string;
  token: string;
  preview: WspInvitePreview;
}) {
  const t = useTranslations('workspaces-teams-tenancy.accept');
  const tl = useTranslations('auth-registration-security.guest.login');
  const form = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, ReactNode>>({});
  const [invalid, setInvalid] = useState(false);

  if (invalid) return <InviteInvalid />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const data = new FormData(e.currentTarget);
    const password = String(data.get('password') ?? '');
    const confirm = String(data.get('confirmPassword') ?? '');
    const parsed = acceptWspInviteSchema.safeParse({ token, orgSlug: org, password });
    const messages: Record<string, ReactNode> = {};
    const failed: string[] = [];
    if (!parsed.success) {
      messages.password = t('passwordTooShort');
      failed.push('password');
    }
    if (password !== confirm) {
      messages.confirmPassword = t('passwordMismatch');
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
      const res = await postBff('accept-invite', parsed.data, bffAuthenticatedSchema);
      // Signed in: leave with a full navigation so no router cache of a previous identity is reused.
      completeSignIn(res);
    } catch (err) {
      if (err instanceof ApiError && err.code === ERROR_CODES.WSP_INVITE_INVALID) {
        setInvalid(true);
        return;
      }
      const mapped = mapAuthError(err);
      setError(mapped);
      if (mapped.key === 'passwordPolicy') {
        setFieldErrors({ password: <PolicyErrors rules={mapped.policy} /> });
        focusFirstInvalid(form.current, FIELD_ORDER, ['password']);
      }
      setPending(false);
    }
  }

  return (
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
      <div className="space-y-1.5 text-sm">
        <div className="font-medium">{t('email')}</div>
        <div
          data-testid="invite-email"
          className="flex h-10 items-center rounded-md border border-border bg-muted px-3 text-sm"
        >
          {preview.email}
        </div>
      </div>
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
  );
}
