'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { DASH_RANGES, dashRangeSchema, type DashRange } from '@crm/contracts';
import { Button, Card, Input, Select, Spinner, cn } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import { useSummary, useThroughput, useWidgets } from '../api/hooks';
import { flash } from '@/features/admin-console-shell/flash/flash-store';
import type { CustomDates } from '../api/service';
import { compact, greetingKey, isForbidden, throughputCsv } from '../lib/format';
import { BarChart, Sparkline, Legend } from './charts';
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
import { Funnel } from './funnel';
import { LoadError, Panel, Trend } from './parts';
import { QuickAccessTiles } from '@/features/admin-console-shell/quick-access/quick-access-tiles';
import {
  CopilotCard,
  FlowsCard,
  InstagramBand,
  IntegrationsCard,
  QuickActionsCard,
} from './dashboard-extras';

/** The range lives in the address so a link is shareable; anything unknown reads as 7d (TW-DASH-003). */
function useRange(): [DashRange, CustomDates, (r: DashRange, c?: CustomDates) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const parsed = dashRangeSchema.safeParse(params.get('range'));
  const range: DashRange = parsed.success ? parsed.data : '7d';
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = params.get('from');
  const to = params.get('to');
  const custom: CustomDates = {
    ...(from && iso.test(from) ? { from } : {}),
    ...(to && iso.test(to) ? { to } : {}),
  };
  return [
    range,
    range === 'custom' ? custom : {},
    (r, c = {}) => {
      const q = new URLSearchParams({ range: r });
      if (r === 'custom') {
        if (c.from) q.set('from', c.from);
        if (c.to) q.set('to', c.to);
      }
      router.replace(`${path}?${q.toString()}`);
    },
  ];
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
  const unofficial = useUnofficialWhatsapp();
  const tr = useTranslations('dashboards-analytics-charts.range');
  const locale = useLocale();
  const session = useSession();
  const [range, custom, setRange] = useRange();
  const [draft, setDraft] = useState<CustomDates>({});
  const summary = useSummary(range, custom);
  const flow = useThroughput(range, custom);
  const widgets = useWidgets(range, custom);
  const router = useRouter();
  const bounced = isForbidden(summary.error);
  // Reference sends an agent or viewer to the team inbox rather than showing an error.
  const role = session.roles[0]?.name ?? 'Member';
  useEffect(() => {
    if (!bounced) return;
    // Reference's warning flash: "Your role (x) doesn't have access to that page" (rendered by the shell's flash host).
    flash('roleDenied', 'warning', { role });
    router.replace('/inbox');
  }, [bounced, role, router]);
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    const t0 = setTimeout(() => setNowMs(Date.now()), 0);
    return () => {
      clearInterval(id);
      clearTimeout(t0);
    };
  }, []);
  const syncedAgo = summary.dataUpdatedAt
    ? Math.max(0, Math.round((nowMs - summary.dataUpdatedAt) / 1000))
    : null;
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
      {/* Sticky under the 56px top bar (`top-14`); the bleed (-mx / px) lets its background cover the page padding while the cards scroll beneath it. */}
      <header className="sticky top-14 z-30 -mx-4 -mt-4 flex flex-wrap items-end justify-between gap-3 border-b border-border bg-background px-4 pb-3 pt-4 md:-mx-6 md:-mt-6 md:px-6 md:pt-6">
        {/* The whole heading block is Inter, weight 600 (the kicker, the greeting and the line under it). */}
        <div className="space-y-1.5 font-[family-name:var(--font-inter)] font-semibold">
          <p className="flex items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            <span>{t('kicker')}</span>
            {syncedAgo !== null && nowMs > 0 && (
              <>
                <span aria-hidden className="size-1 rounded-full bg-muted-foreground/50" />
                <span className="flex items-center gap-1.5" data-testid="live-chip">
                  <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-success" />
                  {t('synced', { s: syncedAgo })}
                </span>
              </>
            )}
          </p>
          <h1 className="text-[32px] leading-tight">
            {t(`greeting.${greetingKey(new Date(), tz)}`, { name })}{' '}
            <em className="text-primary">
              {running > 0 ? t('running', { n: running }) : t('calm')}
            </em>
          </h1>
          {s && (
            <p className="text-sm font-semibold text-muted-foreground">
              {t(unofficial ? 'subline' : 'sublineOfficial', {
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
            onChange={(e) => setRange(e.target.value as DashRange, draft)}
          >
            {DASH_RANGES.map((r) => (
              <option key={r} value={r}>
                {tr(`long.${r}`)}
              </option>
            ))}
          </Select>
          {range === 'custom' && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setRange('custom', draft);
              }}
            >
              <Input
                type="date"
                aria-label={tr('from')}
                className="h-9 w-auto"
                max={draft.to || undefined}
                value={draft.from ?? custom.from ?? ''}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
              <Input
                type="date"
                aria-label={tr('to')}
                className="h-9 w-auto"
                min={draft.from || undefined}
                value={draft.to ?? custom.to ?? ''}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
              <Button type="submit" size="sm">
                {tr('apply')}
              </Button>
            </form>
          )}
          <Link
            href="/campaigns/create"
            className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            + {t('newCampaign')}
          </Link>
          {summary.isFetching && <Spinner />}
        </div>
      </header>

      {bounced ? (
        <Spinner />
      ) : summary.error && !s ? (
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
              <div className="flex items-end gap-3">
                <p className="text-3xl font-semibold leading-none tabular-nums">
                  {s ? `${s.current.readRate}%` : '-'}
                </p>
                {s && <ReadRing pct={s.current.readRate} label={t('kpi.readRate')} />}
              </div>
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

          {w?.instagram && <InstagramBand data={w.instagram} />}

          <QuickAccessTiles />

          {w?.pipeline && <PipelineStrip data={w.pipeline} />}

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-8">
              <Panel
                title={t('throughput.title')}
                subtitle={t(`throughput.subtitle.${range}`)}
                titleBadge={
                  <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11px]">
                    {tzChip(f?.timezone ?? tz)}
                  </span>
                }
                action={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {f?.peak && (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs">
                        {t('throughput.peak', { when: label(f.peak.start), n: f.peak.count })}
                      </span>
                    )}
                    <RangePicker value={range} onChange={setRange} ranges={DASH_RANGES} />
                  </div>
                }
              >
                {f ? (
                  <>
                    {s && (
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
                    )}
                    <BarChart
                      emptyAxes
                      hideLegend
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
                      seriesTotals={
                        s ? [s.current.sent, s.current.delivered, s.current.failed] : undefined
                      }
                    />
                    {s && (
                      <>
                        <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm sm:grid-cols-4">
                          <Tile label={t('throughput.avgHour')} value={compact(f.avgPerHour)} />
                          <Tile
                            label={t('throughput.replies')}
                            value={compact(s.current.replies)}
                          />
                          <Tile
                            label={t('throughput.replyRate')}
                            value={`${s.current.replyRate}%`}
                          />
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

              {w && (
                <>
                  <div className="grid gap-4 lg:grid-cols-12">
                    <div className={unofficial ? 'lg:col-span-7' : 'lg:col-span-12'}>
                      <CampaignsCard data={w.campaigns} />
                    </div>
                    {/* The Devices card counts personal numbers paired by QR: it exists only while the platform has that engine on. */}
                    {unofficial && (
                      <div className="lg:col-span-5">
                        <DevicesCard data={w.devices} />
                      </div>
                    )}
                  </div>
                  <TemplatesCard data={w.templates} />
                </>
              )}
            </div>
            <div className="flex flex-col gap-4 lg:col-span-4">
              {w ? <InboxCard data={w.inbox} /> : <Card className="min-h-32" />}
              {w && (
                <>
                  <CopilotCard data={w.flows} />
                  <FlowsCard data={w.flows} />
                </>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-5">
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
            <div className="md:col-span-1 lg:col-span-4">
              {w && <ActivityCard data={w.activity} />}
            </div>
            <div className="space-y-3 lg:col-span-3">
              {w && (
                <>
                  <QuickActionsCard />
                  <IntegrationsCard data={w.integrations} />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The small ring beside the read rate (Reference's #kpi-readrate): the share read, centre label to one decimal. */
function ReadRing({ pct, label }: { pct: number; label: string }) {
  const p = Math.max(0, Math.min(100, pct));
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={`${label} ${p}%`} className="-mb-1 size-16">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--muted)" strokeWidth="5" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="var(--success)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(c * p) / 100} ${c}`}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="35" textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
        {p.toFixed(1)}
      </text>
    </svg>
  );
}

/** "UTC+1" style label of a zone, as Reference's chip. */
function tzChip(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    return (part ?? 'UTC').replace('GMT', 'UTC');
  } catch {
    return 'UTC';
  }
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
