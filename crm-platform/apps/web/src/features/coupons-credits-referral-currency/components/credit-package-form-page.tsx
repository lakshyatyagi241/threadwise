'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BillingOptionsResponse, CreditPackageItem } from '@crm/contracts';
import { Alert, Input, Select, Spinner, Textarea } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { KEYS, creditPackageItemSchema, fetchOptions, fetchPackage } from '../api';
import { cpnErrorKey } from '../lib/errors';
import {
  buildPackageRequest,
  newPackageDraft,
  packageToDraft,
  type PackageDraft,
  type PackageField,
} from '../lib/package-draft';
import {
  Accent,
  ErrorBlock,
  HINT,
  INPUT,
  LABEL,
  LoadingBlock,
  PageHead,
  Problems,
  Section,
  SwitchRow,
} from './ui';

const NS = 'coupons-credits-referral-currency.packages.editor';
const BASE = '/admin/credit-packages';

/** `/admin/credit-packages/new` and `/admin/credit-packages/:id/edit`: one page, two modes, as in WaDesk. */
export function CreditPackageFormPage({ packageId }: { packageId?: string }) {
  const options = useQuery({
    queryKey: KEYS.options,
    queryFn: ({ signal }) => fetchOptions(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const pkg = useQuery({
    queryKey: KEYS.package(packageId ?? 'new'),
    queryFn: ({ signal }) => fetchPackage(packageId as string, signal),
    enabled: !!packageId,
    refetchOnWindowFocus: false,
  });
  if (options.isPending || (packageId && pkg.isPending)) return <LoadingBlock />;
  if (options.isError)
    return <ErrorBlock error={options.error} onRetry={() => void options.refetch()} />;
  if (pkg.isError) return <ErrorBlock error={pkg.error} onRetry={() => void pkg.refetch()} />;
  return (
    <PackageForm
      key={pkg.data?.rowVersion ?? 'new'}
      pkg={pkg.data ?? null}
      options={options.data}
    />
  );
}

function PackageForm({
  pkg,
  options,
}: {
  pkg: CreditPackageItem | null;
  options: BillingOptionsResponse;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('coupons-credits-referral-currency.errors');
  const tc = useTranslations('coupons-credits-referral-currency.common');
  const tl = useTranslations('coupons-credits-referral-currency.packages');
  const router = useRouter();
  const qc = useQueryClient();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const [draft, setDraft] = useState<PackageDraft>(() =>
    pkg
      ? packageToDraft(pkg)
      : newPackageDraft(
          options.currencies.some((c) => c.code === 'INR')
            ? 'INR'
            : (options.currencies[0]?.code ?? 'INR'),
        ),
  );
  const [problems, setProblems] = useState<PackageField[]>([]);
  const set = <K extends keyof PackageDraft>(k: K, v: PackageDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const save = useMutation({
    mutationFn: (body: object) =>
      pkg
        ? operatorFetch(`/credit-packages/${pkg.id}`, {
            method: 'PATCH',
            body: { ...body, rowVersion: pkg.rowVersion },
            schema: creditPackageItemSchema,
          })
        : operatorFetch('/credit-packages', {
            method: 'POST',
            body,
            schema: creditPackageItemSchema,
          }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.packages });
      router.push(`${BASE}?saved=${pkg ? 'updated' : 'created'}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = buildPackageRequest(draft);
    if (!r.ok) {
      setProblems(r.problems);
      return;
    }
    setProblems([]);
    // A blank slug is derived from the name on the server, on create and on edit (WaDesk's saving hook)
    save.mutate(r.body);
  };

  const currencies = options.currencies.some((c) => c.code === draft.currencyCode)
    ? options.currencies
    : [{ code: draft.currencyCode, symbol: null, name: null, precision: 2 }, ...options.currencies];
  const problemItems = problems.map((f) => t(`problems.${f}`));
  const serverMessages =
    save.isError && save.error instanceof ApiError && save.error.status === 422
      ? save.error.fieldErrors.map((f) => f.message)
      : [];
  const submitLabel = pkg ? t('saveChanges') : t('create');

  const submitButton = canEdit && (
    <button
      type="submit"
      disabled={save.isPending}
      className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
    >
      {save.isPending ? (
        <Spinner />
      ) : (
        <svg
          viewBox="0 0 16 16"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M2 8l5 5 7-9" />
        </svg>
      )}
      {submitLabel}
    </button>
  );

  return (
    <div className="space-y-5">
      <PageHead
        crumbs={[
          { label: tc('admin'), href: '/admin' },
          { label: tl('crumbHere'), href: BASE },
          { label: pkg ? pkg.name : t('crumbNew') },
        ]}
        eyebrow={pkg ? t('eyebrowEdit') : t('eyebrowNew')}
        title={
          pkg ? (
            <>
              {t('titleEditLead')} <Accent>{pkg.name}</Accent>
            </>
          ) : (
            <>
              {t('titleNewLead')} <Accent>{t('titleNewAccent')}</Accent>
            </>
          )
        }
        description={pkg ? t('descriptionEdit') : t('descriptionNew')}
      />
      {!canEdit && <Alert tone="info">{tc('readOnly')}</Alert>}
      <Problems title={t('problemsTitle')} items={problemItems} />
      {save.isError && problemItems.length === 0 && (
        <Alert tone="danger" className="space-y-1">
          <p className="font-semibold">{t('problemsTitle')}</p>
          {serverMessages.length > 0 ? (
            <ul className="list-disc ps-5">
              {serverMessages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : (
            <p>{te(cpnErrorKey(save.error))}</p>
          )}
        </Alert>
      )}

      <form onSubmit={submit} noValidate className="space-y-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Section n="01" title={t('sections.identity')}>
            <div>
              <label className={LABEL} htmlFor="cp-name">
                {t('fields.name')} <span className="text-danger">*</span>
              </label>
              <Input
                id="cp-name"
                value={draft.name}
                maxLength={96}
                disabled={!canEdit}
                invalid={problems.includes('name')}
                onChange={(e) => set('name', e.target.value)}
                placeholder={t('fields.namePlaceholder')}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="cp-slug">
                {t('fields.slug')}
              </label>
              <Input
                id="cp-slug"
                value={draft.slug}
                maxLength={96}
                disabled={!canEdit}
                invalid={problems.includes('slug')}
                onChange={(e) => set('slug', e.target.value)}
                placeholder={t('fields.slugPlaceholder')}
                className={`${INPUT} font-mono`}
              />
              <p className={HINT}>{t('fields.slugHint')}</p>
            </div>
            <div>
              <label className={LABEL} htmlFor="cp-desc">
                {t('fields.description')}
              </label>
              <Textarea
                id="cp-desc"
                rows={3}
                maxLength={500}
                disabled={!canEdit}
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder={t('fields.descriptionPlaceholder')}
                className="text-[12.5px]"
              />
            </div>
          </Section>

          <Section n="02" title={t('sections.pricing')}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL} htmlFor="cp-price">
                  {t('fields.price')} <span className="text-danger">*</span>
                </label>
                <Input
                  id="cp-price"
                  inputMode="decimal"
                  value={draft.price}
                  disabled={!canEdit}
                  invalid={problems.includes('price')}
                  onChange={(e) => set('price', e.target.value)}
                  placeholder={t('fields.pricePlaceholder')}
                  className={`${INPUT} font-mono`}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="cp-currency">
                  {t('fields.currency')}
                </label>
                <Select
                  id="cp-currency"
                  value={draft.currencyCode}
                  disabled={!canEdit}
                  invalid={problems.includes('currencyCode')}
                  onChange={(e) => set('currencyCode', e.target.value)}
                  className="h-auto py-2 text-[12.5px]"
                >
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.symbol ? `${c.symbol} ` : ''}
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <p className={HINT}>{t('fields.priceHint')}</p>
            <div>
              <label className={LABEL} htmlFor="cp-credits">
                {t('fields.credits')} <span className="text-danger">*</span>
              </label>
              <Input
                id="cp-credits"
                inputMode="numeric"
                value={draft.credits}
                disabled={!canEdit}
                invalid={problems.includes('credits')}
                onChange={(e) => set('credits', e.target.value)}
                placeholder={t('fields.creditsPlaceholder')}
                className={`${INPUT} font-mono`}
              />
              <p className={HINT}>{t('fields.creditsHint')}</p>
            </div>
          </Section>

          <Section n="03" title={t('sections.display')}>
            <div>
              <label className={LABEL} htmlFor="cp-badge">
                {t('fields.badge')}
              </label>
              <Input
                id="cp-badge"
                value={draft.badge}
                maxLength={32}
                disabled={!canEdit}
                invalid={problems.includes('badge')}
                onChange={(e) => set('badge', e.target.value)}
                placeholder={t('fields.badgePlaceholder')}
                className={INPUT}
              />
              <p className={HINT}>{t('fields.badgeHint')}</p>
            </div>
            <div>
              <label className={LABEL} htmlFor="cp-sort">
                {t('fields.sortOrder')}
              </label>
              <Input
                id="cp-sort"
                inputMode="numeric"
                value={draft.sortOrder}
                disabled={!canEdit}
                invalid={problems.includes('sortOrder')}
                onChange={(e) => set('sortOrder', e.target.value)}
                className={`${INPUT} font-mono`}
              />
              <p className={HINT}>{t('fields.sortOrderHint')}</p>
            </div>
            <SwitchRow
              title={t('fields.activeTitle')}
              hint={t('fields.activeHint')}
              checked={draft.isActive}
              onChange={(v) => set('isActive', v)}
              disabled={!canEdit}
            />
            <SwitchRow
              title={t('fields.featuredTitle')}
              hint={t('fields.featuredHint')}
              checked={draft.isFeatured}
              onChange={(v) => set('isFeatured', v)}
              disabled={!canEdit}
            />
          </Section>
        </div>

        <div className="flex justify-end gap-2">
          <Link
            href={BASE}
            className="inline-flex h-9 items-center rounded-full border border-border px-4 text-[12.5px] font-medium hover:bg-muted"
          >
            {t('cancel')}
          </Link>
          {submitButton}
        </div>
      </form>
    </div>
  );
}
