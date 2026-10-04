'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Spinner, StatTile } from '@crm/ui';
import type { BspDashboard } from '@crm/contracts';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock } from '@/features/auth-registration-security/platform/ui/state';
import { KEYS, operatorApi } from '../api';
import { formatMoney, formatRange } from '../lib/format';

const COLUMNS = ['workspace', 'messages', 'revenue', 'metaCost', 'margin', 'wallet'] as const;

/** The reseller's income page: this month's revenue, Meta cost and margin, and the same per workspace. */
const walletRulesLink = (chunks: ReactNode) => (
  <Link href="/admin/wallet/pricing" className="font-medium text-primary hover:underline">
    {chunks}
  </Link>
);

export function DashboardPage() {
  const t = useTranslations('bsp-billing-engine.dashboard');
  const tc = useTranslations('bsp-billing-engine.common');
  const locale = useLocale();
  const [now] = useState(() => Date.now());
  const q = useQuery({
    queryKey: KEYS.dashboard(undefined),
    queryFn: ({ signal }) => operatorApi.dashboard(undefined, signal),
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          q.data
            ? `${t('eyebrow')} · ${formatRange(
                q.data.from,
                new Date(Math.min(Date.parse(q.data.to), now)).toISOString(), // Reference shows the current month up to today
                locale,
              )}`
            : t('eyebrow')
        }
        title={t('title')}
        description={t.rich('intro', { link: walletRulesLink })}
        actions={
          <div className="flex gap-2">
            <Button size="sm" aria-current="page">
              {t('linkPnl')}
            </Button>
            <Link href="/admin/wallet/pricing">
              <Button variant="secondary" size="sm">
                {t('linkRates')}
              </Button>
            </Link>
            <Link href="/admin/bsp/credit">
              <Button variant="secondary" size="sm">
                {t('linkConnect')}
              </Button>
            </Link>
          </div>
        }
      />
      {q.isPending ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground">
          <Spinner label={tc('loading')} />
          {tc('loading')}
        </div>
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DashboardReport d={q.data} />
      )}
    </div>
  );
}

export function DashboardReport({ d }: { d: BspDashboard }) {
  const t = useTranslations('bsp-billing-engine.dashboard');
  const locale = useLocale();
  const money = (v: string) => formatMoney(v, d.currency, locale);
  const num = new Intl.NumberFormat(locale);
  const x = d.totals;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('revenue')} value={money(x.revenue)} />
        <StatTile label={t('metaCost')} value={money(x.metaCost)} />
        <StatTile label={t('margin')} value={money(x.margin)} tone="accent" />
        <StatTile label={t('walletFloat')} value={money(x.walletFloat)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:max-w-xl">
        <StatTile label={t('billed')} value={num.format(x.billedMessages)} />
        <StatTile
          label={t('unpriced')}
          value={num.format(x.unpricedMessages)}
          tone={x.unpricedMessages > 0 ? 'warning' : 'default'}
        />
      </div>
      {x.unpricedMessages > 0 && (
        <Alert tone="warning">
          {t.rich('unpricedBanner', { count: x.unpricedMessages, link: walletRulesLink })}
        </Alert>
      )}
      <Card className="space-y-3">
        <h2 className="text-base font-semibold">{t('perWorkspace')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm" aria-label={t('perWorkspace')}>
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                {COLUMNS.map((c) => (
                  <th key={c} scope="col" className="px-2 py-2 text-start font-medium">
                    {t(`columns.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.workspaces.length === 0 && (
                <tr>
                  <td
                    colSpan={COLUMNS.length}
                    className="px-2 py-8 text-center text-muted-foreground"
                  >
                    {t('empty')}
                  </td>
                </tr>
              )}
              {d.workspaces.map((w) => (
                <tr key={w.workspaceId} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 font-medium">{w.workspaceName}</td>
                  <td className="px-2 py-2 tabular-nums">{num.format(w.billedMessages)}</td>
                  <td className="px-2 py-2 tabular-nums">{money(w.revenue)}</td>
                  <td className="px-2 py-2 tabular-nums text-muted-foreground">
                    {money(w.metaCost)}
                  </td>
                  <td className="px-2 py-2 font-medium tabular-nums text-success">
                    {money(w.margin)}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{money(w.walletBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.hasMoreWorkspaces && <p className="text-xs text-muted-foreground">{t('more')}</p>}
      </Card>
    </>
  );
}
