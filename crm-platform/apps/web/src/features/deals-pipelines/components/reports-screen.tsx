'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Alert, EmptyState, Select, Spinner, StatTile } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { usePipelines, useReport } from '../api/hooks';
import { monthLabel, toDateInput } from '../lib/format';
import { formatMoney } from '../lib/money';
import { StageValueChart, WonLostChart } from './charts';
import { ArrowLeftIcon, ChartIcon } from './icons';
import { Avatar, ErrorLine } from './parts';

const RANGES = ['all', '30', '90', 'year'] as const;
type Range = (typeof RANGES)[number];

/** The closed-deal window for a preset, as `YYYY-MM-DD` (empty = no bound). */
function windowFor(range: Range, now: Date = new Date()): { from: string; to: string } {
  const to = toDateInput(now);
  if (range === 'all') return { from: '', to: '' };
  if (range === 'year') return { from: `${now.getFullYear()}-01-01`, to };
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(range));
  return { from: toDateInput(from), to };
}

/** `/deals/reports` (WD-DEAL-019/020): KPI tiles, value by stage, won against lost per month, lost reasons, leaderboard. */
export function ReportsScreen() {
  const t = useTranslations('deals-pipelines.reports');
  const locale = useLocale();
  const session = useSession();
  const pipelines = usePipelines();
  const [pipelineId, setPipelineId] = useState('');
  const [range, setRange] = useState<Range>('all');
  const picked = (pipelines.data ?? []).find((p) => p.id === pipelineId);
  // Figures are shown in the chosen pipeline's currency; for all pipelines, the default pipeline's (else the workspace's).
  const fallback = (pipelines.data ?? []).find((p) => p.isDefault) ?? pipelines.data?.[0];
  const currency = picked?.currency ?? fallback?.currency ?? session.org.currency ?? 'USD';
  const win = useMemo(() => windowFor(range), [range]);
  const report = useReport({ pipelineId, from: win.from, to: win.to, currency });
  const r = report.data;
  const money = (n: number) => formatMoney(n, currency, locale);
  const closed = (r?.wonCount ?? 0) + (r?.lostCount ?? 0);
  const empty = r !== undefined && r.openCount === 0 && closed === 0;
  const topReason = Math.max(...(r?.lostReasons.map((x) => x.count) ?? [0]), 1);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-background p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground"
          >
            <ChartIcon className="size-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {r === undefined
                ? t('subtitle')
                : empty
                  ? t('emptySubtitle')
                  : t('summary', {
                      rate: r.winRate,
                      open: r.openCount,
                      value: money(r.openValueMinor),
                    })}
            </p>
          </div>
        </div>
        <Link
          href="/deals"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          <ArrowLeftIcon /> {t('back')}
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('filters')}>
        {(pipelines.data?.length ?? 0) > 0 && (
          <Select
            aria-label={t('pipeline')}
            className="w-auto min-w-44"
            value={pipelineId}
            onChange={(e) => setPipelineId(e.target.value)}
          >
            <option value="">{t('allPipelines')}</option>
            {(pipelines.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label={t('range')}
          className="w-auto min-w-44"
          value={range}
          onChange={(e) => setRange(e.target.value as Range)}
        >
          {RANGES.map((x) => (
            <option key={x} value={x}>
              {t(`ranges.${x}`)}
            </option>
          ))}
        </Select>
        {report.isFetching && !report.isPending && <Spinner />}
      </div>

      {report.isPending && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-busy="true" aria-label={t('loading')}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}
      {report.isError && <ErrorLine error={report.error} onRetry={() => void report.refetch()} />}

      {r && (
        <>
          {r.unconverted.length > 0 && (
            <Alert tone="warning">{t('unconverted', { currencies: r.unconverted.join(', ') })}</Alert>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile label={t('kpi.openValue')} value={money(r.openValueMinor)} hint={t('kpi.openValueHint', { count: r.openCount })} className="[&_div:nth-child(2)]:text-2xl" />
            <StatTile label={t('kpi.forecast')} value={money(r.forecastMinor)} hint={t('kpi.forecastHint')} className="[&_div:nth-child(2)]:text-2xl" />
            <StatTile label={t('kpi.wonValue')} value={money(r.wonValueMinor)} hint={t('kpi.wonValueHint', { count: r.wonCount })} tone="accent" className="[&_div:nth-child(2)]:text-2xl" />
            <StatTile label={t('kpi.winRate')} value={`${r.winRate}%`} hint={t('kpi.winRateHint', { won: r.wonCount, lost: r.lostCount })} className="[&_div:nth-child(2)]:text-2xl" />
            <StatTile label={t('kpi.wonThisMonth')} value={money(r.wonThisMonthValueMinor)} hint={t('kpi.wonThisMonthHint', { count: r.wonThisMonthCount })} className="[&_div:nth-child(2)]:text-2xl" />
            <StatTile
              label={t('kpi.avgDays')}
              value={r.avgDaysToClose === null ? '—' : t('kpi.days', { count: r.avgDaysToClose })}
              hint={t('kpi.avgDaysHint')}
              className="[&_div:nth-child(2)]:text-2xl"
            />
          </div>

          {empty ? (
            <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-5">
              <section className="rounded-xl border border-border bg-background p-5 lg:col-span-3" aria-labelledby="rep-stage">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('distribution')}</div>
                <h2 id="rep-stage" className="mb-4 text-lg font-semibold">
                  {t('stageTitle')}
                </h2>
                <StageValueChart stages={r.byStage} currency={currency} />
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">{t('viewTable')}</summary>
                  <table className="mt-2 w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1 text-start font-medium">{t('table.stage')}</th>
                        <th className="py-1 text-end font-medium">{t('table.deals')}</th>
                        <th className="py-1 text-end font-medium">{t('table.value')}</th>
                        <th className="py-1 text-end font-medium">{t('table.weighted')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.byStage.filter((s) => s.kind === 'open').map((s) => (
                        <tr key={s.stageId} className="border-t border-border">
                          <td className="py-1">{s.name}</td>
                          <td className="py-1 text-end tabular-nums">{s.count}</td>
                          <td className="py-1 text-end tabular-nums">{money(s.valueMinor)}</td>
                          <td className="py-1 text-end tabular-nums">{money(s.weightedMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </section>

              <section className="rounded-xl border border-border bg-background p-5 lg:col-span-2" aria-labelledby="rep-trend">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('momentum')}</div>
                <h2 id="rep-trend" className="mb-4 text-lg font-semibold">
                  {t('trendTitle')}
                </h2>
                <WonLostChart months={r.months} />
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">{t('viewTable')}</summary>
                  <table className="mt-2 w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1 text-start font-medium">{t('table.month')}</th>
                        <th className="py-1 text-end font-medium">{t('won')}</th>
                        <th className="py-1 text-end font-medium">{t('lost')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.months.map((m) => (
                        <tr key={m.month} className="border-t border-border">
                          <td className="py-1">{monthLabel(m.month, locale)}</td>
                          <td className="py-1 text-end tabular-nums">{m.won}</td>
                          <td className="py-1 text-end tabular-nums">{m.lost}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </section>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-background p-5" aria-labelledby="rep-leaders">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('mostWon')}</div>
                  <h2 id="rep-leaders" className="text-lg font-semibold">
                    {t('leadersTitle')}
                  </h2>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {t('agents', { count: r.leaders.length })}
                </span>
              </div>
              {r.leaders.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">{t('noLeaders')}</p>
              ) : (
                <ol className="divide-y divide-border">
                  {r.leaders.map((l, i) => (
                    <li key={l.userId} className="flex items-center gap-3 py-2.5">
                      <span className="w-5 text-center text-sm font-medium tabular-nums text-muted-foreground">{i + 1}</span>
                      <Avatar name={l.name} className="size-8 text-xs" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{l.name}</div>
                        <div className="text-xs text-muted-foreground">{t('wonCount', { count: l.won })}</div>
                      </div>
                      <div className="text-end">
                        <div className="text-sm font-semibold tabular-nums">{money(l.valueMinor)}</div>
                        <div className="text-xs text-muted-foreground">{t('wonValue')}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="rounded-xl border border-border bg-background p-5" aria-labelledby="rep-lost">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('lostKicker')}</div>
              <h2 id="rep-lost" className="mb-3 text-lg font-semibold">
                {t('lostTitle')}
              </h2>
              {r.lostReasons.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">{t('noLostReasons')}</p>
              ) : (
                <ul className="space-y-3">
                  {r.lostReasons.map((x) => (
                    <li key={x.reason ?? '—'} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-sm">
                      <span className="truncate">{x.reason ?? t('noReason')}</span>
                      <div className="h-3 rounded bg-muted">
                        <div className="h-full rounded bg-danger" style={{ width: `${(x.count / topReason) * 100}%` }} />
                      </div>
                      <span className="w-6 text-end tabular-nums text-muted-foreground">{x.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
