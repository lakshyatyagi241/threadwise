'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { cn } from '@crm/ui';
import type { Report } from '../api/schemas';
import { barLength, niceMax, ticks } from '../lib/chart';
import { monthLabel } from '../lib/format';
import { formatMoney } from '../lib/money';

/**
 * Open pipeline value by stage: one bar per stage in the stage's own colour (the colour is the stage's identity, set
 * in the pipeline settings), the value written at the end of the bar, and the weighted value on hover or focus.
 */
export function StageValueChart({ stages, currency }: { stages: Report['byStage']; currency: string }) {
  const t = useTranslations('deals-pipelines.reports');
  const locale = useLocale();
  const rows = stages.filter((s) => s.kind === 'open');
  const top = Math.max(...rows.map((r) => r.valueMinor), 0);

  return (
    <ul className="space-y-3" aria-label={t('stageChartLabel')}>
      {rows.map((r) => (
        <li key={r.stageId} className="group relative grid grid-cols-[minmax(5rem,9rem)_1fr] items-center gap-3">
          <span className="min-w-0 truncate text-sm">
            {r.name}
            <span className="ms-1.5 text-xs text-muted-foreground tabular-nums">{r.count}</span>
          </span>
          <div className="flex items-center gap-2" tabIndex={0} aria-label={t('stageRow', {
            name: r.name,
            value: formatMoney(r.valueMinor, currency, locale),
            weighted: formatMoney(r.weightedMinor, currency, locale),
            count: r.count,
          })}>
            <div className="h-6 min-w-0 flex-1 rounded-md bg-muted">
              <div
                className="h-full rounded-md"
                style={{
                  width: `${top > 0 ? (barLength(r.valueMinor, top, 1000) / 1000) * 100 : 0}%`,
                  backgroundColor: r.color,
                }}
              />
            </div>
            <span className="w-20 shrink-0 text-end text-xs font-medium tabular-nums">
              {formatMoney(r.valueMinor, currency, locale, { compact: true })}
            </span>
          </div>
          <div
            role="tooltip"
            className="pointer-events-none absolute end-0 top-full z-10 mt-1 hidden whitespace-nowrap rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg group-focus-within:block group-hover:block"
          >
            <div className="font-semibold">{r.name}</div>
            <div className="text-muted-foreground">
              {t('tipValue', { value: formatMoney(r.valueMinor, currency, locale) })}
            </div>
            <div className="text-muted-foreground">
              {t('tipWeighted', { value: formatMoney(r.weightedMinor, currency, locale) })}
            </div>
            <div className="text-muted-foreground">{t('tipCount', { count: r.count })}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Won against lost deals per month: two columns per month, a legend, a zero-based axis and a tooltip per month. */
export function WonLostChart({ months }: { months: Report['months'] }) {
  const t = useTranslations('deals-pipelines.reports');
  const locale = useLocale();
  const [active, setActive] = useState<number | null>(null);
  const top = niceMax(Math.max(...months.flatMap((m) => [m.won, m.lost]), 0));
  const axis = ticks(top, top >= 4 ? 4 : top >= 2 ? 2 : 1);
  const int = (n: number) => new Intl.NumberFormat(locale).format(n);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success" /> {t('won')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-danger" /> {t('lost')}
        </span>
      </div>
      <div className="relative h-56 ps-8" role="group" aria-label={t('trendChartLabel')}>
        {axis.map((v) => (
          <div
            key={v}
            aria-hidden="true"
            className="absolute inset-x-0 border-t border-border"
            style={{ bottom: `${(v / top) * 100}%` }}
          >
            <span className="absolute start-0 -translate-y-1/2 bg-background pe-1 text-[10px] tabular-nums text-muted-foreground">
              {int(v)}
            </span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-stretch gap-1 ps-8" onMouseLeave={() => setActive(null)}>
          {months.map((m, i) => (
            <div
              key={m.month}
              tabIndex={0}
              role="img"
              aria-label={t('monthRow', { month: monthLabel(m.month, locale), won: m.won, lost: m.lost })}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="group relative flex min-w-0 flex-1 items-end justify-center gap-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div
                className="w-full max-w-5 rounded-t bg-success"
                style={{ height: `${(barLength(m.won, top, 1000) / 1000) * 100}%` }}
              />
              <div
                className="w-full max-w-5 rounded-t bg-danger"
                style={{ height: `${(barLength(m.lost, top, 1000) / 1000) * 100}%` }}
              />
              {active === i && (
                <div
                  role="tooltip"
                  className={cn(
                    'pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg',
                    i > months.length / 2 ? 'end-0' : 'start-0',
                  )}
                >
                  <div className="font-semibold">{monthLabel(m.month, locale)}</div>
                  <div className="text-success">{t('tipWon', { count: m.won })}</div>
                  <div className="text-danger">{t('tipLost', { count: m.lost })}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-1 ps-8 pt-2 text-[11px] text-muted-foreground" aria-hidden="true">
        {months.map((m) => (
          <span key={m.month} className="min-w-0 flex-1 truncate text-center">
            {monthLabel(m.month, locale)}
          </span>
        ))}
      </div>
    </div>
  );
}
