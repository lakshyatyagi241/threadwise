'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useReducer, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, ConfirmDialog, EmptyState, Spinner, cn, useToast } from '@crm/ui';
import {
  invalidateDocs,
  removeDocsFromCache,
  useDocCounts,
  useDocsList,
  useMembers,
} from '../api/hooks';
import { salesDocsApi } from '../api/service';
import { isUnavailable } from '../lib/errors';
import {
  countsQuery,
  filtersToSearch,
  hasActiveFilter,
  listQuery,
  parseFilters,
  type DocFilters,
} from '../lib/filters';
import { listHotkey, moveActive } from '../lib/hotkeys';
import { docHref, newDocHref, type SalesDocKind } from '../lib/kinds';
import { formatMoney } from '../lib/money';
import { EMPTY_SELECTION, headerState, selectionReducer } from '../lib/selection';
import type { DocTab } from '../lib/status';
import { ActivityDrawer } from './activity-drawer';
import { BulkBar } from './bulk-bar';
import { useDocController } from './doc-controller';
import { DocsTable } from './docs-table';
import { DocsTabs } from './docs-tabs';
import { DocsToolbar, SEARCH_ID } from './docs-toolbar';
import { EstimateIcon, PlusIcon, ProposalIcon } from './icons';
import { ErrorLine, useErrorText, useSalesDocsCan, useToday, useWorkspaceZone } from './parts';
import { ShortcutsModal } from './shortcuts-modal';

/** The primary button of the header band, as a link (it opens the builder). */
export const primaryLink =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-medium text-brand-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * `/proposals` and `/estimates`: one screen, the kind says which. Status tabs with counts, search and filters, a table with a
 * frozen first column and a pinned footer, bulk delete, and a row menu with every action a document has. The tab, the filters
 * and the open activity drawer live in the address; everything else is local state over the list query.
 */
export function SalesDocsScreen({ kind }: { kind: SalesDocKind }) {
  const t = useTranslations('sales-docs.list');
  const tb = useTranslations('sales-docs.bulk');
  const tk = useTranslations('sales-docs.kind');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const can = useSalesDocsCan();
  const errorText = useErrorText();
  const panelId = useId();
  const today = useToday();
  const zone = useWorkspaceZone();

  const filters = useMemo(() => parseFilters(search), [search]);
  const setFilters = useCallback(
    (patch: Partial<DocFilters>) =>
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

  const members = useMembers();
  const list = useDocsList(kind, listQuery(filters, today));
  const counts = useDocCounts(kind, countsQuery(filters, today));
  const rows = list.items;
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);

  // selection and the keyboard's row
  const [sel, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);
  const idsKey = rowIds.join(',');
  useEffect(() => dispatch({ type: 'retain', ids: rowIds }), [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeId, setActiveId] = useState<string | null>(null);
  const header = headerState(rowIds, sel.ids);

  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const controller = useDocController({
    kind,
    onActivity: (doc) => setFilters({ activity: doc.id }),
    // a duplicate opens its own draft; everything else just refreshes the list (the hooks invalidate)
  });

  const changeTab = (tab: DocTab) => {
    dispatch({ type: 'clear' });
    setActiveId(null);
    setFilters({ tab });
  };

  async function bulkDelete() {
    const ids = [...sel.ids];
    setBusy(true);
    try {
      const out = await salesDocsApi.bulkDelete(ids);
      setConfirmBulkDelete(false);
      removeDocsFromCache(qc, new Set(ids));
      dispatch({ type: 'clear' });
      await invalidateDocs(qc);
      toast(tb('deleted', { count: out.changed }), out.changed === 0 ? 'danger' : 'success');
      if (out.failed > 0) toast(tb('someFailed', { count: out.failed }), 'danger');
    } catch (e) {
      setConfirmBulkDelete(false);
      toast(`${tb('failed')} ${errorText(e)}`, 'danger');
    } finally {
      setBusy(false);
    }
  }

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      const action = listHotkey({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: el?.tagName,
        targetEditable: el?.isContentEditable,
        inDialog: !!document.querySelector('dialog[open]') || !!el?.closest('[role="menu"]'),
      });
      if (!action) return;
      const at = activeId ? rowIds.indexOf(activeId) : -1;
      const active = at >= 0 ? rows[at] : undefined;
      switch (action) {
        case 'next':
        case 'prev': {
          e.preventDefault();
          const to = moveActive(at, rowIds.length, action);
          setActiveId(to >= 0 ? (rowIds[to] ?? null) : null);
          return;
        }
        case 'open':
          if (active) {
            e.preventDefault();
            router.push(docHref(active.kind, active.id));
          }
          return;
        case 'toggleSelect':
          if (active) dispatch({ type: 'toggle', id: active.id });
          return;
        case 'newDoc':
          if (can.create) {
            e.preventDefault();
            router.push(newDocHref(kind));
          }
          return;
        case 'focusSearch':
          e.preventDefault();
          document.getElementById(SEARCH_ID)?.focus();
          return;
        case 'clearSelection':
          if (filters.activity) return;
          dispatch({ type: 'clear' });
          setActiveId(null);
          return;
        case 'help':
          e.preventDefault();
          setHelpOpen(true);
          return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const filtered = hasActiveFilter({ ...filters, q });
  const selectedCount = sel.ids.size;
  const settled = !list.isPending;
  const KindIcon = kind === 'proposal' ? ProposalIcon : EstimateIcon;
  const activityDoc = filters.activity ? rows.find((r) => r.id === filters.activity) : undefined;
  const openValue = counts.data?.openValue ?? [];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
          >
            <KindIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{t(`${kind}.title`)}</h1>
            <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
              {t(`${kind}.subtitle`)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {openValue.length > 0 && (
            <div className="hidden text-end md:block" aria-label={t('openValue')}>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('openValue')}
              </div>
              <div className="text-sm font-semibold tabular-nums" dir="ltr">
                {openValue.map((v) => formatMoney(v.minor, v.currency, locale)).join(' · ')}
              </div>
            </div>
          )}
          {can.create && (
            <Link href={newDocHref(kind)} className={primaryLink}>
              <PlusIcon /> {t(`${kind}.new`)}
            </Link>
          )}
        </div>
      </header>

      <DocsTabs value={filters.tab} onChange={changeTab} counts={counts.data} panelId={panelId} />

      <DocsToolbar
        filters={filters}
        q={q}
        onQ={setQ}
        onChange={setFilters}
        members={members.data ?? []}
        onRefresh={() => void Promise.all([invalidateDocs(qc), list.refetch()])}
        refreshing={list.isFetching}
        onHelp={() => setHelpOpen(true)}
      />

      {selectedCount > 0 && (
        <BulkBar
          count={selectedCount}
          busy={busy}
          canDelete={can.remove}
          onDelete={() => setConfirmBulkDelete(true)}
          onClear={() => dispatch({ type: 'clear' })}
        />
      )}

      <section
        id={panelId}
        role="tabpanel"
        aria-label={t('tableLabel')}
        aria-busy={list.isFetching}
        // The card is as tall as the window allows: the rows scroll inside it and the footer stays pinned.
        className="flex max-h-[max(26rem,calc(100dvh-17rem))] flex-col overflow-hidden rounded-xl border border-border bg-background"
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
              {isUnavailable(list.error) && process.env.NODE_ENV === 'development' && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    try {
                      window.localStorage.setItem('sales-docs:mock', '1');
                    } catch {
                      /* nothing to remember */
                    }
                    window.location.reload();
                  }}
                >
                  {t('useSampleData')}
                </Button>
              )}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={
                  filtered
                    ? t('emptyFilteredTitle')
                    : filters.tab === 'all'
                      ? t(`${kind}.emptyTitle`)
                      : t('emptyTabTitle', { status: t(`statusWord.${filters.tab}`) })
                }
                message={
                  filtered
                    ? t('emptyFiltered')
                    : filters.tab === 'all'
                      ? t(`${kind}.emptyMessage`)
                      : t('emptyTab', { kind: tk(`${kind}.plural`) })
                }
                actions={
                  <>
                    {filtered && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setQ('');
                          setFilters({ q: '', owner: '', contact: '', deal: '', validity: '' });
                        }}
                      >
                        {t('resetFilters')}
                      </Button>
                    )}
                    {can.create && !filtered && filters.tab === 'all' && (
                      <Link href={newDocHref(kind)} className={primaryLink}>
                        <PlusIcon /> {t(`${kind}.new`)}
                      </Link>
                    )}
                  </>
                }
              />
            </div>
          ) : (
            <DocsTable
              docs={rows}
              headerState={header}
              onToggleAll={(checked) => dispatch({ type: 'setMany', ids: rowIds, checked })}
              selected={sel.ids}
              activeId={activeId}
              can={{
                update: can.update,
                create: can.create,
                delete: can.remove,
                send: can.send,
                convert: can.convert,
                order: can.order,
              }}
              today={today}
              zone={zone}
              onToggleSelect={(id) => dispatch({ type: 'toggle', id })}
              onOpen={(doc) => router.push(docHref(doc.kind, doc.id))}
              onAction={(action, doc) => controller.run(action, doc)}
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

      {filters.activity && (
        <ActivityDrawer
          docId={filters.activity}
          number={activityDoc?.number ?? ''}
          onClose={() => setFilters({ activity: '' })}
        />
      )}

      <ShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      {controller.node}

      <ConfirmDialog
        open={confirmBulkDelete}
        tone="danger"
        busy={busy}
        title={tb('deleteTitle')}
        message={tb('deleteMessage', { count: selectedCount })}
        confirmLabel={tb('deleteConfirm')}
        cancelLabel={tb('keep')}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={() => void bulkDelete()}
      />
    </div>
  );
}

function ListSkeleton() {
  const t = useTranslations('sales-docs.list');
  return (
    <div role="status" aria-label={t('loading')} className="divide-y divide-border">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-14 animate-pulse items-center gap-4 px-4">
          <span className="size-4 rounded bg-muted" />
          <span className="h-3 w-24 rounded bg-muted" />
          <span className="h-3 w-56 rounded bg-muted" />
          <span className="hidden h-5 w-16 rounded-full bg-muted sm:block" />
          <span className="hidden h-3 w-32 rounded bg-muted md:block" />
          <span className="ms-auto size-6 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}
