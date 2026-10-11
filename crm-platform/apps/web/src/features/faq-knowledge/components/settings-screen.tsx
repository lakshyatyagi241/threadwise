'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FAQ_LIMITS, type FaqSettings } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Slider, Spinner, Switch, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, useFaqSettings } from '../api/hooks';
import { faqApi } from '../api/service';
import { errorKey, isRowVersionConflict } from '../lib/errors';
import {
  activePreset,
  clampThreshold,
  formFromSettings,
  presetsFor,
  settingsDirty,
  toSettingsInput,
  type PresetId,
  type SettingsForm,
} from '../lib/settings-model';
import { FaqIcon } from './icons';
import { LoadError, NoAccess, PageHeader, SectionCard, SkeletonRows } from './parts';
import { useLeaveGuard } from './use-leave-guard';

const PRESET_IDS: readonly PresetId[] = ['strict', 'balanced', 'forgiving'];

/** `/faq/settings`: the workspace switch and the two matching knobs, with the facts that explain them. */
export function SettingsScreen() {
  const canRead = useCan('faq.entries.read');
  const q = useFaqSettings(canRead);
  if (!canRead) return <NoAccess permission="faq.entries.read" />;
  if (q.isError)
    return (
      <LoadError errorKey={errorKey(q.error)} error={q.error} onRetry={() => void q.refetch()} />
    );
  if (!q.data) return <SkeletonRows rows={5} />;
  // A new version of the settings (after a save or a reload) starts a fresh form on it.
  return <SettingsBody key={q.data.rowVersion ?? 'first'} settings={q.data} />;
}

function SettingsBody({ settings }: { settings: FaqSettings }) {
  const t = useTranslations('faq.settings');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = useCan('faq.settings.manage');
  const baseline = formFromSettings(settings);
  const [form, setForm] = useState<SettingsForm>(baseline);
  const [error, setError] = useState<unknown>(null);
  const dirty = settingsDirty(form, baseline);
  const guard = useLeaveGuard(dirty);
  const disabled = !canManage;
  const presets = presetsFor(settings.recommendedThreshold);
  const preset = activePreset(form.threshold, settings.recommendedThreshold);
  const set = (patch: Partial<SettingsForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
  };

  const save = useMutation({
    mutationFn: () => faqApi.saveSettings(toSettingsInput(form, settings)),
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.settings, saved);
      toast(t('saved'));
    },
    onError: setError,
  });
  const reload = useMutation({
    mutationFn: () => faqApi.settings(),
    onSuccess: (fresh) => {
      qc.setQueryData(KEYS.settings, fresh);
      setError(null);
    },
    onError: setError,
  });

  const conflict = isRowVersionConflict(error);
  const limitPct = (used: number, max: number) =>
    Math.min(100, Math.round((used / Math.max(1, max)) * 100));

  return (
    <section className="space-y-4">
      <PageHeader
        icon={<FaqIcon className="size-5" />}
        title={t('title')}
        subtitle={t('subtitle')}
        status={
          dirty ? (
            <span className="text-xs font-medium text-warning" role="status">
              {t('unsaved')}
            </span>
          ) : undefined
        }
        actions={
          canManage && (
            <>
              <Button
                variant="secondary"
                disabled={!dirty || save.isPending}
                onClick={() => setForm(baseline)}
              >
                {t('discard')}
              </Button>
              <Button
                variant="brand"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending && <Spinner />}
                {t('save')}
              </Button>
            </>
          )
        }
      />

      {!canManage && <Alert tone="info">{t('readOnly')}</Alert>}
      {!settings.engineEnabled && <Alert tone="danger">{t('engineOff')}</Alert>}
      {conflict ? (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('conflict')}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => reload.mutate()}
            disabled={reload.isPending}
          >
            {t('reload')}
          </Button>
        </Alert>
      ) : (
        error !== null && <LoadError errorKey={errorKey(error)} error={error} />
      )}
      {settings.modelChanged && (
        <Alert tone="warning">
          <p className="font-semibold">{t('modelChanged.title')}</p>
          <p className="mt-0.5">{t('modelChanged.body')}</p>
        </Alert>
      )}

      <SectionCard id="faq-set-enable" title={t('enable.title')}>
        <div className="flex items-start gap-3">
          <Switch
            id="faq-enabled"
            checked={form.enabled}
            disabled={disabled}
            label={t('enable.label')}
            onCheckedChange={(v) => set({ enabled: v })}
          />
          <div className="min-w-0 text-sm">
            <label htmlFor="faq-enabled" className="font-medium">
              {form.enabled ? t('enable.on') : t('enable.off')}
            </label>
            <p className="mt-1 text-muted-foreground">
              {form.enabled ? t('enable.onBody') : t('enable.offBody')}
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        id="faq-set-sens"
        title={t('sens.title')}
        hint={t('sens.hint', { model: settings.embeddingModel })}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="faq-threshold" className="text-sm font-medium">
            {t('sens.label')}
          </label>
          <span className="text-2xl font-semibold tabular-nums">
            {Math.round(form.threshold * 100)}%
          </span>
        </div>
        <div role="group" aria-label={t('sens.presets')} className="flex flex-wrap gap-2">
          {PRESET_IDS.map((id) => (
            <Button
              key={id}
              size="sm"
              variant={preset === id ? 'primary' : 'secondary'}
              aria-pressed={preset === id}
              disabled={disabled}
              onClick={() => set({ threshold: presets[id] })}
            >
              {t(`sens.preset.${id}`)} ({Math.round(presets[id] * 100)}%)
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <Slider
            id="faq-threshold"
            min={FAQ_LIMITS.thresholdMin}
            max={FAQ_LIMITS.thresholdMax}
            step={0.01}
            value={form.threshold}
            disabled={disabled}
            aria-valuetext={`${Math.round(form.threshold * 100)}%`}
            onValueChange={(v) => set({ threshold: clampThreshold(v) })}
          />
          <div
            className="relative h-5 text-[10px] text-muted-foreground"
            dir="ltr"
            aria-hidden="true"
          >
            <span className="absolute left-0">{t('sens.looser')}</span>
            <span
              className="absolute -translate-x-1/2 font-medium text-foreground"
              style={{
                left: `${((settings.recommendedThreshold - FAQ_LIMITS.thresholdMin) / (FAQ_LIMITS.thresholdMax - FAQ_LIMITS.thresholdMin)) * 100}%`,
              }}
            >
              ▲{' '}
              {t('sens.recommendedMark', {
                value: Math.round(settings.recommendedThreshold * 100),
              })}
            </span>
            <span className="absolute right-0">{t('sens.stricter')}</span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('sens.explain', { value: Math.round(form.threshold * 100) })}
        </p>
        {Math.abs(form.threshold - settings.recommendedThreshold) > 0.004 && canManage && (
          <Button
            size="sm"
            variant={settings.modelChanged ? 'primary' : 'secondary'}
            onClick={() => set({ threshold: clampThreshold(settings.recommendedThreshold) })}
          >
            {t('sens.useRecommended', { value: Math.round(settings.recommendedThreshold * 100) })}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          {t('sens.modelScale', { model: settings.embeddingModel })}
        </p>
      </SectionCard>

      <SectionCard id="faq-set-margin" title={t('margin.title')} hint={t('margin.hint')}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="faq-margin" className="text-sm font-medium">
            {t('margin.label')}
          </label>
          <span className="text-2xl font-semibold tabular-nums">
            {form.minMargin === 0 ? t('margin.off') : `${Math.round(form.minMargin * 100)}%`}
          </span>
        </div>
        <Slider
          id="faq-margin"
          min={0}
          max={FAQ_LIMITS.marginMax}
          step={0.01}
          value={form.minMargin}
          disabled={disabled}
          aria-valuetext={
            form.minMargin === 0 ? t('margin.off') : `${Math.round(form.minMargin * 100)}%`
          }
          onValueChange={(v) => set({ minMargin: Math.round(v * 100) / 100 })}
        />
        <p className="text-sm text-muted-foreground">{t('margin.explain')}</p>
      </SectionCard>

      <SectionCard id="faq-set-log" title={t('log.title')}>
        <div className="flex items-start gap-3">
          <Switch
            id="faq-logq"
            checked={form.logQueries}
            disabled={disabled}
            label={t('log.label')}
            onCheckedChange={(v) => set({ logQueries: v })}
          />
          <div className="min-w-0 text-sm">
            <label htmlFor="faq-logq" className="font-medium">
              {t('log.label')}
            </label>
            <p className="mt-1 text-muted-foreground">
              {form.logQueries ? t('log.onBody') : t('log.offBody')}
            </p>
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard id="faq-set-facts" title={t('facts.title')}>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{t('facts.model')}</dt>
              <dd className="font-mono">{settings.embeddingModel}</dd>
            </div>
            {[
              ['faqs', settings.usage.faqs, settings.limits.maxFaqs],
              [
                'variations',
                settings.usage.variations,
                settings.limits.maxFaqs * settings.limits.maxVariationsPerFaq,
              ],
            ].map(([key, used, max]) => (
              <div key={key as string}>
                <dt className="text-xs text-muted-foreground">
                  {t(`facts.${key as 'faqs' | 'variations'}`)}
                </dt>
                <dd>
                  {key === 'faqs' ? (
                    <>
                      <span className="tabular-nums">
                        {t('facts.of', { used: used as number, max: max as number })}
                      </span>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            'h-full',
                            limitPct(used as number, max as number) >= 90
                              ? 'bg-warning'
                              : 'bg-primary',
                          )}
                          style={{ width: `${limitPct(used as number, max as number)}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <span className="tabular-nums">{used as number}</span>
                  )}
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-muted-foreground">{t('facts.perFaq')}</dt>
              <dd className="tabular-nums">{settings.limits.maxVariationsPerFaq}</dd>
            </div>
          </dl>
        </SectionCard>
        <SectionCard id="faq-set-how" title={t('how.title')}>
          <ol className="list-decimal space-y-2 ps-5 text-sm text-muted-foreground">
            <li>{t('how.exact')}</li>
            <li>{t('how.semantic')}</li>
            <li>{t('how.trigram')}</li>
          </ol>
          <p className="text-sm text-muted-foreground">{t('how.threshold')}</p>
        </SectionCard>
      </div>

      <p className="text-xs text-muted-foreground">{t('who')}</p>

      <ConfirmDialog
        open={guard.target !== null}
        title={t('leave.title')}
        message={t('leave.body')}
        confirmLabel={t('leave.leave')}
        cancelLabel={t('leave.stay')}
        tone="danger"
        onClose={guard.stay}
        onConfirm={guard.leave}
      />
    </section>
  );
}
