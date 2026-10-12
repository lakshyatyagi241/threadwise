'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, ConfirmDialog, Field, Input, Select, Switch } from '@crm/ui';
import { faqRecommendedThreshold } from '@crm/contracts';
import type { FaqPlatformConfig, UpdateFaqPlatformConfigInput } from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import {
  LIMIT_RANGES,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  diffConfig,
  draftFromConfig,
  errorKind,
  fieldErrorsFromApi,
  riskOf,
  type ConfigDraft,
  type FieldErrors,
  type FieldKey,
  type FieldProblem,
} from './logic';
import { OVERVIEW_KEY, overviewSchema } from './queries';

const NS = 'faq-knowledge-admin.settings';

/** The engine switch, the models, the default threshold and the limits. Only fields that differ from the saved config are sent. */
export function SettingsCard({ config }: { config: FaqPlatformConfig }) {
  const t = useTranslations(NS);
  const tc = useTranslations('faq-knowledge-admin.common');
  const format = useFormatter();
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState<ConfigDraft>(() => draftFromConfig(config));
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [review, setReview] = useState<UpdateFaqPlatformConfigInput | null>(null);

  const diff = diffConfig(config, draft);
  const dirty = diff.changed.length > 0;

  // Saving or discarding turns the focused button off; without this focus would fall to the page body and a keyboard user would
  // lose their place. It goes to the card's heading instead.
  const heading = useRef<HTMLHeadingElement>(null);
  const wasDirty = useRef(false);
  useEffect(() => {
    const was = wasDirty.current;
    wasDirty.current = dirty;
    if (dirty || !was) return;
    const id = requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body || (a instanceof HTMLButtonElement && a.disabled)) {
        heading.current?.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [dirty]);
  const problems: FieldErrors = { ...(showErrors && !diff.ok ? diff.errors : {}), ...serverErrors };

  // `isPending` only turns true after the next render, so a fast double click would send twice; the ref closes that window.
  const sending = useRef(false);

  const save = useMutation({
    mutationFn: (body: UpdateFaqPlatformConfigInput) =>
      operatorFetch('/faq', { method: 'PATCH', body, schema: overviewSchema }),
    onSuccess: (overview) => {
      qc.setQueryData(OVERVIEW_KEY, overview);
      setDraft(draftFromConfig(overview.config));
      setServerErrors({});
      setShowErrors(false);
      setReview(null);
      toast.success(t('saved'));
    },
    onError: (err) => {
      setReview(null);
      setServerErrors(fieldErrorsFromApi(err));
      toast.error(tc(`errors.${errorKind(err)}`));
    },
    onSettled: () => {
      sending.current = false;
    },
  });

  const send = (body: UpdateFaqPlatformConfigInput) => {
    if (sending.current) return;
    sending.current = true;
    save.mutate(body);
  };

  const set = (patch: Partial<ConfigDraft>, field: FieldKey) => {
    setServerErrors((e) => {
      const { [field]: _gone, ...rest } = e;
      return rest;
    });
    setDraft((d) => ({ ...d, ...patch }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || save.isPending) return;
    if (!diff.ok) return setShowErrors(true);
    const risk = riskOf(config, diff.body);
    if (risk.engineOff || risk.modelChange) setReview(diff.body);
    else send(diff.body);
  };

  const message = (p: FieldProblem | undefined) => {
    if (!p) return undefined;
    if (p.kind === 'range') {
      return t('errors.range', { min: format.number(p.min), max: format.number(p.max) });
    }
    return t(`errors.${p.kind}`);
  };

  const price = (v: number) =>
    format.number(v, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const models = config.allowedModels;
  const picked = models.find((m) => m.id === draft.embeddingModel);
  const label = (modelId: string) => models.find((m) => m.id === modelId)?.label ?? modelId;
  const recommended = picked?.recommendedThreshold ?? faqRecommendedThreshold(draft.embeddingModel);
  const shownThreshold = draft.followModel ? recommended : draft.defaultThreshold;
  const risk = review ? riskOf(config, review) : null;

  const limitField = (key: keyof typeof LIMIT_RANGES, hint?: string) => (
    <Field
      label={t(`limits.${key}`)}
      htmlFor={`${id}-${key}`}
      hint={hint}
      error={message(problems[key])}
    >
      <Input
        id={`${id}-${key}`}
        inputMode="numeric"
        dir="ltr"
        value={draft[key]}
        invalid={Boolean(problems[key])}
        onChange={(e) => set({ [key]: e.target.value }, key)}
      />
    </Field>
  );

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
          {t('title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <form onSubmit={submit} noValidate className="space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="min-w-0 space-y-0.5">
            <label htmlFor={`${id}-engine`} className="block text-sm font-medium">
              {t('engine.label')}
            </label>
            <p className="text-xs text-muted-foreground">{t('engine.hint')}</p>
          </div>
          <Switch
            id={`${id}-engine`}
            label={t('engine.label')}
            checked={draft.engineEnabled}
            onCheckedChange={(v) => set({ engineEnabled: v }, 'engineEnabled')}
          />
        </div>

        <Field
          label={t('embeddingModel.label')}
          htmlFor={`${id}-model`}
          hint={t('embeddingModel.hint')}
          error={message(problems.embeddingModel)}
        >
          <Select
            id={`${id}-model`}
            value={draft.embeddingModel}
            invalid={Boolean(problems.embeddingModel)}
            onChange={(e) => set({ embeddingModel: e.target.value }, 'embeddingModel')}
          >
            {!picked && (
              <option value={draft.embeddingModel}>
                {t('embeddingModel.unknownOption', { id: draft.embeddingModel })}
              </option>
            )}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {t('embeddingModel.option', {
                  label: m.label,
                  price: price(m.pricePerMillionTokens),
                  threshold: m.recommendedThreshold.toFixed(2),
                })}
              </option>
            ))}
          </Select>
        </Field>
        {picked && (
          <div className="-mt-2 rounded-md bg-muted px-3 py-2 text-sm">
            <p className="text-xs text-foreground">
              {t('embeddingModel.details', {
                dimensions: picked.dimensions,
                price: price(picked.pricePerMillionTokens),
                threshold: picked.recommendedThreshold.toFixed(2),
              })}
            </p>
            <p className="mt-1">{picked.note}</p>
          </div>
        )}

        <Field
          label={t('generationModel.label')}
          htmlFor={`${id}-gen`}
          hint={t('generationModel.hint')}
          error={message(problems.generationModel)}
        >
          <Input
            id={`${id}-gen`}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            maxLength={120}
            placeholder={t('generationModel.placeholder')}
            value={draft.generationModel}
            invalid={Boolean(problems.generationModel)}
            onChange={(e) => set({ generationModel: e.target.value }, 'generationModel')}
          />
        </Field>

        <Field
          label={
            <span className="flex items-center justify-between gap-2">
              {t('threshold.label')}
              <output
                htmlFor={`${id}-threshold`}
                className="font-mono text-sm tabular-nums"
                dir="ltr"
              >
                {t('threshold.value', { value: shownThreshold.toFixed(2) })}
              </output>
            </span>
          }
          htmlFor={`${id}-threshold`}
          hint={t('threshold.hint')}
          error={message(problems.defaultThreshold)}
        >
          <input
            id={`${id}-threshold`}
            type="range"
            dir="ltr"
            min={THRESHOLD_MIN}
            max={THRESHOLD_MAX}
            step={0.01}
            value={shownThreshold}
            disabled={draft.followModel}
            onChange={(e) =>
              set(
                { defaultThreshold: Math.round(Number(e.target.value) * 100) / 100 },
                'defaultThreshold',
              )
            }
            className="w-full accent-primary"
          />
        </Field>
        <div className="-mt-2 flex items-start gap-2">
          <input
            id={`${id}-follow`}
            type="checkbox"
            className="mt-1 size-4 accent-primary"
            checked={draft.followModel}
            onChange={(e) =>
              // Un-ticking fixes the number the slider was showing (the picked model's recommendation), not the saved model's.
              set(
                e.target.checked
                  ? { followModel: true }
                  : { followModel: false, defaultThreshold: recommended },
                'defaultThreshold',
              )
            }
          />
          <label htmlFor={`${id}-follow`} className="text-sm">
            {t('threshold.follow')}
            <span className="block text-xs text-muted-foreground">
              {t('threshold.followHint', { value: recommended.toFixed(2) })}
            </span>
          </label>
        </div>

        <fieldset className="space-y-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-semibold">{t('verify.title')}</legend>
          <p className="text-xs text-muted-foreground">{t('verify.description')}</p>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-0.5">
              <label htmlFor={`${id}-verify`} className="block text-sm font-medium">
                {t('verify.enabled.label')}
              </label>
              <p className="text-xs text-muted-foreground">{t('verify.enabled.hint')}</p>
            </div>
            <Switch
              id={`${id}-verify`}
              label={t('verify.enabled.label')}
              checked={draft.verifyEnabled}
              onCheckedChange={(v) => set({ verifyEnabled: v }, 'verifyEnabled')}
            />
          </div>
          <Field
            label={t('verify.model.label')}
            htmlFor={`${id}-verify-model`}
            hint={t('verify.model.hint')}
            error={message(problems.verifyModel)}
          >
            <Input
              id={`${id}-verify-model`}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              maxLength={120}
              placeholder={t('generationModel.placeholder')}
              value={draft.verifyModel}
              invalid={Boolean(problems.verifyModel)}
              onChange={(e) => set({ verifyModel: e.target.value }, 'verifyModel')}
            />
          </Field>
          <div className="max-w-xs">{limitField('verifyPerHour', t('verify.perHourHint'))}</div>
        </fieldset>

        <fieldset className="space-y-3 border-t pt-4">
          <legend className="pe-2 text-sm font-semibold">{t('limits.title')}</legend>
          <div className="grid gap-4 md:grid-cols-3">
            {limitField('maxFaqs')}
            {limitField('maxVariationsPerFaq')}
            {limitField('semanticPerHour', t('limits.semanticPerHourHint'))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="submit" disabled={!dirty || save.isPending}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft(draftFromConfig(config));
              setServerErrors({});
              setShowErrors(false);
            }}
          >
            {t('reset')}
          </Button>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {dirty ? t('changed', { count: diff.changed.length }) : t('unchanged')}
          </span>
        </div>
      </form>

      <ConfirmDialog
        open={review !== null}
        title={t('confirm.title')}
        message={
          <div className="space-y-3">
            {risk?.engineOff && <Alert tone="warning">{t('confirm.engineOff')}</Alert>}
            {risk?.modelChange && (
              <Alert tone="warning">
                {t('confirm.modelChange', {
                  from: label(risk.modelChange.from),
                  to: label(risk.modelChange.to),
                  threshold: (
                    models.find((m) => m.id === risk.modelChange?.to)?.recommendedThreshold ??
                    faqRecommendedThreshold(risk.modelChange.to)
                  ).toFixed(2),
                })}
              </Alert>
            )}
          </div>
        }
        confirmLabel={t('confirm.confirm')}
        cancelLabel={tc('cancel')}
        tone={risk?.engineOff ? 'danger' : 'default'}
        busy={save.isPending}
        onConfirm={() => review && send(review)}
        onClose={() => setReview(null)}
      />
    </Card>
  );
}
