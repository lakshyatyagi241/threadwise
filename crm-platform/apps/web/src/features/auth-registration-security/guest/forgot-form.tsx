'use client';

import {
  forgotPasswordRequestSchema,
  neutralAckSchema,
  type RegistrationConfigResponse,
} from '@crm/contracts';
import { Alert, Button, Input, Spinner } from '@crm/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { callApi } from './bff';
import { useCaptcha } from './captcha';
import { captchaMissing, mapAuthError, type MappedError } from './errors';
import { dropKey, focusFirstInvalid } from './focus';
import { FormError } from './form-error';
import { FormField } from './form-field';
import { failedFields } from './zod-fields';

const FIELD_ORDER = ['orgSlug', 'email'] as const;

/** Forgot password (TW-AUTH-013): the answer is the same whether or not the address exists. */
export function ForgotForm({
  config,
  defaultOrg,
}: {
  config: RegistrationConfigResponse;
  defaultOrg: string;
}) {
  const t = useTranslations('auth-registration-security.guest.forgot');
  const tl = useTranslations('auth-registration-security.guest.login');
  const tv = useTranslations('auth-registration-security.guest.validation');
  const form = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [orgSlug, setOrgSlug] = useState(defaultOrg);
  const captcha = useCaptcha(config.captcha, 'forgot');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const data = new FormData(e.currentTarget);
    const parsed = forgotPasswordRequestSchema.safeParse({
      orgSlug: orgSlug.trim(),
      email: String(data.get('email') ?? '').trim(),
    });
    if (!parsed.success) {
      const failed = failedFields(parsed.error);
      setFieldErrors(Object.fromEntries(failed.map((f) => [f, tv(f)])));
      focusFirstInvalid(form.current, FIELD_ORDER, failed);
      return;
    }
    setFieldErrors({});
    setPending(true);
    try {
      if (captcha.needsInteraction) throw captchaMissing();
      const captchaToken = await captcha.token();
      await callApi('/auth/forgot-password', {
        method: 'POST',
        body: { ...parsed.data, ...(captchaToken ? { captchaToken } : {}) },
        schema: neutralAckSchema,
      });
      setDone(true);
    } catch (err) {
      captcha.reset();
      setError(mapAuthError(err));
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-5">
        <Alert tone="success" className="space-y-1">
          <p className="font-medium">{t('doneTitle')}</p>
          <p>{t('doneBody')}</p>
        </Alert>
        <p className="text-sm text-muted-foreground">{t('doneHint')}</p>
        <div className="flex flex-col items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => {
              setDone(false);
              setPending(false);
            }}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {t('tryAnother')}
          </button>
          <Link
            href={orgSlug.trim() ? `/login?org=${encodeURIComponent(orgSlug.trim())}` : '/login'}
            className="text-muted-foreground underline-offset-2 hover:underline"
          >
            {t('back')}
          </Link>
        </div>
      </div>
    );
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
        <FormError error={error} />

        <FormField label={tl('workspace')} hint={tl('workspaceHint')} error={fieldErrors.orgSlug}>
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
              placeholder={tl('workspacePlaceholder')}
              autoFocus={!defaultOrg}
            />
          )}
        </FormField>

        <FormField label={tl('email')} error={fieldErrors.email}>
          {(p) => (
            <Input
              {...p}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={tl('emailPlaceholder')}
              autoFocus={Boolean(defaultOrg)}
            />
          )}
        </FormField>

        {captcha.widget}

        <Button type="submit" className="h-11 w-full" disabled={pending}>
          {pending && <Spinner label={t('submitting')} />}
          {pending ? t('submitting') : t('submit')}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {t('remembered')}{' '}
        <Link
          href={orgSlug.trim() ? `/login?org=${encodeURIComponent(orgSlug.trim())}` : '/login'}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {t('back')}
        </Link>
      </p>
    </div>
  );
}
