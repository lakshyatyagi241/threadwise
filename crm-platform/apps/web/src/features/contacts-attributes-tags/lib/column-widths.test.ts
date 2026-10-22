import { describe, expect, it } from 'vitest';
import {
  MAX_COLUMN_W,
  MIN_COLUMN_W,
  clampWidth,
  parseColumnWidths,
  serializeColumnWidths,
  withColumnWidth,
} from './column-widths';

describe('column widths', () => {
  it('keeps a width between the minimum and the maximum', () => {
    expect(clampWidth(10)).toBe(MIN_COLUMN_W);
    expect(clampWidth(5000)).toBe(MAX_COLUMN_W);
    expect(clampWidth(201.4)).toBe(201);
  });

  it('reads storage defensively', () => {
    expect(parseColumnWidths(null)).toEqual({});
    expect(parseColumnWidths('nope')).toEqual({});
    expect(parseColumnWidths('[1,2]')).toEqual({});
    expect(parseColumnWidths('{"email":300,"phone":"x","tags":5}')).toEqual({
      email: 300,
      tags: MIN_COLUMN_W,
    });
  });

  it('sets, resets and serialises', () => {
    const a = withColumnWidth({}, 'email', 333);
    expect(a).toEqual({ email: 333 });
    expect(serializeColumnWidths(a)).toBe('{"email":333}');
    expect(withColumnWidth(a, 'email', null)).toEqual({});
    expect(serializeColumnWidths({})).toBeNull();
  });
});
