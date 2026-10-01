'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  PLAN_FEATURE_DEFS,
  PLAN_FEATURE_GROUPS,
  PLAN_LIMIT_DEFS,
  PLAN_LIMIT_GROUPS,
  planAdminItemSchema,
  type PlanAdminItem,
  type PlanBillingUnit,
} from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Select, Spinner, Switch, Textarea } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { Combobox } from '../../shared/combobox';
import { currencyOptions } from '../../shared/currencies';
import {
  CTA_MAX,
  DETAIL_MAX,
  DURATION,
  NAME_MAX,
  SUBTITLE_MAX,
  buildPlanRequest,
  isPlanDraftDirty,
  newPlanDraft,
  planFieldForPath,
  planToDraft,
  withToggle,
  type PlanDraft,
  type PlanField,
  type PlanProblem,
  type PlanProblems,
} from '../lib/plan-draft';
import { operatorFetch } from '../operator-fetch';

const NS = 'auth-registration-security.platform.plans.editor';
const UNITS: readonly PlanBillingUnit[] = ['days', 'weeks', 'months', 'years'];
const FORM_ID = 'plan-editor-form';
const fieldId = (f: PlanField) => `plan-${f.replace('.', '-')}`;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <header className="space-y-0.5">
        <h3 className="text-base font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
  error,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium">
          {label}
        </label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        label={label}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * Create or edit one plan in a single dialog (WD-PLAN-002's four steps as four
 * sections: identity, pricing, limits, features). The slug is derived by the
 * server on create and never changes. Validation is the same set of rules the
 * API applies (`checkPlanRules`), so most mistakes are caught before the
 * request; whatever the API still refuses is shown against its field.
 */
export function PlanEditor({
  plan,
  onClose,
  onSaved,
}: {
  /** The plan being edited; null creates a new one. */
  plan: PlanAdminItem | null;
  onClose: () => void;
  onSaved: (plan: PlanAdminItem, created: boolean) => void;
}) {
  const t = useTranslations(NS);
  const tp = useTranslations(`${NS}.problems`);
  const locale = useLocale();
  const initial = useMemo(() => (plan ? planToDraft(plan) : newPlanDraft()), [plan]);
  const [draft, setDraft] = useState<PlanDraft>(initial);
  const [problems, setProblems] = useState<PlanProblems>({});
  const [failure, setFailure] = useState<ApiError | Error | null>(null);
  const currencies = useMemo(() => currencyOptions(locale), [locale]);
  const dirty = isPlanDraftDirty(initial, draft);

  const save = useMutation({
    mutationFn: async (body: NonNullable<ReturnType<typeof buildPlanRequest>['body']>) =>
      plan
        ? operatorFetch(`/plans/${plan.id}`, {
            method: 'PATCH',
            body,
            schema: planAdminItemSchema,
          })
        : operatorFetch('/plans', { method: 'POST', body, schema: planAdminItemSchema }),
    onSuccess: (saved) => onSaved(saved, !plan),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        const fromServer: PlanProblems = {};
        for (const e of err.fieldErrors) {
          const field = planFieldForPath(e.path);
          if (field && !(field in fromServer))
            fromServer[field] = { code: 'server', message: e.message };
        }
        setProblems(fromServer);
        // Nothing the form can point at: say what the API said.
        if (Object.keys(fromServer).length === 0) setFailure(err);
        else focusFirst(fromServer);
        return;
      }
      setFailure(err instanceof Error ? err : new Error(String(err)));
    },
  });

  function focusFirst(p: PlanProblems) {
    const first = Object.keys(p)[0] as PlanField | undefined;
    if (first) requestAnimationFrame(() => document.getElementById(fieldId(first))?.focus());
  }

  function set<K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setProblems((p) => {
      if (!(key in p)) return p;
      const { [key as PlanField]: _drop, ...rest } = p;
      return rest;
    });
  }

  function toggle(key: Parameters<typeof withToggle>[1], on: boolean) {
    setDraft((d) => withToggle(d, key, on));
    setProblems({});
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    setFailure(null);
    const built = buildPlanRequest(draft);
    if (built.problems) {
      setProblems(built.problems);
      focusFirst(built.problems);
      return;
    }
    setProblems({});
    save.mutate(built.body);
  }

  function close() {
    if (save.isPending) return;
    if (dirty && !window.confirm(t('discard'))) return;
    onClose();
  }

  const message = (p: PlanProblem | undefined): string | undefined => {
    if (!p) return undefined;
    if (p.code === 'server') return p.message;
    return tp(p.code, { max: p.max ?? 0, min: p.min ?? 0 });
  };
  const err = (field: PlanField) => message(problems[field]);
  const priceLocked = draft.isFree || draft.isCustomQuote;

  return (
    <Modal
      open
      onClose={close}
      title={plan ? t('editTitle', { name: plan.name }) : t('createTitle')}
      className="w-[min(46rem,calc(100vw-1.5rem))]"
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-5">
        <div className="space-y-5">
          {plan && (
            <p className="text-xs text-muted-foreground">
              {t('slugLabel')}{' '}
              <span dir="ltr" className="font-mono text-foreground">
                {plan.slug}
              </span>
              . {t('slugNote')}
            </p>
          )}

          <Section
            title={t('sections.identity.title')}
            description={t('sections.identity.description')}
          >
            <Field label={t('fields.name.label')} htmlFor={fieldId('name')} error={err('name')}>
              <Input
                id={fieldId('name')}
                value={draft.name}
                maxLength={NAME_MAX + 20}
                onChange={(e) => set('name', e.target.value)}
                invalid={Boolean(problems.name)}
                autoComplete="off"
              />
            </Field>
            <Field
              label={t('fields.subtitle.label')}
              htmlFor={fieldId('subtitle')}
              hint={t('fields.subtitle.hint', { max: SUBTITLE_MAX })}
              error={err('subtitle')}
            >
              <Input
                id={fieldId('subtitle')}
                value={draft.subtitle}
                onChange={(e) => set('subtitle', e.target.value)}
                invalid={Boolean(problems.subtitle)}
              />
            </Field>
            <Field
              label={t('fields.detail.label')}
              htmlFor={fieldId('detail')}
              hint={t('fields.detail.hint', { max: DETAIL_MAX })}
              error={err('detail')}
            >
              <Textarea
                id={fieldId('detail')}
                rows={3}
                value={draft.detail}
                onChange={(e) => set('detail', e.target.value)}
                invalid={Boolean(problems.detail)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('fields.ctaLabel.label')}
                htmlFor={fieldId('ctaLabel')}
                hint={t('fields.ctaLabel.hint', { max: CTA_MAX })}
                error={err('ctaLabel')}
              >
                <Input
                  id={fieldId('ctaLabel')}
                  value={draft.ctaLabel}
                  onChange={(e) => set('ctaLabel', e.target.value)}
                  invalid={Boolean(problems.ctaLabel)}
                />
              </Field>
              <Field
                label={t('fields.sortOrder.label')}
                htmlFor={fieldId('sortOrder')}
                hint={t('fields.sortOrder.hint')}
                error={err('sortOrder')}
              >
                <Input
                  id={fieldId('sortOrder')}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={draft.sortOrder}
                  onChange={(e) => set('sortOrder', e.target.value)}
                  invalid={Boolean(problems.sortOrder)}
                  className="font-mono"
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleRow
                id="plan-isActive"
                label={t('flags.isActive.label')}
                hint={t('flags.isActive.hint')}
                checked={draft.isActive}
                onChange={(v) => toggle('isActive', v)}
              />
              <ToggleRow
                id={fieldId('isDefault')}
                label={t('flags.isDefault.label')}
                hint={t('flags.isDefault.hint')}
                checked={draft.isDefault}
                onChange={(v) => toggle('isDefault', v)}
                error={err('isDefault')}
              />
              <ToggleRow
                id="plan-isHighlighted"
                label={t('flags.isHighlighted.label')}
                hint={t('flags.isHighlighted.hint')}
                checked={draft.isHighlighted}
                onChange={(v) => toggle('isHighlighted', v)}
              />
            </div>
          </Section>

          <Section
            title={t('sections.pricing.title')}
            description={t('sections.pricing.description')}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleRow
                id={fieldId('isFree')}
                label={t('flags.isFree.label')}
                hint={t('flags.isFree.hint')}
                checked={draft.isFree}
                onChange={(v) => toggle('isFree', v)}
                error={err('isFree')}
              />
              <ToggleRow
                id="plan-isCustomQuote"
                label={t('flags.isCustomQuote.label')}
                hint={t('flags.isCustomQuote.hint')}
                checked={draft.isCustomQuote}
                onChange={(v) => toggle('isCustomQuote', v)}
              />
              <ToggleRow
                id="plan-isLifetime"
                label={t('flags.isLifetime.label')}
                hint={t('flags.isLifetime.hint')}
                checked={draft.isLifetime}
                onChange={(v) => toggle('isLifetime', v)}
                disabled={priceLocked}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label={t('fields.currency.label')}
                htmlFor={fieldId('currency')}
                error={err('currency')}
              >
                <Combobox
                  id={fieldId('currency')}
                  options={currencies}
                  value={draft.currency}
                  onChange={(v) => set('currency', v)}
                  emptyLabel={t('fields.currency.empty')}
                  placeholder={t('fields.currency.placeholder')}
                  disabled={priceLocked}
                  invalid={Boolean(problems.currency)}
                />
              </Field>
              <Field
                label={t('fields.amount.label')}
                htmlFor={fieldId('amount')}
                hint={priceLocked ? t('fields.amount.locked') : t('fields.amount.hint')}
                error={err('amount')}
              >
                <Input
                  id={fieldId('amount')}
                  dir="ltr"
                  inputMode="decimal"
                  value={priceLocked ? '' : draft.amount}
                  placeholder={priceLocked ? t('fields.amount.none') : '19.00'}
                  disabled={priceLocked}
                  onChange={(e) => set('amount', e.target.value)}
                  invalid={Boolean(problems.amount)}
                  className="font-mono"
                />
              </Field>
              <Field
                label={t('fields.offerAmount.label')}
                htmlFor={fieldId('offerAmount')}
                hint={t('fields.offerAmount.hint')}
                error={err('offerAmount')}
              >
                <Input
                  id={fieldId('offerAmount')}
                  dir="ltr"
                  inputMode="decimal"
                  value={priceLocked ? '' : draft.offerAmount}
                  disabled={priceLocked}
                  onChange={(e) => set('offerAmount', e.target.value)}
                  invalid={Boolean(problems.offerAmount)}
                  className="font-mono"
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('fields.billingDuration.label')}
                htmlFor={fieldId('billingDuration')}
                hint={t('fields.billingDuration.hint', DURATION)}
                error={err('billingDuration')}
              >
                <Input
                  id={fieldId('billingDuration')}
                  type="number"
                  inputMode="numeric"
                  min={DURATION.min}
                  max={DURATION.max}
                  value={draft.billingDuration}
                  onChange={(e) => set('billingDuration', e.target.value)}
                  invalid={Boolean(problems.billingDuration)}
                  className="font-mono"
                />
              </Field>
              <Field label={t('fields.billingUnit.label')} htmlFor="plan-billingUnit">
                <Select
                  id="plan-billingUnit"
                  value={draft.billingUnit}
                  onChange={(e) => set('billingUnit', e.target.value as PlanBillingUnit)}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {t(`units.${u}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Section>

          <Section
            title={t('sections.limits.title')}
            description={t('sections.limits.description')}
          >
            {PLAN_LIMIT_GROUPS.map((group) => (
              <div key={group} className="space-y-2">
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t(`limitGroups.${group}`)}
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PLAN_LIMIT_DEFS.filter((d) => d.group === group).map(({ key }) => (
                    <Field
                      key={key}
                      label={t(`limitKeys.${key}`)}
                      htmlFor={fieldId(`limits.${key}`)}
                      error={err(`limits.${key}`)}
                    >
                      <Input
                        id={fieldId(`limits.${key}`)}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={draft.limits[key]}
                        placeholder={t('unlimited')}
                        onChange={(e) => set('limits', { ...draft.limits, [key]: e.target.value })}
                        invalid={Boolean(problems[`limits.${key}`])}
                        className="font-mono"
                      />
                    </Field>
                  ))}
                </div>
              </div>
            ))}
          </Section>

          <Section
            title={t('sections.features.title')}
            description={t('sections.features.description')}
          >
            {PLAN_FEATURE_GROUPS.map((group) => (
              <div key={group} className="space-y-2">
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t(`featureGroups.${group}`)}
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PLAN_FEATURE_DEFS.filter((d) => d.group === group).map(({ key }) => (
                    <ToggleRow
                      key={key}
                      id={`plan-feature-${key}`}
                      label={t(`featureKeys.${key}`)}
                      checked={draft.features[key]}
                      onChange={(v) => set('features', { ...draft.features, [key]: v })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </Section>

          {failure && (
            <Alert tone="danger">
              {failure instanceof ApiError && failure.status < 500 ? failure.message : t('failed')}
            </Alert>
          )}
        </div>
        {/* Stays in view while the long form scrolls inside the dialog. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-border bg-background px-5 py-3">
          <Button type="button" variant="ghost" onClick={close} disabled={save.isPending}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner label={t('saving')} />}
            {save.isPending ? t('saving') : plan ? t('save') : t('create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
