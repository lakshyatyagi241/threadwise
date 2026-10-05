'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreditPackage } from '@crm/contracts';
import { Badge, Button, Card, ConfirmDialog, EmptyState } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../../api';
import { errorKind } from '../../lib/errors';
import { formatMinor } from '../../lib/money';
import { ErrorState, LoadingBlock } from '../state';
import { Breadcrumb, ReadOnlyBanner, useCanWrite } from './admin-parts';

/** "Credit packages": the optional pay-this-get-this-much-wallet offers an operator curates. */
export function PackagesPage() {
  const t = useTranslations('wallet-message-billing.admin.packages');
  const tb = useTranslations('wallet-message-billing.admin');
  const canWrite = useCanWrite();
  const q = useQuery({
    queryKey: KEYS.packages,
    queryFn: ({ signal }) => operatorApi.packages(signal),
    refetchOnWindowFocus: false,
  });
  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: tb('wallet'), href: '/admin/wallet' }, { label: t('crumb') }]} />
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          canWrite ? (
            <Link
              href="/admin/wallet/packages/new"
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {t('new')}
            </Link>
          ) : undefined
        }
      />
      {!canWrite && <ReadOnlyBanner />}
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <PackageTable rows={q.data.data} canWrite={canWrite} />
      )}
    </div>
  );
}

export function PackageTable({
  rows,
  canWrite,
}: {
  rows: readonly CreditPackage[];
  canWrite: boolean;
}) {
  const t = useTranslations('wallet-message-billing.admin.packages');
  const tc = useTranslations('wallet-message-billing.admin.packages.columns');
  const te = useTranslations('wallet-message-billing.errors');
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState<CreditPackage | null>(null);

  const toggle = useMutation({
    mutationFn: (p: CreditPackage) => operatorApi.togglePackage(p.id),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: KEYS.packages });
      toast.success(t(p.isActive ? 'enabled' : 'disabled', { name: p.name }));
    },
    onError: (err) => toast.error(te(errorKind(err))),
  });
  const remove = useMutation({
    mutationFn: (p: CreditPackage) => operatorApi.deletePackage(p.id),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: KEYS.packages });
      toast.success(t('deleted'));
    },
    onError: (err) => {
      setDeleting(null);
      toast.error(te(errorKind(err)));
    },
  });

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title={t('empty.title')}
          message={t(canWrite ? 'empty.bodyWrite' : 'empty.body')}
        />
      </Card>
    );
  }
  return (
    <Card className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm" aria-label={tc('label')}>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {tc('name')}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {tc('slug')}
              </th>
              <th scope="col" className="px-2 py-2 text-end font-medium">
                {tc('price')}
              </th>
              <th scope="col" className="px-2 py-2 text-end font-medium">
                {tc('credit')}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {tc('badge')}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {tc('status')}
              </th>
              {canWrite && (
                <th scope="col" className="px-2 py-2 text-end font-medium">
                  {tc('actions')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-border align-top last:border-0">
                <td className="px-2 py-2">
                  <div className="font-medium">{p.name}</div>
                  {p.description && (
                    <div className="mt-0.5 max-w-xs text-xs text-muted-foreground">
                      {p.description}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{p.slug}</td>
                <td className="whitespace-nowrap px-2 py-2 text-end tabular-nums">
                  {formatMinor(p.priceMinor, p.currency, locale)}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-end tabular-nums">
                  {formatMinor(p.walletCreditMinor, p.currency, locale)}
                  {p.bonusPercent > 0 && (
                    <div className="text-xs text-success">
                      {t('bonus', { percent: p.bonusPercent })}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2">
                  {p.badge ? (
                    <Badge>{p.badge}</Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={p.isActive ? 'success' : 'neutral'}>
                      {t(p.isActive ? 'status.active' : 'status.inactive')}
                    </Badge>
                    {p.isFeatured && <Badge tone="warning">{t('status.featured')}</Badge>}
                  </div>
                </td>
                {canWrite && (
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Link
                        href={`/admin/wallet/packages/${p.id}`}
                        aria-label={`${t('edit')}: ${p.name}`}
                        className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium hover:bg-muted"
                      >
                        {t('edit')}
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={toggle.isPending}
                        aria-label={`${t(p.isActive ? 'disable' : 'enable')}: ${p.name}`}
                        onClick={() => toggle.mutate(p)}
                      >
                        {t(p.isActive ? 'disable' : 'enable')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${t('delete')}: ${p.name}`}
                        onClick={() => setDeleting(p)}
                      >
                        {t('delete')}
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title={t('deleteTitle')}
        message={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </Card>
  );
}
