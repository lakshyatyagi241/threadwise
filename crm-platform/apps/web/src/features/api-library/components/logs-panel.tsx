'use client';

import { useTranslations } from 'next-intl';
import { useDeferredValue, useState } from 'react';
import type { ApiLibraryLogApi, ApiLibraryLogBot } from '@crm/contracts';
import { Button, EmptyState, cn, useToast } from '@crm/ui';
import { apiLibraryApi } from '../api/service';
import { useApiLogs } from '../api/hooks';
import { errorKey, serverFieldProblems } from '../lib/errors';
import { downloadCsv } from '../lib/download';
import {
  EMPTY_LOG_FILTERS,
  hasLogFilters,
  logQuery,
  searchTooLong,
  type LogFilterForm,
} from '../lib/log-filters';
import { LogDetailDrawer } from './log-detail-drawer';
import { LogFiltersBar } from './log-filters-bar';
import { LogsTable } from './logs-table';
import { CARD } from './page-chrome';
import { Pagination } from './pagination';
import { LoadError } from './parts';
import { useFallBackToLastPage, type Paging } from './use-paging';

/**
 * Filters, the runs, "load more" and the detail drawer. Used by the drawer on a list row (`apiId` fixed) and the full page (all
 * APIs, with an API filter).
 */
export function LogsPanel({
  apiId,
  apis,
  bots,
  paging,
  enabled = true,
}: {
  apiId?: string;
  /** Where the page and size live: the URL on the full page, the drawer's own state on a list row. */
  paging: Paging;
  apis?: ApiLibraryLogApi[];
  bots?: ApiLibraryLogBot[];
  enabled?: boolean;
}) {
  const t = useTranslations('api-library.logs');
  const te = useTranslations('api-library.errors');
  const [filters, setFilters] = useState<LogFilterForm>(EMPTY_LOG_FILTERS);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();
  // Typing in the search box must not fire a request per keystroke.
  const deferred = useDeferredValue(filters);
  // A search over the limit is not sent: the query stays off and the last results stay on screen, with the field marked.
  const tooLong = searchTooLong(deferred);
  const q = useApiLogs(
    logQuery(deferred, apiId),
    { page: paging.page, limit: paging.limit },
    enabled && !tooLong,
  );
  useFallBackToLastPage(paging, q.data, q.isSuccess && !q.isPlaceholderData);
  const items = q.data?.data ?? [];
  const filtered = hasLogFilters(filters);

  // The export takes the filters on screen (not the page), newest first; the server caps the file.
  async function exportCsv() {
    setExporting(true);
    try {
      downloadCsv('api-library-logs.csv', await apiLibraryApi.logsCsv(logQuery(deferred, apiId)));
    } catch (e) {
      toast(te(errorKey(e)), 'danger');
    } finally {
      setExporting(false);
    }
  }
  // The API refused the search field (the page checks the same limit first, so this should not happen). Show the field message, not the red bar.
  const searchRefused = q.isError && serverFieldProblems(q.error).some((e) => e.path === 'search');

  return (
    <div className="space-y-4">
      <div className={cn(apiId === undefined && CARD, apiId === undefined && 'p-4')}>
        <LogFiltersBar
          value={filters}
          onChange={(next) => {
            setFilters(next);
            // Other filters are another list: start at its first page.
            if (paging.page > 1) paging.setPage(1, { replace: true });
          }}
          apis={apis}
          bots={bots}
          searchInvalid={tooLong || searchRefused}
        />
      </div>
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void exportCsv()}
          disabled={exporting || tooLong || !q.data || q.data.total === 0}
        >
          {exporting ? t('exporting') : t('export')}
        </Button>
      </div>
      {q.isError && !searchRefused ? (
        <LoadError message={te(errorKey(q.error))} onRetry={() => void q.refetch()} />
      ) : q.data && q.data.total === 0 ? (
        <EmptyState
          className="py-14"
          title={filtered ? t('noMatchTitle') : t('emptyTitle')}
          message={filtered ? t('noMatch') : t('empty')}
        />
      ) : (
        <div className={cn(CARD, 'overflow-hidden')}>
          <div className={cn(q.isPlaceholderData && 'opacity-60 transition-opacity')}>
            <LogsTable rows={items} loading={q.isPending} showApi={!apiId} onOpen={setOpen} />
          </div>
          {q.data && (
            <Pagination
              page={paging.page}
              totalPages={q.data.totalPages}
              total={q.data.total}
              pageSize={paging.limit}
              rows={items.length}
              fetching={q.isFetching}
              onPage={(n) => paging.setPage(n)}
              onPageSize={paging.setLimit}
              note={t('retention')}
            />
          )}
        </div>
      )}
      <LogDetailDrawer logId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
