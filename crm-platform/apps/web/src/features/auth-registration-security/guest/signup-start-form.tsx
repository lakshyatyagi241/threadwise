'use client';

import {
  signupStartRequestSchema,
  signupStartResponseSchema,
  type RegistrationConfigResponse,
} from '@crm/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CountryCode } from 'libphonenumber-js';
import { callApi } from './bff';
import { mapAuthError, type MappedError } from './errors';
import { dropKey, focusFirstInvalid } from './focus';
import { FormError } from './form-error';
import { FormField } from './form-field';
import { PhoneInput, type PhoneValue } from './phone-input';
import { evaluatePhone, pickDefaultCountry } from './phone';
import { saveSignupStage, toStoredSignupStage } from './signup-challenge';
import { Alert, ArrowIcon, Button, Input, LINK, Spinner } from './ui';
import { failedFields } from './zod-fields';

const FIELD_ORDER = ['fullName', 'email', 'phone'] as const;

/**
 * Sign-up step 1 of the three-step email-verification flow: collects name, email and (optionally
 * required) phone, then starts a pending token that step 2 (/signup/verify-email) checks a code
 * against. No workspace, password or terms here — those belong to the later steps.
 */
export function SignupStartForm({ config }: { config: RegistrationConfigResponse }) {
  const t = useTranslations('auth-registration-security.guest.signup');
  const tv = useTranslations('auth-registration-security.guest.validation');
  const tl = useTranslations('auth-registration-security.guest.login');
  const te = useTranslations('auth-registration-security.guest.errors');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, ReactNode>>({});

  // Phone: opens on the platform's default country; the same on the server and in the browser.
  const defaultIso = pickDefaultCountry(config.defaultCountryIso);
  const [phoneEdit, setPhoneEdit] = useState<{ raw: string; iso: CountryCode } | null>(null);
  const phone = useMemo<PhoneValue>(() => {
    const raw = phoneEdit?.raw ?? '';
    const iso = phoneEdit?.iso ?? defaultIso;
    return { raw, iso, state: evaluatePhone(raw, iso) };
  }, [phoneEdit, defaultIso]);

  function show(failed: string[], messages: Record<string, ReactNode>) {
    setFieldErrors(messages);
    focusFirstInvalid(form.current, FIELD_ORDER, failed);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const data = new FormData(e.currentTarget);
    const text = (k: string) => String(data.get(k) ?? '').trim();

    const body = {
      fullName: text('fullName'),
      email: text('email'),
      ...(phone.state.e164 ? { phone: phone.state.e164 } : {}),
    };
    const parsed = signupStartRequestSchema.safeParse(body);
    const messages: Record<string, ReactNode> = {};
    const failed: string[] = parsed.success ? [] : failedFields(parsed.error);
    for (const f of failed) messages[f] = tv(f);
    if (config.phoneRequired) {
      if (!phone.raw.trim()) {
        messages.phone = tv('phoneRequired');
        if (!failed.includes('phone')) failed.push('phone');
      } else if (!phone.state.valid) {
        messages.phone = tv('phone');
        if (!failed.includes('phone')) failed.push('phone');
      }
    } else if (phone.raw.trim() && !phone.state.valid) {
      messages.phone = tv('phone');
      if (!failed.includes('phone')) failed.push('phone');
    }
    if (failed.length > 0 || !parsed.success) {
      show(failed, messages);
      return;
    }
    setFieldErrors({});

    setPending(true);
    try {
      const res = await callApi('/auth/signup/start', {
        method: 'POST',
        body: parsed.data,
        schema: signupStartResponseSchema,
      });
      saveSignupStage(toStoredSignupStage(res, Date.now()));
      router.push('/signup/verify-email');
    } catch (err) {
      const mapped = mapAuthError(err);
      setError(mapped);
      const messages: Record<string, ReactNode> = {};
      if (mapped.key === 'validation') {
        for (const name of FIELD_ORDER) {
          const first = mapped.fieldErrors[name]?.[0];
          if (first) messages[name] = first;
        }
      } else if (mapped.field) {
        messages[mapped.field] = te(mapped.key, mapped.params);
      }
      setFieldErrors(messages);
      focusFirstInvalid(form.current, FIELD_ORDER, Object.keys(messages));
      setPending(false);
    }
  }

  if (!config.registrationOpen) {
    return (
      <div className="space-y-4">
        <Alert tone="warning">{t('closedBody')}</Alert>
        <p className="text-center text-[12.5px] text-(--auth-ink-600)">
          <Link href="/login" className={LINK}>
            {t('closedBack')}
          </Link>
        </p>
      </div>
    );
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
        className="grid grid-cols-1 gap-x-3 gap-y-2.5"
      >
        <div className="empty:hidden">
          <FormError
            error={error}
            skipFieldMessage={Boolean(error?.field && fieldErrors[error.field])}
          />
        </div>

        <FormField label={t('fullName')} error={fieldErrors.fullName}>
          {(p) => (
            <Input
              {...p}
              name="fullName"
              autoComplete="name"
              placeholder={t('fullNamePlaceholder')}
              autoFocus
              className="py-2.5"
            />
          )}
        </FormField>

        <FormField label={t('email')} error={fieldErrors.email}>
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
              className="py-2.5"
            />
          )}
        </FormField>

        <FormField label={t('phone')} error={fieldErrors.phone} hint={t('phoneHint')}>
          {(p) => (
            <PhoneInput
              id={p.id}
              name="phone"
              value={phone}
              onChange={(next) => setPhoneEdit({ raw: next.raw, iso: next.iso })}
              invalid={p.invalid}
              describedBy={p['aria-describedby']}
              placeholder={t('phonePlaceholder')}
            />
          )}
        </FormField>

        <Button type="submit" className="mt-1 w-full py-3" disabled={pending}>
          {pending ? <Spinner label={t('submitting')} /> : null}
          {pending ? t('submitting') : t('submit')}
          {!pending && <ArrowIcon />}
        </Button>

        <p className="text-center text-[13px] text-(--auth-ink-600)">
          {t('haveAccount')}{' '}
          <Link href="/login" className={LINK}>
            {t('signIn')}
          </Link>
        </p>
      </form>
    </div>
  );
}
