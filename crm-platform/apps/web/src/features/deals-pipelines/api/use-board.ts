'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { dealsApi } from './service';
import type { Deal, Pipeline } from './schemas';
import { boardReducer, initialBoard, neighborsAt, type BoardState } from '../lib/board-state';
import { filterQuery, matchesFilters, type DealFilters } from '../lib/filters';

/**
 * Loads a pipeline's board in one call (every column's first cards, the totals and the KPIs), then "load more" per
 * stage. Moves are optimistic: the card jumps at once, the server confirms, and a refusal puts everything back. After a
 * write the totals are refreshed with a cheap board call that asks for one card per column, so cards the person already
 * loaded stay where they are.
 */
export function useBoard(pipeline: Pipeline | undefined, filters: DealFilters) {
  const [state, dispatch] = useReducer(boardReducer, undefined, () => initialBoard([]));
  const [nonce, setNonce] = useState(0);
  // Currencies with no exchange rate: their deals are left out of the converted totals, and the screen says so. The first load
  // brings the list; a refresh after a write replaces it (for the same board key only).
  const [refreshed, setRefreshed] = useState<{ key: string; list: readonly string[] } | null>(null);
  const latest = useRef<BoardState>(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  const pipelineId = pipeline?.id ?? '';
  const currency = pipeline?.currency ?? 'USD';
  const stageSig = (pipeline?.stages ?? [])
    .map((s) => `${s.id}:${s.probability}:${s.kind}`)
    .join('|');
  const query = useMemo(
    () => filterQuery(filters),
    // the filters that reach the server
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.q, filters.owner, filters.team, filters.source],
  );
  const key = useMemo(
    () => ['deals', 'board', pipelineId, currency, stageSig, query, nonce] as const,
    [pipelineId, currency, stageSig, query, nonce],
  );

  const board = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => dealsApi.board(pipelineId, currency, query, signal),
    enabled: pipelineId !== '',
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  // Declared in this order on purpose: a new key resets the board first, then the (maybe cached) data lands on it.
  useEffect(() => {
    if (pipeline) dispatch({ type: 'reset', stages: pipeline.stages });
    // The signature stands for the stages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const boardData = board.data;
  useEffect(() => {
    if (boardData && pipeline) {
      dispatch({
        type: 'loaded',
        stages: pipeline.stages,
        columns: boardData.columns,
        kpis: boardData.kpis,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardData, key]);

  const refreshSummary = useCallback(async () => {
    if (!pipelineId) return;
    try {
      const b = await dealsApi.board(pipelineId, currency, query, undefined, 1);
      dispatch({ type: 'summary', stages: b.columns.map((c) => c.summary), kpis: b.kpis });
      setRefreshed({ key: JSON.stringify(key), list: b.unconverted });
    } catch {
      /* the local totals stay as they are until the next change */
    }
  }, [pipelineId, currency, query, key]);

  const loadMore = useCallback(
    async (stageId: string) => {
      dispatch({ type: 'columnStart', stageId, append: true });
      try {
        const cursor = latest.current.columns[stageId]?.nextCursor ?? undefined;
        const page = await dealsApi.stagePage(stageId, currency, query, cursor);
        dispatch({
          type: 'columnLoaded',
          stageId,
          deals: page.deals,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          append: true,
        });
      } catch {
        dispatch({ type: 'columnFailed', stageId });
      }
    },
    [currency, query],
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  /** Optimistic move; resolves with the confirmed deal, rejects (after undoing the move) when the server refuses. */
  const move = useCallback(
    async (
      dealId: string,
      toStageId: string,
      index: number,
      reason?: { lostReason?: string; lostReasonId?: string },
    ): Promise<Deal> => {
      const before = latest.current;
      const toIds = before.columns[toStageId]?.ids ?? [];
      const { afterDealId, beforeDealId } = neighborsAt(toIds, dealId, index);
      dispatch({ type: 'moved', dealId, toStageId, index, lostReason: reason?.lostReason });
      try {
        const deal = await dealsApi.moveDeal(
          dealId,
          { stageId: toStageId, afterDealId, beforeDealId, ...reason },
          currency,
        );
        dispatch({ type: 'upsert', deal });
        void refreshSummary();
        return deal;
      } catch (e) {
        dispatch({ type: 'restore', snapshot: before });
        void refreshSummary();
        throw e;
      }
    },
    [currency, refreshSummary],
  );

  const addDeal = useCallback(
    (deal: Deal) => {
      if (deal.pipelineId !== pipelineId) return;
      if (matchesFilters(deal, filters)) dispatch({ type: 'added', deal });
      void refreshSummary();
    },
    [pipelineId, filters, refreshSummary],
  );

  const upsertDeal = useCallback(
    (deal: Deal) => {
      if (deal.pipelineId !== pipelineId) return;
      dispatch({ type: 'upsert', deal });
      void refreshSummary();
    },
    [pipelineId, refreshSummary],
  );

  const removeDeal = useCallback(
    (dealId: string) => {
      dispatch({ type: 'removed', dealId });
      void refreshSummary();
    },
    [refreshSummary],
  );

  return {
    state,
    kpis: state.kpis,
    unconverted:
      refreshed !== null && refreshed.key === JSON.stringify(key)
        ? refreshed.list
        : (boardData?.unconverted ?? []),
    loadError: board.isError ? board.error : null,
    loading: board.isPending && pipelineId !== '',
    loadMore,
    reload,
    move,
    addDeal,
    upsertDeal,
    removeDeal,
  };
}
