'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FINANCIAL_WINDOWS, type FinancialWindow } from '@crm/contracts';
import { Badge } from '@crm/ui';
import { BarChart, Donut } from '@/features/dashboards-analytics-charts/components/charts';
import { Panel } from '@/features/dashboards-analytics-charts/components/parts';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { fetchPremium, premiumKey } from '../api';
import { Kpi, WindowSelect, colorAt, formatCurrency } from './report-parts';

const NS = 'plans-subscriptions-trials.operator.premium';

/** The Premium dashboard (WD-PLAN-027): paid vs free workspaces, ARPU, conversion, plan mix, revenue by plan, new paid signups and every plan with its numbers. */
export function PremiumPage() {
  const t = useTranslations(NS);
  const locale = useLocale();
  const [window, setWindow] = useState<FinancialWindow>('30d');
  const q = useQuery({
    queryKey: premiumKey(window),
    queryFn: ({ signal }) => fetchPremium(window, signal),
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpis">
            <Kpi label={t('kpi.paid')} value={q.data.kpis.paidWorkspaces} testId="kpi-paid" />
            <Kpi label={t('kpi.free')} value={q.data.kpis.freeWorkspaces} testId="kpi-free" />
            <Kpi label={t('kpi.arpu')} value={money(q.data.kpis.arpu)} />
            <Kpi
              label={t('kpi.conversion')}
              value={`${q.data.kpis.conversion.value}%`}
              change={q.data.kpis.conversion.changePct}
              testId="kpi-conversion"
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title={t('distribution')}>
              <Donut
                label={t('distribution')}
                empty={t('noData')}
                slices={q.data.planDistribution.map((d, i) => ({
                  name: d.plan,
                  value: d.workspaces,
                  color: colorAt(i),
                }))}
              />
            </Panel>
            <Panel title={t('revenueByPlan')}>
              <BarChart
                label={t('revenueByPlan')}
                labels={q.data.revenueByPlan.map((r) => r.plan)}
                series={[
                  {
                    name: t('revenueByPlan'),
                    values: q.data.revenueByPlan.map((r) => Number(r.amount)),
                    color: colorAt(0),
                  },
                ]}
              />
            </Panel>
            <Panel title={t('newPaid')}>
              <BarChart
                label={t('newPaid')}
                labels={q.data.newPaidSignups.map((d) => d.date.slice(5))}
                series={[
                  {
                    name: t('newPaid'),
                    values: q.data.newPaidSignups.map((d) => d.workspaces),
                    color: colorAt(2),
                  },
                ]}
              />
            </Panel>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title={t('popular')} subtitle={t('popularHint')}>
              {q.data.popularPlans.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noPopular')}</p>
              ) : (
                <ol className="space-y-1 text-sm" data-testid="popular">
                  {q.data.popularPlans.map((p) => (
                    <li key={p.plan} className="flex justify-between gap-2">
                      <span>{p.plan}</span>
                      <span className="tabular-nums">{p.orders}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
            <Panel title={t('allPlans')} className="lg:col-span-2">
              {q.data.plans.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noPlans')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm" data-testid="plans-table">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        {(
                          [
                            'plan',
                            'price',
                            'duration',
                            'workspaces',
                            'mrr',
                            'revenue',
                            'status',
                          ] as const
                        ).map((c) => (
                          <th key={c} scope="col" className="px-2 py-2 text-start font-medium">
                            {t(`columns.${c}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.plans.map((p) => (
                        <tr key={p.slug} className="border-b border-border last:border-0">
                          <th scope="row" className="px-2 py-2 text-start font-medium">
                            {p.name}
                          </th>
                          <td className="px-2 py-2">
                            {formatCurrency(p.price, p.currency, locale)}
                          </td>
                          <td className="px-2 py-2">{p.duration}</td>
                          <td className="px-2 py-2 tabular-nums">{p.workspaces}</td>
                          <td className="px-2 py-2 tabular-nums">{money(p.mrr)}</td>
                          <td className="px-2 py-2 tabular-nums">{money(p.windowRevenue)}</td>
                          <td className="px-2 py-2">
                            <Badge tone={p.isActive ? 'success' : 'neutral'}>
                              {p.isActive ? t('active') : t('inactive')}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
