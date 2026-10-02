import { describe, expect, it } from 'vitest';
import { chunk, EMPTY_SELECTION, headerState, selectionReducer } from './selection';

describe('selectionReducer', () => {
  it('toggles one id on and off', () => {
    const on = selectionReducer(EMPTY_SELECTION, { type: 'toggle', id: 'a' });
    expect([...on.ids]).toEqual(['a']);
    expect(selectionReducer(on, { type: 'toggle', id: 'a' }).ids.size).toBe(0);
  });
  it('sets and unsets many at once', () => {
    const all = selectionReducer(EMPTY_SELECTION, { type: 'setMany', ids: ['a', 'b', 'c'], checked: true });
    expect(all.ids.size).toBe(3);
    const some = selectionReducer(all, { type: 'setMany', ids: ['a', 'b'], checked: false });
    expect([...some.ids]).toEqual(['c']);
  });
  it('clears, and returns the same object when already empty', () => {
    expect(selectionReducer(EMPTY_SELECTION, { type: 'clear' })).toBe(EMPTY_SELECTION);
    const s = selectionReducer(EMPTY_SELECTION, { type: 'toggle', id: 'a' });
    expect(selectionReducer(s, { type: 'clear' }).ids.size).toBe(0);
  });
  it('forgets rows that left the list and keeps the state when nothing changed', () => {
    const s = selectionReducer(EMPTY_SELECTION, { type: 'setMany', ids: ['a', 'b'], checked: true });
    expect([...selectionReducer(s, { type: 'retain', ids: ['b', 'c'] }).ids]).toEqual(['b']);
    expect(selectionReducer(s, { type: 'retain', ids: ['a', 'b', 'c'] })).toBe(s);
  });
});

describe('headerState', () => {
  const sel = (...ids: string[]) => new Set(ids);
  it('is none, some or all over the loaded rows', () => {
    expect(headerState([], sel())).toBe('none');
    expect(headerState(['a', 'b'], sel())).toBe('none');
    expect(headerState(['a', 'b'], sel('a'))).toBe('some');
    expect(headerState(['a', 'b'], sel('a', 'b', 'z'))).toBe('all');
  });
});

describe('chunk', () => {
  it('splits a long selection at the API limit of 200', () => {
    const ids = Array.from({ length: 450 }, (_, i) => String(i));
    expect(chunk(ids).map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunk([])).toEqual([]);
  });
});
