'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  registrationSettingsResponseSchema,
  type RegistrationSettingsResponse,
} from '@crm/contracts';
import { Alert, Button, Field, Input, Select, Spinner, cn } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import {
  TRIAL_DAYS,
  buildRegistrationPatch,
  otpDraftFields,
  patchSize,
  registrationFieldForPath,
  registrationToDraft,
  type RegistrationDraft,
  type RegistrationField,
} from '../lib/registration-draft';
import { countryOptions, timeZoneOptions } from '../lib/zones-countries';
import { useCanEdit } from '../operator-context';
import { operatorFetch } from '../operator-fetch';
import { PageHeader } from '../ui/page-header';
import { ReadOnlyNotice } from '../ui/read-only-notice';
import { ErrorBlock, LoadingBlock } from '../ui/state';
import { useToast } from '../ui/toast';
import { useUnsavedGuard } from '../ui/use-unsaved-guard';
import { DefaultPlanField } from '../plans/default-plan-field';
import { OtpSection } from './otp-section';
import { PlatformFooterCard } from './platform-footer-card';
import { REGISTRATION_KEY as KEY } from './query-keys';
import { Section, ToggleRow } from './section-parts';
import { useProblemText } from './use-problem-text';

const NS = 'auth-registration-security.platform.registration';
type ControlId = RegistrationField | 'publicRegistration' | 'emailVerification' | 'otpEnabled';
type Errors = Partial<Record<ControlId, string>>;

export function RegistrationSettingsPage() {
  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/settings/registration', {
        schema: registrationSettingsResponseSchema,
        signal,
      }),
    refetchOnWindowFocus: false,
  });
  if (q.isPending)
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return <RegistrationForm settings={q.data} />;
}

function RegistrationForm({ settings }: { settings: RegistrationSettingsResponse }) {
  const t = useTranslations(NS);
  const problemText = useProblemText();
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCanEdit('registration');
  const [draft, setDraft] = useState<RegistrationDraft>(() => registrationToDraft(settings));
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<{ count: number; items: string[] } | null>(null);
  const [saveError, setSaveError] = useState<{ requestId?: string } | null>(null);

  const zones = useMemo(
    () => timeZoneOptions(settings.defaultTimezone),
    [settings.defaultTimezone],
  );
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const { patch, problems: draftProblems } = useMemo(
    () => buildRegistrationPatch(settings, draft),
    [settings, draft],
  );
  // A control holding an invalid value counts as a pending edit too, so Save stays reachable to explain it.
  const changed = patchSize(patch) + Object.keys(draftProblems).length;
  useUnsavedGuard(changed > 0);

  const set = <K extends keyof RegistrationDraft>(
    key: K,
    value: RegistrationDraft[K],
    control: ControlId = key as ControlId,
  ) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => (e[control] ? { ...e, [control]: undefined } : e));
  };

  const focusFirst = (keys: ControlId[]) => {
    const first = keys[0];
    if (!first) return;
    setTimeout(() => {
      const el = document.getElementById(`reg-${first}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    }, 0);
  };

  const save = useMutation({
    mutationFn: (body: typeof patch) =>
      operatorFetch('/settings/registration', {
        method: 'PATCH',
        body,
        schema: registrationSettingsResponseSchema,
      }),
    onSuccess: (data, body) => {
      qc.setQueryData(KEY, data);
      setDraft(registrationToDraft(data));
      setErrors({});
      setBanner(null);
      setSaveError(null);
      toast.success(t('saved', { count: patchSize(body) }));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        const next: Errors = {};
        const items: string[] = [];
        for (const fe of err.fieldErrors) {
          const control = registrationFieldForPath(fe.path);
          items.push(control ? `${t(`fields.${control}.label`)}: ${fe.message}` : fe.message);
          if (control && !next[control]) next[control] = fe.message;
        }
        setErrors(next);
        setSaveError(null);
        setBanner({ count: Math.max(1, err.fieldErrors.length), items });
        focusFirst(Object.keys(next) as ControlId[]);
      } else if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
        /* operatorFetch is sending the person to sign in */
      } else {
        setSaveError({ requestId: err instanceof ApiError ? err.requestId : undefined });
      }
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit || save.isPending) return;
    const { patch: body, problems } = buildRegistrationPatch(settings, draft);
    const keys = Object.keys(problems) as RegistrationField[];
    if (keys.length > 0) {
      const next: Errors = {};
      for (const k of keys) next[k] = problemText(problems[k]!);
      setErrors(next);
      setSaveError(null);
      setBanner({
        count: keys.length,
        items: keys.map((k) => `${t(`fields.${k}.label`)}: ${next[k]}`),
      });
      focusFirst(keys);
      return;
    }
    if (patchSize(body) === 0) return;
    setErrors({});
    setBanner(null);
    save.mutate(body);
  }

  const dis = !canEdit;
  const verification = draft.emailVerification;

  const text = (
    id: RegistrationField,
    extra?: {
      type?: string;
      inputMode?: 'numeric' | 'text';
      dir?: 'ltr';
      mono?: boolean;
      placeholder?: string;
    },
  ) => (
    <Field
      label={t(`fields.${id}.label`)}
      htmlFor={`reg-${id}`}
      hint={t.has(`fields.${id}.hint`) ? t(`fields.${id}.hint`) : undefined}
      error={errors[id]}
    >
      <Input
        id={`reg-${id}`}
        type={extra?.type ?? 'text'}
        inputMode={extra?.inputMode}
        value={draft[id as keyof RegistrationDraft] as string}
        onChange={(e) => set(id as keyof RegistrationDraft, e.target.value as never, id)}
        invalid={Boolean(errors[id])}
        readOnly={dis}
        dir={extra?.dir}
        placeholder={extra?.placeholder}
        autoComplete="off"
        spellCheck={false}
        className={cn(extra?.mono && 'font-mono')}
      />
    </Field>
  );

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <PageHeader
          eyebrow={t('kicker')}
          title={t('title')}
          description={t('description')}
          actions={
            <Button type="submit" disabled={!canEdit || changed === 0 || save.isPending}>
              {save.isPending && <Spinner label={t('saving')} />}
              {save.isPending ? t('saving') : t('save')}
            </Button>
          }
        />

        {!canEdit && <ReadOnlyNotice section="registration" />}
        {banner && (
          <Alert tone="danger" className="space-y-2">
            <p className="font-semibold">{t('rejected', { count: banner.count })}</p>
            <ul className="list-disc space-y-0.5 ps-5 text-xs">
              {banner.items.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </Alert>
        )}
        {saveError && (
          <Alert tone="danger" className="space-y-1">
            <p>{t('errors.unexpected')}</p>
            {saveError.requestId && (
              <p className="text-xs opacity-80">
                {t('requestId')}: <span className="font-mono">{saveError.requestId}</span>
              </p>
            )}
          </Alert>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Section
            kicker={t('policy.kicker')}
            title={t('policy.title')}
            description={t('policy.description')}
          >
            <ToggleRow
              id="reg-publicRegistration"
              label={t('fields.publicRegistration.label')}
              hint={
                draft.publicRegistration
                  ? t('fields.publicRegistration.hintOn')
                  : t('fields.publicRegistration.hintOff')
              }
              checked={draft.publicRegistration}
              onChange={(v) => set('publicRegistration', v)}
              disabled={dis}
              error={errors.publicRegistration}
            />
            <Field
              label={t('fields.emailVerification.label')}
              htmlFor="reg-emailVerification"
              hint={t(`fields.emailVerification.explain.${verification}`)}
              error={errors.emailVerification}
            >
              <Select
                id="reg-emailVerification"
                value={verification}
                onChange={(e) =>
                  set('emailVerification', e.target.value as RegistrationDraft['emailVerification'])
                }
                disabled={dis}
                invalid={Boolean(errors.emailVerification)}
              >
                {(['off', 'banner', 'block'] as const).map((m) => (
                  <option key={m} value={m}>
                    {t(`fields.emailVerification.options.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <DefaultPlanField
                value={draft.defaultPlanId}
                onChange={(slug) => set('defaultPlanId', slug)}
                error={errors.defaultPlanId}
                disabled={dis}
              />
              <Field
                label={t('fields.trialDays.label')}
                htmlFor="reg-trialDays"
                hint={t('fields.trialDays.hint', { min: TRIAL_DAYS.min, max: TRIAL_DAYS.max })}
                error={errors.trialDays}
              >
                <Input
                  id="reg-trialDays"
                  type="number"
                  inputMode="numeric"
                  min={TRIAL_DAYS.min}
                  max={TRIAL_DAYS.max}
                  value={draft.trialDays}
                  placeholder={String(settings.trialDays)}
                  onChange={(e) => set('trialDays', e.target.value)}
                  invalid={Boolean(errors.trialDays)}
                  readOnly={dis}
                  className="font-mono"
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('fields.defaultTimezone.label')}
                htmlFor="reg-defaultTimezone"
                hint={t('fields.defaultTimezone.hint')}
                error={errors.defaultTimezone}
              >
                <Select
                  id="reg-defaultTimezone"
                  value={draft.defaultTimezone}
                  onChange={(e) => set('defaultTimezone', e.target.value)}
                  disabled={dis}
                  invalid={Boolean(errors.defaultTimezone)}
                >
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('fields.defaultCountryIso.label')}
                htmlFor="reg-defaultCountryIso"
                hint={t('fields.defaultCountryIso.hint')}
                error={errors.defaultCountryIso}
              >
                <Select
                  id="reg-defaultCountryIso"
                  value={draft.defaultCountryIso}
                  onChange={(e) => set('defaultCountryIso', e.target.value)}
                  disabled={dis}
                  invalid={Boolean(errors.defaultCountryIso)}
                >
                  <option value="">{t('fields.defaultCountryIso.none')}</option>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="space-y-4">
              {text('termsUrl', { dir: 'ltr', mono: true })}
              {text('privacyUrl', { dir: 'ltr', mono: true })}
              {text('cookiesUrl', { dir: 'ltr', mono: true })}
            </div>
          </Section>

          <OtpSection
            settings={settings}
            draft={draft}
            errors={errors}
            canEdit={canEdit}
            set={set}
            onProblems={(problems) => setErrors((e) => ({ ...e, ...problems }))}
            onApplied={(data) => {
              // The OTP form was saved by the template request: it is the new baseline. Edits made
              // elsewhere on the page stay as they are.
              qc.setQueryData(KEY, data);
              setDraft((d) => ({ ...d, ...otpDraftFields(data) }));
              setErrors((e) => ({
                ...e,
                otpEnabled: undefined,
                otpSender: undefined,
                ttlMinutes: undefined,
                length: undefined,
                resendCooldownSec: undefined,
                maxAttempts: undefined,
              }));
              setSaveError(null);
            }}
            onSenderGone={(ref) => {
              if (draft.otpSender === ref) set('otpSender', '');
            }}
          />
        </div>

        <div
          className={cn(
            'sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-2.5 shadow-lg',
            changed === 0 && 'hidden',
          )}
          aria-live="polite"
        >
          <span className="text-sm">{t('unsaved', { count: changed })}</span>
          <span className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(registrationToDraft(settings));
                setErrors({});
                setBanner(null);
              }}
              disabled={save.isPending}
            >
              {t('discard')}
            </Button>
            <Button type="submit" size="sm" disabled={!canEdit || save.isPending}>
              {save.isPending && <Spinner label={t('saving')} />}
              {t('save')}
            </Button>
          </span>
        </div>
      </form>
      <PlatformFooterCard />
    </div>
  );
}
