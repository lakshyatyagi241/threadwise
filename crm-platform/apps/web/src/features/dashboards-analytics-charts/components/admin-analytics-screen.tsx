'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AdminAnalytics } from '@crm/contracts';
import { Alert, Badge, Button, Card, Select, Spinner, cn } from '@crm/ui';
import { adminExportUrl, useAdminAnalytics } from '../api/admin';
import { compact, formatMoney } from '../lib/format';
import { BarChart, Donut } from './charts';
import { Panel } from './parts';

const DAYS = [7, 30, 90, 365] as const;
const TABS = ['overview', 'revenue', 'usage', 'workspaces', 'campaigns', 'support'] as const;
type Tab = (typeof TABS)[number];
const COLORS = [
  'var(--primary)',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
  'var(--muted-foreground)',
  'var(--border)',
];

/** Which tabs show a panel: WaDesk's data-wa-tab-panel map (the Campaigns tab re-shows the plan, acquisition and device panels). */
const SHOWN: Record<string, readonly Tab[]> = {
  kpi: ['overview'],
  growth: ['overview', 'revenue', 'usage', 'workspaces'],
  mix: ['overview', 'usage', 'campaigns'],
  board: ['overview', 'workspaces'],
  money: ['overview', 'revenue', 'support'],
};

/** The operator's analytics page (WD-DASH-041..044): days filter, section tabs over one payload, signups CSV. */
export function AdminAnalyticsScreen({ days }: { days: number }) {
  const t = useTranslations('dashboards-analytics-charts.admin.analytics');
  const tAdmin = useTranslations('dashboards-analytics-charts.admin');
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<Tab>('overview');
  const q = useAdminAnalytics(days);
  const standard = (DAYS as readonly number[]).includes(days);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('kicker')}
          </p>
          <h1 className="font-serif text-3xl leading-tight sm:text-4xl">
            {t('titleLead')} <em className="text-primary">{t('titleAccent')}</em>.
          </h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            aria-label={t('daysLabel')}
            className="w-auto"
            value={String(days)}
            onChange={(e) => router.replace(`${pathname}?days=${e.target.value}`)}
          >
            {!standard && <option value={String(days)}>{t('days.custom', { n: days })}</option>}
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {t(`days.${d}`)}
              </option>
            ))}
          </Select>
          <a
            href={adminExportUrl(days)}
            download
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            {t('export')}
          </a>
        </div>
      </header>

      <div role="tablist" aria-label={t('title')} className="flex flex-wrap gap-1">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary',
              tab === id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
      </div>

      {q.isPending ? (
        <div className="flex min-h-64 items-center justify-center text-muted-foreground">
          <Spinner label={t('title')} />
        </div>
      ) : q.isError ? (
        <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-2">
          <span>{tAdmin('error')}</span>
          <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
            {tAdmin('retry')}
          </Button>
        </Alert>
      ) : (
        <Analytics data={q.data} tab={tab} />
      )}
    </div>
  );
}

function Analytics({ data, tab }: { data: AdminAnalytics; tab: Tab }) {
  const t = useTranslations('dashboards-analytics-charts.admin.analytics');
  const locale = useLocale();
  const show = (key: keyof typeof SHOWN) => SHOWN[key]!.includes(tab);
  const k = data.kpis;
  const onlinePct = k.devicesTotal > 0 ? Math.round((k.devicesOnline / k.devicesTotal) * 100) : 0;
  const pulse = [
    { id: 'workspaces', pct: Math.min(100, k.workspaces) },
    { id: 'devices', pct: onlinePct },
    { id: 'tickets', pct: Math.min(100, k.openTickets * 5) },
    { id: 'signups', pct: Math.min(100, k.newUsers) },
  ] as const;
  const planTotal = data.planMix.reduce((a, p) => a + p.count, 0);
  const boardTotal = data.leaderboard.reduce((a, r) => a + Number(r.amount), 0);
  const resolved = data.tickets.find((x) => x.status === 'resolved')?.count ?? 0;
  const offline = k.devicesTotal - k.devicesOnline;
  const deviceMax = Math.max(...data.topDevices.map((d) => d.sent24h), 1);
  const labels = data.signups.map((s) => s.date.slice(5));
  const signupsSeries = [
    { name: t('growth.series'), values: data.signups.map((s) => s.count), color: 'var(--primary)' },
  ];
  const money = (v: string | number) => formatMoney(v, data.currency, locale);

  const kpis = [
    {
      id: 'revenue',
      label: t('kpi.revenue'),
      value: money(k.revenue),
      sub: t('kpi.revenueSub', { n: k.newWorkspaces }),
    },
    {
      id: 'workspaces',
      label: t('kpi.workspaces'),
      value: String(k.workspaces),
      sub: t('kpi.workspacesSub', { n: k.users }),
      pill: `+${k.newWorkspaces}`,
    },
    {
      id: 'messages',
      label: t('kpi.messages'),
      value: compact(k.messages),
      sub: t('kpi.messagesSub', { n: compact(k.messagesPerDay) }),
    },
    {
      id: 'devices',
      label: t('kpi.devices'),
      value: `${k.devicesOnline}/${k.devicesTotal}`,
      pill: `${onlinePct}%`,
    },
    {
      id: 'newUsers',
      label: t('kpi.newUsers'),
      value: String(k.newUsers),
      sub: t('kpi.newUsersSub', { n: k.users }),
    },
    {
      id: 'tickets',
      label: t('kpi.tickets'),
      value: String(k.openTickets),
      pill: k.openTickets > 0 ? t('kpi.watch') : t('kpi.clear'),
      alert: k.openTickets > 0,
    },
  ];

  return (
    <div className="space-y-4">
      {show('kpi') && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {kpis.map((c) => (
            <Card
              key={c.id}
              className={cn('space-y-1', c.alert && 'border-danger/50')}
              data-testid={`akpi-${c.id}`}
            >
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-xl font-semibold tabular-nums">{c.value}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {c.pill && <Badge tone={c.alert ? 'danger' : 'neutral'}>{c.pill}</Badge>}
                {c.sub}
              </div>
            </Card>
          ))}
        </section>
      )}

      {show('growth') && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel
            title={t('growth.title')}
            subtitle={t('growth.subtitle', { days: data.days })}
            className="xl:col-span-2"
          >
            <BarChart labels={labels} series={signupsSeries} label={t('growth.aria')} />
          </Panel>
          <Panel
            title={t('pulse.title')}
            subtitle={t('pulse.subtitle')}
            action={<Badge>{t('pulse.normal')}</Badge>}
          >
            <ul className="space-y-3">
              {pulse.map((p) => (
                <li key={p.id} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{t(`pulse.${p.id}`)}</span>
                    <span className="tabular-nums text-muted-foreground">{p.pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${p.pct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {show('mix') && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title={t('plans.title')} subtitle={t('plans.subtitle')}>
            <Donut
              label={t('plans.aria')}
              empty={t('plans.empty')}
              slices={data.planMix.map((p, i) => ({
                name: p.plan,
                value: p.count,
                color: COLORS[i % COLORS.length]!,
              }))}
            />
            {planTotal > 0 && (
              <ul className="space-y-1 text-sm">
                {data.planMix.slice(0, 5).map((p) => (
                  <li key={p.plan} className="flex justify-between">
                    <span>{p.plan}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {Math.round((p.count / planTotal) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={t('acquisition.title')} subtitle={t('acquisition.subtitle')}>
            <ul className="space-y-3 text-sm">
              {(
                [
                  ['users', k.users, k.users, null],
                  [
                    'newUsers',
                    k.newUsers,
                    k.users,
                    k.users > 0 ? Math.round((k.newUsers / k.users) * 100) : 0,
                  ],
                  ['workspaces', k.workspaces, k.workspaces, null],
                  [
                    'newWorkspaces',
                    k.newWorkspaces,
                    k.workspaces,
                    k.newUsers > 0 ? Math.round((k.newWorkspaces / k.newUsers) * 100) : 0,
                  ],
                  ['devices', k.devicesOnline, k.devicesTotal, null],
                ] as const
              ).map(([id, value, of, pct]) => (
                <li key={id} className="space-y-1">
                  <div className="flex justify-between">
                    <span>{t(`acquisition.${id}`)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {value}
                      {pct !== null && ` · ${pct}%`}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${of > 0 ? Math.min(100, (value / of) * 100) : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title={t('devices.title')} subtitle={t('devices.subtitle')}>
            {data.deviceSends24h === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">{t('devices.empty')}</p>
            ) : (
              <ul aria-label={t('devices.aria')} className="space-y-2 text-sm">
                {data.topDevices.map((d) => (
                  <li key={d.label} className="space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="truncate">{d.label}</span>
                      <span className="tabular-nums text-muted-foreground">{d.sent24h}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-success"
                        style={{ width: `${(d.sent24h / deviceMax) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <dl className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <dt className="text-muted-foreground">{t('devices.devices')}</dt>
                <dd className="text-sm font-semibold tabular-nums">{k.devicesTotal}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('devices.online')}</dt>
                <dd className="text-sm font-semibold tabular-nums">{k.devicesOnline}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('devices.sends')}</dt>
                <dd className="text-sm font-semibold tabular-nums">{data.deviceSends24h}</dd>
              </div>
            </dl>
          </Panel>
        </div>
      )}

      {show('board') && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel
            title={t('leaderboard.title')}
            subtitle={t('leaderboard.subtitle', { days: data.days })}
            className="xl:col-span-2"
          >
            {data.leaderboard.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">{t('leaderboard.empty')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th scope="col" className="py-2 text-start font-medium">
                      {t('leaderboard.workspace')}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {t('leaderboard.orders')}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {t('leaderboard.revenue')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.leaderboard.map((r) => (
                    <tr key={r.slug} className="border-b border-border/60 last:border-0">
                      <td className="py-2 font-medium">{r.name}</td>
                      <td className="py-2 text-end tabular-nums">{r.orders}</td>
                      <td className="py-2 text-end tabular-nums">{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title={t('cohort.title')} subtitle={t('cohort.subtitle', { days: data.days })}>
            <BarChart labels={labels} series={signupsSeries} label={t('cohort.aria')} />
          </Panel>
        </div>
      )}

      {show('money') && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title={t('composition.title')} subtitle={t('composition.subtitle')}>
            {boardTotal === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">{t('composition.empty')}</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {data.leaderboard.slice(0, 5).map((r) => {
                  const pct = Math.min(100, Math.round((Number(r.amount) / boardTotal) * 100));
                  return (
                    <li key={r.slug} className="space-y-1">
                      <div className="flex justify-between">
                        <span>{r.name}</span>
                        <span className="tabular-nums text-muted-foreground">{pct}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title={t('support.title')} subtitle={t('support.subtitle')}>
            {data.tickets.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">{t('support.empty')}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.tickets.map((x) => (
                  <li key={x.status} className="flex justify-between">
                    <span className="capitalize">{x.status.replace('_', ' ')}</span>
                    <span className="tabular-nums text-muted-foreground">{x.count}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                {t('support.open')} {k.openTickets}
              </span>
              <span>
                {t('support.resolved')} {resolved}
              </span>
              <Link
                href="/admin/support"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {t('support.inbox')}
              </Link>
            </div>
          </Panel>
          <Panel title={t('queue.title')} subtitle={t('queue.subtitle')}>
            <ul className="space-y-2 text-sm">
              {k.openTickets > 0 && (
                <li className="rounded-md border border-danger/40 bg-danger/10 p-3">
                  <Link href="/admin/support" className="font-medium">
                    {t('queue.tickets', { n: k.openTickets })}
                  </Link>
                  <p className="text-xs text-muted-foreground">{t('queue.ticketsHint')}</p>
                </li>
              )}
              {k.devicesTotal > 0 && k.devicesOnline * 2 < k.devicesTotal && (
                <li className="rounded-md border border-border p-3">
                  <p className="font-medium">{t('queue.offline', { n: offline })}</p>
                  <p className="text-xs text-muted-foreground">{t('queue.offlineHint')}</p>
                </li>
              )}
              {k.newUsers > 0 && (
                <li className="rounded-md border border-border p-3">
                  <p className="font-medium">{t('queue.users', { n: k.newUsers })}</p>
                  <p className="text-xs text-muted-foreground">{t('queue.usersHint')}</p>
                </li>
              )}
              {k.openTickets === 0 &&
                k.newUsers === 0 &&
                !(k.devicesTotal > 0 && k.devicesOnline * 2 < k.devicesTotal) && (
                  <li className="py-4 text-muted-foreground">{t('queue.clear')}</li>
                )}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}
