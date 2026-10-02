'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { DASH_RANGES, dashRangeSchema, type DashRange } from '@crm/contracts';
import { Spinner, StatTile, cn } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useSummary, useThroughput } from '../api/hooks';
import { compact, greetingKey } from '../lib/format';
import { BarChart, Legend, Sparkline } from './charts';
import { Funnel, LoadError, Panel, Trend } from './parts';

/** The range lives in the address so a link is shareable; anything unknown reads as 7d (TW-DASH-003). */
function useRange(): [DashRange, (r: DashRange) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const parsed = dashRangeSchema.safeParse(params.get('range'));
  const range: DashRange = parsed.success ? parsed.data : '7d';
  return [range, (r) => router.replace(`${path}?range=${r}`)];
}

export function RangePicker({
  value,
  onChange,
  ranges,
}: {
  value: string;
  onChange: (r: never) => void;
  ranges: readonly string[];
}) {
  const t = useTranslations('dashboards-analytics-charts.range');
  return (
    <div
      role="group"
      aria-label={t('label')}
      className="inline-flex rounded-md border border-border p-0.5"
    >
      {ranges.map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={value === r}
          onClick={() => (onChange as (r: string) => void)(r)}
          className={cn(
            'rounded px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary',
            value === r
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t(`short.${r}`)}
        </button>
      ))}
    </div>
  );
}

/** `/dashboard` (TW-DASH-001..005, 012, 018): KPI cards, throughput chart, funnel. */
export function DashboardScreen() {
  const t = useTranslations('dashboards-analytics-charts.dashboard');
  const tr = useTranslations('dashboards-analytics-charts.range');
  const locale = useLocale();
  const session = useSession();
  const [range, setRange] = useRange();
  const summary = useSummary(range);
  const flow = useThroughput(range);
  const tz = session.org.timezone ?? 'UTC';
  const name = session.user.displayName ?? session.user.fullName;

  const s = summary.data;
  const f = flow.data;
  const label = (iso: string) =>
    new Intl.DateTimeFormat(
      locale,
      f?.bucket === 'hour'
        ? { timeZone: f.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
        : { timeZone: f?.timezone ?? tz, month: 'short', day: 'numeric' },
    ).format(new Date(iso));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {t(`greeting.${greetingKey(new Date(), tz)}`, { name })}
          </h1>
          {s && (
            <p className="text-sm text-muted-foreground">
              {t('subline', {
                range: tr(`long.${range}`),
                sent: s.current.sent,
                rate: s.current.deliverability,
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <RangePicker
            value={range}
            onChange={setRange as (r: never) => void}
            ranges={DASH_RANGES}
          />
          {summary.isFetching && <Spinner />}
        </div>
      </header>

      {summary.error && !s ? (
        <LoadError error={summary.error} />
      ) : (
        <>
          <section aria-label={t('kpis')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label={t('kpi.sent', { range: tr(`short.${range}`) })}
              value={s ? s.current.sent.toLocaleString(locale) : '–'}
              hint={
                s && (
                  <span className="flex flex-wrap items-center gap-2">
                    <Trend delta={s.sentDeltaPct} />
                    {t('kpi.sentLegend', {
                      delivered: s.current.delivered,
                      failed: s.current.failed,
                    })}
                  </span>
                )
              }
            />
            <StatTile
              label={t('kpi.readRate')}
              value={s ? `${s.current.readRate}%` : '–'}
              hint={s && <Trend delta={s.readRateDeltaPp} unit="pp" />}
            />
            <StatTile
              label={t('kpi.deliverability')}
              value={s ? `${s.current.deliverability}%` : '–'}
              hint={
                s && t('kpi.deliveredOf', { delivered: s.current.delivered, sent: s.current.sent })
              }
            />
            <StatTile
              label={t('kpi.replies')}
              value={s ? s.current.replies.toLocaleString(locale) : '–'}
              hint={s && t('kpi.replyRate', { rate: s.current.replyRate })}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title={t('throughput.title')}
              subtitle={t(`throughput.subtitle.${range}`)}
              action={
                f?.peak ? (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs">
                    {t('throughput.peak', { when: label(f.peak.start), n: f.peak.count })}
                  </span>
                ) : null
              }
            >
              {f ? (
                <>
                  <BarChart
                    label={t('throughput.title')}
                    labels={f.starts.map(label)}
                    series={[
                      { name: t('throughput.sent'), values: f.sent, color: 'var(--brand)' },
                      {
                        name: t('throughput.delivered'),
                        values: f.delivered,
                        color: 'var(--success)',
                      },
                      { name: t('throughput.failed'), values: f.failed, color: 'var(--danger)' },
                    ]}
                  />
                  {s && (
                    <>
                      <Legend
                        series={[
                          {
                            name: t('throughput.sent'),
                            color: 'var(--brand)',
                            total: s.current.sent,
                          },
                          {
                            name: t('throughput.delivered'),
                            color: 'var(--success)',
                            total: s.current.delivered,
                          },
                          {
                            name: t('throughput.failed'),
                            color: 'var(--danger)',
                            total: s.current.failed,
                          },
                        ]}
                      />
                      <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm sm:grid-cols-4">
                        <Tile label={t('throughput.avgHour')} value={compact(f.avgPerHour)} />
                        <Tile label={t('throughput.replies')} value={compact(s.current.replies)} />
                        <Tile label={t('throughput.replyRate')} value={`${s.current.replyRate}%`} />
                        <Tile label={t('throughput.failed')} value={compact(s.current.failed)} />
                      </dl>
                    </>
                  )}
                </>
              ) : flow.error ? (
                <LoadError error={flow.error} />
              ) : (
                <Spinner />
              )}
            </Panel>

            <div className="space-y-4">
              <Panel title={t('sparkline.title')} subtitle={t('sparkline.subtitle')}>
                {s ? <Sparkline values={s.sparkline} label={t('sparkline.title')} /> : <Spinner />}
              </Panel>
              <Panel
                title={t('funnel.title')}
                subtitle={tr(`long.${range}`)}
                action={
                  <Link href="/analytics" className="text-xs font-medium text-primary underline">
                    {t('funnel.viewAll')}
                  </Link>
                }
              >
                {s ? <Funnel funnel={s.funnel} /> : <Spinner />}
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
