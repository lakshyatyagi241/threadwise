'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreditPackageItem, CreditPackageListResponse } from '@crm/contracts';
import { Alert, Card, ConfirmDialog, ToastProvider, cn, useToast } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { KEYS, creditPackageItemSchema, fetchPackages } from '../api';
import { cpnErrorKey } from '../lib/errors';
import { Accent, ErrorBlock, LoadingBlock, PageHead, PrimaryLink } from './ui';

const NS = 'coupons-credits-referral-currency.packages';
const BASE = '/admin/credit-packages';

export function CreditPackagesPage() {
  const t = useTranslations('coupons-credits-referral-currency.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <PackagesScreen />
    </ToastProvider>
  );
}

function PackagesScreen() {
  const q = useQuery({
    queryKey: KEYS.packages,
    queryFn: ({ signal }) => fetchPackages(signal),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return <Catalogue data={q.data} />;
}

function Catalogue({ data }: { data: CreditPackageListResponse }) {
  const t = useTranslations(NS);
  const te = useTranslations('coupons-credits-referral-currency.errors');
  const tc = useTranslations('coupons-credits-referral-currency.common');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const [deleting, setDeleting] = useState<CreditPackageItem | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.packages });

  // The form page redirects here with ?saved=created|updated (Reference's flash message); show it once, then clean the URL.
  const saved = useSearchParams().get('saved');
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current || (saved !== 'created' && saved !== 'updated')) return;
    shown.current = true;
    toast(t(`toasts.${saved}`));
    router.replace(BASE);
  }, [saved, toast, t, router]);

  const toggle = useMutation({
    mutationFn: (p: CreditPackageItem) =>
      operatorFetch(`${BASE.replace('/admin', '')}/${p.id}/active`, {
        method: 'PATCH',
        body: { isActive: !p.isActive, rowVersion: p.rowVersion },
        schema: creditPackageItemSchema,
      }),
    onMutate: (p) => setTogglingId(p.id),
    onSuccess: (p) => {
      toast(t(p.isActive ? 'toasts.activated' : 'toasts.deactivated'));
      return refresh();
    },
    onError: (e) => {
      toast(te(cpnErrorKey(e)), 'danger');
      void refresh();
    },
    onSettled: () => setTogglingId(null),
  });

  const remove = useMutation({
    mutationFn: (p: CreditPackageItem) =>
      operatorFetch(`${BASE.replace('/admin', '')}/${p.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast(t('toasts.deleted'));
      setDeleting(null);
      await refresh();
    },
  });

  const nf = new Intl.NumberFormat(locale);
  const head = 'px-2 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em]';

  return (
    <div className="space-y-5">
      <PageHead
        crumbs={[{ label: tc('admin'), href: '/admin' }, { label: t('crumbHere') }]}
        eyebrow={t('eyebrow')}
        title={
          <>
            {t('titleLead')} <Accent>{t('titleAccent')}</Accent>
          </>
        }
        description={
          <>
            {t('descriptionBefore')}
            <Link href="/admin/settings" className="font-semibold text-primary hover:underline">
              {t('descriptionLink')}
            </Link>
            {t('descriptionAfter')}
          </>
        }
        actions={canEdit && <PrimaryLink href={`${BASE}/new`}>{t('new')}</PrimaryLink>}
      />
      {!canEdit && <Alert tone="info">{tc('readOnly')}</Alert>}

      <Card className="overflow-hidden rounded-2xl p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <caption className="sr-only">{t('table.label')}</caption>
            <thead className="border-b border-border bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className={cn(head, 'px-4 text-start')}>
                  {t('table.name')}
                </th>
                <th scope="col" className={cn(head, 'text-start')}>
                  {t('table.slug')}
                </th>
                <th scope="col" className={cn(head, 'text-end')}>
                  {t('table.price')}
                </th>
                <th scope="col" className={cn(head, 'text-end')}>
                  {t('table.credits')}
                </th>
                <th scope="col" className={cn(head, 'text-end')}>
                  {t('table.perSymbol', { symbol: data.defaultSymbol })}
                </th>
                <th scope="col" className={cn(head, 'text-start')}>
                  {t('table.badge')}
                </th>
                <th scope="col" className={cn(head, 'text-start')}>
                  {t('table.status')}
                </th>
                <th scope="col" className={cn(head, 'w-[200px] px-4 text-end')}>
                  {t('table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.data.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    <div className="font-serif text-xl">{t('empty.title')}</div>
                    <p className="mt-1 text-[12.5px]">
                      {t('empty.hintBefore')}{' '}
                      <span className="font-mono">{t('empty.hintCode')}</span>{' '}
                      {t('empty.hintAfter')}
                    </p>
                  </td>
                </tr>
              )}
              {data.data.map((p) => (
                <tr key={p.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{p.name}</div>
                    {p.description && (
                      <div className="mt-0.5 max-w-md truncate text-[10.5px] text-muted-foreground">
                        {p.description}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-3 font-mono text-[11.5px]">{p.slug}</td>
                  <td className="px-2 py-3 text-end font-semibold" dir="ltr">
                    {p.priceDisplay}
                  </td>
                  <td className="px-2 py-3 text-end font-mono" dir="ltr">
                    {nf.format(p.credits)}
                  </td>
                  <td className="px-2 py-3 text-end font-mono" dir="ltr">
                    {p.creditsPerMajor}
                  </td>
                  <td className="px-2 py-3">
                    {p.badge ? (
                      <span className="rounded bg-warning/20 px-2 py-0.5 font-mono text-[10.5px] text-warning">
                        {p.badge}
                      </span>
                    ) : (
                      <span className="text-[10.5px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 font-mono text-[10.5px]',
                        p.isActive ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          p.isActive ? 'bg-primary' : 'bg-border',
                        )}
                      />
                      {p.isActive ? t('status.active') : t('status.disabled')}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-end">
                    {canEdit && (
                      <>
                        <Link
                          href={`${BASE}/${p.id}/edit`}
                          className="text-[11px] font-semibold text-primary hover:underline"
                        >
                          {t('actions.edit')}
                        </Link>
                        <button
                          type="button"
                          disabled={togglingId === p.id}
                          onClick={() => toggle.mutate(p)}
                          className="ms-2 text-[11px] hover:underline disabled:opacity-50"
                        >
                          {p.isActive ? t('actions.disable') : t('actions.enable')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            remove.reset();
                            setDeleting(p);
                          }}
                          className="ms-2 text-[11px] text-danger hover:underline"
                        >
                          {t('actions.delete')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {deleting && (
        <ConfirmDialog
          open
          tone="danger"
          busy={remove.isPending}
          title={t('delete.title')}
          message={
            <div className="space-y-3">
              <p>{t('delete.body')}</p>
              {remove.isError && <Alert tone="danger">{te(cpnErrorKey(remove.error))}</Alert>}
            </div>
          }
          confirmLabel={t('delete.confirm')}
          cancelLabel={tc('cancel')}
          onConfirm={() => remove.mutate(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
