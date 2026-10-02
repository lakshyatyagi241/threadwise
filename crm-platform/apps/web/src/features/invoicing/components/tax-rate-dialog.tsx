'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { TAX_PROFILES } from '@crm/tax';
import type { TaxRateResponse, TaxType } from '@crm/contracts';
import {
  Alert,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Switch,
  Textarea,
  cn,
  useToast,
} from '@crm/ui';
import { invalidateInvoicing } from '../api/hooks';
import { invoicingApi } from '../api/service';
import { errorCode, errorKind, fieldErrors } from '../lib/errors';
import {
  componentsTotal,
  emptyTaxRateForm,
  formFromRate,
  isPercent,
  MAX_COMPONENTS,
  percentUnits,
  splitEvenly,
  TAX_TYPE_ORDER,
  toCreateInput,
  toUpdatePatch,
  unitsToPercent,
  validateTaxRateForm,
  type TaxRateField,
  type TaxRateFormState,
} from '../lib/tax-rate-form';
import { useErrorText } from './parts';
import { CloseIcon, PlusIcon } from './icons';

type Errors = Partial<Record<TaxRateField | 'form', string>>;

/**
 * Create or edit a tax rate. Mount only while open (and key it by the rate's id and row version, so a reload resets it).
 * Server answers map onto fields: `TAX_RATE_NAME_TAKEN` -> the name, `TAX_RATE_INVALID` -> the components, a row-version
 * conflict -> a prompt to load the latest version.
 */
export function TaxRateDialog({
  rate,
  hasRates,
  onClose,
  onReload,
}: {
  rate?: TaxRateResponse;
  /** False for the very first rate of the workspace: it starts as the default. */
  hasRates: boolean;
  onClose: () => void;
  /** Fetches the latest list and returns this rate as it is now (a conflict prompt offers it). */
  onReload: (id: string) => Promise<TaxRateResponse | undefined>;
}) {
  const t = useTranslations('invoicing.taxRates.form');
  const tt = useTranslations('invoicing.taxRates.types');
  const tp = useTranslations('invoicing.taxRates.form.problems');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const [form, setForm] = useState<TaxRateFormState>(() =>
    rate ? formFromRate(rate) : emptyTaxRateForm({ isDefault: !hasRates }),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<TaxRateFormState>) => setForm((f) => ({ ...f, ...patch }));
  const wasDefault = rate?.isDefault ?? false;
  const editing = rate !== undefined;

  const total = form.compound ? componentsTotal(form.components) : null;
  const rateOk = isPercent(form.rate);
  const sumMatches = total !== null && rateOk && total === unitsToPercent(percentUnits(form.rate));

  async function submit() {
    const problems = validateTaxRateForm(form);
    if (Object.keys(problems).length > 0) {
      setErrors(Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, tp(v as string)])));
      return;
    }
    setErrors({});
    setConflict(false);
    setBusy(true);
    try {
      let saved: TaxRateResponse;
      if (rate) {
        saved = await invoicingApi.updateTaxRate(rate.id, rate.rowVersion, toUpdatePatch(form));
        if (form.isDefault && !wasDefault) saved = await invoicingApi.setDefaultTaxRate(rate.id);
      } else {
        saved = await invoicingApi.createTaxRate(toCreateInput(form));
      }
      await invalidateInvoicing(qc);
      toast(rate ? t('saved', { name: saved.name }) : t('created', { name: saved.name }));
      onClose();
    } catch (e) {
      const code = errorCode(e);
      const server = fieldErrors(e);
      if (code === 'TAX_RATE_NAME_TAKEN') setErrors({ name: tp('nameTaken') });
      else if (code === 'TAX_RATE_INVALID') setErrors({ components: tp('componentsSum') });
      else if (errorKind(e) === 'conflict') setConflict(true);
      else if (Object.keys(server).length > 0) {
        const mapped: Errors = {};
        if (server.name) mapped.name = tp('nameRequired');
        if (server.rate) mapped.rate = tp('rateInvalid');
        if (server.components) mapped.components = tp('componentsSum');
        if (server.defaultHsnSac) mapped.defaultHsnSac = tp('hsnInvalid');
        if (server.country) mapped.country = tp('countryInvalid');
        if (server.effectiveFrom) mapped.effectiveFrom = tp('dateInvalid');
        if (server.effectiveTo) mapped.effectiveTo = tp('dateInvalid');
        if (Object.keys(mapped).length === 0) mapped.form = errorText(e);
        setErrors(mapped);
      } else setErrors({ form: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  const compoundField = (i: number, patch: Partial<{ type: string; rate: string }>) =>
    set({ components: form.components.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <Modal
      open
      size="lg"
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={t('eyebrow')}
      title={editing ? t('editTitle') : t('newTitle')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="brand" onClick={() => void submit()} disabled={busy}>
            {busy && <Spinner />}
            {t('save')}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {errors.form && (
          <Alert tone="danger" className="sm:col-span-2">
            {errors.form}
          </Alert>
        )}
        {conflict && (
          <Alert tone="warning" className="sm:col-span-2">
            <span>{t('problems.conflict')}</span>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 block"
              onClick={() => {
                if (rate) void onReload(rate.id);
              }}
            >
              {t('reload')}
            </Button>
          </Alert>
        )}

        <Field label={t('name')} htmlFor="tax-name" error={errors.name} className="sm:col-span-2">
          <Input
            id="tax-name"
            autoFocus
            dir="auto"
            value={form.name}
            maxLength={60}
            invalid={!!errors.name}
            placeholder={t('namePlaceholder')}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>

        <Field label={t('type')} htmlFor="tax-type">
          <Select
            id="tax-type"
            value={form.type}
            onChange={(e) => set({ type: e.target.value as TaxType })}
          >
            {TAX_TYPE_ORDER.map((x) => (
              <option key={x} value={x}>
                {tt(x)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('rate')} htmlFor="tax-rate" error={errors.rate} hint={t('rateHint')}>
          <div className="relative">
            <Input
              id="tax-rate"
              inputMode="decimal"
              dir="ltr"
              value={form.rate}
              invalid={!!errors.rate}
              className="pe-8"
              onChange={(e) => set({ rate: e.target.value })}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              %
            </span>
          </div>
        </Field>

        <Field
          label={t('applies')}
          htmlFor="tax-applies"
          hint={t(form.inclusive ? 'appliesHint.inclusive' : 'appliesHint.exclusive')}
          className="sm:col-span-2"
        >
          <Select
            id="tax-applies"
            value={form.inclusive ? 'inclusive' : 'exclusive'}
            onChange={(e) => set({ inclusive: e.target.value === 'inclusive' })}
          >
            <option value="exclusive">{t('exclusive')}</option>
            <option value="inclusive">{t('inclusive')}</option>
          </Select>
        </Field>

        <div className="space-y-3 rounded-md border border-border p-3 sm:col-span-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block font-medium">{t('compound')}</span>
              <span className="block text-xs text-muted-foreground">{t('compoundHint')}</span>
            </span>
            <Switch
              checked={form.compound}
              onCheckedChange={(v) =>
                set({
                  compound: v,
                  components:
                    v && form.components.length === 0
                      ? splitEvenly(form.rate, ['CGST', 'SGST'])
                      : form.components,
                })
              }
              label={t('compound')}
            />
          </label>
          {form.compound && (
            <div className="space-y-2">
              {form.components.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label={t('componentType', { n: i + 1 })}
                    dir="ltr"
                    value={c.type}
                    maxLength={12}
                    placeholder="CGST"
                    className="w-28 uppercase"
                    onChange={(e) => compoundField(i, { type: e.target.value })}
                  />
                  <div className="relative min-w-0 flex-1">
                    <Input
                      aria-label={t('componentRate', { n: i + 1 })}
                      inputMode="decimal"
                      dir="ltr"
                      value={c.rate}
                      className="pe-8"
                      onChange={(e) => compoundField(i, { rate: e.target.value })}
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      %
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    className="size-10 shrink-0 px-0"
                    aria-label={t('removeComponent', { n: i + 1 })}
                    onClick={() => set({ components: form.components.filter((_, j) => j !== i) })}
                  >
                    <CloseIcon />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={form.components.length >= MAX_COMPONENTS}
                  onClick={() => set({ components: [...form.components, { type: '', rate: '' }] })}
                >
                  <PlusIcon /> {t('addComponent')}
                </Button>
                {form.components.length >= 2 && rateOk && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      set({
                        components: splitEvenly(
                          form.rate,
                          form.components.map((c) => c.type),
                        ),
                      })
                    }
                  >
                    {t('splitEvenly')}
                  </Button>
                )}
                <span
                  aria-live="polite"
                  className={cn(
                    'ms-auto text-xs tabular-nums',
                    sumMatches ? 'text-success' : 'text-danger',
                  )}
                  dir="ltr"
                >
                  {total === null
                    ? t('sumUnknown')
                    : t('sum', {
                        sum: total,
                        rate: rateOk ? unitsToPercent(percentUnits(form.rate)) : '?',
                      })}
                </span>
              </div>
              {errors.components && (
                <p role="alert" className="text-xs text-danger">
                  {errors.components}
                </p>
              )}
            </div>
          )}
        </div>

        <Field
          label={t('country')}
          htmlFor="tax-country"
          error={errors.country}
          hint={t('countryHint')}
        >
          <Select
            id="tax-country"
            value={form.country.toUpperCase()}
            onChange={(e) => set({ country: e.target.value })}
          >
            <option value="">{t('anyCountry')}</option>
            {form.country && !TAX_PROFILES.some((p) => p.code === form.country.toUpperCase()) && (
              <option value={form.country.toUpperCase()}>{form.country.toUpperCase()}</option>
            )}
            {[...TAX_PROFILES]
              .filter((p) => /^[A-Z]{2}$/.test(p.code))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} ({p.code})
                </option>
              ))}
          </Select>
        </Field>
        <Field
          label={t('region')}
          htmlFor="tax-region"
          error={errors.region}
          hint={t('regionHint')}
        >
          <Input
            id="tax-region"
            dir="ltr"
            value={form.region}
            maxLength={8}
            invalid={!!errors.region}
            onChange={(e) => set({ region: e.target.value })}
          />
        </Field>

        <Field
          label={t('effectiveFrom')}
          htmlFor="tax-from"
          hint={t('effectiveHint')}
          error={errors.effectiveFrom}
        >
          <Input
            id="tax-from"
            type="date"
            value={form.effectiveFrom}
            invalid={!!errors.effectiveFrom}
            onChange={(e) => set({ effectiveFrom: e.target.value })}
          />
        </Field>
        <Field label={t('effectiveTo')} htmlFor="tax-to" error={errors.effectiveTo}>
          <Input
            id="tax-to"
            type="date"
            value={form.effectiveTo}
            min={form.effectiveFrom || undefined}
            invalid={!!errors.effectiveTo}
            onChange={(e) => set({ effectiveTo: e.target.value })}
          />
        </Field>

        <Field label={t('hsn')} htmlFor="tax-hsn" hint={t('hsnHint')} error={errors.defaultHsnSac}>
          <Input
            id="tax-hsn"
            dir="ltr"
            value={form.defaultHsnSac}
            maxLength={12}
            invalid={!!errors.defaultHsnSac}
            onChange={(e) => set({ defaultHsnSac: e.target.value })}
          />
        </Field>
        <Field label={t('description')} htmlFor="tax-desc" error={errors.description}>
          <Textarea
            id="tax-desc"
            dir="auto"
            rows={2}
            maxLength={500}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>

        <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
          <span>
            <span className="block font-medium">{t('makeDefault')}</span>
            <span className="block text-xs text-muted-foreground">{t('defaultHint')}</span>
          </span>
          <Switch
            checked={form.isDefault}
            onCheckedChange={(v) => set({ isDefault: v })}
            label={t('makeDefault')}
            disabled={wasDefault}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
          <span>
            <span className="block font-medium">{t('active')}</span>
            <span className="block text-xs text-muted-foreground">{t('activeHint')}</span>
          </span>
          <Switch
            checked={form.isDefault ? true : form.isActive}
            onCheckedChange={(v) => set({ isActive: v })}
            label={t('active')}
            disabled={form.isDefault}
          />
        </label>
      </form>
    </Modal>
  );
}
