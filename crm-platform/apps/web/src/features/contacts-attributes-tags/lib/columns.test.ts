import { describe, expect, it } from 'vitest';
import {
  allColumns,
  defaultColumns,
  parseStoredColumns,
  serializeColumns,
  toggleColumn,
  visibleColumns,
  type ColumnId,
} from './columns';
import { formatDmy } from './format';

const attrs = [
  { key: 'order_count', name: 'Order Count' },
  { key: 'total_spent', name: 'Total Spent' },
  { key: 'city', name: 'City' },
];
const ids = (c: Array<{ id: string }>) => c.map((x) => x.id);

describe('columns', () => {
  it('orders name, phone, attributes, email, tags, then the optional ones', () => {
    expect(ids(allColumns(attrs))).toEqual([
      'name',
      'phone',
      'attr:order_count',
      'attr:total_spent',
      'attr:city',
      'email',
      'tags',
      'groups',
      'stage',
      'status',
      'language',
      'memo',
      'createdOn',
    ]);
  });

  it('shows the Contact Hub columns and the first two attributes on a first visit', () => {
    expect(ids(visibleColumns(null, attrs))).toEqual([
      'name',
      'phone',
      'attr:order_count',
      'attr:total_spent',
      'email',
      'tags',
      'stage',
      'status',
      'createdOn',
    ]);
    expect(defaultColumns([])).toEqual([
      'name',
      'phone',
      'email',
      'tags',
      'stage',
      'status',
      'createdOn',
    ]);
  });

  it('honours a stored choice, in canonical order, and always keeps the name', () => {
    const stored: ColumnId[] = ['createdOn', 'attr:city', 'memo'];
    expect(ids(visibleColumns(stored, attrs))).toEqual(['name', 'attr:city', 'memo', 'createdOn']);
  });

  it('drops stored attribute columns that no longer exist', () => {
    expect(ids(visibleColumns(['phone', 'attr:gone'], attrs))).toEqual(['name', 'phone']);
  });

  it('toggles a column on and off, but never the name', () => {
    expect(toggleColumn(['name', 'phone'], 'email', true)).toEqual(['name', 'phone', 'email']);
    expect(toggleColumn(['name', 'phone'], 'phone', false)).toEqual(['name']);
    expect(toggleColumn(['name', 'phone'], 'name', false)).toEqual(['name', 'phone']);
    expect(toggleColumn(['phone'], 'phone', true)).toEqual(['phone']);
  });

  it('round-trips through storage and treats junk as never chosen', () => {
    const v: ColumnId[] = ['name', 'attr:city'];
    expect(parseStoredColumns(serializeColumns(v))).toEqual(v);
    for (const bad of [null, '', '{', '{"a":1}', '[1,2]', 'null']) {
      expect(parseStoredColumns(bad), String(bad)).toBeNull();
    }
  });
});

describe('formatDmy', () => {
  it('writes day/month/year with zeros', () => {
    expect(formatDmy('2026-03-05T12:00:00.000Z')).toBe('05/03/2026');
    expect(formatDmy('2026-12-25T12:00:00.000Z')).toBe('25/12/2026');
  });
  it('is empty for missing or invalid dates', () => {
    expect(formatDmy(null)).toBe('');
    expect(formatDmy(undefined)).toBe('');
    expect(formatDmy('not a date')).toBe('');
  });
});
