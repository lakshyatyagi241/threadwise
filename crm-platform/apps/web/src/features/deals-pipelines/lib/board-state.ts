import type {
  BoardColumnData,
  BoardKpis,
  Deal,
  Stage,
  StageKind,
  StageSummary,
} from '../api/schemas';
import { weighted } from './money';

/**
 * The Kanban board's state: for every stage a list of deal ids (in the order the server returned them, or the order a
 * drop made), the deal records, and the per-stage totals. The reducer is pure so drag and drop, optimistic moves and
 * "load more" can be tested without a browser. Totals follow every local change; the screen still refetches the
 * summary after a write so the server stays the authority.
 */
export interface StageMeta {
  id: string;
  probability: number;
  kind: StageKind;
}

export type ColumnStatus = 'loading' | 'ready' | 'loadingMore' | 'error';

export interface ColumnState {
  ids: string[];
  nextCursor: string | null;
  hasMore: boolean;
  status: ColumnStatus;
}

export interface BoardState {
  stages: Record<string, StageMeta>;
  columns: Record<string, ColumnState>;
  deals: Record<string, Deal>;
  summary: Record<string, StageSummary>;
  /** The KPI strip; null until the board has loaded. */
  kpis: BoardKpis | null;
}

export const EMPTY_COLUMN: ColumnState = {
  ids: [],
  nextCursor: null,
  hasMore: false,
  status: 'loading',
};

const zeroSummary = (stageId: string): StageSummary => ({
  stageId,
  count: 0,
  valueMinor: 0,
  weightedMinor: 0,
});

export type BoardAction =
  | { type: 'reset'; stages: readonly Pick<Stage, 'id' | 'probability' | 'kind'>[] }
  | {
      type: 'loaded';
      stages: readonly Pick<Stage, 'id' | 'probability' | 'kind'>[];
      columns: readonly BoardColumnData[];
      kpis: BoardKpis;
    }
  | { type: 'columnStart'; stageId: string; append: boolean }
  | {
      type: 'columnLoaded';
      stageId: string;
      deals: readonly Deal[];
      nextCursor: string | null;
      hasMore: boolean;
      append: boolean;
    }
  | { type: 'columnFailed'; stageId: string }
  | { type: 'summary'; stages: readonly StageSummary[]; kpis?: BoardKpis }
  | {
      type: 'moved';
      dealId: string;
      toStageId: string;
      index: number;
      lostReason?: string;
      now?: string;
    }
  | { type: 'upsert'; deal: Deal }
  | { type: 'added'; deal: Deal }
  | { type: 'removed'; dealId: string }
  | { type: 'restore'; snapshot: BoardState };

export function initialBoard(
  stages: readonly Pick<Stage, 'id' | 'probability' | 'kind'>[],
): BoardState {
  return boardReducer(
    { stages: {}, columns: {}, deals: {}, summary: {}, kpis: null },
    { type: 'reset', stages },
  );
}

/** Insert `id` at `index` (clamped) into a copy of `ids` that does not contain it yet. */
export function insertAt(ids: readonly string[], id: string, index: number): string[] {
  const without = ids.filter((x) => x !== id);
  const at = Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, at), id, ...without.slice(at)];
}

/** The cards that would sit directly above and below a card dropped at `index` of the column's other cards. */
export function neighborsAt(
  ids: readonly string[],
  dealId: string,
  index: number,
): { afterDealId: string | null; beforeDealId: string | null } {
  const others = ids.filter((x) => x !== dealId);
  const at = Math.max(0, Math.min(index, others.length));
  return { afterDealId: others[at - 1] ?? null, beforeDealId: others[at] ?? null };
}

function bump(
  summary: Record<string, StageSummary>,
  stages: Record<string, StageMeta>,
  stageId: string,
  dCount: number,
  dValue: number,
): Record<string, StageSummary> {
  const cur = summary[stageId] ?? zeroSummary(stageId);
  const probability = stages[stageId]?.probability ?? 0;
  const valueMinor = cur.valueMinor + dValue;
  const count = Math.max(0, cur.count + dCount);
  return {
    ...summary,
    [stageId]: {
      stageId,
      count,
      valueMinor: count === 0 ? 0 : Math.max(0, valueMinor),
      weightedMinor: count === 0 ? 0 : weighted(Math.max(0, valueMinor), probability),
    },
  };
}

/** What a deal looks like after landing in a stage of this kind (the server derives the same). */
export function settleDeal(
  deal: Deal,
  stage: StageMeta | undefined,
  now: string,
  lostReason?: string,
): Deal {
  const kind = stage?.kind ?? 'open';
  return {
    ...deal,
    stageId: stage?.id ?? deal.stageId,
    status: kind,
    wonAt: kind === 'won' ? (deal.wonAt ?? now) : null,
    lostAt: kind === 'lost' ? (deal.lostAt ?? now) : null,
    lostReason:
      kind === 'lost' ? (lostReason ?? deal.lostReason) : kind === 'open' ? null : deal.lostReason,
  };
}

function column(state: BoardState, stageId: string): ColumnState {
  return state.columns[stageId] ?? { ...EMPTY_COLUMN, status: 'ready' };
}

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'reset': {
      const stages: Record<string, StageMeta> = {};
      const columns: Record<string, ColumnState> = {};
      const summary: Record<string, StageSummary> = {};
      for (const s of action.stages) {
        stages[s.id] = { id: s.id, probability: s.probability, kind: s.kind };
        columns[s.id] = { ...EMPTY_COLUMN };
        summary[s.id] = zeroSummary(s.id);
      }
      return { stages, columns, deals: {}, summary, kpis: null };
    }

    case 'loaded': {
      const next = boardReducer(state, { type: 'reset', stages: action.stages });
      const deals: Record<string, Deal> = {};
      for (const col of action.columns) {
        if (!(col.stageId in next.columns)) continue;
        for (const d of col.deals) deals[d.id] = d;
        next.columns[col.stageId] = {
          ids: col.deals.map((d) => d.id),
          nextCursor: col.nextCursor,
          hasMore: col.hasMore,
          status: 'ready',
        };
        next.summary[col.stageId] = col.summary;
      }
      return { ...next, deals, kpis: action.kpis };
    }

    case 'columnStart': {
      const col = column(state, action.stageId);
      return {
        ...state,
        columns: {
          ...state.columns,
          [action.stageId]: { ...col, status: action.append ? 'loadingMore' : 'loading' },
        },
      };
    }

    case 'columnLoaded': {
      const col = column(state, action.stageId);
      const deals = { ...state.deals };
      for (const d of action.deals) deals[d.id] = d;
      const incoming = action.deals.map((d) => d.id);
      const ids = action.append
        ? [...col.ids, ...incoming.filter((id) => !col.ids.includes(id))]
        : incoming;
      return {
        ...state,
        deals,
        columns: {
          ...state.columns,
          [action.stageId]: {
            ids,
            nextCursor: action.nextCursor,
            hasMore: action.hasMore,
            status: 'ready',
          },
        },
      };
    }

    case 'columnFailed': {
      const col = column(state, action.stageId);
      return {
        ...state,
        columns: { ...state.columns, [action.stageId]: { ...col, status: 'error' } },
      };
    }

    case 'summary': {
      const summary: Record<string, StageSummary> = {};
      for (const id of Object.keys(state.stages)) summary[id] = zeroSummary(id);
      for (const s of action.stages) if (s.stageId in state.stages) summary[s.stageId] = s;
      return { ...state, summary, kpis: action.kpis ?? state.kpis };
    }

    case 'moved': {
      const deal = state.deals[action.dealId];
      const to = state.stages[action.toStageId];
      if (!deal || !to) return state;
      const fromId = deal.stageId;
      const now = action.now ?? new Date().toISOString();
      const next = settleDeal(deal, to, now, action.lostReason);
      const columns = { ...state.columns };
      columns[to.id] = {
        ...column(state, to.id),
        ids: insertAt(column(state, to.id).ids, deal.id, action.index),
      };
      let summary = state.summary;
      if (fromId !== to.id) {
        const src = column(state, fromId);
        columns[fromId] = { ...src, ids: src.ids.filter((x) => x !== deal.id) };
        summary = bump(summary, state.stages, fromId, -1, -deal.boardValueMinor);
        summary = bump(summary, state.stages, to.id, 1, deal.boardValueMinor);
      }
      return { ...state, columns, summary, deals: { ...state.deals, [deal.id]: next } };
    }

    case 'added': {
      const deal = action.deal;
      if (state.deals[deal.id]) return boardReducer(state, { type: 'upsert', deal });
      const col = column(state, deal.stageId);
      return {
        ...state,
        deals: { ...state.deals, [deal.id]: deal },
        columns: {
          ...state.columns,
          [deal.stageId]: { ...col, ids: insertAt(col.ids, deal.id, 0) },
        },
        summary: bump(state.summary, state.stages, deal.stageId, 1, deal.boardValueMinor),
      };
    }

    case 'upsert': {
      const deal = action.deal;
      const old = state.deals[deal.id];
      if (!old) return boardReducer(state, { type: 'added', deal });
      const columns = { ...state.columns };
      let summary = state.summary;
      if (old.stageId !== deal.stageId) {
        const src = column(state, old.stageId);
        columns[old.stageId] = { ...src, ids: src.ids.filter((x) => x !== deal.id) };
        const dst = column(state, deal.stageId);
        columns[deal.stageId] = { ...dst, ids: insertAt(dst.ids, deal.id, 0) };
        summary = bump(summary, state.stages, old.stageId, -1, -old.boardValueMinor);
        summary = bump(summary, state.stages, deal.stageId, 1, deal.boardValueMinor);
      } else if (old.boardValueMinor !== deal.boardValueMinor) {
        summary = bump(
          summary,
          state.stages,
          deal.stageId,
          0,
          deal.boardValueMinor - old.boardValueMinor,
        );
      }
      return { ...state, columns, summary, deals: { ...state.deals, [deal.id]: deal } };
    }

    case 'removed': {
      const deal = state.deals[action.dealId];
      if (!deal) return state;
      const deals = { ...state.deals };
      delete deals[deal.id];
      const col = column(state, deal.stageId);
      return {
        ...state,
        deals,
        columns: {
          ...state.columns,
          [deal.stageId]: { ...col, ids: col.ids.filter((x) => x !== deal.id) },
        },
        summary: bump(state.summary, state.stages, deal.stageId, -1, -deal.boardValueMinor),
      };
    }

    case 'restore':
      return action.snapshot;
  }
}

export const stageDeals = (state: BoardState, stageId: string): Deal[] =>
  (state.columns[stageId]?.ids ?? []).flatMap((id) => {
    const d = state.deals[id];
    return d ? [d] : [];
  });
