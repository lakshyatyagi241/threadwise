import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMNS,
  allColumns,
  exportColumnIds,
  parseStoredColumns,
  propId,
  serializeColumns,
  visibleColumns,
} from './columns';

const props = [
  { key: 'tier', label: 'Tier' },
  { key: 'seats', label: 'Seats' },
];

describe('the columns of the companies table (BL-196)', () => {
  it('a first visit shows exactly Reference table', () => {
    expect(visibleColumns(null, props).map((c) => c.id)).toEqual([
      'company',
      'industry',
      'contacts',
      'openDeals',
      'wonValue',
    ]);
    expect([...DEFAULT_COLUMNS]).toEqual(visibleColumns(null, []).map((c) => c.id));
  });

  it('offers the details, then the properties, then the figures, in a fixed order', () => {
    expect(allColumns(props).map((c) => c.id)).toEqual([
      'company',
      'industry',
      'website',
      'email',
      'phone',
      'size',
      'owner',
      'prop:tier',
      'prop:seats',
      'created',
      'contacts',
      'openDeals',
      'wonValue',
    ]);
  });

  it('draws the chosen columns in the canonical order, always with the company first', () => {
    const cols = visibleColumns(['wonValue', propId('seats'), 'owner'], props);
    expect(cols.map((c) => c.id)).toEqual(['company', 'owner', 'prop:seats', 'wonValue']);
  });

  it('a property that was deleted or deactivated drops out of a stored choice', () => {
    const cols = visibleColumns(['industry', propId('gone')], props);
    expect(cols.map((c) => c.id)).toEqual(['company', 'industry']);
  });

  it('reads a stored choice back, and treats anything malformed as never chosen', () => {
    expect(parseStoredColumns(serializeColumns(['company', propId('tier')]))).toEqual([
      'company',
      'prop:tier',
    ]);
    for (const raw of [null, '', 'nope', '{"a":1}', '[1,2]'])
      expect(parseStoredColumns(raw)).toBeNull();
  });

  it('an export holds the details and the properties the table shows, in table order, and no figures', () => {
    const cols = visibleColumns(
      ['industry', 'owner', propId('tier'), 'contacts', 'created'],
      props,
    );
    expect(exportColumnIds(cols)).toEqual([
      'name',
      'industry',
      'owner',
      'property:tier',
      'createdAt',
    ]);
  });
});
