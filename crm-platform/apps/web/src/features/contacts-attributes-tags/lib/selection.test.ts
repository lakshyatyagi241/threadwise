import { describe, expect, it } from 'vitest';
import {
  bulkTarget,
  EMPTY_SELECTION,
  headerState,
  selectedCount,
  selectionReducer,
  type Selection,
} from './selection';

const filter = {
  q: 'acme',
  lifecycleStage: '',
  group: '',
  tag: '',
  consent: '' as const,
  imported: false,
};

describe('selectionReducer (TW-CON-019)', () => {
  it('toggles single rows', () => {
    let s = selectionReducer(EMPTY_SELECTION, { type: 'toggle', id: 'a' });
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect([...s.ids]).toEqual(['a', 'b']);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect([...s.ids]).toEqual(['b']);
  });

  it('selects and clears every loaded row with the header box', () => {
    const all = selectionReducer(EMPTY_SELECTION, {
      type: 'setMany',
      ids: ['a', 'b', 'c'],
      checked: true,
    });
    expect(all.ids.size).toBe(3);
    expect(
      selectionReducer(all, { type: 'setMany', ids: ['a', 'b', 'c'], checked: false }).ids.size,
    ).toBe(0);
  });

  it('extends to "all matching" and drops back to ids as soon as a row is unticked', () => {
    let s: Selection = selectionReducer(EMPTY_SELECTION, {
      type: 'setMany',
      ids: ['a', 'b'],
      checked: true,
    });
    s = selectionReducer(s, { type: 'selectAllMatching' });
    expect(s.allMatching).toBe(true);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.allMatching).toBe(false);
    expect([...s.ids]).toEqual(['b']);
  });

  it('forgets rows that left the list, and cancels the extension when that happens', () => {
    let s: Selection = selectionReducer(EMPTY_SELECTION, {
      type: 'setMany',
      ids: ['a', 'b'],
      checked: true,
    });
    s = selectionReducer(s, { type: 'selectAllMatching' });
    const kept = selectionReducer(s, { type: 'retain', ids: ['a', 'b', 'c'] });
    expect(kept).toBe(s);
    const dropped = selectionReducer(s, { type: 'retain', ids: ['b'] });
    expect([...dropped.ids]).toEqual(['b']);
    expect(dropped.allMatching).toBe(false);
  });

  it('clears', () => {
    const s = selectionReducer(EMPTY_SELECTION, { type: 'toggle', id: 'a' });
    expect(selectionReducer(s, { type: 'clear' })).toBe(EMPTY_SELECTION);
  });
});

describe('selection helpers', () => {
  it('reports the header checkbox state over the loaded rows', () => {
    expect(headerState([], new Set())).toBe('none');
    expect(headerState(['a', 'b'], new Set())).toBe('none');
    expect(headerState(['a', 'b'], new Set(['a']))).toBe('some');
    expect(headerState(['a', 'b'], new Set(['a', 'b', 'z']))).toBe('all');
  });

  it('turns a selection into a bulk target: ids, or the filter for "all matching"', () => {
    const ids = selectionReducer(EMPTY_SELECTION, {
      type: 'setMany',
      ids: ['a', 'b'],
      checked: true,
    });
    expect(bulkTarget(ids, filter)).toEqual({ kind: 'ids', ids: ['a', 'b'] });
    expect(bulkTarget({ ...ids, allMatching: true }, filter)).toEqual({ kind: 'filter', filter });
  });

  it('has no count for "all matching" because the API returns no totals', () => {
    expect(selectedCount({ ids: new Set(['a']), allMatching: false })).toBe(1);
    expect(selectedCount({ ids: new Set(['a']), allMatching: true })).toBeNull();
  });
});
