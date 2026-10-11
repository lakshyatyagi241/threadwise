'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FaqInsights } from '@crm/contracts';
import { Button, cn } from '@crm/ui';
import { dailyScale, histogramMax, thresholdPosition } from '../lib/log-model';

/** Answered is green, unanswered amber; the legend names them, and the table view carries every number. */
function Legend() {
  const t = useTranslations('faq.insights.chart');
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-sm bg-success" />
        {t('answered')}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-sm bg-warning" />
        {t('unanswered')}
      </li>
    </ul>
  );
}

export function DailyChart({ daily }: { daily: FaqInsights['daily'] }) {
  const t = useTranslations('faq.insights.chart');
  const locale = useLocale();
  const [table, setTable] = useState(false);
  const scale = dailyScale(daily);
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend />
        <Button size="sm" variant="ghost" aria-pressed={table} onClick={() => setTable((v) => !v)}>
          {table ? t('showChart') : t('showTable')}
        </Button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('dailyTitle')}</caption>
            <thead>
              <tr className="text-start text-xs text-muted-foreground">
                <th scope="col" className="py-1 text-start">
                  {t('day')}
                </th>
                <th scope="col" className="py-1 text-end">
                  {t('answered')}
                </th>
                <th scope="col" className="py-1 text-end">
                  {t('unanswered')}
                </th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <th scope="row" className="py-1 text-start font-normal">
                    {day(d.day)}
                  </th>
                  <td className="py-1 text-end tabular-nums">{d.answered}</td>
                  <td className="py-1 text-end tabular-nums">{d.unanswered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          role="img"
          aria-label={t('dailyLabel')}
          className="flex h-44 items-end gap-0.5"
          dir="ltr"
        >
          {daily.map((d, i) => (
            <div
              key={d.day}
              className="group relative flex h-full flex-1 flex-col justify-end gap-0.5"
              title={t('dayTooltip', {
                day: day(d.day),
                answered: d.answered,
                unanswered: d.unanswered,
              })}
            >
              <div
                className="rounded-t-sm bg-warning"
                style={{ height: `${scale[i]!.unansweredPct}%` }}
              />
              <div
                className={cn('bg-success', scale[i]!.unansweredPct === 0 && 'rounded-t-sm')}
                style={{ height: `${scale[i]!.answeredPct}%` }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ten score buckets split answered vs unanswered, with the current threshold drawn across them. */
export function ScoreHistogram({
  histogram,
  threshold,
}: {
  histogram: FaqInsights['scoreHistogram'];
  threshold: number | null;
}) {
  const t = useTranslations('faq.insights.chart');
  const [table, setTable] = useState(false);
  const max = histogramMax(histogram);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend />
        <Button size="sm" variant="ghost" aria-pressed={table} onClick={() => setTable((v) => !v)}>
          {table ? t('showChart') : t('showTable')}
        </Button>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{t('histogramTitle')}</caption>
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="py-1 text-start">
                {t('scoreRange')}
              </th>
              <th scope="col" className="py-1 text-end">
                {t('answered')}
              </th>
              <th scope="col" className="py-1 text-end">
                {t('unanswered')}
              </th>
            </tr>
          </thead>
          <tbody>
            {histogram.map((b) => (
              <tr key={b.from} className="border-t border-border">
                <th scope="row" className="py-1 text-start font-normal tabular-nums">
                  {Math.round(b.from * 100)}-{Math.round(b.to * 100)}%
                </th>
                <td className="py-1 text-end tabular-nums">{b.answered}</td>
                <td className="py-1 text-end tabular-nums">{b.unanswered}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div dir="ltr">
          <div
            role="img"
            aria-label={t('histogramLabel')}
            className="relative flex h-40 items-end gap-1"
          >
            {histogram.map((b) => (
              <div
                key={b.from}
                className="flex h-full flex-1 flex-col justify-end gap-0.5"
                title={t('bucketTooltip', {
                  from: Math.round(b.from * 100),
                  to: Math.round(b.to * 100),
                  answered: b.answered,
                  unanswered: b.unanswered,
                })}
              >
                <div
                  className="rounded-t-sm bg-warning"
                  style={{ height: `${(b.unanswered / max) * 100}%` }}
                />
                <div className="bg-success" style={{ height: `${(b.answered / max) * 100}%` }} />
              </div>
            ))}
            {threshold !== null && (
              <div
                className="pointer-events-none absolute inset-y-0 border-s-2 border-dashed border-foreground"
                style={{ left: `${thresholdPosition(threshold)}%` }}
              >
                <span className="absolute -top-5 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">
                  {t('thresholdMarker', { value: Math.round(threshold * 100) })}
                </span>
              </div>
            )}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
      )}
    </div>
  );
}
