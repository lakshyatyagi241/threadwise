'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, Field, Input, Spinner, cn, useToast } from '@crm/ui';
import type { WizardResponse } from '@crm/contracts';
import { useSaveShop } from '../api/hooks';
import { useOrigin } from '../lib/browser';
import { errorKind, fieldErrors } from '../lib/errors';
import { pathModeUrl, previewSlug } from '../lib/slug';
import {
  deviceTitle,
  hasOfficialSender,
  initialWizardForm,
  toSaveInput,
  validateWizard,
  type WizardForm,
  type WizardShop,
} from '../lib/wizard-form';
import { CloudIcon, PhoneIcon } from './icons';
import { Eyebrow, useErrorLine } from './parts';

const LIST_HREF = '/connect?platform=wa-store';

function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-7 place-items-center rounded-full bg-brand font-mono text-xs text-brand-foreground">
          {n}
        </span>
        <div>
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
      </div>
      {children}
    </section>
  );
}

/** The add / edit form of the shop wizard (TW-STORE-003): shop details, public URL, sending device. */
export function ShopForm({
  wizard,
  shop,
  workspaceName,
  onDelete,
  onShare,
}: {
  wizard: WizardResponse;
  shop: WizardShop | null;
  workspaceName: string;
  onDelete: () => void;
  onShare: () => void;
}) {
  const t = useTranslations('storefront-builder.admin.wizard.form');
  const errorLine = useErrorLine();
  const router = useRouter();
  const { toast } = useToast();
  const uid = useId();
  const save = useSaveShop();
  const official = hasOfficialSender(wizard);
  const [form, setForm] = useState<WizardForm>(() =>
    initialWizardForm(shop, wizard.devices, official, workspaceName),
  );
  const [problems, setProblems] = useState<Partial<Record<keyof WizardForm, string>>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<keyof WizardForm, string>>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const origin = useOrigin();
  const id = (f: string) => `${uid}-${f}`;

  const slug = shop?.slug ?? previewSlug(form.shopName);
  const builtInUrl = shop?.publicUrl ?? (origin ? pathModeUrl(origin, slug) : '');
  const pathMode = !shop || shop.publicUrl.endsWith(`/s/${shop.slug}`);
  // Reference shows the whole address in front of the slug box: "http://host/s/".
  const slugPrefix = builtInUrl.endsWith(`/${slug}`)
    ? builtInUrl.slice(0, builtInUrl.length - slug.length)
    : '/s/';
  const noDevices = wizard.devices.length === 0 && !official;

  const set = <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setProblems((p) => ({ ...p, [key]: undefined }));
    setServerErrors((p) => ({ ...p, [key]: undefined }));
  };
  const errorOf = (f: keyof WizardForm) =>
    serverErrors[f] ?? (problems[f] ? t(`problems.${problems[f]}`) : undefined);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // after a successful save the page is on its way back to the list: a second click must not send it again
    if (save.isPending || save.isSuccess) return;
    setTopError(null);
    setServerErrors({});
    const found = validateWizard(form);
    setProblems(found);
    const first = (Object.keys(found) as Array<keyof WizardForm>)[0];
    if (first) return void document.getElementById(id(first))?.focus();
    const name = form.shopName.trim();
    save.mutate(toSaveInput(form, shop?.id), {
      onSuccess: () => {
        toast(t(shop ? 'updated' : 'created', { name }));
        router.push(LIST_HREF);
      },
      onError: (error) => {
        const kind = errorKind(error);
        if (kind === 'deviceInvalid')
          return setServerErrors({ deviceId: t('problems.deviceInvalid') });
        if (kind === 'slugTaken') return setServerErrors({ shopName: t('problems.slugTaken') });
        const fields = fieldErrors(error);
        if (kind === 'validation' && (fields.customDomain || fields.shopName)) {
          setServerErrors({ customDomain: fields.customDomain, shopName: fields.shopName });
          return;
        }
        setTopError(errorLine(error));
      },
    });
  };

  return (
    <>
      {!shop && wizard.shops.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <Link href={LIST_HREF} className="font-semibold text-primary hover:underline">
            ← {t('backToShops')}
          </Link>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            {t('creatingShop', { n: wizard.shops.length + 1 })}
          </span>
        </div>
      )}

      <ol
        aria-label={t('progress')}
        className="flex items-center gap-2 overflow-x-auto text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        {(['details', 'url', 'device'] as const).map((k, i) => (
          <li key={k} className="flex shrink-0 items-center gap-2">
            {i > 0 && (
              <span aria-hidden="true" className="rtl:rotate-180">
                →
              </span>
            )}
            <span className="whitespace-nowrap rounded-full bg-primary/10 px-3 py-1.5 font-semibold text-primary">
              {i + 1} · {t(`steps.${k}`)}
            </span>
          </li>
        ))}
      </ol>

      <form
        onSubmit={onSubmit}
        noValidate
        aria-busy={save.isPending || save.isSuccess}
        className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
      >
        {topError && (
          <Alert tone="danger" className="m-6 mb-0">
            {topError}
          </Alert>
        )}

        <Step n={1} title={t('details.title')} hint={t('details.hint')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={t('details.name')}
              htmlFor={id('shopName')}
              hint={t('details.nameHint')}
              error={errorOf('shopName')}
            >
              <Input
                id={id('shopName')}
                value={form.shopName}
                maxLength={191}
                required
                placeholder={
                  !shop && wizard.shops.length > 0
                    ? t('details.namePlaceholderAnother', { workspace: workspaceName })
                    : t('details.namePlaceholder')
                }
                invalid={Boolean(errorOf('shopName'))}
                disabled={save.isPending}
                onChange={(e) => set('shopName', e.target.value)}
              />
            </Field>
            <div className="space-y-1.5 text-sm">
              <div className="font-medium">
                {t('details.slug')}{' '}
                <span className="font-normal text-muted-foreground">{t('details.auto')}</span>
              </div>
              <div className="flex">
                <span
                  className="grid place-items-center whitespace-nowrap rounded-s-md border border-e-0 border-border bg-muted px-3 font-mono text-xs text-muted-foreground"
                  dir="ltr"
                >
                  {pathMode ? slugPrefix : 'https://'}
                </span>
                <div
                  className="min-w-0 flex-1 select-all truncate rounded-e-md border border-border bg-muted px-3 py-2 font-mono text-sm"
                  dir="ltr"
                  data-testid="slug-readout"
                >
                  {slug}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {shop ? t('details.slugLocked') : t('details.slugAuto')}
              </p>
            </div>
          </div>
        </Step>

        <Step n={2} title={t('url.title')} hint={t('url.hint')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <Eyebrow className="mb-1">{t('url.builtIn')}</Eyebrow>
              <div className="break-all font-mono text-sm" dir="ltr" data-testid="built-in-url">
                {builtInUrl}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {pathMode ? t('url.pathMode') : t('url.subdomainMode')}
              </p>
            </div>
            <div className="space-y-2">
              <Field
                label={
                  <>
                    {t('url.domain')}{' '}
                    <span className="font-normal text-muted-foreground">{t('optional')}</span>
                  </>
                }
                htmlFor={id('customDomain')}
                hint={t('url.domainHint')}
                error={errorOf('customDomain')}
              >
                <Input
                  id={id('customDomain')}
                  value={form.customDomain}
                  maxLength={191}
                  placeholder={t('url.domainPlaceholder')}
                  invalid={Boolean(errorOf('customDomain'))}
                  disabled={save.isPending}
                  className="font-mono"
                  dir="ltr"
                  onChange={(e) => set('customDomain', e.target.value)}
                />
              </Field>
              {shop?.customDomain && (
                <p
                  className={cn(
                    'text-xs',
                    shop.customDomainVerified ? 'text-success' : 'text-warning',
                  )}
                >
                  {shop.customDomainVerified
                    ? `✓ ${t('url.verified', { domain: shop.customDomain })}`
                    : `⚠ ${t('url.pending', { domain: shop.customDomain })}`}
                </p>
              )}
            </div>
          </div>
        </Step>

        <Step n={3} title={t('device.title')} hint={t('device.hint')}>
          {noDevices ? (
            <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm">
              {t('device.none')}{' '}
              <Link
                href="/channels/whatsapp"
                className="font-semibold text-primary hover:underline"
              >
                {t('device.pair')}
              </Link>
            </div>
          ) : (
            <fieldset aria-describedby={errorOf('deviceId') ? id('deviceId-error') : undefined}>
              <legend className="sr-only">{t('device.title')}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {official && (
                  <DeviceOption
                    name={`${uid}-device`}
                    value=""
                    checked={form.deviceId === ''}
                    onChange={() => set('deviceId', '')}
                    icon={<CloudIcon className="size-4 text-primary" />}
                    title={t('device.official')}
                    detail={t('device.officialDetail')}
                  />
                )}
                {wizard.devices.map((d) => (
                  <DeviceOption
                    key={d.id}
                    name={`${uid}-device`}
                    value={d.id}
                    checked={form.deviceId === d.id}
                    onChange={() => set('deviceId', d.id)}
                    icon={<PhoneIcon className="size-4 text-primary" />}
                    title={deviceTitle(d, t('device.fallback'))}
                    detail={d.phone || t('device.noNumber')}
                    status={t('device.connected')}
                  />
                ))}
              </div>
              {errorOf('deviceId') && (
                <p id={id('deviceId-error')} role="alert" className="mt-2 text-xs text-danger">
                  {errorOf('deviceId')}
                </p>
              )}
            </fieldset>
          )}
        </Step>

        <div className="flex flex-wrap items-center gap-3 bg-muted/40 px-6 py-4">
          <Link
            href={wizard.shops.length > 0 ? LIST_HREF : '/dashboard'}
            className="inline-flex h-10 items-center rounded-full border border-border px-4 text-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('cancel')}
          </Link>
          {shop && (
            <Button
              variant="secondary"
              className="rounded-full border-danger/40 text-danger hover:bg-danger/10"
              onClick={onDelete}
            >
              {t('deleteThis')}
            </Button>
          )}
          <Button
            type="submit"
            variant="brand"
            className="ms-auto rounded-full px-5"
            disabled={save.isPending || save.isSuccess || noDevices}
          >
            {save.isPending && <Spinner />}
            {shop ? t('saveChanges') : t('create')}
          </Button>
        </div>
      </form>

      {shop && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-brand p-5 text-brand-foreground shadow-sm">
          <div className="min-w-0">
            <Eyebrow className="text-brand-foreground/70">{t('live.eyebrow')}</Eyebrow>
            <div className="mt-1 text-xl font-semibold leading-tight" dir="auto">
              {shop.shopName?.trim() || t('live.fallbackName')} →
            </div>
            <p className="mt-1 text-sm text-brand-foreground/80">{t('live.hint')}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <a
              href={shop.publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-brand-foreground/30 bg-brand-foreground/10 px-4 py-2.5 text-sm font-semibold hover:bg-brand-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-foreground"
            >
              {t('live.view')}
            </a>
            <button
              type="button"
              onClick={onShare}
              className="inline-flex items-center gap-2 rounded-full border border-brand-foreground/30 bg-brand-foreground/10 px-4 py-2.5 text-sm font-semibold hover:bg-brand-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-foreground"
            >
              {t('live.share')}
            </button>
            <Link
              href={`/store?shop=${encodeURIComponent(shop.id)}`}
              className="inline-flex items-center gap-2 rounded-full bg-background px-5 py-2.5 text-sm font-semibold text-primary hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-foreground"
            >
              {t('live.dashboard')}
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

function DeviceOption({
  name,
  value,
  checked,
  onChange,
  icon,
  title,
  detail,
  status,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  icon: ReactNode;
  title: string;
  detail: string;
  status?: string;
}) {
  return (
    <label className="block cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="peer sr-only"
      />
      <div className="flex items-center gap-3 rounded-xl border border-border p-3 transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:ring-2 peer-checked:ring-primary/20 peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" dir="auto">
            {title}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
            {detail}
          </div>
        </div>
        {status && (
          <span className="ms-auto inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
            <span className="size-1.5 rounded-full bg-success" />
            {status}
          </span>
        )}
      </div>
    </label>
  );
}
