'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog, EmptyState, Input, Spinner, cn, useToast } from '@crm/ui';
import type { BroadcastListItem } from '@crm/contracts';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  deleteBroadcast,
  exportBroadcast,
  KEYS,
  useBroadcastsPage,
  useBroadcastSummary,
  useRecentBroadcasts,
} from '../api/broadcasts';
import { parseState, RANGES, stateToSearch, type ListState } from '../lib/list-model';
import { downloadBlob } from '../lib/download';
import { BroadcastsPagination } from '@/features/broadcasts/components/broadcasts-pagination';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import { BroadcastsTable } from './broadcasts-table';
import { RefreshIcon, SearchIcon } from '@/features/broadcasts/components/icons';
import { KpiStrip } from './kpi-strip';
import { ListRail } from './list-rail';
import { NewCampaignButton } from '../../components/new-campaign-button';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/**
 * `/campaigns/history/legacy` (was `/broadcasts`, TW-BCAST-001, 002): the status views, the six tiles, and the broadcast table with its range, search and pages.
 * The filters and the page live in the address; the counters follow the worker every 15 seconds while the tab is visible.
 */
export function EarlierScreen() {
  const t = useTranslations('broadcasts.list');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
  const canCreate = useCan('bcast.broadcasts.create');
  const canDelete = useCan('bcast.broadcasts.delete');
  const canExport = useCan('bcast.broadcasts.export');

  const state = useMemo(() => parseState(new URLSearchParams(search.toString())), [search]);
  /** Any filter change starts again from page 1; only `page` itself keeps the position. */
  /** Every address of this view keeps `source=earlier`, which is what picks it on the Campaigns page. */
  const addressOf = (s: ListState) => {
    const qs = stateToSearch(s);
    return `${pathname}${qs ? `${qs}&` : '?'}source=earlier`;
  };
  const go = (patch: Partial<ListState>) =>
    router.replace(addressOf({ ...state, page: 1, ...patch }), { scroll: false });

  // Search applies 220 ms after typing stops (Reference's rhythm), without a reload.
  const [q, setQ] = useState(state.q);
  const [seenQ, setSeenQ] = useState(state.q);
  if (state.q !== seenQ) {
    // The address changed under us (Reset filters, back button): follow it.
    setSeenQ(state.q);
    setQ(state.q);
  }
  useEffect(() => {
    if (q.trim() === state.q) return;
    const id = window.setTimeout(() => go({ q: q.trim() }), 220);
    return () => window.clearTimeout(id);
    // `go` closes over the current state; the timer restarts on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const list = useBroadcastsPage(state);
  const summary = useBroadcastSummary();
  const unofficial = useUnofficialWhatsapp();
  const [pendingDelete, setPendingDelete] = useState<BroadcastListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const recent = useRecentBroadcasts();

  const refresh = () => void qc.invalidateQueries({ queryKey: KEYS.all });

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteBroadcast(pendingDelete.id);
      toast(t('deleted'), 'success');
      setPendingDelete(null);
      refresh();
    } catch (e) {
      toast(message(e, t('loadError')), 'danger');
    } finally {
      setDeleting(false);
    }
  };

  const exportRows = async (b: BroadcastListItem) => {
    try {
      const { blob, filename } = await exportBroadcast(b.id);
      downloadBlob(filename, blob);
    } catch (e) {
      toast(message(e, t('exportFailed')), 'danger');
    }
  };

  const range = (r: (typeof RANGES)[number]) => (
    <button
      key={r}
      type="button"
      aria-pressed={state.range === r}
      onClick={() => go({ range: r })}
      className={cn(
        'rounded-full px-3 py-1.5 text-xs font-medium',
        state.range === r
          ? 'bg-brand text-brand-foreground'
          : 'border border-border hover:bg-muted',
      )}
    >
      {t(`range.${r}`)}
    </button>
  );

  return (
    <div className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <ListRail
          status={state.status}
          counts={summary.data?.statusCounts}
          recent={recent.data?.data ?? []}
          canCreate={canCreate}
          onStatus={(status) => go({ status })}
        />

        <section className="min-w-0">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {t('workspace')} · {session.org.name}
              </div>
              <h1 className="text-3xl font-normal leading-none tracking-tight lg:text-[44px]">
                {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" className="rounded-full" onClick={refresh}>
                <RefreshIcon className="size-3.5" />
                {t('refresh')}
              </Button>
              {canCreate && <NewCampaignButton />}
            </div>
          </div>

          <KpiStrip stats={summary.data?.stats} />


          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('listKicker')}
                </div>
                <h2 className="mt-0.5 text-2xl leading-tight">{t('listTitle')}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {RANGES.map(range)}
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t('search')}
                    aria-label={t('search')}
                    className="h-9 w-full rounded-full ps-9 text-xs sm:w-72"
                  />
                </div>
              </div>
            </div>

            <div
              className={cn(
                'transition-opacity',
                list.isFetching && !list.isPending && 'opacity-60',
              )}
            >
              {list.isPending ? (
                <div className="flex justify-center p-10">
                  <Spinner label={t('loading')} />
                </div>
              ) : list.isError ? (
                <div className="p-4">
                  <EmptyState
                    title={t('loadError')}
                    message={message(list.error, '')}
                    actions={
                      <Button variant="secondary" onClick={() => void list.refetch()}>
                        {t('retry')}
                      </Button>
                    }
                  />
                </div>
              ) : (
                <BroadcastsTable
                  rows={list.items}
                  empty={
                    <div className="m-4 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
                      <h3 className="text-2xl">{t('emptyTitle')}</h3>
                      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                        {t('emptyBody')}
                      </p>
                      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                        <Button
                          variant="secondary"
                          className="rounded-full"
                          onClick={() => router.replace(addressOf(parseState(new URLSearchParams())))}
                        >
                          {t('resetFilters')}
                        </Button>
                        {canCreate && (
                          <Link
                            href="/campaigns/create"
                            className="inline-flex h-10 items-center rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground hover:opacity-90"
                          >
                            {t('createBroadcast')}
                          </Link>
                        )}
                      </div>
                    </div>
                  }
                  canExport={canExport}
                  canDeleteRows={canDelete}
                  onExport={(b) => void exportRows(b)}
                  onDelete={setPendingDelete}
                  unofficial={unofficial}
                />
              )}
            </div>
            <BroadcastsPagination
              page={list.page}
              total={list.total}
              shown={list.items.length}
              onPage={(page) => go({ page })}
            />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {(['1', '2', '3'] as const).map((n) => (
              <div key={n} className="rounded-2xl border border-border bg-background p-5 shadow-sm">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t(`help.k${n}`)}
                </div>
                <div className="mb-1 text-xl">{t(`help.t${n}`)}</div>
                <p className="text-sm leading-relaxed text-muted-foreground">{t(`help.b${n}`)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('deleteTitle')}
        message={t('deleteBody', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
