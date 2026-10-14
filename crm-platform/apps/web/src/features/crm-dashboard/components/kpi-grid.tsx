'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { CrmDashboardResponse } from '@crm/contracts';
import { cn } from '@crm/ui';
import { Trend } from '@/features/dashboards-analytics-charts/components/parts';
import { changePercent, magnitude, moneyText, moneyView } from '../lib/format';
import { links } from '../lib/query';

interface Kpi {
  id: string;
  label: string;
  value: string;
  hint?: string;
  delta?: { value: number; unit?: '%' | 'pp'; lowerIsBetter?: boolean };
  href?: string;
  tone?: 'default' | 'warning';
}

/** One counter, a link into the screen that owns the rows behind it when there is one. */
function Card({ kpi }: { kpi: Kpi }) {
  const t = useTranslations('crm-dashboard.kpi');
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
            <Trend
              delta={kpi.delta.value}
              unit={kpi.delta.unit ?? '%'}
              lowerIsBetter={kpi.delta.lowerIsBetter}
            />
          </span>
        )}
        {kpi.hint && <span className="min-w-0 truncate">{kpi.hint}</span>}
      </div>
    </>
  );
  const box =
    'block rounded-xl border bg-background p-4 transition-colors ' +
    (kpi.tone === 'warning' ? 'border-warning/40' : 'border-border');
  return kpi.href ? (
    <Link href={kpi.href} className={cn(box, 'hover:border-primary focus-visible:ring-2 focus-visible:ring-primary')}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** The counters, in Reference's order first (pipeline, won, collected, outstanding, then the smaller ones) and the new ones after. */
export function KpiGrid({
  data,
  currency,
  pipeline,
}: {
  data: CrmDashboardResponse;
  currency: string;
  pipeline: string;
}) {
  const t = useTranslations('crm-dashboard.kpi');
  const locale = useLocale();
  const money = (v: Parameters<typeof moneyText>[0], compact = false) =>
    moneyText(v, locale, currency, { compact });
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const { deals, contacts, tasks, invoices } = data;
  const cards: Kpi[] = [];

  if (deals) {
    const closedPrev = deals.won.previousCount + deals.lost.previousCount;
    const wonDelta = changePercent(magnitude(deals.won.value), magnitude(deals.won.previousValue));
    cards.push({
      id: 'open',
      label: t('open'),
      value: money(deals.open.value),
      hint: t('openHint', { count: deals.open.count, forecast: money(deals.open.forecast, true) }),
      href: links.deals({ pipeline }),
    });
    cards.push({
      id: 'won',
      label: t('won'),
      value: money(deals.won.value),
      hint: t('wonHint', { count: deals.won.count }),
      delta: wonDelta === null ? undefined : { value: wonDelta },
      href: links.deals({ pipeline, status: 'won' }),
    });
  }
  if (invoices) {
    const collectedDelta = changePercent(
      magnitude(invoices.collected),
      magnitude(invoices.previousCollected),
    );
    cards.push({
      id: 'collected',
      label: t('collected'),
      value: money(invoices.collected),
      delta: collectedDelta === null ? undefined : { value: collectedDelta },
      hint: t('collectedHint'),
      href: '/payments',
    });
    cards.push({
      id: 'outstanding',
      label: t('outstanding'),
      value: money(invoices.outstanding),
      hint: t('outstandingHint', { count: invoices.openInvoices }),
      tone: moneyView(invoices.overdue).parts.length > 0 ? 'warning' : 'default',
      href: '/payments',
    });
  }
  if (deals) {
    cards.push({
      id: 'winRate',
      label: t('winRate'),
      value: `${deals.winRate}%`,
      hint: t('winRateHint', { won: deals.won.count, lost: deals.lost.count }),
      delta:
        closedPrev > 0 ? { value: deals.winRate - deals.previousWinRate, unit: 'pp' } : undefined,
    });
    cards.push({
      id: 'avgSize',
      label: t('avgSize'),
      value: money(deals.won.averageSize),
      hint: t('avgSizeHint'),
    });
    cards.push({
      id: 'avgCycle',
      label: t('avgCycle'),
      value:
        deals.won.averageCycleDays === null
          ? '–'
          : t('days', { count: Math.round(deals.won.averageCycleDays * 10) / 10 }),
      hint: t('avgCycleHint'),
    });
    const lostDelta = changePercent(deals.lost.count, deals.lost.previousCount);
    cards.push({
      id: 'lost',
      label: t('lost'),
      value: num(deals.lost.count),
      delta: lostDelta === null ? undefined : { value: lostDelta, lowerIsBetter: true },
      href: links.deals({ pipeline, status: 'lost' }),
    });
    if (deals.overdueCloseCount > 0) {
      cards.push({
        id: 'lateClose',
        label: t('lateClose'),
        value: num(deals.overdueCloseCount),
        hint: t('lateCloseHint'),
        tone: 'warning',
        href: links.deals({ pipeline, status: 'open' }),
      });
    }
  }
  if (contacts) {
    const newDelta = changePercent(contacts.newContacts.current, contacts.newContacts.previous);
    const leadDelta = changePercent(contacts.newLeads.current, contacts.newLeads.previous);
    cards.push({
      id: 'contacts',
      label: t('contacts'),
      value: num(contacts.totalContacts),
      hint: t('contactsHint'),
      href: '/contacts',
    });
    cards.push({
      id: 'newContacts',
      label: t('newContacts'),
      value: num(contacts.newContacts.current),
      delta: newDelta === null ? undefined : { value: newDelta },
      href: '/contacts',
    });
    cards.push({
      id: 'newLeads',
      label: t('newLeads'),
      value: num(contacts.newLeads.current),
      delta: leadDelta === null ? undefined : { value: leadDelta },
      hint: t('newLeadsHint'),
    });
  }
  if (invoices) {
    cards.push({
      id: 'paid',
      label: t('paid'),
      value: num(invoices.paidInvoices),
      hint: t('paidHint'),
      href: '/invoices',
    });
  }
  if (tasks) {
    cards.push({
      id: 'tasksOpen',
      label: t('tasksOpen'),
      value: num(tasks.open),
      hint: t('tasksOpenHint', { count: tasks.dueToday }),
      href: links.tasks({ tab: 'all' }),
    });
    cards.push({
      id: 'tasksOverdue',
      label: t('tasksOverdue'),
      value: num(tasks.overdue),
      tone: tasks.overdue > 0 ? 'warning' : 'default',
      href: links.tasks({ tab: 'overdue' }),
    });
  }

  return (
    <section aria-label={t('title')} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {cards.map((k) => (
        <Card key={k.id} kpi={k} />
      ))}
    </section>
  );
}
