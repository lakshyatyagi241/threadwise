'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { InvoiceProfile, RecurringInvoiceResponse, TaxRateResponse } from '@crm/contracts';
import { Alert, Button, Field, Input, Select, Spinner, cn, useToast } from '@crm/ui';
import { invalidateInvoicing, useInvoice, useInvoiceSettings, useRecurring, useTaxRates } from '../api/hooks';
import { invoicingApi } from '../api/service';
import { errorCode, errorKind, fieldErrors } from '../lib/errors';
import {
  CATCH_UP_MAX,
  FREQUENCIES,
  MODES,
  SEND_CHANNELS,
  buildCreateInput,
  buildUpdateInput,
  emptyRecurringForm,
  formFromRecurring,
  hasRecurringProblems,
  isEmptyPatch,
  missedPeriods,
  previewStartIndex,
  pricingOfTemplate,
  serverErrorsOn,
  shapeOf,
  suggestName,
  validateRecurring,
  warningsOf,
  type RecurringForm,
} from '../lib/recurring';
import { hsnRequired } from '../lib/tax-info';
import { BackIcon } from './icons';
import { amountMinorOf } from './recurring-parts';
import { ErrorLine, useDefaultCurrency, useErrorText, useToday } from './parts';
import { RecurringPreview } from './recurring-preview';
import { RecurringTemplateSection, TemplateKept, pickedOf } from './recurring-template';

const card = 'space-y-4 rounded-xl border border-border bg-background p-4 sm:p-5';

/**
 * `/recurring-invoices/new` (and the edit mode of `/recurring-invoices/[id]`): the schedule, the template every period is made
 * from, and a live preview of the next runs. `?fromInvoice=<id>` starts from a copy of that invoice. Waits for the tax rates and the
 * invoicing settings, then works on its own copy.
 */
export function RecurringInvoiceBuilder({ recurringId }: { recurringId?: string }) {
  const t = useTranslations('invoicing.recurring.builder');
  const search = useSearchParams();
  const fromInvoiceId = recurringId ? null : search.get('fromInvoice');
  const rates = useTaxRates({ active: true });
  const settings = useInvoiceSettings();
  const existing = useRecurring(recurringId ?? null);
  const source = useInvoice(fromInvoiceId);

  const failed = rates.error ?? settings.error ?? existing.error;
  if (failed) {
    return (
      <div className="space-y-3">
        <ErrorLine error={failed} onRetry={() => void Promise.all([rates.refetch(), settings.refetch(), existing.refetch()])} />
      </div>
    );
  }
  if (!rates.data || !settings.data || (recurringId && !existing.data) || (fromInvoiceId && source.isPending)) {
    return (
      <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (existing.data?.status === 'ended') {
    return (
      <Alert tone="warning" className="space-y-2">
        <p>{t('endedNoEdit')}</p>
        <Link href={`/recurring-invoices/${existing.data.id}`} className="font-medium underline underline-offset-2">
          {t('openSchedule')}
        </Link>
      </Alert>
    );
  }
  return (
    <BuilderForm
      key={existing.data ? `${existing.data.id}:${existing.data.rowVersion}` : 'new'}
      existing={existing.data}
      rates={rates.data}
      settings={settings.data}
      copy={source.data ? pickedOf(source.data) : null}
      copyError={fromInvoiceId && source.isError ? source.error : null}
      onReload={() => void existing.refetch()}
    />
  );
}

function BuilderForm({
  existing,
  rates,
  settings,
  copy,
  copyError,
  onReload,
}: {
  existing: RecurringInvoiceResponse | undefined;
  rates: TaxRateResponse[];
  settings: InvoiceProfile;
  copy: ReturnType<typeof pickedOf> | null;
  copyError: unknown;
  onReload: () => void;
}) {
  const t = useTranslations('invoicing.recurring.builder');
  const tp = useTranslations('invoicing.recurring.problems');
  const tm = useTranslations('invoicing.recurring.modeCards');
  const tc = useTranslations('invoicing.recurring.channel');
  const tf = useTranslations('invoicing.recurring.frequency');
  const tw = useTranslations('invoicing.recurring.warnings');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const today = useToday();
  const workspaceCurrency = useDefaultCurrency();
  const editing = !!existing;
  const back = existing ? `/recurring-invoices/${existing.id}` : '/recurring-invoices';

  const [form, setForm] = useState<RecurringForm>(() => {
    const base = emptyRecurringForm(settings, today, workspaceCurrency);
    if (existing) return formFromRecurring(existing, base);
    if (copy) return { ...base, source: 'invoice', fromInvoice: copy, name: suggestName(copy) };
    return base;
  });
  const [replaceTemplate, setReplaceTemplate] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);

  const ctx = useMemo(
    () => ({ rates, profile: settings, today, requireHsn: hsnRequired(settings.sellerCountry) }),
    [rates, settings, today],
  );
  const pricing = useMemo(() => pricingOfTemplate(form, ctx), [form, ctx]);
  const shape = useMemo(() => shapeOf(form), [form]);
  const templateChanged = !editing || replaceTemplate;
  const problems = useMemo(
    () => validateRecurring(form, { kind: editing ? 'edit' : 'create', templateChanged, ctx, pricing }),
    [form, editing, templateChanged, ctx, pricing],
  );

  const problemText = (code: string): string => {
    if (code === 'startTooOld') return tp('startTooOld', { count: shape ? missedPeriods(shape, today) : 0, max: CATCH_UP_MAX });
    return tp.has(code) ? tp(code) : tp('generic');
  };
  const errors: Record<string, string> = {
    ...(showProblems ? Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, problemText(v)])) : {}),
    ...serverErrors,
  };

  const patch = (p: Partial<RecurringForm>) => {
    setForm((f) => ({ ...f, ...p }));
    setServerErrors({});
  };

  const totals = pricing.result.totals;
  const amount =
    editing && !replaceTemplate
      ? { minor: amountMinorOf(existing), currency: existing.currency }
      : form.source === 'invoice' && form.fromInvoice
        ? { minor: form.fromInvoice.totalMinor, currency: form.fromInvoice.currency }
        : pricing.result.ok
          ? { minor: totals.totalMinor, currency: form.draft.currency }
          : null;

  async function save() {
    setShowProblems(true);
    setFailure(null);
    setServerErrors({});
    if (hasRecurringProblems(problems)) {
      toast(t('fixProblems'), 'danger');
      return;
    }
    setBusy(true);
    try {
      if (existing) {
        const body = buildUpdateInput(existing, form, ctx, replaceTemplate);
        if (isEmptyPatch(body)) {
          toast(t('nothingToSave'));
          router.replace(back);
          return;
        }
        await invoicingApi.updateRecurring(existing.id, existing.rowVersion, body);
        await invalidateInvoicing(qc);
        toast(t('saved'));
        router.replace(back);
      } else {
        const made = await invoicingApi.createRecurring(buildCreateInput(form, ctx));
        await invalidateInvoicing(qc);
        toast(t('created', { name: made.name }));
        router.push(`/recurring-invoices/${made.id}`);
      }
    } catch (e) {
      if (errorKind(e) === 'conflict') setConflict(true);
      const own = serverErrorsOn(fieldErrors(e), form.draft);
      if (errorCode(e) === 'REC_START_TOO_OLD') own.startDate = problemText('startTooOld');
      setServerErrors(own);
      setFailure(e);
      toast(errorText(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  const warnings = warningsOf(form);
  const previewProps = {
    shape,
    form,
    today,
    amount,
    fromIndex: existing ? previewStartIndex(existing, shape, today) : 0,
    catchUp: !editing,
  };

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={back}
            aria-label={t('back')}
            title={t('back')}
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            <BackIcon className="size-4 rtl:rotate-180" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">{editing ? t('editTitle', { name: existing.name }) : t('newTitle')}</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">{editing ? t('editSubtitle') : t('newSubtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={back} className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted">
            {t('cancel')}
          </Link>
          <Button type="submit" variant="brand" className="h-10 min-w-28" disabled={busy}>
            {busy && <Spinner />} {editing ? t('save') : t('create')}
          </Button>
        </div>
      </header>

      {conflict && (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('conflict')}</span>
          <Button variant="secondary" size="sm" onClick={onReload}>
            {t('reload')}
          </Button>
        </Alert>
      )}
      {failure !== null && !conflict && <ErrorLine error={failure} />}
      {copyError !== null && <ErrorLine error={copyError} />}

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          <section aria-labelledby="rec-schedule" className={card}>
            <h2 id="rec-schedule" className="text-base font-semibold">
              {t('schedule')}
            </h2>
            <Field label={t('name')} htmlFor="rec-name" error={errors.name} hint={t('nameHint')}>
              <Input id="rec-name" dir="auto" maxLength={130} value={form.name} invalid={!!errors.name} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('every')} htmlFor="rec-interval" error={errors.interval}>
                <Input
                  id="rec-interval"
                  inputMode="numeric"
                  dir="ltr"
                  value={form.interval}
                  invalid={!!errors.interval}
                  onChange={(e) => patch({ interval: e.target.value.replace(/[^\d]/g, '') })}
                />
              </Field>
              <Field label={t('frequency')} htmlFor="rec-frequency">
                <Select id="rec-frequency" value={form.frequency} onChange={(e) => patch({ frequency: e.target.value as RecurringForm['frequency'] })}>
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {tf(f)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('startDate')} htmlFor="rec-start" error={errors.startDate} hint={editing ? t('startFixed') : t('startHint')}>
                <Input id="rec-start" type="date" dir="ltr" disabled={editing} value={form.startDate} invalid={!!errors.startDate} onChange={(e) => patch({ startDate: e.target.value })} />
              </Field>
              <Field label={t('endDate')} htmlFor="rec-end" error={errors.endDate} hint={t('endHint')}>
                <Input id="rec-end" type="date" dir="ltr" value={form.endDate} invalid={!!errors.endDate} min={form.startDate || undefined} onChange={(e) => patch({ endDate: e.target.value })} />
              </Field>
              <Field label={t('maxRuns')} htmlFor="rec-max" error={errors.maxRuns} hint={t('maxRunsHint')}>
                <Input
                  id="rec-max"
                  inputMode="numeric"
                  dir="ltr"
                  value={form.maxRuns}
                  placeholder={t('noLimit')}
                  invalid={!!errors.maxRuns}
                  onChange={(e) => patch({ maxRuns: e.target.value.replace(/[^\d]/g, '') })}
                />
              </Field>
            </div>
            {editing && <p className="text-xs text-muted-foreground">{t('scheduleEditNote')}</p>}

            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{t('mode')}</legend>
              <div role="radiogroup" aria-label={t('mode')} className="grid gap-2 sm:grid-cols-3">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={form.mode === m}
                    onClick={() => patch({ mode: m })}
                    className={cn(
                      'min-h-16 rounded-lg border p-3 text-start outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
                      form.mode === m ? 'border-brand bg-brand/5' : 'border-border hover:bg-muted',
                    )}
                  >
                    <span className="block text-sm font-medium">{tm(`${m}.title`)}</span>
                    <span className="block text-xs text-muted-foreground">{tm(`${m}.hint`)}</span>
                  </button>
                ))}
              </div>
              {form.mode === 'issue_send' && (
                <Field label={t('sendChannel')} htmlFor="rec-channel" hint={t('sendChannelHint')}>
                  <Select id="rec-channel" value={form.sendChannel} onChange={(e) => patch({ sendChannel: e.target.value as RecurringForm['sendChannel'] })}>
                    {SEND_CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {tc(c)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {warnings.includes('noBuyerEmail') && <p className="text-xs text-warning">{tw('noBuyerEmail')}</p>}
            </fieldset>
          </section>

          <RecurringPreview {...previewProps} className="lg:hidden" />

          {editing && !replaceTemplate ? (
            <section aria-labelledby="rec-template-kept" className={card}>
              <h2 id="rec-template-kept" className="text-base font-semibold">
                {t('templateTitle')}
              </h2>
              <TemplateKept buyer={existing.buyerName} lineCount={existing.lineCount} amount={{ minor: amountMinorOf(existing), currency: existing.currency }} />
              <p className="text-xs text-muted-foreground">{t('templateFuture')}</p>
              <Button variant="secondary" className="min-h-10" onClick={() => setReplaceTemplate(true)}>
                {t('replaceTemplate')}
              </Button>
            </section>
          ) : (
            <>
              {editing && (
                <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-3">
                  <span>{t('templateFuture')}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setReplaceTemplate(false);
                      setServerErrors({});
                    }}
                  >
                    {t('keepTemplate')}
                  </Button>
                </Alert>
              )}
              <RecurringTemplateSection
                form={form}
                onForm={patch}
                errors={errors}
                rates={rates}
                showHsn={ctx.requireHsn}
                lineAmounts={totals.lines.map((l) => l.netMinor)}
                disabled={busy}
                editing={editing}
              />
            </>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pb-2">
            <Link href={back} className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted">
              {t('cancel')}
            </Link>
            <Button type="submit" variant="brand" className="h-10 min-w-28" disabled={busy}>
              {busy && <Spinner />} {editing ? t('save') : t('create')}
            </Button>
          </div>
        </div>

        <aside className="hidden lg:sticky lg:top-4 lg:block">
          <RecurringPreview {...previewProps} />
        </aside>
      </div>
    </form>
  );
}
