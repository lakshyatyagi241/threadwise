'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { LSC_RUN_STATUSES, type LscRunStatus } from '@crm/contracts';
import { Button, EmptyState, Select, Spinner } from '@crm/ui';
import { useLscRuns } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { LoadError, SectionCard, SkeletonRows } from './parts';
import { RunsTable } from './runs-table';

/** The workspace's scoring log: newest first, a status filter, "Load more" for the next cursor page. */
export function RunsLog({ enabled }: { enabled: boolean }) {
  const t = useTranslations('lead-scoring.log');
  const [status, setStatus] = useState<LscRunStatus | ''>('');
  const runs = useLscRuns(status ? { status } : {}, enabled);
  return (
    <SectionCard
      id="lsc-log"
      title={t('title')}
      hint={t('hint')}
      aside={
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="lsc-log-status" className="sr-only">
            {t('filter')}
          </label>
          <Select
            id="lsc-log-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as LscRunStatus | '')}
            className="h-8 w-auto text-xs"
          >
            <option value="">{t('all')}</option>
            {LSC_RUN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={runs.isFetching}
            onClick={() => void runs.refetch()}
          >
            {runs.isFetching && !runs.isFetchingNextPage && <Spinner />}
            {t('refresh')}
          </Button>
        </div>
      }
    >
      {runs.isPending ? (
        <SkeletonRows rows={4} />
      ) : runs.isError ? (
        <LoadError
          errorKey={errorKey(runs.error)}
          error={runs.error}
          onRetry={() => void runs.refetch()}
        />
      ) : runs.items.length === 0 ? (
        <EmptyState
          title={status ? t('emptyFilteredTitle') : t('emptyTitle')}
          message={status ? t('emptyFilteredBody') : t('emptyBody')}
        />
      ) : (
        <>
          <RunsTable runs={runs.items} caption={t('caption')} />
          {runs.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                disabled={runs.isFetchingNextPage}
                onClick={() => void runs.fetchNextPage()}
              >
                {runs.isFetchingNextPage && <Spinner />}
                {t('loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
