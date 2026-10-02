'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreditPackage } from '@crm/contracts';
import { Alert, Button, Card, Checkbox, Field, Input, Select, Spinner, Textarea } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../../api';
import { errorKind } from '../../lib/errors';
import { formatMinor, parseAmount } from '../../lib/money';
import {
  bonusOf,
  checkPackage,
  emptyPackageDraft,
  packageSubmitError,
  toPackageDraft,
  type PackageDraft,
  type PackageField,
  type PackageProblems,
} from '../../lib/package-form';
import { ErrorState, LoadingBlock, PermissionDenied } from '../state';
import { Breadcrumb, useCanWrite } from './admin-parts';

/** New package (no id) or edit one (its id): reads the list, so the currencies and the stored row come from the same call. */
export function PackageFormPage({ id }: { id?: string }) {
  const t = useTranslations('wallet-message-billing.admin.packages');
  const tb = useTranslations('wallet-message-billing.admin');
  const canWrite = useCanWrite();
  const q = useQuery({
    queryKey: KEYS.packages,
    queryFn: ({ signal }) => operatorApi.packages(signal),
    refetchOnWindowFocus: false,
  });
  const existing = id ? q.data?.data.find((p) => p.id === id) : undefined;
  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: tb('wallet'), href: '/admin/wallet' },
          { label: t('crumb'), href: '/admin/wallet/packages' },
          { label: id ? t('form.editCrumb') : t('form.newCrumb') },
        ]}
      />
      <PageHeader title={id ? t('form.editTitle') : t('form.newTitle')} />
      {!canWrite ? (
        <PermissionDenied permission="super_admin" />
      ) : q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : id && !existing ? (
        <Alert tone="warning" className="space-y-2">
          <p>{t('form.notFound')}</p>
          <Link href="/admin/wallet/packages" className="font-medium underline">
            {t('form.back')}
          </Link>
        </Alert>
      ) : (
        <PackageForm
          // A reload after a stale save remounts the form on the fresh row.
          key={existing ? `${existing.id}:${existing.rowVersion}` : 'new'}
          existing={existing}
          currencies={q.data.currencies}
          onReload={() => void q.refetch()}
          reloading={q.isFetching}
        />
      )}
    </div>
  );
}

export function PackageForm({
  existing,
  currencies,
  onReload,
  reloading,
}: {
  existing: CreditPackage | undefined;
  currencies: readonly string[];
  onReload: () => void;
  reloading: boolean;
}) {
  const t = useTranslations('wallet-message-billing.admin.packages.form');
  const tp = useTranslations('wallet-message-billing.admin.packages');
  const te = useTranslations('wallet-message-billing.errors');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<PackageDraft>(() =>
    existing ? toPackageDraft(existing) : emptyPackageDraft(currencies[0] ?? 'USD'),
  );
  const [problems, setProblems] = useState<PackageProblems>({});
  const [stale, setStale] = useState(false);

  const set = <K extends keyof PackageDraft>(key: K, value: PackageDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key in problems) setProblems((p) => ({ ...p, [key]: undefined }));
  };

  const save = useMutation({
    mutationFn: (input: Parameters<typeof operatorApi.createPackage>[0]) =>
      existing ? operatorApi.updatePackage(existing.id, input) : operatorApi.createPackage(input),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: KEYS.packages });
      toast.success(tp(existing ? 'form.saved' : 'form.created', { name: p.name }));
      router.push('/admin/wallet/packages');
    },
    onError: (err) => {
      const kind = packageSubmitError(err);
      if (kind.kind === 'stale') setStale(true);
      else if (kind.kind === 'fields') setProblems(kind.problems);
      else toast.error(te(errorKind(err)));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const checked = checkPackage(draft, currencies, existing?.rowVersion);
    if (!checked.ok) {
      setProblems(checked.problems);
      return;
    }
    setProblems({});
    setStale(false);
    save.mutate(checked.input);
  };

  const err = (f: PackageField) => (problems[f] ? t(`problems.${f}`) : undefined);
  const priceMinor = parseAmount(draft.price);
  const creditMinor = parseAmount(draft.walletCredit);
  const bonus = priceMinor !== null && creditMinor !== null ? bonusOf(priceMinor, creditMinor) : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {stale && (
        <Alert tone="warning" className="space-y-2" role="alert">
          <p className="font-medium">{t('stale.title')}</p>
          <p>{t('stale.body')}</p>
          <Button type="button" variant="secondary" size="sm" onClick={onReload} disabled={reloading}>
            {t('stale.reload')}
          </Button>
        </Alert>
      )}

      <Card className="space-y-4">
        <h2 className="text-base font-semibold">{t('sections.identity')}</h2>
        <Field label={t('name')} htmlFor="pkg-name" error={err('name')}>
          <Input
            id="pkg-name"
            value={draft.name}
            maxLength={96}
            invalid={Boolean(problems.name)}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        <Field label={t('slug')} htmlFor="pkg-slug" hint={t('slugHint')} error={err('slug')}>
          <Input
            id="pkg-slug"
            value={draft.slug}
            maxLength={96}
            autoComplete="off"
            invalid={Boolean(problems.slug)}
            onChange={(e) => set('slug', e.target.value)}
          />
        </Field>
        <Field label={t('description')} htmlFor="pkg-description" error={err('description')}>
          <Textarea
            id="pkg-description"
            rows={3}
            maxLength={500}
            value={draft.description}
            invalid={Boolean(problems.description)}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-base font-semibold">{t('sections.pricing')}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('price')} htmlFor="pkg-price" hint={t('priceHint')} error={err('price')}>
            <Input
              id="pkg-price"
              inputMode="decimal"
              autoComplete="off"
              value={draft.price}
              invalid={Boolean(problems.price)}
              onChange={(e) => set('price', e.target.value)}
            />
          </Field>
          <Field label={t('currency')} htmlFor="pkg-currency" error={err('currency')}>
            <Select
              id="pkg-currency"
              value={draft.currency}
              invalid={Boolean(problems.currency)}
              onChange={(e) => set('currency', e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('walletCredit')}
            htmlFor="pkg-credit"
            hint={t('walletCreditHint')}
            error={err('walletCredit')}
          >
            <Input
              id="pkg-credit"
              inputMode="decimal"
              autoComplete="off"
              value={draft.walletCredit}
              invalid={Boolean(problems.walletCredit)}
              onChange={(e) => set('walletCredit', e.target.value)}
            />
          </Field>
        </div>
        {bonus !== null && priceMinor !== null && creditMinor !== null && (
          <p className="text-sm text-success" aria-live="polite">
            {t('bonusLine', {
              percent: bonus,
              credit: formatMinor(creditMinor, draft.currency, locale),
              price: formatMinor(priceMinor, draft.currency, locale),
            })}
          </p>
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-base font-semibold">{t('sections.display')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('badge')} htmlFor="pkg-badge" hint={t('badgeHint')} error={err('badge')}>
            <Input
              id="pkg-badge"
              value={draft.badge}
              maxLength={32}
              invalid={Boolean(problems.badge)}
              onChange={(e) => set('badge', e.target.value)}
            />
          </Field>
          <Field
            label={t('sortOrder')}
            htmlFor="pkg-sort"
            hint={t('sortOrderHint')}
            error={err('sortOrder')}
          >
            <Input
              id="pkg-sort"
              inputMode="numeric"
              autoComplete="off"
              value={draft.sortOrder}
              invalid={Boolean(problems.sortOrder)}
              onChange={(e) => set('sortOrder', e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Checkbox
            id="pkg-active"
            label={t('active')}
            checked={draft.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />
          <Checkbox
            id="pkg-featured"
            label={t('featured')}
            checked={draft.isFeatured}
            onChange={(e) => set('isFeatured', e.target.checked)}
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner label={t('saving')} />}
          {existing ? t('save') : t('create')}
        </Button>
        <Link
          href="/admin/wallet/packages"
          className="inline-flex h-10 items-center rounded-md px-4 text-sm font-medium hover:bg-muted"
        >
          {tp('cancel')}
        </Link>
      </div>
    </form>
  );
}
