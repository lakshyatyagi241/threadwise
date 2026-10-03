'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, ConfirmDialog, Spinner, cn } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { useUnsavedGuard } from '@/features/auth-registration-security/platform/ui/use-unsaved-guard';
import { providersApi } from '../api/client';
import { usePresets, useRefreshAll, useWapAccess } from '../api/hooks';
import type { Preset, Provider, TestInput, TestResult } from '../api/schemas';
import { errorView, serverFieldErrors } from '../lib/errors';
import {
  STEPS,
  draftFromPreset,
  emptyDraft,
  stepIsValid,
  toCreateInput,
  toUpdateInput,
  validateDraft,
  type ProviderDraft,
  type Step,
} from '../lib/provider-draft';
import { baseHost } from '../lib/urls';
import { HelpPanel } from './help-panel';
import { BillingSection, ConnectionSection, CredentialsSection } from './provider-sections';
import { Section } from './parts';
import { TestPanel } from './test-panel';

const sameDraft = (a: ProviderDraft, b: ProviderDraft) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The add-provider wizard: preset, connection, credentials and webhooks, billing and capabilities, test. The provider is created
 * switched off when the form is complete and only turned on after a passing test, so nothing untested ever carries traffic.
 */
export function ProviderWizard() {
  const t = useTranslations('whatsapp-providers.wizard');
  const te = useTranslations('whatsapp-providers.errors');
  const router = useRouter();
  const toast = useToast();
  const refresh = useRefreshAll();
  const { access, ready } = useWapAccess();
  const { presets, isPending } = usePresets();

  const [step, setStep] = useState<Step>('preset');
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft>(emptyDraft);
  const [baseline, setBaseline] = useState<ProviderDraft>(emptyDraft);
  const [shown, setShown] = useState<Set<Step>>(new Set());
  const [created, setCreated] = useState<Provider | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [ids, setIds] = useState<TestInput>({ wabaId: '', phoneNumberId: '' });
  const [result, setResult] = useState<TestResult | null>(null);
  const [leaving, setLeaving] = useState(false);

  const dirty = presetKey !== null && !created && !sameDraft(draft, baseline);
  useUnsavedGuard(dirty);

  const index = STEPS.indexOf(step);
  const errors = useMemo(
    () => (step === 'preset' || step === 'test' ? {} : validateDraft(draft, step, created)),
    [draft, step, created],
  );
  const showErrors = shown.has(step);

  const choose = (p: Preset) => {
    const next = draftFromPreset(p);
    setPresetKey(p.key);
    setDraft(next);
    setBaseline(next);
    setServerErrors({});
  };

  const patch = (p: Partial<ProviderDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setServerErrors({});
    // Any edit invalidates a test that passed for different settings.
    setResult(null);
  };

  const save = useMutation({
    mutationFn: (): Promise<Provider> =>
      created
        ? providersApi.update(created.id, toUpdateInput(created, draft))
        : providersApi.create(toCreateInput(draft, 'disabled')),
    onSuccess: (p) => {
      setCreated(p);
      setProblem(null);
      setStep('test');
      void refresh();
    },
    onError: (e) => {
      const view = errorView(e);
      setProblem(te(view.kind));
      setServerErrors(serverFieldErrors(e));
      // A refused field belongs to an earlier step: send the operator back to it.
      if (
        view.kind === 'keyTaken' ||
        view.kind === 'baseUrlRefused' ||
        view.kind === 'headerInvalid'
      )
        setStep('connection');
      else if (view.kind === 'secretsMissing') setStep('credentials');
    },
  });

  const activate = useMutation({
    mutationFn: () => providersApi.setEnabled(created!.id, true, created!.rowVersion),
    onSuccess: (p) => {
      toast.success(t('activated', { label: p.label }));
      void refresh();
      router.push(`/admin/whatsapp-providers/${p.id}`);
    },
    onError: (e) => setProblem(te(errorView(e).kind)),
  });

  const next = () => {
    setShown((s) => new Set(s).add(step));
    if (!stepIsValid(draft, step)) return;
    if (step === 'billing') return save.mutate();
    setStep(STEPS[index + 1] ?? step);
  };
  const back = () => setStep(STEPS[Math.max(0, index - 1)] ?? 'preset');

  if (ready && !access.manage) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} />
        <Alert tone="warning">{t('noAccess')}</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (dirty ? setLeaving(true) : router.push('/admin/whatsapp-providers'))}
          >
            {t('cancel')}
          </Button>
        }
      />

      <ol className="flex flex-wrap gap-2" aria-label={t('stepsLabel')}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
              s === step
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : i < index
                  ? 'border-border text-foreground'
                  : 'border-border text-muted-foreground',
            )}
          >
            <span className="tabular-nums">{i + 1}</span>
            <span>{t(`steps.${s}`)}</span>
          </li>
        ))}
      </ol>

      {problem && (
        <Alert tone="danger" role="alert">
          {problem}
        </Alert>
      )}

      {step === 'preset' &&
        (isPending ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-4">
            <Section title={t('preset.title')} description={t('preset.description')}>
              <div
                role="radiogroup"
                aria-label={t('preset.title')}
                className="grid gap-3 md:grid-cols-3"
              >
                {presets.map((p) => {
                  const selected = presetKey === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-testid={`preset-${p.key}`}
                      onClick={() => choose(p)}
                      className={cn(
                        'space-y-2 rounded-md border p-4 text-start transition focus-visible:ring-2 focus-visible:ring-primary',
                        selected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/50',
                      )}
                    >
                      <span className="block font-medium">{p.label}</span>
                      <span className="block text-sm text-muted-foreground">{p.description}</span>
                      {p.defaults.baseUrl && (
                        <span dir="ltr" className="block font-mono text-xs text-muted-foreground">
                          {baseHost(p.defaults.baseUrl)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {presetKey && <p className="text-sm text-muted-foreground">{t('preset.chosen')}</p>}
            </Section>
            <HelpPanel />
          </div>
        ))}

      {step === 'connection' && (
        <Section title={t('connection.title')} description={t('connection.description')}>
          <ConnectionSection
            draft={draft}
            patch={patch}
            errors={showErrors ? errors : {}}
            serverErrors={serverErrors}
            existing={created}
            previewValues={ids}
          />
        </Section>
      )}

      {step === 'credentials' && (
        <Section title={t('credentials.title')} description={t('credentials.description')}>
          <CredentialsSection
            draft={draft}
            patch={patch}
            errors={showErrors ? errors : {}}
            serverErrors={serverErrors}
            existing={created}
          />
        </Section>
      )}

      {step === 'billing' && (
        <Section title={t('billing.title')} description={t('billing.description')}>
          <BillingSection
            draft={draft}
            patch={patch}
            errors={showErrors ? errors : {}}
            serverErrors={serverErrors}
            existing={created}
          />
        </Section>
      )}

      {step === 'test' && created && (
        <Section title={t('test.title')} description={t('test.description')}>
          <TestPanel
            values={ids}
            onValues={setIds}
            result={result}
            onResult={setResult}
            run={async (v) => {
              const r = await providersApi.test(created.id, v);
              void refresh();
              return r;
            }}
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button
              type="button"
              disabled={!result?.ok || activate.isPending}
              onClick={() => activate.mutate()}
            >
              {activate.isPending && <Spinner label={t('activating')} />}
              {t('activate')}
            </Button>
            <Link href={`/admin/whatsapp-providers/${created.id}`}>
              <Button type="button" variant="secondary">
                {t('keepOff')}
              </Button>
            </Link>
            {!result?.ok && (
              <span className="text-xs text-muted-foreground">{t('activateNeedsTest')}</span>
            )}
          </div>
        </Section>
      )}

      {step !== 'test' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" onClick={back} disabled={index === 0 || save.isPending}>
            {t('back')}
          </Button>
          <Button onClick={next} disabled={(step === 'preset' && !presetKey) || save.isPending}>
            {save.isPending && <Spinner label={t('saving')} />}
            {step === 'billing' ? (created ? t('saveAndTest') : t('createAndTest')) : t('next')}
          </Button>
        </div>
      )}
      {step === 'test' && (
        <div>
          <Button variant="secondary" onClick={back} disabled={activate.isPending}>
            {t('back')}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">{t('backNote')}</p>
        </div>
      )}

      <ConfirmDialog
        open={leaving}
        title={t('discard.title')}
        message={t('discard.body')}
        confirmLabel={t('discard.confirm')}
        cancelLabel={t('discard.keep')}
        tone="danger"
        onConfirm={() => router.push('/admin/whatsapp-providers')}
        onClose={() => setLeaving(false)}
      />
    </div>
  );
}
