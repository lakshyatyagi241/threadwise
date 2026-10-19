'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { RevenueReportResponse } from '@crm/contracts';
import { Alert, Button, EmptyState } from '@crm/ui';
import { LoadError } from '@/features/dashboards-analytics-charts/components/parts';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { useMemberOptions, useTeamOptions } from '../../api/hooks';
import { useRevenueReport } from '../api/hooks';
import {
  apiQuery,
  exportBody,
  filtersToSearch,
  parseFilters,
  type RevenueFilters,
} from '../lib/query';
import { RevenueExports } from './revenue-exports';
import { RevenueFiltersBar } from './revenue-filters';
import { RevenueKpis } from './revenue-kpis';
import { FlowPanel, RevenueAgingPanel, RevenueTrendPanel } from './revenue-panels';
import { SplitTable } from './revenue-split';

/** Nothing issued, nothing collected and nothing owed: a workspace with no invoicing yet, or a period with no activity. */
export function isEmptyRevenue(d: RevenueReportResponse): boolean {
  const m = d.summary.metrics;
  return (
    d.rows.items.length === 0 &&
    d.summary.receivables.invoices === 0 &&
    m.collected.current.byCurrency.length === 0 &&
    m.invoiced.current.byCurrency.length === 0 &&
    d.summary.collectedAllTime.byCurrency.length === 0
  );
}

/** Currencies the server could not convert, named once. */
export function missingRates(d: RevenueReportResponse): string[] {
  const set = new Set<string>();
  const m = d.summary.metrics;
  for (const t of [m.invoiced.current, m.collected.current, d.summary.receivables.outstanding])
    for (const c of t.unconverted ?? []) set.add(c);
  return [...set].sort();
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
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}

/**
 * `/crm/revenue`: Reference's revenue report, with a period and a comparison, the split by lead source, origin, product, owner or
 * team, invoiced against paid and owed, per-currency figures, and the CSV and PDF downloads.
 */
export function RevenueScreen() {
  const t = useTranslations('crm-revenue');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const session = useSession();
  const canExport = useCan('record.payments.export');

  const filters = useMemo(() => parseFilters(search), [search]);
  const setFilters = useCallback(
    (patch: Partial<RevenueFilters>) =>
      router.replace(`${pathname}${filtersToSearch({ ...filters, ...patch })}`, { scroll: false }),
    [router, pathname, filters],
  );

  const members = useMemberOptions();
  const teams = useTeamOptions();
  const workspaceCurrency = session.org.currency ?? 'USD';
  const report = useRevenueReport(apiQuery(filters, workspaceCurrency));
  const data = report.data;
  const currency = filters.currency || workspaceCurrency;

  // A caller who cannot list members still gets themselves in the picker.
  const owners =
    members.data && members.data.length > 0
      ? members.data
      : [{ id: session.user.id, name: session.user.fullName }];

  const missing = data ? missingRates(data) : [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('kicker')}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
          {data && (
            <div
              className="mt-1 space-y-0.5 text-xs text-muted-foreground"
              data-testid="period-line"
            >
              <p>
                {t('period', {
                  from: data.period.fromDate,
                  to: data.period.toDate,
                  zone: data.period.timezone,
                })}
              </p>
              {data.comparison && (
                <p>
                  {t('comparedWith', {
                    mode: t(`mode.${data.comparison.mode}`),
                    from: data.comparison.fromDate,
                    to: data.comparison.toDate,
                  })}
                </p>
              )}
            </div>
          )}
        </div>
        <Link
          href="/crm"
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          {t('back')}
        </Link>
      </header>

      <RevenueFiltersBar
        filters={filters}
        onChange={setFilters}
        owners={owners}
        teams={teams.data ?? []}
        currencies={data?.currencies ?? []}
        workspaceCurrency={workspaceCurrency}
        today={data?.period.today}
        busy={report.isFetching}
      />

      {report.isPending ? (
        <Skeleton label={t('loading')} />
      ) : report.isError && !data ? (
        <div className="space-y-3">
          <LoadError error={report.error} />
          <Button variant="secondary" onClick={() => void report.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : data ? (
        <div className="space-y-5" aria-busy={report.isFetching}>
          {report.isError && (
            <p role="alert" className="text-sm text-danger">
              {t('stale')}
            </p>
          )}
          {data.convertedTo && data.currencies.length > 1 && (
            <Alert tone="info">{t('note.converted', { currency: data.convertedTo })}</Alert>
          )}
          {missing.length > 0 && (
            <Alert tone="warning">
              {t('note.missingRate', { currencies: missing.join(', ') })}
            </Alert>
          )}
          {isEmptyRevenue(data) ? (
            <EmptyState
              title={t('empty.title')}
              message={t('empty.message')}
              actions={
                <Link
                  href="/invoices"
                  className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  {t('empty.invoices')}
                </Link>
              }
            />
          ) : (
            <>
              <RevenueKpis data={data} currency={currency} />
              <div className="grid gap-4 lg:grid-cols-2">
                <FlowPanel data={data} currency={currency} />
                <RevenueTrendPanel trend={data.trend} currency={data.convertedTo ?? currency} />
              </div>
              <SplitTable data={data} currency={currency} />
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-1">
                  <RevenueAgingPanel aging={data.aging} />
                </div>
                {canExport && (
                  <div className="lg:col-span-2">
                    <RevenueExports body={(file) => exportBody(filters, workspaceCurrency, file)} />
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t('note.invoiced')}</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
