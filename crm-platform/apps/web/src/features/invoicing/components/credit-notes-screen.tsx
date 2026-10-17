'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, Input, Spinner, cn } from '@crm/ui';
import { invalidateInvoicing, useContactName, useCreditNotesList, useInvoice } from '../api/hooks';
import {
  CREDIT_TABS,
  creditFiltersToSearch,
  creditListQuery,
  DEFAULT_CREDIT_FILTERS,
  hasActiveCreditFilter,
  parseCreditFilters,
  type CreditFilters,
  type CreditTab,
} from '../lib/credit-notes';
import { ContactPicker } from './contact-picker';
import { CloseIcon, InvoiceIcon, PlusIcon, RefreshIcon, SearchIcon } from './icons';
import { newCreditNoteHref, useCreditNoteDialogs } from './credit-notes-parts';
import { CreditNotesTable } from './credit-notes-table';
import { ErrorLine, useInvoicingCan } from './parts';
import { PageFill } from '@/components/shell/page-fill';

/**
 * `/credit-notes`: every credit note of the workspace. The tab, the search and the filters live in the address; the list is a
 * cursor list with "load more" in a pinned footer. The API has no counts endpoint, so the tabs carry no badges.
 */
export function CreditNotesScreen() {
  const t = useTranslations('invoicing.creditNotes.list');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const can = useInvoicingCan();
  const panelId = useId();
  const dialogs = useCreditNoteDialogs();

  const filters = useMemo(() => parseCreditFilters(search), [search]);
  const setFilters = useCallback(
    (patch: Partial<CreditFilters>) =>
      router.replace(`${pathname}${creditFiltersToSearch({ ...filters, ...patch })}`, {
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

  const list = useCreditNotesList(creditListQuery(filters), { enabled: can.readCreditNotes });
  const rows = list.items;
  const filtered = hasActiveCreditFilter({ ...filters, q });
  const reset = () => {
    setQ('');
    setFilters({ ...DEFAULT_CREDIT_FILTERS, tab: filters.tab });
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
        <div className="flex items-center gap-2">
          <Link
            href="/invoices"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            {t('invoices')}
          </Link>
          {can.createCreditNote && (
            <Link
              href={newCreditNoteHref(filters.invoiceId || undefined)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-medium text-brand-foreground hover:opacity-90"
            >
              <PlusIcon /> {t('newCreditNote')}
            </Link>
          )}
        </div>
      </header>

      <CreditTabs value={filters.tab} onChange={(tab) => setFilters({ tab })} panelId={panelId} />

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
        {filters.invoiceId && (
          <InvoiceFilterChip id={filters.invoiceId} onClear={() => setFilters({ invoiceId: '' })} />
        )}
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
          {!can.readCreditNotes ? (
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
                  ) : can.createCreditNote ? (
                    <Link
                      href={newCreditNoteHref()}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:opacity-90"
                    >
                      {t('newCreditNote')}
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <CreditNotesTable notes={rows} onDialog={(kind, n) => dialogs.open(kind, n)} />
          )}
        </div>
        {can.readCreditNotes && !list.isPending && !list.isError && rows.length > 0 && (
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

/** All, Draft, Issued, Void. Arrow keys move between tabs (mirrored in RTL), Home and End jump. */
function CreditTabs({
  value,
  onChange,
  panelId,
}: {
  value: CreditTab;
  onChange: (tab: CreditTab) => void;
  panelId: string;
}) {
  const t = useTranslations('invoicing.creditNotes.tabs');
  const base = useId();
  const onKey = (e: React.KeyboardEvent, index: number) => {
    const last = CREDIT_TABS.length - 1;
    const rtl = document.dir === 'rtl';
    const next =
      e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
        ? (index + 1) % CREDIT_TABS.length
        : e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
          ? (index - 1 + CREDIT_TABS.length) % CREDIT_TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    onChange(CREDIT_TABS[next]!);
    document.getElementById(`${base}-${CREDIT_TABS[next]}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t('label')}
      className="thin-scrollbar flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border"
    >
      {CREDIT_TABS.map((tab, i) => (
        <button
          key={tab}
          id={`${base}-${tab}`}
          role="tab"
          type="button"
          aria-selected={tab === value}
          aria-controls={panelId}
          tabIndex={tab === value ? 0 : -1}
          onClick={() => onChange(tab)}
          onKeyDown={(e) => onKey(e, i)}
          className={cn(
            'inline-flex shrink-0 items-center border-b-2 px-3 py-2.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
            tab === value
              ? 'border-brand text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t(tab)}
        </button>
      ))}
    </div>
  );
}

function ContactFilter({ id, onChange }: { id: string; onChange: (id: string) => void }) {
  const t = useTranslations('invoicing.creditNotes.list');
  const name = useContactName(id);
  return (
    <ContactPicker
      compact
      value={id ? { id, label: name.data ?? t('contactLoading') } : null}
      onChange={(c) => onChange(c?.id ?? '')}
    />
  );
}

/** "Invoice INV-...": the list is narrowed to one invoice (from its page); the chip takes the filter off. */
function InvoiceFilterChip({ id, onClear }: { id: string; onClear: () => void }) {
  const t = useTranslations('invoicing.creditNotes.list');
  const inv = useInvoice(id);
  return (
    <span className="inline-flex h-10 max-w-64 items-center gap-2 rounded-md border border-border bg-muted/40 ps-3 pe-1 text-sm">
      <span className="min-w-0 truncate" dir="auto">
        {t('invoiceChip', { number: inv.data?.number ?? t('contactLoading') })}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label={t('clearInvoice')}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <CloseIcon className="size-3.5" />
      </button>
    </span>
  );
}

function ListSkeleton() {
  const t = useTranslations('invoicing.creditNotes.list');
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
