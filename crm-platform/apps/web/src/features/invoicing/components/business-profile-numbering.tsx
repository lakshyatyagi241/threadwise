'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { Alert, Field, Input, Select, Switch } from '@crm/ui';
import {
  DOC_KINDS,
  LIMITS,
  NUMBER_TOKENS,
  countrySuggestion,
  numberExamples,
  numberingWarnings,
  profileOf,
  type DocKind,
  type ProfileForm,
} from '../lib/profile-form';
import { useToday } from './parts';
import { Section, SubHeading, type EditorCtx } from './business-profile-ui';

const PREFIX_FIELD: Record<DocKind, 'numberingPrefix' | 'proformaPrefix' | 'receiptPrefix' | 'creditNotePrefix' | 'salesOrderPrefix'> = {
  invoice: 'numberingPrefix',
  proforma: 'proformaPrefix',
  receipt: 'receiptPrefix',
  creditNote: 'creditNotePrefix',
  salesOrder: 'salesOrderPrefix',
};

/** The name of month `m` (1 to 12) in the viewer's language. */
function useMonthNames(): string[] {
  const locale = useLocale();
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
    return Array.from({ length: 12 }, (_, i) => f.format(new Date(Date.UTC(2026, i, 1))));
  }, [locale]);
}

/** Numbering: one series per document type, its format, padding, yearly restart and fiscal year, with a live example of each. */
export function NumberingSection({ form, set, err, readOnly }: EditorCtx) {
  const t = useTranslations('invoicing.settings.numbering');
  const uid = useId();
  const today = useToday();
  const months = useMonthNames();
  const examples = useMemo(() => numberExamples(form, today), [form, today]);
  const warnings = useMemo(() => numberingWarnings(form.sellerCountry, examples), [form.sellerCountry, examples]);
  const profile = profileOf(form.sellerCountry);
  const suggestion = countrySuggestion(form.sellerCountry);
  const rules = profile?.numbering;
  const fyIssue = err('fiscalYearStartMonth');
  const monthNo = Number(form.fiscalYearStartMonth);
  const suggestMonth = suggestion && suggestion.fiscalYearStartMonth !== monthNo ? suggestion.fiscalYearStartMonth : null;

  const addToken = (token: string) => set('numberFormat', `${form.numberFormat}${token}`);
  const formatErr = err('numberFormat');

  return (
    <Section id="numbering" title={t('title')} description={t('description')}>
      <div className="space-y-3">
        <SubHeading hint={t('prefixesHint')}>{t('prefixes')}</SubHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {DOC_KINDS.map((k) => {
            const field = PREFIX_FIELD[k];
            return (
              <Field key={k} label={t(`docs.${k}`)} htmlFor={`${uid}-${field}`} error={err(field)}>
                <Input
                  id={`${uid}-${field}`}
                  value={form[field]}
                  maxLength={10}
                  disabled={readOnly}
                  invalid={!!err(field)}
                  dir="ltr"
                  className="uppercase"
                  autoComplete="off"
                  onChange={(e) => set(field, e.target.value.toUpperCase())}
                />
              </Field>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label={t('format')} htmlFor={`${uid}-format`} hint={t('formatHint')} error={formatErr} className="sm:col-span-2 lg:col-span-1">
          <Input
            id={`${uid}-format`}
            value={form.numberFormat}
            maxLength={LIMITS.numberFormat + 20}
            disabled={readOnly}
            invalid={!!formatErr}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => set('numberFormat', e.target.value)}
          />
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1" role="group" aria-label={t('tokens')}>
              <span className="text-xs text-muted-foreground">{t('tokens')}</span>
              {NUMBER_TOKENS.map((tok) => (
                <button
                  key={tok}
                  type="button"
                  onClick={() => addToken(tok)}
                  className="h-8 rounded-md border border-border bg-muted px-2 font-mono text-xs hover:bg-background focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {tok}
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label={t('padding')} htmlFor={`${uid}-pad`} hint={t('paddingHint')} error={err('numberPadding')}>
          <Input id={`${uid}-pad`} type="number" inputMode="numeric" min={1} max={10} value={form.numberPadding} disabled={readOnly} invalid={!!err('numberPadding')} dir="ltr" onChange={(e) => set('numberPadding', e.target.value)} />
        </Field>
        <Field label={t('fiscalMonth')} htmlFor={`${uid}-fy`} hint={t('fiscalMonthHint')} error={fyIssue}>
          <Select id={`${uid}-fy`} value={form.fiscalYearStartMonth} disabled={readOnly} invalid={!!fyIssue} onChange={(e) => set('fiscalYearStartMonth', e.target.value)}>
            {months.map((name, i) => (
              <option key={name} value={String(i + 1)}>
                {name}
              </option>
            ))}
          </Select>
          {suggestMonth !== null && !readOnly && suggestion && (
            <button
              type="button"
              onClick={() => set('fiscalYearStartMonth', String(suggestMonth))}
              className="mt-1 inline-flex min-h-8 items-center rounded-md px-1 text-start text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('suggestMonth', { month: months[suggestMonth - 1] ?? '', country: suggestion.countryName })}
            </button>
          )}
        </Field>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
        <div className="min-w-0">
          <p id={`${uid}-yearly-label`} className="text-sm font-medium">
            {t('yearly')}
          </p>
          <p className="text-xs text-muted-foreground">{t('yearlyHint')}</p>
          {err('yearlyReset') && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {err('yearlyReset')}
            </p>
          )}
        </div>
        <Switch id={`${uid}-yearly`} checked={form.yearlyReset} disabled={readOnly} label={t('yearly')} onCheckedChange={(v) => set('yearlyReset', v)} />
      </div>

      <ExamplesList examples={examples} country={form.sellerCountry} />

      {warnings.length > 0 && profile && (
        <Alert tone="warning" className="space-y-1">
          <p className="font-medium">{t('limitsTitle', { country: profile.name })}</p>
          <ul className="list-disc space-y-0.5 ps-5 text-xs">
            {warnings.map((w) => (
              <li key={`${w.kind}-${w.code}`}>
                {w.code === 'tooLong'
                  ? t('warnTooLong', { doc: t(`docs.${w.kind}`), max: w.max ?? 0, length: w.length })
                  : t('warnChars', { doc: t(`docs.${w.kind}`) })}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {rules && (
        <p className="text-xs text-muted-foreground">
          {t('countryRule', { country: profile?.name ?? '' })} <span dir="auto">{rules.rule}</span>
        </p>
      )}
    </Section>
  );
}

function ExamplesList({ examples, country }: { examples: ReturnType<typeof numberExamples>; country: ProfileForm['sellerCountry'] }) {
  const t = useTranslations('invoicing.settings.numbering');
  const limit = profileOf(country)?.numbering.maxLength;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
      <SubHeading hint={t('examplesHint')}>{t('examples')}</SubHeading>
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {examples.map((e) => (
          <li key={e.kind} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{t(`docs.${e.kind}`)}</span>
            <span className="min-w-0 break-all text-end">
              <span dir="ltr" className="font-mono font-semibold">
                {e.number}
              </span>{' '}
              <span className={limit !== undefined && e.length > limit ? 'text-xs text-warning' : 'text-xs text-muted-foreground'}>{t('chars', { count: e.length })}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
