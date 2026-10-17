'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useReducer, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog, EmptyState, Spinner, cn, useToast } from '@crm/ui';
import { invalidateInvoicing, useInvoiceCounts, useInvoicesList } from '../api/hooks';
import { invoicingApi, type BulkAction, type BulkOutcome } from '../api/service';
import {
  countsQuery,
  DEFAULT_FILTERS,
  filtersToSearch,
  hasActiveFilter,
  listQuery,
  parseFilters,
  type InvoiceFilters,
} from '../lib/filters';
import { EMPTY_SELECTION, headerState, selectionReducer } from '../lib/selection';
import type { InvoiceTab } from '../lib/status';
import { BulkBar, BulkVoidDialog, eligibleRows } from './bulk-bar';
import { InvoiceIcon, PlusIcon } from './icons';
import { InvoicesTable } from './invoices-table';
import { InvoicesTabs } from './invoices-tabs';
import { InvoicesToolbar } from './invoices-toolbar';
import { OutstandingStrip } from './outstanding-strip';
import { ErrorLine, useErrorText, useInvoicingCan } from './parts';
import { useInvoiceDialogs } from './use-invoice-dialogs';
import { PageFill } from '@/components/shell/page-fill';

/**
 * `/invoices`: the invoice list. The tab, the filters and the sort live in the address; the selection and the open dialogs are
 * local state over the list query. Pinned footer with "load more" (cursor paging: no page numbers, no total).
 */
export function InvoicesScreen() {
  const t = useTranslations('invoicing.list');
  const tb = useTranslations('invoicing.bulk');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const can = useInvoicingCan();
  const errorText = useErrorText();
  const panelId = useId();

  const filters = useMemo(() => parseFilters(search), [search]);
  const setFilters = useCallback(
    (patch: Partial<InvoiceFilters>) =>
      router.replace(`${pathname}${filtersToSearch({ ...filters, ...patch })}`, { scroll: false }),
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

  const list = useInvoicesList(listQuery(filters));
  const counts = useInvoiceCounts(countsQuery(filters));
  const rows = list.items;
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);

  const [sel, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);
  const idsKey = rowIds.join(',');
  useEffect(() => dispatch({ type: 'retain', ids: rowIds }), [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const header = headerState(rowIds, sel.ids);
  const selectedRows = rows.filter((r) => sel.ids.has(r.id));

  const dialogs = useInvoiceDialogs();
  const [bulkConfirm, setBulkConfirm] = useState<BulkAction | null>(null);
  const [busy, setBusy] = useState(false);

  const changeTab = (tab: InvoiceTab) => {
    dispatch({ type: 'clear' });
    setFilters({ tab });
  };

  async function runBulk(action: BulkAction, reason?: string) {
    const rowsFor = eligibleRows(selectedRows, action, can);
    const skipped = selectedRows.length - rowsFor.length;
    setBusy(true);
    let out: BulkOutcome | undefined;
    try {
      out = await invoicingApi.bulk(
        action,
        rowsFor.map((r) => ({ id: r.id, rowVersion: r.rowVersion })),
        { reason },
      );
    } catch (e) {
      toast(`${tb('failed')} ${errorText(e)}`, 'danger');
    } finally {
      setBusy(false);
      setBulkConfirm(null);
    }
    if (!out) return;
    dispatch({ type: 'clear' });
    await invalidateInvoicing(qc);
    toast(tb(`done.${action}`, { count: out.changed }), out.changed === 0 ? 'danger' : 'success');
    if (out.failed > 0) toast(tb('someFailed', { count: out.failed }), 'danger');
    if (skipped > 0) toast(tb('someSkipped', { count: skipped }), 'info');
  }

  const onBulk = (a: BulkAction) => {
    if (a === 'void' || a === 'delete') setBulkConfirm(a);
    else void runBulk(a);
  };

  const filtered = hasActiveFilter({ ...filters, q });
  const settled = !list.isPending;

  return (
    <PageFill minHeight="36rem" className="space-y-3">
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
        <div className="flex items-center gap-2">
          <Link
            href="/payments"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            {t('payments')}
          </Link>
          {can.create && (
            <Link
              href="/invoices/new"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-medium text-brand-foreground hover:opacity-90"
            >
              <PlusIcon /> {t('newInvoice')}
            </Link>
          )}
        </div>
      </header>

      <OutstandingStrip counts={counts.data} />

      <InvoicesTabs
        value={filters.tab}
        onChange={changeTab}
        counts={counts.data}
        panelId={panelId}
      />

      <InvoicesToolbar
        filters={filters}
        q={q}
        onQ={setQ}
        onChange={setFilters}
        onRefresh={() => void Promise.all([invalidateInvoicing(qc), list.refetch()])}
        refreshing={list.isFetching}
        filtered={filtered}
        onReset={() => {
          setQ('');
          setFilters({ ...DEFAULT_FILTERS, tab: filters.tab });
        }}
      />

      {sel.ids.size > 0 && (
        <BulkBar
          count={sel.ids.size}
          rows={selectedRows}
          busy={busy}
          can={can}
          onAction={onBulk}
          onClear={() => dispatch({ type: 'clear' })}
        />
      )}

      <section
        id={panelId}
        role="tabpanel"
        aria-label={t('tableLabel')}
        aria-busy={list.isFetching}
        // The card is as tall as the window allows: the rows scroll inside it and the footer stays pinned.
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
            <div className="space-y-3 p-4">
              <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={filtered ? t('emptyFilteredTitle') : t(`empty.${filters.tab}.title`)}
                message={filtered ? t('emptyFiltered') : t(`empty.${filters.tab}.message`)}
                actions={
                  <>
                    {filtered && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setQ('');
                          setFilters({ ...DEFAULT_FILTERS, tab: filters.tab });
                        }}
                      >
                        {t('resetFilters')}
                      </Button>
                    )}
                    {can.create && !filtered && (
                      <Link
                        href="/invoices/new"
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:opacity-90"
                      >
                        {t('newInvoice')}
                      </Link>
                    )}
                  </>
                }
              />
            </div>
          ) : (
            <InvoicesTable
              invoices={rows}
              headerState={header}
              onToggleAll={(checked) => dispatch({ type: 'setMany', ids: rowIds, checked })}
              selected={sel.ids}
              activeId={null}
              onToggleSelect={(id) => dispatch({ type: 'toggle', id })}
              onDialog={dialogs.open}
              onDuplicated={(copy) => router.push(`/invoices/${copy.id}/edit`)}
            />
          )}
        </div>
        {settled && !list.isError && rows.length > 0 && (
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

      {bulkConfirm === 'void' && (
        <BulkVoidDialog
          eligible={eligibleRows(selectedRows, 'void', can).length}
          skipped={selectedRows.length - eligibleRows(selectedRows, 'void', can).length}
          busy={busy}
          onConfirm={(reason) => void runBulk('void', reason)}
          onClose={() => setBulkConfirm(null)}
        />
      )}
      <ConfirmDialog
        open={bulkConfirm === 'delete'}
        tone="danger"
        busy={busy}
        title={tb('confirm.delete.title')}
        message={tb('confirm.delete.message', {
          count: eligibleRows(selectedRows, 'delete', can).length,
        })}
        confirmLabel={tb('confirm.delete.confirm')}
        cancelLabel={tb('keep')}
        onClose={() => setBulkConfirm(null)}
        onConfirm={() => void runBulk('delete')}
      />
    </PageFill>
  );
}

function ListSkeleton() {
  const t = useTranslations('invoicing.list');
  return (
    <div role="status" aria-label={t('loading')} className="divide-y divide-border">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-14 animate-pulse items-center gap-4 px-4">
          <span className="size-4 rounded bg-muted" />
          <span className="h-3 w-28 rounded bg-muted" />
          <span className="hidden h-5 w-32 rounded-full bg-muted sm:block" />
          <span className="hidden h-3 w-20 rounded bg-muted md:block" />
          <span className="ms-auto h-5 w-16 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}
