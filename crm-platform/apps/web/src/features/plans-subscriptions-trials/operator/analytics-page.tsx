'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@crm/ui';
import { BarChart, Donut, Legend } from '@/features/dashboards-analytics-charts/components/charts';
import { Panel } from '@/features/dashboards-analytics-charts/components/parts';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { analyticsExportUrl, analyticsKey, fetchPlanAnalytics } from '../api';
import { Kpi, WindowSelect, colorAt, formatCurrency } from './report-parts';

const NS = 'plans-subscriptions-trials.operator.analytics';

/** Package analytics (WD-PLAN-024/025): KPIs, MRR by plan, plan share, leaderboard, upgrade paths and feature adoption, with a CSV export. */
export function AnalyticsPage() {
  const t = useTranslations(NS);
  const locale = useLocale();
  const [days, setDays] = useState<30 | 90 | 365>(90);
  const [pkg, setPkg] = useState('');
  const q = useQuery({
    queryKey: analyticsKey(days, pkg),
    queryFn: ({ signal }) => fetchPlanAnalytics(days, pkg, signal),
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <WindowSelect
              label={t('window')}
              value={days}
              onChange={setDays}
              options={[
                { value: 30, label: t('days30') },
                { value: 90, label: t('days90') },
                { value: 365, label: t('days365') },
              ]}
            />
            <a
              href={analyticsExportUrl(days, pkg)}
              className="inline-flex h-9 items-center rounded-md bg-success px-3 text-sm font-medium text-success-foreground hover:opacity-90"
            >
              {t('export')}
            </a>
          </>
        }
      />
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <label className="flex max-w-xs items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('package')}</span>
            <select
              className="h-9 flex-1 rounded-md border border-border bg-background px-2"
              value={pkg}
              onChange={(e) => setPkg(e.target.value)}
            >
              <option value="">{t('allPackages')}</option>
              {q.data.leaderboard.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="kpis">
            <Kpi
              label={t('kpi.mrr')}
              value={formatCurrency(q.data.kpis.mrr, q.data.currency, locale)}
            />
            <Kpi
              label={t('kpi.subscribers')}
              value={q.data.kpis.subscribers}
              sub={t('kpi.netNew', { count: q.data.kpis.netNew })}
            />
            <Kpi
              label={t('kpi.arpa')}
              value={formatCurrency(q.data.kpis.arpa, q.data.currency, locale)}
            />
            <Kpi
              label={t('kpi.ltv')}
              value={formatCurrency(q.data.kpis.ltv, q.data.currency, locale)}
              sub={t('kpi.ltvHint')}
            />
            <Kpi
              label={t('kpi.churn')}
              value={`${q.data.kpis.churnPct}%`}
              sub={t('kpi.cancelled', { count: q.data.kpis.cancellations })}
            />
            <Kpi
              label={t('kpi.trialToPaid')}
              value={`${q.data.kpis.trialToPaidPct}%`}
              sub={t('kpi.ofTrials', { count: q.data.kpis.trials })}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t('mrrByPackage')} subtitle={q.data.currency}>
              <BarChart
                stacked
                label={t('mrrByPackage')}
                labels={q.data.mrrTrend.labels}
                series={q.data.mrrTrend.series.map((s, i) => ({
                  name: s.plan,
                  values: s.values,
                  color: colorAt(i),
                }))}
              />
              <Legend
                series={q.data.mrrTrend.series.map((s, i) => ({ name: s.plan, color: colorAt(i) }))}
              />
            </Panel>
            <Panel title={t('planShare')}>
              <Donut
                label={t('planShare')}
                empty={t('empty')}
                slices={q.data.planShare.map((s, i) => ({
                  name: s.plan,
                  value: s.subscribers,
                  color: colorAt(i),
                }))}
              />
            </Panel>
          </div>
          <Panel title={t('leaderboard')}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm" data-testid="leaderboard">
                <thead>
                  <tr className="border-b border-border text-start text-muted-foreground">
                    {(
                      [
                        'plan',
                        'price',
                        'subscribers',
                        'mrr',
                        'arpa',
                        'ltv',
                        'netNew',
                        'cancellations',
                        'churn',
                      ] as const
                    ).map((c) => (
                      <th key={c} scope="col" className="px-2 py-2 text-start font-medium">
                        {t(`columns.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.data.leaderboard.map((r) => (
                    <tr key={r.slug} className="border-b border-border last:border-0">
                      <th scope="row" className="px-2 py-2 text-start font-medium">
                        {r.name}
                      </th>
                      <td className="px-2 py-2">{formatCurrency(r.price, r.currency, locale)}</td>
                      <td className="px-2 py-2 tabular-nums">{r.subscribers}</td>
                      <td className="px-2 py-2 tabular-nums">
                        {formatCurrency(r.mrr, q.data.currency, locale)}
                      </td>
                      <td className="px-2 py-2 tabular-nums">
                        {formatCurrency(r.arpa, q.data.currency, locale)}
                      </td>
                      <td className="px-2 py-2 tabular-nums">
                        {formatCurrency(r.ltv, q.data.currency, locale)}
                      </td>
                      <td className="px-2 py-2 tabular-nums">{r.netNew}</td>
                      <td className="px-2 py-2 tabular-nums">{r.cancellations}</td>
                      <td className="px-2 py-2 tabular-nums">{r.churnPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title={t('upgradePaths')}>
              {q.data.upgradePaths.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {q.data.upgradePaths.map((p, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>
                        {p.from} → {p.to}{' '}
                        <span className="text-xs text-muted-foreground">{t(`kind.${p.kind}`)}</span>
                      </span>
                      <span className="tabular-nums">{p.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title={t('cancellationReasons')}>
              <p className="text-sm text-muted-foreground">
                {q.data.cancellationReasons.length === 0 ? t('noReasons') : ''}
              </p>
            </Panel>
            <Panel title={t('featureAdoption')}>
              {q.data.featureAdoption.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {q.data.featureAdoption.map((f) => (
                    <li key={f.feature} className="flex justify-between gap-2">
                      <span>{f.feature}</span>
                      <span className="tabular-nums">{f.pct}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          <Card className="p-3 text-xs text-muted-foreground">
            {t('footnote', { currency: q.data.currency })}
          </Card>
        </>
      )}
    </div>
  );
}
