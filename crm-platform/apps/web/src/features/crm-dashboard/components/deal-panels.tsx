'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { CrmDashboardResponse } from '@crm/contracts';
import { BarChart } from '@/features/dashboards-analytics-charts/components/charts';
import { Panel } from '@/features/dashboards-analytics-charts/components/parts';
import { bucketLabel, magnitude, moneyText } from '../lib/format';
import { links } from '../lib/query';

type Deals = NonNullable<CrmDashboardResponse['deals']>;

/**
 * The pipeline funnel: one bar per stage, as long as the number of deals created in the period that got that far, in the stage's own
 * colour, with the step-to-step conversion between rows. A row opens the deals sitting in that stage now.
 */
export function FunnelPanel({ funnel, currency }: { funnel: Deals['funnel']; currency: string }) {
  const t = useTranslations('crm-dashboard.funnel');
  const locale = useLocale();
  const top = Math.max(funnel.stages[0]?.reached ?? 0, 1);
  return (
    <Panel
      title={t('title')}
      subtitle={
        funnel.pipeline
          ? t('subtitle', { pipeline: funnel.pipeline.name, count: funnel.cohortSize })
          : undefined
      }
    >
      {funnel.pipeline === null ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('noPipeline')}</p>
      ) : funnel.cohortSize === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol className="space-y-1" aria-label={t('title')}>
          {funnel.stages.map((s, i) => (
            <li key={s.id}>
              {i > 0 && (
                <div
                  className="ps-3 text-xs text-muted-foreground tabular-nums"
                  data-testid="funnel-conversion"
                >
                  {s.conversionFromPrevious === null
                    ? t('noConversion')
                    : t('conversion', { percent: s.conversionFromPrevious })}
                </div>
              )}
              <Link
                href={links.deals({ pipeline: funnel.pipeline!.id, stage: s.id, status: 'open' })}
                aria-label={t('rowLabel', { name: s.name, reached: s.reached, open: s.openCount })}
                className="group grid grid-cols-[minmax(4.5rem,8rem)_1fr] items-center gap-3 rounded-md px-3 py-1.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="min-w-0 truncate text-sm">{s.name}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-6 min-w-0 flex-1 rounded-md bg-muted group-hover:bg-background">
                    <span
                      className="block h-full rounded-md"
                      style={{
                        width: `${Math.max((s.reached / top) * 100, s.reached > 0 ? 2 : 0)}%`,
                        backgroundColor: s.color,
                      }}
                    />
                  </span>
                  <span className="w-28 shrink-0 text-end text-xs tabular-nums">
                    <span className="font-semibold">{s.reached}</span>
                    <span className="ms-1 text-muted-foreground">
                      {magnitude(s.reachedValue) > 0
                        ? moneyText(s.reachedValue, locale, currency, { compact: true })
                        : ''}
                    </span>
                  </span>
                </span>
                <span className="col-start-2 -mt-1 ps-0 text-xs text-muted-foreground tabular-nums">
                  {t('openNow', {
                    count: s.openCount,
                    value: moneyText(s.openValue, locale, currency, { compact: true }),
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** Deals won against deals lost over the period, per day, week or month (whichever keeps the chart readable). */
export function TrendPanel({
  trend,
  wonValue,
  currency,
}: {
  trend: Deals['trend'];
  wonValue: Deals['won']['value'];
  currency: string;
}) {
  const t = useTranslations('crm-dashboard.trend');
  const locale = useLocale();
  const labels = trend.points.map((p) => bucketLabel(p.start, trend.bucket, locale));
  const won = trend.points.map((p) => p.wonCount);
  const lost = trend.points.map((p) => p.lostCount);
  const wonTotal = won.reduce((a, b) => a + b, 0);
  const lostTotal = lost.reduce((a, b) => a + b, 0);
  return (
    <Panel
      title={t('title')}
      subtitle={t(`subtitle.${trend.bucket}`, { value: moneyText(wonValue, locale, currency) })}
    >
      <BarChart
        labels={labels}
        label={t('chartLabel')}
        series={[
          { name: t('won'), values: won, color: 'var(--success)' },
          { name: t('lost'), values: lost, color: 'var(--danger)' },
        ]}
        seriesTotals={[wonTotal, lostTotal]}
      />
    </Panel>
  );
}
