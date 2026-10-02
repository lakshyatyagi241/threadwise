'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import type { SetupBootstrapResponse, SetupStatusResponse } from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PasswordInput,
  Select,
  Spinner,
  cn,
} from '@crm/ui';
import { suggestSlug } from '@/features/auth-registration-security/guest/slug';
import { TimezoneCombobox } from '@/features/auth-registration-security/shared/timezone-combobox';
import { LOCALES } from '@/i18n/locales';
import { languageName } from '@/features/auth-registration-security/platform/ui/language';
import { bootstrapPlatform, verifySetupToken } from './setup-api';
import {
  SETUP_STEPS,
  classifyFailure,
  emptyDraft,
  firstInvalidStep,
  passwordRules,
  toRequest,
  validateStep,
  type FieldErrors,
  type SetupDraft,
  type SetupFailure,
  type SetupStep,
} from './setup-draft';

const NS = 'install-update-licensing.setup';
const PASSWORD_RULES = ['length', 'upper', 'lower', 'number', 'symbol', 'personal'] as const;

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * First-run setup: prove the deploy-time token, create the platform owner, name the first workspace, review, create.
 * Steps are a client convenience only; the single bootstrap call re-checks everything on the server, so skipping a
 * step by hand gains nothing (the WaDesk wizard's gate lived on its pages).
 */
export function SetupWizard({ status }: { status: SetupStatusResponse }) {
  const t = useTranslations(NS);
  const idPrefix = useId();
  const [step, setStep] = useState<SetupStep>('token');
  const [draft, setDraft] = useState<SetupDraft>(() => emptyDraft(browserZone()));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<SetupFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SetupBootstrapResponse | null>(null);

  const notReady = status.prerequisites.filter((p) => !p.ok);
  const disabled = !status.tokenConfigured;
  const blocked = disabled || notReady.length > 0;
  const stepIndex = SETUP_STEPS.indexOf(step);

  const set = (patch: Partial<SetupDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch) as Array<keyof SetupDraft>) delete next[k];
      return next;
    });
    setFailure(null);
  };

  const field = (name: keyof SetupDraft) => `${idPrefix}-${name}`;
  const err = (name: keyof SetupDraft) => (errors[name] ? t(`errors.${errors[name]}`) : undefined);

  /** Applies a server refusal to the form: back to the right step with the message next to the field. */
  const fail = (f: SetupFailure) => {
    setFailure(f);
    if (f.kind === 'token') {
      setStep('token');
      setErrors({ setupToken: 'tokenWrong' });
    } else if (f.kind === 'slugTaken') {
      setStep('organization');
      setErrors({ slug: 'slugTaken' });
    } else if (f.kind === 'fields') {
      setStep(f.step);
      setErrors(f.fields);
    }
  };

  async function next(e: FormEvent) {
    e.preventDefault();
    if (busy || done) return;
    const problems = validateStep(step, draft);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setFailure(null);

    if (step === 'token') {
      setBusy(true);
      try {
        await verifySetupToken(draft.setupToken.trim());
        setStep('operator');
      } catch (error) {
        fail(classifyFailure(error));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step !== 'review') {
      setStep(SETUP_STEPS[stepIndex + 1]!);
      return;
    }

    const bad = firstInvalidStep(draft);
    if (bad) {
      setStep(bad);
      setErrors(validateStep(bad, draft));
      return;
    }
    setBusy(true);
    try {
      setDone(await bootstrapPlatform(toRequest(draft)));
    } catch (error) {
      fail(classifyFailure(error));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Finished result={done} />;
  if (failure?.kind === 'completed') return <Completed />;

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </header>

      <ol className="flex flex-wrap gap-2" aria-label={t('stepsLabel')}>
        {SETUP_STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
              s === step ? 'border-primary text-foreground' : 'border-border text-muted-foreground',
            )}
          >
            <span className="font-mono">{i + 1}</span>
            {t(`steps.${s}`)}
          </li>
        ))}
      </ol>

      {disabled && <Alert tone="warning">{t('disabled')}</Alert>}
      {notReady.length > 0 && (
        <Alert tone="danger" className="space-y-1">
          <p className="font-medium">{t('notReady')}</p>
          <ul className="list-disc ps-5">
            {notReady.map((p) => (
              <li key={p.key}>
                {t(`prerequisites.${p.key}`)}
                {p.detail ? ` (${p.detail})` : ''}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {failure?.kind === 'prerequisites' && <Alert tone="danger">{t('notReady')}</Alert>}
      {failure?.kind === 'unknown' && (
        <Alert tone="danger">
          {t('errors.unexpected')}
          {failure.requestId ? ` (${failure.requestId})` : ''}
        </Alert>
      )}

      <Card>
        <form onSubmit={next} noValidate className="space-y-4">
          {step === 'token' && (
            <Field
              label={t('token.label')}
              htmlFor={field('setupToken')}
              hint={t('token.hint')}
              error={err('setupToken')}
            >
              <PasswordInput
                id={field('setupToken')}
                value={draft.setupToken}
                onChange={(e) => set({ setupToken: e.target.value })}
                invalid={!!errors.setupToken}
                autoComplete="off"
                spellCheck={false}
                disabled={blocked}
                showLabel={t('show')}
                hideLabel={t('hide')}
              />
            </Field>
          )}

          {step === 'operator' && (
            <>
              <Field
                label={t('operator.fullName')}
                htmlFor={field('fullName')}
                error={err('fullName')}
              >
                <Input
                  id={field('fullName')}
                  value={draft.fullName}
                  onChange={(e) => set({ fullName: e.target.value })}
                  invalid={!!errors.fullName}
                  autoComplete="name"
                />
              </Field>
              <Field
                label={t('operator.email')}
                htmlFor={field('email')}
                hint={t('operator.emailHint')}
                error={err('email')}
              >
                <Input
                  id={field('email')}
                  type="email"
                  value={draft.email}
                  onChange={(e) => set({ email: e.target.value })}
                  invalid={!!errors.email}
                  autoComplete="email"
                />
              </Field>
              <Field
                label={t('operator.password')}
                htmlFor={field('password')}
                error={err('password')}
              >
                <PasswordInput
                  id={field('password')}
                  value={draft.password}
                  onChange={(e) => set({ password: e.target.value })}
                  invalid={!!errors.password}
                  autoComplete="new-password"
                  showLabel={t('show')}
                  hideLabel={t('hide')}
                />
              </Field>
              <PasswordChecklist draft={draft} />
              <Field
                label={t('operator.confirm')}
                htmlFor={field('confirm')}
                error={err('confirm')}
              >
                <PasswordInput
                  id={field('confirm')}
                  value={draft.confirm}
                  onChange={(e) => set({ confirm: e.target.value })}
                  invalid={!!errors.confirm}
                  autoComplete="new-password"
                  showLabel={t('show')}
                  hideLabel={t('hide')}
                />
              </Field>
            </>
          )}

          {step === 'organization' && (
            <>
              <Field
                label={t('organization.name')}
                htmlFor={field('orgName')}
                error={err('orgName')}
              >
                <Input
                  id={field('orgName')}
                  value={draft.orgName}
                  onChange={(e) =>
                    set({
                      orgName: e.target.value,
                      ...(draft.slugEdited ? {} : { slug: suggestSlug(e.target.value) }),
                    })
                  }
                  invalid={!!errors.orgName}
                  autoComplete="organization"
                />
              </Field>
              <Field
                label={t('organization.slug')}
                htmlFor={field('slug')}
                hint={t('organization.slugHint')}
                error={err('slug')}
              >
                <Input
                  id={field('slug')}
                  value={draft.slug}
                  onChange={(e) => set({ slug: e.target.value.trim(), slugEdited: true })}
                  invalid={!!errors.slug}
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </Field>
              <Field
                label={t('organization.timezone')}
                htmlFor={field('timezone')}
                error={err('timezone')}
              >
                <TimezoneCombobox
                  id={field('timezone')}
                  value={draft.timezone}
                  onChange={(timezone) => set({ timezone })}
                  invalid={!!errors.timezone}
                />
              </Field>
              <Field
                label={t('organization.locale')}
                htmlFor={field('locale')}
                error={err('locale')}
              >
                <Select
                  id={field('locale')}
                  value={draft.locale}
                  onChange={(e) => set({ locale: e.target.value })}
                  invalid={!!errors.locale}
                >
                  {LOCALES.map((code) => (
                    <option key={code} value={code}>
                      {languageName(code)}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}

          {step === 'review' && <Review draft={draft} />}

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              variant="ghost"
              disabled={stepIndex === 0 || busy}
              onClick={() => setStep(SETUP_STEPS[stepIndex - 1]!)}
            >
              {t('back')}
            </Button>
            <Button type="submit" disabled={busy || blocked}>
              {busy && <Spinner label={t('working')} />}
              {step === 'token' ? t('verify') : step === 'review' ? t('create') : t('continue')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function PasswordChecklist({ draft }: { draft: SetupDraft }) {
  const t = useTranslations(NS);
  const broken = new Set<string>(passwordRules(draft));
  return (
    <ul className="grid gap-1 text-xs sm:grid-cols-2" aria-label={t('operator.rulesLabel')}>
      {PASSWORD_RULES.filter((r) => r !== 'personal' || broken.has(r)).map((rule) => {
        const ok = !broken.has(rule) && draft.password.length > 0;
        return (
          <li key={rule} className={ok ? 'text-success' : 'text-muted-foreground'}>
            <span aria-hidden="true">{ok ? '✓' : '·'} </span>
            {t(`operator.rules.${rule}`)}
          </li>
        );
      })}
    </ul>
  );
}

function Review({ draft }: { draft: SetupDraft }) {
  const t = useTranslations(NS);
  const rows: Array<[string, string]> = [
    [t('operator.fullName'), draft.fullName],
    [t('operator.email'), draft.email],
    [t('organization.name'), draft.orgName],
    [t('organization.slug'), draft.slug],
    [t('organization.timezone'), draft.timezone],
    [t('organization.locale'), languageName(draft.locale)],
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('review.intro')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <Alert tone="info">{t('review.mfaNote')}</Alert>
    </div>
  );
}

function Finished({ result }: { result: SetupBootstrapResponse }) {
  const t = useTranslations(NS);
  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <Alert tone="success" className="space-y-1">
        <p className="font-medium">{t('done.title')}</p>
        <p>{t('done.body', { email: result.operator.email, org: result.organization.name })}</p>
      </Alert>
      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge tone="warning">{t('done.mfaBadge')}</Badge>
          <p className="text-sm">{t('done.mfaNote')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/login"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            {t('done.console')}
          </Link>
          <Link
            href={`/login?org=${encodeURIComponent(result.organization.slug)}`}
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium"
          >
            {t('done.workspace')}
          </Link>
        </div>
      </Card>
    </div>
  );
}

function Completed() {
  const t = useTranslations(NS);
  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <Alert tone="warning">{t('completed.body')}</Alert>
      <Link href="/login" className="text-sm underline">
        {t('completed.login')}
      </Link>
    </div>
  );
}
