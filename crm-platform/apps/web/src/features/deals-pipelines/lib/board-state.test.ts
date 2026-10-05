import { describe, expect, it } from 'vitest';
import type { Deal } from '../api/schemas';
import {
  boardReducer,
  initialBoard,
  insertAt,
  neighborsAt,
  settleDeal,
  stageDeals,
  type BoardState,
} from './board-state';

const stages = [
  { id: 'new', probability: 10, kind: 'open' as const },
  { id: 'prop', probability: 50, kind: 'open' as const },
  { id: 'won', probability: 100, kind: 'won' as const },
  { id: 'lost', probability: 0, kind: 'lost' as const },
];

function deal(id: string, stageId: string, valueMinor: number, over: Partial<Deal> = {}): Deal {
  return {
    id,
    title: id,
    pipelineId: 'p',
    stageId,
    status: 'open',
    valueMinor,
    currency: 'USD',
    boardValueMinor: valueMinor,
    contact: null,
    owner: null,
    source: 'manual',
    expectedCloseDate: null,
    lostReason: null,
    wonAt: null,
    lostAt: null,
    company: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rowVersion: 1,
    ...over,
  };
}

/** Three loaded columns: new [a, b], prop [c], won [], lost [], with matching totals. */
function loaded(): BoardState {
  let s = initialBoard(stages);
  s = boardReducer(s, {
    type: 'columnLoaded',
    stageId: 'new',
    deals: [deal('a', 'new', 10000), deal('b', 'new', 20000)],
    nextCursor: null,
    hasMore: false,
    append: false,
  });
  s = boardReducer(s, {
    type: 'columnLoaded',
    stageId: 'prop',
    deals: [deal('c', 'prop', 40000)],
    nextCursor: null,
    hasMore: false,
    append: false,
  });
  s = boardReducer(s, {
    type: 'summary',
    stages: [
      { stageId: 'new', count: 2, valueMinor: 30000, weightedMinor: 3000 },
      { stageId: 'prop', count: 1, valueMinor: 40000, weightedMinor: 20000 },
    ],
  });
  return s;
}

const ids = (s: BoardState, stage: string) => s.columns[stage]!.ids;

describe('board reducer', () => {
  it('starts with an empty, loading column per stage and zero totals', () => {
    const s = initialBoard(stages);
    expect(Object.keys(s.columns)).toEqual(['new', 'prop', 'won', 'lost']);
    expect(s.columns.new!.status).toBe('loading');
    expect(s.summary.prop).toEqual({ stageId: 'prop', count: 0, valueMinor: 0, weightedMinor: 0 });
  });

  it('fills a column, then appends the next page without duplicates', () => {
    let s = loaded();
    s = boardReducer(s, { type: 'columnStart', stageId: 'new', append: true });
    expect(s.columns.new!.status).toBe('loadingMore');
    s = boardReducer(s, {
      type: 'columnLoaded',
      stageId: 'new',
      deals: [deal('b', 'new', 20000), deal('d', 'new', 5000)],
      nextCursor: 'x',
      hasMore: true,
      append: true,
    });
    expect(ids(s, 'new')).toEqual(['a', 'b', 'd']);
    expect(s.columns.new).toMatchObject({ status: 'ready', hasMore: true, nextCursor: 'x' });
  });

  it('marks a failed column so it can be retried, and keeps its cards', () => {
    const s = boardReducer(loaded(), { type: 'columnFailed', stageId: 'new' });
    expect(s.columns.new!.status).toBe('error');
    expect(ids(s, 'new')).toEqual(['a', 'b']);
  });

  it('moves a card to another column and adjusts both totals', () => {
    const s = boardReducer(loaded(), { type: 'moved', dealId: 'a', toStageId: 'prop', index: 0 });
    expect(ids(s, 'new')).toEqual(['b']);
    expect(ids(s, 'prop')).toEqual(['a', 'c']);
    expect(s.deals.a!.stageId).toBe('prop');
    expect(s.summary.new).toEqual({
      stageId: 'new',
      count: 1,
      valueMinor: 20000,
      weightedMinor: 2000,
    });
    expect(s.summary.prop).toEqual({
      stageId: 'prop',
      count: 2,
      valueMinor: 50000,
      weightedMinor: 25000,
    });
  });

  it('drops at the requested position and clamps a position past the end', () => {
    const mid = boardReducer(loaded(), { type: 'moved', dealId: 'c', toStageId: 'new', index: 1 });
    expect(ids(mid, 'new')).toEqual(['a', 'c', 'b']);
    const end = boardReducer(loaded(), { type: 'moved', dealId: 'c', toStageId: 'new', index: 99 });
    expect(ids(end, 'new')).toEqual(['a', 'b', 'c']);
    const top = boardReducer(loaded(), { type: 'moved', dealId: 'c', toStageId: 'new', index: -5 });
    expect(ids(top, 'new')).toEqual(['c', 'a', 'b']);
  });

  it('reorders inside a column and leaves the totals alone', () => {
    const before = loaded();
    const s = boardReducer(before, { type: 'moved', dealId: 'a', toStageId: 'new', index: 1 });
    expect(ids(s, 'new')).toEqual(['b', 'a']);
    expect(s.summary).toEqual(before.summary);
  });

  it('derives won status and date when a card lands in a won column', () => {
    const s = boardReducer(loaded(), {
      type: 'moved',
      dealId: 'c',
      toStageId: 'won',
      index: 0,
      now: '2026-06-01T00:00:00.000Z',
    });
    expect(s.deals.c).toMatchObject({
      status: 'won',
      wonAt: '2026-06-01T00:00:00.000Z',
      lostAt: null,
    });
    expect(s.summary.won).toEqual({
      stageId: 'won',
      count: 1,
      valueMinor: 40000,
      weightedMinor: 40000,
    });
  });

  it('keeps the lost reason and clears it again on reopen', () => {
    let s = boardReducer(loaded(), {
      type: 'moved',
      dealId: 'a',
      toStageId: 'lost',
      index: 0,
      lostReason: 'No budget',
      now: '2026-06-01T00:00:00.000Z',
    });
    expect(s.deals.a).toMatchObject({ status: 'lost', lostReason: 'No budget', wonAt: null });
    expect(s.summary.lost!.weightedMinor).toBe(0);
    s = boardReducer(s, { type: 'moved', dealId: 'a', toStageId: 'new', index: 0 });
    expect(s.deals.a).toMatchObject({ status: 'open', lostReason: null, lostAt: null });
  });

  it('moves from won straight to lost, dropping the won date', () => {
    let s = boardReducer(loaded(), { type: 'moved', dealId: 'c', toStageId: 'won', index: 0 });
    s = boardReducer(s, {
      type: 'moved',
      dealId: 'c',
      toStageId: 'lost',
      index: 0,
      lostReason: 'x',
    });
    expect(s.deals.c).toMatchObject({ status: 'lost', wonAt: null });
    expect(s.deals.c!.lostAt).not.toBeNull();
  });

  it('ignores a move of an unknown card or to an unknown stage', () => {
    const s = loaded();
    expect(boardReducer(s, { type: 'moved', dealId: 'zzz', toStageId: 'prop', index: 0 })).toBe(s);
    expect(boardReducer(s, { type: 'moved', dealId: 'a', toStageId: 'nope', index: 0 })).toBe(s);
  });

  it('never lets a total go negative', () => {
    let s = loaded();
    s = boardReducer(s, {
      type: 'summary',
      stages: [{ stageId: 'new', count: 1, valueMinor: 100, weightedMinor: 10 }],
    });
    s = boardReducer(s, { type: 'moved', dealId: 'b', toStageId: 'prop', index: 0 });
    expect(s.summary.new!.valueMinor).toBeGreaterThanOrEqual(0);
    expect(s.summary.new!.count).toBe(0);
    expect(s.summary.new!.weightedMinor).toBe(0);
  });

  it('puts a new deal on top of its column and counts it', () => {
    const s = boardReducer(loaded(), { type: 'added', deal: deal('n', 'prop', 1000) });
    expect(ids(s, 'prop')).toEqual(['n', 'c']);
    expect(s.summary.prop).toMatchObject({ count: 2, valueMinor: 41000, weightedMinor: 20500 });
  });

  it('applies a confirmed edit: value change inside a stage adjusts the total', () => {
    const s = boardReducer(loaded(), {
      type: 'upsert',
      deal: deal('c', 'prop', 60000, { rowVersion: 2 }),
    });
    expect(s.deals.c!.valueMinor).toBe(60000);
    expect(s.summary.prop).toMatchObject({ count: 1, valueMinor: 60000, weightedMinor: 30000 });
  });

  it('applies a confirmed edit that changed the stage', () => {
    const s = boardReducer(loaded(), { type: 'upsert', deal: deal('c', 'new', 40000) });
    expect(ids(s, 'prop')).toEqual([]);
    expect(ids(s, 'new')).toEqual(['c', 'a', 'b']);
    expect(s.summary.prop!.count).toBe(0);
    expect(s.summary.new!.count).toBe(3);
  });

  it('removes a card and its share of the totals', () => {
    const s = boardReducer(loaded(), { type: 'removed', dealId: 'a' });
    expect(ids(s, 'new')).toEqual(['b']);
    expect(s.deals.a).toBeUndefined();
    expect(s.summary.new).toMatchObject({ count: 1, valueMinor: 20000 });
  });

  it('puts everything back from a snapshot when the server refuses a move', () => {
    const before = loaded();
    const moved = boardReducer(before, { type: 'moved', dealId: 'a', toStageId: 'prop', index: 0 });
    expect(boardReducer(moved, { type: 'restore', snapshot: before })).toBe(before);
  });

  it('replaces the summary from the server, zeroing stages it does not mention', () => {
    const s = boardReducer(loaded(), {
      type: 'summary',
      stages: [{ stageId: 'prop', count: 9, valueMinor: 9, weightedMinor: 4 }],
    });
    expect(s.summary.new).toEqual({ stageId: 'new', count: 0, valueMinor: 0, weightedMinor: 0 });
    expect(s.summary.prop!.count).toBe(9);
  });

  it("lists a stage's cards in column order", () => {
    expect(stageDeals(loaded(), 'new').map((d) => d.id)).toEqual(['a', 'b']);
    expect(stageDeals(loaded(), 'missing')).toEqual([]);
  });
});

describe('placement helpers', () => {
  it('inserts without duplicating and clamps', () => {
    expect(insertAt(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b']);
    expect(insertAt(['a', 'b'], 'a', 2)).toEqual(['b', 'a']);
    expect(insertAt(['a', 'b'], 'x', -3)).toEqual(['x', 'a', 'b']);
    expect(insertAt([], 'x', 4)).toEqual(['x']);
  });

  it('names the neighbours a drop would have, ignoring the card itself', () => {
    expect(neighborsAt(['a', 'b', 'c'], 'x', 0)).toEqual({ afterDealId: null, beforeDealId: 'a' });
    expect(neighborsAt(['a', 'b', 'c'], 'x', 2)).toEqual({ afterDealId: 'b', beforeDealId: 'c' });
    expect(neighborsAt(['a', 'b', 'c'], 'x', 3)).toEqual({ afterDealId: 'c', beforeDealId: null });
    expect(neighborsAt(['a', 'b', 'c'], 'b', 2)).toEqual({ afterDealId: 'c', beforeDealId: null });
    expect(neighborsAt([], 'x', 0)).toEqual({ afterDealId: null, beforeDealId: null });
  });

  it('settles a deal for the kind of stage it lands in', () => {
    const open = deal('a', 'new', 1, { status: 'won', wonAt: 'then', lostReason: 'old' });
    expect(settleDeal(open, stages[0], 'now')).toMatchObject({
      status: 'open',
      wonAt: null,
      lostReason: null,
    });
    expect(settleDeal(open, stages[2], 'now').wonAt).toBe('then');
  });
});
