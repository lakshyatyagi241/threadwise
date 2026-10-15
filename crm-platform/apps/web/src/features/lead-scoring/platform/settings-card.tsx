'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, ConfirmDialog, Field, Input, Select, Switch } from '@crm/ui';
import type { LscPlatformConfig, UpdateLscPlatformConfigInput } from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import {
  LIMIT_RANGES,
  OTHER_MODEL,
  diffConfig,
  draftFromConfig,
  errorKind,
  fieldErrorsFromApi,
  pricePerMillionDigits,
  riskOf,
  type ConfigDraft,
  type FieldErrors,
  type FieldKey,
  type FieldProblem,
} from './logic';
import { OVERVIEW_KEY, overviewSchema } from './queries';

const NS = 'lead-scoring-admin.settings';

/** The platform switch, the model and the limits. Only fields that differ from the saved config are sent. */
export function SettingsCard({ config }: { config: LscPlatformConfig }) {
  const t = useTranslations(NS);
  const tc = useTranslations('lead-scoring-admin.common');
  const format = useFormatter();
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState<ConfigDraft>(() => draftFromConfig(config));
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [review, setReview] = useState<UpdateLscPlatformConfigInput | null>(null);

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
    const frame = requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body || (a instanceof HTMLButtonElement && a.disabled)) {
        heading.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [dirty]);
  const problems: FieldErrors = { ...(showErrors && !diff.ok ? diff.errors : {}), ...serverErrors };

  // `isPending` only turns true after the next render, so a fast double click would send twice; the ref closes that window.
  const sending = useRef(false);

  const save = useMutation({
    mutationFn: (body: UpdateLscPlatformConfigInput) =>
      operatorFetch('/lead-scoring', { method: 'PATCH', body, schema: overviewSchema }),
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

  const send = (body: UpdateLscPlatformConfigInput) => {
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
    if (risk.turningOn || risk.turningOff) setReview(diff.body);
    else send(diff.body);
  };

  const message = (p: FieldProblem | undefined) => {
    if (!p) return undefined;
    if (p.kind === 'range') {
      return t('errors.range', { min: format.number(p.min), max: format.number(p.max) });
    }
    return t(`errors.${p.kind}`);
  };

  const price = (v: number) => {
    const d = pricePerMillionDigits(v);
    return format.number(v, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: d.min,
      maximumFractionDigits: d.max,
    });
  };
  const picked = config.models.find((m) => m.id === draft.modelPick);
  const risk = review ? riskOf(config, review) : null;

  const limitField = (key: keyof typeof LIMIT_RANGES, hint: string) => (
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
            <label htmlFor={`${id}-enabled`} className="block text-sm font-medium">
              {t('enabled.label')}
            </label>
            <p className="text-xs text-muted-foreground">{t('enabled.hint')}</p>
          </div>
          <Switch
            id={`${id}-enabled`}
            label={t('enabled.label')}
            checked={draft.platformEnabled}
            onCheckedChange={(v) => set({ platformEnabled: v }, 'platformEnabled')}
          />
        </div>

        <Field
          label={t('model.label')}
          htmlFor={`${id}-model`}
          hint={t('model.hint')}
          error={draft.modelPick === OTHER_MODEL ? undefined : message(problems.model)}
        >
          <Select
            id={`${id}-model`}
            value={draft.modelPick}
            onChange={(e) => set({ modelPick: e.target.value }, 'model')}
          >
            {config.models.map((m) => (
              <option key={m.id} value={m.id}>
                {t('model.option', {
                  label: m.label,
                  input: price(m.inputPerMillion),
                  output: price(m.outputPerMillion),
                })}
              </option>
            ))}
            <option value={OTHER_MODEL}>{t('model.other')}</option>
          </Select>
        </Field>
        {picked && (
          <div className="-mt-2 rounded-md bg-muted px-3 py-2 text-sm">
            <p className="text-xs text-foreground">
              {t('model.details', {
                input: price(picked.inputPerMillion),
                output: price(picked.outputPerMillion),
              })}
            </p>
            <p className="mt-1">{picked.note}</p>
          </div>
        )}
        {draft.modelPick === OTHER_MODEL && (
          <Field
            label={t('model.customLabel')}
            htmlFor={`${id}-custom`}
            hint={t('model.customHint')}
            error={message(problems.model)}
          >
            <Input
              id={`${id}-custom`}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              maxLength={120}
              placeholder={t('model.placeholder')}
              value={draft.customModel}
              invalid={Boolean(problems.model)}
              onChange={(e) => set({ customModel: e.target.value }, 'model')}
            />
          </Field>
        )}

        <fieldset className="space-y-3 border-t pt-4">
          <legend className="pe-2 text-sm font-semibold">{t('limits.title')}</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {limitField('scoresPerHour', t('limits.scoresPerHourHint'))}
            {limitField('retentionDays', t('limits.retentionDaysHint'))}
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
            {risk?.turningOn && <Alert tone="warning">{t('confirm.turnOn')}</Alert>}
            {risk?.turningOff && <Alert tone="warning">{t('confirm.turnOff')}</Alert>}
          </div>
        }
        confirmLabel={t('confirm.confirm')}
        cancelLabel={tc('cancel')}
        tone={risk?.turningOff ? 'danger' : 'default'}
        busy={save.isPending}
        onConfirm={() => review && send(review)}
        onClose={() => setReview(null)}
      />
    </Card>
  );
}
