'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdjustWalletResult, PlatformWalletDetail } from '@crm/contracts';
import { Badge, Button, Card, EmptyState, cn } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../../api';
import { TONE_CLASS, directionTone, formatMinor, formatMovement } from '../../lib/money';
import { formatWhen } from '../customer/activity-table';
import { TypePill } from '../customer/type-pill';
import { ErrorState, LoadingBlock } from '../state';
import { Breadcrumb, ReadOnlyBanner, useCanWrite } from './admin-parts';
import { AdjustDialog, resultMessageKey } from './adjust-dialog';
import { BillingCurrencyCard } from './billing-currency-card';
import { WorkspacePricing } from './workspace-pricing';

/** One workspace's wallet: balance, mode, recent entries with who made them, and the manual adjustment. */
export function WorkspaceDetailPage({ id }: { id: string }) {
  const t = useTranslations('wallet-message-billing.admin.detail');
  const tb = useTranslations('wallet-message-billing.admin');
  const canWrite = useCanWrite();
  const q = useQuery({
    queryKey: KEYS.workspace(id),
    queryFn: ({ signal }) => operatorApi.workspace(id, signal),
  });
  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: tb('workspacesLabel'), href: '/admin/workspaces' },
          { label: q.data?.workspace.name ?? t('crumb') },
        ]}
      />
      {!canWrite && <ReadOnlyBanner />}
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DetailBody d={q.data} canWrite={canWrite} />
      )}
    </div>
  );
}

export function DetailBody({ d, canWrite }: { d: PlatformWalletDetail; canWrite: boolean }) {
  const t = useTranslations('wallet-message-billing.admin.detail');
  const tm = useTranslations('wallet-message-billing.modes');
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const done = (r: AdjustWalletResult) => {
    setOpen(false);
    const money = (m: number) => formatMinor(m, d.currency, locale);
    const key = resultMessageKey(r);
    const text = t(`result.${key}`, {
      applied: money(r.appliedMinor),
      requested: money(r.requestedMinor),
      balance: money(r.balanceAfterMinor),
    });
    if (key === 'partial') toast.error(text);
    else toast.success(r.replayed ? `${text} ${t('result.replayed')}` : text);
    void qc.invalidateQueries({ queryKey: KEYS.workspace(d.workspace.id) });
    void qc.invalidateQueries({ queryKey: KEYS.workspaces });
    void qc.invalidateQueries({ queryKey: KEYS.overview });
  };

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{d.workspace.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">{d.workspace.slug}</p>
        </div>
        {canWrite && <Button onClick={() => setOpen(true)}>{t('adjust')}</Button>}
      </header>
      <Card className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">{t('balance')}</div>
        <div className="text-4xl font-semibold tabular-nums">
          {formatMinor(d.balanceMinor, d.currency, locale)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{tm(d.billingMode)}</Badge>
          {d.lowBalance && <Badge tone="warning">{t('lowBalance')}</Badge>}
          <span className="text-xs text-muted-foreground">
            {t('threshold', {
              amount: formatMinor(d.lowBalanceThresholdMinor, d.currency, locale),
            })}
          </span>
        </div>
      </Card>
      <BillingCurrencyCard d={d} canWrite={canWrite} />
      <WorkspacePricing workspaceId={d.workspace.id} canWrite={canWrite} />
      <Card className="space-y-3">
        <h2 className="text-base font-semibold">{t('recent')}</h2>
        {d.recent.length === 0 ? (
          <EmptyState title={t('emptyTitle')} message={t('emptyBody')} />
        ) : (
          <RecentTable d={d} />
        )}
      </Card>
      {open && (
        <AdjustDialog
          workspaceId={d.workspace.id}
          workspaceName={d.workspace.name}
          currency={d.currency}
          balanceMinor={d.balanceMinor}
          onClose={() => setOpen(false)}
          onDone={done}
        />
      )}
    </>
  );
}

export function RecentTable({ d }: { d: PlatformWalletDetail }) {
  const t = useTranslations('wallet-message-billing.admin.detail.columns');
  const locale = useLocale();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm" aria-label={t('label')}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('date')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('type')}
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('amount')}
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('balanceAfter')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('who')}
            </th>
          </tr>
        </thead>
        <tbody>
          {d.recent.map((r) => (
            <tr key={r.id} className="border-b border-border align-top last:border-0">
              <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                {formatWhen(r.createdAt, locale)}
              </td>
              <td className="px-2 py-2">
                <TypePill type={r.type} />
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-2 py-2 text-end font-medium tabular-nums',
                  TONE_CLASS[directionTone(r.direction)],
                )}
              >
                {formatMovement(r.amountMinor, r.direction, d.currency, locale)}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-end tabular-nums">
                {formatMinor(r.balanceAfterMinor, d.currency, locale)}
              </td>
              <td className="px-2 py-2">
                <div>
                  {r.actorLabel ??
                    t(
                      r.actorType === 'user'
                        ? 'customer'
                        : r.actorType === 'platform_operator'
                          ? 'operator'
                          : 'system',
                    )}
                </div>
                {r.note && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t('reason')}: {r.note}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
