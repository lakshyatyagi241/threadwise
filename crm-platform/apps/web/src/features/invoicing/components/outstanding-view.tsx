'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, EmptyState, Spinner, cn } from '@crm/ui';
import { useOutstandingList } from '../api/hooks';
import { minorNum } from '../lib/aging';
import { formatDay } from '../lib/dates';
import { outstandingQuery, type PaymentFilters } from '../lib/payment-filters';
import { frozenEdge, isScrolledSideways, STICKY_ONLY, STICKY_ONLY_HEAD } from '../lib/sticky';
import { ErrorLine, Money, UserText } from './parts';

const COL_W = [220, 90, 150, 150, 100, 150];
const COLS = ['contact', 'currency', 'outstanding', 'overdue', 'invoices', 'oldestDue'] as const;

/** Who owes what: one row per contact and currency, biggest debt first, "load more" in a pinned footer. */
export function OutstandingView({ filters, filtered, onReset }: { filters: PaymentFilters; filtered: boolean; onReset: () => void }) {
  const t = useTranslations('invoicing.payments.outstanding');
  const locale = useLocale();
  const list = useOutstandingList(outstandingQuery(filters));
  const [scrolled, setScrolled] = useState(false);
  const rows = list.items;
  const th = 'sticky top-0 z-20 border-b border-border bg-muted px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const numeric = new Set(['outstanding', 'overdue', 'invoices']);

  return (
    <section
      aria-label={t('tableLabel')}
      aria-busy={list.isFetching}
      className="flex max-h-[max(26rem,calc(100dvh-24rem))] flex-col overflow-hidden rounded-xl border border-border bg-background"
    >
      <div className={cn('flex min-h-0 flex-1 flex-col transition-opacity', list.isPlaceholderData && 'opacity-60')}>
        {list.isPending ? (
          <div role="status" aria-label={t('loading')} className="divide-y divide-border">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex h-14 animate-pulse items-center gap-4 px-4">
                <span className="h-3 w-28 rounded bg-muted" />
                <span className="ms-auto h-3 w-16 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : list.isError ? (
          <div className="p-4">
            <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={filtered ? t('emptyFilteredTitle') : t('emptyTitle')}
              message={filtered ? t('emptyFiltered') : t('emptyMessage')}
              actions={
                filtered ? (
                  <Button variant="secondary" onClick={onReset}>
                    {t('resetFilters')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div
            role="region"
            aria-label={t('scrollArea')}
            tabIndex={0}
            onScroll={(e) => setScrolled(isScrolledSideways(e.currentTarget.scrollLeft))}
            className="thin-scrollbar h-full min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: COL_W.reduce((a, b) => a + b, 0) }}>
              <colgroup>
                {COL_W.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c} scope="col" className={cn(th, numeric.has(c) && 'text-end', c === 'contact' && `${STICKY_ONLY_HEAD} ${frozenEdge(scrolled)}`)}>
                      <span className="block truncate">{t(`columns.${c}`)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.contact?.id ?? 'none'}-${r.currency}-${i}`} className="group h-14 align-middle transition-colors hover:bg-muted">
                    <td className={cn('max-w-0 border-b border-border px-3 py-2', STICKY_ONLY, frozenEdge(scrolled))}>
                      {r.contact ? (
                        <Link href={`/contacts/${r.contact.id}`} className="block truncate font-medium hover:text-primary hover:underline" title={r.contact.name ?? ''}>
                          <UserText>{r.contact.name || t('unnamed')}</UserText>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{t('noContact')}</span>
                      )}
                    </td>
                    <td className="border-b border-border px-3 py-2 text-muted-foreground">{r.currency}</td>
                    <td className="border-b border-border px-3 py-2 text-end font-semibold">
                      <Money minor={minorNum(r.outstanding, r.currency)} currency={r.currency} />
                    </td>
                    <td className="border-b border-border px-3 py-2 text-end">
                      {minorNum(r.overdue, r.currency) > 0 ? (
                        <Money minor={minorNum(r.overdue, r.currency)} currency={r.currency} className="text-danger" />
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="border-b border-border px-3 py-2 text-end tabular-nums">
                      {r.contact ? (
                        <Link
                          href={`/invoices?status=issued,partially_paid,overdue&contact=${r.contact.id}&currency=${r.currency}`}
                          className="hover:text-primary hover:underline"
                        >
                          {r.invoices}
                        </Link>
                      ) : (
                        r.invoices
                      )}
                    </td>
                    <td className="border-b border-border px-3 py-2 tabular-nums text-muted-foreground">{formatDay(r.oldestDueDate, locale) || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!list.isPending && !list.isError && rows.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
            {list.isFetching && <Spinner label={t('loading')} />}
            {t('showing', { count: rows.length })}
          </span>
          {list.hasNextPage ? (
            <Button variant="secondary" size="sm" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {list.isFetchingNextPage && <Spinner />}
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
