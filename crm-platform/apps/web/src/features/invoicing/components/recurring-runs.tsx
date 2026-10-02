'use client';

import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, EmptyState, Spinner, cn } from '@crm/ui';
import { KEYS } from '../api/hooks';
import { invoicingApi } from '../api/service';
import { formatDateTime } from '../lib/dates';
import { frozenEdge, isScrolledSideways, STICKY_ONLY, STICKY_ONLY_HEAD } from '../lib/sticky';
import { ErrorLine, UserText, useWorkspaceZone } from './parts';
import { DayText, RunStatusChip } from './recurring-parts';

const PAGE = 25;
const COLS = ['period', 'status', 'invoice', 'error', 'at'] as const;
const COL_W = [190, 120, 160, 360, 180];
const TABLE_W = COL_W.reduce((a, b) => a + b, 0);

/** The run history of one schedule: one row per generated or failed period, newest first, "load more" by cursor. */
export function RecurringRuns({ id }: { id: string }) {
  const t = useTranslations('invoicing.recurring.runs');
  const tc = useTranslations('invoicing.recurring.runs.columns');
  const locale = useLocale();
  const zone = useWorkspaceZone();
  const [scrolled, setScrolled] = useState(false);
  const q = useInfiniteQuery({
    queryKey: [...KEYS.recurring, 'runs-pages', id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      invoicingApi.recurringRuns(id, { limit: PAGE, cursor: pageParam }, signal),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    retry: false,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const th =
    'sticky top-0 z-20 border-b border-border bg-muted px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const td = 'border-b border-border px-3 py-2 align-top';

  return (
    <section
      id="runs"
      aria-label={t('title')}
      className="flex max-h-[max(22rem,70dvh)] scroll-mt-4 flex-col overflow-hidden rounded-xl border border-border bg-background"
    >
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {q.isPending ? (
          <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : q.isError ? (
          <div className="p-4">
            <ErrorLine error={q.error} onRetry={() => void q.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
          </div>
        ) : (
          <div
            role="region"
            aria-label={t('scrollArea')}
            tabIndex={0}
            onScroll={(e) => setScrolled(isScrolledSideways(e.currentTarget.scrollLeft))}
            className="thin-scrollbar min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <table
              className="w-full table-fixed border-separate border-spacing-0 text-sm"
              style={{ minWidth: TABLE_W }}
            >
              <colgroup>
                {COL_W.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className={cn(
                        th,
                        c === 'period' && `${STICKY_ONLY_HEAD} ${frozenEdge(scrolled)}`,
                      )}
                    >
                      <span className="block truncate">{tc(c)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      'group align-top transition-colors hover:bg-muted',
                      r.status === 'failed' && 'bg-danger/5',
                    )}
                  >
                    <td className={cn(td, STICKY_ONLY, frozenEdge(scrolled))}>
                      <DayText day={r.periodDate} className="font-medium" />
                      <div className="text-xs text-muted-foreground">
                        {t('period', { n: r.periodIndex + 1 })}
                      </div>
                    </td>
                    <td className={td}>
                      <RunStatusChip status={r.status} />
                    </td>
                    <td className={cn(td, 'max-w-0')}>
                      {r.invoice ? (
                        <Link
                          href={`/invoices/${r.invoice.id}`}
                          dir="auto"
                          className="block truncate font-medium text-primary outline-none hover:underline focus-visible:underline"
                        >
                          {r.invoice.number ?? t('draftInvoice')}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className={td}>
                      {r.error ? (
                        <UserText className="block whitespace-pre-wrap break-words text-danger">
                          {r.error}
                        </UserText>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className={cn(td, 'tabular-nums')}>{formatDateTime(r.at, locale, zone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!q.isPending && !q.isError && rows.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2.5 text-sm">
          <span className="text-muted-foreground" aria-live="polite">
            {t('showing', { count: rows.length })}
          </span>
          {q.hasNextPage ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {q.isFetchingNextPage && <Spinner />}
              {t('loadMore')}
            </Button>
          ) : (
            <span className="text-muted-foreground">{t('allLoaded')}</span>
          )}
        </div>
      )}
    </section>
  );
}
