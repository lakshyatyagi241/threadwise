'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { Button, EmptyState, Spinner } from '@crm/ui';
import { useDealsList } from '../api/hooks';
import type { Pipeline } from '../api/schemas';
import { filterQuery, hasActiveFilter, type DealFilters } from '../lib/filters';
import { formatDay } from '../lib/format';
import { formatMoney } from '../lib/money';
import { Avatar, ErrorLine, StatusChip } from './parts';

/** The table view of the same deals: one bordered card, newest first, "load more" by cursor. */
export function DealsList({
  pipeline,
  filters,
  onOpen,
}: {
  pipeline: Pipeline;
  filters: DealFilters;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations('deals-pipelines.list');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const list = useDealsList({
    ...filterQuery(filters),
    pipelineId: pipeline.id,
    status: filters.status || undefined,
  });
  const stageOf = (id: string) => pipeline.stages.find((s) => s.id === id);

  if (list.isPending) {
    return (
      <div
        className="space-y-2 rounded-xl border border-border p-4"
        aria-busy="true"
        aria-label={t('loading')}
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }
  if (list.isError) return <ErrorLine error={list.error} onRetry={() => void list.refetch()} />;
  if (list.items.length === 0) {
    return (
      <EmptyState
        title={hasActiveFilter(filters) ? t('noMatchesTitle') : t('emptyTitle')}
        message={hasActiveFilter(filters) ? t('noMatchesMessage') : t('emptyMessage')}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-border bg-background">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {(['title', 'contact', 'stage', 'amount', 'owner', 'close', 'status'] as const).map(
                (c) => (
                  <th key={c} scope="col" className="px-4 py-3 text-start font-medium">
                    {t(`columns.${c}`)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.items.map((d) => {
              const stage = stageOf(d.stageId);
              return (
                <tr key={d.id} className="hover:bg-muted/40">
                  <td className="max-w-72 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onOpen(d.id)}
                      className="block max-w-full truncate text-start font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {d.title}
                    </button>
                  </td>
                  <td className="max-w-48 truncate px-4 py-3 text-muted-foreground">
                    {d.contact?.name || d.contact?.phone || '—'}
                  </td>
                  <td className="px-4 py-3">
                    {stage ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-full"
                          style={{ backgroundColor: stage.color }}
                        />
                        {stage.name}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {formatMoney(d.valueMinor, d.currency, locale)}
                  </td>
                  <td className="px-4 py-3">
                    {d.owner ? (
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={d.owner.name} /> {d.owner.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t('unassigned')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {formatDay(d.expectedCloseDate, locale, timeZone) || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={d.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage && <Spinner />}
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
