import { describe, expect, it } from 'vitest';
import {
  addableColumns,
  allColumns,
  columnGroup,
  hideColumn,
  showColumn,
  defaultColumns,
  parseStoredColumns,
  serializeColumns,
  moveColumn,
  nudgeColumn,
  omittedColumns,
  restoreOmitted,
  sortKeyOf,
  toggleColumn,
  visibleColumns,
  type ColumnId,
} from './columns';
import { formatDateTime, formatDmy } from './format';

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
      'whatsapp',
      'sms',
      'emailOptIn',
      'owner',
      'leadScore',
      'company',
      'language',
      'memo',
      'source',
      'dateOfBirth',
      'minor',
      'lastActivity',
      'nextFollowUp',
      'createdOn',
    ]);
  });

  it('shows the seven columns of the slim Contact Hub on a first visit', () => {
    const seven = ['name', 'phone', 'email', 'stage', 'whatsapp', 'owner', 'createdOn'];
    expect(ids(visibleColumns(null, attrs))).toEqual(seven);
    expect(defaultColumns([])).toEqual(seven);
    expect(defaultColumns(attrs)).toHaveLength(7);
  });

  it('leaves out a column the person cannot have', () => {
    const omit = new Set<ColumnId>(['company']);
    expect(ids(allColumns(attrs, omit))).not.toContain('company');
    expect(ids(visibleColumns(['phone', 'company'], attrs, null, omit))).toEqual(['name', 'phone']);
    expect(ids(visibleColumns(['phone', 'company'], attrs))).toEqual(['name', 'phone', 'company']);
  });

  it('groups the columns for the add-column picker and offers only the ones not shown', () => {
    expect(columnGroup('phone')).toBe('contact');
    expect(columnGroup('stage')).toBe('lifecycle');
    expect(columnGroup('company')).toBe('related');
    expect(columnGroup('whatsapp')).toBe('consent');
    expect(columnGroup('createdOn')).toBe('activity');
    expect(columnGroup('attr:city')).toBe('custom');
    const groups = addableColumns(allColumns(attrs), defaultColumns(attrs));
    expect(groups.map((g) => g.group)).toEqual([
      'contact',
      'lifecycle',
      'related',
      'consent',
      'activity',
      'custom',
    ]);
    const flat = groups.flatMap((g) => g.columns.map((c) => c.id));
    expect(flat).not.toContain('name');
    expect(flat).not.toContain('phone');
    expect(flat).toContain('tags');
    expect(flat).toContain('attr:city');
    // everything shown: nothing to offer
    expect(addableColumns(allColumns(attrs), ids(allColumns(attrs)) as ColumnId[])).toEqual([]);
  });

  it('adds a column at the end and hides one, never the name', () => {
    expect(showColumn(['name', 'phone'], 'email')).toEqual(['name', 'phone', 'email']);
    expect(showColumn(['name', 'phone'], 'phone')).toEqual(['name', 'phone']);
    expect(hideColumn(['name', 'phone', 'email'], 'phone')).toEqual(['name', 'email']);
    expect(hideColumn(['name', 'phone'], 'name')).toEqual(['name', 'phone']);
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
  it('puts the instant on the calendar day of the zone it is shown in', () => {
    // 20:30 UTC on 2 Oct is already 3 Oct in Kolkata and still 2 Oct in New York.
    expect(formatDmy('2026-10-02T20:30:00Z', 'UTC')).toBe('02/10/2026');
    expect(formatDmy('2026-10-02T20:30:00Z', 'Asia/Kolkata')).toBe('03/10/2026');
    expect(formatDmy('2026-10-02T20:30:00Z', 'America/New_York')).toBe('02/10/2026');
  });
  it('is empty for missing or invalid dates', () => {
    expect(formatDmy(null)).toBe('');
    expect(formatDmy(undefined)).toBe('');
    expect(formatDmy('not a date')).toBe('');
  });
});

describe('formatDateTime in a zone', () => {
  it('shows the clock of the zone, in English and in another language', () => {
    expect(formatDateTime('2026-10-01T20:30:00Z', 'en', 'UTC')).toBe('01 Oct 2026, 08:30 PM');
    expect(formatDateTime('2026-10-01T20:30:00Z', 'en', 'Asia/Kolkata')).toBe(
      '02 Oct 2026, 02:00 AM',
    );
    expect(formatDateTime('2026-10-01T20:30:00Z', 'de', 'Asia/Kolkata')).toMatch(/02\.10\.2026/);
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
    // the API has no sort for the opt-in, company, source or last-activity columns
    for (const id of [
      'whatsapp',
      'sms',
      'emailOptIn',
      'company',
      'source',
      'lastActivity',
      'nextFollowUp',
    ] as const) {
      expect(sortKeyOf(id), id).toBeNull();
    }
    expect(sortKeyOf('attr:Has Space' as ColumnId)).toBeNull();
  });
});

describe('owner column', () => {
  it('is one of the seven default columns and can be turned off again', () => {
    expect(ids(allColumns(attrs))).toContain('owner');
    expect(defaultColumns(attrs)).toContain('owner');
    expect(ids(visibleColumns(null, attrs))).toContain('owner');
    const off = toggleColumn(defaultColumns(attrs), 'owner', false);
    expect(ids(visibleColumns(off, attrs))).not.toContain('owner');
  });

  it('sits after the status column when shown', () => {
    const shown = ids(visibleColumns(['owner', 'status', 'email'], attrs));
    expect(shown).toEqual(['name', 'email', 'status', 'owner']);
  });
});

describe('columns while lead scoring is off', () => {
  const off = omittedColumns({ canCompany: true, scoringOn: false });

  it('omits the Lead score column, and the company column only without access to companies', () => {
    expect([...off]).toEqual(['leadScore']);
    expect([...omittedColumns({ canCompany: false, scoringOn: false })].sort()).toEqual([
      'company',
      'leadScore',
    ]);
    expect([...omittedColumns({ canCompany: false, scoringOn: true })]).toEqual(['company']);
    expect(omittedColumns({ canCompany: true, scoringOn: true }).size).toBe(0);
  });

  it('takes Lead score out of the picker and out of the table, even when a person had chosen it', () => {
    expect(ids(allColumns(attrs, off))).not.toContain('leadScore');
    const chosen: ColumnId[] = ['name', 'leadScore', 'email'];
    expect(ids(visibleColumns(chosen, attrs, null, off))).toEqual(['name', 'email']);
    const shown = ids(visibleColumns(chosen, attrs, null, off)) as ColumnId[];
    const offered = addableColumns(allColumns(attrs, off), shown).flatMap((g) =>
      g.columns.map((c) => c.id),
    );
    expect(offered).not.toContain('leadScore');
    // the first-visit columns never had it
    expect(defaultColumns(attrs)).not.toContain('leadScore');
  });

  it('gives the column back, in the place the person had put it, when scoring is on again', () => {
    const chosen: ColumnId[] = ['name', 'leadScore', 'email'];
    const on = omittedColumns({ canCompany: true, scoringOn: true });
    expect(ids(visibleColumns(chosen, attrs, null, on))).toEqual(['name', 'email', 'leadScore']);
  });

  it('writes a saved view back whole: the omitted column keeps its place', () => {
    const saved = ['name', 'phone', 'leadScore', 'email'];
    const shown: ColumnId[] = ['name', 'phone', 'email'];
    expect(restoreOmitted(shown, saved, off)).toEqual(saved);
    // other edits survive, only the omitted id is put back
    expect(restoreOmitted(['name', 'email'], saved, off)).toEqual(['name', 'email', 'leadScore']);
    // nothing omitted, or nothing saved: as shown
    expect(restoreOmitted(shown, saved, new Set())).toEqual(shown);
    expect(restoreOmitted(shown, null, off)).toEqual(shown);
    // already there: not doubled
    expect(restoreOmitted(['name', 'leadScore'], ['name', 'leadScore'], off)).toEqual([
      'name',
      'leadScore',
    ]);
  });
});
