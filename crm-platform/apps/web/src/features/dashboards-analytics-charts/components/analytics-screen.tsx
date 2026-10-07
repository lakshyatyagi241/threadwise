'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ANALYTICS_RANGES, type AnalyticsQuery } from '@crm/contracts';
import { Button, Input, Spinner, StatTile } from '@crm/ui';
import { useAnalytics, useWidgets } from '../api/hooks';
import { InstagramAnalytics } from './dashboard-extras';
import { dashApi, type AnalyticsParams } from '../api/service';
import { compact, shares } from '../lib/format';
import { BarChart, Donut, Heatmap, Sparkline } from './charts';
import { RangePicker } from './dashboard-screen';
import { AnalyticsPanelsSection } from './analytics-panels';
import { Funnel, LoadError, Panel, Trend } from './parts';

type Range = AnalyticsQuery['range'];

/** `/analytics` (TW-DASH-022..032): window picker, hero totals with trends, daily charts, funnel, type mix, hour heatmap, CSV. */
export function AnalyticsScreen() {
  const t = useTranslations('dashboards-analytics-charts.analytics');
  const locale = useLocale();
  const [range, setRange] = useState<Range>('30d');
  const [draft, setDraft] = useState({ from: '', to: '' });
  const [custom, setCustom] = useState({ from: '', to: '' });
  const params: AnalyticsParams = { range, ...(range === 'custom' ? custom : {}) };
  const q = useAnalytics(params);
  const ig = useWidgets('7d').data?.instagram;
  const a = q.data;

  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(
      new Date(`${d}T00:00:00Z`),
    );
  const days = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(
      new Date(Date.UTC(2026, 0, 4 + i)),
    ),
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          {a && (
            <p className="text-sm text-muted-foreground">
              {t('headline', {
                rate: a.current.deliverability,
                from: a.window.fromDate,
                to: a.window.toDate,
              })}{' '}
              {a.current.sent > 0
                ? t('subline', { sent: a.current.sent, replyRate: a.current.replyRate })
                : t('noSends')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {q.isFetching && <Spinner />}
          <Button
            variant="secondary"
            onClick={() => window.location.assign(dashApi.exportUrl(params))}
          >
            {t('export')}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <RangePicker
          value={range}
          onChange={setRange as (r: never) => void}
          ranges={ANALYTICS_RANGES}
        />
        {range === 'custom' && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setCustom(draft);
            }}
          >
            <label className="text-xs text-muted-foreground">
              {t('from')}
              <Input
                type="date"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              {t('to')}
              <Input
                type="date"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </label>
            <Button type="submit">{t('apply')}</Button>
          </form>
        )}
      </div>

      {q.error && !a ? (
        <LoadError error={q.error} />
      ) : !a ? (
        <Spinner />
      ) : (
        <>
          <section aria-label={t('kpis')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile
              label={t('kpi.sent')}
              value={a.current.sent.toLocaleString(locale)}
              hint={<Trend delta={a.trends.sentPct} />}
              tone="accent"
            />
            <StatTile
              label={t('kpi.delivered')}
              value={a.current.delivered.toLocaleString(locale)}
              hint={
                <span className="flex items-center gap-2">
                  <Trend delta={a.trends.deliveredPct} />
                  {a.current.deliverability}%
                </span>
              }
            />
            <StatTile
              label={t('kpi.queued')}
              value={a.current.queued.toLocaleString(locale)}
              hint={<Trend delta={a.trends.queuedPct} lowerIsBetter />}
            />
            <StatTile
              label={t('kpi.failed')}
              value={a.current.failed.toLocaleString(locale)}
              hint={<Trend delta={a.trends.failedPct} lowerIsBetter />}
            />
            <StatTile
              label={t('kpi.replyRate')}
              value={`${a.current.replyRate}%`}
              hint={<Trend delta={a.trends.replyRatePp} unit="pp" />}
            />
          </section>

          {ig && <InstagramAnalytics data={ig} />}

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title={t('volume.title')}
              subtitle={t('volume.subtitle')}
            >
              <BarChart
                label={t('volume.title')}
                labels={a.daily.dates.map(dayLabel)}
                series={[
                  { name: t('series.sent'), values: a.daily.sent, color: 'var(--brand)' },
                  {
                    name: t('series.delivered'),
                    values: a.daily.delivered,
                    color: 'var(--success)',
                  },
                  { name: t('series.failed'), values: a.daily.failed, color: 'var(--danger)' },
                ]}
              />
            </Panel>
            <Panel title={t('rates.title')} subtitle={t('rates.subtitle')}>
              <Donut
                label={t('rates.title')}
                empty={t('empty')}
                slices={[
                  {
                    name: t('series.delivered'),
                    value: a.current.delivered,
                    color: 'var(--success)',
                  },
                  { name: t('series.queued'), value: a.current.queued, color: 'var(--warning)' },
                  { name: t('series.failed'), value: a.current.failed, color: 'var(--danger)' },
                ]}
              />
              <div className="border-t border-border pt-3">
                <Sparkline values={a.daily.sent} label={t('volume.title')} />
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title={t('totals.title')}
              subtitle={t('totals.subtitle')}
            >
              <BarChart
                stacked
                label={t('totals.title')}
                labels={a.daily.dates.map(dayLabel)}
                series={[
                  {
                    name: t('series.delivered'),
                    values: a.daily.delivered,
                    color: 'var(--success)',
                  },
                  { name: t('series.queued'), values: a.daily.queued, color: 'var(--warning)' },
                  { name: t('series.failed'), values: a.daily.failed, color: 'var(--danger)' },
                ]}
              />
            </Panel>
            <Panel title={t('funnel.title')} subtitle={`${a.window.fromDate} – ${a.window.toDate}`}>
              <Funnel
                funnel={a.funnel}
                previousEndToEnd={Math.round((a.funnel.endToEnd - a.trends.endToEndPp) * 10) / 10}
              />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title={t('types.title')} subtitle={t('types.subtitle')}>
              <Donut
                label={t('types.title')}
                empty={t('empty')}
                slices={shares(a.types).map((s, i) => ({
                  name: t(`types.${s.key}`),
                  value: s.count,
                  color: [
                    'var(--brand)',
                    'var(--success)',
                    'var(--warning)',
                    'var(--danger)',
                    'var(--primary)',
                  ][i % 5]!,
                }))}
              />
              {a.types.length > 0 && (
                <table className="mt-4 w-full border-t border-border text-sm">
                  <caption className="sr-only">{t('types.byType')}</caption>
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th scope="col" className="py-2 text-start font-normal">
                        {t('types.kind')}
                      </th>
                      <th scope="col" className="py-2 text-end font-normal">
                        {t('types.sent')}
                      </th>
                      <th scope="col" className="py-2 text-end font-normal">
                        {t('types.delivered')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.types.map((row) => (
                      <tr key={row.key} className="border-t border-border/60">
                        <th scope="row" className="py-1.5 text-start font-normal">
                          {t(`types.${row.key}`)}
                        </th>
                        <td className="py-1.5 text-end tabular-nums">{compact(row.count)}</td>
                        <td className="py-1.5 text-end tabular-nums">{compact(row.delivered)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
            <Panel
              className="lg:col-span-2"
              title={t('heatmap.title')}
              subtitle={t('heatmap.subtitle', { zone: a.window.timezone })}
            >
              {a.heatmap.flat().some((n) => n > 0) ? (
                <Heatmap grid={a.heatmap} dayLabels={days} label={t('heatmap.title')} />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t('heatmap.empty')}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t('heatmap.footer', {
                  total: compact(a.heatmap.flat().reduce((x, y) => x + y, 0)),
                  tz: a.window.timezone,
                })}
              </p>
            </Panel>
          </div>
          <AnalyticsPanelsSection params={params} />
        </>
      )}
    </div>
  );
}
