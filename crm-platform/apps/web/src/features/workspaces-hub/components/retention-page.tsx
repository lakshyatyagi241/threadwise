'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Checkbox, EmptyState, Input, Select, Spinner } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useUrlState } from '@/features/platform-payment-gateways/lib/use-url-state';
import { fetchLifecycleList, lifecycleKeys } from '../api';
import { useRetentionAccess } from '../lib/use-hub-access';
import { RETENTION_DEFAULTS, hasRetentionFilter, toLifecycleFilters } from '../lib/retention';
import { Breadcrumb } from './breadcrumb';
import { RetentionDialogs, type RetentionTarget } from './retention-dialogs';
import { RetentionHistoryDrawer } from './retention-history-drawer';
import { RetentionTable } from './retention-table';
import type { OrgLifecycleResponse } from '@crm/contracts';

const STATUSES = ['active', 'archived', 'suspended', 'deleted'] as const;

/** Workspace retention: who is idle, what is scheduled, and the operator's controls (ADR-0028). */
export function RetentionPage() {
  const t = useTranslations('workspaces-hub.retention');
  const tc = useTranslations('workspaces-hub.common');
  const access = useRetentionAccess();
  const { values, set } = useUrlState({ ...RETENTION_DEFAULTS });
  const [target, setTarget] = useState<RetentionTarget | null>(null);
  const [history, setHistory] = useState<OrgLifecycleResponse | null>(null);

  const list = useInfiniteQuery({
    queryKey: lifecycleKeys.list(values),
    queryFn: ({ pageParam, signal }) =>
      fetchLifecycleList({ ...toLifecycleFilters(values), cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    refetchOnWindowFocus: false,
    enabled: access.ready && access.view,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const filtered = hasRetentionFilter(values);

  return (
    <div className="space-y-6">
      <Breadcrumb current={t('crumb')} />
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Link href="/admin/workspaces" className="text-sm text-primary hover:underline">
            {t('backToList')}
          </Link>
        }
      />

      {!access.ready ? (
        <LoadingBlock />
      ) : !access.view ? (
        <EmptyState title={t('deniedTitle')} message={tc('noAccess')} />
      ) : (
        <>
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={t('filters.label')}
          >
            <Select
              className="w-auto"
              aria-label={t('filters.status')}
              value={values.status}
              onChange={(e) => set({ status: e.target.value })}
            >
              <option value="">{t('filters.allStatuses')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              className="w-44"
              aria-label={t('filters.minDays')}
              placeholder={t('filters.minDays')}
              value={values.min}
              onChange={(e) => set({ min: e.target.value })}
            />
            <Checkbox
              label={t('filters.neverDeleteOnly')}
              checked={values.exempt === 'true'}
              onChange={(e) => set({ exempt: e.target.checked ? 'true' : '' })}
            />
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => set({ ...RETENTION_DEFAULTS })}>
                {t('filters.clear')}
              </Button>
            )}
          </div>

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
              <RetentionTable
                rows={rows}
                access={access}
                onAction={(row, action) => setTarget({ row, action })}
                onHistory={setHistory}
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
        </>
      )}

      <RetentionDialogs target={target} onClose={() => setTarget(null)} />
      <RetentionHistoryDrawer row={history} onClose={() => setHistory(null)} />
    </div>
  );
}
