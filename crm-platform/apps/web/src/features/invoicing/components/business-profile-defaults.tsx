'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Alert, Button, Field, Input, Select, Switch, Textarea, useToast } from '@crm/ui';
import { invalidateInvoicing } from '../api/hooks';
import { LIMITS, REGIME_OPTIONS, profileOf } from '../lib/profile-form';
import { Section, type EditorCtx } from './business-profile-ui';
import { PercentIcon } from './icons';
import { useInvoicingCan } from './parts';
import { TaxPresetsDialog } from './tax-presets-dialog';

/** Defaults: payment terms, terms and conditions, reminders and the tax regime new invoices start under. Currency is read-only. */
export function DefaultsSection({ form, set, err, readOnly, profile }: EditorCtx) {
  const t = useTranslations('invoicing.settings.defaults');
  const uid = useId();
  const can = useInvoicingCan();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState(false);

  const regime = form.defaultTaxRegime;
  const regimeProfile = regime === 'none' ? undefined : profileOf(regime);
  const presetCountry = regimeProfile?.code ?? (form.sellerCountry.trim() || null);
  const notesProfile = regimeProfile ?? profileOf(form.sellerCountry);
  const asOf = notesProfile?.sources
    .map((s) => s.asOf)
    .sort()
    .at(-1);

  return (
    <Section id="defaults" title={t('title')} description={t('description')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('currency')} htmlFor={`${uid}-cur`} hint={t('currencyHint')}>
          <Input id={`${uid}-cur`} value={profile.currency} readOnly disabled dir="ltr" />
        </Field>
        <Field
          label={t('dueDays')}
          htmlFor={`${uid}-due`}
          hint={form.dueDays.trim() === '' ? t('dueOnIssue') : t('dueDaysHint')}
          error={err('dueDays')}
        >
          <Input
            id={`${uid}-due`}
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            value={form.dueDays}
            disabled={readOnly}
            invalid={!!err('dueDays')}
            placeholder={t('dueDaysPlaceholder')}
            dir="ltr"
            onChange={(e) => set('dueDays', e.target.value)}
          />
        </Field>
      </div>

      <Field label={t('terms')} htmlFor={`${uid}-terms`} hint={t('termsHint')} error={err('terms')}>
        <Textarea
          id={`${uid}-terms`}
          rows={5}
          value={form.terms}
          disabled={readOnly}
          invalid={!!err('terms')}
          dir="auto"
          onChange={(e) => set('terms', e.target.value)}
        />
        <p className="text-end text-xs tabular-nums text-muted-foreground" dir="ltr">
          {form.terms.length}/{LIMITS.terms}
        </p>
      </Field>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('reminders')}</p>
          <p className="text-xs text-muted-foreground">{t('remindersHint')}</p>
        </div>
        <Switch
          checked={form.overdueReminders}
          disabled={readOnly}
          label={t('reminders')}
          onCheckedChange={(v) => set('overdueReminders', v)}
        />
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field
            label={t('regime')}
            htmlFor={`${uid}-regime`}
            hint={t('regimeHint')}
            error={err('defaultTaxRegime')}
          >
            <Select
              id={`${uid}-regime`}
              value={regime}
              disabled={readOnly}
              invalid={!!err('defaultTaxRegime')}
              onChange={(e) => set('defaultTaxRegime', e.target.value)}
            >
              {!REGIME_OPTIONS.some((o) => o.id === regime) && (
                <option value={regime}>{regime}</option>
              )}
              {REGIME_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.id === 'none' ? t('regimeNone') : `${o.name} (${o.id})`}
                </option>
              ))}
            </Select>
          </Field>
          {can.createTaxRate && (
            <Button
              type="button"
              variant="secondary"
              className="h-10 w-full sm:w-auto"
              disabled={!presetCountry}
              onClick={() => setDialog(true)}
            >
              <PercentIcon /> {t('loadRates')}
            </Button>
          )}
        </div>
        {can.createTaxRate && !presetCountry && (
          <p className="text-xs text-muted-foreground">{t('loadRatesNeedsCountry')}</p>
        )}

        {notesProfile && (
          <details className="rounded-lg border border-border bg-muted p-3 text-sm">
            <summary className="cursor-pointer font-medium focus-visible:ring-2 focus-visible:ring-primary">
              {t('notesTitle', { country: notesProfile.name })}
            </summary>
            <ul className="mt-2 list-disc space-y-1.5 ps-5 text-xs leading-relaxed" dir="auto">
              {notesProfile.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">{t('notesLanguage')}</p>
          </details>
        )}
        <Alert tone="info" className="text-xs">
          {t('disclaimer')}
          {asOf && (
            <span className="mt-1 block text-muted-foreground">{t('checked', { date: asOf })}</span>
          )}
        </Alert>
      </div>

      {dialog && (
        <TaxPresetsDialog
          country={presetCountry}
          onClose={() => setDialog(false)}
          onApplied={(r) => {
            setDialog(false);
            void invalidateInvoicing(qc);
            toast(t('ratesApplied', { created: r.created.length, skipped: r.skipped.length }));
          }}
        />
      )}
    </Section>
  );
}
