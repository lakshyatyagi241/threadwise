import { describe, expect, it } from 'vitest';
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  readColumnWidths,
  tableMinWidth,
} from './contacts-list';

describe('column widths the person dragged to', () => {
  it('are read back, kept inside the limits, and anything else is ignored', () => {
    expect(readColumnWidths(null)).toEqual({});
    expect(readColumnWidths('not json')).toEqual({});
    expect(readColumnWidths('[1,2]')).toEqual({});
    expect(
      readColumnWidths(JSON.stringify({ email: 320, phone: 5, tags: 99999, memo: 'wide' })),
    ).toEqual({
      email: 320,
      phone: MIN_COLUMN_WIDTH,
      tags: MAX_COLUMN_WIDTH,
    });
  });

  it('count in the width of the table', () => {
    const columns = [{ id: 'email' }, { id: 'phone' }] as never;
    const base = tableMinWidth(columns, false);
    expect(tableMinWidth(columns, false, { email: 400 })).toBe(base - 260 + 400);
    expect(tableMinWidth(columns, false, {})).toBe(base);
  });
});
