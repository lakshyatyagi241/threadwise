'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { RevenueReportResponse } from '@crm/contracts';
import { BarChart } from '@/features/dashboards-analytics-charts/components/charts';
import { Panel } from '@/features/dashboards-analytics-charts/components/parts';
import { bucketLabel, formatAmount, magnitude, moneyText } from '../../lib/format';
import { isOneScale, sharePercent } from '../lib/split';

/** Invoiced, paid and owed: one bar for the invoices issued in the period, split by where they stand today. */
export function FlowPanel({ data, currency }: { data: RevenueReportResponse; currency: string }) {
  const t = useTranslations('crm-revenue.flow');
  const locale = useLocale();
  const m = data.summary.metrics.invoiced.current;
  const { paid, outstanding, overdue, credited } = data.summary.metrics;
  const fallback = data.convertedTo ?? currency;
  const empty = magnitude(m) <= 0;
  const one = isOneScale(m) && isOneScale(paid.current) && isOneScale(outstanding.current);
  const overduePct = sharePercent(overdue.current, m);
  const owedPct = Math.max(0, sharePercent(outstanding.current, m) - overduePct);
  const paidPct = sharePercent(paid.current, m);
  const creditedPct = sharePercent(credited.current, m);
  const rows: Array<{ id: string; label: string; value: string; pct: number; tone: string }> = [
    {
      id: 'paid',
      label: t('paid'),
      value: moneyText(paid.current, locale, fallback),
      pct: paidPct,
      tone: 'bg-success',
    },
    {
      id: 'owed',
      label: t('owed'),
      value: moneyText(outstanding.current, locale, fallback),
      pct: owedPct,
      tone: 'bg-warning',
    },
    {
      id: 'overdue',
      label: t('overdue'),
      value: moneyText(overdue.current, locale, fallback),
      pct: overduePct,
      tone: 'bg-danger',
    },
  ];
  if (magnitude(credited.current) > 0)
    rows.push({
      id: 'credited',
      label: t('credited'),
      value: moneyText(credited.current, locale, fallback),
      pct: creditedPct,
      tone: 'bg-muted-foreground/40',
    });
  return (
    <Panel title={t('title')} subtitle={t('subtitle')}>
      {empty ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="text-lg font-semibold tabular-nums" data-testid="flow-total">
              {moneyText(m, locale, fallback)}
            </span>
            <span className="ms-2 text-xs text-muted-foreground">{t('invoiced')}</span>
          </p>
          {one ? (
            <div
              className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={rows.map((r) => `${r.label} ${r.pct}%`).join(', ')}
            >
              {rows.map((r) => (
                <span
                  key={r.id}
                  className={r.tone}
                  style={{ width: `${r.pct}%` }}
                  data-testid={`flow-${r.id}`}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('several')}</p>
          )}
          <dl className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${r.tone}`} />
                  {r.label}
                </dt>
                <dd className="font-mono tabular-nums">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Panel>
  );
}

/** Invoiced against collected over the period, per day, week or month (whichever keeps the chart readable). */
export function RevenueTrendPanel({
  trend,
  currency,
}: {
  trend: RevenueReportResponse['trend'];
  currency: string;
}) {
  const t = useTranslations('crm-revenue.trend');
  const locale = useLocale();
  const labels = trend.points.map((p) => bucketLabel(p.start, trend.bucket, locale));
  const invoiced = trend.points.map((p) => magnitude(p.invoiced));
  const collected = trend.points.map((p) => magnitude(p.collected));
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return (
    <Panel title={t('title')} subtitle={`${t(`subtitle.${trend.bucket}`)} (${currency})`}>
      <BarChart
        labels={labels}
        label={t('chartLabel')}
        series={[
          { name: t('invoiced'), values: invoiced, color: 'var(--primary)' },
          { name: t('collected'), values: collected, color: 'var(--success)' },
        ]}
        seriesTotals={[sum(invoiced), sum(collected)]}
      />
    </Panel>
  );
}

/** Receivables aging as of today, one block per currency (never summed across currencies). */
export function RevenueAgingPanel({ aging }: { aging: RevenueReportResponse['aging'] }) {
  const t = useTranslations('crm-revenue.aging');
  const locale = useLocale();
  return (
    <Panel
      title={t('title')}
      action={
        <Link href="/payments" className="text-xs font-medium text-primary hover:underline">
          {t('open')}
        </Link>
      }
    >
      {aging.currencies.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="space-y-4">
          {aging.currencies.map((block) => (
            <div key={block.currency}>
              {aging.currencies.length > 1 && (
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  {block.currency}
                </div>
              )}
              <dl className="space-y-1.5">
                {block.buckets.map((b) => (
                  <div key={b.bucket} className="flex items-center justify-between text-sm">
                    <dt className="text-muted-foreground">{t(`bucket.${b.bucket}`)}</dt>
                    <dd
                      className={
                        b.bucket === 'd90_plus' && Number(b.amount) > 0
                          ? 'font-mono font-medium tabular-nums text-danger'
                          : 'font-mono tabular-nums'
                      }
                    >
                      {formatAmount(b.amount, block.currency, locale)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
