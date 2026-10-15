import { describe, expect, it } from 'vitest';
import { safeTagColor, DEFAULT_TAG_COLOR } from '../components/tag-chip';
import { id, summary } from './fixtures';
import {
  DEFAULT_FILTERS,
  EMPTY_LIST,
  filtersKey,
  isFiltered,
  listQuery,
  listReducer,
  matchesFilters,
  tagsFromParam,
} from './list';

const tag = (n: number) => ({ id: id(n), name: `L${n}`, color: null });

describe('tag colors', () => {
  it('keeps a hex color or a plain name, adds the # to a bare hex, and refuses anything that could carry CSS', () => {
    expect(safeTagColor('#5B3D8A')).toBe('#5B3D8A');
    expect(safeTagColor('5B3D8A')).toBe('#5B3D8A');
    expect(safeTagColor('teal')).toBe('teal');
    for (const bad of ['red;x', 'url(http://x)', 'rgb(0,0,0)', '', null, undefined, '#12', 'a b']) {
      expect(safeTagColor(bad as string | null)).toBe(DEFAULT_TAG_COLOR);
    }
  });
});

describe('the tag filter', () => {
  it('is read from the address: uuids only, lowercased, de-duplicated, at most 20', () => {
    const a = id(1);
    expect(tagsFromParam(null)).toEqual([]);
    expect(tagsFromParam('')).toEqual([]);
    expect(tagsFromParam(`${a.toUpperCase()},${a},nonsense, ${id(2)}`)).toEqual([a, id(2)]);
    const many = Array.from({ length: 30 }, (_, i) => id(i + 1)).join(',');
    expect(tagsFromParam(many)).toHaveLength(20);
  });

  it('goes to the server as one comma-separated parameter, only when set', () => {
    expect(listQuery(DEFAULT_FILTERS).tags).toBeUndefined();
    expect(listQuery({ ...DEFAULT_FILTERS, tags: [id(1), id(2)] }).tags).toBe(`${id(1)},${id(2)}`);
  });

  it('counts as a filter and restarts the list when it changes', () => {
    const on = { ...DEFAULT_FILTERS, tags: [id(1)] };
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltered(on)).toBe(true);
    expect(filtersKey(on)).not.toBe(filtersKey(DEFAULT_FILTERS));
  });

  it('keeps a row only when it carries any chosen tag', () => {
    const f = { ...DEFAULT_FILTERS, tags: [id(1), id(2)] };
    expect(matchesFilters(summary({ labels: [tag(2)] }), f, null)).toBe(true);
    expect(matchesFilters(summary({ labels: [tag(3)] }), f, null)).toBe(false);
    expect(matchesFilters(summary({ labels: [] }), f, null)).toBe(false);
    expect(matchesFilters(summary({ labels: [] }), DEFAULT_FILTERS, null)).toBe(true);
  });

  it('names the scope only when it is the tags of the contact, and a scope alone sends nothing', () => {
    const tags = [id(1)];
    expect(listQuery({ ...DEFAULT_FILTERS, tags }).tagScope).toBeUndefined();
    expect(listQuery({ ...DEFAULT_FILTERS, tags, tagScope: 'contact' }).tagScope).toBe('contact');
    expect(listQuery({ ...DEFAULT_FILTERS, tagScope: 'contact' }).tagScope).toBeUndefined();
    expect(filtersKey({ ...DEFAULT_FILTERS, tags, tagScope: 'contact' })).not.toBe(
      filtersKey({ ...DEFAULT_FILTERS, tags }),
    );
  });

  it('does not test a row against the tags of the contact (it does not carry them), and the list ignores strangers under that scope', () => {
    const f = { ...DEFAULT_FILTERS, tags: [id(1)], tagScope: 'contact' as const };
    const row = summary({ labels: [] });
    expect(matchesFilters(row, f, null)).toBe(true);
    // A row the server did not list stays out; one already listed is kept up to date.
    const empty = listReducer(EMPTY_LIST, { type: 'upsert', row, filters: f, meId: null });
    expect(empty.rows).toEqual([]);
    const loaded = listReducer(EMPTY_LIST, {
      type: 'loaded',
      rows: [row],
      cursor: null,
      hasMore: false,
      counts: { all: 1, mine: 0, unassigned: 0, unread: 0, archived: 0 },
    });
    const next = listReducer(loaded, {
      type: 'upsert',
      row: { ...row, rowVersion: row.rowVersion + 1, preview: 'newer' },
      filters: f,
      meId: null,
    });
    expect(next.rows[0]!.preview).toBe('newer');
  });
});
