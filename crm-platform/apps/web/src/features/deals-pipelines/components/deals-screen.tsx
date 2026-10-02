'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, ConfirmDialog, EmptyState, Spinner, useToast } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { invalidateDeals, KEYS, useMembers, usePipelines } from '../api/hooks';
import { dealsApi } from '../api/service';
import type { Deal } from '../api/schemas';
import { useBoard } from '../api/use-board';
import { isUnavailable } from '../lib/errors';
import type { LostReasonPayload } from '../lib/lost-reasons';
import { filtersToSearch, hasActiveFilter, parseFilters, type DealFilters } from '../lib/filters';
import { Board } from './board';
import { DealDrawer } from './deal-drawer';
import { DealFormModal } from './deal-form-modal';
import { DealsList } from './deals-list';
import { DealsToolbar } from './deals-toolbar';
import { DealIcon, PlusIcon } from './icons';
import { KpiStrip } from './kpi-strip';
import { LostDialog } from './lost-dialog';
import { ErrorLine, useDealsCan, useErrorText } from './parts';

interface PendingLost {
  deal: Deal;
  stageId: string;
  index: number;
}


/** `/deals`: the Kanban board (or the table) of one pipeline, with filters, quick add and the deal drawer. */
export function DealsScreen() {
  const t = useTranslations('deals-pipelines.board');
  const tReports = useTranslations('deals-pipelines.reports');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
  const can = useDealsCan();
  const errorText = useErrorText();
  const pipelines = usePipelines();
  const members = useMembers();

  const filters = useMemo(() => parseFilters(search), [search]);
  const setFilters = useCallback(
    (patch: Partial<DealFilters>) =>
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

  const all = pipelines.data ?? [];
  const pipeline =
    all.find((x) => x.id === filters.pipeline) ?? all.find((x) => x.isDefault) ?? all[0];

  const board = useBoard(filters.view === 'board' ? pipeline : undefined, filters);

  const [creating, setCreating] = useState<{ stageId?: string } | null>(null);
  const [pendingLost, setPendingLost] = useState<PendingLost | null>(null);
  const [lostBusy, setLostBusy] = useState(false);
  const [toDelete, setToDelete] = useState<Deal | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refreshAfterWrite = useCallback(
    (dealId?: string) => {
      void invalidateDeals(qc);
      if (dealId) void qc.invalidateQueries({ queryKey: KEYS.deal(dealId) });
    },
    [qc],
  );

  async function performMove(
    deal: Deal,
    stageId: string,
    index: number,
    reason?: LostReasonPayload,
  ) {
    const target = pipeline?.stages.find((s) => s.id === stageId);
    if (!target) return;
    try {
      if (filters.view === 'board' && board.state.deals[deal.id]) {
        await board.move(deal.id, stageId, index, reason);
      } else {
        const next = await dealsApi.moveDeal(deal.id, { stageId, ...reason }, pipeline?.currency);
        board.upsertDeal(next);
      }
      if (stageId !== deal.stageId) {
        toast(
          t(target.kind === 'won' ? 'movedWon' : target.kind === 'lost' ? 'movedLost' : 'moved', {
            stage: target.name,
          }),
          target.kind === 'lost' ? 'info' : 'success',
        );
      }
      refreshAfterWrite(deal.id);
    } catch (e) {
      toast(`${t('moveFailed')} ${errorText(e)}`, 'danger');
      refreshAfterWrite(deal.id);
    }
  }

  function requestMove(deal: Deal, stageId: string, index: number) {
    const target = pipeline?.stages.find((s) => s.id === stageId);
    if (!target) return;
    if (target.kind === 'lost' && deal.status !== 'lost') {
      setPendingLost({ deal, stageId, index });
      return;
    }
    void performMove(deal, stageId, index);
  }

  async function quickAdd(stageId: string, title: string): Promise<boolean> {
    if (!pipeline) return false;
    try {
      const deal = await dealsApi.createDeal(
        { title, pipelineId: pipeline.id, stageId, ownerId: session.user.id },
        pipeline.currency,
      );
      board.addDeal(deal);
      refreshAfterWrite();
      toast(t('created'), 'success');
      return true;
    } catch (e) {
      toast(`${t('createFailed')} ${errorText(e)}`, 'danger');
      return false;
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await dealsApi.deleteDeal(toDelete.id);
      board.removeDeal(toDelete.id);
      refreshAfterWrite();
      toast(t('deleted'), 'success');
      setToDelete(null);
      if (filters.deal === toDelete.id) setFilters({ deal: '' });
    } catch (e) {
      toast(`${t('deleteFailed')} ${errorText(e)}`, 'danger');
    } finally {
      setDeleting(false);
    }
  }

  const filtered = hasActiveFilter(filters) || q.trim() !== '';
  const drawerSeed = filters.deal ? board.state.deals[filters.deal] : undefined;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-background p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground"
          >
            <DealIcon className="size-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>
        {can.create && pipeline && (
          <Button variant="brand" className="h-11 px-5" onClick={() => setCreating({})}>
            <PlusIcon /> {t('newDeal')}
          </Button>
        )}
      </header>

      {pipelines.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner /> {t('loading')}
        </div>
      )}

      {pipelines.isError && (
        <div className="space-y-3">
          <ErrorLine error={pipelines.error} onRetry={() => void pipelines.refetch()} />
          {isUnavailable(pipelines.error) && process.env.NODE_ENV === 'development' && (
            <Button
              variant="secondary"
              onClick={() => {
                try {
                  window.localStorage.setItem('deals:mock', '1');
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
      )}

      {pipelines.isSuccess && !pipeline && (
        <EmptyState
          title={t('noPipelinesTitle')}
          message={t('noPipelinesMessage')}
          actions={
            can.editPipelines ? (
              <Link
                href="/deals/settings"
                className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:opacity-90"
              >
                {t('createPipeline')}
              </Link>
            ) : undefined
          }
        />
      )}

      {pipeline && (
        <>
          <DealsToolbar
            filters={filters}
            q={q}
            onQ={setQ}
            onChange={setFilters}
            pipelines={all}
            pipelineId={pipeline.id}
            members={members.data ?? []}
            canSettings={can.editPipelines}
            canReports={can.report}
          />

          {filters.view === 'board' && (
            <>
              <KpiStrip kpis={board.kpis} currency={pipeline.currency} />
              {board.unconverted.length > 0 && (
                <Alert tone="warning">{tReports('unconverted', { currencies: board.unconverted.join(', ') })}</Alert>
              )}
              {board.loadError != null && <ErrorLine error={board.loadError} onRetry={board.reload} />}
              <Board
                pipeline={pipeline}
                state={board.state}
                canWrite={can.update}
                canCreate={can.create}
                canDelete={can.remove}
                filtered={filtered}
                onOpen={(id) => setFilters({ deal: id })}
                onMoveDeal={requestMove}
                onDelete={setToDelete}
                onLoadMore={(id) => void board.loadMore(id)}
                onRetry={(id) => void board.loadMore(id)}
                onQuickAdd={quickAdd}
              />
            </>
          )}
          {filters.view === 'list' && (
            <DealsList pipeline={pipeline} filters={filters} onOpen={(id) => setFilters({ deal: id })} />
          )}
        </>
      )}

      {creating && pipeline && (
        <DealFormModal
          pipeline={pipeline}
          stageId={creating.stageId}
          onClose={() => setCreating(null)}
          onCreated={(deal) => {
            board.addDeal(deal);
            refreshAfterWrite();
            setCreating(null);
            toast(t('created'), 'success');
          }}
        />
      )}

      {filters.deal && (
        <DealDrawer
          dealId={filters.deal}
          seed={drawerSeed}
          pipelines={all}
          currency={pipeline?.currency}
          canWrite={can.update}
          canDelete={can.remove}
          onClose={() => setFilters({ deal: '' })}
          onChanged={(deal) => {
            board.upsertDeal(deal);
            refreshAfterWrite();
          }}
          onDeleted={(id) => {
            board.removeDeal(id);
            refreshAfterWrite();
            setFilters({ deal: '' });
          }}
          onMoveStage={(deal, stageId) => requestMove(deal, stageId, 0)}
        />
      )}

      {pendingLost && (
        <LostDialog
          dealTitle={pendingLost.deal.title}
          busy={lostBusy}
          onClose={() => setPendingLost(null)}
          onConfirm={(reason) => {
            const p = pendingLost;
            setLostBusy(true);
            void performMove(p.deal, p.stageId, p.index, reason).finally(() => {
              setLostBusy(false);
              setPendingLost(null);
            });
          }}
        />
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={t('deleteTitle')}
        message={t('deleteMessage', { title: toDelete?.title ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setToDelete(null)}
      />
    </div>
  );
}
