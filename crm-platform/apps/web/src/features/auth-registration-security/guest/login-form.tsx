'use client';

import { loginRequestSchema, type RegistrationConfigResponse } from '@crm/contracts';
import { Alert, Button, Checkbox, Input, PasswordInput, Spinner } from '@crm/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { postBff } from './bff';
import { useCaptcha } from './captcha';
import { captchaMissing, mapAuthError, type MappedError } from './errors';
import { dropKey, focusFirstInvalid } from './focus';
import { FormError } from './form-error';
import { FormField } from './form-field';
import { LegalLine } from './legal-links';
import { MfaStep } from './mfa-step';
import { rememberReferral } from './referral';
import { bffLoginResponseSchema } from './schemas';
import { completeSignIn } from './sign-in-complete';
import { SocialButtons } from './social-buttons';
import { TransientToast } from './toast';
import { stripSearchParams } from './url-params';
import { failedFields } from './zod-fields';

type Flash = 'reset' | 'expired' | 'deleted' | null;

/** One-time notices carried in the address (`?reset=1`, `?expired=1`, `?account_deleted=1`): shown once, then dropped from the URL. */
const FLASH_PARAMS = ['reset', 'expired', 'account_deleted'] as const;

const FIELD_ORDER = ['orgSlug', 'email', 'password'] as const;

/**
 * Sign-in (WD-AUTH-001/002/003/004/012): workspace + email + password, "keep me signed in", reCAPTCHA,
 * social buttons, and the second-factor step when the account has one.
 */
export function LoginForm({
  config,
  defaultOrg,
  next,
  flash,
  loggedOut,
  referral,
}: {
  config: RegistrationConfigResponse;
  /** `?org=` or the `crm_org` cookie. */
  defaultOrg: string;
  /** A safe relative return path (already sanitised on the server) or null. */
  next: string | null;
  flash: Flash;
  loggedOut: boolean;
  /** `?ref=` seen on the sign-in page is kept for a later sign-up. */
  referral: string;
}) {
  const t = useTranslations('auth-registration-security.guest.login');
  const tv = useTranslations('auth-registration-security.guest.validation');
  const form = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [orgSlug, setOrgSlug] = useState(defaultOrg);
  // "Keep me signed in" is on by default, and absent when an administrator turned it off.
  const [remember, setRemember] = useState(config.rememberMeEnabled);
  const [mfa, setMfa] = useState<{ token: string; expiresAt: number } | null>(null);
  const [mfaExpired, setMfaExpired] = useState(false);
  /** The form unmounts during the MFA step; the email is kept so going back does not lose it (never the password). */
  const [lastEmail, setLastEmail] = useState('');
  const captcha = useCaptcha(config.captcha, 'login');

  useEffect(() => {
    if (referral) rememberReferral(referral);
  }, [referral]);

  useEffect(() => {
    stripSearchParams(FLASH_PARAMS);
  }, []);

  const backToCredentials = useCallback((reason?: 'expired') => {
    setMfa(null);
    setMfaExpired(reason === 'expired');
    setPending(false);
  }, []);

  function applyFailure(mapped: MappedError, fields?: string[]) {
    setError(mapped);
    const server: Record<string, string> = {};
    for (const name of FIELD_ORDER) {
      const message = mapped.fieldErrors[name]?.[0];
      if (message) server[name] = message;
    }
    setFieldErrors(server);
    if (mapped.key === 'invalidCredentials') {
      // Never keep a rejected password around: clear it and let the visitor retype it.
      const password = form.current?.elements.namedItem('password');
      if (password instanceof HTMLInputElement) password.value = '';
      focusFirstInvalid(form.current, FIELD_ORDER, ['password']);
      return;
    }
    focusFirstInvalid(form.current, FIELD_ORDER, fields ?? Object.keys(server));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setMfaExpired(false);
    const data = new FormData(e.currentTarget);
    const raw = {
      orgSlug: String(data.get('orgSlug') ?? '').trim(),
      email: String(data.get('email') ?? '').trim(),
      password: String(data.get('password') ?? ''),
      remember: config.rememberMeEnabled && remember,
    };
    const parsed = loginRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const failed = failedFields(parsed.error);
      setFieldErrors(
        Object.fromEntries(failed.map((f) => [f, tv(f === 'password' ? 'passwordRequired' : f)])),
      );
      setError(null);
      focusFirstInvalid(form.current, FIELD_ORDER, failed);
      return;
    }
    setFieldErrors({});

    setPending(true);
    try {
      if (captcha.needsInteraction) {
        // v2: the box must be ticked first.
        applyFailure(mapAuthError(captchaMissing()));
        setPending(false);
        return;
      }
      const captchaToken = await captcha.token();
      const res = await postBff(
        'login',
        { ...parsed.data, ...(captchaToken ? { captchaToken } : {}) },
        bffLoginResponseSchema,
      );
      if (res.status === 'mfa_required') {
        setLastEmail(parsed.data.email);
        setMfa({ token: res.challengeToken, expiresAt: Date.now() + res.expiresInSeconds * 1000 });
        setPending(false);
        return;
      }
      completeSignIn(res, next);
    } catch (err) {
      captcha.reset();
      applyFailure(mapAuthError(err));
      setPending(false);
    }
  }

  if (mfa) {
    return (
      <MfaStep
        challengeToken={mfa.token}
        expiresAt={mfa.expiresAt}
        remember={config.rememberMeEnabled && remember}
        orgSlug={orgSlug.trim() || undefined}
        next={next}
        onBack={backToCredentials}
      />
    );
  }

  const forgotHref = orgSlug.trim()
    ? `/forgot-password?org=${encodeURIComponent(orgSlug.trim())}`
    : '/forgot-password';

  return (
    <div className="space-y-5">
      {loggedOut && <TransientToast message={t('loggedOut')} clearParam="logout" />}
      {flash === 'reset' && <Alert tone="success">{t('flashReset')}</Alert>}
      {flash === 'expired' && <Alert tone="warning">{t('flashExpired')}</Alert>}
      {flash === 'deleted' && <Alert tone="success">{t('flashDeleted')}</Alert>}
      {mfaExpired && <Alert tone="warning">{t('mfaExpired')}</Alert>}

      <SocialButtons
        social={config.social}
        mode="login"
        getOrgSlug={() => orgSlug}
        onError={setError}
        onNeedInput={() => {
          setFieldErrors({ orgSlug: tv('orgSlugForSocial') });
          focusFirstInvalid(form.current, FIELD_ORDER, ['orgSlug']);
        }}
        disabled={pending}
      />

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
        <FormError
          error={error}
          skipFieldMessage={Boolean(error?.field && fieldErrors[error.field])}
        />

        <FormField label={t('workspace')} hint={t('workspaceHint')} error={fieldErrors.orgSlug}>
          {(p) => (
            <Input
              {...p}
              name="orgSlug"
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value)}
              autoComplete="organization"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t('workspacePlaceholder')}
              autoFocus={!defaultOrg}
            />
          )}
        </FormField>

        <FormField label={t('email')} error={fieldErrors.email}>
          {(p) => (
            <Input
              {...p}
              name="email"
              type="email"
              defaultValue={lastEmail}
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t('emailPlaceholder')}
              autoFocus={Boolean(defaultOrg)}
            />
          )}
        </FormField>

        <FormField
          label={t('password')}
          error={fieldErrors.password}
          labelEnd={
            <Link
              href={forgotHref}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('forgot')}
            </Link>
          }
        >
          {(p) => (
            <PasswordInput
              {...p}
              name="password"
              autoComplete="current-password"
              showLabel={t('showPassword')}
              hideLabel={t('hidePassword')}
            />
          )}
        </FormField>

        {config.rememberMeEnabled && (
          <Checkbox
            id="remember"
            name="remember"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            label={t('remember')}
          />
        )}

        {captcha.widget}

        <Button type="submit" className="h-11 w-full" disabled={pending}>
          {pending && <Spinner label={t('submitting')} />}
          {pending ? t('submitting') : t('submit')}
        </Button>
      </form>

      <div className="space-y-3 text-center text-sm">
        {config.registrationOpen && (
          <p className="text-muted-foreground">
            {t('newHere')}{' '}
            <Link
              href="/signup"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('createAccount')}
            </Link>
          </p>
        )}
        <p className="text-muted-foreground">
          {t('lostWorkspace')}{' '}
          <Link
            href="/find-workspace"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {t('findWorkspace')}
          </Link>
        </p>
        <LegalLine links={config.links} />
      </div>
    </div>
  );
}
