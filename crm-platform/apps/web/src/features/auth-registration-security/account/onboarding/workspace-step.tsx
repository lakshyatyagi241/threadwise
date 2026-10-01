'use client';

import {
  ERROR_CODES,
  industrySchema,
  onboardingWorkspaceRequestSchema,
  teamSizeSchema,
  type OnboardingResponse,
} from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, Field, Input, Select, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { Combobox } from '../../shared/combobox';
import { currencyOptions } from '../../shared/currencies';
import { ErrorNote } from '../../shared/error-note';
import { focusFirstInvalid } from '../../shared/focus';
import { redirectOnGateError } from '../../shared/gate-errors';
import { PhoneField, type PhoneValue } from '../../shared/phone-field';
import { TimezoneCombobox } from '../../shared/timezone-combobox';
import { modernZoneId } from '../../shared/timezones';
import { authApi, keys } from '../api';

type FieldKey = 'name' | 'industry' | 'sizeRange' | 'timezone' | 'currency' | 'phone';
type Errors = Partial<Record<FieldKey, string>>;

const INDUSTRIES = industrySchema.options;
const SIZES = teamSizeSchema.options;

/** Step 2 of 3: name the workspace, say what it is for, pick its timezone (TW-AUTH-008). */
export function WorkspaceStep({
  data,
  onSaved,
}: {
  data: OnboardingResponse;
  onSaved: () => void;
}) {
  const t = useTranslations('auth-registration-security.account.onboarding.workspace');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const id = (name: string) => `${uid}-${name}`;

  // The organization already has the name chosen at sign-up; the suggestion fills in only when that is blank.
  const [name, setName] = useState(data.workspace.name || data.suggestedName);
  const [industry, setIndustry] = useState(data.workspace.industry ?? '');
  const [size, setSize] = useState(data.workspace.sizeRange ?? '');
  const [zone, setZone] = useState(modernZoneId(data.workspace.timezone ?? data.defaultTimezone));
  const [currency, setCurrency] = useState(data.workspace.currency ?? '');
  const [phone, setPhone] = useState<PhoneValue>({ e164: null, empty: true, problem: null });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const currencies = useMemo(() => currencyOptions(locale), [locale]);

  function fail(next: Errors) {
    setErrors(next);
    focusFirstInvalid(formRef.current);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);

    const found: Errors = {};
    if (data.needsPhone) {
      if (phone.empty) found.phone = t('errors.phoneRequired');
      else if (phone.problem) found.phone = t('errors.phoneInvalid');
    }
    const parsed = onboardingWorkspaceRequestSchema.safeParse({
      name: name.trim(),
      industry: industry || undefined,
      sizeRange: size || undefined,
      timezone: zone,
      currency: currency || undefined,
      phone: data.needsPhone ? (phone.e164 ?? undefined) : undefined,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldKey | undefined;
        if (!key || found[key]) continue;
        found[key] =
          key === 'name'
            ? t('errors.nameInvalid')
            : key === 'timezone'
              ? t('errors.timezoneRequired')
              : t('errors.invalid');
      }
    }
    if (Object.keys(found).length || !parsed.success) return fail(found);

    setPending(true);
    setErrors({});
    try {
      const saved = await authApi.saveWorkspace(parsed.data);
      queryClient.setQueryData(keys.onboarding, saved);
      // The organization's name is part of the session the shell shows.
      router.refresh();
      onSaved();
    } catch (err) {
      if (redirectOnGateError(err, router.replace)) return;
      if (
        err instanceof ApiError &&
        err.code === ERROR_CODES.VALIDATION_FAILED &&
        err.fieldErrors.length
      ) {
        const mapped: Errors = {};
        for (const f of err.fieldErrors) {
          const key = f.path as FieldKey;
          if (!mapped[key])
            mapped[key] = key === 'timezone' ? t('errors.timezoneInvalid') : t('errors.invalid');
        }
        fail(mapped);
      } else if (err instanceof ApiError && err.code === ERROR_CODES.FORBIDDEN) {
        setError(null);
        fail({ name: t('errors.forbidden') });
      } else {
        setError(err);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <Field label={t('name')} htmlFor={id('name')} hint={t('nameHint')} error={errors.name}>
        <Input
          id={id('name')}
          value={name}
          maxLength={120}
          autoComplete="organization"
          placeholder={t('namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          invalid={Boolean(errors.name)}
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('industry')} htmlFor={id('industry')} error={errors.industry}>
          <Select
            id={id('industry')}
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          >
            <option value="">{t('industryPlaceholder')}</option>
            {INDUSTRIES.map((value) => (
              <option key={value} value={value}>
                {t(`industries.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('size')} htmlFor={id('size')} error={errors.sizeRange}>
          <Select id={id('size')} value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">{t('sizePlaceholder')}</option>
            {SIZES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label={t('timezone')}
        htmlFor={id('tz')}
        hint={t('timezoneHint')}
        error={errors.timezone}
      >
        <TimezoneCombobox
          id={id('tz')}
          value={zone}
          onChange={setZone}
          extra={[data.defaultTimezone]}
          invalid={Boolean(errors.timezone)}
        />
      </Field>

      <Field
        label={t('currency')}
        htmlFor={id('currency')}
        hint={t('currencyHint')}
        error={errors.currency}
      >
        <Combobox
          id={id('currency')}
          options={currencies}
          value={currency}
          onChange={setCurrency}
          clearLabel={t('currencyNone')}
          placeholder={t('currencyPlaceholder')}
          emptyLabel={t('currencyEmpty')}
          listLabel={t('currency')}
          invalid={Boolean(errors.currency)}
        />
      </Field>

      {data.needsPhone && (
        <Field label={t('phone')} htmlFor={id('phone')} hint={t('phoneHint')} error={errors.phone}>
          <PhoneField id={id('phone')} onChange={setPhone} invalid={Boolean(errors.phone)} />
        </Field>
      )}

      <ErrorNote error={error} />

      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner label={t('saving')} />}
        {pending ? t('saving') : t('continue')}
      </Button>
    </form>
  );
}
