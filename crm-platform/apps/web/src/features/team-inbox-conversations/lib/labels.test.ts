import { describe, expect, it } from 'vitest';
import { safeLabelColor, DEFAULT_LABEL_COLOR } from '../components/label-chip';
import { id, summary } from './fixtures';
import {
  DEFAULT_FILTERS,
  filtersKey,
  isFiltered,
  labelsFromParam,
  listQuery,
  matchesFilters,
} from './list';

const label = (n: number) => ({ id: id(n), name: `L${n}`, color: null });

describe('label colors', () => {
  it('keeps a hex color or a plain name, adds the # to a bare hex, and refuses anything that could carry CSS', () => {
    expect(safeLabelColor('#5B3D8A')).toBe('#5B3D8A');
    expect(safeLabelColor('5B3D8A')).toBe('#5B3D8A');
    expect(safeLabelColor('teal')).toBe('teal');
    for (const bad of ['red;x', 'url(http://x)', 'rgb(0,0,0)', '', null, undefined, '#12', 'a b']) {
      expect(safeLabelColor(bad as string | null)).toBe(DEFAULT_LABEL_COLOR);
    }
  });
});

describe('the label filter', () => {
  it('is read from the address: uuids only, lowercased, de-duplicated, at most 20', () => {
    const a = id(1);
    expect(labelsFromParam(null)).toEqual([]);
    expect(labelsFromParam('')).toEqual([]);
    expect(labelsFromParam(`${a.toUpperCase()},${a},nonsense, ${id(2)}`)).toEqual([a, id(2)]);
    const many = Array.from({ length: 30 }, (_, i) => id(i + 1)).join(',');
    expect(labelsFromParam(many)).toHaveLength(20);
  });

  it('goes to the server as one comma-separated parameter, only when set', () => {
    expect(listQuery(DEFAULT_FILTERS).labels).toBeUndefined();
    expect(listQuery({ ...DEFAULT_FILTERS, labels: [id(1), id(2)] }).labels).toBe(
      `${id(1)},${id(2)}`,
    );
  });

  it('counts as a filter and restarts the list when it changes', () => {
    const on = { ...DEFAULT_FILTERS, labels: [id(1)] };
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltered(on)).toBe(true);
    expect(filtersKey(on)).not.toBe(filtersKey(DEFAULT_FILTERS));
  });

  it('keeps a row only when it carries any chosen label', () => {
    const f = { ...DEFAULT_FILTERS, labels: [id(1), id(2)] };
    expect(matchesFilters(summary({ labels: [label(2)] }), f, null)).toBe(true);
    expect(matchesFilters(summary({ labels: [label(3)] }), f, null)).toBe(false);
    expect(matchesFilters(summary({ labels: [] }), f, null)).toBe(false);
    expect(matchesFilters(summary({ labels: [] }), DEFAULT_FILTERS, null)).toBe(true);
  });
});
