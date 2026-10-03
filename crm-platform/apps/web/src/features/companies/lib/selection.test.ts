import { describe, expect, it } from 'vitest';
import { chunk, headerState, retain, setAll, toggle } from './selection';

describe('selection', () => {
  it('toggles a row without touching the set it was given', () => {
    const base = new Set(['a']);
    const added = toggle(base, 'b');
    expect([...added].sort()).toEqual(['a', 'b']);
    expect([...base]).toEqual(['a']);
    expect([...toggle(added, 'a')]).toEqual(['b']);
  });

  it('the header checkbox is none, some or all of the loaded rows', () => {
    const ids = ['a', 'b', 'c'];
    expect(headerState(ids, new Set())).toBe('none');
    expect(headerState(ids, new Set(['a']))).toBe('some');
    expect(headerState(ids, new Set(ids))).toBe('all');
    expect(headerState([], new Set(['x']))).toBe('none');
    // a tick on a row that is not loaded does not count
    expect(headerState(ids, new Set(['x']))).toBe('none');
  });

  it('select all and clear all act on the loaded rows and keep ticks elsewhere', () => {
    const ids = ['a', 'b'];
    expect([...setAll(ids, new Set(['z']), true)].sort()).toEqual(['a', 'b', 'z']);
    expect([...setAll(ids, new Set(['a', 'b', 'z']), false)]).toEqual(['z']);
  });

  it('drops ticks of rows that are gone', () => {
    expect([...retain(new Set(['a', 'gone']), ['a', 'b'])]).toEqual(['a']);
  });

  it('chunks ids for the bulk endpoint (100 at most)', () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    expect(chunk(ids).map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunk([])).toEqual([]);
    expect(chunk(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
  });
});
