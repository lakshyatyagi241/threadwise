'use client';

import { useLocale, useTranslations } from 'next-intl';
import type {
  DealTotals,
  RevenueGroup,
  RevenueMetrics,
  RevenuePeriodMoney,
  RevenueReportResponse,
} from '@crm/contracts';
import { cn } from '@crm/ui';
import { Trend } from '@/features/dashboards-analytics-charts/components/parts';
import { changePercent, formatAmount, magnitude, moneyView } from '../../lib/format';
import { isKnownOrigin } from '../lib/split';

type Row = RevenueReportResponse['rows']['items'][number];

/** An amount in a cell: the one figure, or one line per currency when there is no total. */
function Money({ value, tone }: { value: DealTotals; tone?: 'danger' }) {
  const locale = useLocale();
  const v = moneyView(value);
  if (v.primary)
    return (
      <span className={cn('block tabular-nums', tone === 'danger' && 'text-danger')}>
        {formatAmount(v.primary.amount, v.primary.currency, locale)}
      </span>
    );
  if (v.parts.length === 0) return <span className="block text-muted-foreground">-</span>;
  return (
    <>
      {v.parts.map((p) => (
        <span
          key={p.currency}
          className={cn('block tabular-nums', tone === 'danger' && 'text-danger')}
        >
          {formatAmount(p.amount, p.currency, locale)}
        </span>
      ))}
    </>
  );
}

/** An amount with its change against the comparison window under it. */
function Compared({ pair, tone }: { pair: RevenuePeriodMoney; tone?: 'danger' }) {
  const t = useTranslations('crm-revenue.kpi');
  const d =
    pair.previous === null
      ? null
      : changePercent(magnitude(pair.current), magnitude(pair.previous));
  return (
    <>
      <Money value={pair.current} tone={tone} />
      {d !== null && (
        <span className="mt-0.5 inline-block" title={t('vsPrevious')}>
          <Trend delta={d} />
        </span>
      )}
    </>
  );
}

function Cells({ m }: { m: RevenueMetrics }) {
  return (
    <>
      <td className="px-3 py-2 text-end align-top">
        <Compared pair={m.invoiced} />
      </td>
      <td className="px-3 py-2 text-end align-top">
        <Money value={m.paid.current} />
      </td>
      <td className="px-3 py-2 text-end align-top">
        <Money value={m.outstanding.current} />
      </td>
      <td className="px-3 py-2 text-end align-top">
        <Money value={m.overdue.current} tone="danger" />
      </td>
      <td className="px-3 py-2 text-end align-top">
        <Compared pair={m.collected} />
      </td>
      <td className="px-3 py-2 text-end align-top">
        <Money value={m.refunded.current} />
      </td>
    </>
  );
}

/** The table by lead source, invoice origin, product, owner or team. The first line is the total; rows are the biggest first. */
export function SplitTable({ data, currency }: { data: RevenueReportResponse; currency: string }) {
  const t = useTranslations('crm-revenue.split');
  const group: RevenueGroup = data.rows.groupBy;
  const rowName = (r: Row): string => {
    if (r.key === '') return t(`empty.${group}`);
    if (group === 'origin' && isKnownOrigin(r.key)) return t(`origin.${r.key}`);
    return r.label ?? r.key;
  };
  const items = data.rows.items;
  const total = data.summary.metrics;
  return (
    <section className="space-y-2 rounded-xl border border-border bg-background p-4">
      <div>
        <h2 className="text-sm font-semibold">{t('title', { group: t(`group.${group}`) })}</h2>
        <p className="text-xs text-muted-foreground">
          {data.convertedTo
            ? t('subtitle', { currency: data.convertedTo })
            : data.currencies.length > 1
              ? t('subtitlePerCurrency')
              : t('subtitle', { currency })}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm" data-testid="split-table">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t(`group.${group}`)}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('col.invoices')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('col.invoiced')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('col.paid')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('col.outstanding')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('col.overdue')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('col.collected')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('col.refunded')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr className="bg-muted/40 font-medium">
              <th scope="row" className="px-3 py-2 text-start align-top">
                {t('total')}
              </th>
              <td className="px-3 py-2 text-end align-top tabular-nums">
                {data.summary.invoices.issued.current}
              </td>
              <Cells m={total} />
            </tr>
            {items.map((r) => (
              <tr key={r.key} data-testid="split-row">
                <th scope="row" className="max-w-64 px-3 py-2 text-start align-top font-normal">
                  <span className="block truncate" title={rowName(r)}>
                    {rowName(r)}
                  </span>
                </th>
                <td className="px-3 py-2 text-end align-top tabular-nums">{r.invoices.current}</td>
                <Cells m={r.metrics} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        {data.rows.truncated && <p>{t('truncated', { count: items.length })}</p>}
        {group === 'team' && <p>{t('teamNote')}</p>}
        {group === 'product' && <p>{t('productNote')}</p>}
      </div>
    </section>
  );
}
