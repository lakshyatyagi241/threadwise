'use client';

import {
  findWorkspacesRequestSchema,
  neutralAckSchema,
  type RegistrationConfigResponse,
} from '@crm/contracts';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { callApi } from './bff';
import { useCaptcha } from './captcha';
import { captchaMissing, mapAuthError, type MappedError } from './errors';
import { focusField } from './focus';
import { FormError } from './form-error';
import { FormField } from './form-field';
import { Alert, ArrowIcon, Button, Input, LINK, Spinner } from './ui';

/** "Find my workspace": email only; the workspace addresses are mailed to verified addresses (always the same answer). */
export function FindWorkspaceForm({ config }: { config: RegistrationConfigResponse }) {
  const t = useTranslations('auth-registration-security.guest.findWorkspace');
  const tl = useTranslations('auth-registration-security.guest.login');
  const tv = useTranslations('auth-registration-security.guest.validation');
  const form = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const captcha = useCaptcha(config.captcha, 'forgot');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim();
    const parsed = findWorkspacesRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailError(tv('email'));
      focusField(form.current, 'email');
      return;
    }
    setEmailError(null);
    setPending(true);
    try {
      if (captcha.needsInteraction) throw captchaMissing();
      const captchaToken = await captcha.token();
      await callApi('/auth/find-workspaces', {
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
          <p className="font-semibold">{t('doneTitle')}</p>
          <p>{t('doneBody')}</p>
        </Alert>
        <p className="text-[12.5px] text-(--auth-ink-600)">{t('doneHint')}</p>
        <div className="flex flex-col items-center gap-2 text-[12.5px]">
          <button
            type="button"
            onClick={() => {
              setDone(false);
              setPending(false);
            }}
            className={LINK}
          >
            {t('tryAnother')}
          </button>
          <Link href="/login" className="text-(--auth-ink-500) hover:text-foreground">
            {t('back')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <form
        method="post"
        ref={form}
        onSubmit={(e) => void onSubmit(e)}
        onInput={() => setEmailError(null)}
        noValidate
        className="space-y-4"
      >
        <FormError error={error} />
        <FormField label={tl('email')} error={emailError}>
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
              autoFocus
            />
          )}
        </FormField>
        {captcha.widget}
        <Button type="submit" className="mt-2 w-full" disabled={pending}>
          {pending ? <Spinner label={t('submitting')} /> : null}
          {pending ? t('submitting') : t('submit')}
          {!pending && <ArrowIcon />}
        </Button>
        <p className="mt-2 text-center text-[12.5px] text-(--auth-ink-600)">
          <Link href="/login" className={LINK}>
            {t('back')}
          </Link>
        </p>
      </form>
    </div>
  );
}
