'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  ADMIN_OVERVIEW_WINDOWS,
  type AdminOverview,
  type AdminOverviewWindow,
} from '@crm/contracts';
import { Alert, Badge, Button, Card, Select, Spinner, cn } from '@crm/ui';
import { useAdminOverview } from '../api/admin';
import { compact, deltaOf, formatMoney } from '../lib/format';
import { Donut, LineChart, Radar, Ring } from './charts';
import { Panel, Trend } from './parts';

const COLORS = ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--danger)'];

/** The operator's overview at `/admin` (WD-DASH-034..040): KPI cards, revenue chart, geography, gateway mix, users, workspaces, alerts. */
export function AdminOverviewScreen({ window }: { window: AdminOverviewWindow }) {
  const t = useTranslations('dashboards-analytics-charts.admin');
  const router = useRouter();
  const pathname = usePathname();
  const q = useAdminOverview(window);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('overview.kicker')}
          </p>
          <h1 className="font-serif text-3xl leading-tight sm:text-4xl">
            {t('overview.titleLead')} <em className="text-primary">{t('overview.titleAccent')}</em>.
          </h1>
          <p className="text-sm text-muted-foreground">{t('overview.subtitle')}</p>
        </div>
        <Select
          aria-label={t('window.label')}
          className="w-auto"
          value={window}
          onChange={(e) => router.replace(`${pathname}?window=${e.target.value}`)}
        >
          {ADMIN_OVERVIEW_WINDOWS.map((w) => (
            <option key={w} value={w}>
              {t(`window.${w}`)}
            </option>
          ))}
        </Select>
      </header>

      {q.isPending ? (
        <div className="flex min-h-64 items-center justify-center text-muted-foreground">
          <Spinner label={t('window.label')} />
        </div>
      ) : q.isError ? (
        <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('error')}</span>
          <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
            {t('retry')}
          </Button>
        </Alert>
      ) : (
        <Overview data={q.data} />
      )}
    </div>
  );
}

function Overview({ data }: { data: AdminOverview }) {
  const t = useTranslations('dashboards-analytics-charts.admin');
  const locale = useLocale();
  const money = (v: string | number, digits = 2) => formatMoney(v, data.currency, locale, digits);
  const k = data.kpis;
  const kpis = [
    { id: 'income', label: t('overview.kpi.income'), value: money(k.income.value), d: k.income },
    {
      id: 'profit',
      label: t('overview.kpi.profit'),
      value: money(k.profit.value),
      d: k.profit,
      hint: t('overview.kpi.profitHint'),
    },
    {
      id: 'views',
      label: t('overview.kpi.views'),
      value: new Intl.NumberFormat(locale).format(Number(k.views.value)),
      d: k.views,
      hint: t('overview.kpi.viewsHint'),
    },
    {
      id: 'conversion',
      label: t('overview.kpi.conversion'),
      value: `${k.conversion.value}%`,
      d: k.conversion,
    },
  ];
  return (
    <div className="space-y-6">
      <section aria-label="KPI" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((c) => (
          <Card key={c.id} className="space-y-2" data-testid={`kpi-${c.id}`}>
            <p className="text-sm text-muted-foreground">{c.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{c.value}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Trend delta={deltaOf(c.d.changePct)} />
              <span>{t('vsPrevious')}</span>
            </div>
            {c.hint && <p className="text-xs text-muted-foreground">{c.hint}</p>}
          </Card>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title={t('overview.revenue.title')} className="xl:col-span-2">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-sm bg-primary" />
              {t('overview.revenue.total')}{' '}
              <strong className="tabular-nums">{money(data.revenue.total)}</strong>
            </span>
            <span className="flex items-center gap-2" title={t('overview.revenue.targetHint')}>
              <span aria-hidden className="size-2.5 rounded-sm bg-warning" />
              {t('overview.revenue.target')}{' '}
              <strong className="tabular-nums">{money(data.revenue.totalTarget)}</strong>
            </span>
          </div>
          <LineChart
            labels={data.revenue.labels}
            label={t('overview.revenue.aria')}
            format={(n) => money(n, 0)}
            series={[
              {
                name: t('overview.revenue.revenue'),
                values: data.revenue.series,
                color: 'var(--primary)',
              },
              {
                name: t('overview.revenue.target'),
                values: data.revenue.target,
                color: 'var(--warning)',
              },
            ]}
          />
        </Panel>

        <Panel title={t('overview.countries.title')} subtitle={t('overview.countries.subtitle')}>
          {data.countries.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{t('overview.countries.empty')}</p>
          ) : (
            <ul className="space-y-3">
              {data.countries.map((c, i) => (
                <li key={c.code} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Badge>{c.code}</Badge>
                      {c.name}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {c.count} · {c.pct}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${c.pct}%`, backgroundColor: COLORS[i % COLORS.length] }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={t('overview.regions.title')} subtitle={t('overview.regions.subtitle')}>
          <Radar
            label={t('overview.regions.aria')}
            axes={data.regions.map((r) => ({ name: r.region, value: r.count }))}
          />
        </Panel>
        <Panel title={t('overview.platform.title')} subtitle={t('overview.platform.subtitle')}>
          <Donut
            label={t('overview.platform.aria')}
            empty={t('overview.platform.empty')}
            slices={data.gateways.map((g, i) => ({
              name: g.gateway,
              value: Number(g.amount),
              color: COLORS[i % COLORS.length]!,
            }))}
          />
        </Panel>
        <Panel title={t('overview.users.title')} subtitle={t('overview.users.subtitle')}>
          <Ring
            pct={data.users.pct}
            label={t('overview.users.aria', { pct: data.users.pct })}
            centre={String(data.users.total)}
            caption={t('overview.users.total')}
          />
          <dl className="grid grid-cols-2 gap-2 text-center text-sm">
            <div>
              <dt className="text-muted-foreground">{t('overview.users.premium')}</dt>
              <dd className="font-semibold tabular-nums">{data.users.premium}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('overview.users.basic')}</dt>
              <dd className="font-semibold tabular-nums">{data.users.basic}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title={t('overview.workspaces.title')}
          subtitle={t('overview.workspaces.subtitle')}
          className="xl:col-span-2"
          action={
            <Link
              href="/admin/workspace-plans"
              className="text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('overview.workspaces.viewAll')}
            </Link>
          }
        >
          {data.workspaces.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{t('overview.workspaces.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-start text-xs text-muted-foreground">
                    {(['workspace', 'owner', 'plan', 'messages', 'health', 'mrr'] as const).map(
                      (c) => (
                        <th key={c} scope="col" className="py-2 pe-3 text-start font-medium">
                          {t(`overview.workspaces.col.${c}`)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.workspaces.map((w) => (
                    <tr key={w.slug} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pe-3 font-medium">{w.name}</td>
                      <td className="py-2 pe-3 text-muted-foreground">{w.owner ?? '-'}</td>
                      <td className="py-2 pe-3">
                        <Badge>{w.plan}</Badge>
                      </td>
                      <td className="py-2 pe-3 tabular-nums">{compact(w.messages)}</td>
                      <td className="py-2 pe-3">
                        <Badge
                          tone={
                            w.health === 'low'
                              ? 'warning'
                              : w.health === 'idle'
                                ? 'neutral'
                                : 'success'
                          }
                        >
                          {t(`overview.workspaces.health.${w.health}`)}
                        </Badge>
                      </td>
                      <td className="py-2 tabular-nums">{money(w.mrr, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title={t('overview.alerts.title')}
          subtitle={t('overview.alerts.subtitle')}
          action={
            <Badge tone={data.alerts.open > 0 ? 'danger' : 'neutral'}>
              {t('overview.alerts.open', { n: data.alerts.open })}
            </Badge>
          }
        >
          {data.alerts.items.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{t('overview.alerts.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {data.alerts.items.map((a, i) => (
                <li
                  key={i}
                  className={cn(
                    'rounded-md border p-3 text-sm',
                    a.severity === 'high' ? 'border-danger/40 bg-danger/10' : 'border-border',
                  )}
                >
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
