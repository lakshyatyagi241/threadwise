'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery } from '@tanstack/react-query';
import { walletMinorToMajor, type PlatformWalletOverview, type Reconciliation } from '@crm/contracts';
import { Alert, Button, Card, Spinner, StatTile } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { KEYS, operatorApi } from '../../api';
import { formatMinor } from '../../lib/money';
import { ErrorState, LoadingBlock } from '../state';
import { Breadcrumb, useCanWrite } from './admin-parts';

/** The platform's wallet float and the last 30 days of money movement, with the balance-vs-ledger check. */
export function OverviewPage() {
  const t = useTranslations('wallet-message-billing.admin.overview');
  const tb = useTranslations('wallet-message-billing.admin');
  const q = useQuery({
    queryKey: KEYS.overview,
    queryFn: ({ signal }) => operatorApi.overview(signal),
  });
  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: tb('wallet') }]} />
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Link href="/admin/wallet/workspaces">
              <Button variant="secondary" size="sm">{t('linkWorkspaces')}</Button>
            </Link>
            <Link href="/admin/wallet/pricing">
              <Button variant="secondary" size="sm">{t('linkPricing')}</Button>
            </Link>
            <Link href="/admin/wallet/logs">
              <Button variant="secondary" size="sm">{t('linkLogs')}</Button>
            </Link>
          </>
        }
      />
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <OverviewCards o={q.data} />
      )}
      <ReconcileCard />
    </div>
  );
}

export function OverviewCards({ o }: { o: PlatformWalletOverview }) {
  const t = useTranslations('wallet-message-billing.admin.overview');
  const locale = useLocale();
  const money = (m: number) => formatMinor(m, o.currency, locale);
  const num = new Intl.NumberFormat(locale);
  const l = o.last30d;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label={t('float')} value={money(o.floatMinor)} hint={t('floatHint')} tone="accent" />
        <StatTile label={t('holding')} value={num.format(o.workspacesWithBalance)} />
        <StatTile
          label={t('low')}
          value={num.format(o.lowBalanceWorkspaces)}
          tone={o.lowBalanceWorkspaces > 0 ? 'warning' : 'default'}
        />
      </div>
      <Card className="space-y-3">
        <h2 className="text-base font-semibold">{t('last30')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile label={t('toppedUp')} value={money(l.toppedUpMinor)} />
          <StatTile label={t('charged')} value={money(l.chargedMinor)} />
          <StatTile label={t('refunded')} value={money(l.refundedMinor)} />
          <StatTile label={t('adjustedIn')} value={money(l.adjustedInMinor)} />
          <StatTile label={t('adjustedOut')} value={money(l.adjustedOutMinor)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:max-w-xl">
          <StatTile label={t('chargedMessages')} value={num.format(l.chargedMessages)} />
          <StatTile label={t('freeMessages')} value={num.format(l.freeMessages)} />
        </div>
      </Card>
    </>
  );
}

function ReconcileCard() {
  const t = useTranslations('wallet-message-billing.admin.overview.reconcile');
  const canWrite = useCanWrite();
  const run = useMutation({ mutationFn: () => operatorApi.reconcile() });
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('body')}</p>
        </div>
        {canWrite && (
          <Button variant="secondary" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending && <Spinner label={t('running')} />}
            {t('button')}
          </Button>
        )}
      </div>
      <div aria-live="polite">
        {run.isError && <ErrorState error={run.error} onRetry={() => run.mutate()} />}
        {run.isSuccess && <ReconcileResult r={run.data} />}
      </div>
    </Card>
  );
}

export function ReconcileResult({ r }: { r: Reconciliation }) {
  const t = useTranslations('wallet-message-billing.admin.overview.reconcile');
  if (r.mismatches.length === 0) {
    return <Alert tone="success">{t('ok', { count: r.workspacesChecked })}</Alert>;
  }
  return (
    <div className="space-y-2">
      <Alert tone="danger">{t('mismatches', { count: r.mismatches.length, checked: r.workspacesChecked })}</Alert>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm" aria-label={t('title')}>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="px-2 py-2 text-start font-medium">{t('workspace')}</th>
              <th scope="col" className="px-2 py-2 text-end font-medium">{t('balance')}</th>
              <th scope="col" className="px-2 py-2 text-end font-medium">{t('ledger')}</th>
              <th scope="col" className="px-2 py-2 text-end font-medium">{t('difference')}</th>
            </tr>
          </thead>
          <tbody>
            {r.mismatches.map((m) => (
              <tr key={m.workspaceId} className="border-b border-border last:border-0">
                <td className="px-2 py-2">
                  <Link href={`/admin/wallet/workspaces/${m.workspaceId}`} className="font-medium text-primary hover:underline">
                    {m.workspaceName}
                  </Link>
                </td>
                <td className="px-2 py-2 text-end tabular-nums">{walletMinorToMajor(m.balanceMinor)}</td>
                <td className="px-2 py-2 text-end tabular-nums">{walletMinorToMajor(m.ledgerMinor)}</td>
                <td className="px-2 py-2 text-end font-medium tabular-nums text-danger">{walletMinorToMajor(m.differenceMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
