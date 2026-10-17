'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, Input, Spinner, cn } from '@crm/ui';
import { useRecurringList } from '../api/hooks';
import {
  isRecurringTab,
  matchesRecurring,
  RECURRING_TABS,
  statusFilterOf,
  type RecurringTab,
} from '../lib/recurring';
import { PlusIcon, RefreshIcon, SearchIcon } from './icons';
import { ErrorLine, useInvoicingCan } from './parts';
import { useRecurringActions } from './recurring-parts';
import { RecurringTable } from './recurring-table';
import { PageFill } from '@/components/shell/page-fill';

/**
 * `/recurring-invoices`: every schedule that makes invoices by itself. Tabs filter by status on the server (no counts: the API has
 * none), the box searches the rows already loaded, and "load more" in the pinned footer pages by cursor.
 */
export function RecurringInvoicesScreen() {
  const t = useTranslations('invoicing.recurring');
  const tt = useTranslations('invoicing.recurring.tabs');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const can = useInvoicingCan();
  const panelId = useId();
  const tabParam = search.get('tab');
  const tab: RecurringTab = isRecurringTab(tabParam) ? tabParam : 'all';
  const [text, setText] = useState('');

  const list = useRecurringList({ status: statusFilterOf(tab) });
  const actions = useRecurringActions();
  const rows = useMemo(
    () => list.items.filter((r) => matchesRecurring(r, text)),
    [list.items, text],
  );
  const searching = text.trim() !== '';

  const changeTab = (next: RecurringTab) => {
    setText('');
    router.replace(next === 'all' ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  };
  const onKey = (e: React.KeyboardEvent, index: number) => {
    const rtl = document.dir === 'rtl';
    const last = RECURRING_TABS.length - 1;
    const next =
      e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
        ? (index + 1) % RECURRING_TABS.length
        : e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
          ? (index - 1 + RECURRING_TABS.length) % RECURRING_TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    changeTab(RECURRING_TABS[next]!);
    document.getElementById(`${panelId}-tab-${RECURRING_TABS[next]}`)?.focus();
  };

  const newLink = can.createRecurring ? (
    <Link
      href="/recurring-invoices/new"
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-medium text-brand-foreground hover:opacity-90"
    >
      <PlusIcon /> {t('new')}
    </Link>
  ) : null;

  return (
    <PageFill minHeight="28rem" className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
          >
            <RefreshIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
            <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/invoices"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            {t('invoices')}
          </Link>
          {newLink}
        </div>
      </header>

      <div
        role="tablist"
        aria-label={t('tabsLabel')}
        className="thin-scrollbar flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border"
      >
        {RECURRING_TABS.map((id, i) => {
          const selected = id === tab;
          return (
            <button
              key={id}
              id={`${panelId}-tab-${id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => changeTab(id)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'inline-flex min-h-10 shrink-0 items-center border-b-2 px-3 py-2.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                selected
                  ? 'border-brand text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tt(id)}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={text}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-10 ps-9"
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          className="h-10"
          disabled={list.isFetching}
          onClick={() => void list.refetch()}
          aria-label={t('refresh')}
          title={t('refresh')}
        >
          <RefreshIcon className={cn(list.isFetching && 'animate-spin')} />
        </Button>
      </div>

      <section
        id={panelId}
        role="tabpanel"
        aria-label={t('tableLabel')}
        aria-busy={list.isFetching}
        className="flex min-h-0 shrink flex-col overflow-hidden rounded-xl border border-border bg-background"
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col transition-opacity',
            list.isPlaceholderData && 'opacity-60',
          )}
        >
          {list.isPending ? (
            <ListSkeleton />
          ) : list.isError ? (
            <div className="p-4">
              <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={searching ? t('emptySearchTitle') : t(`empty.${tab}.title`)}
                message={searching ? t('emptySearch') : t(`empty.${tab}.message`)}
                actions={
                  searching ? (
                    <Button variant="secondary" onClick={() => setText('')}>
                      {t('clearSearch')}
                    </Button>
                  ) : tab === 'all' ? (
                    newLink
                  ) : undefined
                }
              />
            </div>
          ) : (
            <RecurringTable
              rows={rows}
              handlers={{
                pendingId: actions.pending,
                onPause: (r) => void actions.pause(r),
                onResume: (r) => void actions.resume(r),
                onRunNow: actions.askRunNow,
                onDelete: actions.askDelete,
              }}
            />
          )}
        </div>
        {!list.isPending && !list.isError && list.items.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
              {list.isFetching && <Spinner label={t('loading')} />}
              {searching
                ? t('showingMatches', { count: rows.length, loaded: list.items.length })
                : t('showing', { count: list.items.length })}
            </span>
            {list.hasNextPage ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage && <Spinner />}
                {t('loadMore')}
              </Button>
            ) : (
              <span className="text-muted-foreground">{t('allLoaded')}</span>
            )}
          </div>
        )}
      </section>

      {searching && list.hasNextPage && (
        <p className="text-xs text-muted-foreground">{t('searchLoadedOnly')}</p>
      )}
      {actions.node}
    </PageFill>
  );
}

function ListSkeleton() {
  const t = useTranslations('invoicing.recurring');
  return (
    <div role="status" aria-label={t('loading')} className="divide-y divide-border">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex h-14 animate-pulse items-center gap-4 px-4">
          <span className="h-3 w-32 rounded bg-muted" />
          <span className="hidden h-3 w-24 rounded bg-muted sm:block" />
          <span className="hidden h-3 w-20 rounded bg-muted md:block" />
          <span className="ms-auto h-5 w-16 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}
