'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { PlanBillingUnit } from '@crm/contracts';
import { Field, Input, Select, Textarea } from '@crm/ui';
import { Combobox } from '../../shared/combobox';
import { currencyOptions } from '../../shared/currencies';
import {
  CTA_MAX,
  DETAIL_MAX,
  DURATION,
  NAME_MAX,
  SUBTITLE_MAX,
  type withToggle,
} from '../lib/plan-draft';
import { NS, Section, ToggleRow, fieldId, type EditorState } from './plan-editor-shared';

const UNITS: readonly PlanBillingUnit[] = ['days', 'weeks', 'months', 'years'];

/** The first tab: how the plan is named and shown, and what it costs (WD-PLAN-002's identity and pricing steps). */
export function PlanDetailsTab({
  state,
  toggle,
}: {
  state: EditorState;
  toggle: (key: Parameters<typeof withToggle>[1], on: boolean) => void;
}) {
  const t = useTranslations(NS);
  const locale = useLocale();
  const currencies = useMemo(() => currencyOptions(locale), [locale]);
  const { draft, problems, err, set } = state;
  const priceLocked = draft.isFree || draft.isCustomQuote;

  return (
    <div className="space-y-5">
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
        <Field
          label={t('fields.dataRetentionDays.label')}
          htmlFor={fieldId('dataRetentionDays')}
          hint={t('fields.dataRetentionDays.hint')}
          error={err('dataRetentionDays')}
        >
          <Input
            id={fieldId('dataRetentionDays')}
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.dataRetentionDays}
            onChange={(e) => set('dataRetentionDays', e.target.value)}
            invalid={Boolean(problems.dataRetentionDays)}
            className="font-mono"
          />
        </Field>
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

      <Section title={t('sections.pricing.title')} description={t('sections.pricing.description')}>
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
    </div>
  );
}
