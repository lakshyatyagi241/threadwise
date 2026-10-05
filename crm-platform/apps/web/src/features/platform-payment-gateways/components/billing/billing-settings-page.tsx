'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  INVOICE_LOGO_MAX_KB,
  billingSettingsSchema,
  type BillingSettingsResponse,
} from '@crm/contracts';
import { Alert, Button, Card, Checkbox, Field, Input, Switch, Textarea } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { BILLING_KEYS, billingApi, uploadInvoiceLogo } from '../../billing-api';
import { BillingHeader, Crumb, TwoToneTitle } from './parts';

const NS = 'platform-payment-gateways.billing.settings';
const RECURRING_GATEWAYS = [
  'Stripe',
  'PayPal',
  'Razorpay',
  'Paddle',
  'Mollie',
  'Paystack',
  'Flutterwave',
  'Authorize.Net',
  'Braintree',
  'Square',
];
const LOGO_TYPES = 'image/png,image/jpeg,image/svg+xml,image/webp';

interface Draft {
  taxEnabled: boolean;
  taxRate: string;
  taxLabel: string;
  refundEnabled: boolean;
  refundDays: string;
  yearlyToggleEnabled: boolean;
  yearlyDiscountPct: string;
  recurringEnabled: boolean;
  graceDays: string;
  countries: string;
  companyName: string;
  companyAddress: string;
  companyTaxId: string;
  companyRegNo: string;
  companyEmail: string;
  companyPhone: string;
}

const draftOf = (s: BillingSettingsResponse): Draft => ({
  taxEnabled: s.taxEnabled,
  taxRate: String(s.taxRate),
  taxLabel: s.taxLabel,
  refundEnabled: s.refundEnabled,
  refundDays: String(s.refundDays),
  yearlyToggleEnabled: s.yearlyToggleEnabled,
  yearlyDiscountPct: String(s.yearlyDiscountPct),
  recurringEnabled: s.recurringEnabled,
  graceDays: String(s.graceDays),
  countries: s.countries.join('\n'),
  companyName: s.companyName,
  companyAddress: s.companyAddress,
  companyTaxId: s.companyTaxId,
  companyRegNo: s.companyRegNo,
  companyEmail: s.companyEmail,
  companyPhone: s.companyPhone,
});

/** The form's text back into the API shape: countries split on any line break, trimmed, blanks dropped (de-duplicated by the server). */
export function toSettings(d: Draft) {
  return {
    taxEnabled: d.taxEnabled,
    taxRate: d.taxRate.trim() === '' ? Number.NaN : Number(d.taxRate),
    taxLabel: d.taxLabel,
    refundEnabled: d.refundEnabled,
    refundDays: d.refundDays.trim() === '' ? Number.NaN : Number(d.refundDays),
    yearlyToggleEnabled: d.yearlyToggleEnabled,
    yearlyDiscountPct: d.yearlyDiscountPct.trim() === '' ? Number.NaN : Number(d.yearlyDiscountPct),
    recurringEnabled: d.recurringEnabled,
    graceDays: d.graceDays.trim() === '' ? Number.NaN : Number(d.graceDays),
    countries: d.countries
      .split(/\r?\n/)
      .map((c) => c.trim())
      .filter(Boolean),
    companyName: d.companyName,
    companyAddress: d.companyAddress,
    companyTaxId: d.companyTaxId,
    companyRegNo: d.companyRegNo,
    companyEmail: d.companyEmail,
    companyPhone: d.companyPhone,
  };
}

function Section({
  title,
  hint,
  toggle,
  children,
}: {
  title: string;
  hint?: ReactNode;
  toggle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 max-w-[640px] text-xs text-muted-foreground">{hint}</p>}
        </div>
        {toggle}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );
}

/** Admin > Billing settings (TW-PAYGW-007): tax, refund window, yearly billing, auto-renew, invoice identity and the checkout country list. */
export function BillingSettingsPage() {
  const q = useQuery({
    queryKey: BILLING_KEYS.settings,
    queryFn: ({ signal }) => billingApi.settings(signal),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  // Keyed by version: a reload after a conflict starts the form again from what is saved.
  return <SettingsForm key={q.data.version} initial={q.data} />;
}

function SettingsForm({ initial }: { initial: BillingSettingsResponse }) {
  const t = useTranslations(NS);
  const tc = useTranslations('platform-payment-gateways.billing.common');
  const toast = useToast();
  const qc = useQueryClient();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const [d, setD] = useState<Draft>(() => draftOf(initial));
  const [file, setFile] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  // The local preview is an object URL made when a file is picked and released when it is replaced or the page closes.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const save = useMutation({
    mutationFn: async () => {
      let next = await billingApi.saveSettings({
        ...billingSettingsSchema.parse(toSettings(d)),
        version: initial.version,
      });
      // Remove wins over a new upload (Reference rule 3).
      if (removeLogo && next.hasInvoiceLogo) next = await billingApi.removeLogo();
      else if (file && !removeLogo) next = await uploadInvoiceLogo(file);
      return next;
    },
    onSuccess: (next) => {
      toast.success(t('saved'));
      setProblem(null);
      setFile(null);
      setRemoveLogo(false);
      qc.setQueryData(BILLING_KEYS.settings, next);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setProblem(t('conflict'));
        void qc.invalidateQueries({ queryKey: BILLING_KEYS.settings });
      } else if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      } else {
        setProblem(e instanceof Error && e.message ? e.message : tc('actionFailed'));
      }
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    const parsed = billingSettingsSchema.safeParse(toSettings(d));
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setProblem(null);
    save.mutate();
  };

  const pickFile = (f: File | null) => {
    setFileError(null);
    if (f && f.size > INVOICE_LOGO_MAX_KB * 1024) {
      setFileError(t('logo.tooBig', { kb: INVOICE_LOGO_MAX_KB }));
      if (fileInput.current) fileInput.current.value = '';
      setFile(null);
      return;
    }
    setFile(f);
  };

  const off = !canEdit || save.isPending;
  const err = (k: string) => errors[k];

  return (
    <div className="space-y-5">
      <Crumb items={[{ label: t('title') }]} />
      <BillingHeader
        eyebrow={t('eyebrow')}
        title={<TwoToneTitle first={t('titleFirst')} second={t('titleSecond')} />}
        description={t('description')}
        actions={
          <Link
            href="/account/plans"
            target="_blank"
            className="inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-xs font-semibold hover:bg-muted"
          >
            {t('previewPlans')}
          </Link>
        }
      />
      {!canEdit && <Alert tone="info">{t('readOnly')}</Alert>}
      {problem && <Alert tone="danger">{problem}</Alert>}

      <form onSubmit={submit} className="space-y-5" noValidate>
        <Section
          title={t('tax.title')}
          hint={t('tax.hint')}
          toggle={
            <Switch
              checked={d.taxEnabled}
              onCheckedChange={(v) => set('taxEnabled', v)}
              label={t('tax.title')}
              disabled={off}
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('tax.rate')} htmlFor="bs-tax-rate" error={err('taxRate')}>
              <Input
                id="bs-tax-rate"
                type="number"
                min={0}
                max={100}
                value={d.taxRate}
                onChange={(e) => set('taxRate', e.target.value)}
                disabled={off}
                invalid={!!err('taxRate')}
                className="font-mono"
              />
            </Field>
            <Field label={t('tax.label')} htmlFor="bs-tax-label" error={err('taxLabel')}>
              <Input
                id="bs-tax-label"
                maxLength={32}
                value={d.taxLabel}
                placeholder={t('tax.labelPlaceholder')}
                onChange={(e) => set('taxLabel', e.target.value)}
                disabled={off}
                invalid={!!err('taxLabel')}
                className="font-mono"
              />
            </Field>
          </div>
        </Section>

        <Section title={t('company.title')} hint={t('company.hint')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('company.name')} htmlFor="bs-co-name" error={err('companyName')}>
              <Input
                id="bs-co-name"
                maxLength={160}
                value={d.companyName}
                onChange={(e) => set('companyName', e.target.value)}
                disabled={off}
              />
            </Field>
            <Field label={t('company.taxId')} htmlFor="bs-co-tax" error={err('companyTaxId')}>
              <Input
                id="bs-co-tax"
                maxLength={64}
                value={d.companyTaxId}
                placeholder="27AABCW1234F1Z9"
                onChange={(e) => set('companyTaxId', e.target.value)}
                disabled={off}
                className="font-mono"
              />
            </Field>
            <Field
              label={t('company.address')}
              htmlFor="bs-co-addr"
              error={err('companyAddress')}
              className="sm:col-span-2"
            >
              <Textarea
                id="bs-co-addr"
                rows={3}
                maxLength={500}
                value={d.companyAddress}
                onChange={(e) => set('companyAddress', e.target.value)}
                disabled={off}
              />
            </Field>
            <Field label={t('company.regNo')} htmlFor="bs-co-reg" error={err('companyRegNo')}>
              <Input
                id="bs-co-reg"
                maxLength={64}
                value={d.companyRegNo}
                placeholder="U72900MH2024PTC456789"
                onChange={(e) => set('companyRegNo', e.target.value)}
                disabled={off}
                className="font-mono"
              />
            </Field>
            <Field label={t('company.email')} htmlFor="bs-co-email" error={err('companyEmail')}>
              <Input
                id="bs-co-email"
                type="email"
                maxLength={160}
                value={d.companyEmail}
                placeholder="billing@example.com"
                onChange={(e) => set('companyEmail', e.target.value)}
                disabled={off}
                invalid={!!err('companyEmail')}
              />
            </Field>
            <Field label={t('company.phone')} htmlFor="bs-co-phone" error={err('companyPhone')}>
              <Input
                id="bs-co-phone"
                maxLength={40}
                value={d.companyPhone}
                onChange={(e) => set('companyPhone', e.target.value)}
                disabled={off}
              />
            </Field>
          </div>

          <div className="mt-5 border-t border-border pt-5">
            <div className="text-sm font-semibold">{t('logo.title')}</div>
            <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
              {t('logo.hint', { kb: INVOICE_LOGO_MAX_KB })}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <span className="grid h-16 w-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted/40">
                {preview || (initial.invoiceLogoUrl && !removeLogo) ? (
                  <img
                    src={preview ?? initial.invoiceLogoUrl ?? ''}
                    alt={t('logo.title')}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {t('logo.none')}
                  </span>
                )}
              </span>
              <div className="min-w-[220px] flex-1">
                <input
                  ref={fileInput}
                  type="file"
                  accept={LOGO_TYPES}
                  aria-label={t('logo.choose')}
                  disabled={off}
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs file:me-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground"
                />
                {fileError && (
                  <p role="alert" className="mt-1 text-xs text-danger">
                    {fileError}
                  </p>
                )}
                {initial.hasInvoiceLogo ? (
                  <Checkbox
                    id="bs-remove-logo"
                    className="mt-2 text-xs"
                    label={t('logo.remove')}
                    checked={removeLogo}
                    onChange={(e) => setRemoveLogo(e.target.checked)}
                    disabled={off}
                  />
                ) : (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{t('logo.fallback')}</p>
                )}
              </div>
            </div>
          </div>
        </Section>

        <Section
          title={t('refund.title')}
          hint={t('refund.hint')}
          toggle={
            <Switch
              checked={d.refundEnabled}
              onCheckedChange={(v) => set('refundEnabled', v)}
              label={t('refund.title')}
              disabled={off}
            />
          }
        >
          <Field
            label={t('refund.days')}
            htmlFor="bs-refund-days"
            error={err('refundDays')}
            className="max-w-[200px]"
          >
            <Input
              id="bs-refund-days"
              type="number"
              min={0}
              max={365}
              value={d.refundDays}
              onChange={(e) => set('refundDays', e.target.value)}
              disabled={off}
              invalid={!!err('refundDays')}
              className="font-mono"
            />
          </Field>
        </Section>

        <Section
          title={t('yearly.title')}
          hint={t('yearly.hint')}
          toggle={
            <Switch
              checked={d.yearlyToggleEnabled}
              onCheckedChange={(v) => set('yearlyToggleEnabled', v)}
              label={t('yearly.title')}
              disabled={off}
            />
          }
        >
          <Field
            label={t('yearly.discount')}
            htmlFor="bs-yearly"
            error={err('yearlyDiscountPct')}
            hint={t('yearly.formula')}
            className="max-w-[260px]"
          >
            <Input
              id="bs-yearly"
              type="number"
              min={0}
              max={100}
              value={d.yearlyDiscountPct}
              onChange={(e) => set('yearlyDiscountPct', e.target.value)}
              disabled={off}
              invalid={!!err('yearlyDiscountPct')}
              className="font-mono"
            />
          </Field>
        </Section>

        <Section
          title={t('recurring.title')}
          hint={t('recurring.hint')}
          toggle={
            <Switch
              checked={d.recurringEnabled}
              onCheckedChange={(v) => set('recurringEnabled', v)}
              label={t('recurring.title')}
              disabled={off}
            />
          }
        >
          <ul className="flex flex-wrap gap-1.5" aria-label={t('recurring.gateways')}>
            {RECURRING_GATEWAYS.map((g) => (
              <li
                key={g}
                className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success"
              >
                {g}
              </li>
            ))}
          </ul>
          <Field
            label={t('recurring.graceDays')}
            htmlFor="bs-grace-days"
            error={err('graceDays')}
            className="mt-3 max-w-[200px]"
          >
            <Input
              id="bs-grace-days"
              type="number"
              min={0}
              max={30}
              value={d.graceDays}
              onChange={(e) => set('graceDays', e.target.value)}
              disabled={off}
              invalid={!!err('graceDays')}
              className="font-mono"
            />
          </Field>
          <p className="mt-1 max-w-[640px] text-[11px] text-muted-foreground">
            {t('recurring.graceHint')}
          </p>
          <p className="mt-2 max-w-[640px] text-[11px] text-muted-foreground">
            {t('recurring.note')}
          </p>
        </Section>

        <Section title={t('countries.title')} hint={t('countries.hint')}>
          <Textarea
            id="bs-countries"
            aria-label={t('countries.title')}
            rows={8}
            value={d.countries}
            onChange={(e) => set('countries', e.target.value)}
            disabled={off}
            className="font-mono"
          />
          {err('countries') && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {err('countries')}
            </p>
          )}
        </Section>

        {canEdit && (
          <div className="flex items-center justify-end gap-2">
            <Button type="submit" className="rounded-full px-5" disabled={save.isPending}>
              {t('save')}
            </Button>
          </div>
        )}
      </form>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/admin/coupons"
          className="rounded-xl border border-border bg-background p-5 transition hover:border-primary"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('links.coupons')}
          </div>
          <div className="mt-1 text-xl font-semibold">{t('links.couponsTitle')}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('links.couponsHint')}
            {initial.couponCount !== null &&
              ` ${t('links.configured', { count: initial.couponCount })}`}
          </p>
        </Link>
        <Link
          href="/admin/pricing-faqs"
          className="rounded-xl border border-border bg-background p-5 transition hover:border-primary"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('links.faqs')}
          </div>
          <div className="mt-1 text-xl font-semibold">{t('links.faqsTitle')}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('links.faqsHint')}
            {initial.faqCount !== null && ` ${t('links.configured', { count: initial.faqCount })}`}
          </p>
        </Link>
      </div>
    </div>
  );
}
