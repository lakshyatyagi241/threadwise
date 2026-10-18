'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { CallAnalytics } from '@crm/contracts';
import { Alert, Button, EmptyState, Select, Spinner, StatTile, cn } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { AGENT_IGNORE, AGENT_PII } from '@/lib/agent-marks';
import { usePlanFeature } from '@/lib/plan-features';
import { useCallAnalytics, useCallLogFilters, useCallLogsLive } from '../api/call-logs';
import {
  barHeights,
  durationText,
  forPlan,
  heatGrid,
  heatLevel,
  logSearch,
  parseLogParams,
  percentText,
  toAnalyticsQuery,
  WHATSAPP_CALLING,
  type LogParams,
} from '../lib/call-logs';
import { CallLogsTabs, RangeCard } from './call-logs-screen';
import { useErrorText } from './use-error-text';

/**
 * `/call-logs/analytics`: calls over time, the share answered, who took them, the busiest hours of the week and the average handle
 * time. Reference has no such page (its log is a list); this is a product extension drawn from the same calls. Figures are for the
 * calls the person may see, counted in the person's own time zone.
 */
export function CallAnalyticsScreen() {
  const t = useTranslations('calling-voice.analytics');
  const errorText = useErrorText();
  useCallLogsLive();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const whatsapp = usePlanFeature(WHATSAPP_CALLING);
  const params = useMemo(() => forPlan(parseLogParams(sp), whatsapp), [sp, whatsapp]);
  const tz = useSession().effectiveTimezone || 'UTC';
  const q = useCallAnalytics(toAnalyticsQuery(params, tz));
  const filters = useCallLogFilters();
  // The WhatsApp numbers are a WhatsApp calling filter: a workspace without it has none to choose from.
  const numbers = whatsapp ? (filters.data?.numbers ?? []) : [];

  const go = (patch: Partial<LogParams>) =>
    router.replace(
      `${pathname}${logSearch({
        range: params.range,
        from: params.from,
        to: params.to,
        numberId: params.numberId,
        ...patch,
      })}`,
      { scroll: false },
    );
  const data = q.data;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-7 sm:px-6 lg:px-7">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-3 self-start lg:sticky lg:top-6">
          <RangeCard params={params} go={go} />
          {numbers.length > 1 && (
            <div className="rounded-xl border border-border bg-background p-3">
              <label className="block text-xs">
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('number')}
                </span>
                <Select
                  value={params.numberId ?? ''}
                  onChange={(e) => go({ numberId: e.target.value || undefined })}
                >
                  <option value="">{t('allNumbers')}</option>
                  {numbers.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          )}
        </aside>

        <section className="min-w-0 space-y-5" aria-busy={q.isFetching}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {t('eyebrow')}
              </div>
              <h1 className="mt-1 text-3xl font-normal leading-none tracking-tight sm:text-4xl">
                {t('title')}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
            </div>
            <CallLogsTabs active="analytics" />
          </div>

          {q.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner label={t('loading')} /> {t('loading')}
            </div>
          )}
          {q.isError && !data && (
            <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {t('loadFailed')} {errorText(q.error)}
              </span>
              <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
                {t('retry')}
              </Button>
            </Alert>
          )}
          {data &&
            (data.totals.total === 0 ? (
              <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
            ) : (
              <Charts data={data} />
            ))}
        </section>
      </div>
    </main>
  );
}

function Charts({ data }: { data: CallAnalytics }) {
  const t = useTranslations('calling-voice.analytics');
  const { totals } = data;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {t('period', { from: data.from, to: data.to, tz: data.tz })}
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label={t('kpi.total')} value={totals.total} />
        <StatTile
          label={t('kpi.answeredRate')}
          value={percentText(totals.answeredRate)}
          hint={t('kpi.answeredOf', { answered: totals.answered })}
          tone="accent"
        />
        <StatTile label={t('kpi.missed')} value={totals.missed} />
        <StatTile
          label={t('kpi.avgHandle')}
          value={durationText(totals.avgHandleSec)}
          hint={t('kpi.avgHandleHint')}
        />
        <StatTile label={t('kpi.totalMinutes')} value={totals.totalMinutes} />
      </div>
      <OverTime data={data} />
      <ByAgent data={data} />
      <Heatmap data={data} />
    </>
  );
}

function Panel({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border bg-background p-5">
      <h2 id={id} className="text-base font-medium">
        {title}
      </h2>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Calls per day, as bars: answered at the bottom, the rest above. The numbers are also in a table for screen readers. */
function OverTime({ data }: { data: CallAnalytics }) {
  const t = useTranslations('calling-voice.analytics.overTime');
  const format = useFormatter();
  const total = barHeights(data.series.map((d) => d.total));
  const day = (d: string) =>
    format.dateTime(new Date(`${d}T12:00:00Z`), {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  const step = Math.max(1, Math.ceil(data.series.length / 8));
  return (
    <Panel id="over-time" title={t('title')} hint={t('hint')}>
      <div
        dir="ltr"
        className="flex h-44 items-end gap-px sm:gap-0.5"
        role="img"
        aria-label={t('summary', { total: data.totals.total, days: data.series.length })}
      >
        {data.series.map((d, i) => {
          const h = total[i]! * 100;
          const answeredShare = d.total === 0 ? 0 : (d.answered / d.total) * 100;
          return (
            <div
              key={d.day}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${day(d.day)}: ${d.total}`}
            >
              <div
                className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm bg-warning/40"
                style={{ height: `${h}%` }}
              >
                <div className="w-full bg-success" style={{ height: `${answeredShare}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div
        dir="ltr"
        className="mt-1 flex justify-between text-[10px] text-muted-foreground"
        aria-hidden
      >
        {data.series.map((d, i) => (
          <span key={d.day} className="min-w-0 flex-1 text-center">
            {i % step === 0 ? day(d.day) : ''}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-success" />
          {t('answered')}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-warning/40" />
          {t('other')}
        </span>
      </div>
      <table className="sr-only">
        <caption>{t('title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('day')}</th>
            <th scope="col">{t('calls')}</th>
            <th scope="col">{t('answered')}</th>
            <th scope="col">{t('missed')}</th>
          </tr>
        </thead>
        <tbody>
          {data.series.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{d.total}</td>
              <td>{d.answered}</td>
              <td>{d.missed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function ByAgent({ data }: { data: CallAnalytics }) {
  const t = useTranslations('calling-voice.analytics.byAgent');
  return (
    <Panel id="by-agent" title={t('title')}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="py-2 text-start font-medium">
                {t('agent')}
              </th>
              <th scope="col" className="py-2 text-end font-medium">
                {t('calls')}
              </th>
              <th scope="col" className="py-2 text-end font-medium">
                {t('answered')}
              </th>
              <th scope="col" className="py-2 text-end font-medium">
                {t('avgHandle')}
              </th>
              <th scope="col" className="py-2 text-end font-medium">
                {t('minutes')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.byAgent.map((a) => (
              <tr key={a.agentId ?? 'none'} className="border-b border-border last:border-0">
                <th
                  scope="row"
                  className="py-2 text-start font-normal"
                  {...AGENT_PII}
                  {...AGENT_IGNORE}
                >
                  {a.name ?? (
                    <span className="italic text-muted-foreground">{t('unassigned')}</span>
                  )}
                </th>
                <td className="py-2 text-end tabular-nums">{a.calls}</td>
                <td className="py-2 text-end tabular-nums">{a.answered}</td>
                <td className="py-2 text-end font-mono tabular-nums">
                  {durationText(a.avgHandleSec)}
                </td>
                <td className="py-2 text-end tabular-nums">{a.totalMinutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const HEAT = [
  'bg-muted/40',
  'bg-primary/20',
  'bg-primary/40',
  'bg-primary/70',
  'bg-primary text-primary-foreground',
] as const;

/** Calls by hour of the week: seven rows, 24 columns, darker is busier. Each cell says its count to a screen reader. */
function Heatmap({ data }: { data: CallAnalytics }) {
  const t = useTranslations('calling-voice.analytics.heatmap');
  const format = useFormatter();
  const { grid, max } = heatGrid(data.heatmap);
  const weekday = (d: number) =>
    format.dateTime(new Date(Date.UTC(2024, 0, 7 + d, 12)), { weekday: 'short', timeZone: 'UTC' });
  return (
    <Panel id="heatmap" title={t('title')} hint={t('hint', { tz: data.tz })}>
      <div className="overflow-x-auto">
        <div dir="ltr" role="table" aria-label={t('title')} className="min-w-[560px] text-[10px]">
          <div role="row" className="flex">
            <div role="columnheader" className="w-10 shrink-0">
              <span className="sr-only">{t('weekday')}</span>
            </div>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} role="columnheader" className="flex-1 text-center text-muted-foreground">
                {h % 3 === 0 ? h : <span className="sr-only">{h}</span>}
              </div>
            ))}
          </div>
          {grid.map((row, d) => (
            <div key={d} role="row" className="flex">
              <div
                role="rowheader"
                className="w-10 shrink-0 py-1 pe-1 text-end text-muted-foreground"
              >
                {weekday(d)}
              </div>
              {row.map((calls, h) => (
                <div
                  key={h}
                  role="cell"
                  title={t('cell', { day: weekday(d), hour: h, calls })}
                  aria-label={t('cell', { day: weekday(d), hour: h, calls })}
                  className={cn(
                    'm-px flex-1 rounded-sm py-1.5 text-center',
                    HEAT[heatLevel(calls, max)],
                  )}
                >
                  <span aria-hidden className={calls ? '' : 'sr-only'}>
                    {calls || ''}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
