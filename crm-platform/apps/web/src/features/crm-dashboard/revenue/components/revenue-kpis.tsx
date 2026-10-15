'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { DealTotals, RevenuePeriodMoney, RevenueReportResponse } from '@crm/contracts';
import { cn } from '@crm/ui';
import { Trend } from '@/features/dashboards-analytics-charts/components/parts';
import { changePercent, formatAmount, magnitude, moneyText, moneyView } from '../../lib/format';

interface Kpi {
  id: string;
  label: string;
  value: string;
  hint?: string;
  /** The amount per currency, shown when the large figure is a conversion of several. */
  parts?: string;
  delta?: { value: number; lowerIsBetter?: boolean };
  href?: string;
  tone?: 'default' | 'warning';
}

function Card({ kpi }: { kpi: Kpi }) {
  const t = useTranslations('crm-revenue.kpi');
  const body = (
    <>
      <div className="text-xs font-medium text-muted-foreground">{kpi.label}</div>
      <div
        className={cn(
          'mt-1 truncate text-2xl font-semibold leading-tight tabular-nums',
          kpi.tone === 'warning' && 'text-warning',
        )}
        data-testid={`kpi-${kpi.id}`}
      >
        {kpi.value}
      </div>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {kpi.delta && (
          <span title={t('vsPrevious')}>
            <Trend delta={kpi.delta.value} lowerIsBetter={kpi.delta.lowerIsBetter} />
          </span>
        )}
        {kpi.hint && <span className="min-w-0 truncate">{kpi.hint}</span>}
      </div>
      {kpi.parts && (
        <div className="mt-1 truncate text-xs text-muted-foreground tabular-nums">{kpi.parts}</div>
      )}
    </>
  );
  const box =
    'block rounded-xl border bg-background p-4 transition-colors ' +
    (kpi.tone === 'warning' ? 'border-warning/40' : 'border-border');
  return kpi.href ? (
    <Link
      href={kpi.href}
      className={cn(box, 'hover:border-primary focus-visible:ring-2 focus-visible:ring-primary')}
    >
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** The counters: Reference's four first (collected, collected all time, outstanding, tax), then what the new report adds. */
export function RevenueKpis({ data, currency }: { data: RevenueReportResponse; currency: string }) {
  const t = useTranslations('crm-revenue.kpi');
  const locale = useLocale();
  const fallback = data.convertedTo ?? currency;
  const money = (v: DealTotals) => moneyText(v, locale, fallback);
  /** Under a converted figure, what it was made of; nothing when one currency says it all. */
  const parts = (v: DealTotals): string | undefined => {
    const view = moneyView(v);
    return v.converted && view.parts.length > 1
      ? view.parts.map((p) => formatAmount(p.amount, p.currency, locale)).join(' + ')
      : undefined;
  };
  const delta = (m: RevenuePeriodMoney, lowerIsBetter = false) => {
    if (!m.previous) return undefined;
    const d = changePercent(magnitude(m.current), magnitude(m.previous));
    return d === null ? undefined : { value: d, lowerIsBetter };
  };
  const { summary } = data;
  const m = summary.metrics;
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const overdue = magnitude(summary.receivables.overdue) > 0;

  const cards: Kpi[] = [
    {
      id: 'collected',
      label: t('collected'),
      value: money(m.collected.current),
      parts: parts(m.collected.current),
      hint: t('collectedHint'),
      delta: delta(m.collected),
      href: '/payments',
    },
    {
      id: 'collectedAll',
      label: t('collectedAll'),
      value: money(summary.collectedAllTime),
      parts: parts(summary.collectedAllTime),
      hint: t('collectedAllHint'),
    },
    {
      id: 'outstanding',
      label: t('outstanding'),
      value: money(summary.receivables.outstanding),
      parts: parts(summary.receivables.outstanding),
      hint: t('outstandingHint', { count: summary.receivables.invoices }),
      tone: overdue ? 'warning' : 'default',
      href: '/payments',
    },
    {
      id: 'tax',
      label: t('tax'),
      value: money(summary.taxCollected.current),
      parts: parts(summary.taxCollected.current),
      hint: t('taxHint'),
      delta: delta(summary.taxCollected),
    },
    {
      id: 'invoiced',
      label: t('invoiced'),
      value: money(m.invoiced.current),
      parts: parts(m.invoiced.current),
      hint: t('invoicedHint', { count: summary.invoices.issued.current }),
      delta: delta(m.invoiced),
      href: '/invoices',
    },
    {
      id: 'paid',
      label: t('paid'),
      value: money(m.paid.current),
      parts: parts(m.paid.current),
      hint: t('paidHint'),
      delta: delta(m.paid),
    },
    {
      id: 'overdue',
      label: t('overdue'),
      value: money(summary.receivables.overdue),
      parts: parts(summary.receivables.overdue),
      hint: t('overdueHint'),
      tone: overdue ? 'warning' : 'default',
      href: '/invoices',
    },
    {
      id: 'refunded',
      label: t('refunded'),
      value: money(m.refunded.current),
      parts: parts(m.refunded.current),
      hint: t('refundedHint'),
      delta: delta(m.refunded, true),
    },
    {
      id: 'paidInFull',
      label: t('paidInFull'),
      value: num(summary.invoices.paidInFull.current),
      hint: t('paidInFullHint'),
      delta:
        summary.invoices.paidInFull.previous === null
          ? undefined
          : (() => {
              const d = changePercent(
                summary.invoices.paidInFull.current,
                summary.invoices.paidInFull.previous,
              );
              return d === null ? undefined : { value: d };
            })(),
      href: '/invoices',
    },
  ];

  return (
    <section
      aria-label={t('title')}
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
    >
      {cards.map((k) => (
        <Card key={k.id} kpi={k} />
      ))}
    </section>
  );
}
