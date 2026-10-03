'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { DASH_RANGES, dashRangeSchema, type DashRange } from '@crm/contracts';
import { Button, Card, Select, Spinner, cn } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useSummary, useThroughput, useWidgets } from '../api/hooks';
import { compact, greetingKey, throughputCsv } from '../lib/format';
import { BarChart, Legend, Sparkline } from './charts';
import {
  ActivityCard,
  CampaignsCard,
  ContactsCard,
  DevicesCard,
  InboxCard,
  PipelineStrip,
  TemplatesCard,
  WalletOrAutopilotCard,
} from './dashboard-cards';
import { Funnel, LoadError, Panel, Trend } from './parts';
import { QuickAccess } from './quick-access';

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

/** `/dashboard` (TW-DASH-001..021): the operator dashboard, cards in the order Reference shows them. */
export function DashboardScreen() {
  const t = useTranslations('dashboards-analytics-charts.dashboard');
  const tr = useTranslations('dashboards-analytics-charts.range');
  const locale = useLocale();
  const session = useSession();
  const [range, setRange] = useRange();
  const summary = useSummary(range);
  const flow = useThroughput(range);
  const widgets = useWidgets(range);
  const tz = session.org.timezone ?? 'UTC';
  const name = session.user.displayName ?? session.user.fullName;

  const s = summary.data;
  const f = flow.data;
  const w = widgets.data;
  const label = (iso: string) =>
    new Intl.DateTimeFormat(
      locale,
      f?.bucket === 'hour'
        ? { timeZone: f.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
        : { timeZone: f?.timezone ?? tz, month: 'short', day: 'numeric' },
    ).format(new Date(iso));
  const running = w?.campaigns.running ?? 0;

  const exportCsv = () => {
    if (!f) return;
    const csv = throughputCsv(
      f.starts.map((start, i) => ({
        label: label(start),
        sent: f.sent[i] ?? 0,
        delivered: f.delivered[i] ?? 0,
        failed: f.failed[i] ?? 0,
      })),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('kicker')}
          </p>
          <h1 className="font-serif text-2xl leading-tight sm:text-4xl">
            {t(`greeting.${greetingKey(new Date(), tz)}`, { name })}{' '}
            <em className="text-primary">
              {running > 0 ? t('running', { n: running }) : t('calm')}
            </em>
          </h1>
          {s && (
            <p className="text-sm text-muted-foreground">
              {t('subline', {
                date: new Intl.DateTimeFormat(locale, {
                  timeZone: tz,
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                }).format(new Date()),
                range: tr(`long.${range}`),
                sent: s.current.sent,
                rate: s.current.deliverability,
                devices: w?.devices.online ?? 0,
              })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!f}>
            {t('export')}
          </Button>
          <Select
            aria-label={tr('label')}
            className="h-9 w-auto"
            value={range}
            onChange={(e) => setRange(e.target.value as DashRange)}
          >
            {DASH_RANGES.map((r) => (
              <option key={r} value={r}>
                {tr(`long.${r}`)}
              </option>
            ))}
          </Select>
          <Link
            href="/campaigns/create"
            className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            + {t('newCampaign')}
          </Link>
          {summary.isFetching && <Spinner />}
        </div>
      </header>

      {summary.error && !s ? (
        <LoadError error={summary.error} />
      ) : (
        <>
          <section aria-label={t('kpis')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="space-y-3" data-testid="card-sent">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {t('kpi.sent', { range: tr(`short.${range}`) })}
                </p>
                {s && <Trend delta={s.sentDeltaPct} />}
              </div>
              <p className="text-3xl font-semibold leading-none tabular-nums">
                {s ? s.current.sent.toLocaleString(locale) : '-'}
              </p>
              {s && (
                <>
                  <Sparkline values={s.sparkline} label={t('sparkline.title')} />
                  <p className="text-xs text-muted-foreground">
                    {t('kpi.sentLegend', {
                      delivered: s.current.delivered,
                      failed: s.current.failed,
                    })}
                  </p>
                </>
              )}
            </Card>
            <Card className="space-y-3" data-testid="card-read">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-muted-foreground">{t('kpi.readRate')}</p>
                {s && <Trend delta={s.readRateDeltaPp} unit="pp" />}
              </div>
              <p className="text-3xl font-semibold leading-none tabular-nums">
                {s ? `${s.current.readRate}%` : '-'}
              </p>
              {s && (
                <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-md border border-border p-1.5">
                    <dt className="text-muted-foreground">{t('kpi.readMini.sent')}</dt>
                    <dd className="font-semibold tabular-nums">{compact(s.current.sent)}</dd>
                  </div>
                  <div className="rounded-md border border-border p-1.5">
                    <dt className="text-muted-foreground">{t('kpi.readMini.delivered')}</dt>
                    <dd className="font-semibold tabular-nums">{s.current.deliverability}%</dd>
                  </div>
                  <div className="rounded-md border border-border p-1.5">
                    <dt className="text-muted-foreground">{t('kpi.readMini.read')}</dt>
                    <dd className="font-semibold tabular-nums">{s.current.readRate}%</dd>
                  </div>
                </dl>
              )}
            </Card>
            {w ? <ContactsCard data={w.contacts} /> : <Card className="min-h-32" />}
            <WalletOrAutopilotCard />
          </section>

          {w?.pipeline && <PipelineStrip data={w.pipeline} />}

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
            {w ? <InboxCard data={w.inbox} /> : <Card className="min-h-32" />}
          </div>

          {w && (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <CampaignsCard data={w.campaigns} />
                <DevicesCard data={w.devices} />
              </div>
              <TemplatesCard data={w.templates} />
            </>
          )}

          <QuickAccess />

          <div className="grid gap-4 lg:grid-cols-2">
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
            {w && <ActivityCard data={w.activity} />}
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
