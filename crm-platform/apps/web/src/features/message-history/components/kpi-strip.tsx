'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@crm/ui';
import type { MessageHistorySummary } from '@crm/contracts';
import { formatCount, formatMinor, humanDuration } from '../lib/format';

interface CardProps {
  label: string;
  tag?: ReactNode;
  tagTone?: 'good' | 'bad' | 'quiet';
  value: ReactNode;
  caption?: ReactNode;
  testId: string;
}

function Card({ label, tag, tagTone = 'good', value, caption, testId }: CardProps) {
  return (
    <div data-testid={testId} className="rounded-md border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        {tag !== undefined && (
          <span
            className={cn(
              'font-mono text-[10px]',
              tagTone === 'good' && 'text-success',
              tagTone === 'bad' && 'text-danger',
              tagTone === 'quiet' && 'text-muted-foreground',
            )}
          >
            {tag}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[28px] font-semibold leading-none tabular-nums">{value}</span>
        {caption !== undefined && (
          <span className="text-[11px] text-muted-foreground">{caption}</span>
        )}
      </div>
    </div>
  );
}

/**
 * The KPI cards. The first five are Reference's (total with the change against the last period, sent, received, failed, average first
 * response); the second row is what this port adds from the delivery receipts and the wallet: delivered, read, delivery rate and, for a
 * caller who may read the wallet statement, what the messages cost. The numbers are counts of the whole window, not of the page.
 */
export function KpiStrip({
  summary,
  windowLabel,
}: {
  summary: MessageHistorySummary | undefined;
  windowLabel: string;
}) {
  const t = useTranslations('message-history.kpi');
  const locale = useLocale();
  const n = (v: number | undefined) => formatCount(v ?? 0, locale);
  const s = summary;
  const delta = s?.deltaPct ?? 0;
  const pct = (v: number) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v)}%`;
  return (
    <section aria-label={t('label')} className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card
          testId="kpi-total"
          label={t('total')}
          tag={t('vsLast', { pct: `${delta >= 0 ? '+' : ''}${n(delta)}` })}
          tagTone={delta >= 0 ? 'good' : 'bad'}
          value={n(s?.total)}
          caption={windowLabel}
        />
        <Card
          testId="kpi-sent"
          label={t('sent')}
          tag={pct(s?.sentPct ?? 0)}
          value={n(s?.sent)}
          caption={t('outgoing')}
        />
        <Card
          testId="kpi-received"
          label={t('received')}
          tag={pct(s?.receivedPct ?? 0)}
          value={n(s?.received)}
          caption={t('incoming')}
        />
        <Card
          testId="kpi-failed"
          label={t('failed')}
          tag={pct(s?.failPct ?? 0)}
          tagTone={(s?.failed ?? 0) > 0 ? 'bad' : 'good'}
          value={n(s?.failed)}
          caption={t('retryQueue')}
        />
        <Card
          testId="kpi-response"
          label={t('avgResponse')}
          tag={s?.avgFirstResponseSeconds != null ? t('healthy') : t('na')}
          tagTone={s?.avgFirstResponseSeconds != null ? 'good' : 'quiet'}
          value={humanDuration(s?.avgFirstResponseSeconds ?? null, locale)}
          caption={t('toFirstReply')}
        />
      </div>
      <div
        className={cn(
          'grid grid-cols-2 gap-4',
          s?.cost != null ? 'lg:grid-cols-4' : 'sm:grid-cols-3',
        )}
      >
        <Card
          testId="kpi-delivered"
          label={t('delivered')}
          value={n(s?.delivered)}
          caption={t('deliveredCaption')}
        />
        <Card testId="kpi-read" label={t('read')} value={n(s?.read)} caption={t('readCaption')} />
        <Card
          testId="kpi-rate"
          label={t('deliveryRate')}
          value={s?.deliveryRate == null ? '—' : pct(s.deliveryRate)}
          caption={t('deliveryRateCaption')}
        />
        {s?.cost != null && (
          <Card
            testId="kpi-cost"
            label={t('cost')}
            value={
              s.cost.length === 0 ? (
                '—'
              ) : (
                <span className="flex flex-col gap-0.5 text-lg leading-tight">
                  {s.cost.map((c) => (
                    <span key={c.currency ?? 'platform'}>
                      {formatMinor(c.minor, c.currency, locale)}
                    </span>
                  ))}
                </span>
              )
            }
            caption={t('costCaption')}
          />
        )}
      </div>
    </section>
  );
}
