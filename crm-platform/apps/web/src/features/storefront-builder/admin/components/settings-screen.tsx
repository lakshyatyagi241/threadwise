'use client';

import { STORE_THEMES, type StorefrontResponse } from '@crm/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Spinner,
  PasswordInput,
  cn,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useOverview, useUpdateSettings, useVerifyDomain } from '../api/hooks';
import { CURRENCY_OPTIONS } from '../lib/currency';
import { errorKind, fieldErrors, isNoShop } from '../lib/errors';
import { previewPublicUrl } from '../lib/slug';
import {
  cnameHost,
  fromShop,
  isRazorpayApi,
  pickerColor,
  toInput,
  validate,
  type Problem,
  type SettingsField,
  type SettingsForm,
} from '../lib/settings-form';
import { PAYMENT_PROVIDERS } from '@crm/contracts';
import { swatchTextDark, themeGradient } from '../lib/themes';
import { ExternalIcon } from './icons';
import { ErrorPanel, Eyebrow, Skeleton, useErrorLine } from './parts';
import { StoreShell } from './store-shell';
import { WIZARD_HREF } from './dashboard-screen';

/** `/store/storefront` (WD-STORE-006..008): the whole design and configuration form of the selected shop. */
export function SettingsScreen() {
  const t = useTranslations('storefront-builder.admin.settings');
  const router = useRouter();
  const shopParam = useSearchParams().get('shop') ?? undefined;
  const overview = useOverview(shopParam);
  const canRead = useCan('store.storefront.read');
  const noShop = overview.isError && isNoShop(overview.error);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (noShop) router.replace(WIZARD_HREF);
  }, [noShop, router]);

  const shop = overview.data?.shop;

  return (
    <StoreShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
        </div>
        {shop && (
          <a
            href={shop.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-brand-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {t('viewLive')} <ExternalIcon className="size-3.5" />
          </a>
        )}
      </div>

      {!canRead ? (
        <Alert tone="warning">{t('noAccess')}</Alert>
      ) : overview.isPending || noShop ? (
        <div role="status" aria-label={t('loading')} className="max-w-4xl space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      ) : overview.isError ? (
        <ErrorPanel error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <SettingsFormView
          key={`${overview.data.shop.id}:${epoch}`}
          shop={overview.data.shop}
          onReload={() => void overview.refetch().then(() => setEpoch((e) => e + 1))}
        />
      )}
    </StoreShell>
  );
}

const SECTION = 'space-y-3 border-t border-border pt-4';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className={SECTION}>
      <legend className="mb-1">
        <Eyebrow>{title}</Eyebrow>
      </legend>
      {children}
    </fieldset>
  );
}

function SettingsFormView({ shop, onReload }: { shop: StorefrontResponse; onReload: () => void }) {
  const t = useTranslations('storefront-builder.admin.settings');
  const errorLine = useErrorLine();
  const { toast } = useToast();
  const canManage = useCan('store.storefront.manage');
  const uid = useId();
  const save = useUpdateSettings(shop.id);
  const [form, setForm] = useState<SettingsForm>(() => fromShop(shop));
  const [problems, setProblems] = useState<Partial<Record<SettingsField, Problem>>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const id = (f: string) => `${uid}-${f}`;

  const set = <K extends SettingsField>(key: K, value: SettingsForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setProblems((p) => (key in p ? { ...p, [key]: undefined } : p));
    setServerErrors((s) => (key in s ? { ...s, [key]: '' } : s));
  };

  const errorOf = (f: SettingsField): string | undefined => {
    const server = serverErrors[f];
    if (server) return server;
    const p = problems[f];
    return p ? t(`problems.${p.key}`, p.values) : undefined;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canManage || save.isPending) return;
    setTopError(null);
    setConflict(false);
    setServerErrors({});
    const found = validate(form);
    setProblems(found);
    const first = (Object.keys(found) as SettingsField[])[0];
    if (first) {
      document.getElementById(id(first))?.focus();
      return;
    }
    save.mutate(toInput(form, shop.rowVersion), {
      onSuccess: () => {
        toast(t('saved'));
        // The secrets are write-only: once stored, the boxes go back to empty (the placeholder says "stored").
        setForm((f) => ({ ...f, rzpKeySecret: '', rzpWebhookSecret: '' }));
      },
      onError: (error) => {
        const kind = errorKind(error);
        if (kind === 'conflict') return setConflict(true);
        if (kind === 'slugTaken') {
          setServerErrors({ slug: t('problems.slugTaken') });
          return document.getElementById(id('slug'))?.focus();
        }
        const fields = fieldErrors(error);
        if (kind === 'validation' && Object.keys(fields).length > 0) {
          setServerErrors(fields);
          const firstField = Object.keys(fields)[0];
          return document.getElementById(id(firstField!))?.focus();
        }
        setTopError(errorLine(error));
      },
    });
  };

  const disabled = !canManage || save.isPending;
  const providerIsApi = isRazorpayApi(form.paymentProvider);
  const brandPicker = pickerColor(form.brandColor) ?? '#075e54';
  const slugUrl = previewPublicUrl(shop.publicUrl, shop.slug, form.slug.trim());
  const knownCurrency = CURRENCY_OPTIONS.some((c) => c.code === form.currencyCode);

  const flatInput = (
    field: SettingsField,
    props: {
      label: ReactNode;
      hint?: ReactNode;
      placeholder?: string;
      mono?: boolean;
      maxLength?: number;
      type?: string;
      className?: string;
      inputMode?: 'decimal';
      required?: boolean;
    },
  ) => (
    <Field
      label={props.label}
      htmlFor={id(field)}
      hint={props.hint}
      error={errorOf(field)}
      className={props.className}
    >
      <Input
        id={id(field)}
        type={props.type ?? 'text'}
        value={String(form[field])}
        maxLength={props.maxLength}
        required={props.required}
        placeholder={props.placeholder}
        inputMode={props.inputMode}
        invalid={Boolean(errorOf(field))}
        disabled={disabled}
        className={props.mono ? 'font-mono' : undefined}
        dir={props.mono ? 'ltr' : undefined}
        onChange={(e) => set(field, e.target.value as never)}
      />
    </Field>
  );

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-busy={save.isPending}
      className="max-w-4xl space-y-5 rounded-xl border border-border bg-background p-5 shadow-sm"
    >
      {conflict && (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('conflict')}</span>
          <Button variant="secondary" size="sm" onClick={onReload}>
            {t('reload')}
          </Button>
        </Alert>
      )}
      {topError && <Alert tone="danger">{topError}</Alert>}
      {Object.keys(problems).some((k) => problems[k as SettingsField]) && (
        <Alert tone="danger">{t('fixErrors')}</Alert>
      )}

      {/* Theme */}
      <fieldset>
        <legend className="mb-2">
          <Eyebrow>{t('theme.title')}</Eyebrow>
        </legend>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {STORE_THEMES.map((th) => (
            <label key={th.key} className="block cursor-pointer">
              <input
                type="radio"
                name={`${uid}-theme`}
                value={th.key}
                checked={form.themeKey === th.key}
                disabled={disabled}
                onChange={() => set('themeKey', th.key)}
                className="peer sr-only"
              />
              <div className="overflow-hidden rounded-xl border border-border transition peer-checked:border-primary peer-checked:ring-2 peer-checked:ring-primary/20 peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                <div
                  className="grid aspect-[4/3] place-items-center"
                  style={{ background: themeGradient(th.key) }}
                >
                  <span
                    className={cn(
                      'text-lg font-semibold capitalize',
                      swatchTextDark(th.key) ? 'text-black/70' : 'text-white',
                    )}
                    style={{ textShadow: '0 1px 2px rgba(0,0,0,.2)' }}
                  >
                    {th.key}
                  </span>
                </div>
                <div className="bg-background px-3 py-2 text-xs">{th.label}</div>
              </div>
            </label>
          ))}
        </div>
        {errorOf('themeKey') && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {errorOf('themeKey')}
          </p>
        )}
      </fieldset>

      {/* Slug + custom domain */}
      <div className={cn(SECTION, 'grid grid-cols-1 gap-4 sm:grid-cols-2')}>
        {flatInput('slug', {
          label: t('slug.label'),
          maxLength: 64,
          required: true,
          mono: true,
          hint: (
            <>
              {t('slug.hint')}{' '}
              <span className="font-mono" dir="ltr">
                {slugUrl}
              </span>
            </>
          ),
        })}
        <div className="space-y-2">
          {flatInput('customDomain', {
            label: (
              <>
                {t('domain.label')}{' '}
                <span className="font-normal text-muted-foreground">{t('optional')}</span>
              </>
            ),
            placeholder: t('domain.placeholder'),
            mono: true,
            maxLength: 191,
          })}
          {shop.customDomain && <DomainStatus shop={shop} canManage={canManage} />}
        </div>
      </div>

      {/* Brand */}
      <div className={cn(SECTION, 'grid grid-cols-1 gap-4 sm:grid-cols-2')}>
        {flatInput('logoUrl', {
          label: t('brand.logoUrl'),
          type: 'url',
          placeholder: 'https://...',
          maxLength: 1024,
        })}
        <Field label={t('brand.color')} htmlFor={id('brandColor')} error={errorOf('brandColor')}>
          <div className="flex gap-2">
            <input
              type="color"
              aria-label={t('brand.colorPicker')}
              value={brandPicker}
              disabled={disabled}
              onChange={(e) => set('brandColor', e.target.value)}
              className="size-10 shrink-0 cursor-pointer rounded-md border border-border bg-background p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <Input
              id={id('brandColor')}
              value={form.brandColor}
              maxLength={7}
              disabled={disabled}
              invalid={Boolean(errorOf('brandColor'))}
              className="flex-1 font-mono"
              dir="ltr"
              onChange={(e) => set('brandColor', e.target.value)}
            />
          </div>
        </Field>
        {flatInput('heroText', {
          label: t('brand.heroText'),
          placeholder: t('brand.heroPlaceholder'),
          maxLength: 280,
          className: 'sm:col-span-2',
        })}
        {flatInput('footerText', {
          label: t('brand.footerText'),
          placeholder: t('brand.footerPlaceholder'),
          maxLength: 280,
          className: 'sm:col-span-2',
        })}
      </div>

      {/* Currency */}
      <Section title={t('currency.title')}>
        <Field
          label={t('currency.label')}
          htmlFor={id('currencyCode')}
          hint={t('currency.hint')}
          error={errorOf('currencyCode')}
          className="max-w-xs"
        >
          <Select
            id={id('currencyCode')}
            value={form.currencyCode}
            disabled={disabled}
            invalid={Boolean(errorOf('currencyCode'))}
            onChange={(e) => set('currencyCode', e.target.value)}
          >
            {!knownCurrency && <option value={form.currencyCode}>{form.currencyCode}</option>}
            {CURRENCY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      {/* Shipping */}
      <Section title={t('shipping.title')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {flatInput('shippingFlat', {
            label: t('shipping.flat'),
            hint: t('shipping.flatHint'),
            placeholder: '0',
            type: 'number',
            inputMode: 'decimal',
            mono: true,
          })}
          {flatInput('shippingFreeAbove', {
            label: t('shipping.freeAbove'),
            hint: t('shipping.freeAboveHint'),
            placeholder: '999',
            type: 'number',
            inputMode: 'decimal',
            mono: true,
          })}
          {flatInput('shippingNote', {
            label: (
              <>
                {t('shipping.note')}{' '}
                <span className="font-normal text-muted-foreground">{t('optional')}</span>
              </>
            ),
            hint: t('shipping.noteHint'),
            placeholder: t('shipping.notePlaceholder'),
            maxLength: 160,
          })}
        </div>
      </Section>

      {/* Payment */}
      <Section title={t('payment.title')}>
        <p className="text-sm text-muted-foreground">{t('payment.intro')}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('payment.provider')}
            htmlFor={id('paymentProvider')}
            error={errorOf('paymentProvider')}
          >
            <Select
              id={id('paymentProvider')}
              value={form.paymentProvider}
              disabled={disabled}
              invalid={Boolean(errorOf('paymentProvider'))}
              onChange={(e) => set('paymentProvider', e.target.value)}
            >
              <option value="">{t('payment.providers.none')}</option>
              {PAYMENT_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`payment.providers.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          {flatInput('paymentHandle', {
            label: t('payment.handle'),
            hint: t('payment.handleHint'),
            placeholder: t('payment.handlePlaceholder'),
            mono: true,
            maxLength: 255,
          })}
        </div>

        <div
          className={cn(
            'rounded-xl border border-border bg-muted/40 p-3',
            !providerIsApi && 'opacity-80',
          )}
        >
          <Eyebrow className="mb-2">{t('payment.razorpay.title')}</Eyebrow>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {flatInput('rzpKeyId', {
              label: t('payment.razorpay.keyId'),
              placeholder: t('payment.razorpay.keyIdPlaceholder'),
              mono: true,
              maxLength: 191,
            })}
            <Field
              label={t('payment.razorpay.keySecret')}
              htmlFor={id('rzpKeySecret')}
              error={errorOf('rzpKeySecret')}
            >
              <PasswordInput
                id={id('rzpKeySecret')}
                showLabel={t('payment.razorpay.show')}
                hideLabel={t('payment.razorpay.hide')}
                autoComplete="new-password"
                value={form.rzpKeySecret}
                placeholder={shop.razorpay.hasKeySecret ? t('payment.razorpay.stored') : ''}
                disabled={disabled}
                invalid={Boolean(errorOf('rzpKeySecret'))}
                className="font-mono"
                onChange={(e) => set('rzpKeySecret', e.target.value)}
              />
            </Field>
            <Field
              label={t('payment.razorpay.webhookSecret')}
              htmlFor={id('rzpWebhookSecret')}
              error={errorOf('rzpWebhookSecret')}
            >
              <PasswordInput
                id={id('rzpWebhookSecret')}
                showLabel={t('payment.razorpay.show')}
                hideLabel={t('payment.razorpay.hide')}
                autoComplete="new-password"
                value={form.rzpWebhookSecret}
                placeholder={shop.razorpay.hasWebhookSecret ? t('payment.razorpay.stored') : ''}
                disabled={disabled}
                invalid={Boolean(errorOf('rzpWebhookSecret'))}
                className="font-mono"
                onChange={(e) => set('rzpWebhookSecret', e.target.value)}
              />
            </Field>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('payment.razorpay.webhookHelp')}{' '}
            <code className="font-mono" dir="ltr">
              {webhookUrl()}
            </code>{' '}
            {t('payment.razorpay.webhookEvent')}
          </p>
        </div>
      </Section>

      {/* Abandoned cart */}
      <Section title={t('recovery.title')}>
        <Checkbox
          id={id('cartRecoveryEnabled')}
          checked={form.cartRecoveryEnabled}
          disabled={disabled}
          onChange={(e) => set('cartRecoveryEnabled', e.target.checked)}
          label={
            <>
              <span className="block font-semibold">{t('recovery.enable')}</span>
              <span className="text-xs text-muted-foreground">{t('recovery.enableHint')}</span>
            </>
          }
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {flatInput('cartRecoveryDelayMin', {
            label: t('recovery.delay'),
            type: 'number',
            inputMode: 'decimal',
          })}
          <Field
            label={
              <>
                {t('recovery.message')}{' '}
                <span className="font-normal text-muted-foreground">
                  {t('recovery.messageHint')}
                </span>
              </>
            }
            htmlFor={id('cartRecoveryMessage')}
            error={errorOf('cartRecoveryMessage')}
            className="md:col-span-3"
          >
            <Input
              id={id('cartRecoveryMessage')}
              maxLength={1024}
              value={form.cartRecoveryMessage}
              placeholder={t('recovery.messagePlaceholder')}
              disabled={disabled}
              invalid={Boolean(errorOf('cartRecoveryMessage'))}
              onChange={(e) => set('cartRecoveryMessage', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <Checkbox
          id={id('enabled')}
          checked={form.enabled}
          disabled={disabled}
          onChange={(e) => set('enabled', e.target.checked)}
          label={t('live')}
        />
        {canManage ? (
          <Button
            type="submit"
            variant="brand"
            className="rounded-full px-5"
            disabled={save.isPending}
          >
            {save.isPending && <Spinner />}
            {t('save')}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{t('readOnly')}</span>
        )}
      </div>
    </form>
  );
}

/** Where Razorpay should post `payment_link.paid`: this site's storefront-pay webhook. */
function webhookUrl(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/webhooks/storefront-pay`;
}

/** Under the domain field: verified badge, or the CNAME to add and the Verify button (WD-STORE-007). */
function DomainStatus({ shop, canManage }: { shop: StorefrontResponse; canManage: boolean }) {
  const t = useTranslations('storefront-builder.admin.settings.domain');
  const verify = useVerifyDomain(shop.id);
  const [result, setResult] = useState<{ ok: boolean; expected: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const domain = shop.customDomain ?? '';

  if (shop.customDomainVerified) {
    return <p className="text-xs text-success">✓ {t('verifiedLive')}</p>;
  }
  const expected = result?.expected ?? shop.cnameTarget;
  const run = () => {
    setFailure(null);
    verify.mutate(undefined, {
      onSuccess: (r) => setResult({ ok: r.ok, expected: r.expected }),
      onError: (error) => {
        const kind = errorKind(error);
        setResult(null);
        setFailure(kind === 'domainNotSet' ? t('notSet') : t('verifyFailed'));
      },
    });
  };
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-warning">⚠ {t('addCname')}</p>
      <div className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs" dir="ltr">
        {t('cname')} <strong>{cnameHost(domain)}</strong> → <strong>{expected}</strong>
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            onClick={run}
            disabled={verify.isPending}
          >
            {verify.isPending && <Spinner />}
            {t('verify')}
          </Button>
          <span
            role="status"
            aria-live="polite"
            className={cn('text-xs', result?.ok ? 'text-success' : 'text-danger')}
          >
            {result
              ? result.ok
                ? t('verified')
                : t('notPointing', { expected: result.expected })
              : failure}
          </span>
        </div>
      )}
    </div>
  );
}
