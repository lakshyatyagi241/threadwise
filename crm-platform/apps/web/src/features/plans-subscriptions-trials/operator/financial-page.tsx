'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FINANCIAL_WINDOWS, type FinancialWindow } from '@crm/contracts';
import { BarChart, Donut } from '@/features/dashboards-analytics-charts/components/charts';
import { Panel } from '@/features/dashboards-analytics-charts/components/parts';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { fetchFinancial, financialKey } from '../api';
import { Kpi, WindowSelect, colorAt, formatCurrency } from './report-parts';

const NS = 'plans-subscriptions-trials.operator.financial';

/** The Financial dashboard (TW-PLAN-026): revenue with a change chip against the previous window, MRR, ARR, refunds, outstanding, charts, top payers and the latest orders. */
export function FinancialPage() {
  const t = useTranslations(NS);
  const locale = useLocale();
  const [window, setWindow] = useState<FinancialWindow>('30d');
  const q = useQuery({
    queryKey: financialKey(window),
    queryFn: ({ signal }) => fetchFinancial(window, signal),
    refetchOnWindowFocus: false,
  });
  const money = (v: string | number) => formatCurrency(v, q.data?.currency ?? 'USD', locale);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <WindowSelect
            label={t('window')}
            value={window}
            onChange={setWindow}
            options={FINANCIAL_WINDOWS.map((w) => ({ value: w, label: t(`windows.${w}`) }))}
          />
        }
      />
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="kpis">
            <Kpi
              label={t('kpi.revenue')}
              value={money(q.data.kpis.revenue.value)}
              change={q.data.kpis.revenue.changePct}
              testId="kpi-revenue"
            />
            <Kpi label={t('kpi.mrr')} value={money(q.data.kpis.mrr)} sub={t('kpi.active')} />
            <Kpi label={t('kpi.arr')} value={money(q.data.kpis.arr)} sub={t('kpi.projected')} />
            <Kpi label={t('kpi.refunds')} value={money(q.data.kpis.refunds)} />
            <Kpi label={t('kpi.outstanding')} value={money(q.data.kpis.outstanding)} />
          </div>
          <Panel title={t('revenue')} subtitle={`${q.data.from} - ${q.data.to}`}>
            <BarChart
              label={t('revenue')}
              labels={q.data.revenueByDay.map((d) => d.date.slice(5))}
              series={[
                {
                  name: t('kpi.revenue'),
                  values: q.data.revenueByDay.map((d) => d.revenue),
                  color: colorAt(2),
                },
                {
                  name: t('kpi.refunds'),
                  values: q.data.revenueByDay.map((d) => d.refunds),
                  color: colorAt(4),
                },
              ]}
            />
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t('paymentMethods')}>
              <Donut
                label={t('paymentMethods')}
                empty={t('noData')}
                slices={q.data.paymentMethods.map((m, i) => ({
                  name: m.gateway,
                  value: Number(m.amount),
                  color: colorAt(i),
                }))}
              />
            </Panel>
            <Panel title={t('orderStatus')}>
              <Donut
                label={t('orderStatus')}
                empty={t('noData')}
                slices={q.data.orderStatus.map((s, i) => ({
                  name: s.status,
                  value: s.count,
                  color: colorAt(i),
                }))}
              />
            </Panel>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t('topWorkspaces')}>
              {q.data.topWorkspaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noPaidOrders')}</p>
              ) : (
                <ul className="space-y-1 text-sm" data-testid="top-workspaces">
                  {q.data.topWorkspaces.map((w) => (
                    <li key={w.slug || w.name} className="flex justify-between gap-2">
                      <span>{w.name}</span>
                      <span className="tabular-nums">{money(w.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title={t('recentOrders')}>
              {q.data.recentOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noData')}</p>
              ) : (
                <ul className="space-y-1 text-sm" data-testid="recent-orders">
                  {q.data.recentOrders.map((o) => (
                    <li key={o.orderNumber} className="flex justify-between gap-2">
                      <span>
                        {o.orderNumber} · {o.workspace} · {o.item}
                      </span>
                      <span className="tabular-nums">
                        {money(o.amount)}{' '}
                        <span className="text-xs text-muted-foreground">{o.status}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
