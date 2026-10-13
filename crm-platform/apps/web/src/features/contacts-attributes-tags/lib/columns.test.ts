import { describe, expect, it } from 'vitest';
import {
  allColumns,
  defaultColumns,
  parseStoredColumns,
  serializeColumns,
  moveColumn,
  nudgeColumn,
  sortKeyOf,
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
      'owner',
      'leadScore',
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
      'leadScore',
      'createdOn',
    ]);
    expect(defaultColumns([])).toEqual([
      'name',
      'phone',
      'email',
      'tags',
      'stage',
      'status',
      'leadScore',
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

describe('arranging columns', () => {
  const shown = ['name', 'phone', 'email', 'tags', 'stage'] as ColumnId[];

  it('keeps the usual order until the person arranges one', () => {
    expect(ids(visibleColumns(shown, attrs, null))).toEqual(shown);
    expect(ids(visibleColumns(shown, attrs, []))).toEqual(shown);
  });

  it('follows the arranged order, drops columns no longer shown, and puts unplaced ones last', () => {
    const order = ['name', 'stage', 'email', 'attr:gone', 'phone'] as ColumnId[];
    expect(ids(visibleColumns(shown, attrs, order))).toEqual([
      'name',
      'stage',
      'email',
      'phone',
      'tags',
    ]);
  });

  it('keeps the name column first even if an order puts it elsewhere', () => {
    expect(ids(visibleColumns(shown, attrs, ['email', 'name', 'phone'] as ColumnId[]))[0]).toBe(
      'name',
    );
  });

  it('moves a column onto another, never in front of the name, never the name itself', () => {
    expect(moveColumn(shown, 'stage', 'phone')).toEqual([
      'name',
      'stage',
      'phone',
      'email',
      'tags',
    ]);
    expect(moveColumn(shown, 'phone', 'stage')).toEqual([
      'name',
      'email',
      'tags',
      'stage',
      'phone',
    ]);
    expect(moveColumn(shown, 'phone', 'name')).toEqual(['name', 'phone', 'email', 'tags', 'stage']);
    expect(moveColumn(shown, 'name', 'stage')).toEqual(shown);
    expect(moveColumn(shown, 'phone', 'phone')).toEqual(shown);
  });

  it('nudges one step and stops at the ends', () => {
    expect(nudgeColumn(shown, 'email', -1)).toEqual(['name', 'email', 'phone', 'tags', 'stage']);
    expect(nudgeColumn(shown, 'email', 1)).toEqual(['name', 'phone', 'tags', 'email', 'stage']);
    expect(nudgeColumn(shown, 'phone', -1)).toEqual(shown);
    expect(nudgeColumn(shown, 'stage', 1)).toEqual(shown);
  });
});

describe('sortKeyOf', () => {
  it('maps columns to the API sort and refuses the many-valued ones', () => {
    expect(sortKeyOf('name')).toBe('name');
    expect(sortKeyOf('createdOn')).toBe('createdAt');
    expect(sortKeyOf('attr:order_count')).toBe('attr:order_count');
    expect(sortKeyOf('tags')).toBeNull();
    expect(sortKeyOf('groups')).toBeNull();
    expect(sortKeyOf('leadScore')).toBeNull();
    expect(sortKeyOf('owner')).toBeNull();
    expect(sortKeyOf('attr:Has Space' as ColumnId)).toBeNull();
  });
});

describe('owner column', () => {
  it('is offered in the column chooser but hidden until someone turns it on (Reference lists no owner)', () => {
    expect(ids(allColumns(attrs))).toContain('owner');
    expect(defaultColumns(attrs)).not.toContain('owner');
    expect(ids(visibleColumns(null, attrs))).not.toContain('owner');
    const on = toggleColumn(defaultColumns(attrs), 'owner', true);
    expect(ids(visibleColumns(on, attrs))).toContain('owner');
  });

  it('sits after the status column when shown', () => {
    const shown = ids(visibleColumns(['owner', 'status', 'email'], attrs));
    expect(shown).toEqual(['name', 'email', 'status', 'owner']);
  });
});
