'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { CrmDashboardResponse } from '@crm/contracts';
import { Button, EmptyState } from '@crm/ui';
import { LoadError } from '@/features/dashboards-analytics-charts/components/parts';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import {
  useCrmDashboard,
  useMemberOptions,
  usePipelineOptions,
  useTeamOptions,
} from '../api/hooks';
import { apiQuery, filtersToSearch, parseFilters, type DashFilters } from '../lib/query';
import { ActivityPanel } from './activity-panel';
import { FunnelPanel, TrendPanel } from './deal-panels';
import { FiltersBar } from './filters-bar';
import { KpiGrid } from './kpi-grid';
import { AgingPanel, PaymentsPanel } from './money-panels';
import { LeaderboardPanel, SourcesPanel, TasksPanel } from './table-panels';

/** Nothing to show anywhere: no deals, no contacts, no tasks, no invoices (a new workspace). */
export function isEmptyDashboard(d: CrmDashboardResponse): boolean {
  const deals = d.deals;
  const noDeals =
    !deals ||
    (deals.open.count === 0 &&
      deals.won.count === 0 &&
      deals.lost.count === 0 &&
      deals.won.previousCount === 0 &&
      deals.lost.previousCount === 0);
  return (
    noDeals &&
    (!d.contacts || d.contacts.totalContacts === 0) &&
    (!d.tasks || d.tasks.open === 0) &&
    (!d.invoices || (d.invoices.openInvoices === 0 && d.invoices.recentPayments.length === 0))
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label={label}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}

/** `/crm`: the CRM home. Deals, the funnel, lead sources, who is winning, tasks, receivables and recent activity for one period. */
export function CrmDashboardScreen() {
  const t = useTranslations('crm-dashboard');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const session = useSession();

  const filters = useMemo(() => parseFilters(search), [search]);
  const setFilters = useCallback(
    (patch: Partial<DashFilters>) =>
      router.replace(`${pathname}${filtersToSearch({ ...filters, ...patch })}`, { scroll: false }),
    [router, pathname, filters],
  );

  const pipelines = usePipelineOptions();
  const members = useMemberOptions();
  const teams = useTeamOptions();
  const picked = (pipelines.data ?? []).find((p) => p.id === filters.pipeline);
  // Figures are converted into one currency: the chosen pipeline's, else the workspace's.
  const currency = picked?.currency ?? session.org.currency ?? 'USD';
  const dash = useCrmDashboard(apiQuery(filters, currency));
  const data = dash.data;

  // A caller who cannot list members still gets themselves in the picker.
  const owners =
    members.data && members.data.length > 0
      ? members.data
      : [{ id: session.user.id, name: session.user.fullName }];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('subtitle')}</p>
          {data && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="period-line">
              {t('period', {
                from: data.period.fromDate,
                to: data.period.toDate,
                zone: data.period.timezone,
              })}
            </p>
          )}
        </div>
        <Link
          href="/deals"
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          {t('openBoard')}
        </Link>
      </header>

      <FiltersBar
        filters={filters}
        onChange={setFilters}
        pipelines={pipelines.data ?? []}
        owners={owners}
        teams={teams.data ?? []}
        today={data?.period.today}
        busy={dash.isFetching}
      />

      {dash.isPending ? (
        <Skeleton label={t('loading')} />
      ) : dash.isError && !data ? (
        <div className="space-y-3">
          <LoadError error={dash.error} />
          <Button variant="secondary" onClick={() => void dash.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : data ? (
        <div className="space-y-5" aria-busy={dash.isFetching}>
          {dash.isError && (
            <p role="alert" className="text-sm text-danger">
              {t('stale')}
            </p>
          )}
          {isEmptyDashboard(data) ? (
            <EmptyState
              title={t('empty.title')}
              message={t('empty.message')}
              actions={
                <>
                  <Link
                    href="/deals"
                    className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    {t('empty.deals')}
                  </Link>
                  <Link
                    href="/contacts"
                    className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
                  >
                    {t('empty.contacts')}
                  </Link>
                </>
              }
            />
          ) : (
            <>
              <KpiGrid data={data} currency={currency} pipeline={filters.pipeline} />
              {data.deals && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <FunnelPanel funnel={data.deals.funnel} currency={currency} />
                  <TrendPanel trend={data.deals.trend} wonValue={data.deals.won.value} currency={currency} />
                </div>
              )}
              {(data.contacts || data.deals) && (
                <div className="grid gap-4 lg:grid-cols-2">
                  {data.deals && (
                    <LeaderboardPanel
                      rows={data.deals.leaderboard}
                      pipeline={filters.pipeline}
                      currency={currency}
                    />
                  )}
                  {data.contacts && <SourcesPanel rows={data.contacts.sources} currency={currency} />}
                </div>
              )}
              {(data.tasks || data.invoices) && (
                <div className="grid gap-4 lg:grid-cols-3">
                  {data.tasks && (
                    <div className="lg:col-span-1">
                      <TasksPanel tasks={data.tasks} />
                    </div>
                  )}
                  {data.invoices && <AgingPanel aging={data.invoices.aging} />}
                  {data.invoices && <PaymentsPanel payments={data.invoices.recentPayments} />}
                </div>
              )}
              {data.activity && (
                <ActivityPanel entries={data.activity} timezone={data.period.timezone} />
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
