'use client';

import {
  ERROR_CODES,
  industrySchema,
  onboardingWorkspaceRequestSchema,
  teamSizeSchema,
  type OnboardingResponse,
} from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import type { CountryCode } from 'libphonenumber-js';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api/errors';
import { FormField } from '../../guest/form-field';
import { evaluatePhone, pickDefaultCountry } from '../../guest/phone';
import { PhoneInput, type PhoneValue } from '../../guest/phone-input';
import { ArrowIcon, Button, Input, Select, Spinner } from '../../guest/ui';
import { ErrorNote } from '../../shared/error-note';
import { focusFirstInvalid } from '../../shared/focus';
import { redirectOnGateError } from '../../shared/gate-errors';
import { modernZoneId } from '../../shared/timezones';
import { authApi, keys } from '../api';
import { ZoneSelect } from './zone-select';

type FieldKey = 'name' | 'industry' | 'sizeRange' | 'timezone' | 'phone';
type Errors = Partial<Record<FieldKey, string>>;

const INDUSTRIES = industrySchema.options;
const SIZES = teamSizeSchema.options;

/**
 * Step 2 of 3: name the workspace, say what it is for, pick its timezone (TW-AUTH-008). The mobile number is asked
 * only when the account has none (an account made with Google or Facebook).
 */
export function WorkspaceStep({
  data,
  defaultCountryIso,
  onSaved,
}: {
  data: OnboardingResponse;
  /** The platform's default country: the phone picker opens on it. */
  defaultCountryIso: string | null;
  onSaved: () => void;
}) {
  const t = useTranslations('auth-registration-security.account.onboarding.workspace');
  const tg = useTranslations('auth-registration-security.gate.onboarding');
  const router = useRouter();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);

  // The organization already has the name chosen at sign-up; the suggestion fills in only when that is blank.
  const [name, setName] = useState(data.workspace.name || data.suggestedName);
  const [industry, setIndustry] = useState(data.workspace.industry ?? '');
  const [size, setSize] = useState(data.workspace.sizeRange ?? '');
  const [zone, setZone] = useState(modernZoneId(data.workspace.timezone ?? data.defaultTimezone));
  const defaultIso = pickDefaultCountry(defaultCountryIso);
  const [phoneEdit, setPhoneEdit] = useState<{ raw: string; iso: CountryCode } | null>(null);
  const phone = useMemo<PhoneValue>(() => {
    const raw = phoneEdit?.raw ?? '';
    const iso = phoneEdit?.iso ?? defaultIso;
    return { raw, iso, state: evaluatePhone(raw, iso) };
  }, [phoneEdit, defaultIso]);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

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
      if (!phone.raw.trim()) found.phone = t('errors.phoneRequired');
      else if (!phone.state.valid) found.phone = t('errors.phoneInvalid');
    }
    const parsed = onboardingWorkspaceRequestSchema.safeParse({
      name: name.trim(),
      industry: industry || undefined,
      sizeRange: size || undefined,
      timezone: zone,
      phone: data.needsPhone ? (phone.state.e164 ?? undefined) : undefined,
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
    <form ref={formRef} onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
      <FormField label={t('name')} hint={t('nameHint')} error={errors.name}>
        {(p) => (
          <Input
            {...p}
            value={name}
            maxLength={120}
            autoComplete="organization"
            placeholder={t('namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            className="py-2"
            required
          />
        )}
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('industry')} error={errors.industry}>
          {(p) => (
            <Select
              {...p}
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="py-2"
            >
              <option value="">{t('industryPlaceholder')}</option>
              {INDUSTRIES.map((value) => (
                <option key={value} value={value}>
                  {t(`industries.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t('size')} error={errors.sizeRange}>
          {(p) => (
            <Select {...p} value={size} onChange={(e) => setSize(e.target.value)} className="py-2">
              <option value="">{t('sizePlaceholder')}</option>
              {SIZES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <FormField label={t('timezone')} hint={t('timezoneHint')} error={errors.timezone}>
        {(p) => (
          <ZoneSelect
            id={p.id}
            value={zone}
            onChange={setZone}
            extra={[data.defaultTimezone]}
            invalid={p.invalid}
          />
        )}
      </FormField>

      {data.needsPhone && (
        <FormField label={t('phone')} hint={t('phoneHint')} error={errors.phone}>
          {(p) => (
            <PhoneInput
              id={p.id}
              name="phone"
              value={phone}
              onChange={(next) => setPhoneEdit({ raw: next.raw, iso: next.iso })}
              invalid={p.invalid}
              describedBy={p['aria-describedby']}
              placeholder={tg('phonePlaceholder')}
            />
          )}
        </FormField>
      )}

      <ErrorNote error={error} />

      <Button type="submit" className="mt-2 w-full py-2.5" disabled={pending}>
        {pending ? <Spinner label={t('saving')} /> : null}
        {pending ? t('saving') : t('continue')}
        {!pending && <ArrowIcon />}
      </Button>
    </form>
  );
}
