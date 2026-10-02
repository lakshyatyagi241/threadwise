import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMNS,
  parseStoredColumns,
  serializeColumns,
  toggleColumn,
  visibleColumns,
} from './columns';

describe('columns', () => {
  it('shows the defaults on first visit, title first', () => {
    expect(visibleColumns(null)).toEqual([...DEFAULT_COLUMNS]);
  });
  it('draws stored columns in canonical order and always keeps the title', () => {
    expect(visibleColumns(['due', 'created'])).toEqual(['title', 'due', 'created']);
  });
  it('treats malformed storage as never chosen and drops unknown ids', () => {
    expect(parseStoredColumns(null)).toBeNull();
    expect(parseStoredColumns('{oops')).toBeNull();
    expect(parseStoredColumns('"x"')).toBeNull();
    expect(parseStoredColumns('["due","gone"]')).toEqual(['due']);
  });
  it('round-trips through storage', () => {
    expect(parseStoredColumns(serializeColumns(['title', 'deal']))).toEqual(['title', 'deal']);
  });
  it('toggles a column on and off but never the title', () => {
    expect(toggleColumn(['title'], 'due', true)).toEqual(['title', 'due']);
    expect(toggleColumn(['title', 'due'], 'due', false)).toEqual(['title']);
    expect(toggleColumn(['title', 'due'], 'title', false)).toEqual(['title', 'due']);
  });
});
