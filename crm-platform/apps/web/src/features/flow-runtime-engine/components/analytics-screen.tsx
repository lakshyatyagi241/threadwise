'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, Input, Select, Spinner, StatTile, Tabs, cn } from '@crm/ui';
import type { FlowAnalytics } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { refreshAll, useAnalytics, useFlowOptions } from '../api/flow-runtime';
import {
  RANGES,
  TABS,
  isCustomRange,
  analyticsStateToSearch,
  parseAnalyticsState,
  type AnalyticsState,
} from '../lib/history-model';
import { dayLabel, percent, shortId, statusMix } from '../lib/model';
import { HBars, Donut, Legend, TrendChart } from './charts';
import { ErrorsTab } from './errors-tab';
import { HistoryTab, type GoFn } from './history-tab';
import {
  CARD,
  Denied,
  KICKER,
  TH,
  useDateTime,
  useDuration,
  useErrorText,
  useReasonText,
  useSourceLabel,
} from './parts';
import { RetriesTab } from './retries-tab';

const COLORS = {
  running: 'var(--brand)',
  completed: 'var(--success)',
  failed: 'var(--danger)',
  cancelled: 'var(--muted-foreground)',
  expired: 'var(--warning)',
} as const;

/**
 * `/flow-runtime/analytics`: the KPI band, then four tabs (overview, execution history, error logs, retry records). The period
 * (7, 30, 90 days or all time), the flow scope, the tab and the history's filters all live in the address.
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

  const state = useMemo(
    () => parseAnalyticsState(new URLSearchParams(search.toString())),
    [search],
  );
  const go: GoFn = (patch) =>
    router.replace(`${pathname}${analyticsStateToSearch({ ...state, ...patch })}`, {
      scroll: false,
    });

  const a = useAnalytics(state);
  const flows = useFlowOptions();
  const custom = isCustomRange(state);
  const today = new Date().toISOString().slice(0, 10);

  if (!canRead) return <Denied />;

  const d = a.data;
  const rate = d ? percent(d.completionRate) : null;
  const tabLabels: Record<(typeof TABS)[number], string> = {
    overview: ta('tabOverview'),
    history: ta('tabHistory'),
    errors: ta('tabErrors'),
    retries: ta('tabRetries'),
  };

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
          <Select
            className="mt-1"
            value={state.flowId}
            onChange={(e) => go({ flowId: e.target.value })}
          >
            <option value="">{ta('allFlows')}</option>
            {state.flowId && !flows.data?.some((f) => f.id === state.flowId) && (
              <option value={state.flowId}>
                {t('common.unknownFlow', { id: shortId(state.flowId) })}
              </option>
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
          <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={ta('period')}>
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={!custom && state.range === r}
                onClick={() => go({ range: r, from: '', to: '' })}
                className={cn(
                  'rounded-full px-3 py-2 text-xs font-semibold',
                  !custom && state.range === r
                    ? 'bg-brand text-brand-foreground'
                    : 'border border-border hover:bg-muted',
                )}
              >
                {r === 'all' ? ta('rangeAll') : ta('days', { days: Number(r) })}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={custom}
              onClick={() => {
                if (!custom) go({ from: today, to: today });
              }}
              className={cn(
                'rounded-full px-3 py-2 text-xs font-semibold',
                custom ? 'bg-brand text-brand-foreground' : 'border border-border hover:bg-muted',
              )}
            >
              {ta('rangeCustom')}
            </button>
          </div>
        </div>
        {custom && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className={KICKER}>{ta('rangeFrom')}</span>
              <Input
                type="date"
                className="mt-1 h-9 w-auto rounded-full px-3 text-xs"
                value={state.from}
                max={state.to || today}
                onChange={(e) => go({ from: e.target.value })}
              />
            </label>
            <label className="block">
              <span className={KICKER}>{ta('rangeTo')}</span>
              <Input
                type="date"
                className="mt-1 h-9 w-auto rounded-full px-3 text-xs"
                value={state.to}
                min={state.from || undefined}
                max={today}
                onChange={(e) => go({ to: e.target.value })}
              />
            </label>
            {state.from && state.to && state.from > state.to && (
              <p role="status" className="basis-full text-xs text-danger">
                {ta('rangeInvalid')}
              </p>
            )}
          </div>
        )}
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

          <Extras extras={d.extras} />

          <Tabs
            value={state.tab}
            onValueChange={(id) => go({ tab: id as AnalyticsState['tab'] })}
            items={[
              {
                id: 'overview',
                label: tabLabels.overview,
                content: <Overview d={d} state={state} go={go} />,
              },
              {
                id: 'history',
                label: tabLabels.history,
                content: <HistoryTab state={state} go={go} />,
              },
              {
                id: 'errors',
                label: tabLabels.errors,
                content: <ErrorsTab state={state} go={go} />,
              },
              {
                id: 'retries',
                label: tabLabels.retries,
                content: <RetriesTab state={state} go={go} />,
              },
            ]}
          />
        </div>
      )}
    </main>
  );
}

/** The second band: reach, paused subscribers, retries and how many flows exist or ran (WaDesk's secondary counters). */
function Extras({ extras }: { extras: FlowAnalytics['extras'] }) {
  const ta = useTranslations('flr.analytics');
  const items: Array<[string, number]> = [
    [ta('extraContacts'), extras.contactsReached],
    [ta('extraPaused'), extras.pausedSubscribers],
    [ta('extraRetried'), extras.retriedRuns],
    [ta('extraAttempts'), extras.retryAttempts],
    [ta('extraLive'), extras.flowsLive],
    [ta('extraWithRuns'), extras.flowsWithRuns],
    [ta('extraTotal'), extras.flowsTotal],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-2 text-[11.5px]">
      {items.map(([label, n]) => (
        <li
          key={label}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-muted-foreground shadow-sm"
        >
          {label}
          <b className="font-mono text-foreground">{n.toLocaleString()}</b>
        </li>
      ))}
    </ul>
  );
}

function Overview({ d, state, go }: { d: FlowAnalytics; state: AnalyticsState; go: GoFn }) {
  const t = useTranslations('flr');
  const ta = useTranslations('flr.analytics');
  const when = useDateTime();
  const reasonText = useReasonText();
  const sourceLabel = useSourceLabel();
  const hasRuns = d.totals.enrolled + d.totals.running > 0;
  const mix = statusMix(d.totals);
  const mixTotal = mix.reduce((n, m) => n + m.value, 0);

  return (
    <div className="space-y-5 pt-5">
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
            <>
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
                        <td className="break-words px-3 py-2.5">
                          {reasonText(r.reason)}
                          {r.lastSeen && (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {r.firstSeen
                                ? ta('seenBoth', {
                                    first: when(r.firstSeen),
                                    last: when(r.lastSeen),
                                  })
                                : ta('seenLast', { last: when(r.lastSeen) })}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-end font-mono tabular-nums">
                          {r.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3 rounded-full"
                onClick={() => go({ tab: 'errors' })}
              >
                {ta('openErrorLogs')}
              </Button>
            </>
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
            <table className="w-full min-w-[720px] text-[12.5px]">
              <thead className="border-b border-border bg-muted text-muted-foreground">
                <tr>
                  <th className={TH}>{ta('colFlow')}</th>
                  <th className={`${TH} text-end`}>{ta('colRuns')}</th>
                  <th className={`${TH} text-end`}>{ta('colCompleted')}</th>
                  <th className={`${TH} text-end`}>{ta('colFailed')}</th>
                  <th className={`${TH} text-end`}>{ta('colRate')}</th>
                  <th className={`${TH} text-end`}>{ta('colFailRate')}</th>
                  <th className={TH}>
                    <span className="sr-only">{ta('colSubscribers')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.leaderboard.map((f) => (
                  <tr
                    key={f.flowId}
                    className={cn('hover:bg-muted/50', f.flowId === state.flowId && 'bg-muted')}
                  >
                    <td className="max-w-[260px] px-3 py-2.5">
                      <button
                        type="button"
                        className="block max-w-full truncate text-start font-semibold hover:underline"
                        aria-pressed={f.flowId === state.flowId}
                        onClick={() => go({ flowId: f.flowId === state.flowId ? '' : f.flowId })}
                      >
                        {f.flowName || t('common.unknownFlow', { id: shortId(f.flowId) })}
                      </button>
                      <span className="text-[11px] text-muted-foreground">
                        {ta(`state.${f.state}`)}
                      </span>
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
                      {f.completionRate === null ? t('common.noValue') : `${f.completionRate}%`}
                    </td>
                    <td className="px-3 py-2.5 text-end font-mono tabular-nums">
                      {f.failureRate === null ? t('common.noValue') : `${f.failureRate}%`}
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
  );
}
