'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, Select, Spinner, StatTile, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { refreshAll, useAnalytics, useFlowOptions } from '../api/flow-runtime';
import {
  ANALYTICS_DAYS,
  DEFAULT_DAYS,
  dayLabel,
  flowRate,
  parseDays,
  percent,
  shortId,
  statusMix,
} from '../lib/model';
import { HBars, Donut, Legend, TrendChart } from './charts';
import {
  CARD,
  Denied,
  KICKER,
  TH,
  useDuration,
  useErrorText,
  useReasonText,
  useSourceLabel,
} from './parts';

const COLORS = {
  running: 'var(--brand)',
  completed: 'var(--success)',
  failed: 'var(--danger)',
  cancelled: 'var(--muted-foreground)',
  expired: 'var(--warning)',
} as const;

/**
 * `/flow-runtime/analytics`: totals, completion rate, trend, status mix, grouped failure reasons, runs by source and the flow
 * leaderboard. The period (7, 30, 90 days) and the flow scope live in the address.
 */
export function AnalyticsScreen() {
  const t = useTranslations('flr');
  const ta = useTranslations('flr.analytics');
  const canRead = useCan('flr.runs.read');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const dur = useDuration();
  const errText = useErrorText();
  const reasonText = useReasonText();
  const sourceLabel = useSourceLabel();

  const days = parseDays(search.get('days'));
  const flowId = search.get('flowId') ?? '';
  const go = (patch: { days?: number; flowId?: string }) => {
    const p = new URLSearchParams();
    const d = patch.days ?? days;
    const f = patch.flowId ?? flowId;
    if (d !== DEFAULT_DAYS) p.set('days', String(d));
    if (f) p.set('flowId', f);
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const a = useAnalytics(days, flowId);
  const flows = useFlowOptions();

  if (!canRead) return <Denied />;

  const d = a.data;
  const rate = d ? percent(d.completionRate) : null;
  const hasRuns = !!d && d.totals.enrolled + d.totals.running > 0;
  const mix = d ? statusMix(d.totals) : [];
  const mixTotal = mix.reduce((n, m) => n + m.value, 0);

  return (
    <main className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className={`mb-2 ${KICKER}`}>{t('common.workspace')}</div>
          <h1 className="text-3xl font-normal leading-none tracking-tight lg:text-[44px]">
            {ta('title')} <span className="italic text-brand">{ta('titleAccent')}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{ta('intro')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" className="rounded-full" onClick={() => void refreshAll(qc)}>
            {t('common.refresh')}
          </Button>
          <Link
            href="/flow-runtime"
            className="inline-flex h-10 items-center rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground hover:opacity-90"
          >
            {ta('runsLink')}
          </Link>
        </div>
      </div>

      <section className={`${CARD} mb-5 flex flex-wrap items-end gap-4 px-4 py-3.5 sm:px-5`}>
        <label className="block min-w-[200px] max-w-full flex-1 sm:max-w-xs">
          <span className={KICKER}>{ta('flow')}</span>
          <Select className="mt-1" value={flowId} onChange={(e) => go({ flowId: e.target.value })}>
            <option value="">{ta('allFlows')}</option>
            {flowId && !flows.data?.some((f) => f.id === flowId) && (
              <option value={flowId}>{t('common.unknownFlow', { id: shortId(flowId) })}</option>
            )}
            {flows.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </label>
        <div>
          <span className={KICKER}>{ta('period')}</span>
          <div className="mt-1 flex gap-1.5" role="group" aria-label={ta('period')}>
            {ANALYTICS_DAYS.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={days === n}
                onClick={() => go({ days: n })}
                className={cn(
                  'rounded-full px-3 py-2 text-xs font-semibold',
                  days === n
                    ? 'bg-brand text-brand-foreground'
                    : 'border border-border hover:bg-muted',
                )}
              >
                {ta('days', { days: n })}
              </button>
            ))}
          </div>
        </div>
      </section>

      {a.isPending ? (
        <div className="flex justify-center p-12">
          <Spinner label={t('common.loading')} />
        </div>
      ) : a.isError || !d ? (
        <EmptyState
          title={ta('loadError')}
          message={errText(a.error, t('common.loadError'))}
          actions={
            <Button variant="secondary" onClick={() => void a.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label={ta('kpiStarted')}
              value={d.totals.enrolled.toLocaleString()}
              hint={ta('kpiStartedHint')}
            />
            <StatTile
              label={ta('kpiRunning')}
              value={d.totals.running.toLocaleString()}
              hint={ta('kpiRunningHint')}
            />
            <StatTile
              label={ta('kpiCompleted')}
              value={d.totals.completed.toLocaleString()}
              hint={ta('kpiCompletedHint')}
              tone="accent"
            />
            <StatTile
              label={ta('kpiFailed')}
              value={d.totals.failed.toLocaleString()}
              hint={ta('kpiFailedHint')}
              tone={d.totals.failed > 0 ? 'warning' : 'default'}
            />
            <StatTile
              label={ta('kpiRate')}
              value={rate ?? t('common.noValue')}
              hint={rate ? ta('kpiRateHint') : ta('kpiRateNone')}
            />
            <StatTile
              label={ta('kpiAvg')}
              value={dur(d.avgSecondsToComplete)}
              hint={d.avgSecondsToComplete === null ? ta('kpiAvgNone') : ta('kpiAvgHint')}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className={`${CARD} min-w-0 p-5 lg:col-span-8`}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className={KICKER}>{ta('trendKicker')}</div>
                  <h2 className="mt-1 text-xl leading-tight">{ta('trendTitle')}</h2>
                </div>
                <Legend
                  items={[
                    { label: ta('seriesStarted'), color: COLORS.running },
                    { label: ta('seriesCompleted'), color: COLORS.completed },
                    { label: ta('seriesFailed'), color: COLORS.failed },
                  ]}
                />
              </div>
              {d.trend.length === 0 ? (
                <EmptyState title={ta('trendEmptyTitle')} message={ta('trendEmptyBody')} />
              ) : (
                <TrendChart
                  label={ta('trendLabel')}
                  labels={d.trend.map((p) => dayLabel(p.day))}
                  series={[
                    {
                      name: ta('seriesStarted'),
                      color: COLORS.running,
                      data: d.trend.map((p) => p.started),
                    },
                    {
                      name: ta('seriesCompleted'),
                      color: COLORS.completed,
                      data: d.trend.map((p) => p.completed),
                    },
                    {
                      name: ta('seriesFailed'),
                      color: COLORS.failed,
                      data: d.trend.map((p) => p.failed),
                    },
                  ]}
                />
              )}
            </div>
            <div className={`${CARD} p-5 lg:col-span-4`}>
              <div className={KICKER}>{ta('mixKicker')}</div>
              <h2 className="mb-2 mt-1 text-xl leading-tight">{ta('mixTitle')}</h2>
              {!hasRuns || mixTotal === 0 ? (
                <EmptyState title={ta('mixEmptyTitle')} message={ta('mixEmptyBody')} />
              ) : (
                <Donut
                  label={ta('mixLabel')}
                  centre={ta('mixCentre', { count: mixTotal })}
                  caption={ta('mixCaption')}
                  slices={mix.map((m) => ({
                    label: t(`status.${m.key}`),
                    value: m.value,
                    color: COLORS[m.key],
                  }))}
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className={`${CARD} min-w-0 p-5 lg:col-span-7`}>
              <div className={KICKER}>{ta('failuresKicker')}</div>
              <h2 className="mb-3 mt-1 text-xl leading-tight">{ta('failuresTitle')}</h2>
              {d.failureReasons.length === 0 ? (
                <EmptyState title={ta('failuresEmptyTitle')} message={ta('failuresEmptyBody')} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="border-b border-border bg-muted text-muted-foreground">
                      <tr>
                        <th className={TH}>{ta('colReason')}</th>
                        <th className={`${TH} text-end`}>{ta('colCount')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border align-top">
                      {d.failureReasons.map((r) => (
                        <tr key={r.reason}>
                          <td className="break-words px-3 py-2.5">{reasonText(r.reason)}</td>
                          <td className="px-3 py-2.5 text-end font-mono tabular-nums">
                            {r.count.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className={`${CARD} min-w-0 p-5 lg:col-span-5`}>
              <div className={KICKER}>{ta('sourcesKicker')}</div>
              <h2 className="mb-3 mt-1 text-xl leading-tight">{ta('sourcesTitle')}</h2>
              {d.bySource.length === 0 ? (
                <EmptyState title={ta('sourcesEmptyTitle')} message={ta('sourcesEmptyBody')} />
              ) : (
                <HBars
                  label={ta('sourcesLabel')}
                  color="var(--brand)"
                  rows={d.bySource.map((s) => ({ label: sourceLabel(s.source), value: s.count }))}
                />
              )}
            </div>
          </div>

          <div className={`${CARD} overflow-hidden`}>
            <div className="border-b border-border px-5 py-4">
              <div className={KICKER}>{ta('boardKicker')}</div>
              <h2 className="mt-1 text-xl leading-tight">{ta('boardTitle')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{ta('boardHint')}</p>
            </div>
            {d.leaderboard.length === 0 ? (
              <div className="p-4">
                <EmptyState title={ta('boardEmptyTitle')} message={ta('boardEmptyBody')} />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[12.5px]">
                  <thead className="border-b border-border bg-muted text-muted-foreground">
                    <tr>
                      <th className={TH}>{ta('colFlow')}</th>
                      <th className={`${TH} text-end`}>{ta('colRuns')}</th>
                      <th className={`${TH} text-end`}>{ta('colCompleted')}</th>
                      <th className={`${TH} text-end`}>{ta('colFailed')}</th>
                      <th className={`${TH} text-end`}>{ta('colRate')}</th>
                      <th className={TH}>
                        <span className="sr-only">{ta('colSubscribers')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {d.leaderboard.map((f) => (
                      <tr
                        key={f.flowId}
                        className={cn('hover:bg-muted/50', f.flowId === flowId && 'bg-muted')}
                      >
                        <td className="max-w-[260px] px-3 py-2.5">
                          <button
                            type="button"
                            className="block max-w-full truncate text-start font-semibold hover:underline"
                            aria-pressed={f.flowId === flowId}
                            onClick={() => go({ flowId: f.flowId === flowId ? '' : f.flowId })}
                          >
                            {f.flowName || t('common.unknownFlow', { id: shortId(f.flowId) })}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-end font-mono tabular-nums">
                          {f.runs.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-end font-mono tabular-nums">
                          {f.completed.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-end font-mono tabular-nums">
                          {f.failed.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-end font-mono tabular-nums">
                          {percent(flowRate(f)) ?? t('common.noValue')}
                        </td>
                        <td className="px-3 py-2.5 text-end">
                          <Link
                            href={`/flow-runtime/flows/${f.flowId}`}
                            className="text-xs font-semibold text-brand hover:underline"
                          >
                            {ta('colSubscribers')}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
