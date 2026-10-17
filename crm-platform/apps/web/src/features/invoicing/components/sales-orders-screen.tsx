'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { SalesOrderCounts } from '@crm/contracts';
import { Button, EmptyState, Input, Spinner, cn } from '@crm/ui';
import {
  invalidateInvoicing,
  useContactName,
  useSalesOrderCounts,
  useSalesOrdersList,
} from '../api/hooks';
import { exponentOf, formatMoney } from '../lib/money';
import {
  DEFAULT_SO_FILTERS,
  SO_TABS,
  hasActiveSalesOrderFilter,
  parseSalesOrderFilters,
  salesOrderFiltersToSearch,
  salesOrderListQuery,
  salesOrderTabCount,
  type SalesOrderFilters,
  type SalesOrderQuick,
  type SalesOrderTab,
} from '../lib/sales-orders';
import { majorToMinor } from '../lib/wire';
import { ContactPicker } from './contact-picker';
import { InvoiceIcon, PlusIcon, RefreshIcon, SearchIcon } from './icons';
import { ErrorLine, useInvoicingCan } from './parts';
import { useSalesOrderDialogs } from './sales-order-dialogs';
import { newSalesOrderHref } from './sales-order-parts';
import { SalesOrdersTable } from './sales-orders-table';
import { PageFill } from '@/components/shell/page-fill';

/**
 * `/sales-orders`: every order of the workspace. The tab, the quick filters ("To invoice", "To fulfil"), the search and the
 * contact live in the address; the list is a cursor list with "load more" in a pinned footer.
 */
export function SalesOrdersScreen() {
  const t = useTranslations('invoicing.salesOrders.list');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const can = useInvoicingCan();
  const panelId = useId();
  const dialogs = useSalesOrderDialogs();

  const filters = useMemo(() => parseSalesOrderFilters(search), [search]);
  const setFilters = useCallback(
    (patch: Partial<SalesOrderFilters>) =>
      router.replace(`${pathname}${salesOrderFiltersToSearch({ ...filters, ...patch })}`, {
        scroll: false,
      }),
    [router, pathname, filters],
  );

  // Search applies 350 ms after typing stops.
  const [q, setQ] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  if (filters.q !== seenQ) {
    setSeenQ(filters.q);
    setQ(filters.q);
  }
  useEffect(() => {
    if (q.trim() === filters.q.trim()) return;
    const id = window.setTimeout(() => setFilters({ q: q.trim() }), 350);
    return () => window.clearTimeout(id);
    // The timer restarts on every keystroke; setFilters closes over the current filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const list = useSalesOrdersList(salesOrderListQuery(filters), { enabled: can.readSalesOrders });
  const counts = useSalesOrderCounts();
  const rows = list.items;
  const filtered = hasActiveSalesOrderFilter({ ...filters, q });
  const reset = () => {
    setQ('');
    setFilters({ ...DEFAULT_SO_FILTERS });
  };

  return (
    <PageFill minHeight="28rem" className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
          >
            <InvoiceIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
            <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
          </div>
        </div>
        {can.createSalesOrder && (
          <Link
            href={newSalesOrderHref({ contact: filters.contactId || undefined })}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-medium text-brand-foreground hover:opacity-90"
          >
            <PlusIcon /> {t('newOrder')}
          </Link>
        )}
      </header>

      <OpenValueStrip counts={counts.data} />

      <OrderTabs
        value={filters.quick ? 'confirmed' : filters.tab}
        counts={counts.data}
        panelId={panelId}
        onChange={(tab) => setFilters({ tab, quick: '' })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <QuickFilters
          value={filters.quick}
          counts={counts.data}
          onChange={(quick) => setFilters({ quick, tab: quick ? 'confirmed' : 'all' })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56 sm:max-w-sm">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="ps-9"
          />
        </div>
        <ContactFilter id={filters.contactId} onChange={(id) => setFilters({ contactId: id })} />
        {filtered && (
          <Button variant="ghost" onClick={reset}>
            {t('reset')}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => void Promise.all([invalidateInvoicing(qc), list.refetch()])}
          aria-label={t('refresh')}
          title={t('refresh')}
          className="ms-auto size-10 px-0"
        >
          {list.isFetching ? <Spinner /> : <RefreshIcon />}
        </Button>
      </div>

      <section
        id={panelId}
        role="tabpanel"
        aria-label={t('tableLabel')}
        aria-busy={list.isFetching}
        // As tall as the window allows: the rows scroll inside it and the footer stays pinned.
        className="flex min-h-0 shrink flex-col overflow-hidden rounded-xl border border-border bg-background"
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col transition-opacity',
            list.isPlaceholderData && 'opacity-60',
          )}
        >
          {!can.readSalesOrders ? (
            <div className="p-4">
              <EmptyState title={t('noAccessTitle')} message={t('noAccess')} />
            </div>
          ) : list.isPending ? (
            <ListSkeleton />
          ) : list.isError ? (
            <div className="p-4">
              <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={filtered ? t('emptyFilteredTitle') : t(`empty.${filters.tab}.title`)}
                message={filtered ? t('emptyFiltered') : t(`empty.${filters.tab}.message`)}
                actions={
                  filtered ? (
                    <Button variant="secondary" onClick={reset}>
                      {t('resetFilters')}
                    </Button>
                  ) : can.createSalesOrder ? (
                    <Link
                      href={newSalesOrderHref()}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:opacity-90"
                    >
                      {t('newOrder')}
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <SalesOrdersTable orders={rows} onDialog={(kind, o) => dialogs.open(kind, o)} />
          )}
        </div>
        {can.readSalesOrders && !list.isPending && !list.isError && rows.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
              {list.isFetching && <Spinner label={t('loading')} />}
              {t('showing', { count: rows.length })}
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

      {dialogs.node}
    </PageFill>
  );
}

/** What the open (confirmed) orders are worth, one tile per currency: currencies are never added together. */
function OpenValueStrip({ counts }: { counts: SalesOrderCounts | undefined }) {
  const t = useTranslations('invoicing.salesOrders.strip');
  const locale = useLocale();
  const open = (counts?.openValue ?? []).filter(
    (v) => majorToMinor(v.amount, exponentOf(v.currency)) > 0,
  );
  if (open.length === 0) return null;
  return (
    <section aria-label={t('label')} className="flex flex-wrap gap-2">
      {open.map((v) => (
        <div key={v.currency} className="rounded-xl border border-border bg-background px-4 py-2.5">
          <div className="text-xs font-medium text-muted-foreground">
            {t('openValue', { currency: v.currency })}
          </div>
          <div dir="ltr" className="text-lg font-semibold tabular-nums">
            {formatMoney(majorToMinor(v.amount, exponentOf(v.currency)), v.currency, locale)}
          </div>
        </div>
      ))}
    </section>
  );
}

/** All, Draft, Confirmed, Cancelled, Closed. Arrow keys move between tabs (mirrored in RTL), Home and End jump. */
function OrderTabs({
  value,
  onChange,
  counts,
  panelId,
}: {
  value: SalesOrderTab;
  onChange: (tab: SalesOrderTab) => void;
  counts: SalesOrderCounts | undefined;
  panelId: string;
}) {
  const t = useTranslations('invoicing.salesOrders.tabs');
  const base = useId();
  const onKey = (e: React.KeyboardEvent, index: number) => {
    const last = SO_TABS.length - 1;
    const rtl = document.dir === 'rtl';
    const next =
      e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
        ? (index + 1) % SO_TABS.length
        : e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
          ? (index - 1 + SO_TABS.length) % SO_TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    onChange(SO_TABS[next]!);
    document.getElementById(`${base}-${SO_TABS[next]}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t('label')}
      className="thin-scrollbar flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border"
    >
      {SO_TABS.map((tab, i) => {
        const n = salesOrderTabCount(counts, tab);
        const selected = tab === value;
        return (
          <button
            key={tab}
            id={`${base}-${tab}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
              selected
                ? 'border-brand text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(tab)}
            {n !== undefined && (
              <span
                aria-label={t('count', { count: n })}
                className={cn(
                  'min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums',
                  selected
                    ? 'bg-brand/15 text-brand dark:text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {n.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** "To invoice" and "To fulfil": confirmed orders with something left to bill or deliver (pressed again to clear). */
function QuickFilters({
  value,
  counts,
  onChange,
}: {
  value: SalesOrderQuick;
  counts: SalesOrderCounts | undefined;
  onChange: (next: SalesOrderQuick) => void;
}) {
  const t = useTranslations('invoicing.salesOrders.quick');
  return (
    <div role="group" aria-label={t('label')} className="flex flex-wrap items-center gap-2">
      {(['toInvoice', 'toFulfil'] as const).map((k) => {
        const on = value === k;
        const n = salesOrderTabCount(counts, k);
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? '' : k)}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
              on ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted',
            )}
          >
            {t(k)}
            {n !== undefined && (
              <span className="rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {n.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ContactFilter({ id, onChange }: { id: string; onChange: (id: string) => void }) {
  const t = useTranslations('invoicing.salesOrders.list');
  const name = useContactName(id);
  return (
    <ContactPicker
      compact
      value={id ? { id, label: name.data ?? t('contactLoading') } : null}
      onChange={(c) => onChange(c?.id ?? '')}
    />
  );
}

function ListSkeleton() {
  const t = useTranslations('invoicing.salesOrders.list');
  return (
    <div role="status" aria-label={t('loading')} className="divide-y divide-border">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-14 animate-pulse items-center gap-4 px-4">
          <span className="h-3 w-28 rounded bg-muted" />
          <span className="hidden h-3 w-24 rounded bg-muted sm:block" />
          <span className="hidden h-5 w-24 rounded-full bg-muted md:block" />
          <span className="ms-auto h-5 w-16 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}
