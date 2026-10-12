'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, EmptyState, Spinner, StatTile } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useUrlState } from '@/features/platform-payment-gateways/lib/use-url-state';
import { useDebounced } from '@/features/roles-permissions/lib/use-debounced';
import { fetchHubList, hubKeys } from '../api';
import { useStoredColumns } from '../lib/use-stored-columns';
import { useHubAccess, useRetentionAccess } from '../lib/use-hub-access';
import { useRowActions } from '../lib/use-row-actions';
import { toListFilters } from '../lib/query';
import { formatMrr } from '../lib/format';
import { ActionDialogs } from './action-dialogs';
import { Breadcrumb } from './breadcrumb';
import { HUB_DEFAULTS, WorkspacesToolbar, hasActiveFilter } from './workspaces-toolbar';
import { WorkspacesTable } from './workspaces-table';

/** The operator's one place for every customer workspace: filters in the address, cursor paging, columns the operator chooses. */
export function WorkspacesPage() {
  const t = useTranslations('workspaces-hub.list');
  const locale = useLocale();
  const { values, set } = useUrlState(HUB_DEFAULTS);
  const columns = useStoredColumns();
  const access = useHubAccess();
  const actions = useRowActions();
  const retention = useRetentionAccess();

  const [search, setSearch] = useState(values.q);
  const settled = useDebounced(search.trim(), 300);
  useEffect(() => {
    if (settled !== values.q) set({ q: settled });
    // only a settled search pushes the address; an address change does not rewrite the box
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  const list = useInfiniteQuery({
    queryKey: hubKeys.list(values),
    queryFn: ({ pageParam, signal }) =>
      fetchHubList({ ...toListFilters(values), cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    refetchOnWindowFocus: false,
  });

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const first = list.data?.pages[0];
  const kpis = first?.kpis;
  const num = new Intl.NumberFormat(locale);
  const filtered = hasActiveFilter(values);

  return (
    <div className="space-y-6">
      <Breadcrumb />
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          retention.view ? (
            <Link
              href="/admin/workspaces/retention"
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('retentionLink')}
            </Link>
          ) : undefined
        }
      />

      {kpis && (
        <div
          className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7"
          data-testid="hub-kpis"
        >
          <StatTile label={t('kpi.total')} value={num.format(kpis.total)} />
          <StatTile label={t('kpi.active')} value={num.format(kpis.active)} />
          <StatTile
            label={t('kpi.suspended')}
            value={num.format(kpis.suspended)}
            tone={kpis.suspended > 0 ? 'warning' : 'default'}
          />
          <StatTile label={t('kpi.trial')} value={num.format(kpis.trial)} />
          <StatTile label={t('kpi.newThisMonth')} value={num.format(kpis.newThisMonth)} />
          <StatTile
            label={t('kpi.lowBalance')}
            value={num.format(kpis.lowBalance)}
            tone={kpis.lowBalance > 0 ? 'warning' : 'default'}
          />
          <StatTile label={t('kpi.mrr')} value={formatMrr(kpis.mrr, kpis.currency, locale)} />
        </div>
      )}

      <WorkspacesToolbar
        filters={values}
        search={search}
        onSearch={setSearch}
        onChange={(patch) => set(patch)}
        kpis={kpis}
        options={first?.filters}
        visible={columns.visible}
        onColumn={columns.set}
        onResetColumns={columns.reset}
        onRefresh={() => void list.refetch()}
        refreshing={list.isFetching && !list.isPending}
      />

      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError && rows.length === 0 ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? t('noMatchTitle') : t('emptyTitle')}
          message={filtered ? t('noMatchMessage') : t('emptyMessage')}
        />
      ) : (
        <>
          <WorkspacesTable
            rows={rows}
            columns={columns.visible}
            currency={kpis?.currency ?? 'USD'}
            access={access}
            onAction={(row, action) => actions.run(row, action)}
          />
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {t('loaded', { count: rows.length })}
            </p>
            {list.isError && (
              <ErrorBlock error={list.error} onRetry={() => void list.fetchNextPage()} />
            )}
            {list.hasNextPage && (
              <Button
                variant="secondary"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage && <Spinner label={t('loadingMore')} />}
                {t('loadMore')}
              </Button>
            )}
          </div>
        </>
      )}

      <ActionDialogs target={actions.target} onClose={actions.close} />
    </div>
  );
}
